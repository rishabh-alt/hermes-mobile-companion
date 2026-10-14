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
  method: "GET" | "POST",
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
