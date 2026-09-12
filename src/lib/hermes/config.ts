import { useCallback, useEffect, useState } from "react";
import type { HermesConfig } from "./types";

const KEY = "hermes.config.v1";

export const defaultConfig: HermesConfig = {
  baseUrl: "",
  token: "",
  model: "",
  fallbackModel: "",
  wsEnabled: true,
  haptics: true,
  reasoning: "medium",
  fastMode: false,
};

export function readConfig(): HermesConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultConfig;
    return { ...defaultConfig, ...(JSON.parse(raw) as Partial<HermesConfig>) };
  } catch {
    return defaultConfig;
  }
}

export function writeConfig(config: HermesConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent("hermes-config-change"));
}

export function isConfigured(config: HermesConfig) {
  return config.baseUrl.trim().length > 0;
}

/** Reads config after hydration so SSR and the client agree on first paint. */
export function useHermesConfig() {
  const [config, setConfig] = useState<HermesConfig>(defaultConfig);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setConfig(readConfig());
    sync();
    setReady(true);
    window.addEventListener("hermes-config-change", sync);
    window.addEventListener("storage", sync);
    return () => {
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
