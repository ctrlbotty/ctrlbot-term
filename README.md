# CTRLbot Term

**CTRLbot Term** is a modern, lightweight, and blazing-fast terminal and networking suite built specifically for testing IoT devices, raw socket communication, and serial interfaces. 

Developed as a modern alternative to legacy tools like PuTTY and Hercules, CTRLbot Term is powered by a **Rust** backend (via [Tauri](https://tauri.app/)) for native OS-level hardware access, and a **React + Tailwind CSS** frontend for a beautiful, responsive user interface.

![CTRLbot Term Screenshot](src-tauri/icons/128x128.png) <!-- Note: Replace with actual UI screenshot if desired -->

## Features

CTRLbot Term combines the most critical networking and hardware diagnostic tools into one unified application:

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

## Development Setup

To run or build CTRLbot Term from source, you will need **Node.js** and **Rust** installed on your machine. 

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
To compile the application into a standalone installer (`.exe` and `.msi`):

```bash
npm run tauri build
```

The compiled installers will be located in:
`src-tauri/target/release/bundle/`

## Tech Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS v4.
- **Backend:** Rust, Tokio (Async Networking), `serialport` crate, `ssh2` crate.
- **Framework:** Tauri v2.

## License
MIT License
