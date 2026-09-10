import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ScanAdapter {
  id: string;
  name: string;
  ipv4: string;
  prefix: number;
  subnet: string;
  host_count: number;
}

interface ScanDevice {
  ip: string;
  host_name: string | null;
  device_name: string | null;
  manufacturer: string | null;
  host_source: string;
  device_source: string;
  manufacturer_source: string;
  mac_vendor: string | null;
  mac: string | null;
  web_ports: number[];
  is_local: boolean;
}

interface ScanSnapshot {
  adapter: ScanAdapter;
  status: "running" | "identifying" | "stopping" | "stopped" | "complete" | "failed";
  checked: number;
  total: number;
  devices: ScanDevice[];
  error: string | null;
  warnings: string[];
}

const ipNumber = (ip: string) => ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
const buttonClass = "rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";

function webLink(ip: string, port: number) {
  const scheme = port === 443 || port === 8443 ? "https" : "http";
  return `${scheme}://${ip}${port === 80 || port === 443 ? "" : `:${port}`}/`;
}

export default function Scan() {
  const [adapters, setAdapters] = useState<ScanAdapter[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const generation = useRef(0);
  const running = snapshot?.status === "running" || snapshot?.status === "identifying" || snapshot?.status === "stopping";
  const busy = running || starting || stopping;
  const selected = adapters.find((adapter) => adapter.id === selectedId);

  const refreshAdapters = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ScanAdapter[]>("list_scan_adapters");
      setAdapters(result);
      setSelectedId((current) => result.some((a) => a.id === current) ? current : result[0]?.id ?? "");
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAdapters();
    let alive = true;
    invoke<ScanSnapshot | null>("get_scan_status").then((result) => {
      if (alive && generation.current === 0) {
        setSnapshot(result);
        if (result) setSelectedId(result.adapter.id);
      }
    }).catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [refreshAdapters]);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const currentGeneration = generation.current;
      try {
        const result = await invoke<ScanSnapshot | null>("get_scan_status");
        if (alive && generation.current === currentGeneration) setSnapshot(result);
      } catch (err) {
        if (alive) setError(`Could not update scan progress: ${String(err)}`);
      }
      if (alive) timer = setTimeout(poll, 400);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [running]);

  async function start() {
    if (!selected || busy) return;
    generation.current += 1;
    setStarting(true);
    setError(null);
    try {
      const result = await invoke<ScanSnapshot>("start_scan", { adapterId: selected.id });
      setSnapshot(result);
      setFilter("");
    } catch (err) {
      setError(String(err));
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    setStopping(true);
    try {
      await invoke("stop_scan");
      setSnapshot(await invoke<ScanSnapshot | null>("get_scan_status"));
    } catch (err) {
      setError(String(err));
    } finally {
      setStopping(false);
    }
  }

  const devices = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return [...(snapshot?.devices ?? [])]
      .filter((device) => `${device.ip} ${device.host_name ?? ""} ${device.device_name ?? ""} ${device.manufacturer ?? ""} ${device.mac ?? ""}`.toLowerCase().includes(query))
      .sort((a, b) => ipNumber(a.ip) - ipNumber(b.ip));
  }, [snapshot?.devices, filter]);
  const progress = snapshot ? Math.round(snapshot.checked / snapshot.total * 100) : 0;
  const status = snapshot?.status === "stopping" ? "Stopping…" : snapshot?.status === "running" ? "Scanning…"
    : snapshot?.status === "identifying" ? "Identifying devices…"
    : snapshot?.status === "complete" ? "Scan complete" : snapshot?.status === "stopped" ? "Scan stopped"
    : snapshot?.status === "failed" ? "Scan failed" : "Ready to scan";

  return (
    <section className="flex h-full min-h-0 flex-col p-6 gap-5">
      <header>
        <h2 className="text-2xl font-bold">Scan</h2>
        <p className="mt-1 text-sm text-gray-400">Find devices on your local network and open their web interfaces.</p>
      </header>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <label htmlFor="scan-adapter" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">Network port</label>
        <div className="flex items-center gap-3 flex-wrap">
          <select id="scan-adapter" value={selectedId} disabled={busy || loading} onChange={(event) => setSelectedId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-[#008FD4] disabled:opacity-50">
            {!adapters.length && <option value="">{loading ? "Finding network ports…" : "No connected IPv4 ports"}</option>}
            {adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.name} — {adapter.ipv4}</option>)}
          </select>
          <button onClick={() => void refreshAdapters()} disabled={busy || loading} className={`${buttonClass} bg-gray-800 hover:bg-gray-700`}>Refresh</button>
          {running ? (
            <button onClick={() => void stop()} disabled={stopping || snapshot?.status === "stopping"} className={`${buttonClass} bg-rose-600 hover:bg-rose-500`}>
              {snapshot?.status === "stopping" || stopping ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button onClick={() => void start()} disabled={!selected || busy || loading || selected.prefix < 16} className={`${buttonClass} bg-[#008FD4] hover:bg-[#007bb8]`}>
              {starting ? "Starting…" : "Scan network"}
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          {selected ? <>Subnet <span className="font-mono text-gray-200">{selected.subnet}</span> · {selected.host_count.toLocaleString()} addresses · Range detected automatically</>
            : "Connect to Ethernet or Wi-Fi, then refresh the network ports."}
        </p>
        {selected && selected.prefix < 16 && <p className="mt-2 text-xs text-amber-400">This subnet is too large for this version. Select a port with a /16 or smaller subnet.</p>}
      </div>

      {(error || snapshot?.error) && <div role="alert" className="rounded-md border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{error || snapshot?.error}</div>}
      {!!snapshot?.warnings?.length && <div role="status" className="rounded-md border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-300">{snapshot.warnings.join(" · ")}</div>}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-[#008FD4]" : snapshot?.status === "complete" ? "bg-emerald-400" : "bg-gray-500"}`} />
              <span className="text-sm font-semibold" role="status">{status}</span>
              <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">{snapshot?.devices.length ?? 0} devices</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {snapshot ? `${snapshot.adapter.name} · ${snapshot.adapter.subnet} · ${snapshot.checked.toLocaleString()} / ${snapshot.total.toLocaleString()} checked`
                : "Select a network port and start a scan."}
            </p>
          </div>
          <input aria-label="Filter discovered devices" type="search" placeholder="Filter names, vendor, IP…" value={filter} onChange={(event) => setFilter(event.target.value)}
            className="w-52 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-xs outline-none focus:border-[#008FD4]" />
        </div>
        {snapshot && <div role="progressbar" aria-label="Scan progress" aria-valuenow={snapshot.checked} aria-valuemin={0} aria-valuemax={snapshot.total} className="h-1 shrink-0 bg-gray-800">
          <div className="h-full bg-[#008FD4] transition-all" style={{ width: `${progress}%` }} />
        </div>}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="sticky top-0 bg-gray-900 text-xs uppercase tracking-wide text-gray-400">
              <tr><th className="px-3 py-3 font-medium">Host Name</th><th className="px-3 py-3 font-medium">Device Name</th><th className="px-3 py-3 font-medium">Manufacturer</th><th className="px-3 py-3 font-medium whitespace-nowrap">IP address</th><th className="px-3 py-3 font-medium whitespace-nowrap">MAC address</th><th className="px-3 py-3 font-medium">Web</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70">
              {devices.map((device) => <tr key={device.ip} className="hover:bg-gray-800/50">
                <td className="px-3 py-3 max-w-56 break-words select-text" title={device.host_source}>{device.host_name || <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-3 max-w-64 break-words select-text" title={device.device_source}>{device.device_name || <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-3 max-w-48 break-words text-gray-300 select-text" title={`${device.manufacturer_source}${device.mac_vendor ? ` · MAC vendor: ${device.mac_vendor}` : ""}`}>{device.manufacturer || <span className="text-gray-600">—</span>}</td>
                <td className="px-3 py-3 font-mono text-xs text-cyan-300 select-text whitespace-nowrap">{device.ip}</td>
                <td className="px-3 py-3 font-mono text-xs text-gray-300 select-text whitespace-nowrap" title={device.mac_vendor || "No IEEE vendor assignment for this MAC"}>{device.mac || "—"}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {device.web_ports.map((port) => <a key={port} href={webLink(device.ip, port)}
                      title={`${webLink(device.ip, port)} — port is open; web interface not verified`}
                      onClick={(event) => { event.preventDefault(); void openUrl(webLink(device.ip, port)).catch((err) => setError(`Could not open browser: ${String(err)}`)); }}
                      className="rounded border border-[#008FD4]/40 bg-[#008FD4]/10 px-2 py-1 text-xs font-medium text-cyan-300 hover:bg-[#008FD4]/25">
                      {port === 80 ? "HTTP" : port === 443 ? "HTTPS" : `${port === 8443 ? "HTTPS" : "HTTP"} :${port}`} ↗
                    </a>)}
                    {!device.web_ports.length && <span className="text-xs text-gray-500">—</span>}
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
          {!devices.length && <div className="px-6 py-14 text-center text-sm text-gray-500">
            {filter ? "No devices match your filter." : running ? "Looking for devices… Results appear as they are found."
              : snapshot ? "No devices found. Check the selected network port and connection." : "Discovered devices will appear here."}
          </div>}
        </div>
        <p className="border-t border-gray-800 px-4 py-2.5 text-[11px] text-gray-500">A dash means the device hasn't supplied a name or vendor. Hover over a value to see its source.</p>
      </div>
    </section>
  );
}
