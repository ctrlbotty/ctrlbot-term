import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { PinIcon, loadSavedTabs, savePinnedTabs, truncateTerminalBuffer } from "./storage";

interface ClientEvent {
  id: string;
  event_type: string;
  data: string;
}

export interface TcpClientTabItem {
  id: string;
  name?: string;
  host: string;
  port: string;
  isConnected: boolean;
  isPinned: boolean;
  lineEnding?: "none" | "\\r" | "\\n" | "\\r\\n";
  isHex?: boolean;
  showHexReceived?: boolean;
  showVerboseCrLf?: boolean;
  receivedData?: string;
  sentData?: string;
  inputMessage?: string;
}

const STORAGE_KEY = "ctrlbot_pinned_tcp_clients";

function TcpClientInstance({
  id,
  initialData,
  isVisible,
  onUpdateState,
}: {
  id: string;
  initialData?: Partial<TcpClientTabItem>;
  isVisible: boolean;
  onUpdateState: (id: string, updates: Partial<TcpClientTabItem>) => void;
}) {
  const [host, setHost] = useState(initialData?.host || "127.0.0.1");
  const [port, setPort] = useState(initialData?.port || "23");
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState("");
  
  const [receivedData, setReceivedData] = useState<string>(initialData?.receivedData || "");
  const [sentData, setSentData] = useState<string>(initialData?.sentData || "");
  const [inputMessage, setInputMessage] = useState(initialData?.inputMessage || "");
  const [isHex, setIsHex] = useState(initialData?.isHex ?? false);
  const [showHexReceived, setShowHexReceived] = useState(initialData?.showHexReceived ?? false);
  const [showVerboseCrLf, setShowVerboseCrLf] = useState(initialData?.showVerboseCrLf ?? true);
  const [lineEnding, setLineEnding] = useState<"none" | "\\r" | "\\n" | "\\r\\n">(initialData?.lineEnding || "\\r\\n");

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
      host,
      port,
      isConnected,
      lineEnding,
      isHex,
      showHexReceived,
      showVerboseCrLf,
      receivedData,
      sentData,
      inputMessage,
    });
  }, [id, host, port, isConnected, lineEnding, isHex, showHexReceived, showVerboseCrLf, receivedData, sentData, inputMessage]);

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

  // Cleanup on unmount if connected
  useEffect(() => {
    return () => {
      if (isConnected && clientId) {
        invoke("disconnect_tcp_client", { id: clientId }).catch(console.error);
      }
    };
  }, [isConnected, clientId]);

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
    <div className={`flex-col flex-1 h-full p-4 overflow-hidden ${isVisible ? "flex" : "hidden"}`}>
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-900 p-3 rounded-lg border border-gray-800 shrink-0">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Host / IP</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isConnected}
            placeholder="127.0.0.1"
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-40 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Port</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={isConnected}
            placeholder="23"
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-24 text-sm"
          />
        </div>

        <div className="ml-auto flex items-end mt-4">
          <button
            onClick={toggleConnection}
            className={`px-6 py-1.5 rounded text-sm font-semibold transition-colors cursor-pointer ${
              isConnected
                ? "bg-red-600 hover:bg-red-700 text-white shadow-md"
                : "bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white shadow-md"
            }`}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      <div className="flex-1 grid grid-rows-2 gap-4 min-h-0">
        {/* Received Data */}
        <div className="flex flex-col border border-gray-800 rounded-lg bg-gray-900/60 overflow-hidden">
          <div className="bg-gray-900 px-3 py-1.5 text-xs font-semibold border-b border-gray-800 flex justify-between items-center text-gray-200 shrink-0">
            <span>Received Data (Raw TCP)</span>
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
          disabled={!isConnected}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-500 font-mono text-sm disabled:opacity-50"
        />
        
        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value as any)}
          disabled={!isConnected || isHex}
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
          disabled={!isConnected}
          className="bg-[#008FD4] hover:bg-[#FFCC00] hover:text-black active:bg-[#E5B800] text-white px-6 py-1.5 rounded text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function TcpClient() {
  const [tabs, setTabs] = useState<TcpClientTabItem[]>(() => {
    return loadSavedTabs<TcpClientTabItem>(STORAGE_KEY, [
      { id: "cli_1", host: "127.0.0.1", port: "23", isConnected: false, isPinned: false },
    ]);
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || "cli_1";
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
          isConnected: false,
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
          isConnected: false,
          receivedData: truncateTerminalBuffer(t.receivedData),
          sentData: truncateTerminalBuffer(t.sentData),
        }))
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tabs]);

  const handleAddTab = () => {
    const newId = `cli_${Date.now()}`;
    const newTab: TcpClientTabItem = {
      id: newId,
      host: "127.0.0.1",
      port: "23",
      isConnected: false,
      isPinned: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      const newId = `cli_${Date.now()}`;
      const freshTab: TcpClientTabItem = { id: newId, host: "127.0.0.1", port: "23", isConnected: false, isPinned: false };
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

  const handleUpdateState = useCallback((id: string, updates: Partial<TcpClientTabItem>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const handleStartRename = (tab: TcpClientTabItem, defaultLabel: string, e: React.MouseEvent) => {
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
          const defaultLabel = tab.host && tab.port ? `${tab.host}:${tab.port}` : `Client ${idx + 1}`;
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
                  tab.isConnected ? "bg-green-400 shadow-sm" : "bg-gray-500"
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
          title="Add New Raw TCP Client"
          className="bg-gray-800 hover:bg-[#FFCC00] hover:text-black text-gray-200 px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 border border-gray-700 ml-1 shadow-sm"
        >
          <span>+</span>
          <span className="hidden sm:inline text-[11px]">New</span>
        </button>
      </div>

      {/* Instances Containers */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tabs.map((tab) => (
          <TcpClientInstance
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
