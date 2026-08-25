import { useState } from "react";
import "./App.css";
import TcpServer from "./TcpServer";
import Serial from "./Serial";
import TcpClient from "./TcpClient";
import SshClient from "./SshClient";

function App() {
  const [activeTab, setActiveTab] = useState("tcp-server");

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-gray-800 p-4 flex flex-col border-r border-gray-700 shadow-xl z-10">
        <h1 className="text-xl font-bold mb-6 text-purple-400 border-b border-gray-700 pb-4">CTRLbot Term</h1>
        <nav className="flex flex-col space-y-2">
          <button
            onClick={() => setActiveTab("tcp-server")}
            className={`text-left px-4 py-2 rounded-md transition-colors ${
              activeTab === "tcp-server" ? "bg-purple-600 font-semibold" : "hover:bg-gray-700 text-gray-300"
            }`}
          >
            TCP Server
          </button>
          <button
            onClick={() => setActiveTab("tcp-client")}
            className={`text-left px-4 py-2 rounded-md transition-colors ${
              activeTab === "tcp-client" ? "bg-purple-600 font-semibold" : "hover:bg-gray-700 text-gray-300"
            }`}
          >
            Raw TCP (Telnet)
          </button>
          <button
            onClick={() => setActiveTab("serial")}
            className={`text-left px-4 py-2 rounded-md transition-colors ${
              activeTab === "serial" ? "bg-purple-600 font-semibold" : "hover:bg-gray-700 text-gray-300"
            }`}
          >
            Serial (COM)
          </button>
          <button
            onClick={() => setActiveTab("ssh")}
            className={`text-left px-4 py-2 rounded-md transition-colors ${
              activeTab === "ssh" ? "bg-purple-600 font-semibold" : "hover:bg-gray-700 text-gray-300"
            }`}
          >
            SSH Client
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-gray-900">
        {activeTab === "tcp-server" && <TcpServer />}
        {activeTab === "tcp-client" && <TcpClient />}
        {activeTab === "serial" && <Serial />}
        {activeTab === "ssh" && <SshClient />}
      </div>
    </div>
  );
}

export default App;
