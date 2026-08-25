import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ServerEvent {
  port: number;
  event_type: string;
  client_id: string;
  data: number[];
}

export default function TcpServer() {
  const [port, setPort] = useState("3629");
  const [isRunning, setIsRunning] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [receivedData, setReceivedData] = useState<string>("");
  const [sentData, setSentData] = useState<string>("");
  const [inputMessage, setInputMessage] = useState("");
  const [isHex, setIsHex] = useState(false);
  const [showHexReceived, setShowHexReceived] = useState(false);
  const [showVerboseCrLf, setShowVerboseCrLf] = useState(true);

  const receivedDataRef = useRef<HTMLTextAreaElement>(null);
  const sentDataRef = useRef<HTMLTextAreaElement>(null);

  const showHexRef = useRef(showHexReceived);
  const showVerboseRef = useRef(showVerboseCrLf);

  useEffect(() => {
    showHexRef.current = showHexReceived;
    showVerboseRef.current = showVerboseCrLf;
  }, [showHexReceived, showVerboseCrLf]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<ServerEvent>("tcp-event", (event) => {
        if (event.payload.port.toString() !== port) return; // Ignore events from other ports
        
        const { event_type, client_id, data } = event.payload;

        if (event_type === "connect") {
          setClients((prev) => [...prev, client_id]);
          setSentData((prev) => prev + `[System] Client connected: ${client_id}\n`);
        } else if (event_type === "disconnect") {
          setClients((prev) => prev.filter((c) => c !== client_id));
          setSentData((prev) => prev + `[System] Client disconnected: ${client_id}\n`);
        } else if (event_type === "data") {
          let formattedStr = "";
          if (showHexRef.current) {
            formattedStr = (data as unknown as number[]).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') + ' ';
          } else {
            const text = new TextDecoder().decode(new Uint8Array(data as unknown as number[]));
            if (showVerboseRef.current) {
              formattedStr = text.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>\n");
            } else {
              formattedStr = text;
            }
          }
          setReceivedData((prev) => prev + `[${client_id}] ${formattedStr}`);
        }
      });
    };

    if (isRunning) {
      setupListener();
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isRunning, port]);

  // Auto-scroll
  useEffect(() => {
    if (receivedDataRef.current) receivedDataRef.current.scrollTop = receivedDataRef.current.scrollHeight;
  }, [receivedData]);

  useEffect(() => {
    if (sentDataRef.current) sentDataRef.current.scrollTop = sentDataRef.current.scrollHeight;
  }, [sentData]);

  const toggleServer = async () => {
    try {
      const portNum = parseInt(port);
      if (isNaN(portNum)) return;

      if (isRunning) {
        await invoke("stop_tcp_server", { port: portNum });
        setIsRunning(false);
        setClients([]);
        setSentData((prev) => prev + `[System] Server stopped on port ${portNum}\n`);
      } else {
        await invoke("start_tcp_server", { port: portNum });
        setIsRunning(true);
        setSentData((prev) => prev + `[System] Server listening on port ${portNum}\n`);
      }
    } catch (error) {
      console.error(error);
      setSentData((prev) => prev + `[Error] ${error}\n`);
    }
  };

  const handleSend = async () => {
    if (!inputMessage) return;
    try {
      const portNum = parseInt(port);
      let payload: number[] = [];
      
      if (isHex) {
        const hexStr = inputMessage.replace(/[\s-]/g, "");
        for (let i = 0; i < hexStr.length; i += 2) {
          payload.push(parseInt(hexStr.substring(i, i + 2), 16));
        }
      } else {
        const encoder = new TextEncoder();
        const parsedMessage = inputMessage.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
        payload = Array.from(encoder.encode(parsedMessage));
      }

      await invoke("send_tcp_message", { port: portNum, message: payload });
      setSentData((prev) => prev + `[Broadcast] ${inputMessage}\n`);
      setInputMessage("");
    } catch (error) {
      console.error(error);
      setSentData((prev) => prev + `[Send Error] ${error}\n`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100 font-sans p-4">
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4">
        <div>
          <label className="text-sm text-gray-400 block mb-1">Port</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={isRunning}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-24"
          />
        </div>
        <div className="mt-6">
          <button
            onClick={toggleServer}
            className={`px-6 py-1.5 rounded font-medium transition-colors ${
              isRunning ? "bg-red-600 hover:bg-red-700 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {isRunning ? "Stop" : "Listen"}
          </button>
        </div>
        <div className="mt-6 flex space-x-4 text-sm text-gray-400">
          <span>Status: {isRunning ? <span className="text-green-400">Listening</span> : "Stopped"}</span>
          <span>Clients: {clients.length}</span>
        </div>
      </div>

      <div className="flex-1 grid grid-rows-2 gap-4">
        {/* Received Data */}
        <div className="flex flex-col border border-gray-700 rounded bg-gray-800/50">
          <div className="bg-gray-800 px-3 py-1 text-sm font-semibold border-b border-gray-700 rounded-t flex justify-between items-center">
            <span>Received Data</span>
            <div className="flex space-x-4 items-center">
              <label className="flex items-center space-x-1 text-xs text-gray-300 font-normal cursor-pointer">
                <input type="checkbox" checked={showHexReceived} onChange={(e) => setShowHexReceived(e.target.checked)} className="rounded bg-gray-700 border-gray-600" />
                <span>HEX</span>
              </label>
              <label className="flex items-center space-x-1 text-xs text-gray-300 font-normal cursor-pointer">
                <input type="checkbox" checked={showVerboseCrLf} onChange={(e) => setShowVerboseCrLf(e.target.checked)} className="rounded bg-gray-700 border-gray-600" />
                <span>Verbose CRLF</span>
              </label>
              <button onClick={() => setReceivedData("")} className="text-xs text-gray-400 hover:text-white">Clear</button>
            </div>
          </div>
          <textarea
            ref={receivedDataRef}
            readOnly
            value={receivedData}
            className="flex-1 bg-transparent p-3 text-green-400 font-mono text-sm focus:outline-none resize-none"
          ></textarea>
        </div>

        {/* Sent Data */}
        <div className="flex flex-col border border-gray-700 rounded bg-gray-800/50">
          <div className="bg-gray-800 px-3 py-1 text-sm font-semibold border-b border-gray-700 rounded-t">Sent Data / Logs</div>
          <textarea
            ref={sentDataRef}
            readOnly
            value={sentData}
            className="flex-1 bg-transparent p-3 text-blue-300 font-mono text-sm focus:outline-none resize-none"
          ></textarea>
        </div>
      </div>

      {/* Send Controls */}
      <div className="mt-4 flex items-center space-x-3 bg-gray-800 p-3 rounded border border-gray-700">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message (use \r or \n for returns)..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono"
        />
        <label className="flex items-center space-x-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={isHex}
            onChange={(e) => setIsHex(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600 text-purple-600 focus:ring-purple-600"
          />
          <span>HEX</span>
        </label>
        <button
          onClick={handleSend}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-1.5 rounded font-medium transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
