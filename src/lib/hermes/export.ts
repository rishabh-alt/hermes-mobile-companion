import { visibleChatText } from "./transcript";
import type { HermesMessage } from "./types";

export interface ExportSessionMeta {
  sessionId: string;
  title?: string | undefined;
  profile?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  exportedAt?: string | undefined;
}

export function formatSessionMarkdown(messages: HermesMessage[], meta: ExportSessionMeta): string {
  const title = (meta.title || "Hermes Session").trim() || "Hermes Session";
  const headerLines = [
    `# ${title}`,
    "",
    `- **Session ID**: \`${meta.sessionId}\``,
    ...(meta.profile ? [`- **Profile**: \`${meta.profile}\``] : []),
    ...(meta.model ? [`- **Model**: \`${meta.model}\``] : []),
    ...(meta.provider ? [`- **Provider**: \`${meta.provider}\``] : []),
    `- **Exported**: ${meta.exportedAt || new Date().toISOString()}`,
    "",
    "---",
    "",
  ];

  const blocks = messages.map((msg) => {
    const roleHeading =
      msg.role === "user" ? "## User" : msg.role === "assistant" ? "## Hermes" : "## System";
    const parts: string[] = [roleHeading];

    if (msg.reasoning?.trim()) {
      parts.push(`<details><summary>Reasoning</summary>\n\n${msg.reasoning.trim()}\n\n</details>`);
    }

    if (msg.tools?.length) {
      const toolLines = msg.tools.map((tool) => {
        const inputStr =
          typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input ?? {});
        return `- **Tool \`${tool.name}\`** (${tool.state}): \`${inputStr.slice(0, 200)}\``;
      });
      parts.push(toolLines.join("\n"));
    }

    const cleanText = visibleChatText(msg.text).trim();
    if (cleanText) {
      parts.push(cleanText);
    }

    if (msg.attachments?.length) {
      const attLines = msg.attachments.map((a) => `- Attachment: \`${a.name}\` (${a.mediaType})`);
      parts.push(attLines.join("\n"));
    }

    return parts.join("\n\n");
  });

  return [...headerLines, blocks.join("\n\n---\n\n"), ""].join("\n");
}

export function formatSessionJson(messages: HermesMessage[], meta: ExportSessionMeta): string {
  return JSON.stringify(
    {
      sessionId: meta.sessionId,
      title: meta.title || "Hermes Session",
      profile: meta.profile || "default",
      model: meta.model || "",
      provider: meta.provider || "",
      exportedAt: meta.exportedAt || new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: visibleChatText(m.text),
        ...(m.reasoning ? { reasoning: m.reasoning } : {}),
        ...(m.tools?.length ? { tools: m.tools } : {}),
        ...(m.attachments?.length
          ? {
              attachments: m.attachments.map((a) => ({
                id: a.id,
                name: a.name,
                mediaType: a.mediaType,
              })),
            }
          : {}),
        createdAt: m.createdAt,
        ...(m.model ? { model: m.model } : {}),
      })),
    },
    null,
    2,
  );
}

export function safeExportFilename(title: string | undefined, ext: "md" | "json"): string {
  const slug = (title || "hermes-session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "hermes-session"}.${ext}`;
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function messageMatchesQuery(message: HermesMessage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (visibleChatText(message.text).toLowerCase().includes(q)) return true;
  if (message.reasoning?.toLowerCase().includes(q)) return true;
  if (
    message.tools?.some(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.rawInput.toLowerCase().includes(q) ||
        (typeof t.output === "string" && t.output.toLowerCase().includes(q)),
    )
  ) {
    return true;
  }
  if (message.attachments?.some((a) => a.name.toLowerCase().includes(q))) return true;
  return false;
}
