import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NetworkAdapter {
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  subnet_mask: string | null;
  default_gateway: string | null;
  dns_suffix: string | null;
  media_state: string | null;
}

export interface NetworkInfo {
  primary_ip: string;
  is_online: boolean;
  raw_ipconfig: string;
  adapters: NetworkAdapter[];
  active_adapter: NetworkAdapter | null;
}

export default function NetworkStatus() {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<"summary" | "raw">("summary");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchNetworkInfo = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      const data = await invoke<NetworkInfo>("get_network_info");
      setNetworkInfo(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to fetch network info:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNetworkInfo();

    // Refresh every 15 seconds
    const interval = setInterval(() => {
      fetchNetworkInfo(false);
    }, 15000);

    const handleOnline = () => fetchNetworkInfo(false);
    const handleOffline = () => fetchNetworkInfo(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [fetchNetworkInfo]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isModalOpen) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => {
      setCopiedField((curr) => (curr === fieldId ? null : curr));
    }, 2000);
  };

  const primaryIp = networkInfo?.primary_ip || (loading ? "Detecting..." : "Offline");
  const isOnline = networkInfo?.is_online ?? false;

  return (
    <div className="mt-auto pt-3 border-t border-gray-800">
      {/* Compact Sidebar Widget */}
      <div className="bg-gray-950/70 border border-gray-800/80 rounded-lg p-2.5 shadow-inner hover:border-gray-700 transition-colors">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5">
            {loading ? (
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400 animate-pulse" />
            ) : isOnline ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              </span>
            ) : (
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            )}
            <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">
              {isOnline ? "Online" : loading ? "Checking" : "Offline"}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Refresh Button */}
            <button
              onClick={() => fetchNetworkInfo(true)}
              title="Refresh IP & Network Info"
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#008FD4]" : ""}`}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>

            {/* Info Button */}
            <button
              onClick={() => setIsModalOpen(true)}
              title="View ipconfig details"
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#008FD4] transition-colors cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          </div>
        </div>

        {/* IP Address Row */}
        <div className="flex items-center justify-between bg-gray-900/90 rounded px-2 py-1.5 border border-gray-800">
          <div
            onClick={() => isOnline && copyToClipboard(primaryIp, "sidebar-ip")}
            title={isOnline ? "Click to copy IP" : undefined}
            className="flex-1 truncate font-mono text-xs text-gray-200 font-medium cursor-pointer select-all hover:text-white"
          >
            {primaryIp}
          </div>

          {isOnline && (
            <button
              onClick={() => copyToClipboard(primaryIp, "sidebar-ip")}
              title="Copy IP Address"
              className="ml-1 text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer shrink-0"
            >
              {copiedField === "sidebar-ip" ? (
                <span className="text-[10px] text-emerald-400 font-mono font-bold">Copied!</span>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Network Details Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-gray-950 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#008FD4]/10 border border-[#008FD4]/30 flex items-center justify-center text-[#008FD4]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4"
                  >
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white tracking-wide">Network Configuration</h2>
                    {isOnline ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-medium">
                        Online
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-950 border border-rose-700/60 text-rose-400 font-medium">
                        Offline
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">Device network adapters and ipconfig details</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchNetworkInfo(true)}
                  title="Refresh ipconfig"
                  className="px-2.5 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-md border border-gray-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#008FD4]" : ""}`}
                  >
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>Refresh</span>
                </button>

                <button
                  onClick={() => setIsModalOpen(false)}
                  title="Close (Esc)"
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors cursor-pointer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Tabs Header */}
            <div className="flex border-b border-gray-800 px-5 bg-gray-950/40">
              <button
                onClick={() => setActiveViewTab("summary")}
                className={`py-2.5 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
                  activeViewTab === "summary"
                    ? "border-[#008FD4] text-[#008FD4]"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                Adapter Overview
              </button>
              <button
                onClick={() => setActiveViewTab("raw")}
                className={`py-2.5 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
                  activeViewTab === "raw"
                    ? "border-[#008FD4] text-[#008FD4]"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                Raw ipconfig Output
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {error && (
                <div className="bg-rose-950/50 border border-rose-800 text-rose-200 p-3 rounded-lg text-xs">
                  {error}
                </div>
              )}

              {activeViewTab === "summary" ? (
                <>
                  {/* Primary Active Card */}
                  {networkInfo?.active_adapter ? (
                    <div className="bg-gradient-to-r from-gray-950 to-gray-900 border border-[#008FD4]/40 rounded-xl p-4 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                          </span>
                          <span className="text-xs font-bold text-white uppercase tracking-wider">
                            Active Adapter: {networkInfo.active_adapter.name}
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#008FD4]/20 text-[#008FD4] font-semibold">
                          Default Route
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        {/* IPv4 Address */}
                        <div className="bg-gray-900/90 rounded-lg p-2.5 border border-gray-800 flex items-center justify-between">
                          <div>
                            <div className="text-[10px] uppercase font-bold text-gray-400">IPv4 Address</div>
                            <div className="font-mono text-sm text-emerald-400 font-semibold mt-0.5 select-all">
                              {networkInfo.active_adapter.ipv4 || "N/A"}
                            </div>
                          </div>
                          {networkInfo.active_adapter.ipv4 && (
                            <button
                              onClick={() => copyToClipboard(networkInfo.active_adapter!.ipv4!, "active-ipv4")}
                              className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800 transition-colors cursor-pointer"
                              title="Copy IPv4"
                            >
                              {copiedField === "active-ipv4" ? (
                                <span className="text-[10px] text-emerald-400 font-mono font-bold">Copied!</span>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="w-4 h-4"
                                >
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>

                        {/* Default Gateway */}
                        <div className="bg-gray-900/90 rounded-lg p-2.5 border border-gray-800 flex items-center justify-between">
                          <div>
                            <div className="text-[10px] uppercase font-bold text-gray-400">Default Gateway</div>
                            <div className="font-mono text-sm text-cyan-400 font-semibold mt-0.5 select-all">
                              {networkInfo.active_adapter.default_gateway || "None"}
                            </div>
                          </div>
                          {networkInfo.active_adapter.default_gateway && (
                            <button
                              onClick={() =>
                                copyToClipboard(networkInfo.active_adapter!.default_gateway!, "active-gateway")
                              }
                              className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800 transition-colors cursor-pointer"
                              title="Copy Gateway"
                            >
                              {copiedField === "active-gateway" ? (
                                <span className="text-[10px] text-emerald-400 font-mono font-bold">Copied!</span>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="w-4 h-4"
                                >
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>

                        {/* Subnet Mask */}
                        <div className="bg-gray-900/90 rounded-lg p-2.5 border border-gray-800">
                          <div className="text-[10px] uppercase font-bold text-gray-400">Subnet Mask</div>
                          <div className="font-mono text-xs text-gray-200 mt-0.5 select-all">
                            {networkInfo.active_adapter.subnet_mask || "N/A"}
                          </div>
                        </div>

                        {/* DNS Suffix */}
                        <div className="bg-gray-900/90 rounded-lg p-2.5 border border-gray-800">
                          <div className="text-[10px] uppercase font-bold text-gray-400">Connection DNS Suffix</div>
                          <div className="font-mono text-xs text-gray-200 mt-0.5 truncate select-all">
                            {networkInfo.active_adapter.dns_suffix || "(None)"}
                          </div>
                        </div>

                        {/* IPv6 */}
                        {networkInfo.active_adapter.ipv6 && (
                          <div className="bg-gray-900/90 rounded-lg p-2.5 border border-gray-800 sm:col-span-2">
                            <div className="text-[10px] uppercase font-bold text-gray-400">Link-local IPv6</div>
                            <div className="font-mono text-xs text-gray-300 mt-0.5 break-all select-all">
                              {networkInfo.active_adapter.ipv6}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* All Detected Adapters */}
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2.5">
                      All Network Adapters ({networkInfo?.adapters.length || 0})
                    </h3>
                    <div className="space-y-2">
                      {networkInfo?.adapters.map((adapter, idx) => {
                        const isConnected = !!adapter.ipv4;
                        const isPrimary =
                          networkInfo.active_adapter && networkInfo.active_adapter.name === adapter.name;

                        return (
                          <div
                            key={idx}
                            className={`rounded-lg p-3 border transition-colors ${
                              isPrimary
                                ? "bg-gray-950/80 border-[#008FD4]/50"
                                : isConnected
                                ? "bg-gray-950/40 border-gray-800 hover:border-gray-700"
                                : "bg-gray-950/20 border-gray-800/60 opacity-60 hover:opacity-100"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    isConnected ? "bg-emerald-400" : "bg-gray-600"
                                  }`}
                                />
                                <span className="font-medium text-xs text-white">{adapter.name}</span>
                              </div>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                  isPrimary
                                    ? "bg-[#008FD4]/20 text-[#008FD4]"
                                    : isConnected
                                    ? "bg-emerald-950 text-emerald-400"
                                    : "bg-gray-800 text-gray-400"
                                }`}
                              >
                                {isPrimary ? "Active" : isConnected ? "Connected" : adapter.media_state || "Disconnected"}
                              </span>
                            </div>

                            {isConnected ? (
                              <div className="grid grid-cols-2 gap-2 text-[11px] mt-2 font-mono text-gray-300">
                                {adapter.ipv4 && (
                                  <div>
                                    <span className="text-gray-500 font-sans">IPv4: </span>
                                    <span className="text-emerald-400 select-all">{adapter.ipv4}</span>
                                  </div>
                                )}
                                {adapter.subnet_mask && (
                                  <div>
                                    <span className="text-gray-500 font-sans">Mask: </span>
                                    <span className="select-all">{adapter.subnet_mask}</span>
                                  </div>
                                )}
                                {adapter.default_gateway && (
                                  <div>
                                    <span className="text-gray-500 font-sans">Gateway: </span>
                                    <span className="text-cyan-400 select-all">{adapter.default_gateway}</span>
                                  </div>
                                )}
                                {adapter.dns_suffix && (
                                  <div>
                                    <span className="text-gray-500 font-sans">DNS: </span>
                                    <span className="select-all">{adapter.dns_suffix}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-[11px] text-gray-500 italic">
                                {adapter.media_state || "Media disconnected"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                /* Raw ipconfig View */
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 font-mono">ipconfig command output:</span>
                    <button
                      onClick={() => copyToClipboard(networkInfo?.raw_ipconfig || "", "raw-ipconfig")}
                      className="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white rounded border border-gray-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {copiedField === "raw-ipconfig" ? (
                        <span className="text-emerald-400 font-bold">Copied to Clipboard!</span>
                      ) : (
                        <>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3.5 h-3.5"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          <span>Copy Raw Text</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="bg-gray-950 rounded-lg p-3.5 font-mono text-xs text-green-400 border border-gray-800 overflow-auto max-h-96 select-text whitespace-pre leading-relaxed shadow-inner">
                    {networkInfo?.raw_ipconfig || "No output"}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-gray-950 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
              <div>
                {lastUpdated ? (
                  <span>
                    Last updated:{" "}
                    <span className="text-gray-300 font-mono">{lastUpdated.toLocaleTimeString()}</span>
                  </span>
                ) : (
                  <span>Fetching network details...</span>
                )}
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors cursor-pointer font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
