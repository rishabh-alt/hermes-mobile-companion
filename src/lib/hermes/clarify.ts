import type { HermesConfig } from "./types";
import { HermesError } from "./client";
import { composeGatewayUrl } from "./profiles";

export interface ClarifyRequest {
  id: string;
  question: string;
  choices: string[];
}

export function parseClarify(payload: Record<string, unknown>): ClarifyRequest | null {
  const args =
    payload["args"] && typeof payload["args"] === "object"
      ? (payload["args"] as Record<string, unknown>)
      : payload;
  const question =
    typeof args["question"] === "string"
      ? args["question"]
      : typeof payload["preview"] === "string"
        ? payload["preview"]
        : "";
  const id =
    typeof args["clarify_id"] === "string"
      ? args["clarify_id"]
      : typeof payload["tool_call_id"] === "string"
        ? payload["tool_call_id"]
        : "";
  if (!question.trim() || !id.trim()) return null;
  const raw = Array.isArray(args["choices"]) ? args["choices"] : [];
  const choices = raw.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return { id, question: question.trim(), choices };
}

export async function answerClarify(config: HermesConfig, id: string, answer: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token.trim()) headers["Authorization"] = `Bearer ${config.token.trim()}`;
  const response = await fetch(composeGatewayUrl(config, "/api/clarify/answer"), {
    method: "POST",
    headers,
    body: JSON.stringify({ id, answer }),
  });
  if (!response.ok) throw new HermesError("The host did not take that answer.", response.status);
}
