const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatMessageTime(ts: number): string {
  if (!ts || Number.isNaN(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDateDivider(ts: number, now = Date.now()): string {
  if (!ts || Number.isNaN(ts)) return "";
  const targetKey = localDayKey(ts);
  if (!targetKey) return "";
  const todayKey = localDayKey(now);
  if (targetKey === todayKey) return "Today";
  const yesterdayKey = localDayKey(now - ONE_DAY_MS);
  if (targetKey === yesterdayKey) return "Yesterday";

  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function shouldShowDateDivider(prevTs: number | undefined, currTs: number): boolean {
  if (!currTs || Number.isNaN(currTs)) return false;
  if (!prevTs || Number.isNaN(prevTs)) return true;
  return localDayKey(prevTs) !== localDayKey(currTs);
}

export function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.max(1, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatTimeGap(prevTs: number | undefined, currTs: number): string | null {
  if (!prevTs || !currTs || Number.isNaN(prevTs) || Number.isNaN(currTs)) return null;
  const delta = currTs - prevTs;
  if (delta < ONE_HOUR_MS) return null;
  return `${formatDurationCompact(delta)} later`;
}

export function buildGapContextNote(prevTs: number | undefined, currTs: number): string | null {
  if (!prevTs || !currTs || Number.isNaN(prevTs) || Number.isNaN(currTs)) return null;
  const delta = currTs - prevTs;
  if (delta < ONE_HOUR_MS) return null;
  const d = new Date(currTs);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
  return `[Context: ${formatDurationCompact(delta)} since previous message; local time ${stamp}]`;
}

export function injectGapContextIntoText(
  text: string,
  prevTs: number | undefined,
  currTs: number,
  enabled = true,
): string {
  if (!enabled) return text;
  const clean = text.trim();
  if (!clean) return text;
  if (clean.startsWith("[Context:")) return text;
  const note = buildGapContextNote(prevTs, currTs);
  if (!note) return text;
  return `${note}\n\n${text}`;
}
