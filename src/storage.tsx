export function truncateTerminalBuffer(text: string | undefined, maxChars: number = 150000): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

export function loadSavedTabs<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.error(`Failed to load saved tabs for key: ${key}`, e);
  }
  return fallback;
}

export function savePinnedTabs<T extends { isPinned: boolean }>(key: string, tabs: T[]): void {
  try {
    const pinnedTabs = tabs.filter((t) => t.isPinned);
    if (pinnedTabs.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(pinnedTabs));
    }
  } catch (e) {
    console.error(`Failed to save pinned tabs for key: ${key}`, e);
  }
}

export function PinIcon({
  pinned,
  className = "w-3.5 h-3.5",
}: {
  pinned: boolean;
  className?: string;
}) {
  if (pinned) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={`${className} shrink-0`}
        style={{ minWidth: 14, minHeight: 14 }}
      >
        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
      style={{ minWidth: 14, minHeight: 14 }}
    >
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
    </svg>
  );
}
