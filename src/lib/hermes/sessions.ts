import { useCallback, useEffect, useState } from "react";
import type { HermesMessage, Session } from "./types";

const EVENT = "hermes-sessions-change";
let cache: Session[] = [];

export function readSessions(): Session[] {
  return cache;
}

function persist(sessions: Session[]) {
  cache = sessions;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function mutateSessions(fn: (sessions: Session[]) => Session[]) {
  persist(fn(cache));
}

/** Test-only reset for the non-persistent client render cache. */
export function clearSessionCache() {
  cache = [];
}

/** @deprecated New conversations must be created by createGatewaySession(). */
export function createSession(): never {
  throw new Error("New conversations must be created by the Hermes gateway.");
}

export function ensureSession(id: string, model?: string): Session {
  const existing = cache.find((session) => session.id === id);
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
  mutateSessions((sessions) => [session, ...sessions]);
  return session;
}

export function updateSession(id: string, patch: Partial<Session>) {
  mutateSessions((sessions) =>
    sessions.map((session) =>
      session.id === id ? { ...session, ...patch, updatedAt: Date.now() } : session,
    ),
  );
}

export function setMessages(id: string, messages: HermesMessage[]) {
  mutateSessions((sessions) =>
    sessions.map((session) => {
      if (session.id !== id) return session;
      const first = messages.find((message) => message.role === "user");
      const title =
        session.title === "New chat" && first
          ? first.text.slice(0, 60).trim() || "New chat"
          : session.title;
      return { ...session, messages, title, updatedAt: Date.now() };
    }),
  );
}

export function deleteSession(id: string) {
  mutateSessions((sessions) => sessions.filter((session) => session.id !== id));
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(() => readSessions());
  const [ready] = useState(true);

  useEffect(() => {
    const sync = () => setSessions(readSessions());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  return { sessions, ready };
}

export function useSession(id: string) {
  const { sessions, ready } = useSessions();
  const session = sessions.find((candidate) => candidate.id === id);
  const save = useCallback((messages: HermesMessage[]) => setMessages(id, messages), [id]);
  return { session, ready, save };
}

/** Caches a gateway transcript only for live rendering; the gateway remains authoritative. */
export function importGatewaySession(
  id: string,
  title: string,
  messages: HermesMessage[],
  model?: string,
  provider?: string,
) {
  const now = Date.now();
  mutateSessions((sessions) => {
    const existing = sessions.find((session) => session.id === id);
    const session: Session = existing
      ? {
          ...existing,
          title: title || existing.title,
          messages,
          provider: provider ?? existing.provider,
          model: model ?? existing.model,
          updatedAt: now,
        }
      : { id, title, pinned: false, createdAt: now, updatedAt: now, provider, model, messages };
    return [session, ...sessions.filter((candidate) => candidate.id !== id)];
  });
}

export function groupSessions(sessions: Session[]) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((session) => session.pinned);
  const rest = sorted.filter((session) => !session.pinned);
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const groups: { label: string; items: Session[] }[] = [];
  const push = (label: string, items: Session[]) => {
    if (items.length) groups.push({ label, items });
  };
  push(
    "Today",
    rest.filter((session) => now - session.updatedAt < day),
  );
  push(
    "This week",
    rest.filter((session) => now - session.updatedAt >= day && now - session.updatedAt < 7 * day),
  );
  push(
    "Earlier",
    rest.filter((session) => now - session.updatedAt >= 7 * day),
  );
  return { pinned, groups };
}
