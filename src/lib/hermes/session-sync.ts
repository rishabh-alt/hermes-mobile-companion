import { fetchSessionMessages } from "./rest";
import { toHermesMessage } from "./transcript";
import type { HermesConfig, HermesMessage } from "./types";

export async function pullSession(config: HermesConfig, id: string, signal?: AbortSignal) {
  const raw = await fetchSessionMessages(config, id, 200, signal);
  return raw.map(toHermesMessage);
}

function tailText(messages: HermesMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.text.trim())
      ?.text.trim() ?? ""
  );
}

function lastUserIndex(messages: HermesMessage[], text: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.text.trim() === text) return index;
  }
  return -1;
}

/** A host page that does not contain the turn on screen must not delete it. */
export function mergePulledMessages(local: HermesMessage[], pulled: HermesMessage[]) {
  if (!pulled.length) return local;
  const lastUser = tailText(local);
  const pulledAt = lastUser ? lastUserIndex(pulled, lastUser) : -1;
  if (lastUser && pulledAt < 0) return local;
  const localAt = lastUser ? lastUserIndex(local, lastUser) : -1;
  const localReply = local
    .slice(localAt + 1)
    .find((message) => message.role === "assistant" && message.text.trim());
  const pulledReply = pulled
    .slice(pulledAt + 1)
    .find((message) => message.role === "assistant" && message.text.trim());
  if (localReply && !pulledReply) return local;
  return pulled;
}
