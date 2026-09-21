import { requireSecureBaseUrl } from "./client";
import type { HermesConfig } from "./types";

const SAFE_PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface ProfileRoute {
  name: string;
  label: string;
  isDefault: boolean;
  isCurrent: boolean;
  pathPrefix: string;
  /** Compatibility aliases consumed by the existing non-switcher profile views. */
  is_default: boolean;
  skills?: number | undefined;
  provider?: string | undefined;
  model?: string | undefined;
}

export interface ProfileInventory {
  currentProfile: string;
  profiles: ProfileRoute[];
}

function malformed(): never {
  throw new Error("Malformed profile inventory from the gateway.");
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) malformed();
  return value.trim();
}

export function isSafeProfileName(name: string): boolean {
  return SAFE_PROFILE_NAME.test(name);
}

export function validateProfilePathPrefix(
  name: string,
  pathPrefix: string,
  isDefault: boolean,
): string {
  if (!isSafeProfileName(name)) malformed();
  const expected = isDefault ? "" : `/p/${name}`;
  if (pathPrefix !== expected) malformed();
  return pathPrefix;
}

export function parseProfileInventory(value: unknown): ProfileInventory {
  if (!value || typeof value !== "object" || Array.isArray(value)) malformed();
  const payload = value as Record<string, unknown>;
  if (typeof payload["current_profile"] !== "string" || !Array.isArray(payload["profiles"])) {
    malformed();
  }
  const currentProfile = payload["current_profile"].trim();
  if (!isSafeProfileName(currentProfile) || payload["profiles"].length === 0) malformed();

  const seen = new Set<string>();
  const profiles = payload["profiles"].map((raw): ProfileRoute => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) malformed();
    const row = raw as Record<string, unknown>;
    const name = typeof row["name"] === "string" ? row["name"].trim() : "";
    const label = typeof row["label"] === "string" ? row["label"].trim() : "";
    const pathPrefix = typeof row["path_prefix"] === "string" ? row["path_prefix"] : "";
    if (!name || !label || seen.has(name)) malformed();
    if (typeof row["is_default"] !== "boolean" || typeof row["is_current"] !== "boolean") {
      malformed();
    }
    const isDefault = row["is_default"];
    const isCurrent = row["is_current"];
    const provider = optionalString(row["provider"]);
    const model = optionalString(row["model"]);
    if (isDefault !== (name === "default")) malformed();
    validateProfilePathPrefix(name, pathPrefix, isDefault);
    seen.add(name);
    return {
      name,
      label,
      isDefault,
      isCurrent,
      is_default: isDefault,
      pathPrefix,
      ...(typeof row["skills"] === "number" ? { skills: row["skills"] } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    };
  });

  if (
    !seen.has(currentProfile) ||
    profiles.filter((profile) => profile.isDefault).length !== 1 ||
    profiles.filter((profile) => profile.isCurrent).length !== 1 ||
    !profiles.some((profile) => profile.name === currentProfile && profile.isCurrent)
  ) {
    malformed();
  }
  return { currentProfile, profiles };
}

export function composeGatewayUrl(
  config: HermesConfig,
  path: string,
  { root = false }: { root?: boolean } = {},
): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) {
    throw new Error("Invalid gateway path.");
  }
  const base = requireSecureBaseUrl(config.baseUrl);
  const profileName = config.activeProfile || "default";
  const prefix = root
    ? ""
    : validateProfilePathPrefix(
        profileName,
        config.profilePathPrefix || "",
        profileName === "default",
      );
  return `${base}${prefix}${path}`;
}
