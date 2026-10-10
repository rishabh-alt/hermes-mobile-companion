import { HermesError } from "./client";
import { composeGatewayUrl } from "./profiles";
import type { HermesConfig } from "./types";

export async function steerRun(config: HermesConfig, runId: string, text: string) {
  const body = text.trim();
  if (!body) throw new HermesError("Steer text is empty.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token.trim()) headers["Authorization"] = `Bearer ${config.token.trim()}`;
  const response = await fetch(
    composeGatewayUrl(config, `/v1/runs/${encodeURIComponent(runId)}/steer`),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ text: body }),
    },
  );
  if (!response.ok) throw new HermesError("The host did not accept that steer.", response.status);
}

export function transcriptText(messages: Array<{ role: string; text: string }>): string {
  return messages
    .filter((message) => message.text.trim())
    .map((message) => `${message.role}: ${message.text.trim()}`)
    .join("\n\n");
}
