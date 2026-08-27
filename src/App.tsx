import { useState } from "react";
import "./App.css";
import ctrlbotHeadIcon from "./assets/ic_ctrlbot_head.svg";
import TcpServer from "./TcpServer";
import Serial from "./Serial";
import TcpClient from "./TcpClient";
import SshClient from "./SshClient";

function App() {
  const [activeTab, setActiveTab] = useState("tcp-server");

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 p-4 flex flex-col border-r border-gray-800 shadow-xl z-10">
        <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
          <img src={ctrlbotHeadIcon} alt="CTRLbot" className="w-8 h-8 shrink-0" />
          <h1 className="brand-title text-lg font-bold text-white tracking-wider">CTRLbot Term</h1>
        </div>
        <nav className="flex flex-col space-y-2">
          <button
            onClick={() => setActiveTab("tcp-server")}
            className={`text-left px-4 py-2.5 rounded-md text-sm transition-colors cursor-pointer ${
              activeTab === "tcp-server"
                ? "bg-[#008FD4] text-white font-semibold shadow-md"
                : "text-gray-300 hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800]"
            }`}
          >
            TCP Server
          </button>
          <button
            onClick={() => setActiveTab("tcp-client")}
            className={`text-left px-4 py-2.5 rounded-md text-sm transition-colors cursor-pointer ${
              activeTab === "tcp-client"
                ? "bg-[#008FD4] text-white font-semibold shadow-md"
                : "text-gray-300 hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800]"
            }`}
          >
            Raw TCP (Telnet)
          </button>
          <button
            onClick={() => setActiveTab("serial")}
            className={`text-left px-4 py-2.5 rounded-md text-sm transition-colors cursor-pointer ${
              activeTab === "serial"
                ? "bg-[#008FD4] text-white font-semibold shadow-md"
                : "text-gray-300 hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800]"
            }`}
          >
            Serial (COM)
          </button>
          <button
            onClick={() => setActiveTab("ssh")}
            className={`text-left px-4 py-2.5 rounded-md text-sm transition-colors cursor-pointer ${
              activeTab === "ssh"
                ? "bg-[#008FD4] text-white font-semibold shadow-md"
                : "text-gray-300 hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800]"
            }`}
          >
            SSH Client
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-gray-950 overflow-hidden flex flex-col h-full">
        <div className={`h-full flex-col flex-1 ${activeTab === "tcp-server" ? "flex" : "hidden"}`}>
          <TcpServer />
        </div>
        <div className={`h-full flex-col flex-1 ${activeTab === "tcp-client" ? "flex" : "hidden"}`}>
          <TcpClient />
        </div>
        <div className={`h-full flex-col flex-1 ${activeTab === "serial" ? "flex" : "hidden"}`}>
          <Serial />
        </div>
        <div className={`h-full flex-col flex-1 ${activeTab === "ssh" ? "flex" : "hidden"}`}>
          <SshClient />
        </div>
      </div>
    </div>
  );
}

export default App;
