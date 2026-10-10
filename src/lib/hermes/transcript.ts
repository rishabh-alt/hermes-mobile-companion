import type { GatewayMessage } from "./rest";
import type { HermesMessage, ToolCall } from "./types";

function firstLine(value: string): string {
  return value.replace(/\\n/g, "\n").split("\n")[0]?.trim().slice(0, 180) ?? "";
}

/** Tool rows are work the host already did. Show the name, not the file or JSON. */
export function toolSummary(name: string, content: unknown): string {
  const raw = typeof content === "string" ? content.trim() : "";
  if (raw.startsWith("{")) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data["output"] === "string") return firstLine(data["output"]) || `${name} finished`;
      if (typeof data["content"] === "string") return `${name} read a file`;
      if (data["success"] === true) return `${name} finished`;
    } catch {
      return `${name} finished`;
    }
  }
  if (raw.startsWith("[")) return firstLine(raw) || `${name} finished`;
  return firstLine(raw) || `${name} finished`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const item = (part ?? {}) as Record<string, unknown>;
        return typeof item["text"] === "string" ? item["text"] : "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const item = content as Record<string, unknown>;
    if (typeof item["text"] === "string") return item["text"];
  }
  return "";
}

export function toHermesMessage(raw: GatewayMessage, index: number): HermesMessage {
  const created = raw.created_at
    ? typeof raw.created_at === "number"
      ? raw.created_at
      : Date.parse(raw.created_at) || Date.now()
    : Date.now();
  const base = {
    id: raw.id ?? `gw-${index}`,
    createdAt: created,
    model: raw.model,
    reasoning: raw.reasoning,
  };
  if (raw.role === "tool") {
    const name = raw.tool_name?.trim() || "tool";
    const call: ToolCall = {
      id: raw.id ?? `tool-${index}`,
      name,
      input: {},
      rawInput: "",
      output: toolSummary(name, raw.content),
      state: "output-available",
    };
    return { ...base, role: "assistant", text: "", tools: [call] };
  }
  const role = raw.role === "user" || raw.role === "system" ? raw.role : "assistant";
  return { ...base, role, text: textOf(raw.content) };
}
