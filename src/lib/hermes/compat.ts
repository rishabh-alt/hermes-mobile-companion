import { useCallback, useEffect, useState } from "react";
import { isSecureBaseUrl } from "./client";
import type { HermesConfig } from "./types";

export const MIN_SUPPORTED_HERMES_VERSION = "0.20.0";
export const MAX_TESTED_HERMES_VERSION = "0.22.x";

export type CompatibilityStatus =
  "compatible" | "outdated" | "newer-untested" | "schema-mismatch" | "unknown";

export interface HostCompatibilityReport {
  status: CompatibilityStatus;
  hostVersion: string;
  supportedRange: string;
  configVersion?: number | undefined;
  latestConfigVersion?: number | undefined;
  headline: string;
  detail: string;
}

export function parseSemverTuple(raw: string | undefined): [number, number, number] | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] !== undefined ? Number(match[3]) : 0;
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null;
  return [major, minor, patch];
}

export function evaluateHostCompatibility(input: {
  version?: string | undefined;
  configVersion?: number | undefined;
  latestConfigVersion?: number | undefined;
}): HostCompatibilityReport {
  const supportedRange = `${MIN_SUPPORTED_HERMES_VERSION} – ${MAX_TESTED_HERMES_VERSION}`;
  const hostVersion = (input.version ?? "").trim() || "unknown";
  const tuple = parseSemverTuple(hostVersion);

  const versionExtra = {
    ...(input.configVersion !== undefined ? { configVersion: input.configVersion } : {}),
    ...(input.latestConfigVersion !== undefined
      ? { latestConfigVersion: input.latestConfigVersion }
      : {}),
  };

  if (
    input.configVersion !== undefined &&
    input.latestConfigVersion !== undefined &&
    input.configVersion < input.latestConfigVersion
  ) {
    return {
      status: "schema-mismatch",
      hostVersion,
      supportedRange,
      ...versionExtra,
      headline: `Host config schema migration pending (${input.configVersion} → ${input.latestConfigVersion})`,
      detail:
        "Your Hermes host config version is behind its schema version. Run a config save or restart the host gateway to complete migration.",
    };
  }

  if (!tuple) {
    return {
      status: "unknown",
      hostVersion,
      supportedRange,
      ...versionExtra,
      headline: "Host Hermes version not yet verified",
      detail: `Check host status or sign in to the dashboard to verify compatibility (expected Hermes ${supportedRange}).`,
    };
  }

  const [major, minor] = tuple;
  if (major === 0 && minor < 20) {
    return {
      status: "outdated",
      hostVersion,
      supportedRange,
      ...versionExtra,
      headline: `Host Hermes ${hostVersion} is older than ${MIN_SUPPORTED_HERMES_VERSION}`,
      detail: `Some session streaming, approval, or dashboard endpoints may be missing on Hermes ${hostVersion}. Upgrade the host to ${supportedRange}.`,
    };
  }

  if (major > 0 || (major === 0 && minor > 22)) {
    return {
      status: "newer-untested",
      hostVersion,
      supportedRange,
      ...versionExtra,
      headline: `Host Hermes ${hostVersion} is newer than tested (${MAX_TESTED_HERMES_VERSION})`,
      detail: `Hermes ${hostVersion} is ahead of the ${supportedRange} range verified with this companion build. Unmapped schema fields will still appear in Host runtime.`,
    };
  }

  return {
    status: "compatible",
    hostVersion,
    supportedRange,
    ...versionExtra,
    headline: `Compatible with Hermes ${hostVersion}`,
    detail: `Host version ${hostVersion} matches the verified ${supportedRange} contract${
      input.configVersion !== undefined ? ` (schema v${input.configVersion})` : ""
    }.`,
  };
}

export interface RouteProbeResult {
  route: "lan" | "tailscale";
  activeBaseUrl: string;
  activeDashboardUrl: string;
  lanBaseUrl?: string | undefined;
  tailscaleBaseUrl?: string | undefined;
  latencyMs: number;
  checkedAt: number;
  fallbackReason?: string | undefined;
}

let activeRouteSnapshot: RouteProbeResult | null = null;

export function getActiveRouteSnapshot(): RouteProbeResult | null {
  return activeRouteSnapshot;
}

export function setActiveRouteSnapshot(snapshot: RouteProbeResult | null): void {
  activeRouteSnapshot = snapshot;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("hermes-route-change"));
  }
}

/**
 * Returns the effective gateway base URL for a config, honoring an active verified LAN route
 * when `autoRouteLan` is enabled without mutating or clobbering `config.baseUrl`.
 */
export function selectEffectiveBaseUrl(config: HermesConfig): string {
  const lanUrl = (config.lanBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (
    config.autoRouteLan &&
    lanUrl &&
    isSecureBaseUrl(lanUrl) &&
    activeRouteSnapshot?.route === "lan" &&
    activeRouteSnapshot.lanBaseUrl === lanUrl
  ) {
    return lanUrl;
  }
  return config.baseUrl.trim();
}

export async function probeFastEndpoint(
  baseUrl: string,
  token: string,
  timeoutMs = 1200,
): Promise<{ ok: boolean; latencyMs: number }> {
  if (!isSecureBaseUrl(baseUrl)) return { ok: false, latencyMs: 0 };
  const start = Date.now();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const clean = baseUrl.trim().replace(/\/+$/, "");
    const res = await fetch(`${clean}/v1/models`, {
      method: "GET",
      headers: token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {},
      signal: controller.signal,
    });
    const latencyMs = Math.max(1, Date.now() - start);
    // 200 or 401/403 proves the HTTPS host is reachable on the network
    return {
      ok: res.status === 200 || res.status === 401 || res.status === 403,
      latencyMs,
    };
  } catch {
    return { ok: false, latencyMs: Math.max(1, Date.now() - start) };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function resolveOptimalHostRoute(
  config: HermesConfig,
  timeoutMs = 1200,
): Promise<RouteProbeResult> {
  const tailnetUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const tailnetDash = config.dashboardBaseUrl.trim().replace(/\/+$/, "");
  const lanUrl = (config.lanBaseUrl ?? "").trim().replace(/\/+$/, "");
  const lanDash = (config.lanDashboardBaseUrl ?? "").trim().replace(/\/+$/, "");

  if (config.autoRouteLan && isSecureBaseUrl(lanUrl)) {
    const lanProbe = await probeFastEndpoint(lanUrl, config.token, timeoutMs);
    if (lanProbe.ok) {
      const result: RouteProbeResult = {
        route: "lan",
        activeBaseUrl: lanUrl,
        activeDashboardUrl: lanDash || tailnetDash,
        lanBaseUrl: lanUrl,
        tailscaleBaseUrl: tailnetUrl,
        latencyMs: lanProbe.latencyMs,
        checkedAt: Date.now(),
      };
      setActiveRouteSnapshot(result);
      return result;
    }
    const tailProbe = await probeFastEndpoint(tailnetUrl, config.token, timeoutMs * 2);
    const fallbackResult: RouteProbeResult = {
      route: "tailscale",
      activeBaseUrl: tailnetUrl,
      activeDashboardUrl: tailnetDash,
      lanBaseUrl: lanUrl,
      tailscaleBaseUrl: tailnetUrl,
      latencyMs: tailProbe.latencyMs,
      checkedAt: Date.now(),
      fallbackReason: "LAN endpoint unreachable; routed via Tailscale.",
    };
    setActiveRouteSnapshot(fallbackResult);
    return fallbackResult;
  }

  const probe = await probeFastEndpoint(tailnetUrl, config.token, timeoutMs * 2);
  const directResult: RouteProbeResult = {
    route: "tailscale",
    activeBaseUrl: tailnetUrl,
    activeDashboardUrl: tailnetDash,
    ...(lanUrl ? { lanBaseUrl: lanUrl } : {}),
    tailscaleBaseUrl: tailnetUrl,
    latencyMs: probe.latencyMs,
    checkedAt: Date.now(),
  };
  setActiveRouteSnapshot(directResult);
  return directResult;
}

export function useActiveHostRoute(config: HermesConfig) {
  const [snapshot, setSnapshot] = useState<RouteProbeResult | null>(() => getActiveRouteSnapshot());
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    const sync = () => setSnapshot(getActiveRouteSnapshot());
    window.addEventListener("hermes-route-change", sync);
    return () => window.removeEventListener("hermes-route-change", sync);
  }, []);

  const probeNow = useCallback(async () => {
    setProbing(true);
    try {
      return await resolveOptimalHostRoute(config);
    } finally {
      setProbing(false);
    }
  }, [config]);

  return {
    snapshot,
    probing,
    probeNow,
    effectiveBaseUrl: selectEffectiveBaseUrl(config),
  };
}
