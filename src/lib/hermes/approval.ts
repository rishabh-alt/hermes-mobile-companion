import type { HermesConfig } from "./types";
import { HermesError } from "./client";
import { composeGatewayUrl } from "./profiles";

const CHOICES = ["once", "session", "always", "deny"] as const;
export type ApprovalChoice = (typeof CHOICES)[number];

export interface ApprovalRequest {
  runId: string;
  command: string;
  choices: ApprovalChoice[];
  requestId?: string;
}

export function parseApprovalRequest(payload: Record<string, unknown>): ApprovalRequest | null {
  const runId = typeof payload["run_id"] === "string" ? payload["run_id"].trim() : "";
  const command = typeof payload["command"] === "string" ? payload["command"] : "";
  if (!runId || !command) return null;
  const raw = Array.isArray(payload["choices"]) ? payload["choices"] : CHOICES;
  const choices = raw.filter((item): item is ApprovalChoice =>
    CHOICES.includes(item as ApprovalChoice),
  );
  const requestId = typeof payload["request_id"] === "string" ? payload["request_id"].trim() : "";
  return {
    runId,
    command,
    choices: choices.length > 0 ? choices : ["once", "deny"],
    ...(requestId ? { requestId } : {}),
  };
}

export async function respondToApproval(
  config: HermesConfig,
  response: { runId: string; choice: ApprovalChoice; requestId?: string },
): Promise<void> {
  const body: { choice: ApprovalChoice; request_id?: string } = { choice: response.choice };
  if (response.requestId) body.request_id = response.requestId;
  let result: Response;
  try {
    result = await fetch(
      composeGatewayUrl(config, `/v1/runs/${encodeURIComponent(response.runId)}/approval`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.token.trim() ? { Authorization: `Bearer ${config.token.trim()}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new HermesError("Can't reach the gateway.");
  }
  if (!result.ok) throw new HermesError("The host did not accept that approval.", result.status);
}
