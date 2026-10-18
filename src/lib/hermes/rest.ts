import type { HermesConfig } from "./types";
import { HermesError } from "./client";
import { parseApprovalRequest, type ApprovalRequest } from "./approval";
import { parseClarify, type ClarifyRequest } from "./clarify";
import { dashboardJson, dashboardUrlFromGateway } from "./dashboard";
import { parseModelOptions, type ModelOptionsSnapshot } from "./model-options";
import { composeGatewayUrl, parseProfileInventory } from "./profiles";

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
  root?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(
  config: HermesConfig,
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const url = composeGatewayUrl(config, path, { root: opts.root ?? false });

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

function dashboardBase(config: HermesConfig) {
  if (config.dashboardBaseUrl.trim()) return config.dashboardBaseUrl.trim();
  try {
    return dashboardUrlFromGateway(config.baseUrl);
  } catch {
    return "";
  }
}

function gatewayMiss(err: unknown) {
  return (
    err instanceof HermesError &&
    (err.status === 404 || err.status === undefined || /can't reach the gateway/i.test(err.message))
  );
}

async function apiOrDashboard<T>(
  config: HermesConfig,
  path: string,
  parse: (data: unknown) => T,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  try {
    return parse(await api(config, path, method === "GET" ? {} : { method, body }));
  } catch (err) {
    const base = dashboardBase(config);
    if (!base || !gatewayMiss(err)) throw err;
    return parse(await dashboardJson(base, path, method, body));
  }
}

/* ---------------------------------------------------------------- sessions */

export interface SessionInfo {
  id: string;
  title?: string;
  preview?: string;
  model?: string;
  message_count?: number;
  updated_at?: string | number;
  created_at?: string | number;
  last_active?: string | number;
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
  tool_name?: string;
}

export async function fetchSessionMessages(
  config: HermesConfig,
  id: string,
  limit = 200,
  signal?: AbortSignal,
) {
  const data = await api<unknown>(
    config,
    `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}&order=latest`,
    signal ? { signal } : {},
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

export function pinSession(config: HermesConfig, id: string, pinned: boolean) {
  return api<void>(config, `/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { pinned },
  });
}

export async function fetchActiveSessionPrompts(
  config: HermesConfig,
  id: string,
  signal?: AbortSignal,
): Promise<{ approval: ApprovalRequest | null; clarify: ClarifyRequest | null }> {
  try {
    const data = await api<unknown>(
      config,
      `/api/sessions/${encodeURIComponent(id)}`,
      signal ? { signal } : {},
    );
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const session =
      root["session"] && typeof root["session"] === "object"
        ? (root["session"] as Record<string, unknown>)
        : root;
    const activeRun =
      session["active_run"] && typeof session["active_run"] === "object"
        ? (session["active_run"] as Record<string, unknown>)
        : session;
    const isRunning =
      session["status"] === "running" ||
      session["status"] === "waiting" ||
      activeRun["status"] === "running" ||
      activeRun["status"] === "waiting" ||
      Boolean(session["pending_approval"] || session["pending_clarify"]) ||
      Boolean(activeRun["pending_approval"] || activeRun["pending_clarify"]);
    if (!isRunning) return { approval: null, clarify: null };
    const rawApproval = activeRun["pending_approval"] ?? session["pending_approval"];
    const rawClarify = activeRun["pending_clarify"] ?? session["pending_clarify"];
    return {
      approval:
        rawApproval && typeof rawApproval === "object"
          ? parseApprovalRequest(rawApproval as Record<string, unknown>)
          : null,
      clarify:
        rawClarify && typeof rawClarify === "object"
          ? parseClarify(rawClarify as Record<string, unknown>)
          : null,
    };
  } catch {
    return { approval: null, clarify: null };
  }
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
  return apiOrDashboard(config, "/api/skills", (data) => list<Skill>(data, "skills"));
}

export function skillContent(config: HermesConfig, name: string) {
  return apiOrDashboard(config, `/api/skills/content?name=${encodeURIComponent(name)}`, (data) =>
    data && typeof data === "object"
      ? (data as { content?: string; markdown?: string })
      : { content: typeof data === "string" ? data : "" },
  );
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
  return apiOrDashboard(config, "/api/mcp/servers", (data) => list<McpServer>(data, "servers"));
}

export function setMcpEnabled(config: HermesConfig, name: string, enabled: boolean) {
  return apiOrDashboard(
    config,
    `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
    () => undefined,
    "POST",
    { enabled },
  );
}

export function testMcpServer(config: HermesConfig, name: string) {
  return apiOrDashboard(
    config,
    `/api/mcp/servers/${encodeURIComponent(name)}/test`,
    (data) => (data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
    "POST",
  );
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
  return apiOrDashboard(config, "/api/tools", (data) =>
    list<{ name: string; description?: string; enabled?: boolean }>(data, "tools"),
  );
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
  return apiOrDashboard(config, "/api/messaging/platforms", (data) =>
    list<MessagingPlatform>(data, "platforms"),
  );
}

export function testMessagingPlatform(config: HermesConfig, id: string) {
  return apiOrDashboard(
    config,
    `/api/messaging/platforms/${encodeURIComponent(id)}/test`,
    (data) => (data && typeof data === "object" ? (data as Record<string, unknown>) : {}),
    "POST",
  );
}

export interface Webhook {
  name: string;
  enabled?: boolean;
  url?: string;
}

export async function listWebhooks(config: HermesConfig) {
  return apiOrDashboard(config, "/api/webhooks", (data) => list<Webhook>(data, "webhooks"));
}

export function setWebhookEnabled(config: HermesConfig, name: string, enabled: boolean) {
  return apiOrDashboard(
    config,
    `/api/webhooks/${encodeURIComponent(name)}/enabled`,
    () => undefined,
    "POST",
    { enabled },
  );
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

export interface CronRun {
  id?: string;
  session_id?: string;
  status?: string;
  started_at?: string | number;
  finished_at?: string | number;
  summary?: string;
  output?: string;
}

export interface CronDeliveryTarget {
  id: string;
  label: string;
  platform?: string;
}

export async function cronDeliveryTargets(config: HermesConfig): Promise<CronDeliveryTarget[]> {
  return apiOrDashboard(config, "/api/cron/delivery-targets", (data) => {
    const raw = list<unknown>(data, "targets", "delivery_targets", "channels");
    return raw
      .map((item): CronDeliveryTarget | null => {
        if (typeof item === "string" && item.trim()) {
          return { id: item.trim(), label: item.trim() };
        }
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const id = String(rec["id"] ?? rec["target"] ?? rec["name"] ?? "").trim();
          if (!id) return null;
          const label = String(rec["label"] ?? rec["name"] ?? id).trim();
          const platform = typeof rec["platform"] === "string" ? rec["platform"] : undefined;
          return { id, label, ...(platform ? { platform } : {}) };
        }
        return null;
      })
      .filter((item): item is CronDeliveryTarget => item !== null);
  });
}

export async function listCronJobs(config: HermesConfig) {
  return apiOrDashboard(config, "/api/cron/jobs", (data) => list<CronJob>(data, "jobs"));
}

export async function cronRuns(config: HermesConfig, jobId: string, limit = 20) {
  return apiOrDashboard(
    config,
    `/api/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`,
    (data) => list<CronRun>(data, "runs", "history"),
  );
}

export function cronAction(
  config: HermesConfig,
  jobId: string,
  action: "pause" | "resume" | "trigger",
) {
  return apiOrDashboard(
    config,
    `/api/cron/jobs/${encodeURIComponent(jobId)}/${action}`,
    () => undefined,
    "POST",
  );
}

export function createCronJob(
  config: HermesConfig,
  input: { name: string; schedule: string; prompt: string; deliver_to?: string },
) {
  return apiOrDashboard(config, "/api/cron/jobs", () => undefined, "POST", input);
}

export function updateCronJob(
  config: HermesConfig,
  jobId: string,
  input: { name?: string; schedule?: string; prompt?: string; deliver_to?: string },
) {
  return apiOrDashboard(
    config,
    `/api/cron/jobs/${encodeURIComponent(jobId)}`,
    () => undefined,
    "PATCH",
    input,
  );
}

export function deleteCronJob(config: HermesConfig, jobId: string) {
  return apiOrDashboard(
    config,
    `/api/cron/jobs/${encodeURIComponent(jobId)}`,
    () => undefined,
    "DELETE",
  );
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
  return apiOrDashboard(config, `/api/artifacts${q}`, (data) =>
    list<Artifact>(data, "artifacts", "files", "images"),
  );
}

/* ------------------------------------------------------------------ kanban */

export async function kanbanBoard(config: HermesConfig) {
  return apiOrDashboard(config, "/api/plugins/kanban/board", (data) =>
    data && typeof data === "object" ? (data as Record<string, unknown>) : {},
  );
}

/* ---------------------------------------------------------------- profiles */

export interface Profile {
  name: string;
  is_default?: boolean | undefined;
  model?: string | undefined;
  skills?: number | undefined;
  path?: string | undefined;
}

export async function fetchProfileInventory(config: HermesConfig) {
  const data = await api<unknown>(config, "/api/profiles", { root: true });
  return parseProfileInventory(data);
}

export async function listProfiles(config: HermesConfig) {
  return (await fetchProfileInventory(config)).profiles;
}

export function profileSoul(config: HermesConfig, name: string) {
  return apiOrDashboard(config, `/api/profiles/${encodeURIComponent(name)}/soul`, (data) =>
    data && typeof data === "object"
      ? (data as { content?: string; soul?: string })
      : { content: typeof data === "string" ? data : "" },
  );
}

export function updateProfileSoul(config: HermesConfig, name: string, content: string) {
  return apiOrDashboard(
    config,
    `/api/profiles/${encodeURIComponent(name)}/soul`,
    () => undefined,
    "PUT",
    { content, soul: content },
  );
}

export function saveProfileConfig(
  config: HermesConfig,
  name: string,
  input: { model?: string; is_default?: boolean; soul?: string },
) {
  return apiOrDashboard(
    config,
    `/api/profiles/${encodeURIComponent(name)}`,
    () => undefined,
    "PUT",
    input,
  );
}

/* ------------------------------------------------------------------ system */

export function gatewayStatus(config: HermesConfig) {
  return api<Record<string, unknown>>(config, "/api/status");
}

export function reloadHostGateway(config: HermesConfig) {
  return apiOrDashboard(config, "/api/reload", () => undefined, "POST");
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

export async function fetchModelOptions(
  config: HermesConfig,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<ModelOptionsSnapshot> {
  const payload = await api<unknown>(config, `/api/model/options${refresh ? "?refresh=1" : ""}`);
  return parseModelOptions(payload);
}

/** @deprecated Use fetchModelOptions for the complete typed gateway inventory. */
export async function modelOptions(config: HermesConfig) {
  const snapshot = await fetchModelOptions(config);
  return snapshot.providers.flatMap((provider) =>
    provider.models.map((id) => ({
      id,
      provider: provider.slug,
      label: provider.name,
      hidden: !provider.authenticated,
    })),
  );
}
