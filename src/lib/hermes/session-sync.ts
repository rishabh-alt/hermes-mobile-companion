import { fetchSessionMessages, type GatewayMessage } from "./rest";
import type { HermesConfig, HermesMessage, Role } from "./types";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const o = (part ?? {}) as Record<string, unknown>;
        if (typeof o["text"] === "string") return o["text"];
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o["text"] === "string") return o["text"];
  }
  return "";
}

function toHermesMessage(raw: GatewayMessage, index: number): HermesMessage {
  const role: Role = raw.role === "user" || raw.role === "system" ? raw.role : "assistant";
  const created = raw.created_at
    ? typeof raw.created_at === "number"
      ? raw.created_at
      : Date.parse(raw.created_at) || Date.now()
    : Date.now();
  return {
    id: raw.id ?? `gw-${index}`,
    role,
    text: textOf(raw.content),
    reasoning: raw.reasoning,
    createdAt: created,
    model: raw.model,
  };
}

/** Pulls a conversation from the Mac into the phone so it can be read and continued. */
export async function pullSession(config: HermesConfig, id: string) {
  const raw = await fetchSessionMessages(config, id);
  return raw.map(toHermesMessage);
}
