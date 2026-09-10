use super::ScanAdapter;
use std::{
    net::Ipv4Addr,
    ptr,
    sync::atomic::{AtomicBool, Ordering},
};
use tokio::net::TcpSocket;
use windows_sys::Win32::{
    Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NO_DATA, INVALID_HANDLE_VALUE},
    NetworkManagement::{IpHelper::*, Ndis::IfOperStatusUp},
    Networking::WinSock::*,
};

fn mac_string(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 6 || bytes.iter().all(|b| *b == 0) || bytes[0] & 1 != 0 {
        return None;
    }
    Some(
        bytes
            .iter()
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

// Windows owns these null-terminated strings inside the adapter buffer.
unsafe fn wide_string(value: *const u16) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0;
    while *value.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(value, len))
}

pub fn adapters() -> Result<Vec<ScanAdapter>, String> {
    let mut size = 15_000u32;
    for _ in 0..3 {
        // u64 backing storage supplies the alignment required by the Windows structs.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let head = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        let result = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                GAA_FLAG_SKIP_ANYCAST
                    | GAA_FLAG_SKIP_MULTICAST
                    | GAA_FLAG_SKIP_DNS_SERVER
                    | GAA_FLAG_INCLUDE_GATEWAYS,
                ptr::null(),
                head,
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result == ERROR_NO_DATA {
            return Ok(vec![]);
        }
        if result != 0 {
            return Err(format!(
                "Windows could not list network ports (error {result})."
            ));
        }
        let mut adapters = Vec::new();
        let mut current = head;
        // All list pointers remain inside buffer, which lives through this traversal.
        unsafe {
            while let Some(adapter) = current.as_ref() {
                current = adapter.Next;
                if adapter.OperStatus != IfOperStatusUp
                    || adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK
                {
                    continue;
                }
                let index = adapter.Anonymous1.Anonymous.IfIndex;
                let name = wide_string(adapter.FriendlyName);
                let mac = mac_string(
                    &adapter.PhysicalAddress[..(adapter.PhysicalAddressLength as usize).min(8)],
                );
                let mut unicast = adapter.FirstUnicastAddress;
                while let Some(address) = unicast.as_ref() {
                    unicast = address.Next;
                    if address.DadState != IpDadStatePreferred
                        || address.Address.lpSockaddr.is_null()
                        || address.Address.iSockaddrLength
                            < std::mem::size_of::<SOCKADDR_IN>() as i32
                    {
                        continue;
                    }
                    let socket_address = &*address.Address.lpSockaddr.cast::<SOCKADDR_IN>();
                    if socket_address.sin_family != AF_INET {
                        continue;
                    }
                    let ip = Ipv4Addr::from(socket_address.sin_addr.S_un.S_addr.to_ne_bytes());
                    let prefix = address.OnLinkPrefixLength;
                    if ip.is_loopback() || ip.is_unspecified() || prefix > 32 {
                        continue;
                    }
                    let mask = if prefix == 0 {
                        0
                    } else {
                        u32::MAX << (32 - prefix)
                    };
                    let network = Ipv4Addr::from(u32::from(ip) & mask);
                    let count = if prefix >= 31 {
                        1u64 << (32 - prefix)
                    } else {
                        (1u64 << (32 - prefix)) - 2
                    };
                    adapters.push(ScanAdapter {
                        id: format!("{index}:{ip}"),
                        name: name.clone(),
                        ipv4: ip,
                        prefix,
                        subnet: format!("{network}/{prefix}"),
                        host_count: count as u32,
                        mac: mac.clone(),
                        interface_index: index,
                        has_gateway: !adapter.FirstGatewayAddress.is_null(),
                    });
                }
            }
        }
        adapters.sort_by_key(|adapter| !adapter.has_gateway);
        return Ok(adapters);
    }
    Err("Network ports changed while being read. Please refresh.".into())
}

pub fn discover(
    source: Ipv4Addr,
    destination: Ipv4Addr,
    cancel: &AtomicBool,
) -> (Option<String>, bool) {
    if cancel.load(Ordering::Relaxed) {
        return (None, false);
    }
    let source = u32::from_ne_bytes(source.octets());
    let destination = u32::from_ne_bytes(destination.octets());
    let mut words = [0u32; 2];
    let mut len = std::mem::size_of_val(&words) as u32;
    // SendARP actively resolves this host, not just an old neighbor-cache entry.
    // The source IPv4 explicitly selects the user's local interface.
    let result = unsafe { SendARP(destination, source, words.as_mut_ptr().cast(), &mut len) };
    let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_ne_bytes()).collect();
    let mac = if result == 0 {
        mac_string(&bytes[..(len as usize).min(bytes.len())])
    } else {
        None
    };
    if mac.is_some() || cancel.load(Ordering::Relaxed) {
        return (mac, false);
    }
    unsafe {
        let handle = IcmpCreateFile();
        if handle == INVALID_HANDLE_VALUE {
            return (None, false);
        }
        let payload = b"CTRLbot";
        let mut reply = [0u64; 32];
        let count = IcmpSendEcho2Ex(
            handle,
            ptr::null_mut(),
            None,
            ptr::null(),
            source,
            destination,
            payload.as_ptr().cast(),
            payload.len() as u16,
            ptr::null(),
            reply.as_mut_ptr().cast(),
            std::mem::size_of_val(&reply) as u32,
            700,
        );
        let response = &*reply.as_ptr().cast::<ICMP_ECHO_REPLY>();
        let alive = count > 0 && response.Status == 0 && response.Address == destination;
        IcmpCloseHandle(handle);
        (None, alive)
    }
}

pub fn bind_interface(socket: &TcpSocket, index: u32) -> std::io::Result<()> {
    use std::os::windows::io::AsRawSocket;
    let index = index.to_be();
    let result = unsafe {
        setsockopt(
            socket.as_raw_socket() as SOCKET,
            IPPROTO_IP,
            IP_UNICAST_IF,
            (&index as *const u32).cast(),
            std::mem::size_of_val(&index) as i32,
        )
    };
    if result == SOCKET_ERROR {
        Err(std::io::Error::from_raw_os_error(unsafe {
            WSAGetLastError()
        }))
    } else {
        Ok(())
    }
}

pub fn hostname(ip: Ipv4Addr) -> Option<String> {
    // A standard-library socket initializes Winsock for this process.
    let _init = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    let mut address = SOCKADDR_IN::default();
    address.sin_family = AF_INET;
    address.sin_addr.S_un.S_addr = u32::from_ne_bytes(ip.octets());
    let mut name = [0u16; 1025];
    let result = unsafe {
        GetNameInfoW(
            (&address as *const SOCKADDR_IN).cast(),
            std::mem::size_of_val(&address) as i32,
            name.as_mut_ptr(),
            name.len() as u32,
            ptr::null_mut(),
            0,
            NI_NAMEREQD as i32,
        )
    };
    if result != 0 {
        return None;
    }
    let len = name.iter().position(|c| *c == 0).unwrap_or(name.len());
    let name = String::from_utf16_lossy(&name[..len]);
    if name.is_empty() || name == ip.to_string() {
        None
    } else {
        Some(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_broadcast_and_multicast_macs() {
        assert_eq!(
            mac_string(&[0x30, 0xde, 0x4b, 0x11, 0x3a, 0x8c]).as_deref(),
            Some("30:DE:4B:11:3A:8C")
        );
        assert!(mac_string(&[0; 6]).is_none());
        assert!(mac_string(&[255; 6]).is_none());
        assert!(mac_string(&[0x01, 0, 0x5e, 0, 0, 1]).is_none());
        assert!(mac_string(&[0; 8]).is_none());
    }
}
