use super::ScanAdapter;
use mdns_sd::{IfKind, ServiceDaemon, ServiceEvent};
use std::{
    collections::{BTreeMap, HashSet},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    net::UdpSocket,
    task::JoinSet,
    time::{timeout, Instant},
};

#[derive(Clone, Debug, Default)]
pub struct Identity {
    pub host: Option<String>,
    pub device: Option<String>,
    pub manufacturer: Option<String>,
    pub host_source: String,
    pub device_source: String,
    pub manufacturer_source: String,
    host_rank: u8,
    device_rank: u8,
    manufacturer_rank: u8,
}

pub type Identities = Arc<Mutex<BTreeMap<Ipv4Addr, Identity>>>;

pub fn clean(value: &str) -> Option<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        None
    } else {
        Some(value)
    }
}

fn choose(
    value: &mut Option<String>,
    source: &mut String,
    rank: &mut u8,
    candidate: Option<String>,
    candidate_source: &str,
    candidate_rank: u8,
) {
    if let Some(candidate) = candidate {
        if candidate_rank > *rank
            || (candidate_rank == *rank && value.as_ref().is_none_or(|old| &candidate < old))
        {
            *value = Some(candidate);
            *source = candidate_source.into();
            *rank = candidate_rank;
        }
    }
}

impl Identity {
    pub fn host(&mut self, value: Option<String>, source: &str, rank: u8) {
        choose(
            &mut self.host,
            &mut self.host_source,
            &mut self.host_rank,
            value,
            source,
            rank,
        );
    }
    pub fn device(&mut self, value: Option<String>, source: &str, rank: u8) {
        choose(
            &mut self.device,
            &mut self.device_source,
            &mut self.device_rank,
            value,
            source,
            rank,
        );
    }
    pub fn manufacturer(&mut self, value: Option<String>, source: &str, rank: u8) {
        choose(
            &mut self.manufacturer,
            &mut self.manufacturer_source,
            &mut self.manufacturer_rank,
            value,
            source,
            rank,
        );
    }
    pub fn merge(&mut self, other: &Self) {
        self.host(other.host.clone(), &other.host_source, other.host_rank);
        self.device(
            other.device.clone(),
            &other.device_source,
            other.device_rank,
        );
        self.manufacturer(
            other.manufacturer.clone(),
            &other.manufacturer_source,
            other.manufacturer_rank,
        );
    }
}

fn in_subnet(adapter: &ScanAdapter, ip: Ipv4Addr) -> bool {
    super::host_bounds(adapter.ipv4, adapter.prefix)
        .is_ok_and(|(first, last)| (first..=last).contains(&u32::from(ip)))
}

struct MdnsGuard(ServiceDaemon);
impl Drop for MdnsGuard {
    fn drop(&mut self) {
        let _ = self.0.shutdown();
    }
}

pub async fn mdns(
    adapter: ScanAdapter,
    identities: Identities,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let daemon = MdnsGuard(ServiceDaemon::new().map_err(|e| e.to_string())?);
    daemon
        .0
        .disable_interface(IfKind::All)
        .map_err(|e| e.to_string())?;
    daemon
        .0
        .enable_interface(IfKind::IndexV4(adapter.interface_index))
        .map_err(|e| e.to_string())?;
    let meta = "_services._dns-sd._udp.local.";
    let mut types = HashSet::new();
    let mut receivers = Vec::new();
    // Seed common services as well as enumerate everything, as IoT does.
    for ty in [
        meta,
        "_http._tcp.local.",
        "_https._tcp.local.",
        "_ipp._tcp.local.",
        "_ipps._tcp.local.",
        "_printer._tcp.local.",
        "_pdl-datastream._tcp.local.",
        "_googlecast._tcp.local.",
        "_airplay._tcp.local.",
        "_raop._tcp.local.",
        "_sonos._tcp.local.",
        "_workstation._tcp.local.",
        "_smb._tcp.local.",
        "_ssh._tcp.local.",
        "_nmos-node._tcp.local.",
    ] {
        receivers.push(daemon.0.browse(ty).map_err(|e| e.to_string())?);
        types.insert(ty.to_string());
    }
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline && !cancel.load(Ordering::Relaxed) {
        let mut new_types = Vec::new();
        for receiver in &receivers {
            // Bound the work even on networks with very chatty advertisers.
            for _ in 0..128 {
                let Ok(event) = receiver.try_recv() else {
                    break;
                };
                match event {
                    ServiceEvent::ServiceFound(ty, name) if ty == meta => {
                        if types.len() < 64
                            && name.ends_with(".local.")
                            && types.insert(name.clone())
                        {
                            new_types.push(name);
                        }
                    }
                    ServiceEvent::ServiceResolved(info) => {
                        let mut identity = Identity::default();
                        identity.host(
                            clean(info.get_hostname().trim_end_matches('.')),
                            "mDNS hostname",
                            4,
                        );
                        let friendly = ["fn", "friendlyname", "friendly_name", "name"]
                            .into_iter()
                            .find_map(|key| info.get_property_val_str(key).and_then(clean));
                        if friendly.is_some() {
                            identity.device(friendly, "mDNS TXT", 4);
                        } else if display_service(&info.ty_domain) {
                            let suffix = format!(".{}", info.ty_domain);
                            let instance = info
                                .get_fullname()
                                .strip_suffix(&suffix)
                                .unwrap_or(info.get_fullname());
                            // RAOP instances can start with a MAC identifier; the portion after @ is the label.
                            let instance = if info.ty_domain == "_raop._tcp.local." {
                                instance.split_once('@').map_or(instance, |(_, name)| name)
                            } else {
                                instance
                            };
                            identity.device(clean(instance), "mDNS service name", 2);
                        }
                        identity.manufacturer(
                            ["manufacturer", "usb_mfg", "mfg"]
                                .into_iter()
                                .find_map(|key| info.get_property_val_str(key).and_then(clean)),
                            "mDNS TXT",
                            3,
                        );
                        let mut map = identities.lock().unwrap();
                        for ip in info.get_addresses_v4() {
                            if in_subnet(&adapter, ip) {
                                map.entry(ip).or_default().merge(&identity);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        for ty in new_types {
            if let Ok(receiver) = daemon.0.browse(&ty) {
                receivers.push(receiver);
            }
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }
    Ok(())
}

fn display_service(ty: &str) -> bool {
    // App/session IDs (remote desktop, Android debugging, streaming software, etc.)
    // are not device names. Still resolve their hostname and other explicit TXT fields.
    matches!(
        ty,
        "_http._tcp.local."
            | "_https._tcp.local."
            | "_ipp._tcp.local."
            | "_ipps._tcp.local."
            | "_printer._tcp.local."
            | "_pdl-datastream._tcp.local."
            | "_airplay._tcp.local."
            | "_raop._tcp.local."
            | "_sonos._tcp.local."
            | "_nmos-node._tcp.local."
    )
}

pub fn http_client(source: Ipv4Addr) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .no_proxy()
        .local_address(IpAddr::V4(source))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(1200))
        .timeout(Duration::from_secs(3))
        .user_agent("CTRLbot-Terminator/0.1 device-discovery")
        .build()
}

async fn bounded_get(client: &reqwest::Client, url: reqwest::Url) -> Option<String> {
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|size| size > 262_144)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > 262_144 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).ok()
}

/// A multicast response is not permission to fetch arbitrary remote or local URLs.
/// Accept only a literal IP matching that responder, with no credentials or redirects.
fn description_url(value: &str, responder: Ipv4Addr) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str()?.parse::<Ipv4Addr>().ok()? != responder
    {
        return None;
    }
    Some(url)
}

#[derive(serde::Deserialize, Default)]
struct DeviceXml {
    #[serde(rename = "friendlyName", default)]
    friendly_name: String,
    #[serde(default)]
    manufacturer: String,
}
#[derive(serde::Deserialize)]
struct RootXml {
    device: DeviceXml,
}

fn upnp_identity(xml: &str) -> Option<Identity> {
    let root: RootXml = quick_xml::de::from_str(xml).ok()?;
    let mut identity = Identity::default();
    identity.device(clean(&root.device.friendly_name), "UPnP friendly name", 5);
    identity.manufacturer(clean(&root.device.manufacturer), "UPnP manufacturer", 4);
    Some(identity)
}

fn multicast_socket(source: Ipv4Addr) -> std::io::Result<UdpSocket> {
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )?;
    socket.bind(&SocketAddr::from((source, 0)).into())?;
    socket.set_multicast_if_v4(&source)?;
    socket.set_multicast_ttl_v4(255)?;
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

pub async fn ssdp(
    adapter: ScanAdapter,
    identities: Identities,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let socket = multicast_socket(adapter.ipv4).map_err(|e| e.to_string())?;
    let client = http_client(adapter.ipv4).map_err(|e| e.to_string())?;
    for target in ["ssdp:all", "upnp:rootdevice"] {
        let query = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {target}\r\n\r\n");
        socket
            .send_to(query.as_bytes(), "239.255.255.250:1900")
            .await
            .map_err(|e| e.to_string())?;
    }
    let mut seen = HashSet::new();
    let mut requests = JoinSet::new();
    let mut buffer = [0u8; 8192];
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline && !cancel.load(Ordering::Relaxed) {
        while requests.try_join_next().is_some() {}
        let Ok(Ok((len, peer))) =
            timeout(Duration::from_millis(200), socket.recv_from(&mut buffer)).await
        else {
            continue;
        };
        let IpAddr::V4(ip) = peer.ip() else { continue };
        if !in_subnet(&adapter, ip) {
            continue;
        }
        let response = String::from_utf8_lossy(&buffer[..len]);
        if !response.starts_with("HTTP/1.1 200") {
            continue;
        }
        let location = response
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(key, _)| key.eq_ignore_ascii_case("location"))
            .map(|(_, value)| value.trim());
        let Some(url) = location.and_then(|value| description_url(value, ip)) else {
            continue;
        };
        if requests.len() >= 12 || seen.len() >= 256 || !seen.insert(url.to_string()) {
            continue;
        }
        let client = client.clone();
        let identities = identities.clone();
        requests.spawn(async move {
            if let Some(xml) = bounded_get(&client, url).await {
                if let Some(identity) = upnp_identity(&xml) {
                    identities
                        .lock()
                        .unwrap()
                        .entry(ip)
                        .or_default()
                        .merge(&identity);
                }
            }
        });
    }
    if cancel.load(Ordering::Relaxed) {
        requests.abort_all();
    }
    while requests.join_next().await.is_some() {}
    Ok(())
}

fn page_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after = lower[start..].find('>')? + start + 1;
    let end = lower[after..].find("</title>")? + after;
    let raw = html[after..end].trim();
    if raw.contains('<') || raw.len() > 512 {
        return None;
    }
    let value = quick_xml::escape::unescape(raw).ok()?;
    let value = clean(&value)?;
    if [
        "login",
        "log in",
        "sign in",
        "home",
        "index",
        "welcome",
        "web interface",
        "web management",
        "404 not found",
        "403 forbidden",
        "error",
        "untitled",
        "document",
    ]
    .contains(&value.to_ascii_lowercase().as_str())
    {
        return None;
    }
    Some(value)
}

pub async fn web_identity(client: &reqwest::Client, ip: Ipv4Addr, ports: &[u16]) -> Option<String> {
    for port in ports.iter().filter(|p| **p == 80 || **p == 8080) {
        let url = reqwest::Url::parse(&format!("http://{ip}:{port}/")).ok()?;
        if let Some(html) = bounded_get(client, url).await {
            if let Some(title) = page_title(&html) {
                return Some(title);
            }
        }
    }
    None
}

// Minimal bounded DNS wire parsing for mDNS reverse-PTR and NetBIOS node status.
fn word(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        data.get(offset..offset + 2)?.try_into().ok()?,
    ))
}
fn dns_name(data: &[u8], offset: &mut usize) -> Option<String> {
    let mut cursor = *offset;
    let mut jumped = false;
    let mut labels = Vec::new();
    for _ in 0..128 {
        let len = *data.get(cursor)? as usize;
        if len & 0xc0 == 0xc0 {
            let destination = ((len & 0x3f) << 8) | *data.get(cursor + 1)? as usize;
            if !jumped {
                *offset = cursor + 2;
                jumped = true;
            }
            cursor = destination;
        } else if len == 0 {
            if !jumped {
                *offset = cursor + 1;
            }
            return Some(labels.join("."));
        } else {
            if len > 63 {
                return None;
            }
            cursor += 1;
            labels.push(
                std::str::from_utf8(data.get(cursor..cursor + len)?)
                    .ok()?
                    .to_string(),
            );
            cursor += len;
            if !jumped {
                *offset = cursor;
            }
        }
    }
    None
}

fn answers(data: &[u8]) -> Option<Vec<(String, u16, usize, usize)>> {
    if word(data, 2)? & 0x800f != 0x8000 {
        return None;
    }
    let questions = word(data, 4)? as usize;
    let records = word(data, 6)? as usize + word(data, 8)? as usize + word(data, 10)? as usize;
    if questions > 64 || records > 256 {
        return None;
    }
    let mut offset = 12;
    for _ in 0..questions {
        dns_name(data, &mut offset)?;
        offset += 4;
    }
    let mut result = Vec::new();
    for _ in 0..records {
        let name = dns_name(data, &mut offset)?;
        let ty = word(data, offset)?;
        let len = word(data, offset + 8)? as usize;
        offset += 10;
        data.get(offset..offset + len)?;
        result.push((name, ty, offset, len));
        offset += len;
    }
    Some(result)
}

pub async fn reverse_mdns(source: Ipv4Addr, ip: Ipv4Addr) -> Option<String> {
    let socket = multicast_socket(source).ok()?;
    let octets = ip.octets();
    let name = format!(
        "{}.{}.{}.{}.in-addr.arpa",
        octets[3], octets[2], octets[1], octets[0]
    );
    // Legacy unicast query: ephemeral source port asks peers to reply directly.
    let mut query = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in name.split('.') {
        query.push(label.len() as u8);
        query.extend_from_slice(label.as_bytes());
    }
    query.extend_from_slice(&[0, 0, 12, 0, 1]);
    socket.send_to(&query, "224.0.0.251:5353").await.ok()?;
    let deadline = Instant::now() + Duration::from_millis(900);
    let mut buffer = [0u8; 8192];
    while Instant::now() < deadline {
        let (len, peer) = timeout(
            deadline.saturating_duration_since(Instant::now()),
            socket.recv_from(&mut buffer),
        )
        .await
        .ok()?
        .ok()?;
        if peer.ip() != IpAddr::V4(ip) || word(&buffer[..len], 0)? != 0 {
            continue;
        }
        if let Some(records) = answers(&buffer[..len]) {
            for (owner, ty, mut offset, length) in records {
                if ty == 12 && owner.eq_ignore_ascii_case(&name) {
                    let end = offset + length;
                    let host = dns_name(&buffer[..len], &mut offset)?;
                    if offset <= end && host.to_ascii_lowercase().ends_with(".local") {
                        return clean(&host);
                    }
                }
            }
        }
    }
    None
}

fn netbios_name(data: &[u8], id: u16) -> Option<String> {
    if word(data, 0)? != id {
        return None;
    }
    let mut server = None;
    for (_, ty, offset, length) in answers(data)? {
        if ty != 0x21 || length < 1 {
            continue;
        }
        let count = *data.get(offset)? as usize;
        if 1 + count * 18 > length {
            return None;
        }
        for index in 0..count {
            let start = offset + 1 + index * 18;
            let name = std::str::from_utf8(data.get(start..start + 15)?)
                .ok()?
                .trim();
            let suffix = *data.get(start + 15)?;
            let flags = word(data, start + 16)?;
            if flags & 0x8000 == 0 {
                if suffix == 0 {
                    return clean(name);
                }
                if suffix == 0x20 {
                    server = clean(name);
                }
            }
        }
    }
    server
}

pub async fn netbios(source: Ipv4Addr, ip: Ipv4Addr) -> Option<String> {
    let socket = UdpSocket::bind((source, 0)).await.ok()?;
    socket.connect((ip, 137)).await.ok()?;
    let id = socket.local_addr().ok()?.port();
    let mut query = vec![(id >> 8) as u8, id as u8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 32];
    for byte in std::iter::once(b'*').chain(std::iter::repeat_n(0, 15)) {
        query.push(b'A' + (byte >> 4));
        query.push(b'A' + (byte & 15));
    }
    query.extend_from_slice(&[0, 0, 0x21, 0, 1]);
    socket.send(&query).await.ok()?;
    let mut response = [0u8; 4096];
    let len = timeout(Duration::from_millis(900), socket.recv(&mut response))
        .await
        .ok()?
        .ok()?;
    netbios_name(&response[..len], id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn root_device_identity_does_not_mix_embedded_devices() {
        let result = upnp_identity(r#"<root xmlns="urn:schemas-upnp-org:device-1-0"><device><friendlyName>Living Room &amp; Kitchen</friendlyName><manufacturer>Sonos, Inc.</manufacturer><deviceList><device><friendlyName>Wrong embedded name</friendlyName><manufacturer>Other</manufacturer></device></deviceList></device></root>"#).unwrap();
        assert_eq!(result.device.as_deref(), Some("Living Room & Kitchen"));
        assert_eq!(result.manufacturer.as_deref(), Some("Sonos, Inc."));
    }
    #[test]
    fn descriptions_cannot_escape_the_responder() {
        let ip = "192.168.0.82".parse().unwrap();
        assert!(
            description_url("http://192.168.0.82:1400/xml/device_description.xml", ip).is_some()
        );
        for url in [
            "http://192.168.0.1/",
            "http://127.0.0.1/",
            "http://example.com/",
            "file:///C:/secret",
            "http://user:pass@192.168.0.82/",
        ] {
            assert!(description_url(url, ip).is_none());
        }
    }
    #[test]
    fn generic_titles_and_malformed_dns_are_not_names() {
        assert!(!display_service("_adb-tls-connect._tcp.local."));
        assert!(!display_service("_nvstream._tcp.local."));
        assert!(display_service("_ipp._tcp.local."));
        assert!(page_title("<title>Login</title>").is_none());
        assert_eq!(
            page_title("<TITLE>Atlona AT-OMNI-111</TITLE>").as_deref(),
            Some("Atlona AT-OMNI-111")
        );
        assert!(dns_name(&[0xc0, 0], &mut 0).is_none());
        assert!(answers(&[0; 5]).is_none());
        assert!(netbios_name(&[0; 30], 42).is_none());
    }
    #[test]
    fn reported_names_win_independent_of_arrival_order() {
        let mut a = Identity::default();
        a.device(Some("Web title".into()), "HTTP", 1);
        let mut b = Identity::default();
        b.device(Some("Office speaker".into()), "UPnP", 5);
        a.merge(&b);
        b.merge(&a);
        assert_eq!(a.device, b.device);
        assert_eq!(a.device.as_deref(), Some("Office speaker"));
    }
}
