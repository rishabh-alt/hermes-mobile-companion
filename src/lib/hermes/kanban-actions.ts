import { HermesError } from "./client";
import { composeGatewayUrl } from "./profiles";
import type { HermesConfig } from "./types";

async function kanbanWrite(config: HermesConfig, path: string, method: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token.trim()) headers["Authorization"] = `Bearer ${config.token.trim()}`;
  const response = await fetch(composeGatewayUrl(config, path), {
    method,
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new HermesError("The board did not take that.", response.status);
}

export function commentOnCard(config: HermesConfig, taskId: string, body: string) {
  return kanbanWrite(
    config,
    `/api/plugins/kanban/tasks/${encodeURIComponent(taskId)}/comments`,
    "POST",
    {
      body,
      author: "phone",
    },
  );
}

export function moveCard(config: HermesConfig, taskId: string, status: "blocked" | "done") {
  return kanbanWrite(config, `/api/plugins/kanban/tasks/${encodeURIComponent(taskId)}`, "PATCH", {
    status,
  });
}
