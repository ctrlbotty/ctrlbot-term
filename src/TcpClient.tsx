import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ClientEvent {
  id: string;
  event_type: string;
  data: string;
}

export default function TcpClient() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("23");
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState("");
  
  const [receivedData, setReceivedData] = useState<string>("");
  const [sentData, setSentData] = useState<string>("");
  const [inputMessage, setInputMessage] = useState("");
  const [isHex, setIsHex] = useState(false);
  const [showHexReceived, setShowHexReceived] = useState(false);
  const [showVerboseCrLf, setShowVerboseCrLf] = useState(true);
  const [lineEnding, setLineEnding] = useState<"none" | "\\r" | "\\n" | "\\r\\n">("\\r\\n");

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
      unlisten = await listen<ClientEvent>("client-event", (event) => {
        if (event.payload.id !== clientId) return;
        
        const { event_type, data } = event.payload;

        if (event_type === "data") {
          let formattedStr = "";
          if (showHexRef.current) {
            formattedStr = Array.from(data as unknown as number[]).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') + ' ';
          } else {
            const text = new TextDecoder().decode(new Uint8Array(data as unknown as number[]));
            if (showVerboseRef.current) {
              formattedStr = text.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>\n");
            } else {
              formattedStr = text;
            }
          }
          setReceivedData((prev) => prev + formattedStr);
        } else if (event_type === "disconnect") {
          setIsConnected(false);
          setSentData((prev) => prev + `[System] Disconnected from server\n`);
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
    if (receivedDataRef.current) receivedDataRef.current.scrollTop = receivedDataRef.current.scrollHeight;
  }, [receivedData]);

  useEffect(() => {
    if (sentDataRef.current) sentDataRef.current.scrollTop = sentDataRef.current.scrollHeight;
  }, [sentData]);

  const toggleConnection = async () => {
    try {
      if (isConnected) {
        await invoke("disconnect_tcp_client", { id: clientId });
        setIsConnected(false);
        setSentData((prev) => prev + `[System] Closed connection\n`);
      } else {
        const portNum = parseInt(port);
        if (isNaN(portNum)) return;
        
        const newId = `tcp_${host}_${port}_${Date.now()}`;
        setClientId(newId);
        
        await invoke("connect_tcp_client", { 
          id: newId,
          host,
          port: portNum 
        });
        setIsConnected(true);
        setSentData((prev) => prev + `[System] Connected to ${host}:${port}\n`);
      }
    } catch (error) {
      console.error(error);
      setSentData((prev) => prev + `[Error] ${error}\n`);
    }
  };

  const handleSend = async () => {
    if (!inputMessage && lineEnding === "none") return;
    if (!isConnected) return;
    try {
      let payload: number[] = [];
      let finalMessage = inputMessage;
      
      if (isHex) {
        const hexStr = inputMessage.replace(/[\s-]/g, "");
        for (let i = 0; i < hexStr.length; i += 2) {
          payload.push(parseInt(hexStr.substring(i, i + 2), 16));
        }
      } else {
        if (lineEnding === "\\r") finalMessage += "\r";
        else if (lineEnding === "\\n") finalMessage += "\n";
        else if (lineEnding === "\\r\\n") finalMessage += "\r\n";
        
        const encoder = new TextEncoder();
        const parsedMessage = finalMessage.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
        payload = Array.from(encoder.encode(parsedMessage));
      }

      await invoke("send_tcp_client_message", { id: clientId, message: payload });
      setSentData((prev) => prev + `[Sent] ${inputMessage}\n`);
      setInputMessage("");
    } catch (error) {
      console.error(error);
      setSentData((prev) => prev + `[Send Error] ${error}\n`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100 font-sans p-4">
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-800 p-3 rounded border border-gray-700">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Host / IP</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isConnected}
            placeholder="127.0.0.1"
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-40 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Port</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={isConnected}
            placeholder="3629"
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-24 text-sm"
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

      <div className="flex-1 grid grid-rows-2 gap-4">
        {/* Received Data */}
        <div className="flex flex-col border border-gray-700 rounded bg-gray-800/50">
          <div className="bg-gray-800 px-3 py-1 text-sm font-semibold border-b border-gray-700 rounded-t flex justify-between items-center">
            <span>Received Data (Raw TCP)</span>
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
          <div className="bg-gray-800 px-3 py-1 text-sm font-semibold border-b border-gray-700 rounded-t flex justify-between">
            <span>Sent Data / Logs</span>
            <button onClick={() => setSentData("")} className="text-xs text-gray-400 hover:text-white">Clear</button>
          </div>
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
          disabled={!isConnected}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono disabled:opacity-50"
        />
        
        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value as any)}
          disabled={!isConnected || isHex}
          className="bg-gray-700 border border-gray-600 text-gray-300 px-2 py-1.5 rounded focus:outline-none focus:border-purple-500 text-sm disabled:opacity-50"
        >
          <option value="none">None</option>
          <option value="\r">CR (\r)</option>
          <option value="\n">LF (\n)</option>
          <option value="\r\n">CRLF (\r\n)</option>
        </select>

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
          disabled={!isConnected}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-1.5 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
