use serde::Serialize;
use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{net::TcpSocket, sync::Semaphore, task::JoinSet, time::timeout};

#[path = "scan_identity.rs"]
mod identity;
#[path = "scan_vendor.rs"]
mod vendor;

#[cfg(windows)]
#[path = "scan_windows.rs"]
mod platform;

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn adapters() -> Result<Vec<ScanAdapter>, String> {
        Err("Device scanning currently requires Windows.".into())
    }
    pub fn discover(_: Ipv4Addr, _: Ipv4Addr, _: &AtomicBool) -> (Option<String>, bool) {
        (None, false)
    }
    pub fn hostname(_: Ipv4Addr) -> Option<String> {
        None
    }
    pub fn bind_interface(_: &TcpSocket, _: u32) -> std::io::Result<()> {
        Ok(())
    }
}

const CONCURRENCY: usize = 48;
const WEB_PORTS: [u16; 4] = [80, 443, 8080, 8443];

#[derive(Clone, Debug, Serialize)]
pub struct ScanAdapter {
    pub id: String,
    pub name: String,
    pub ipv4: Ipv4Addr,
    pub prefix: u8,
    pub subnet: String,
    pub host_count: u32,
    pub mac: Option<String>,
    pub interface_index: u32,
    pub has_gateway: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScanDevice {
    pub ip: Ipv4Addr,
    pub host_name: Option<String>,
    pub device_name: Option<String>,
    pub manufacturer: Option<String>,
    pub host_source: String,
    pub device_source: String,
    pub manufacturer_source: String,
    pub mac_vendor: Option<String>,
    pub mac: Option<String>,
    pub web_ports: Vec<u16>,
    pub is_local: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScanSnapshot {
    pub adapter: ScanAdapter,
    pub status: String,
    pub checked: u32,
    pub total: u32,
    pub devices: Vec<ScanDevice>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Default)]
struct Session {
    snapshot: Option<ScanSnapshot>,
    cancel: Arc<AtomicBool>,
}

pub struct ScanState {
    session: Arc<Mutex<Session>>,
    // Timed-out OS name lookups keep their permit until the OS call returns.
    // Repeated scans therefore cannot accumulate unlimited blocking threads.
    dns_slots: Arc<Semaphore>,
}

impl Default for ScanState {
    fn default() -> Self {
        Self {
            session: Default::default(),
            dns_slots: Arc::new(Semaphore::new(16)),
        }
    }
}

fn host_bounds(ip: Ipv4Addr, prefix: u8) -> Result<(u32, u32), String> {
    if !(16..=32).contains(&prefix) {
        return Err("This subnet is too large for this version. Scanning supports /16 through /32; no partial range was scanned.".into());
    }
    let mask = u32::MAX << (32 - prefix);
    let network = u32::from(ip) & mask;
    let broadcast = network | !mask;
    Ok(if prefix >= 31 {
        (network, broadcast)
    } else {
        (network + 1, broadcast - 1)
    })
}

#[tauri::command]
pub async fn list_scan_adapters() -> Result<Vec<ScanAdapter>, String> {
    tokio::task::spawn_blocking(platform::adapters)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_scan(
    adapter_id: String,
    state: tauri::State<'_, ScanState>,
) -> Result<ScanSnapshot, String> {
    // Resolve the selection again so stale UI data cannot scan an old subnet.
    let adapter = list_scan_adapters()
        .await?
        .into_iter()
        .find(|a| a.id == adapter_id)
        .ok_or("That adapter is no longer connected. Refresh the network ports and try again.")?;
    begin_scan(&state, adapter)
}

fn begin_scan(state: &ScanState, adapter: ScanAdapter) -> Result<ScanSnapshot, String> {
    let (first, last) = host_bounds(adapter.ipv4, adapter.prefix)?;
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    if session
        .snapshot
        .as_ref()
        .is_some_and(|s| matches!(s.status.as_str(), "running" | "identifying" | "stopping"))
    {
        return Err("A scan is already running.".into());
    }
    let snapshot = ScanSnapshot {
        adapter: adapter.clone(),
        status: "running".into(),
        checked: 0,
        total: last - first + 1,
        devices: vec![],
        error: None,
        warnings: vec![],
    };
    session.snapshot = Some(snapshot.clone());
    session.cancel = Arc::new(AtomicBool::new(false));
    let cancel = session.cancel.clone();
    tokio::spawn(run_scan(
        state.session.clone(),
        state.dns_slots.clone(),
        adapter,
        first,
        last,
        cancel,
    ));
    Ok(snapshot)
}

#[tauri::command]
pub fn get_scan_status(state: tauri::State<'_, ScanState>) -> Result<Option<ScanSnapshot>, String> {
    Ok(state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .snapshot
        .clone())
}

#[tauri::command]
pub fn stop_scan(state: tauri::State<'_, ScanState>) -> Result<(), String> {
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    session.cancel.store(true, Ordering::Relaxed);
    if let Some(snapshot) = &mut session.snapshot {
        if matches!(snapshot.status.as_str(), "running" | "identifying") {
            snapshot.status = "stopping".into();
        }
    }
    Ok(())
}

async fn run_scan(
    session: Arc<Mutex<Session>>,
    dns_slots: Arc<Semaphore>,
    adapter: ScanAdapter,
    first: u32,
    last: u32,
    cancel: Arc<AtomicBool>,
) {
    let identities = identity::Identities::default();
    let mut discovery = JoinSet::new();
    let a = adapter.clone();
    let map = identities.clone();
    let flag = cancel.clone();
    discovery.spawn(async move { ("mDNS", identity::mdns(a, map, flag).await) });
    let a = adapter.clone();
    let map = identities.clone();
    let flag = cancel.clone();
    discovery.spawn(async move { ("SSDP", identity::ssdp(a, map, flag).await) });
    let client = identity::http_client(adapter.ipv4).ok();
    let mut pending = JoinSet::new();
    let mut addresses = first..=last;
    loop {
        while pending.len() < CONCURRENCY && !cancel.load(Ordering::Relaxed) {
            let Some(address) = addresses.next() else {
                break;
            };
            pending.spawn(probe(
                adapter.clone(),
                address.into(),
                cancel.clone(),
                dns_slots.clone(),
                identities.clone(),
                client.clone(),
            ));
        }
        let Some(result) = pending.join_next().await else {
            break;
        };
        let mut guard = session.lock().unwrap();
        let snapshot = guard.snapshot.as_mut().unwrap();
        match result {
            Ok(Ok(device)) => {
                if !cancel.load(Ordering::Relaxed) || device.is_some() {
                    snapshot.checked += 1;
                }
                if let Some(device) = device {
                    snapshot.devices.push(device);
                }
            }
            error => {
                snapshot.error = Some(match error {
                    Ok(Err(e)) => e,
                    Err(e) => format!("A scan worker failed: {e}"),
                    _ => unreachable!(),
                });
                cancel.store(true, Ordering::Relaxed);
            }
        }
        apply_identities(snapshot, &identities);
    }
    {
        let mut guard = session.lock().unwrap();
        if !cancel.load(Ordering::Relaxed) {
            guard.snapshot.as_mut().unwrap().status = "identifying".into();
        }
    }
    while let Some(result) = discovery.join_next().await {
        let warning = match result {
            Ok((_, Ok(()))) => None,
            Ok((method, Err(error))) => {
                Some(format!("{method} identification unavailable: {error}"))
            }
            Err(error) => Some(format!("Device identification failed: {error}")),
        };
        let mut guard = session.lock().unwrap();
        let snapshot = guard.snapshot.as_mut().unwrap();
        if let Some(warning) = warning {
            snapshot.warnings.push(warning);
        }
        apply_identities(snapshot, &identities);
    }
    // All probes drain before restart; native ARP calls cannot be force-cancelled.
    let mut guard = session.lock().unwrap();
    let snapshot = guard.snapshot.as_mut().unwrap();
    // Announced services are also evidence of a live device, even if unicast probes were blocked.
    if !cancel.load(Ordering::Relaxed) {
        for (ip, data) in identities.lock().unwrap().iter() {
            if !snapshot.devices.iter().any(|device| &device.ip == ip) {
                let mut device = device_row(*ip, None, vec![], *ip == adapter.ipv4);
                apply_identity(&mut device, data);
                snapshot.devices.push(device);
            }
        }
    }
    snapshot.status = if snapshot.error.is_some() {
        "failed"
    } else if cancel.load(Ordering::Relaxed) {
        "stopped"
    } else {
        "complete"
    }
    .into();
}

fn device_row(
    ip: Ipv4Addr,
    mac: Option<String>,
    web_ports: Vec<u16>,
    is_local: bool,
) -> ScanDevice {
    let mac_vendor = mac.as_deref().and_then(vendor::lookup);
    ScanDevice {
        ip,
        host_name: None,
        device_name: None,
        manufacturer: mac_vendor.clone(),
        host_source: String::new(),
        device_source: String::new(),
        manufacturer_source: if mac_vendor.is_some() {
            "IEEE MAC assignment".into()
        } else {
            String::new()
        },
        mac_vendor,
        mac,
        web_ports,
        is_local,
    }
}

fn apply_identity(device: &mut ScanDevice, data: &identity::Identity) {
    device.host_name = data.host.clone();
    device.host_source = data.host_source.clone();
    device.device_name = data.device.clone();
    device.device_source = data.device_source.clone();
    if data.manufacturer.is_some() {
        device.manufacturer = data.manufacturer.clone();
        device.manufacturer_source = data.manufacturer_source.clone();
    }
}

fn apply_identities(snapshot: &mut ScanSnapshot, identities: &identity::Identities) {
    let identities = identities.lock().unwrap();
    for device in &mut snapshot.devices {
        if let Some(data) = identities.get(&device.ip) {
            apply_identity(device, data);
        }
    }
}

async fn probe(
    adapter: ScanAdapter,
    ip: Ipv4Addr,
    cancel: Arc<AtomicBool>,
    dns_slots: Arc<Semaphore>,
    identities: identity::Identities,
    client: Option<reqwest::Client>,
) -> Result<Option<ScanDevice>, String> {
    let is_local = ip == adapter.ipv4;
    let (mac, ping) = if is_local {
        (adapter.mac.clone(), false)
    } else {
        let source = adapter.ipv4;
        let flag = cancel.clone();
        tokio::task::spawn_blocking(move || platform::discover(source, ip, &flag))
            .await
            .map_err(|e| format!("Windows discovery failed: {e}"))?
    };
    if cancel.load(Ordering::Relaxed) {
        return Ok(None);
    }
    // Bind both source address and outgoing interface, including on multi-NIC PCs.
    let mut web_ports = Vec::new();
    let mut ports = JoinSet::new();
    for port in WEB_PORTS {
        let source = adapter.ipv4;
        let index = adapter.interface_index;
        ports.spawn(async move {
            let socket = TcpSocket::new_v4()?;
            platform::bind_interface(&socket, index)?;
            socket.bind((source, 0).into())?;
            let open = matches!(
                timeout(
                    Duration::from_millis(1200),
                    socket.connect((ip, port).into())
                )
                .await,
                Ok(Ok(_))
            );
            Ok::<_, std::io::Error>((port, open))
        });
    }
    while let Some(result) = ports.join_next().await {
        let (port, open) = result
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Cannot use the selected network port: {e}"))?;
        if open {
            web_ports.push(port);
        }
    }
    if !is_local && mac.is_none() && !ping && web_ports.is_empty() {
        return Ok(None);
    }
    web_ports.sort_unstable();
    let mut data = identity::Identity::default();
    if !cancel.load(Ordering::Relaxed) {
        let (mdns, netbios, title) = tokio::join!(
            identity::reverse_mdns(adapter.ipv4, ip),
            identity::netbios(adapter.ipv4, ip),
            async {
                if let Some(client) = &client {
                    identity::web_identity(client, ip, &web_ports).await
                } else {
                    None
                }
            }
        );
        data.host(mdns, "mDNS reverse PTR", 4);
        data.host(netbios, "NetBIOS node name", 1);
        data.device(title, "HTTP page title", 1);
        if let Ok(permit) = dns_slots.try_acquire_owned() {
            let name = timeout(
                Duration::from_millis(1800),
                tokio::task::spawn_blocking(move || {
                    let _permit = permit;
                    platform::hostname(ip)
                }),
            )
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
            data.host(name, "Windows name resolution", 2);
        }
    }
    identities
        .lock()
        .unwrap()
        .entry(ip)
        .or_default()
        .merge(&data);
    Ok(Some(device_row(ip, mac, web_ports, is_local)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subnet_uses_real_mask_and_handles_point_to_point() {
        let ip = "192.168.3.27".parse().unwrap();
        let (first, last) = host_bounds(ip, 23).unwrap();
        assert_eq!(Ipv4Addr::from(first).to_string(), "192.168.2.1");
        assert_eq!(Ipv4Addr::from(last).to_string(), "192.168.3.254");
        assert_eq!(last - first + 1, 510);
        assert_eq!(
            host_bounds(ip, 31).unwrap(),
            (u32::from(ip) - 1, u32::from(ip))
        );
        assert_eq!(host_bounds(ip, 32).unwrap(), (u32::from(ip), u32::from(ip)));
        assert!(host_bounds(ip, 15).is_err());
        assert!(host_bounds(ip, 33).is_err());
    }

    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "Explicit live LAN smoke test; probes the first active adapter subnet"]
    async fn live_scan() {
        let adapters = platform::adapters().unwrap();
        println!("Adapters: {adapters:?}");
        let adapter = adapters
            .into_iter()
            .find(|a| a.prefix >= 24)
            .expect("No small active IPv4 subnet");
        let state = ScanState::default();
        begin_scan(&state, adapter.clone()).unwrap();
        assert!(begin_scan(&state, adapter).is_err());
        timeout(Duration::from_secs(90), async {
            loop {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let snapshot = state.session.lock().unwrap().snapshot.clone().unwrap();
                if !matches!(snapshot.status.as_str(), "running" | "identifying") {
                    for device in &snapshot.devices {
                        println!(
                            "{} | host={:?} | device={:?} | manufacturer={:?} | sources={}/{}/{}",
                            device.ip,
                            device.host_name,
                            device.device_name,
                            device.manufacturer,
                            device.host_source,
                            device.device_source,
                            device.manufacturer_source
                        );
                    }
                    println!(
                        "{}: {} devices; {}/{} checked; warnings={:?}",
                        snapshot.status,
                        snapshot.devices.len(),
                        snapshot.checked,
                        snapshot.total,
                        snapshot.warnings
                    );
                    assert_eq!(snapshot.status, "complete");
                    assert_eq!(snapshot.checked, snapshot.total);
                    assert!(snapshot.devices.iter().any(|d| d.is_local));
                    break;
                }
            }
        })
        .await
        .expect("Scan did not finish in 90 seconds");
    }
}
