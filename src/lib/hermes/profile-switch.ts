import type { HermesConfig } from "./types";
import type { ModelOptionsSnapshot } from "./model-options";
import type { ProfileRoute } from "./profiles";
import { api, fetchModelOptions, fetchProfileInventory, type SessionInfo } from "./rest";

export interface PreparedProfileSwitch {
  profile: ProfileRoute;
  health: Record<string, unknown>;
  modelOptions: ModelOptionsSnapshot;
  sessions: SessionInfo[];
  configPatch: Pick<
    HermesConfig,
    "activeProfile" | "profilePathPrefix" | "provider" | "model" | "fallbackModel"
  >;
}

function parseHealth(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The target profile returned malformed health data.");
  }
  const health = value as Record<string, unknown>;
  if (Object.keys(health).length === 0) {
    throw new Error("The target profile returned empty health data.");
  }
  return health;
}

function parseSessions(value: unknown): SessionInfo[] {
  const raw = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as Record<string, unknown>)["sessions"])
      ? ((value as Record<string, unknown>)["sessions"] as unknown[])
      : null;
  if (!raw) throw new Error("The target profile returned malformed session data.");
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("The target profile returned malformed session data.");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row["id"] !== "string" || !row["id"].trim()) {
      throw new Error("The target profile returned malformed session data.");
    }
    return row as unknown as SessionInfo;
  });
}

function validateModelOptions(options: ModelOptionsSnapshot): ModelOptionsSnapshot {
  if (!options.activeProvider || !options.activeModel || options.providers.length === 0) {
    throw new Error("The target profile returned empty model options.");
  }
  const active = options.providers.find((provider) => provider.slug === options.activeProvider);
  if (!active || !active.models.includes(options.activeModel)) {
    throw new Error("The target profile returned inconsistent model options.");
  }
  return options;
}

export async function prepareProfileSwitch(
  config: HermesConfig,
  targetProfile: string,
): Promise<PreparedProfileSwitch> {
  const inventory = await fetchProfileInventory(config);
  const profile = inventory.profiles.find((candidate) => candidate.name === targetProfile);
  if (!profile) throw new Error(`Profile "${targetProfile}" is not present in gateway inventory.`);

  const targetConfig: HermesConfig = {
    ...config,
    activeProfile: profile.name,
    profilePathPrefix: profile.pathPrefix,
    provider: "",
    model: "",
    fallbackModel: "",
  };
  const [healthPayload, modelOptionsPayload, sessionsPayload] = await Promise.all([
    api<unknown>(targetConfig, "/api/status"),
    fetchModelOptions(targetConfig),
    api<unknown>(targetConfig, "/api/sessions?limit=60&offset=0&min_messages=0"),
  ]);
  const health = parseHealth(healthPayload);
  const modelOptions = validateModelOptions(modelOptionsPayload);
  const sessions = parseSessions(sessionsPayload);

  return {
    profile,
    health,
    modelOptions,
    sessions,
    configPatch: {
      activeProfile: profile.name,
      profilePathPrefix: profile.pathPrefix,
      provider: modelOptions.activeProvider,
      model: modelOptions.activeModel,
      fallbackModel: "",
    },
  };
}
