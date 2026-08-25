import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ClientEvent {
  id: string;
  event_type: string;
  data: number[];
}

export default function SshClient() {
  const [host, setHost] = useState("192.168.1.10:22");
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState("");
  
  const [terminalOutput, setTerminalOutput] = useState<string>("");
  const [inputMessage, setInputMessage] = useState("");

  const terminalOutputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<ClientEvent>("ssh-event", (event) => {
        if (event.payload.id !== clientId) return;
        
        const { event_type, data } = event.payload;

        if (event_type === "data") {
          const text = new TextDecoder().decode(new Uint8Array(data));
          setTerminalOutput((prev) => prev + text);
        } else if (event_type === "disconnect") {
          setIsConnected(false);
          setTerminalOutput((prev) => prev + `\n\n[System] SSH Disconnected\n`);
        }
      });
    };

    if (isConnected && clientId) {
      setupListener();
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isConnected, clientId]);

  useEffect(() => {
    if (terminalOutputRef.current) terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
  }, [terminalOutput]);

  const toggleConnection = async () => {
    try {
      if (isConnected) {
        await invoke("disconnect_ssh", { id: clientId });
        setIsConnected(false);
        setTerminalOutput((prev) => prev + `\n[System] Closed connection\n`);
      } else {
        const newId = `ssh_${host}_${Date.now()}`;
        setClientId(newId);
        
        setTerminalOutput(`[System] Connecting to ${username}@${host}...\n`);
        
        await invoke("connect_ssh", { 
          id: newId,
          host,
          username,
          password: password || null
        });
        setIsConnected(true);
      }
    } catch (error) {
      console.error(error);
      setTerminalOutput((prev) => prev + `\n[Error] ${error}\n`);
    }
  };

  const handleSend = async () => {
    if (!inputMessage || !isConnected) return;
    try {
      const encoder = new TextEncoder();
      // SSH expects actual newlines/carriage returns for shell commands
      const parsedMessage = inputMessage + "\n";
      const payload = Array.from(encoder.encode(parsedMessage));

      await invoke("send_ssh_message", { id: clientId, message: payload });
      setInputMessage("");
    } catch (error) {
      console.error(error);
      setTerminalOutput((prev) => prev + `\n[Send Error] ${error}\n`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black text-gray-100 font-sans p-4">
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-800 p-3 rounded border border-gray-700">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Host:Port</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isConnected}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-48 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isConnected}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-32 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isConnected}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-32 text-sm"
          />
        </div>

        <div className="ml-auto flex items-end mt-4">
          <button
            onClick={toggleConnection}
            className={`px-6 py-1.5 rounded font-medium transition-colors ${
              isConnected ? "bg-red-600 hover:bg-red-700 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col border border-gray-700 rounded bg-gray-900 overflow-hidden">
        {/* Terminal Output */}
        <textarea
          ref={terminalOutputRef}
          readOnly
          value={terminalOutput}
          className="flex-1 bg-transparent p-4 text-green-500 font-mono text-sm focus:outline-none resize-none"
        ></textarea>
        
        {/* SSH Command Input */}
        <div className="flex items-center space-x-2 bg-gray-800 p-2 border-t border-gray-700">
          <span className="text-green-500 font-mono font-bold ml-2">{">"}</span>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder="Type command..."
            className="flex-1 bg-transparent text-white focus:outline-none font-mono disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
