import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface SerialEvent {
  port_name: string;
  event_type: string;
  data: number[];
}

export default function Serial() {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baudRate, setBaudRate] = useState("9600");
  const [isOpen, setIsOpen] = useState(false);
  
  const [receivedData, setReceivedData] = useState<string>("");
  const [sentData, setSentData] = useState<string>("");
  const [inputMessage, setInputMessage] = useState("");
  const [isHex, setIsHex] = useState(false);
  const [showHexReceived, setShowHexReceived] = useState(false);
  const [showVerboseCrLf, setShowVerboseCrLf] = useState(true);
  const [lineEnding, setLineEnding] = useState<"none" | "\\r" | "\\n" | "\\r\\n">("\\r\\n");

  const [dataBits, setDataBits] = useState("8");
  const [parity, setParity] = useState("none");
  const [flowControl, setFlowControl] = useState("none");

  const receivedDataRef = useRef<HTMLTextAreaElement>(null);
  const sentDataRef = useRef<HTMLTextAreaElement>(null);

  const showHexRef = useRef(showHexReceived);
  const showVerboseRef = useRef(showVerboseCrLf);
  
  useEffect(() => {
    showHexRef.current = showHexReceived;
    showVerboseRef.current = showVerboseCrLf;
  }, [showHexReceived, showVerboseCrLf]);

  const fetchPorts = async () => {
    try {
      const availablePorts = await invoke<string[]>("list_serial_ports");
      setPorts(availablePorts);
      if (availablePorts.length > 0 && !selectedPort) {
        setSelectedPort(availablePorts[0]);
      }
    } catch (e) {
      console.error("Failed to list ports", e);
    }
  };

  useEffect(() => {
    fetchPorts();
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<SerialEvent>("serial-event", (event) => {
        if (event.payload.port_name !== selectedPort) return;
        
        const { event_type, data } = event.payload;

        if (event_type === "data") {
          let formattedStr = "";
          if (showHexRef.current) {
            formattedStr = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') + ' ';
          } else {
            const text = new TextDecoder().decode(new Uint8Array(data));
            if (showVerboseRef.current) {
              formattedStr = text.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>\n");
            } else {
              formattedStr = text;
            }
          }
          setReceivedData((prev) => prev + formattedStr);
        }
      });
    };

    if (isOpen) {
      setupListener();
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, [isOpen, selectedPort]);

  useEffect(() => {
    if (receivedDataRef.current) receivedDataRef.current.scrollTop = receivedDataRef.current.scrollHeight;
  }, [receivedData]);

  useEffect(() => {
    if (sentDataRef.current) sentDataRef.current.scrollTop = sentDataRef.current.scrollHeight;
  }, [sentData]);

  const toggleConnection = async () => {
    if (!selectedPort) return;

    try {
      if (isOpen) {
        await invoke("close_serial_port", { portName: selectedPort });
        setIsOpen(false);
        setSentData((prev) => prev + `[System] Closed ${selectedPort}\n`);
      } else {
        await invoke("open_serial_port", { 
          portName: selectedPort, 
          baudRate: parseInt(baudRate),
          dataBits,
          parity,
          flowControl
        });
        setIsOpen(true);
        setSentData((prev) => prev + `[System] Opened ${selectedPort} at ${baudRate} baud\n`);
      }
    } catch (error) {
      console.error(error);
      setSentData((prev) => prev + `[Error] ${error}\n`);
    }
  };

  const handleSend = async () => {
    if (!inputMessage && lineEnding === "none") return;
    if (!isOpen) return;
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

      await invoke("send_serial_message", { portName: selectedPort, message: payload });
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
          <label className="text-xs text-gray-400 block mb-1">Port</label>
          <div className="flex space-x-2">
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={isOpen}
              className="bg-gray-700 border border-gray-600 text-white px-2 py-1 rounded focus:outline-none focus:border-purple-500 w-32 text-sm"
            >
              {ports.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button onClick={fetchPorts} disabled={isOpen} className="bg-gray-700 hover:bg-gray-600 px-2 rounded text-sm">↻</button>
          </div>
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Baud Rate</label>
          <select
            value={baudRate}
            onChange={(e) => setBaudRate(e.target.value)}
            disabled={isOpen}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-24 text-sm disabled:opacity-50"
          >
            {[9600, 19200, 38400, 57600, 115200].map(rate => (
              <option key={rate} value={rate}>{rate}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Data Size</label>
          <select
            value={dataBits}
            onChange={(e) => setDataBits(e.target.value)}
            disabled={isOpen}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-16 text-sm disabled:opacity-50"
          >
            <option value="7">7</option>
            <option value="8">8</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Parity</label>
          <select
            value={parity}
            onChange={(e) => setParity(e.target.value)}
            disabled={isOpen}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-20 text-sm disabled:opacity-50"
          >
            <option value="none">none</option>
            <option value="even">even</option>
            <option value="odd">odd</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Handshake</label>
          <select
            value={flowControl}
            onChange={(e) => setFlowControl(e.target.value)}
            disabled={isOpen}
            className="bg-gray-700 border border-gray-600 text-white px-3 py-1.5 rounded focus:outline-none focus:border-purple-500 w-28 text-sm disabled:opacity-50"
          >
            <option value="none">OFF</option>
            <option value="RTS/CTS">RTS/CTS</option>
            <option value="Xon/Xoff">Xon/Xoff</option>
          </select>
        </div>

        <div className="ml-auto flex items-end">
          <button
            onClick={toggleConnection}
            className={`px-6 py-1.5 rounded font-medium transition-colors ${
              isOpen ? "bg-red-600 hover:bg-red-700 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {isOpen ? "Close" : "Open"}
          </button>
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
          disabled={!isOpen}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono disabled:opacity-50"
        />
        
        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value as any)}
          disabled={!isOpen || isHex}
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
          disabled={!isOpen}
          className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-1.5 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}
