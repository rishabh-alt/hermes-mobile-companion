const MAX = 80;
const lines: string[] = [];

export function redact(line: string): string {
  return line
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
}

export function note(line: string) {
  lines.push(`${new Date().toISOString()} ${redact(line)}`);
  if (lines.length > MAX) lines.shift();
}

export function debugLines() {
  return [...lines];
}

export function clearDebugLog() {
  lines.length = 0;
}
