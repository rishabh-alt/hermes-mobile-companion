import { defaultConfig, readConfig, writeConfig } from "./config";
import { isSecureBaseUrl } from "./client";
import {
  readCustomPromptTemplates,
  writeCustomPromptTemplates,
  type PromptTemplate,
} from "./prompt-templates";
import type { HermesConfig } from "./types";

export interface PhoneConfigBackup {
  version: 1;
  exportedAt: string;
  config: Partial<Omit<HermesConfig, "token" | "adminToken">>;
  customTemplates?: PromptTemplate[] | undefined;
}

const FORBIDDEN_SECRET_KEYS = ["token", "adminToken", "password", "secret", "apiKey", "api_key"];

export function createPhoneConfigBackup(
  current: HermesConfig = readConfig(),
  templates: PromptTemplate[] = readCustomPromptTemplates(),
): string {
  const { token: _token, adminToken: _adminToken, ...safeConfig } = current;
  const payload: PhoneConfigBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: safeConfig,
    ...(templates.length > 0 ? { customTemplates: templates } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

export function parsePhoneConfigBackup(rawJson: string): {
  configPatch: Partial<HermesConfig>;
  customTemplates?: PromptTemplate[] | undefined;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid backup file: expected valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid backup file: root must be a JSON object.");
  }
  const root = parsed as Record<string, unknown>;
  const sourceConfig =
    root["config"] && typeof root["config"] === "object" && !Array.isArray(root["config"])
      ? (root["config"] as Record<string, unknown>)
      : root;

  for (const key of FORBIDDEN_SECRET_KEYS) {
    if (typeof sourceConfig[key] === "string" && (sourceConfig[key] as string).trim()) {
      throw new Error(
        `Refusing backup containing secret field "${key}". Phone backups only store non-secret settings.`,
      );
    }
  }

  const patch: Partial<HermesConfig> = {};
  if (typeof sourceConfig["baseUrl"] === "string") {
    const url = sourceConfig["baseUrl"].trim();
    if (url && !isSecureBaseUrl(url)) {
      throw new Error("Backup baseUrl must use https://.");
    }
    patch.baseUrl = url;
  }
  if (typeof sourceConfig["dashboardBaseUrl"] === "string") {
    const dash = sourceConfig["dashboardBaseUrl"].trim();
    if (dash && !isSecureBaseUrl(dash)) {
      throw new Error("Backup dashboardBaseUrl must use https://.");
    }
    patch.dashboardBaseUrl = dash;
  }
  if (typeof sourceConfig["activeProfile"] === "string" && sourceConfig["activeProfile"].trim()) {
    patch.activeProfile = sourceConfig["activeProfile"].trim();
  }
  if (typeof sourceConfig["profilePathPrefix"] === "string") {
    patch.profilePathPrefix = sourceConfig["profilePathPrefix"].trim();
  }
  if (typeof sourceConfig["provider"] === "string") patch.provider = sourceConfig["provider"];
  if (typeof sourceConfig["model"] === "string") patch.model = sourceConfig["model"];
  if (typeof sourceConfig["fallbackModel"] === "string") {
    patch.fallbackModel = sourceConfig["fallbackModel"];
  }
  if (typeof sourceConfig["dashboardUsername"] === "string") {
    patch.dashboardUsername = sourceConfig["dashboardUsername"];
  }
  if (typeof sourceConfig["wsEnabled"] === "boolean") patch.wsEnabled = sourceConfig["wsEnabled"];
  if (typeof sourceConfig["haptics"] === "boolean") patch.haptics = sourceConfig["haptics"];
  if (
    sourceConfig["reasoning"] === "off" ||
    sourceConfig["reasoning"] === "low" ||
    sourceConfig["reasoning"] === "medium" ||
    sourceConfig["reasoning"] === "high"
  ) {
    patch.reasoning = sourceConfig["reasoning"];
  }
  if (typeof sourceConfig["fastMode"] === "boolean") patch.fastMode = sourceConfig["fastMode"];
  if (
    sourceConfig["fontScale"] === "sm" ||
    sourceConfig["fontScale"] === "md" ||
    sourceConfig["fontScale"] === "lg"
  ) {
    patch.fontScale = sourceConfig["fontScale"];
  }
  if (
    sourceConfig["theme"] === "dark" ||
    sourceConfig["theme"] === "light" ||
    sourceConfig["theme"] === "system"
  ) {
    patch.theme = sourceConfig["theme"];
  }
  if (sourceConfig["toolDetail"] === "compact" || sourceConfig["toolDetail"] === "expanded") {
    patch.toolDetail = sourceConfig["toolDetail"];
  }
  if (
    sourceConfig["drawerDensity"] === "comfortable" ||
    sourceConfig["drawerDensity"] === "compact"
  ) {
    patch.drawerDensity = sourceConfig["drawerDensity"];
  }
  if (typeof sourceConfig["showReasoning"] === "boolean") {
    patch.showReasoning = sourceConfig["showReasoning"];
  }
  if (Array.isArray(sourceConfig["savedHosts"])) {
    patch.savedHosts = sourceConfig["savedHosts"].flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const id = String(row["id"] ?? "").trim();
      const label = String(row["label"] ?? "").trim();
      const baseUrl = String(row["baseUrl"] ?? "").trim();
      if (!id || !label || !isSecureBaseUrl(baseUrl)) return [];
      return [
        {
          id,
          label,
          baseUrl,
          dashboardBaseUrl: String(row["dashboardBaseUrl"] ?? ""),
          ...(typeof row["activeProfile"] === "string"
            ? { activeProfile: row["activeProfile"] }
            : {}),
          ...(typeof row["profilePathPrefix"] === "string"
            ? { profilePathPrefix: row["profilePathPrefix"] }
            : {}),
        },
      ];
    });
  }

  const customTemplates = Array.isArray(root["customTemplates"])
    ? (root["customTemplates"] as unknown[]).flatMap((item): PromptTemplate[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const id = String(row["id"] ?? "").trim();
        const title = String(row["title"] ?? "").trim();
        const prompt = String(row["prompt"] ?? "").trim();
        if (!id || !title || !prompt) return [];
        return [{ id, title, prompt, category: "Custom", custom: true }];
      })
    : undefined;

  return {
    configPatch: patch,
    ...(customTemplates ? { customTemplates } : {}),
  };
}

export function applyPhoneConfigBackup(rawJson: string): HermesConfig {
  const { configPatch, customTemplates } = parsePhoneConfigBackup(rawJson);
  const current = readConfig();
  const next: HermesConfig = {
    ...current,
    ...configPatch,
    token: current.token,
    adminToken: current.adminToken,
  };
  writeConfig(next);
  if (customTemplates) {
    writeCustomPromptTemplates(customTemplates);
  }
  return next;
}

export function resetPhoneConfigToDefaults(): HermesConfig {
  const fresh: HermesConfig = { ...defaultConfig };
  writeConfig(fresh);
  return fresh;
}
