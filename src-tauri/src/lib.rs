use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, broadcast, mpsc as tokio_mpsc};
use std::sync::mpsc as std_mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            connect_ssh, disconnect_ssh, send_ssh_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
