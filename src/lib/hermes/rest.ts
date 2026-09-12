import type { HermesConfig } from "./types";
import { HermesError, requireSecureBaseUrl } from "./client";

/**
 * Thin client for the Hermes gateway REST surface (`/api/*`), matching the
 * endpoints the Hermes desktop app uses.
 */
function authHeaders(config: HermesConfig, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const token = config.token.trim();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  profile?: string | null;
  signal?: AbortSignal;
}

export async function api<T>(
  config: HermesConfig,
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const base = requireSecureBaseUrl(config.baseUrl);

  let url = `${base}${path}`;
  if (opts.profile) {
    url += `${url.includes("?") ? "&" : "?"}profile=${encodeURIComponent(opts.profile)}`;
  }

  let res: Response;
  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: authHeaders(config),
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;
    res = await fetch(url, init);
  } catch {
    throw new HermesError("Can't reach the gateway. Check the URL, the tunnel, or your VPN.");
  }

  if (res.status === 401 || res.status === 403) {
    throw new HermesError("The gateway rejected your token.", res.status);
  }
  if (res.status === 404) {
    throw new HermesError("This gateway doesn't offer that yet.", 404);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HermesError(text.slice(0, 300) || `Gateway returned ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** True when the gateway simply doesn't implement the endpoint. */
export function isMissing(err: unknown) {
  return err instanceof HermesError && err.status === 404;
}

function list<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  const o = (data ?? {}) as Record<string, unknown>;
  for (const key of [...keys, "items", "data", "results"]) {
    if (Array.isArray(o[key])) return o[key] as T[];
  }
  return [];
}

/* ---------------------------------------------------------------- sessions */

export interface SessionInfo {
  id: string;
  title?: string;
  model?: string;
  message_count?: number;
  updated_at?: string | number;
  created_at?: string | number;
  pinned?: boolean;
  source?: string;
}

export async function listSessions(config: HermesConfig, limit = 60) {
  const data = await api<unknown>(config, `/api/sessions?limit=${limit}&offset=0&min_messages=0`);
  return list<SessionInfo>(data, "sessions");
}

export async function searchSessions(config: HermesConfig, q: string) {
  const data = await api<unknown>(config, `/api/sessions/search?q=${encodeURIComponent(q)}`);
  return list<SessionInfo>(data, "sessions", "results");
}

export interface GatewayMessage {
  id?: string;
  role?: string;
  content?: unknown;
  created_at?: string | number;
  reasoning?: string;
  model?: string;
}

export async function fetchSessionMessages(config: HermesConfig, id: string, limit = 200) {
  const data = await api<unknown>(
    config,
    `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`,
  );
  return list<GatewayMessage>(data, "messages");
}

export function deleteSession(config: HermesConfig, id: string) {
  return api<void>(config, `/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function renameSession(config: HermesConfig, id: string, title: string) {
  return api<void>(config, `/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { title },
  });
}

/* ------------------------------------------------------------------ skills */

export interface Skill {
  name: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  version?: string;
  uses?: number;
}

export async function listSkills(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/skills");
  return list<Skill>(data, "skills");
}

export function skillContent(config: HermesConfig, name: string) {
  return api<{ content?: string }>(config, `/api/skills/content?name=${encodeURIComponent(name)}`);
}

/* --------------------------------------------------------------------- mcp */

export interface McpServer {
  name: string;
  enabled?: boolean;
  status?: string;
  command?: string;
  url?: string;
  tools?: unknown[];
}

export async function listMcpServers(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/mcp/servers");
  return list<McpServer>(data, "servers");
}

export function setMcpEnabled(config: HermesConfig, name: string, enabled: boolean) {
  return api<void>(config, `/api/mcp/servers/${encodeURIComponent(name)}/enabled`, {
    method: "POST",
    body: { enabled },
  });
}

export function testMcpServer(config: HermesConfig, name: string) {
  return api<Record<string, unknown>>(config, `/api/mcp/servers/${encodeURIComponent(name)}/test`, {
    method: "POST",
  });
}

/* ---------------------------------------------------------------- toolsets */

export interface Toolset {
  name: string;
  description?: string;
  enabled?: boolean;
  provider?: string;
  model?: string;
}

export async function listToolsets(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/tools/toolsets");
  return list<Toolset>(data, "toolsets");
}

/* ------------------------------------------------------------------- tools */

export async function listTools(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/tools");
  return list<{ name: string; description?: string; enabled?: boolean }>(data, "tools");
}

/* ---------------------------------------------------------------- messaging */

export interface MessagingPlatform {
  id: string;
  name?: string;
  connected?: boolean;
  enabled?: boolean;
  status?: string;
  description?: string;
}

export async function listMessagingPlatforms(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/messaging/platforms");
  return list<MessagingPlatform>(data, "platforms");
}

export function testMessagingPlatform(config: HermesConfig, id: string) {
  return api<Record<string, unknown>>(
    config,
    `/api/messaging/platforms/${encodeURIComponent(id)}/test`,
    { method: "POST" },
  );
}

export interface Webhook {
  name: string;
  enabled?: boolean;
  url?: string;
}

export async function listWebhooks(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/webhooks");
  return list<Webhook>(data, "webhooks");
}

export function setWebhookEnabled(config: HermesConfig, name: string, enabled: boolean) {
  return api<void>(config, `/api/webhooks/${encodeURIComponent(name)}/enabled`, {
    method: "POST",
    body: { enabled },
  });
}

/* -------------------------------------------------------------------- cron */

export interface CronJob {
  id: string;
  name?: string;
  status?: string;
  schedule?: string;
  prompt?: string;
  next_run?: string | number;
  last_run?: string | number;
  paused?: boolean;
  deliver_to?: string;
}

export async function listCronJobs(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/cron/jobs");
  return list<CronJob>(data, "jobs");
}

export async function cronRuns(config: HermesConfig, jobId: string, limit = 20) {
  const data = await api<unknown>(
    config,
    `/api/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`,
  );
  return list<{ id?: string; status?: string; started_at?: string | number; summary?: string }>(
    data,
    "runs",
  );
}

export function cronAction(
  config: HermesConfig,
  jobId: string,
  action: "pause" | "resume" | "trigger",
) {
  return api<void>(config, `/api/cron/jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: "POST",
  });
}

/* ---------------------------------------------------------------- artifacts */

export interface Artifact {
  id?: string;
  name?: string;
  path?: string;
  kind?: string;
  mime?: string;
  session_id?: string;
  session_title?: string;
  created_at?: string | number;
  url?: string;
}

export async function listArtifacts(config: HermesConfig, kind?: string) {
  const q = kind && kind !== "all" ? `?kind=${encodeURIComponent(kind)}` : "";
  const data = await api<unknown>(config, `/api/artifacts${q}`);
  return list<Artifact>(data, "artifacts", "files", "images");
}

/* ------------------------------------------------------------------ kanban */

export async function kanbanBoard(config: HermesConfig) {
  return api<Record<string, unknown>>(config, "/api/plugins/kanban/board");
}

/* ---------------------------------------------------------------- profiles */

export interface Profile {
  name: string;
  is_default?: boolean;
  model?: string;
  skills?: number;
  path?: string;
}

export async function listProfiles(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/profiles");
  return list<Profile>(data, "profiles");
}

export function profileSoul(config: HermesConfig, name: string) {
  return api<{ content?: string; soul?: string }>(
    config,
    `/api/profiles/${encodeURIComponent(name)}/soul`,
  );
}

/* ------------------------------------------------------------------ system */

export function gatewayStatus(config: HermesConfig) {
  return api<Record<string, unknown>>(config, "/api/status");
}

export async function usageAnalytics(config: HermesConfig, days = 7) {
  return api<Record<string, unknown>>(config, `/api/analytics/usage?days=${days}`);
}

export interface ModelOption {
  id: string;
  provider?: string;
  label?: string;
  hidden?: boolean;
}

export async function modelOptions(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/model/options");
  return list<ModelOption>(data, "models", "options");
}
