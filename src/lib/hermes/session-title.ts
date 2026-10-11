const PLACEHOLDERS = new Set(["", "Session", "New chat"]);

export function sessionLabel(input: {
  id?: string;
  title?: string;
  preview?: string;
  messages?: Array<{ role?: string; text?: string }>;
}): string {
  const title = input.title?.trim() ?? "";
  if (title && !PLACEHOLDERS.has(title) && title !== input.id) return title;
  const preview = input.preview?.trim();
  if (preview) return preview;
  const first = input.messages?.find((message) => message.role === "user" && message.text?.trim());
  if (first?.text) return first.text.trim().replace(/\s+/g, " ");
  return "New chat";
}
