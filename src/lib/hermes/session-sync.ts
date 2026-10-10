import { fetchSessionMessages } from "./rest";
import { toHermesMessage } from "./transcript";
import type { HermesConfig } from "./types";

export async function pullSession(config: HermesConfig, id: string, signal?: AbortSignal) {
  const raw = await fetchSessionMessages(config, id, 200, signal);
  return raw.map(toHermesMessage);
}
