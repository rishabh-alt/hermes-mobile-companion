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

async function dashboardRequest(
  base: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
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
  method: "GET" | "POST" | "PUT" | "PATCH" = "GET",
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
      return [{
        name,
        label: String(item["alias"] || item["description"] || name),
        model: String(item["model"] ?? ""),
        isDefault: item["is_default"] === true,
      }];
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
  type: "string" | "number" | "boolean" | "select";
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

export async function readDashboardSection(baseUrl: string, sectionId: string): Promise<DashboardField[]> {
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
    rawFields && typeof rawFields === "object"
      ? (rawFields as Record<string, unknown>)
      : {};
  const rawConfig = savedBody["config"];
  const values =
    rawConfig && typeof rawConfig === "object"
      ? (rawConfig as Record<string, unknown>)
      : {};
  return Object.entries(fields)
    .flatMap(([key, raw]) => {
      if (!raw || typeof raw !== "object") return [];
      const field = raw as Record<string, unknown>;
      if (!categories.has(String(field["category"] ?? ""))) return [];
      const type = String(field["type"] ?? "");
      if (type !== "string" && type !== "number" && type !== "boolean" && type !== "select") return [];
      if (/api_key|token|secret|password/i.test(key)) return [];
      const options = field["options"];
      return [{
        key,
        type: type as DashboardField["type"],
        description: String(field["description"] ?? ""),
        options: Array.isArray(options) ? options.map(String) : [],
        value: valueAt(values, key),
      }];
    })
    .slice(0, 40);
}

export async function saveDashboardValue(baseUrl: string, key: string, value: unknown) {
  const response = await dashboardRequest(baseUrl, "/api/config", "PUT", {
    config: nestValue(key, value),
  });
  if (response.status === 401) throw new HermesError("Sign in to the dashboard again.", 401);
  if (response.status < 200 || response.status >= 300) {
    throw new HermesError("The dashboard did not save that setting.", response.status);
  }
}
