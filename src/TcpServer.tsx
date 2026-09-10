import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { PinIcon, loadSavedTabs, savePinnedTabs, truncateTerminalBuffer } from "./storage";

interface ServerEvent {
  port: number;
  event_type: string;
  client_id: string;
  data: number[];
}

export interface TcpServerTabItem {
  id: string;
  name?: string;
  port: string;
  isRunning: boolean;
  isPinned: boolean;
  isHex?: boolean;
  showHexReceived?: boolean;
  showVerboseCrLf?: boolean;
  receivedData?: string;
  sentData?: string;
  inputMessage?: string;
}

const STORAGE_KEY = "ctrlbot_pinned_tcp_servers";

function TcpServerInstance({
  id,
  initialData,
  isVisible,
  onUpdateState,
}: {
  id: string;
  initialData?: Partial<TcpServerTabItem>;
  isVisible: boolean;
  onUpdateState: (id: string, updates: Partial<TcpServerTabItem>) => void;
}) {
  const [port, setPort] = useState(initialData?.port || "23");
  const [isRunning, setIsRunning] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [receivedData, setReceivedData] = useState<string>(initialData?.receivedData || "");
  const [sentData, setSentData] = useState<string>(initialData?.sentData || "");
  const [inputMessage, setInputMessage] = useState(initialData?.inputMessage || "");
  const [isHex, setIsHex] = useState(initialData?.isHex ?? false);
  const [showHexReceived, setShowHexReceived] = useState(initialData?.showHexReceived ?? false);
  const [showVerboseCrLf, setShowVerboseCrLf] = useState(initialData?.showVerboseCrLf ?? true);

  const receivedDataRef = useRef<HTMLTextAreaElement>(null);
  const sentDataRef = useRef<HTMLTextAreaElement>(null);

  const showHexRef = useRef(showHexReceived);
  const showVerboseRef = useRef(showVerboseCrLf);

  useEffect(() => {
    showHexRef.current = showHexReceived;
    showVerboseRef.current = showVerboseCrLf;
  }, [showHexReceived, showVerboseCrLf]);

  useEffect(() => {
    onUpdateState(id, {
      port,
      isRunning,
      isHex,
      showHexReceived,
      showVerboseCrLf,
      receivedData,
      sentData,
      inputMessage,
    });
  }, [id, port, isRunning, isHex, showHexReceived, showVerboseCrLf, receivedData, sentData, inputMessage]);

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

  // Cleanup on unmount if running
  useEffect(() => {
    return () => {
      if (isRunning) {
        const portNum = parseInt(port);
        if (!isNaN(portNum)) {
          invoke("stop_tcp_server", { port: portNum }).catch(console.error);
        }
      }
    };
  }, [isRunning, port]);

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
    <div className={`flex-col flex-1 h-full p-4 overflow-hidden ${isVisible ? "flex" : "hidden"}`}>
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-900 p-3 rounded-lg border border-gray-800 shrink-0">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Port</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={isRunning}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-24 text-sm"
          />
        </div>
        <div className="mt-5">
          <button
            onClick={toggleServer}
            className={`px-6 py-1.5 rounded font-semibold text-sm transition-colors cursor-pointer ${
              isRunning
                ? "bg-red-600 hover:bg-red-700 text-white shadow-md"
                : "bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white shadow-md"
            }`}
          >
            {isRunning ? "Stop" : "Listen"}
          </button>
        </div>
        <div className="mt-5 flex space-x-4 text-sm text-gray-300">
          <span>Status: {isRunning ? <span className="text-green-400 font-medium">Listening</span> : <span className="text-gray-500">Stopped</span>}</span>
          <span>Clients: <span className="text-white font-medium">{clients.length}</span></span>
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
          placeholder="Type a message (use \r or \n for returns)..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono text-sm"
        />
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
          className="bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white px-6 py-1.5 rounded text-sm font-semibold transition-colors cursor-pointer shadow-md"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function TcpServer() {
  const [tabs, setTabs] = useState<TcpServerTabItem[]>(() => {
    return loadSavedTabs<TcpServerTabItem>(STORAGE_KEY, [
      { id: "srv_1", port: "23", isRunning: false, isPinned: false },
    ]);
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || "srv_1";
  });

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  // Persist pinned tabs whenever tabs state changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      savePinnedTabs(
        STORAGE_KEY,
        tabs.map((t) => ({
          ...t,
          isRunning: false, // Don't persist running state
          receivedData: truncateTerminalBuffer(t.receivedData),
          sentData: truncateTerminalBuffer(t.sentData),
        }))
      );
    }, 300);
    return () => clearTimeout(timeout);
  }, [tabs]);

  // Ensure immediate save before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      savePinnedTabs(
        STORAGE_KEY,
        tabs.map((t) => ({
          ...t,
          isRunning: false,
          receivedData: truncateTerminalBuffer(t.receivedData),
          sentData: truncateTerminalBuffer(t.sentData),
        }))
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tabs]);

  const handleAddTab = () => {
    const newId = `srv_${Date.now()}`;
    const newTab: TcpServerTabItem = {
      id: newId,
      port: "23",
      isRunning: false,
      isPinned: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      const newId = `srv_${Date.now()}`;
      const freshTab: TcpServerTabItem = { id: newId, port: "23", isRunning: false, isPinned: false };
      setTabs([freshTab]);
      setActiveTabId(newId);
      return;
    }

    const remaining = tabs.filter((t) => t.id !== idToClose);
    setTabs(remaining);

    if (activeTabId === idToClose) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isPinned: !t.isPinned } : t))
    );
  };

  const handleUpdateState = useCallback((id: string, updates: Partial<TcpServerTabItem>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const handleStartRename = (tab: TcpServerTabItem, defaultLabel: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingName(tab.name || defaultLabel);
  };

  const handleFinishRename = (id: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name: editingName.trim() } : t))
    );
    setEditingTabId(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      {/* Top Instance Tab Bar */}
      <div className="bg-gray-900/90 border-b border-gray-800 px-4 pt-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const defaultLabel = `Server ${idx + 1} (${tab.port || "23"})`;
          const displayLabel = tab.name || defaultLabel;

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
                className={`w-2 h-2 rounded-full shrink-0 ${
                  tab.isRunning ? "bg-green-400 shadow-sm" : "bg-gray-500"
                }`}
              />

              {editingTabId === tab.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => handleFinishRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFinishRename(tab.id);
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="bg-gray-800 text-white border border-gray-600 px-1 py-0.5 rounded text-xs w-28 outline-none"
                />
              ) : (
                <span
                  onDoubleClick={(e) => handleStartRename(tab, defaultLabel, e)}
                  title="Double click to rename tab"
                  className="truncate max-w-[140px]"
                >
                  {displayLabel}
                </span>
              )}

              {/* Pin Icon Toggle */}
              <span
                onClick={(e) => handleTogglePin(tab.id, e)}
                title={tab.isPinned ? "Unpin preset (won't save across restarts)" : "Pin as preset (keep data & settings across restarts)"}
                className={`p-0.5 rounded transition-colors cursor-pointer ${
                  tab.isPinned
                    ? "text-[#FFCC00] hover:text-yellow-300 scale-110"
                    : isActive
                    ? "text-white/60 hover:text-white"
                    : "text-gray-500 hover:text-[#FFCC00]"
                }`}
              >
                <PinIcon pinned={tab.isPinned} className="w-3.5 h-3.5" />
              </span>

              {/* Close Button */}
              <span
                onClick={(e) => handleCloseTab(tab.id, e)}
                title="Close Tab"
                className={`rounded px-1 text-[11px] font-bold ${
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
          title="Add New TCP Server"
          className="bg-gray-800 hover:bg-[#FFCC00] hover:text-black text-gray-200 px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 border border-gray-700 ml-1 shadow-sm"
        >
          <span>+</span>
          <span className="hidden sm:inline text-[11px]">New</span>
        </button>
      </div>

      {/* Instances Containers */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tabs.map((tab) => (
          <TcpServerInstance
            key={tab.id}
            id={tab.id}
            initialData={tab}
            isVisible={tab.id === activeTabId}
            onUpdateState={handleUpdateState}
          />
        ))}
      </div>
    </div>
  );
}
