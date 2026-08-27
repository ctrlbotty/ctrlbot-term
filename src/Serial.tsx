import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface SerialEvent {
  port_name: string;
  event_type: string;
  data: number[];
}

interface TabItem {
  id: string;
  portName: string;
  baudRate: string;
  isOpen: boolean;
}

function SerialInstance({
  id,
  isVisible,
  onUpdateStatus,
}: {
  id: string;
  isVisible: boolean;
  onUpdateStatus: (id: string, isOpen: boolean, portName: string, baudRate: string) => void;
}) {
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

  useEffect(() => {
    onUpdateStatus(id, isOpen, selectedPort, baudRate);
  }, [id, isOpen, selectedPort, baudRate]);

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

  // Cleanup on unmount if open
  useEffect(() => {
    return () => {
      if (isOpen && selectedPort) {
        invoke("close_serial_port", { portName: selectedPort }).catch(console.error);
      }
    };
  }, [isOpen, selectedPort]);

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
    <div className={`flex-col flex-1 h-full p-4 overflow-hidden ${isVisible ? "flex" : "hidden"}`}>
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-900 p-3 rounded-lg border border-gray-800 shrink-0">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Port</label>
          <div className="flex space-x-2">
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={isOpen}
              className="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-32 text-xs"
            >
              {ports.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button onClick={fetchPorts} disabled={isOpen} className="bg-gray-800 hover:bg-[#FFCC00] hover:text-black px-2.5 py-1 rounded text-xs border border-gray-700 transition-colors cursor-pointer">↻</button>
          </div>
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Baud Rate</label>
          <select
            value={baudRate}
            onChange={(e) => setBaudRate(e.target.value)}
            disabled={isOpen}
            className="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-24 text-xs disabled:opacity-50"
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
            className="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-16 text-xs disabled:opacity-50"
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
            className="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-20 text-xs disabled:opacity-50"
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
            className="bg-gray-800 border border-gray-700 text-white px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-24 text-xs disabled:opacity-50"
          >
            <option value="none">OFF</option>
            <option value="RTS/CTS">RTS/CTS</option>
            <option value="Xon/Xoff">Xon/Xoff</option>
          </select>
        </div>

        <div className="ml-auto flex items-end">
          <button
            onClick={toggleConnection}
            className={`px-6 py-1.5 rounded text-sm font-semibold transition-colors cursor-pointer ${
              isOpen
                ? "bg-red-600 hover:bg-red-700 text-white shadow-md"
                : "bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white shadow-md"
            }`}
          >
            {isOpen ? "Close" : "Open"}
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-rows-2 gap-4 min-h-0">
        {/* Received Data */}
        <div className="flex flex-col border border-gray-800 rounded-lg bg-gray-900/60 overflow-hidden">
          <div className="bg-gray-900 px-3 py-1.5 text-xs font-semibold border-b border-gray-800 flex justify-between items-center text-gray-200 shrink-0">
            <span>Received Data</span>
            <div className="flex space-x-4 items-center">
              <label className="flex items-center space-x-1.5 text-xs text-gray-300 font-normal cursor-pointer hover:text-white">
                <input type="checkbox" checked={showHexReceived} onChange={(e) => setShowHexReceived(e.target.checked)} className="rounded bg-gray-800 border-gray-700 accent-[#008FD4]" />
                <span>HEX</span>
              </label>
              <label className="flex items-center space-x-1.5 text-xs text-gray-300 font-normal cursor-pointer hover:text-white">
                <input type="checkbox" checked={showVerboseCrLf} onChange={(e) => setShowVerboseCrLf(e.target.checked)} className="rounded bg-gray-800 border-gray-700 accent-[#008FD4]" />
                <span>Verbose CRLF</span>
              </label>
              <button onClick={() => setReceivedData("")} className="text-xs text-gray-400 hover:text-[#FFCC00] cursor-pointer">Clear</button>
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
        <div className="flex flex-col border border-gray-800 rounded-lg bg-gray-900/60 overflow-hidden">
          <div className="bg-gray-900 px-3 py-1.5 text-xs font-semibold border-b border-gray-800 flex justify-between items-center text-gray-200 shrink-0">
            <span>Sent Data / Logs</span>
            <button onClick={() => setSentData("")} className="text-xs text-gray-400 hover:text-[#FFCC00] cursor-pointer">Clear</button>
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
      <div className="mt-4 flex items-center space-x-3 bg-gray-900 p-3 rounded-lg border border-gray-800 shrink-0">
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={!isOpen}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono text-sm disabled:opacity-50"
        />
        
        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value as any)}
          disabled={!isOpen || isHex}
          className="bg-gray-800 border border-gray-700 text-gray-300 px-2 py-1.5 rounded focus:outline-none focus:border-[#008FD4] text-xs disabled:opacity-50"
        >
          <option value="none">None</option>
          <option value="\r">CR (\r)</option>
          <option value="\n">LF (\n)</option>
          <option value="\r\n">CRLF (\r\n)</option>
        </select>

        <label className="flex items-center space-x-1.5 text-xs text-gray-300 cursor-pointer hover:text-white">
          <input
            type="checkbox"
            checked={isHex}
            onChange={(e) => setIsHex(e.target.checked)}
            className="rounded bg-gray-800 border-gray-700 accent-[#008FD4]"
          />
          <span>HEX</span>
        </label>
        <button
          onClick={handleSend}
          disabled={!isOpen}
          className="bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white px-6 py-1.5 rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function Serial() {
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: "ser_1", portName: "", baudRate: "9600", isOpen: false }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("ser_1");

  const handleAddTab = () => {
    const newId = `ser_${Date.now()}`;
    const newTab: TabItem = {
      id: newId,
      portName: "",
      baudRate: "9600",
      isOpen: false
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      const newId = `ser_${Date.now()}`;
      setTabs([{ id: newId, portName: "", baudRate: "9600", isOpen: false }]);
      setActiveTabId(newId);
      return;
    }

    const remaining = tabs.filter(t => t.id !== idToClose);
    setTabs(remaining);

    if (activeTabId === idToClose) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  const handleUpdateStatus = (id: string, isOpen: boolean, portName: string, baudRate: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isOpen, portName, baudRate } : t))
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      {/* Top Instance Tab Bar */}
      <div className="bg-gray-900/90 border-b border-gray-800 px-4 pt-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const label = tab.portName ? `${tab.portName} (${tab.baudRate})` : `Serial ${idx + 1}`;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`px-3.5 py-1.5 rounded-t-md text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer border-t border-x ${
                isActive
                  ? "bg-[#008FD4] text-white border-[#008FD4] shadow"
                  : "bg-gray-950 text-gray-400 border-gray-800 hover:bg-[#FFCC00] hover:text-black hover:border-gray-700"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  tab.isOpen ? "bg-green-400 shadow-sm" : "bg-gray-500"
                }`}
              />
              <span>{label}</span>
              <span
                onClick={(e) => handleCloseTab(tab.id, e)}
                title="Close Tab"
                className={`ml-1 rounded px-1 text-[11px] font-bold ${
                  isActive
                    ? "hover:bg-red-600 text-white/80 hover:text-white"
                    : "hover:bg-red-600 hover:text-white"
                }`}
              >
                ✕
              </span>
            </button>
          );
        })}

        <button
          onClick={handleAddTab}
          title="Add New Serial Port"
          className="bg-gray-800 hover:bg-[#FFCC00] hover:text-black text-gray-200 px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 border border-gray-700 ml-1 shadow-sm"
        >
          <span>+</span>
          <span className="hidden sm:inline text-[11px]">New</span>
        </button>
      </div>

      {/* Instances Containers */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tabs.map((tab) => (
          <SerialInstance
            key={tab.id}
            id={tab.id}
            isVisible={tab.id === activeTabId}
            onUpdateStatus={handleUpdateStatus}
          />
        ))}
      </div>
    </div>
  );
}

