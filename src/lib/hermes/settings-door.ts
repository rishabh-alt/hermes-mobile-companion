import { HermesError, requireSecureBaseUrl } from "./client";
import { composeGatewayUrl } from "./profiles";
import type { HermesConfig } from "./types";

export async function saveHostSetting(config: HermesConfig, key: string, value: string) {
  const adminKey = config.adminToken.trim();
  if (!adminKey) throw new HermesError("Set up this phone before saving host settings.");
  requireSecureBaseUrl(config.baseUrl);
  const response = await fetch(composeGatewayUrl(config, "/api/admin/settings", { root: true }), {
    method: "PATCH",
    headers: {
      "X-Hermes-Admin-Key": adminKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, value }),
  });
  if (response.status === 404) {
    throw new HermesError("Restart the gateway once, then try this save again.", 404);
  }
  if (!response.ok) throw new HermesError("The host refused that change.", response.status);
  return response.json();
}
