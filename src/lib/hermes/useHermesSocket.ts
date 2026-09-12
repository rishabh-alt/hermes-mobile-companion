import { useEffect, useRef, useState } from "react";
import { normalizeBaseUrl } from "./client";
import { createClientId } from "./ids";
import type { HermesConfig } from "./types";

export type SocketState = "idle" | "connecting" | "open" | "closed";

export interface AgentEvent {
  id: string;
  kind: string;
  label: string;
  at: number;
}

function socketUrl(config: HermesConfig) {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base) return null;
  const url = base.replace(/^http/, "ws") + "/ws";
  const token = config.token.trim();
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/**
 * Optional realtime channel for agent status / thoughts / tool events.
 * Fails quietly: the chat stream works on its own.
 */
export function useHermesSocket(config: HermesConfig, enabled: boolean) {
  const [state, setState] = useState<SocketState>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const attempts = useRef(0);

  useEffect(() => {
    if (!enabled || !config.wsEnabled) {
      setState("idle");
      return;
    }
    const url = socketUrl(config);
    if (!url) return;

    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setState("connecting");
      try {
        socket = new WebSocket(url);
      } catch {
        setState("closed");
        return;
      }
      socket.onopen = () => {
        attempts.current = 0;
        setState("open");
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as Record<string, unknown>;
          const kind = String(data["type"] ?? data["event"] ?? "event");
          const label = String(
            data["message"] ?? data["status"] ?? data["name"] ?? data["content"] ?? kind,
          );
          setEvents((prev) => [
            ...prev.slice(-40),
            { id: createClientId(), kind, label, at: Date.now() },
          ]);
        } catch {
          /* ignore non-JSON frames */
        }
      };
      socket.onclose = () => {
        setState("closed");
        if (cancelled) return;
        attempts.current += 1;
        if (attempts.current > 5) return;
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempts.current, 15000));
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [config, enabled]);

  return { state, events };
}
