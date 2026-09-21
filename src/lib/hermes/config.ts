import { useCallback, useEffect, useState } from "react";
import type { HermesConfig } from "./types";
import { isSecureBaseUrl } from "./client";
import { getSecureToken, setSecureToken } from "./secure-storage";
import { validateProfilePathPrefix } from "./profiles";
import { activateSessionProfile } from "./sessions";
import { profileRunBoundary } from "./run-guard";

const KEY = "hermes.config.v1";
let runtimeToken = "";
let tokenWriteQueue = Promise.resolve();

export const defaultConfig: HermesConfig = {
  baseUrl: "",
  token: "",
  activeProfile: "default",
  profilePathPrefix: "",
  provider: "",
  model: "",
  fallbackModel: "",
  wsEnabled: true,
  haptics: true,
  reasoning: "medium",
  fastMode: false,
};

function readStoredConfig(): Partial<HermesConfig> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<HermesConfig>;
  } catch {
    return {};
  }
}

function persistPublicConfig(config: HermesConfig) {
  const { token: _token, ...publicConfig } = config;
  window.localStorage.setItem(KEY, JSON.stringify(publicConfig));
}

export function readConfig(): HermesConfig {
  return { ...defaultConfig, ...readStoredConfig(), token: runtimeToken };
}

export async function loadConfig(): Promise<HermesConfig> {
  const stored = readStoredConfig();
  const legacyToken = typeof stored.token === "string" ? stored.token : "";
  try {
    runtimeToken = (await getSecureToken()) || legacyToken;
    if (legacyToken && runtimeToken === legacyToken) await setSecureToken(legacyToken);
  } catch {
    runtimeToken = legacyToken;
  }
  const config = { ...defaultConfig, ...stored, token: runtimeToken };
  validateProfilePathPrefix(
    config.activeProfile,
    config.profilePathPrefix,
    config.activeProfile === "default",
  );
  activateSessionProfile(config.activeProfile);
  if (typeof window !== "undefined") {
    // Session transcripts are server-owned now; never retain old WebView copies after upgrade.
    window.localStorage.removeItem("hermes.sessions.v1");
    persistPublicConfig(config);
  }
  return config;
}

export function writeConfig(config: HermesConfig) {
  if (typeof window === "undefined") return;
  validateProfilePathPrefix(
    config.activeProfile,
    config.profilePathPrefix,
    config.activeProfile === "default",
  );
  const previousProfile = readConfig().activeProfile;
  runtimeToken = config.token;
  persistPublicConfig(config);
  if (previousProfile !== config.activeProfile) profileRunBoundary.invalidate();
  activateSessionProfile(config.activeProfile);
  tokenWriteQueue = tokenWriteQueue.then(() => setSecureToken(runtimeToken)).catch(() => undefined);
  window.dispatchEvent(new CustomEvent("hermes-config-change"));
}

export function isConfigured(config: HermesConfig) {
  return isSecureBaseUrl(config.baseUrl);
}

export function useHermesConfig() {
  const [config, setConfig] = useState<HermesConfig>(defaultConfig);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const sync = () => setConfig(readConfig());
    void loadConfig().then((loaded) => {
      if (!active) return;
      setConfig(loaded);
      setReady(true);
    });
    window.addEventListener("hermes-config-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      active = false;
      window.removeEventListener("hermes-config-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((patch: Partial<HermesConfig>) => {
    const next = { ...readConfig(), ...patch };
    writeConfig(next);
    setConfig(next);
  }, []);

  return { config, ready, update, configured: isConfigured(config) };
}
