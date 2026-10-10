import type { HermesConfig } from "./types";
import { HermesError } from "./client";
import { readEventStream } from "./event-stream";
import { composeGatewayUrl } from "./profiles";

export interface WatchFrame {
  event: string;
  payload: Record<string, unknown>;
}

export function parseWatchFrame(frame: string): WatchFrame | null {
  const lines = frame.split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!event || !data) return null;
  try {
    const payload = JSON.parse(data) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return { event, payload: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function followHostWatch(
  config: HermesConfig,
  path: string,
  onFrame: (frame: WatchFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(composeGatewayUrl(config, path), {
      headers: config.token.trim() ? { Authorization: `Bearer ${config.token.trim()}` } : {},
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    throw new HermesError("Can't reach the gateway.");
  }
  if (response.status === 404) {
    throw new HermesError("This gateway is not pushing live updates yet.", 404);
  }
  if (!response.ok || !response.body) {
    throw new HermesError("The host watch did not open.", response.status);
  }
  await readEventStream(response.body, (frame) => {
    const parsed = parseWatchFrame(frame);
    if (parsed) onFrame(parsed);
  });
}
