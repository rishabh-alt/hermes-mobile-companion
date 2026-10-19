const DRAFTS_KEY = "hermes.drafts.v1";
const MAX_DRAFTS = 50;

interface DraftEntry {
  text: string;
  updatedAt: number;
}

type DraftMap = Record<string, DraftEntry>;

function draftStorageKey(profile: string, sessionId: string): string {
  const cleanProfile = (profile || "default").trim() || "default";
  return `${cleanProfile}:${sessionId}`;
}

function readDraftMap(): DraftMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DraftMap;
  } catch {
    return {};
  }
}

function writeDraftMap(map: DraftMap) {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.text === "string" && v.text.length > 0)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_DRAFTS);
    if (entries.length === 0) {
      window.localStorage.removeItem(DRAFTS_KEY);
      return;
    }
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore storage quota errors
  }
}

export function getSessionDraft(profile: string, sessionId: string): string {
  if (!sessionId) return "";
  const map = readDraftMap();
  const entry = map[draftStorageKey(profile, sessionId)];
  return typeof entry?.text === "string" ? entry.text : "";
}

export function setSessionDraft(profile: string, sessionId: string, text: string): void {
  if (!sessionId) return;
  const key = draftStorageKey(profile, sessionId);
  const map = readDraftMap();
  if (!text) {
    if (key in map) {
      delete map[key];
      writeDraftMap(map);
    }
    return;
  }
  map[key] = { text, updatedAt: Date.now() };
  writeDraftMap(map);
}

export function clearSessionDraft(profile: string, sessionId: string): void {
  setSessionDraft(profile, sessionId, "");
}
