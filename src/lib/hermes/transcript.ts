import type { GatewayMessage } from "./rest";
import type { Attachment, HermesMessage, ToolCall } from "./types";

function firstLine(value: string): string {
  return value.replace(/\\n/g, "\n").split("\n")[0]?.trim().slice(0, 180) ?? "";
}

/** Tool rows are work the host already did. Show the name, not the file or JSON. */
export function toolSummary(name: string, content: unknown): string {
  const raw = typeof content === "string" ? content.trim() : "";
  if (raw.startsWith("{")) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data["output"] === "string" && !data["output"].trim().startsWith("{"))
        return firstLine(data["output"]) || `${name} finished`;
      if (typeof data["content"] === "string") return `${name} read a file`;
      if (typeof data["total_count"] === "number")
        return `${name} · ${data["total_count"]} matches`;
      return `${name} finished`;
    } catch {
      return `${name} finished`;
    }
  }
  if (raw.startsWith("[")) return `${name} finished`;
  return firstLine(raw) || `${name} finished`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return visibleChatText(content);
  if (Array.isArray(content)) {
    return visibleChatText(
      content
        .map((part) => {
          const item = (part ?? {}) as Record<string, unknown>;
          return typeof item["text"] === "string" ? item["text"] : "";
        })
        .join("\n")
        .trim(),
    );
  }
  if (content && typeof content === "object") {
    const item = content as Record<string, unknown>;
    if (typeof item["text"] === "string") return visibleChatText(item["text"]);
  }
  return "";
}

function imageAttachmentsOf(content: unknown, messageId: string): Attachment[] {
  const parts = Array.isArray(content)
    ? content
    : content && typeof content === "object"
      ? [content]
      : [];
  const attachments: Attachment[] = [];
  parts.forEach((part, index) => {
    if (!part || typeof part !== "object") return;
    const item = part as Record<string, unknown>;
    if (item["type"] !== "image_url" && item["type"] !== "image") return;
    const imageUrl = item["image_url"];
    const url =
      typeof imageUrl === "string"
        ? imageUrl
        : imageUrl && typeof imageUrl === "object"
          ? String((imageUrl as Record<string, unknown>)["url"] ?? "")
          : typeof item["url"] === "string"
            ? item["url"]
            : "";
    if (!url.trim()) return;
    const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);/i.exec(url);
    attachments.push({
      id: `${messageId}-img-${index}`,
      name: typeof item["name"] === "string" ? item["name"] : `image-${index + 1}`,
      mediaType: mimeMatch?.[1] ?? "image/jpeg",
      url,
    });
  });
  return attachments;
}

/** Host notes injected for the model must not appear in the phone bubble. */
export function visibleChatText(text: string): string {
  return text
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/gi, "")
    .replace(/<memory-context>[\s\S]*$/gi, "")
    .replace(/\n*\[System note: The following is recalled memory context[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toHermesMessage(raw: GatewayMessage, index: number): HermesMessage {
  const created = raw.created_at
    ? typeof raw.created_at === "number"
      ? raw.created_at
      : Date.parse(raw.created_at) || Date.now()
    : Date.now();
  const id = raw.id ?? `gw-${index}`;
  const base = {
    id,
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
  const attachments = imageAttachmentsOf(raw.content, id);
  return {
    ...base,
    role,
    text: textOf(raw.content),
    ...(attachments.length ? { attachments } : {}),
  };
}
