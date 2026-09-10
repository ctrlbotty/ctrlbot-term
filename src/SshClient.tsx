import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { PinIcon, loadSavedTabs, savePinnedTabs, truncateTerminalBuffer } from "./storage";

interface ClientEvent {
  id: string;
  event_type: string;
  data: number[];
}

export interface SshClientTabItem {
  id: string;
  name?: string;
  host: string;
  username: string;
  password?: string;
  isConnected: boolean;
  isPinned: boolean;
  terminalOutput?: string;
  inputMessage?: string;
}

const STORAGE_KEY = "ctrlbot_pinned_ssh_tabs";

function SshClientInstance({
  id,
  initialData,
  isVisible,
  onUpdateState,
}: {
  id: string;
  initialData?: Partial<SshClientTabItem>;
  isVisible: boolean;
  onUpdateState: (id: string, updates: Partial<SshClientTabItem>) => void;
}) {
  const [host, setHost] = useState(initialData?.host || "192.168.1.10:22");
  const [username, setUsername] = useState(initialData?.username || "root");
  const [password, setPassword] = useState(initialData?.password || "");
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState("");
  
  const [terminalOutput, setTerminalOutput] = useState<string>(initialData?.terminalOutput || "");
  const [inputMessage, setInputMessage] = useState(initialData?.inputMessage || "");

  const terminalOutputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onUpdateState(id, {
      host,
      username,
      password,
      isConnected,
      terminalOutput,
      inputMessage,
    });
  }, [id, host, username, password, isConnected, terminalOutput, inputMessage]);

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

  // Cleanup on unmount if connected
  useEffect(() => {
    return () => {
      if (isConnected && clientId) {
        invoke("disconnect_ssh", { id: clientId }).catch(console.error);
      }
    };
  }, [isConnected, clientId]);

  const toggleConnection = async () => {
    try {
      if (isConnected) {
        await invoke("disconnect_ssh", { id: clientId });
        setIsConnected(false);
        setTerminalOutput((prev) => prev + `\n[System] Closed connection\n`);
      } else {
        const newId = `ssh_${host}_${Date.now()}`;
        setClientId(newId);
        
        setTerminalOutput((prev) => prev + `[System] Connecting to ${username}@${host}...\n`);
        
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
    <div className={`flex-col flex-1 h-full p-4 overflow-hidden ${isVisible ? "flex" : "hidden"}`}>
      {/* Header controls */}
      <div className="flex items-center space-x-4 mb-4 bg-gray-900 p-3 rounded-lg border border-gray-800 shrink-0">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Host:Port</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isConnected}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-48 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isConnected}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-32 text-sm"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-400 block mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isConnected}
            className="bg-gray-800 border border-gray-700 text-white px-3 py-1.5 rounded focus:outline-none focus:border-[#008FD4] w-32 text-sm"
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

      <div className="flex-1 flex flex-col border border-gray-800 rounded-lg bg-gray-900/60 overflow-hidden min-h-0">
        {/* Terminal Output */}
        <textarea
          ref={terminalOutputRef}
          readOnly
          value={terminalOutput}
          className="flex-1 bg-transparent p-4 text-green-500 font-mono text-sm focus:outline-none resize-none"
        ></textarea>
        
        {/* SSH Command Input */}
        <div className="flex items-center space-x-2 bg-gray-900 p-2.5 border-t border-gray-800 shrink-0">
          <span className="text-green-500 font-mono font-bold ml-2">{">"}</span>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder="Type command..."
            className="flex-1 bg-transparent text-white focus:outline-none font-mono text-sm disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

export default function SshClient() {
  const [tabs, setTabs] = useState<SshClientTabItem[]>(() => {
    return loadSavedTabs<SshClientTabItem>(STORAGE_KEY, [
      { id: "ssh_1", host: "192.168.1.10:22", username: "root", password: "", isConnected: false, isPinned: false }
    ]);
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || "ssh_1";
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
          terminalOutput: truncateTerminalBuffer(t.terminalOutput),
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
          terminalOutput: truncateTerminalBuffer(t.terminalOutput),
        }))
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tabs]);

  const handleAddTab = () => {
    const newId = `ssh_${Date.now()}`;
    const newTab: SshClientTabItem = {
      id: newId,
      host: "192.168.1.10:22",
      username: "root",
      password: "",
      isConnected: false,
      isPinned: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (idToClose: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      const newId = `ssh_${Date.now()}`;
      const freshTab: SshClientTabItem = { id: newId, host: "192.168.1.10:22", username: "root", password: "", isConnected: false, isPinned: false };
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

  const handleUpdateState = useCallback((id: string, updates: Partial<SshClientTabItem>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const handleStartRename = (tab: SshClientTabItem, defaultLabel: string, e: React.MouseEvent) => {
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
          const defaultLabel = tab.host ? `${tab.username}@${tab.host}` : `SSH ${idx + 1}`;
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
          title="Add New SSH Session"
          className="bg-gray-800 hover:bg-[#FFCC00] hover:text-black text-gray-200 px-2.5 py-1 rounded text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 border border-gray-700 ml-1 shadow-sm"
        >
          <span>+</span>
          <span className="hidden sm:inline text-[11px]">New</span>
        </button>
      </div>

      {/* Instances Containers */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tabs.map((tab) => (
          <SshClientInstance
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
