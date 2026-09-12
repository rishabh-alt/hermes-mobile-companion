import { useCallback, useEffect, useState } from "react";
import { createClientId } from "./ids";
import type { HermesMessage, Session } from "./types";

const KEY = "hermes.sessions.v1";
const EVENT = "hermes-sessions-change";

export function readSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(sessions: Session[]) {
  window.localStorage.setItem(KEY, JSON.stringify(sessions));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function mutateSessions(fn: (sessions: Session[]) => Session[]) {
  if (typeof window === "undefined") return;
  persist(fn(readSessions()));
}

export function createSession(model?: string): Session {
  const now = Date.now();
  const session: Session = {
    id: createClientId().slice(0, 8),
    title: "New chat",
    pinned: false,
    createdAt: now,
    updatedAt: now,
    model,
    messages: [],
  };
  mutateSessions((s) => [session, ...s]);
  return session;
}

export function ensureSession(id: string, model?: string): Session {
  const existing = readSessions().find((s) => s.id === id);
  if (existing) return existing;
  const now = Date.now();
  const session: Session = {
    id,
    title: "New chat",
    pinned: false,
    createdAt: now,
    updatedAt: now,
    model,
    messages: [],
  };
  mutateSessions((s) => [session, ...s]);
  return session;
}

export function updateSession(id: string, patch: Partial<Session>) {
  mutateSessions((sessions) =>
    sessions.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
  );
}

export function setMessages(id: string, messages: HermesMessage[]) {
  mutateSessions((sessions) =>
    sessions.map((s) => {
      if (s.id !== id) return s;
      const first = messages.find((m) => m.role === "user");
      const title =
        s.title === "New chat" && first ? first.text.slice(0, 60).trim() || "New chat" : s.title;
      return { ...s, messages, title, updatedAt: Date.now() };
    }),
  );
}

export function deleteSession(id: string) {
  mutateSessions((sessions) => sessions.filter((s) => s.id !== id));
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setSessions(readSessions());
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { sessions, ready };
}

export function useSession(id: string) {
  const { sessions, ready } = useSessions();
  const session = sessions.find((s) => s.id === id);

  const save = useCallback((messages: HermesMessage[]) => setMessages(id, messages), [id]);

  return { session, ready, save };
}

/** Brings a conversation that lives on the Mac into the phone's local store. */
export function importGatewaySession(
  id: string,
  title: string,
  messages: HermesMessage[],
  model?: string,
) {
  const now = Date.now();
  mutateSessions((sessions) => {
    const existing = sessions.find((s) => s.id === id);
    const session: Session = existing
      ? {
          ...existing,
          title: existing.title === "New chat" ? title : existing.title,
          messages,
          model: model ?? existing.model,
          updatedAt: now,
        }
      : { id, title, pinned: false, createdAt: now, updatedAt: now, model, messages };
    return [session, ...sessions.filter((s) => s.id !== id)];
  });
}

export function groupSessions(sessions: Session[]) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((s) => s.pinned);
  const rest = sorted.filter((s) => !s.pinned);
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const groups: { label: string; items: Session[] }[] = [];
  const push = (label: string, items: Session[]) => {
    if (items.length) groups.push({ label, items });
  };
  push(
    "Today",
    rest.filter((s) => now - s.updatedAt < day),
  );
  push(
    "This week",
    rest.filter((s) => now - s.updatedAt >= day && now - s.updatedAt < 7 * day),
  );
  push(
    "Earlier",
    rest.filter((s) => now - s.updatedAt >= 7 * day),
  );
  return { pinned, groups };
}
