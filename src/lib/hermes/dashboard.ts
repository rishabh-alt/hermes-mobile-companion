import { CapacitorHttp } from "@capacitor/core";
import { HermesError } from "./client";
import { getDashboardCookie, setDashboardCookie, setDashboardPassword } from "./secure-storage";

export function normalizeDashboardUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Dashboard address must be a full https URL.");
  }
  if (url.protocol !== "https:") throw new Error("Dashboard address must use https.");
  if (url.username || url.password)
    throw new Error("Do not put a password in the dashboard address.");
  if (url.search || url.hash)
    throw new Error("Dashboard address cannot include a query or fragment.");
  return url.toString().replace(/\/$/, "");
}

export function dashboardUrlFromGateway(gatewayUrl: string): string {
  const base = new URL(gatewayUrl);
  if (base.protocol !== "https:" || (base.pathname !== "/" && base.pathname !== "")) {
    throw new Error("Add /dashboard yourself when the chat address already has a path.");
  }
  return `${base.origin}/dashboard`;
}

export function cookieHeader(setCookie: string): string {
  return setCookie
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((part) => part.includes("=") && !part.toLowerCase().startsWith("path="))
    .join("; ");
}

function isRedacted(value: string) {
  return /\*{3,}|redacted|\[set]/i.test(value);
}

export function sanitizePairingUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Scan or paste an https gateway address.");
  let candidate = trimmed;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed["token"] || parsed["password"] || parsed["adminToken"] || parsed["apiKey"]) {
        throw new Error(
          "Refusing QR payload that contains a token or password. Scan an address-only QR code.",
        );
      }
      candidate = String(parsed["baseUrl"] ?? parsed["url"] ?? "").trim();
    } catch (err) {
      if (err instanceof Error && /Refusing QR/i.test(err.message)) throw err;
      throw new Error("Invalid QR payload. Expected an https gateway address.");
    }
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Gateway address must be a full https URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Gateway address must use https.");
  }
  if (url.username || url.password) {
    throw new Error("Do not include credentials in a gateway QR code or link.");
  }
  if (url.search || url.hash) {
    throw new Error("Gateway QR address cannot include query parameters or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

async function dashboardRequest(
  base: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
) {
  const url = `${normalizeDashboardUrl(base)}${path}`;
  const cookie = await getDashboardCookie();
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await CapacitorHttp.request({
    url,
    method,
    headers,
    ...(body !== undefined ? { data: body } : {}),
    connectTimeout: 12_000,
    readTimeout: 12_000,
    responseType: "text",
  });
  const fresh = cookieHeader(
    response.headers?.["set-cookie"] || response.headers?.["Set-Cookie"] || "",
  );
  if (fresh) await setDashboardCookie(cookie ? `${cookie}; ${fresh}` : fresh);
  const text =
    typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
  return { status: response.status, text };
}

export async function dashboardJson(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
) {
  const response = await dashboardRequest(baseUrl, path, method, body);
  if (response.status === 401) throw new HermesError("Sign in to the dashboard in Settings.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not open that page.", response.status);
  }
  if (!response.text.trim()) return null;
  return JSON.parse(response.text) as unknown;
}

export async function signInToDashboard(input: {
  baseUrl: string;
  username: string;
  password: string;
}) {
  const username = input.username.trim();
  if (!username || !input.password) throw new Error("Username and password are both required.");
  const response = await dashboardRequest(input.baseUrl, "/auth/password-login", "POST", {
    provider: "basic",
    username,
    password: input.password,
  });
  if (response.status === 401 || response.status === 403) {
    throw new HermesError("The dashboard rejected that username or password.", response.status);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not sign in.", response.status);
  }
  await setDashboardPassword(input.password);
  const config = await dashboardRequest(input.baseUrl, "/api/config", "GET");
  if (config.status === 401) {
    throw new HermesError("Signed in, but the dashboard did not keep the session.", 401);
  }
  if (config.status < 200 || config.status >= 300) {
    throw new HermesError("The dashboard did not open settings.", config.status);
  }
}

export function mainModelFromConfig(payload: unknown): { provider: string; model: string } {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const config =
    root["config"] && typeof root["config"] === "object"
      ? (root["config"] as Record<string, unknown>)
      : root;
  const model = config["model"];
  if (model && typeof model === "object") {
    const row = model as Record<string, unknown>;
    return {
      provider: typeof row["provider"] === "string" ? row["provider"] : "",
      model:
        typeof row["default"] === "string"
          ? row["default"]
          : typeof row["name"] === "string"
            ? row["name"]
            : "",
    };
  }
  return { provider: "", model: typeof model === "string" ? model : "" };
}

export async function readDashboardModel(baseUrl: string) {
  const response = await dashboardRequest(baseUrl, "/api/config", "GET");
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not return the main model.", response.status);
  }
  return mainModelFromConfig(JSON.parse(response.text) as unknown);
}

export async function saveDashboardModel(
  baseUrl: string,
  selection: { provider: string; model: string },
) {
  const provider = selection.provider.trim();
  const model = selection.model.trim();
  if (!provider || !model) throw new Error("Choose both a provider and a model.");
  if (isRedacted(provider) || isRedacted(model)) {
    throw new Error("That value is hidden. Type the real model, not a redacted placeholder.");
  }
  const response = await dashboardRequest(baseUrl, "/api/model/set", "POST", {
    scope: "main",
    provider,
    model,
  });
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not save that model.", response.status);
  }
  return readDashboardModel(baseUrl);
}

export interface DashboardProfileRow {
  name: string;
  label: string;
  model: string;
  isDefault: boolean;
}

export async function listDashboardProfiles(baseUrl: string): Promise<{
  profiles: DashboardProfileRow[];
  active: string;
  restartRequired: boolean;
}> {
  const response = await dashboardRequest(baseUrl, "/api/profiles", "GET");
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not return profiles.", response.status);
  }
  const data = JSON.parse(response.text) as Record<string, unknown>;
  const rawProfiles = data["profiles"];
  const rows = Array.isArray(rawProfiles) ? rawProfiles : [];
  return {
    active: String(data["active_profile"] ?? "default"),
    restartRequired: data["restart_required"] === true || data["gateway_running"] === true,
    profiles: rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const name = String(item["name"] ?? "").trim();
      if (!name) return [];
      return [
        {
          name,
          label: String(item["alias"] || item["description"] || name),
          model: String(item["model"] ?? ""),
          isDefault: item["is_default"] === true,
        },
      ];
    }),
  };
}

export async function setDashboardActiveProfile(baseUrl: string, name: string) {
  const response = await dashboardRequest(baseUrl, "/api/profiles/active", "POST", { name });
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not switch that profile.", response.status);
  }
  return JSON.parse(response.text) as Record<string, unknown>;
}

export interface DashboardField {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "array";
  description: string;
  options: string[];
  value: unknown;
}

const SECTION_CATEGORIES: Record<string, string[]> = {
  chat: ["agent", "attachments"],
  workspace: ["terminal"],
  safety: ["security"],
  browser: ["browser"],
  memory: ["memory", "compression"],
  voice: ["voice", "tts", "stt"],
  providers: ["openrouter", "bedrock", "auxiliary"],
  gateway: ["gateway", "streaming"],
  tools: ["tools", "tool_output", "tool_loop_guardrails"],
  sessions: ["sessions"],
  runtime: ["delegation", "local_runtime"],
};

function valueAt(config: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, config);
}

function nestValue(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split(".");
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    const next: Record<string, unknown> = {};
    cursor[part] = next;
    cursor = next;
  }
  cursor[parts[parts.length - 1] ?? key] = value;
  return root;
}

export async function readDashboardSection(
  baseUrl: string,
  sectionId: string,
): Promise<DashboardField[]> {
  const categories = new Set(SECTION_CATEGORIES[sectionId] ?? []);
  const [schema, saved] = await Promise.all([
    dashboardRequest(baseUrl, "/api/config/schema", "GET"),
    dashboardRequest(baseUrl, "/api/config", "GET"),
  ]);
  if (schema.status === 401 || saved.status === 401) {
    throw new HermesError("Sign in to the dashboard again.", 401);
  }
  if (schema.status < 200 || schema.status >= 300 || saved.status < 200 || saved.status >= 300) {
    throw new HermesError("The dashboard did not open this section.", schema.status);
  }
  const schemaBody = JSON.parse(schema.text) as Record<string, unknown>;
  const savedBody = JSON.parse(saved.text) as Record<string, unknown>;
  const rawFields = schemaBody["fields"];
  const fields =
    rawFields && typeof rawFields === "object" ? (rawFields as Record<string, unknown>) : {};
  const rawConfig = savedBody["config"];
  const values =
    rawConfig && typeof rawConfig === "object" ? (rawConfig as Record<string, unknown>) : {};
  return Object.entries(fields)
    .flatMap(([key, raw]) => {
      if (!raw || typeof raw !== "object") return [];
      const field = raw as Record<string, unknown>;
      if (!categories.has(String(field["category"] ?? ""))) return [];
      const rawType = String(field["type"] ?? "");
      const currentVal = valueAt(values, key);
      const type =
        rawType === "list" || rawType === "array" || Array.isArray(currentVal) ? "array" : rawType;
      if (
        type !== "string" &&
        type !== "number" &&
        type !== "boolean" &&
        type !== "select" &&
        type !== "array"
      )
        return [];
      if (/api_key|token|secret|password/i.test(key)) return [];
      const options = field["options"];
      return [
        {
          key,
          type: type as DashboardField["type"],
          description: String(field["description"] ?? ""),
          options: Array.isArray(options) ? options.map(String) : [],
          value: currentVal,
        },
      ];
    })
    .slice(0, 120);
}

export async function saveDashboardValue(
  baseUrl: string,
  key: string,
  value: unknown,
): Promise<{ savedValue: unknown }> {
  const response = await dashboardRequest(baseUrl, "/api/config", "PUT", {
    config: nestValue(key, value),
  });
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not save that setting.", response.status);
  }
  const verify = await dashboardRequest(baseUrl, "/api/config", "GET");
  if (verify.status >= 200 && verify.status < 300 && verify.text.trim()) {
    try {
      const savedBody = JSON.parse(verify.text) as Record<string, unknown>;
      const rawConfig = savedBody["config"] ?? savedBody;
      const values =
        rawConfig && typeof rawConfig === "object" ? (rawConfig as Record<string, unknown>) : {};
      return { savedValue: valueAt(values, key) };
    } catch {
      return { savedValue: value };
    }
  }
  return { savedValue: value };
}

export interface DashboardEnvKeyStatus {
  key: string;
  configured: boolean;
  masked?: string | undefined;
}

export function parseDashboardEnvPayload(payload: unknown): DashboardEnvKeyStatus[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const source =
    root["keys"] ?? root["env"] ?? root["variables"] ?? (Array.isArray(payload) ? payload : root);
  if (Array.isArray(source)) {
    return source.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const key = String(row["key"] ?? row["name"] ?? "").trim();
      if (!key) return [];
      const configured =
        row["configured"] === true ||
        row["is_set"] === true ||
        row["set"] === true ||
        Boolean(row["masked"] || row["preview"]);
      const masked =
        typeof row["masked"] === "string"
          ? row["masked"]
          : typeof row["preview"] === "string"
            ? row["preview"]
            : undefined;
      return [{ key, configured, ...(masked ? { masked } : {}) }];
    });
  }
  if (source && typeof source === "object") {
    return Object.entries(source as Record<string, unknown>).flatMap(([key, val]) => {
      if (key === "ok" || key === "status") return [];
      if (typeof val === "boolean") return [{ key, configured: val }];
      if (typeof val === "string") {
        const configured = Boolean(val.trim()) && val !== "unset";
        return [{ key, configured, ...(configured ? { masked: "••••••••" } : {}) }];
      }
      if (val && typeof val === "object") {
        const info = val as Record<string, unknown>;
        const configured =
          info["configured"] === true || info["is_set"] === true || info["set"] === true;
        return [{ key, configured }];
      }
      return [];
    });
  }
  return [];
}

export async function readDashboardEnvKeys(baseUrl: string): Promise<DashboardEnvKeyStatus[]> {
  const response = await dashboardRequest(baseUrl, "/api/env", "GET");
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status === 404) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not return environment key status.", response.status);
  }
  try {
    return parseDashboardEnvPayload(JSON.parse(response.text));
  } catch {
    return [];
  }
}

export async function saveDashboardEnvKey(
  baseUrl: string,
  key: string,
  value: string,
): Promise<void> {
  const cleanKey = key.trim();
  if (!/^[A-Z0-9_]+$/i.test(cleanKey)) {
    throw new Error("Environment key name must use letters, numbers, and underscores.");
  }
  if (isRedacted(value)) {
    throw new Error("Paste the real secret key, not a masked placeholder.");
  }
  const payload = { key: cleanKey, value, env: { [cleanKey]: value } };
  let response = await dashboardRequest(baseUrl, "/api/env", "PUT", payload);
  if (response.status === 405 || response.status === 404) {
    response = await dashboardRequest(baseUrl, "/api/env", "POST", payload);
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not save that environment key.", response.status);
  }
}

export interface PairingScanResult {
  baseUrl: string;
  oneTimeCode?: string | undefined;
}

export function parsePairingInput(raw: string, fallbackBaseUrl = ""): PairingScanResult {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Scan or paste an https gateway address or one-time pairing code.");
  if (/^hermes-pair:/i.test(trimmed)) {
    const rest = trimmed.replace(/^hermes-pair:/i, "").trim();
    const [maybeUrl, maybeCode] = rest.includes("#") ? rest.split("#", 2) : ["", rest];
    const baseUrl = maybeUrl ? sanitizePairingUrl(maybeUrl) : sanitizePairingUrl(fallbackBaseUrl);
    const code = (maybeCode ?? "").trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
      throw new Error("Invalid one-time pairing code.");
    }
    return { baseUrl, oneTimeCode: code };
  }
  if (/^[A-Za-z0-9-]{6,24}$/.test(trimmed) && !trimmed.includes("://")) {
    const baseUrl = sanitizePairingUrl(fallbackBaseUrl);
    return { baseUrl, oneTimeCode: trimmed };
  }
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid QR payload. Expected an https gateway address.");
    }
    if (parsed["token"] || parsed["password"] || parsed["adminToken"] || parsed["apiKey"]) {
      throw new Error(
        "Refusing QR payload that contains a token or password. Scan an address-only QR code.",
      );
    }
    const baseUrl = sanitizePairingUrl(
      String(parsed["baseUrl"] ?? parsed["url"] ?? fallbackBaseUrl),
    );
    const code = typeof parsed["code"] === "string" ? parsed["code"].trim() : undefined;
    return { baseUrl, ...(code ? { oneTimeCode: code } : {}) };
  }
  return { baseUrl: sanitizePairingUrl(trimmed) };
}

export async function exchangePairingCode(
  baseUrl: string,
  code: string,
): Promise<{ token?: string; dashboardBaseUrl?: string }> {
  const cleanUrl = sanitizePairingUrl(baseUrl);
  const cleanCode = code.trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(cleanCode)) {
    throw new Error("One-time pairing code must be 4–64 alphanumeric characters.");
  }
  const response = await CapacitorHttp.request({
    url: `${cleanUrl}/api/pairing/exchange`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: { code: cleanCode },
    connectTimeout: 10_000,
    readTimeout: 10_000,
    responseType: "text",
  });
  if (response.status === 404) {
    throw new HermesError(
      "Gateway address saved. This host does not issue one-time pairing codes yet—enter your token below.",
      404,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new HermesError("That one-time pairing code is expired or invalid.", response.status);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not accept that pairing code.", response.status);
  }
  const data = (
    typeof response.data === "string" ? JSON.parse(response.data) : response.data
  ) as Record<string, unknown>;
  return {
    ...(typeof data["token"] === "string" && data["token"].trim()
      ? { token: data["token"].trim() }
      : {}),
    ...(typeof data["dashboard_url"] === "string" && data["dashboard_url"].trim()
      ? { dashboardBaseUrl: normalizeDashboardUrl(data["dashboard_url"].trim()) }
      : {}),
  };
}

export interface HostMemoryStatus {
  provider: string;
  enabled: boolean;
  status: string;
  entryCount?: number | undefined;
  canReset: boolean;
}

export interface MemoryFactItem {
  id: string;
  peer: string;
  fact: string;
  updatedAt?: string | undefined;
}

export function parseMemoryFactsPayload(payload: unknown): MemoryFactItem[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const mem =
    root["memory"] && typeof root["memory"] === "object"
      ? (root["memory"] as Record<string, unknown>)
      : root;
  const peers = mem["peers"] ?? root["peers"];
  if (Array.isArray(peers)) {
    return peers.flatMap((peerItem, peerIdx) => {
      if (!peerItem || typeof peerItem !== "object") return [];
      const row = peerItem as Record<string, unknown>;
      const peerName = String(row["name"] ?? row["id"] ?? `peer-${peerIdx + 1}`);
      const rawFacts = row["facts"] ?? row["entries"] ?? [];
      if (!Array.isArray(rawFacts)) return [];
      return rawFacts.flatMap((factItem, factIdx) => {
        if (typeof factItem === "string" && factItem.trim()) {
          return [{ id: `${peerName}-${factIdx}`, peer: peerName, fact: factItem.trim() }];
        }
        if (factItem && typeof factItem === "object") {
          const fObj = factItem as Record<string, unknown>;
          const text = String(fObj["fact"] ?? fObj["text"] ?? fObj["content"] ?? "").trim();
          if (!text) return [];
          return [
            {
              id: String(fObj["id"] ?? `${peerName}-${factIdx}`),
              peer: peerName,
              fact: text,
              ...(typeof fObj["updated_at"] === "string" ? { updatedAt: fObj["updated_at"] } : {}),
            },
          ];
        }
        return [];
      });
    });
  }
  const rawFacts = mem["facts"] ?? mem["entries"] ?? root["facts"] ?? root["entries"];
  if (Array.isArray(rawFacts)) {
    return rawFacts.flatMap((item, idx) => {
      if (typeof item === "string" && item.trim()) {
        return [{ id: `fact-${idx}`, peer: "default", fact: item.trim() }];
      }
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const fact = String(row["fact"] ?? row["text"] ?? row["content"] ?? "").trim();
        if (!fact) return [];
        return [
          {
            id: String(row["id"] ?? `fact-${idx}`),
            peer: String(row["peer"] ?? row["scope"] ?? "default"),
            fact,
            ...(typeof row["updated_at"] === "string" ? { updatedAt: row["updated_at"] } : {}),
          },
        ];
      }
      return [];
    });
  }
  return [];
}

export function parseHostMemoryPayload(payload: unknown): HostMemoryStatus {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const mem =
    root["memory"] && typeof root["memory"] === "object"
      ? (root["memory"] as Record<string, unknown>)
      : root;
  const provider = String(mem["provider"] ?? mem["backend"] ?? "built-in");
  const enabled = mem["enabled"] !== false;
  const status = String(mem["status"] ?? (enabled ? "active" : "disabled"));
  const rawCount = mem["count"] ?? mem["entries"] ?? mem["entry_count"] ?? mem["facts_count"];
  const entryCount = typeof rawCount === "number" ? rawCount : undefined;
  return {
    provider,
    enabled,
    status,
    ...(entryCount !== undefined ? { entryCount } : {}),
    canReset: mem["can_reset"] !== false,
  };
}

export async function readDashboardMemoryStatus(baseUrl: string): Promise<{
  status: HostMemoryStatus;
  facts: MemoryFactItem[];
}> {
  const response = await dashboardRequest(baseUrl, "/api/memory", "GET");
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not return memory status.", response.status);
  }
  const parsed = JSON.parse(response.text) as unknown;
  let facts = parseMemoryFactsPayload(parsed);
  if (facts.length === 0) {
    const peersRes = await dashboardRequest(baseUrl, "/api/memory/peers", "GET").catch(() => null);
    if (peersRes && peersRes.status >= 200 && peersRes.status < 300 && peersRes.text.trim()) {
      try {
        facts = parseMemoryFactsPayload(JSON.parse(peersRes.text));
      } catch {
        // Host does not return peer list JSON on /api/memory/peers
      }
    }
  }
  return { status: parseHostMemoryPayload(parsed), facts };
}

export async function correctDashboardMemoryFact(
  baseUrl: string,
  input: { id: string; peer: string; fact: string; action: "update" | "delete" },
): Promise<void> {
  const path =
    input.action === "delete"
      ? `/api/memory/facts/${encodeURIComponent(input.id)}`
      : "/api/memory/correct";
  const method = input.action === "delete" ? "DELETE" : "POST";
  let response = await dashboardRequest(
    baseUrl,
    path,
    method,
    input.action === "delete" ? undefined : input,
  );
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(baseUrl, "/api/memory", "PUT", input);
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError(
      "This host does not expose peer fact corrections over /api/memory yet.",
      response.status,
    );
  }
}

export async function resetDashboardMemory(baseUrl: string): Promise<void> {
  let response = await dashboardRequest(baseUrl, "/api/memory/reset", "POST", {});
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(baseUrl, "/api/memory", "DELETE");
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not reset memory.", response.status);
  }
}

export interface PairedDeviceRow {
  id: string;
  name: string;
  platform?: string | undefined;
  lastSeen?: string | undefined;
  current?: boolean | undefined;
}

export interface GatewayBindInfo {
  host?: string | undefined;
  port?: number | undefined;
  publicUrl?: string | undefined;
}

export function parsePairedDevicesPayload(payload: unknown): PairedDeviceRow[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list =
    root["devices"] ??
    root["paired_devices"] ??
    root["tokens"] ??
    root["clients"] ??
    (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry, idx) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = String(row["id"] ?? row["device_id"] ?? row["token_id"] ?? `dev-${idx + 1}`).trim();
    if (!id) return [];
    const name = String(row["name"] ?? row["label"] ?? row["client"] ?? id).trim();
    const platform =
      typeof row["platform"] === "string"
        ? row["platform"]
        : typeof row["os"] === "string"
          ? row["os"]
          : undefined;
    const lastSeen =
      typeof row["last_seen"] === "string"
        ? row["last_seen"]
        : typeof row["lastSeen"] === "string"
          ? row["lastSeen"]
          : typeof row["created_at"] === "string"
            ? row["created_at"]
            : undefined;
    const current = row["current"] === true || row["is_current"] === true;
    return [
      {
        id,
        name,
        ...(platform ? { platform } : {}),
        ...(lastSeen ? { lastSeen } : {}),
        ...(current ? { current: true } : {}),
      },
    ];
  });
}

export async function readPairedDevices(baseUrl: string): Promise<{
  supported: boolean;
  devices: PairedDeviceRow[];
  bindInfo?: GatewayBindInfo | undefined;
}> {
  let bindInfo: GatewayBindInfo | undefined;
  const statusRes = await dashboardRequest(baseUrl, "/api/status", "GET").catch(() => null);
  if (statusRes && statusRes.status >= 200 && statusRes.status < 300 && statusRes.text.trim()) {
    try {
      const parsedStatus = JSON.parse(statusRes.text) as Record<string, unknown>;
      const gw =
        parsedStatus["gateway"] && typeof parsedStatus["gateway"] === "object"
          ? (parsedStatus["gateway"] as Record<string, unknown>)
          : parsedStatus;
      const host =
        typeof gw["bind"] === "string"
          ? gw["bind"]
          : typeof gw["host"] === "string"
            ? gw["host"]
            : undefined;
      const port = typeof gw["port"] === "number" ? gw["port"] : undefined;
      const publicUrl =
        typeof gw["public_url"] === "string"
          ? gw["public_url"]
          : typeof gw["url"] === "string"
            ? gw["url"]
            : undefined;
      if (host || port || publicUrl) {
        bindInfo = {
          ...(host ? { host } : {}),
          ...(port !== undefined ? { port } : {}),
          ...(publicUrl ? { publicUrl } : {}),
        };
      }
    } catch {
      // Ignore malformed status bind payload
    }
  }

  let response = await dashboardRequest(baseUrl, "/api/gateway/devices", "GET");
  if (response.status === 404) {
    response = await dashboardRequest(baseUrl, "/api/pairing/devices", "GET");
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status === 404) {
    return { supported: false, devices: [], ...(bindInfo ? { bindInfo } : {}) };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not return paired devices.", response.status);
  }
  const parsed = response.text.trim() ? (JSON.parse(response.text) as unknown) : {};
  return {
    supported: true,
    devices: parsePairedDevicesPayload(parsed),
    ...(bindInfo ? { bindInfo } : {}),
  };
}

export async function revokePairedDevice(baseUrl: string, deviceId: string): Promise<void> {
  const cleanId = deviceId.trim();
  if (!cleanId) throw new Error("Device ID is required.");
  let response = await dashboardRequest(
    baseUrl,
    `/api/gateway/devices/${encodeURIComponent(cleanId)}`,
    "DELETE",
  );
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(baseUrl, "/api/pairing/revoke", "POST", {
      id: cleanId,
      device_id: cleanId,
    });
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host refused to revoke that device.", response.status);
  }
}

export interface ArchivedSessionRow {
  id: string;
  title: string;
  updatedAt?: string | undefined;
  messageCount?: number | undefined;
}

export function parseArchivedSessionsPayload(payload: unknown): ArchivedSessionRow[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list =
    root["archived"] ?? root["sessions"] ?? root["data"] ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = String(row["id"] ?? row["session_id"] ?? "").trim();
    if (!id) return [];
    if (
      "archived" in row &&
      row["archived"] === false &&
      !("archived" in root) &&
      row["status"] !== "archived"
    ) {
      return [];
    }
    const title = String(row["title"] ?? row["name"] ?? id).trim() || id;
    const updatedAt =
      typeof row["updated_at"] === "string"
        ? row["updated_at"]
        : typeof row["updatedAt"] === "string"
          ? row["updatedAt"]
          : typeof row["archived_at"] === "string"
            ? row["archived_at"]
            : undefined;
    const rawCount = row["message_count"] ?? row["messageCount"] ?? row["messages_count"];
    const messageCount = typeof rawCount === "number" ? rawCount : undefined;
    return [
      {
        id,
        title,
        ...(updatedAt ? { updatedAt } : {}),
        ...(messageCount !== undefined ? { messageCount } : {}),
      },
    ];
  });
}

export async function readArchivedSessions(baseUrl: string): Promise<{
  supported: boolean;
  sessions: ArchivedSessionRow[];
}> {
  let response = await dashboardRequest(baseUrl, "/api/sessions/archived", "GET");
  if (response.status === 404) {
    response = await dashboardRequest(baseUrl, "/api/sessions?archived=true", "GET");
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status === 404) {
    return { supported: false, sessions: [] };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not return archived sessions.", response.status);
  }
  const parsed = response.text.trim() ? (JSON.parse(response.text) as unknown) : {};
  return {
    supported: true,
    sessions: parseArchivedSessionsPayload(parsed),
  };
}

export async function restoreArchivedSession(baseUrl: string, sessionId: string): Promise<void> {
  const cleanId = sessionId.trim();
  if (!cleanId) throw new Error("Session ID is required.");
  let response = await dashboardRequest(
    baseUrl,
    `/api/sessions/${encodeURIComponent(cleanId)}/restore`,
    "POST",
    {},
  );
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(
      baseUrl,
      `/api/sessions/${encodeURIComponent(cleanId)}`,
      "PATCH",
      { archived: false, status: "active" },
    );
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not restore that session.", response.status);
  }
}

export async function deleteArchivedSession(baseUrl: string, sessionId: string): Promise<void> {
  const cleanId = sessionId.trim();
  if (!cleanId) throw new Error("Session ID is required.");
  const response = await dashboardRequest(
    baseUrl,
    `/api/sessions/${encodeURIComponent(cleanId)}`,
    "DELETE",
  );
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not delete that session.", response.status);
  }
}

export interface HostUpdateInfo {
  currentVersion: string;
  latestVersion?: string | undefined;
  commit?: string | undefined;
  updateAvailable: boolean;
  canApply: boolean;
  releaseNotes?: string | undefined;
}

export function parseHostUpdatePayload(payload: unknown): HostUpdateInfo {
  const root =
    payload && typeof payload !== "string" && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const update =
    root["update"] && typeof root["update"] === "object"
      ? (root["update"] as Record<string, unknown>)
      : root;
  const currentVersion = String(
    update["current_version"] ??
      update["version"] ??
      root["version"] ??
      root["hermes_version"] ??
      "unknown",
  ).trim();
  const latestRaw =
    update["latest_version"] ?? update["latest"] ?? update["available_version"] ?? undefined;
  const latestVersion =
    typeof latestRaw === "string" && latestRaw.trim() ? latestRaw.trim() : undefined;
  const commitRaw = update["commit"] ?? update["git_sha"] ?? root["commit"] ?? root["git_sha"];
  const commit = typeof commitRaw === "string" && commitRaw.trim() ? commitRaw.trim() : undefined;
  const updateAvailable =
    update["update_available"] === true ||
    update["has_update"] === true ||
    Boolean(latestVersion && currentVersion !== "unknown" && latestVersion !== currentVersion);
  const canApply =
    update["can_apply"] === true || update["self_update"] === true || updateAvailable;
  const notesRaw = update["release_notes"] ?? update["changelog"] ?? update["notes"];
  const releaseNotes =
    typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim() : undefined;

  return {
    currentVersion,
    ...(latestVersion ? { latestVersion } : {}),
    ...(commit ? { commit } : {}),
    updateAvailable,
    canApply,
    ...(releaseNotes ? { releaseNotes } : {}),
  };
}

export async function checkHostUpdate(baseUrl: string): Promise<HostUpdateInfo> {
  let response = await dashboardRequest(baseUrl, "/api/update/check", "GET");
  if (response.status === 404) {
    response = await dashboardRequest(baseUrl, "/api/status", "GET");
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not return version or update status.", response.status);
  }
  const parsed = response.text.trim() ? (JSON.parse(response.text) as unknown) : {};
  return parseHostUpdatePayload(parsed);
}

export async function applyHostUpdate(baseUrl: string): Promise<{ message: string }> {
  let response = await dashboardRequest(baseUrl, "/api/update/apply", "POST", {});
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(baseUrl, "/api/system/upgrade", "POST", {});
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status === 404) {
    throw new HermesError(
      "This host does not expose remote self-update over /api/update/apply yet.",
      404,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host refused to apply that update.", response.status);
  }
  try {
    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    const msg = parsed["message"] ?? parsed["status"];
    if (typeof msg === "string" && msg.trim()) return { message: msg.trim() };
  } catch {
    // Default message below
  }
  return { message: "Update started on the headless host. Gateway is restarting…" };
}

export interface VaultCredentialRow {
  id: string;
  domain: string;
  username: string;
  updatedAt?: string | undefined;
}

export function parseVaultCredentialsPayload(payload: unknown): VaultCredentialRow[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const list =
    root["credentials"] ??
    root["vault"] ??
    root["entries"] ??
    root["items"] ??
    (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry, idx) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const domain = String(
      row["domain"] ?? row["site"] ?? row["host"] ?? row["service"] ?? row["name"] ?? "",
    ).trim();
    if (!domain) return [];
    const id = String(row["id"] ?? `${domain}-${idx + 1}`).trim();
    const username = String(row["username"] ?? row["user"] ?? row["account"] ?? "").trim();
    const updatedAt =
      typeof row["updated_at"] === "string"
        ? row["updated_at"]
        : typeof row["updatedAt"] === "string"
          ? row["updatedAt"]
          : undefined;
    return [
      {
        id,
        domain,
        username,
        ...(updatedAt ? { updatedAt } : {}),
      },
    ];
  });
}

export async function readDashboardVaultCredentials(baseUrl: string): Promise<{
  supported: boolean;
  locked?: boolean | undefined;
  credentials: VaultCredentialRow[];
}> {
  let response = await dashboardRequest(baseUrl, "/api/vault/credentials", "GET");
  if (response.status === 404) {
    response = await dashboardRequest(baseUrl, "/api/browser/credentials", "GET");
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status === 404) {
    return { supported: false, credentials: [] };
  }
  if (response.status === 423) {
    return { supported: true, locked: true, credentials: [] };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not return credential vault entries.", response.status);
  }
  const parsed = response.text.trim() ? (JSON.parse(response.text) as unknown) : {};
  const locked = Boolean(
    parsed && typeof parsed === "object" && (parsed as Record<string, unknown>)["locked"],
  );
  return {
    supported: true,
    ...(locked ? { locked: true } : {}),
    credentials: parseVaultCredentialsPayload(parsed),
  };
}

export async function addDashboardVaultCredential(
  baseUrl: string,
  input: { domain: string; username: string; secret: string },
): Promise<void> {
  const domain = input.domain.trim();
  const username = input.username.trim();
  const secret = input.secret;
  if (!domain || !secret) {
    throw new Error("Domain/service and password/secret are required.");
  }
  if (isRedacted(secret)) {
    throw new Error("Paste the real secret, not a masked placeholder.");
  }
  const body = { domain, username, password: secret, secret };
  let response = await dashboardRequest(baseUrl, "/api/vault/credentials", "POST", body);
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(baseUrl, "/api/browser/credentials", "POST", body);
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not save that vault credential.", response.status);
  }
}

export async function revokeDashboardVaultCredential(
  baseUrl: string,
  credentialId: string,
): Promise<void> {
  const cleanId = credentialId.trim();
  if (!cleanId) throw new Error("Credential ID is required.");
  let response = await dashboardRequest(
    baseUrl,
    `/api/vault/credentials/${encodeURIComponent(cleanId)}`,
    "DELETE",
  );
  if (response.status === 404 || response.status === 405) {
    response = await dashboardRequest(
      baseUrl,
      `/api/browser/credentials/${encodeURIComponent(cleanId)}`,
      "DELETE",
    );
  }
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The host did not revoke that vault credential.", response.status);
  }
}
