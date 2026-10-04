import { HermesError, requireSecureBaseUrl } from "./client";
import { composeGatewayUrl } from "./profiles";
import type { HermesConfig } from "./types";

export type HostModelSettings = {
  model: string;
  provider: string;
  context_length: number | null;
  reasoning_effort: string;
  fallback_providers: Array<{ provider: string; model: string }>;
};

export async function readHostModel(config: HermesConfig): Promise<HostModelSettings> {
  return adminRequest(config, "GET");
}

export async function saveHostModel(
  config: HermesConfig,
  patch: Partial<Pick<HostModelSettings, "model" | "provider" | "reasoning_effort">>,
): Promise<HostModelSettings> {
  return adminRequest(config, "PATCH", patch);
}

async function adminRequest(
  config: HermesConfig,
  method: "GET" | "PATCH",
  body?: unknown,
): Promise<HostModelSettings> {
  const adminKey = config.adminToken.trim();
  if (!adminKey) throw new HermesError("Add the model admin key before saving host settings.");
  requireSecureBaseUrl(config.baseUrl);
  let response: Response;
  try {
    response = await fetch(composeGatewayUrl(config, "/api/admin/model", { root: true }), {
      method,
      headers: {
        "X-Hermes-Admin-Key": adminKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HermesError("Can't reach the gateway. Check the URL, the tunnel, or your VPN.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new HermesError("The model admin key was rejected.", response.status);
  }
  if (response.status === 404) {
    throw new HermesError("This gateway has not opened the model admin door.", response.status);
  }
  if (!response.ok) throw new HermesError(`Gateway returned ${response.status}`, response.status);
  return (await response.json()) as HostModelSettings;
}
