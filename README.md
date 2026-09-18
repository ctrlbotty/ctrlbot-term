# CTRLbot Terminator

**CTRLbot Terminator** is a modern, lightweight, and blazing-fast terminal and networking suite built specifically for testing IoT devices, raw socket communication, and serial interfaces. 

Developed as a modern alternative to legacy tools like PuTTY and Hercules, CTRLbot Terminator is powered by a **Rust** backend (via [Tauri](https://tauri.app/)) for native OS-level hardware access, and a **React + Tailwind CSS** frontend for a beautiful, responsive user interface.

![CTRLbot Terminator Screenshot](src-tauri/icons/128x128.png) <!-- Note: Replace with actual UI screenshot if desired -->

## Features

CTRLbot Terminator combines the most critical networking and hardware diagnostic tools into one unified application:

### 1. TCP Server
- Spin up a local TCP server on any port instantly.
- Accept and manage multiple simultaneous client connections.
- Broadcast messages to all connected clients or view incoming data with full connection lifecycles.

### 2. Raw TCP (Telnet) Client
- Connect directly to raw sockets or Telnet interfaces on your network.
- **Troubleshooting First:** Toggle `Verbose CRLF` to explicitly see `<CR>` and `<LF>` tags in the data stream, or toggle `HEX` to view incoming byte streams in pure hexadecimal format.
- Send plaintext or HEX arrays, with customizable line-endings (`None`, `\r`, `\n`, `\r\n`).

### 3. Serial (COM) Port Manager
- Automatically discovers and lists available COM ports.
- Supports comprehensive baud rates (9600 to 115200) and configuration:
  - **Data Size:** 7 or 8 bits.
  - **Parity:** None, Even, Odd.
  - **Handshake (Flow Control):** OFF, RTS/CTS (Hardware), Xon/Xoff (Software).
- Split-log view to monitor TX/RX streams with the same HEX/Verbose visualization tools available in the TCP Client.

### 4. SSH Client
- Authenticate and connect to remote devices via SSH (Port 22).
- True terminal-emulation rendering (powered by `libssh2`) to interact with remote shells safely and securely.

### 5. Scan (Windows)
- Select a connected network port (Ethernet, Wi-Fi, or a virtual adapter); its IPv4 subnet is detected automatically.
- Active ARP discovery finds local devices even when they block ping or have no web service. Ping and TCP probes provide fallbacks.
- Separate Host Name, Device Name, and Manufacturer columns use mDNS hostname/service/TXT discovery, reverse mDNS PTR, SSDP/UPnP descriptions, NetBIOS, and Windows name resolution. Useful HTTP page titles are a lower-priority device-name fallback; generic titles and opaque application service IDs are not used as names.
- Manufacturer uses explicit UPnP/mDNS data where provided and the bundled IEEE MAC registry otherwise. Locally administered/randomized MACs are not assigned a guessed vendor. Hover over values to inspect their source and MAC vendor. Missing data stays blank.
- MAC lookup works offline using MA-L, MA-M, MA-S, and IAB assignments. Run `./scripts/update-mac-vendors.ps1` before rebuilding to refresh the public IEEE data; no device MACs are sent to a lookup service.
- Results include links for open TCP ports 80, 443, 8080, and 8443 using their conventional HTTP/HTTPS schemes. Results stay available when switching tabs and can be filtered by names, manufacturer, IP, or MAC. Stop retains partial results.
- Scans cover the selected adapter's entire IPv4 subnet, supporting /16 through /32. Larger networks are explicitly refused rather than silently truncated. IPv6 and driver matching are not included.

## Development Setup

To run or build CTRLbot Terminator from source, you will need **Node.js** and **Rust** installed on your machine. 

### Prerequisites (Windows)
1. Install [Node.js](https://nodejs.org/)
2. Install [Rust & Cargo](https://rustup.rs/)
3. Install **Visual Studio C++ Build Tools** (Required for compiling the native C-bindings used by the SSH client).

### Running Locally
Clone the repository and install the frontend dependencies:

```bash
git clone https://github.com/ctrlbotty/ctrlbot-term.git
cd "CTRLbot Term"
npm install
```

Start the development server (this will automatically launch the desktop app with hot-reloading):

```bash
npm run tauri dev
```

### Building for Production
To build the Windows x64 Setup installer and portable application:

```bash
npm run bundle
```

The `installers/` folder contains clearly named downloads, following CTRLbot Mirror's naming:

- `CTRLbot Terminator-Setup-<version>.exe`: full installation, including shortcuts and uninstaller (recommended).
- `CTRLbot Terminator-<version>-portable.exe`: run directly without installing the application. Requires the Microsoft Edge WebView2 Runtime to already be installed; settings use the Windows user profile and are shared with the installed app.

The build regenerates CTRLbot-branded setup artwork, collects only the current version, and moves older downloads into `installers/archive/`. `installers/README.txt` explains each download.

## Tech Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS v4.
- **Backend:** Rust, Tokio (Async Networking), `serialport` crate, `ssh2` crate.
- **Framework:** Tauri v2.

## License
MIT License
