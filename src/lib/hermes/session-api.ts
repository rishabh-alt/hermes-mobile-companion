import { HermesError, requireSecureBaseUrl } from "./client";
import { api, type SessionInfo } from "./rest";
import type { HermesConfig } from "./types";

function sessionFrom(data: unknown): SessionInfo {
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const raw = payload["session"] ?? payload;
  if (!raw || typeof raw !== "object") {
    throw new Error("The gateway returned an invalid session response.");
  }
  const session = raw as Record<string, unknown>;
  if (typeof session["id"] !== "string" || !session["id"].trim()) {
    throw new Error("The gateway did not return a session id.");
  }
  return {
    id: session["id"],
    ...(typeof session["title"] === "string" ? { title: session["title"] } : {}),
    ...(typeof session["model"] === "string" ? { model: session["model"] } : {}),
    ...(typeof session["created_at"] === "string" || typeof session["created_at"] === "number"
      ? { created_at: session["created_at"] }
      : {}),
    ...(typeof session["updated_at"] === "string" || typeof session["updated_at"] === "number"
      ? { updated_at: session["updated_at"] }
      : {}),
  };
}

export interface SessionRuntime {
  provider: string;
  model: string;
  locked: boolean;
}

export async function lockSessionRuntime(
  config: HermesConfig,
  id: string,
  selection: { provider: string; model: string },
): Promise<SessionRuntime> {
  if (!selection.provider.trim() || !selection.model.trim()) {
    throw new Error("Choose both a provider and a model.");
  }
  const data = await api<unknown>(config, `/api/sessions/${encodeURIComponent(id)}/model`, {
    method: "POST",
    body: { provider: selection.provider, model: selection.model, require_model_lock: true },
  });
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const runtime = payload["runtime"];
  if (!runtime || typeof runtime !== "object") {
    throw new Error("The gateway did not acknowledge the selected route.");
  }
  const response = runtime as Record<string, unknown>;
  if (typeof response["provider"] !== "string" || typeof response["model"] !== "string") {
    throw new Error("The gateway returned an invalid route acknowledgement.");
  }
  return {
    provider: response["provider"],
    model: response["model"],
    locked: response["model_lock"] === true || response["model_lock"] === "accepted",
  };
}

export async function createGatewaySession(config: HermesConfig): Promise<SessionInfo> {
  const data = await api<unknown>(config, "/api/sessions", { method: "POST", body: {} });
  return sessionFrom(data);
}

export type SessionMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface SessionStreamHandlers {
  onText: (delta: string) => void;
  onCompleted: (event: {
    content: string;
    runtime?: { provider?: string; model?: string };
  }) => void;
  onError: (message: string) => void;
}

export async function streamGatewaySession({
  config,
  sessionId,
  message,
  provider,
  model,
  signal,
  handlers,
}: {
  config: HermesConfig;
  sessionId: string;
  message: SessionMessageContent;
  provider: string;
  model: string;
  signal: AbortSignal;
  handlers: SessionStreamHandlers;
}) {
  const base = requireSecureBaseUrl(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token.trim() ? { Authorization: `Bearer ${config.token.trim()}` } : {}),
      },
      body: JSON.stringify({
        message,
        provider,
        model,
        require_model_lock: true,
        model_options: {
          reasoning:
            config.reasoning === "off"
              ? { enabled: false }
              : { enabled: true, effort: config.reasoning },
          fast: config.fastMode,
        },
      }),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new HermesError("Can't reach the gateway. Check the URL, the tunnel, or your VPN.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new HermesError("The gateway rejected your token.", response.status);
  }
  if (!response.ok || !response.body) {
    throw new HermesError(`Gateway returned ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const dispatch = (frame: string) => {
    const lines = frame.split("\n");
    const event =
      lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim() ?? "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === "assistant.delta" && typeof payload["delta"] === "string")
      handlers.onText(payload["delta"]);
    if (event === "assistant.completed") {
      completed = true;
      const runtime = payload["runtime"] as Record<string, unknown> | undefined;
      handlers.onCompleted({
        content: typeof payload["content"] === "string" ? payload["content"] : "",
        ...(runtime ? { runtime: runtime as { provider?: string; model?: string } } : {}),
      });
    }
    if (event === "error")
      handlers.onError(
        typeof payload["message"] === "string" ? payload["message"] : "Hermes stream failed.",
      );
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    frames.forEach(dispatch);
  }
  if (buffer.trim()) dispatch(buffer);
  if (!completed) throw new HermesError("The stream ended before Hermes completed the turn.");
}
