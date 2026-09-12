import type { HermesConfig } from "./types";
import { normalizeBaseUrl } from "./client";

/**
 * JSON-RPC client for the Hermes gateway WebSocket — the same transport the
 * Hermes desktop app uses (`prompt.submit`, `event` frames, `gateway.ping`).
 */

export interface RpcFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export type GatewayEvent = { type: string } & Record<string, unknown>;

type Listener = (event: GatewayEvent) => void;
type StateListener = (state: RpcState) => void;

export type RpcState = "idle" | "connecting" | "open" | "closed";

const PING_INTERVAL = 25_000;

export class HermesRpc {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  state: RpcState = "idle";

  constructor(private config: HermesConfig) {}

  private setState(state: RpcState) {
    this.state = state;
    this.stateListeners.forEach((l) => l(state));
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStateChange(listener: StateListener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  url() {
    const base = normalizeBaseUrl(this.config.baseUrl);
    if (!base) return "";
    const ws = base.replace(/^http/, "ws");
    const token = this.config.token.trim();
    return `${ws}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  connect() {
    if (typeof window === "undefined") return;
    const url = this.url();
    if (!url || this.socket) return;
    this.stopped = false;
    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.setState("open");
      this.ping = setInterval(() => {
        void this.call("gateway.ping", {}, 10_000).catch(() => undefined);
      }, PING_INTERVAL);
    };

    socket.onmessage = (raw) => {
      let frame: RpcFrame;
      try {
        frame = JSON.parse(String(raw.data)) as RpcFrame;
      } catch {
        return;
      }
      if (frame.id !== undefined && this.pending.has(frame.id)) {
        const entry = this.pending.get(frame.id)!;
        this.pending.delete(frame.id);
        clearTimeout(entry.timer);
        if (frame.error) entry.reject(new Error(frame.error.message ?? "Gateway error"));
        else entry.resolve(frame.result);
        return;
      }
      if (frame.method === "event" && frame.params?.["type"]) {
        this.listeners.forEach((l) => l(frame.params as GatewayEvent));
      }
    };

    socket.onclose = () => {
      this.cleanupSocket();
      this.setState("closed");
      if (!this.stopped) this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private cleanupSocket() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    this.socket = null;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Hermes gateway connection closed"));
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(15_000, 500 * 2 ** this.retry++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.cleanupSocket();
    this.setState("idle");
  }

  call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Hermes gateway is not connected"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Submit a turn. Completion arrives on the event channel, not this promise. */
  submitPrompt(params: {
    session_id?: string;
    text: string;
    model?: string;
    attachments?: unknown[];
  }) {
    return this.call("prompt.submit", params as Record<string, unknown>, 1_800_000);
  }

  interrupt(sessionId?: string) {
    return this.call("prompt.interrupt", sessionId ? { session_id: sessionId } : {}, 10_000);
  }
}

/* ------------------------------------------------------- event normalizing */

export type PromptEvent =
  | { kind: "text"; delta: string }
  | { kind: "reasoning"; delta: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input?: unknown;
      output?: unknown;
      error?: string;
      done: boolean;
    }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "status"; label: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pick(event: GatewayEvent, ...keys: string[]): unknown {
  for (const key of keys) if (event[key] !== undefined) return event[key];
  return undefined;
}

/**
 * Hermes gateways differ slightly in event naming between versions, so we match
 * on intent rather than on one exact string.
 */
export function normalizePromptEvent(event: GatewayEvent, sessionId?: string): PromptEvent | null {
  const evSession = str(pick(event, "session_id", "sessionId"));
  if (sessionId && evSession && evSession !== sessionId) return null;

  const type = event.type.toLowerCase();

  if (type.includes("error") || event["error"]) {
    const raw = pick(event, "error", "message");
    const message =
      typeof raw === "string"
        ? raw
        : str((raw as Record<string, unknown> | undefined)?.["message"]) ||
          "Hermes reported an error";
    return { kind: "error", message };
  }

  if (
    type.includes("complete") ||
    type.includes("finish") ||
    type.endsWith(".done") ||
    type === "done"
  ) {
    return { kind: "done" };
  }

  if (type.includes("tool")) {
    const id =
      str(pick(event, "tool_call_id", "call_id", "id")) || str(pick(event, "name", "tool"));
    const name = str(pick(event, "name", "tool", "tool_name")) || "tool";
    const output = pick(event, "output", "result", "content");
    const errText = str(pick(event, "error_text"));
    const done =
      type.includes("result") ||
      type.includes("output") ||
      type.includes("end") ||
      output !== undefined;
    const base = { kind: "tool" as const, id: id || name, name, done };
    const input = pick(event, "input", "arguments", "args", "params");
    return {
      ...base,
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(errText ? { error: errText } : {}),
    };
  }

  if (type.includes("reason") || type.includes("think")) {
    const delta = str(pick(event, "delta", "text", "content", "chunk"));
    if (!delta) return { kind: "status", label: "Thinking…" };
    return { kind: "reasoning", delta };
  }

  if (
    type.includes("text") ||
    type.includes("delta") ||
    type.includes("token") ||
    type.includes("chunk") ||
    type.includes("message")
  ) {
    const delta = str(pick(event, "delta", "text", "content", "chunk"));
    if (delta) return { kind: "text", delta };
    return null;
  }

  const label = str(pick(event, "label", "status", "message"));
  return label ? { kind: "status", label } : null;
}
