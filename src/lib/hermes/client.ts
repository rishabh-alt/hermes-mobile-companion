import type {
  Attachment,
  Capability,
  HermesConfig,
  HermesMessage,
  HermesModel,
  MemoryPeer,
  ToolCall,
} from "./types";
import { createClientId } from "./ids";

export class HermesError extends Error {
  status?: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HermesError";
    this.status = status;
  }
}

export function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export function parseSecureBaseUrl(url: string) {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isSecureBaseUrl(url: string) {
  return parseSecureBaseUrl(url) !== null;
}

export function requireSecureBaseUrl(url: string) {
  const base = parseSecureBaseUrl(url);
  if (!base) {
    throw new HermesError("Enter a valid HTTPS gateway URL. Plain HTTP is not allowed.");
  }
  return base;
}

function headers(config: HermesConfig, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (config.token.trim()) h["Authorization"] = `Bearer ${config.token.trim()}`;
  return h;
}

async function request<T>(config: HermesConfig, path: string, init?: RequestInit): Promise<T> {
  const base = requireSecureBaseUrl(config.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers(config), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new HermesError("Can't reach the gateway. Check the URL, the tunnel, or your VPN.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HermesError("The gateway rejected your token.", res.status);
  }
  if (!res.ok) {
    throw new HermesError(`Gateway returned ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchModels(config: HermesConfig): Promise<HermesModel[]> {
  const data = await request<{ data?: HermesModel[] } | HermesModel[]>(config, "/v1/models");
  const list = Array.isArray(data) ? data : (data.data ?? []);
  return list.filter((m) => Boolean(m?.id));
}

export async function testConnection(config: HermesConfig) {
  const models = await fetchModels(config);
  return models;
}

/** Hermes-specific: capabilities/skills/MCP tools. Gracefully absent on plain gateways. */
export async function fetchCapabilities(config: HermesConfig): Promise<Capability[] | null> {
  const paths = ["/v1/capabilities", "/capabilities", "/v1/tools", "/tools"];
  for (const path of paths) {
    try {
      const data = await request<unknown>(config, path);
      const parsed = parseCapabilities(data);
      if (parsed) return parsed;
    } catch (err) {
      if (err instanceof HermesError && err.status && err.status !== 404) throw err;
    }
  }
  return null;
}

function parseCapabilities(data: unknown): Capability[] | null {
  const raw = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.["capabilities"] ??
      (data as Record<string, unknown>)?.["tools"] ??
      (data as Record<string, unknown>)?.["data"]);
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const fn = (o["function"] ?? {}) as Record<string, unknown>;
    return {
      name: String(o["name"] ?? fn["name"] ?? "unknown"),
      description: (o["description"] ?? fn["description"]) as string | undefined,
      kind: (o["server"] || o["mcp"]
        ? "mcp"
        : o["kind"] === "skill"
          ? "skill"
          : "tool") as Capability["kind"],
      enabled: o["enabled"] === undefined ? true : Boolean(o["enabled"]),
      server: o["server"] as string | undefined,
    };
  });
}

export async function fetchStatus(config: HermesConfig): Promise<Record<string, unknown> | null> {
  for (const path of ["/v1/status", "/status", "/health"]) {
    try {
      return await request<Record<string, unknown>>(config, path);
    } catch (err) {
      if (err instanceof HermesError && err.status && err.status !== 404) throw err;
    }
  }
  return null;
}

export async function fetchMemory(config: HermesConfig): Promise<MemoryPeer[] | null> {
  for (const path of ["/v1/memory/peers", "/memory/peers", "/v1/honcho/peers", "/memory"]) {
    try {
      const data = await request<unknown>(config, path);
      const raw = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>)?.["peers"] ??
          (data as Record<string, unknown>)?.["data"]);
      if (!Array.isArray(raw)) continue;
      return raw.map((item, i) => {
        const o = (item ?? {}) as Record<string, unknown>;
        const facts = o["facts"] ?? o["observations"] ?? o["context"];
        return {
          id: String(o["id"] ?? o["peer_id"] ?? i),
          name: String(o["name"] ?? o["peer_id"] ?? o["id"] ?? `peer ${i + 1}`),
          facts: Array.isArray(facts)
            ? facts.map((f) => (typeof f === "string" ? f : JSON.stringify(f)))
            : [],
          updatedAt: o["updated_at"] as string | undefined,
        };
      });
    } catch (err) {
      if (err instanceof HermesError && err.status && err.status !== 404) throw err;
    }
  }
  return null;
}

type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function toApiContent(message: HermesMessage): string | ContentPart[] {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return message.text;
  const parts: ContentPart[] = [];
  if (message.text.trim()) parts.push({ type: "text", text: message.text });
  for (const a of attachments) {
    if (a.mediaType.startsWith("image/"))
      parts.push({ type: "image_url", image_url: { url: a.url } });
    else parts.push({ type: "text", text: `[attached file: ${a.name} (${a.mediaType})]` });
  }
  return parts;
}

export interface StreamHandlers {
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onTools: (tools: ToolCall[]) => void;
}

interface StreamArgs {
  config: HermesConfig;
  provider?: string;
  model: string;
  messages: HermesMessage[];
  signal: AbortSignal;
  handlers: StreamHandlers;
}

export async function streamChat({
  config,
  provider,
  model,
  messages,
  signal,
  handlers,
}: StreamArgs) {
  const base = requireSecureBaseUrl(config.baseUrl);

  const body = {
    ...(provider ? { provider } : {}),
    model,
    stream: true,
    messages: messages.map((m) => ({ role: m.role, content: toApiContent(m) })),
  };

  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new HermesError("Can't reach the gateway. Check the URL, the tunnel, or your VPN.");
  }

  if (res.status === 401 || res.status === 403)
    throw new HermesError("The gateway rejected your token.", res.status);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new HermesError(text?.slice(0, 400) || `Gateway returned ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const toolMap = new Map<string, ToolCall>();
  let buffer = "";

  const flushTools = () => {
    if (!toolMap.size) return;
    handlers.onTools(
      Array.from(toolMap.values()).map((t) => ({
        ...t,
        input: safeParse(t.rawInput),
      })),
    );
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const choice = (json["choices"] as Array<Record<string, unknown>> | undefined)?.[0];
      const delta = (choice?.["delta"] ?? choice?.["message"]) as
        Record<string, unknown> | undefined;
      if (!delta) continue;

      const content = delta["content"];
      if (typeof content === "string" && content) handlers.onText(content);

      const reasoning = delta["reasoning_content"] ?? delta["reasoning"] ?? delta["thinking"];
      if (typeof reasoning === "string" && reasoning) handlers.onReasoning(reasoning);

      const toolCalls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          const index = String(call["index"] ?? call["id"] ?? toolMap.size);
          const id = String(call["id"] ?? index);
          const fn = (call["function"] ?? {}) as Record<string, unknown>;
          const existing = toolMap.get(index) ?? {
            id,
            name: "tool",
            input: undefined,
            rawInput: "",
            state: "input-streaming" as const,
          };
          if (typeof fn["name"] === "string" && fn["name"]) existing.name = fn["name"];
          if (typeof fn["arguments"] === "string") existing.rawInput += fn["arguments"];
          existing.state = "input-available";
          toolMap.set(index, existing);
        }
        flushTools();
      }

      // Hermes streams tool results back on the same channel
      const toolResult = delta["tool_result"] as Record<string, unknown> | undefined;
      if (toolResult) {
        const key = String(toolResult["tool_call_id"] ?? toolResult["id"] ?? "");
        const match =
          Array.from(toolMap.entries()).find(([k, v]) => k === key || v.id === key)?.[0] ??
          Array.from(toolMap.keys()).pop();
        if (match) {
          const t = toolMap.get(match)!;
          if (toolResult["error"]) {
            t.state = "output-error";
            t.errorText = String(toolResult["error"]);
          } else {
            t.state = "output-available";
            t.output = toolResult["output"] ?? toolResult["result"] ?? toolResult["content"];
          }
          toolMap.set(match, t);
          flushTools();
        }
      }
    }
  }
  flushTools();
}

function safeParse(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function fileToAttachment(file: File): Promise<Attachment> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return {
    id: createClientId(),
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    url,
  };
}
