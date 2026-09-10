use std::collections::HashMap;
mod scan;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, broadcast, mpsc as tokio_mpsc};
use std::sync::mpsc as std_mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use ssh2::Session;
use std::io::{Read, Write};

struct AppState {
    servers: Arc<Mutex<HashMap<u16, tokio_mpsc::Sender<()>>>>,
    broadcasts: Arc<Mutex<HashMap<u16, broadcast::Sender<Vec<u8>>>>>,
    serial_ports: Arc<Mutex<HashMap<String, (std_mpsc::Sender<()>, std_mpsc::Sender<Vec<u8>>)>>>,
    tcp_clients: Arc<Mutex<HashMap<String, (tokio_mpsc::Sender<()>, tokio_mpsc::Sender<Vec<u8>>)>>>,
    ssh_clients: Arc<Mutex<HashMap<String, (std_mpsc::Sender<()>, std_mpsc::Sender<Vec<u8>>)>>>,
}

#[derive(Clone, serde::Serialize)]
struct ServerEvent {
    port: u16,
    event_type: String,
    client_id: String,
    data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
struct SerialEvent {
    port_name: String,
    event_type: String,
    data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
struct ClientEvent {
    id: String,
    event_type: String,
    data: Vec<u8>,
}

#[tauri::command]
async fn start_tcp_server(port: u16, app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    if servers.contains_key(&port) {
        return Err("Server already running on this port".to_string());
    }

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await.map_err(|e| e.to_string())?;
    
    let (shutdown_tx, mut shutdown_rx) = tokio_mpsc::channel(1);
    let (broadcast_tx, _) = broadcast::channel(16);
    
    servers.insert(port, shutdown_tx);
    state.broadcasts.lock().await.insert(port, broadcast_tx.clone());

    let app_handle_clone = app_handle.clone();
    
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                accept_result = listener.accept() => {
                    if let Ok((mut stream, addr)) = accept_result {
                        let client_id = addr.to_string();
                        let _ = app_handle_clone.emit("tcp-event", ServerEvent {
                            port,
                            event_type: "connect".to_string(),
                            client_id: client_id.clone(),
                            data: vec![],
                        });
                        
                        let mut rx = broadcast_tx.subscribe();
                        let app_handle_client = app_handle_clone.clone();
                        
                        tokio::spawn(async move {
                            let (mut reader, mut writer) = stream.split();
                            let mut buf = [0; 4096];
                            
                            loop {
                                tokio::select! {
                                    read_result = reader.read(&mut buf) => {
                                        match read_result {
                                            Ok(0) => break,
                                            Ok(n) => {
                                                let data = buf[..n].to_vec();
                                                let _ = app_handle_client.emit("tcp-event", ServerEvent {
                                                    port,
                                                    event_type: "data".to_string(),
                                                    client_id: client_id.clone(),
                                                    data,
                                                });
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                    recv_result = rx.recv() => {
                                        if let Ok(msg) = recv_result {
                                            let _ = writer.write_all(&msg).await;
                                        } else {
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            let _ = app_handle_client.emit("tcp-event", ServerEvent {
                                port,
                                event_type: "disconnect".to_string(),
                                client_id: client_id.clone(),
                                data: vec![],
                            });
                        });
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_tcp_server(port: u16, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut servers = state.servers.lock().await;
    if let Some(tx) = servers.remove(&port) {
        let _ = tx.send(()).await;
        state.broadcasts.lock().await.remove(&port);
        Ok(())
    } else {
        Err("Server not running".to_string())
    }
}

#[tauri::command]
async fn send_tcp_message(port: u16, message: Vec<u8>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let broadcasts = state.broadcasts.lock().await;
    if let Some(tx) = broadcasts.get(&port) {
        let _ = tx.send(message);
        Ok(())
    } else {
        Err("Server not running".to_string())
    }
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_serial_port(
    port_name: String, 
    baud_rate: u32, 
    data_bits: String, 
    parity: String, 
    flow_control: String, 
    app_handle: AppHandle, 
    state: tauri::State<'_, AppState>
) -> Result<(), String> {
    let mut ports_map = state.serial_ports.lock().await;
    if ports_map.contains_key(&port_name) {
        return Err("Port already open".to_string());
    }

    let d_bits = match data_bits.as_str() {
        "7" => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };

    let p = match parity.as_str() {
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };

    let fc = match flow_control.as_str() {
        "hardware" | "RTS/CTS" => serialport::FlowControl::Hardware,
        "software" | "Xon/Xoff" => serialport::FlowControl::Software,
        _ => serialport::FlowControl::None,
    };

    let port = serialport::new(&port_name, baud_rate)
        .data_bits(d_bits)
        .parity(p)
        .flow_control(fc)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| e.to_string())?;
        
    let mut read_port = port.try_clone().map_err(|e| e.to_string())?;
    let mut write_port = port;

    let (stop_tx, stop_rx) = std_mpsc::channel();
    let (write_tx, write_rx) = std_mpsc::channel::<Vec<u8>>();
    
    ports_map.insert(port_name.clone(), (stop_tx, write_tx));

    let port_name_clone = port_name.clone();
    let app_handle_clone = app_handle.clone();
    
    // Read thread
    thread::spawn(move || {
        let mut buf: Vec<u8> = vec![0; 4096];
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match read_port.read(buf.as_mut_slice()) {
                Ok(t) if t > 0 => {
                    let data = buf[..t].to_vec();
                    let _ = app_handle_clone.emit("serial-event", SerialEvent {
                        port_name: port_name_clone.clone(),
                        event_type: "data".to_string(),
                        data,
                    });
                }
                _ => {}
            }
        }
    });

    // Write thread
    thread::spawn(move || {
        loop {
            match write_rx.recv() {
                Ok(data) => {
                    let _ = write_port.write_all(&data);
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn close_serial_port(port_name: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut ports_map = state.serial_ports.lock().await;
    if let Some((stop_tx, _)) = ports_map.remove(&port_name) {
        let _ = stop_tx.send(());
        Ok(())
    } else {
        Err("Port not open".to_string())
    }
}

#[tauri::command]
async fn send_serial_message(port_name: String, message: Vec<u8>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let ports_map = state.serial_ports.lock().await;
    if let Some((_, write_tx)) = ports_map.get(&port_name) {
        write_tx.send(message).map_err(|e| e.to_string())
    } else {
        Err("Port not open".to_string())
    }
}

#[tauri::command]
async fn connect_tcp_client(id: String, host: String, port: u16, app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut clients = state.tcp_clients.lock().await;
    if clients.contains_key(&id) {
        return Err("Client ID already in use".to_string());
    }

    let stream = tokio::net::TcpStream::connect(format!("{}:{}", host, port)).await.map_err(|e| e.to_string())?;
    
    let (stop_tx, mut stop_rx) = tokio_mpsc::channel(1);
    let (write_tx, mut write_rx) = tokio_mpsc::channel::<Vec<u8>>(16);
    
    clients.insert(id.clone(), (stop_tx, write_tx));
    let id_clone = id.clone();
    let app_handle_clone = app_handle.clone();
    
    tokio::spawn(async move {
        let (mut reader, mut writer) = stream.into_split();
        let mut buf = [0; 4096];
        
        loop {
            tokio::select! {
                _ = stop_rx.recv() => {
                    break;
                }
                read_result = reader.read(&mut buf) => {
                    match read_result {
                        Ok(0) => break,
                        Ok(n) => {
                            let data = buf[..n].to_vec();
                            let _ = app_handle_clone.emit("client-event", ClientEvent {
                                id: id_clone.clone(),
                                event_type: "data".to_string(),
                                data,
                            });
                        }
                        Err(_) => break,
                    }
                }
                recv_result = write_rx.recv() => {
                    if let Some(msg) = recv_result {
                        let _ = writer.write_all(&msg).await;
                    } else {
                        break;
                    }
                }
            }
        }
        
        let _ = app_handle_clone.emit("client-event", ClientEvent {
            id: id_clone.clone(),
            event_type: "disconnect".to_string(),
            data: vec![],
        });
    });

    Ok(())
}

#[tauri::command]
async fn disconnect_tcp_client(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut clients = state.tcp_clients.lock().await;
    if let Some((stop_tx, _)) = clients.remove(&id) {
        let _ = stop_tx.send(()).await;
        Ok(())
    } else {
        Err("Client not connected".to_string())
    }
}

#[tauri::command]
async fn send_tcp_client_message(id: String, message: Vec<u8>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let clients = state.tcp_clients.lock().await;
    if let Some((_, write_tx)) = clients.get(&id) {
        write_tx.send(message).await.map_err(|e| e.to_string())
    } else {
        Err("Client not connected".to_string())
    }
}

#[tauri::command]
async fn connect_ssh(id: String, host: String, username: String, password: Option<String>, app_handle: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut ssh_map = state.ssh_clients.lock().await;
    if ssh_map.contains_key(&id) {
        return Err("Session ID already active".to_string());
    }

    let tcp = std::net::TcpStream::connect(host).map_err(|e| e.to_string())?;
    let mut sess = Session::new().unwrap();
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| e.to_string())?;

    if let Some(pw) = password {
        sess.userauth_password(&username, &pw).map_err(|e| e.to_string())?;
    } else {
        return Err("Key auth not implemented".to_string());
    }

    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.request_pty("xterm", None, None).map_err(|e| e.to_string())?;
    channel.shell().map_err(|e| e.to_string())?;

    let (stop_tx, stop_rx) = std_mpsc::channel();
    let (write_tx, write_rx) = std_mpsc::channel::<Vec<u8>>();
    ssh_map.insert(id.clone(), (stop_tx, write_tx));

    let id_clone = id.clone();
    let app_handle_clone = app_handle.clone();

    thread::spawn(move || {
        let mut buf = vec![0; 4096];
        channel.stream(0);
        
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            
            while let Ok(msg) = write_rx.try_recv() {
                let _ = channel.write_all(&msg);
            }
            
            sess.set_blocking(false);
            match channel.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let data = buf[..n].to_vec();
                    let _ = app_handle_clone.emit("ssh-event", ClientEvent {
                        id: id_clone.clone(),
                        event_type: "data".to_string(),
                        data,
                    });
                }
                Ok(0) => break, 
                _ => {
                    thread::sleep(Duration::from_millis(10));
                }
            }
        }
        
        let _ = channel.close();
        let _ = sess.disconnect(None, "Disconnect", None);
        
        let _ = app_handle_clone.emit("ssh-event", ClientEvent {
            id: id_clone.clone(),
            event_type: "disconnect".to_string(),
            data: vec![],
        });
    });

    Ok(())
}

#[tauri::command]
async fn disconnect_ssh(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut clients = state.ssh_clients.lock().await;
    if let Some((stop_tx, _)) = clients.remove(&id) {
        let _ = stop_tx.send(());
        Ok(())
    } else {
        Err("SSH not connected".to_string())
    }
}

#[tauri::command]
async fn send_ssh_message(id: String, message: Vec<u8>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let clients = state.ssh_clients.lock().await;
    if let Some((_, write_tx)) = clients.get(&id) {
        write_tx.send(message).map_err(|e| e.to_string())
    } else {
        Err("SSH not connected".to_string())
    }
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct NetworkAdapter {
    pub name: String,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub subnet_mask: Option<String>,
    pub default_gateway: Option<String>,
    pub dns_suffix: Option<String>,
    pub media_state: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct NetworkInfo {
    pub primary_ip: String,
    pub is_online: bool,
    pub raw_ipconfig: String,
    pub adapters: Vec<NetworkAdapter>,
    pub active_adapter: Option<NetworkAdapter>,
}

fn get_primary_ip_via_udp() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").or_else(|_| socket.connect("1.1.1.1:80")).ok()?;
    let local_ip = socket.local_addr().ok()?.ip();
    if !local_ip.is_loopback() && !local_ip.is_unspecified() {
        Some(local_ip.to_string())
    } else {
        None
    }
}

fn run_ipconfig_cmd() -> String {
    let mut cmd = std::process::Command::new("ipconfig");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
        Err(e) => format!("Failed to execute ipconfig: {}", e),
    }
}

fn parse_ipconfig_output(raw: &str) -> Vec<NetworkAdapter> {
    let mut adapters = Vec::new();
    let mut current_adapter: Option<NetworkAdapter> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Adapter headers in ipconfig typically look like: "Ethernet adapter Ethernet 3:" or "Wireless LAN adapter Wi-Fi 2:"
        if (line.starts_with("Ethernet adapter") 
            || line.starts_with("Wireless LAN adapter") 
            || (line.ends_with(':') && !line.contains(". ."))) 
            && !line.contains(". .") 
            && !trimmed.starts_with("Windows IP Configuration") 
        {
            if let Some(adapter) = current_adapter.take() {
                adapters.push(adapter);
            }
            let name = trimmed.trim_end_matches(':').to_string();
            current_adapter = Some(NetworkAdapter {
                name,
                ipv4: None,
                ipv6: None,
                subnet_mask: None,
                default_gateway: None,
                dns_suffix: None,
                media_state: None,
            });
            continue;
        }

        if let Some(ref mut adapter) = current_adapter {
            if let Some(idx) = trimmed.find(':') {
                let key_part = trimmed[..idx].trim_matches(|c| c == '.' || c == ' ').to_lowercase();
                let val_part = trimmed[idx + 1..].trim().to_string();

                if !val_part.is_empty() {
                    if key_part.contains("ipv4") || key_part == "ip address" {
                        let ip = val_part.split('(').next().unwrap_or(&val_part).trim().to_string();
                        adapter.ipv4 = Some(ip);
                    } else if key_part.contains("ipv6") {
                        let ip = val_part.split('(').next().unwrap_or(&val_part).trim().to_string();
                        adapter.ipv6 = Some(ip);
                    } else if key_part.contains("subnet mask") {
                        adapter.subnet_mask = Some(val_part);
                    } else if key_part.contains("default gateway") {
                        adapter.default_gateway = Some(val_part);
                    } else if key_part.contains("dns suffix") {
                        adapter.dns_suffix = Some(val_part);
                    } else if key_part.contains("media state") {
                        adapter.media_state = Some(val_part);
                    }
                }
            }
        }
    }

    if let Some(adapter) = current_adapter {
        adapters.push(adapter);
    }

    adapters
}

#[tauri::command]
async fn get_network_info() -> Result<NetworkInfo, String> {
    let raw_ipconfig = run_ipconfig_cmd();
    let adapters = parse_ipconfig_output(&raw_ipconfig);

    let udp_ip = get_primary_ip_via_udp();

    // Determine active adapter & primary IP
    let mut active_adapter = None;
    let mut primary_ip = String::new();

    if let Some(ref ip) = udp_ip {
        primary_ip = ip.clone();
        for adapter in &adapters {
            if adapter.ipv4.as_deref() == Some(ip.as_str()) {
                active_adapter = Some(adapter.clone());
                break;
            }
        }
    }

    if active_adapter.is_none() {
        // Fallback: look for adapter with default gateway and IPv4
        for adapter in &adapters {
            if adapter.ipv4.is_some() && adapter.default_gateway.is_some() {
                active_adapter = Some(adapter.clone());
                if primary_ip.is_empty() {
                    primary_ip = adapter.ipv4.clone().unwrap();
                }
                break;
            }
        }
    }

    if active_adapter.is_none() {
        // Fallback: any adapter with IPv4
        for adapter in &adapters {
            if let Some(ref ip) = adapter.ipv4 {
                active_adapter = Some(adapter.clone());
                if primary_ip.is_empty() {
                    primary_ip = ip.clone();
                }
                break;
            }
        }
    }

    if primary_ip.is_empty() {
        primary_ip = "Offline".to_string();
    }

    let is_online = primary_ip != "Offline" && primary_ip != "127.0.0.1" && primary_ip != "0.0.0.0";

    Ok(NetworkInfo {
        primary_ip,
        is_online,
        raw_ipconfig,
        adapters,
        active_adapter,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(scan::ScanState::default())
        .manage(AppState {
            servers: Arc::new(Mutex::new(HashMap::new())),
            broadcasts: Arc::new(Mutex::new(HashMap::new())),
            serial_ports: Arc::new(Mutex::new(HashMap::new())),
            tcp_clients: Arc::new(Mutex::new(HashMap::new())),
            ssh_clients: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            start_tcp_server, stop_tcp_server, send_tcp_message,
            list_serial_ports, open_serial_port, close_serial_port, send_serial_message,
            connect_tcp_client, disconnect_tcp_client, send_tcp_client_message,
            connect_ssh, disconnect_ssh, send_ssh_message,
            get_network_info,
            scan::list_scan_adapters, scan::start_scan, scan::stop_scan, scan::get_scan_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ipconfig() {
        let sample = r#"
Windows IP Configuration

Ethernet adapter Ethernet 3:

   Connection-specific DNS Suffix  . : localdomain
   Link-local IPv6 Address . . . . . : fe80::3f64:b60d:3498:f960%25
   IPv4 Address. . . . . . . . . . . : 192.168.56.1
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 

Wireless LAN adapter Wi-Fi 2:

   Connection-specific DNS Suffix  . : 
   Link-local IPv6 Address . . . . . : fe80::10ad:9c0:c5b9:bd9c%24
   IPv4 Address. . . . . . . . . . . : 192.168.0.109
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.0.1

Ethernet adapter Bluetooth Network Connection 2:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . : 
"#;
        let adapters = parse_ipconfig_output(sample);
        assert_eq!(adapters.len(), 3);
        assert_eq!(adapters[0].name, "Ethernet adapter Ethernet 3");
        assert_eq!(adapters[0].ipv4.as_deref(), Some("192.168.56.1"));
        assert_eq!(adapters[1].name, "Wireless LAN adapter Wi-Fi 2");
        assert_eq!(adapters[1].ipv4.as_deref(), Some("192.168.0.109"));
        assert_eq!(adapters[1].default_gateway.as_deref(), Some("192.168.0.1"));
        assert_eq!(adapters[1].subnet_mask.as_deref(), Some("255.255.255.0"));
        assert_eq!(adapters[2].media_state.as_deref(), Some("Media disconnected"));
    }
}


