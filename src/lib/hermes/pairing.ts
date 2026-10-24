import { CapacitorHttp } from "@capacitor/core";
import {
  evaluateHostCompatibility,
  resolveOptimalHostRoute,
  type HostCompatibilityReport,
} from "./compat";
import { captureResponseCookies, checkHostUpdate, dashboardUrlFromGateway } from "./dashboard";
import { note } from "./debug-log";
import {
  getDeviceCredential,
  setDeviceCredential,
  setHostDeviceCredential,
  setHostToken,
  setSecureToken,
} from "./secure-storage";
import type { GatewayTokenScope, HermesConfig, SavedHost } from "./types";

export type PairingRedeemMode = "provider" | "plugin-public" | "listener";

export type PairingErrorCode =
  | "pairing_expired"
  | "pairing_used"
  | "pairing_invalid"
  | "routes_unreachable"
  | "unsupported_mode"
  | "unsupported_version"
  | "invalid_type"
  | "malformed_payload";

export const PAIRING_ERROR_MESSAGES: Record<PairingErrorCode, string> = {
  pairing_expired: "That code expired — generate a new one in the dashboard.",
  pairing_used: "That code was already used. Generate a fresh one.",
  pairing_invalid: "That code isn't valid for this host.",
  routes_unreachable:
    "Couldn't reach your Hermes on any address in the code. Same Wi-Fi, or Tailscale on?",
  unsupported_mode: "This pairing code uses an unsupported redemption mode.",
  unsupported_version: "This pairing code requires a newer version of Hermes Companion.",
  invalid_type: "That QR code isn't a Hermes Companion pairing code.",
  malformed_payload: "That code isn't valid for this host.",
};

export class PairingFlowError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message?: string) {
    super(message ?? PAIRING_ERROR_MESSAGES[code]);
    this.name = "PairingFlowError";
    this.code = code;
  }
}

export interface CompanionPairingRouteEntry {
  kind: "tailscale" | "lan" | string;
  url: string;
  gatewayUrl?: string | undefined;
  dashboardUrl?: string | undefined;
}

export interface CompanionPairingRedeemSpec {
  mode: PairingRedeemMode;
  path: string;
  port?: number | undefined;
}

export interface CompanionPairingPayload {
  v: 1;
  type: "hermes-companion-pair";
  host_name: string;
  routes: CompanionPairingRouteEntry[];
  redeem: CompanionPairingRedeemSpec;
  pair_id: string;
  secret: string;
  expires_at: number;
}

export interface ProbedPairingRoutes {
  winningRoute: CompanionPairingRouteEntry;
  latencyMs: number;
  tailscaleRoute?: CompanionPairingRouteEntry | undefined;
  lanRoute?: CompanionPairingRouteEntry | undefined;
}

export interface CompanionPairingRedeemResult {
  deviceId: string;
  deviceCredential?: string | undefined;
  gatewayToken?: string | undefined;
  gatewayTokenScope: GatewayTokenScope;
  gatewayUrl?: string | undefined;
  dashboardUrl?: string | undefined;
  lanGatewayUrl?: string | undefined;
  lanDashboardUrl?: string | undefined;
  hostVersion?: string | undefined;
  configVersion?: number | undefined;
  latestConfigVersion?: number | undefined;
  sessionCookieCaptured: boolean;
}

export interface CompanionPairingOutcome {
  hostId: string;
  hostName: string;
  deviceId: string;
  gatewayTokenScope: GatewayTokenScope;
  winningRoute: CompanionPairingRouteEntry;
  compatibility: HostCompatibilityReport;
  destination: "chat" | "status";
  nextConfig: HermesConfig;
}

const SUPPORTED_MODES = new Set<string>(["provider", "plugin-public", "listener"]);

function normalizeRouteUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new PairingFlowError("malformed_payload");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new PairingFlowError("malformed_payload");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PairingFlowError("malformed_payload");
  }
  if (parsed.username || parsed.password) {
    throw new PairingFlowError("malformed_payload");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function isCompanionPairingPayloadCandidate(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      obj["type"] === "hermes-companion-pair" ||
      typeof obj["pair_id"] === "string" ||
      (typeof obj["redeem"] === "object" && obj["redeem"] !== null)
    );
  } catch {
    return false;
  }
}

export function parseCompanionPairingPayload(
  raw: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): CompanionPairingPayload {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new PairingFlowError("malformed_payload");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new PairingFlowError("malformed_payload");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PairingFlowError("malformed_payload");
  }
  const root = parsed as Record<string, unknown>;

  if (root["type"] !== "hermes-companion-pair") {
    throw new PairingFlowError("invalid_type");
  }

  const version = root["v"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new PairingFlowError("malformed_payload");
  }
  if (version > 1) {
    throw new PairingFlowError(
      "unsupported_version",
      `This pairing code uses format v${version}, which requires a newer Hermes Companion build.`,
    );
  }

  const expiresAt = root["expires_at"];
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new PairingFlowError("malformed_payload");
  }
  if (expiresAt <= nowSeconds) {
    throw new PairingFlowError("pairing_expired");
  }

  const pairId = typeof root["pair_id"] === "string" ? root["pair_id"].trim() : "";
  const secret = typeof root["secret"] === "string" ? root["secret"].trim() : "";
  if (!pairId || secret.length < 16) {
    throw new PairingFlowError("pairing_invalid");
  }

  const hostName =
    typeof root["host_name"] === "string" && root["host_name"].trim()
      ? root["host_name"].trim()
      : "Hermes host";

  const rawRedeem = root["redeem"];
  if (!rawRedeem || typeof rawRedeem !== "object" || Array.isArray(rawRedeem)) {
    throw new PairingFlowError("malformed_payload");
  }
  const redeemObj = rawRedeem as Record<string, unknown>;
  const mode = typeof redeemObj["mode"] === "string" ? redeemObj["mode"].trim() : "";
  if (!SUPPORTED_MODES.has(mode)) {
    throw new PairingFlowError(
      "unsupported_mode",
      `Unsupported pairing redemption mode "${mode || "unknown"}".`,
    );
  }
  const path = typeof redeemObj["path"] === "string" ? redeemObj["path"].trim() : "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new PairingFlowError("malformed_payload");
  }
  const portRaw = redeemObj["port"];
  const port =
    typeof portRaw === "number" && Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535
      ? portRaw
      : undefined;

  const rawRoutes = root["routes"];
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
    throw new PairingFlowError("malformed_payload");
  }

  const routes: CompanionPairingRouteEntry[] = rawRoutes.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PairingFlowError("malformed_payload");
    }
    const row = entry as Record<string, unknown>;
    const kind = typeof row["kind"] === "string" && row["kind"].trim() ? row["kind"].trim() : "lan";
    const url = normalizeRouteUrl(row["url"]);
    const gatewayUrl =
      typeof row["gateway_url"] === "string" && row["gateway_url"].trim()
        ? normalizeRouteUrl(row["gateway_url"])
        : typeof row["gatewayUrl"] === "string" && row["gatewayUrl"].trim()
          ? normalizeRouteUrl(row["gatewayUrl"])
          : undefined;
    const dashboardUrl =
      typeof row["dashboard_url"] === "string" && row["dashboard_url"].trim()
        ? normalizeRouteUrl(row["dashboard_url"])
        : typeof row["dashboardUrl"] === "string" && row["dashboardUrl"].trim()
          ? normalizeRouteUrl(row["dashboardUrl"])
          : undefined;

    return {
      kind,
      url,
      ...(gatewayUrl ? { gatewayUrl } : {}),
      ...(dashboardUrl ? { dashboardUrl } : {}),
    };
  });

  return {
    v: 1,
    type: "hermes-companion-pair",
    host_name: hostName,
    routes,
    redeem: {
      mode: mode as PairingRedeemMode,
      path,
      ...(port !== undefined ? { port } : {}),
    },
    pair_id: pairId,
    secret,
    expires_at: expiresAt,
  };
}

export async function probeSinglePairingRoute(
  route: CompanionPairingRouteEntry,
  redeem: CompanionPairingRedeemSpec,
  timeoutMs = 1500,
): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  const targetUrl =
    redeem.mode === "listener" && redeem.port ? replaceUrlPort(route.url, redeem.port) : route.url;
  try {
    const response = await CapacitorHttp.request({
      url: targetUrl,
      method: "GET",
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      responseType: "text",
    });
    const latencyMs = Math.max(1, Date.now() - start);
    // Any HTTP status (200, 302, 401, 403, 404, 405) proves the TCP/HTTP listener is reachable.
    return {
      ok: response.status >= 100 && response.status < 600,
      latencyMs,
    };
  } catch {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - start),
    };
  }
}

function replaceUrlPort(rawUrl: string, port: number): string {
  const parsed = new URL(rawUrl);
  parsed.port = String(port);
  return parsed.toString().replace(/\/+$/, "");
}

export async function probePairingRoutes(
  payload: CompanionPairingPayload,
  timeoutMs = 1500,
): Promise<ProbedPairingRoutes> {
  let winningRoute: CompanionPairingRouteEntry | null = null;
  let winningLatency = 0;

  const tailscaleRoute = payload.routes.find((r) => r.kind.toLowerCase() === "tailscale");
  const lanRoute = payload.routes.find((r) => r.kind.toLowerCase() === "lan");

  for (const route of payload.routes) {
    const res = await probeSinglePairingRoute(route, payload.redeem, timeoutMs);
    if (res.ok) {
      winningRoute = route;
      winningLatency = res.latencyMs;
      break;
    }
  }

  if (!winningRoute) {
    note(`pairing.probe.failed pair_id=${payload.pair_id} routes=${payload.routes.length}`);
    throw new PairingFlowError("routes_unreachable");
  }

  note(
    `pairing.probe.ok pair_id=${payload.pair_id} kind=${winningRoute.kind} latency=${winningLatency}ms`,
  );

  return {
    winningRoute,
    latencyMs: winningLatency,
    ...(tailscaleRoute ? { tailscaleRoute } : {}),
    ...(lanRoute ? { lanRoute } : {}),
  };
}

function mapRedeemErrorCode(status: number, bodyText: string): PairingErrorCode {
  let rawCode = "";
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const candidate =
      parsed["error"] ?? parsed["code"] ?? parsed["detail"] ?? parsed["reason"] ?? "";
    if (typeof candidate === "string") {
      rawCode = candidate.trim().toLowerCase();
    } else if (candidate && typeof candidate === "object") {
      const nested = (candidate as Record<string, unknown>)["code"];
      if (typeof nested === "string") rawCode = nested.trim().toLowerCase();
    }
  } catch {
    rawCode = bodyText.trim().toLowerCase();
  }

  if (rawCode.includes("pairing_expired") || rawCode.includes("expired") || status === 410) {
    return "pairing_expired";
  }
  if (
    rawCode.includes("pairing_used") ||
    rawCode.includes("already_used") ||
    rawCode.includes("burned") ||
    status === 409
  ) {
    return "pairing_used";
  }
  return "pairing_invalid";
}

export function buildRedeemUrl(
  route: CompanionPairingRouteEntry,
  redeem: CompanionPairingRedeemSpec,
): string {
  const base =
    redeem.mode === "listener" && redeem.port
      ? replaceUrlPort(route.url, redeem.port)
      : route.url.replace(/\/+$/, "");
  return `${base}${redeem.path}`;
}

export async function redeemPairingOffer(
  payload: CompanionPairingPayload,
  winningRoute: CompanionPairingRouteEntry,
  deviceName = "Hermes Companion (Android)",
): Promise<CompanionPairingRedeemResult> {
  const redeemUrl = buildRedeemUrl(winningRoute, payload.redeem);
  const requestBody: Record<string, string> = {
    pair_id: payload.pair_id,
    secret: payload.secret,
    device_name: deviceName.trim() || "Hermes Companion",
    ...(payload.redeem.mode === "provider" ? { provider: "companion-pair" } : {}),
  };

  let response: Awaited<ReturnType<typeof CapacitorHttp.request>>;
  try {
    response = await CapacitorHttp.request({
      url: redeemUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: requestBody,
      connectTimeout: 10_000,
      readTimeout: 10_000,
      responseType: "text",
    });
  } catch {
    note(`pairing.redeem.network_error pair_id=${payload.pair_id}`);
    throw new PairingFlowError("routes_unreachable");
  }

  const bodyText =
    typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});

  if (response.status < 200 || response.status >= 300) {
    const code = mapRedeemErrorCode(response.status, bodyText);
    note(`pairing.redeem.rejected pair_id=${payload.pair_id} code=${code}`);
    throw new PairingFlowError(code);
  }

  // Task 1: Capture hermes_session_at / hermes_session_rt from native HTTP response headers
  const capturedCookie = await captureResponseCookies(
    response.headers as Record<string, string | string[] | undefined> | undefined,
  );

  let data: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      note(`pairing.redeem.malformed_response pair_id=${payload.pair_id}`);
      throw new PairingFlowError("pairing_invalid");
    }
  }

  const deviceId =
    (typeof data["device_id"] === "string" && data["device_id"].trim()) ||
    (typeof data["deviceId"] === "string" && data["deviceId"].trim()) ||
    `dev_${payload.pair_id.slice(0, 8)}`;

  const deviceCredential =
    (typeof data["device_credential"] === "string" && data["device_credential"].trim()) ||
    (typeof data["deviceCredential"] === "string" && data["deviceCredential"].trim()) ||
    (typeof data["credential"] === "string" && data["credential"].trim()) ||
    undefined;

  const gatewayToken =
    (typeof data["gateway_token"] === "string" && data["gateway_token"].trim()) ||
    (typeof data["gatewayToken"] === "string" && data["gatewayToken"].trim()) ||
    (typeof data["token"] === "string" && data["token"].trim()) ||
    undefined;

  const rawScope = data["gateway_token_scope"] ?? data["gatewayTokenScope"];
  const gatewayTokenScope: GatewayTokenScope =
    rawScope === "device" || (!gatewayToken && Boolean(deviceCredential)) ? "device" : "shared";

  const gatewayUrl =
    (typeof data["gateway_url"] === "string" && data["gateway_url"].trim()) ||
    (typeof data["gatewayUrl"] === "string" && data["gatewayUrl"].trim()) ||
    undefined;

  const dashboardUrl =
    (typeof data["dashboard_url"] === "string" && data["dashboard_url"].trim()) ||
    (typeof data["dashboardUrl"] === "string" && data["dashboardUrl"].trim()) ||
    undefined;

  const lanGatewayUrl =
    (typeof data["lan_gateway_url"] === "string" && data["lan_gateway_url"].trim()) ||
    (typeof data["lanGatewayUrl"] === "string" && data["lanGatewayUrl"].trim()) ||
    undefined;

  const lanDashboardUrl =
    (typeof data["lan_dashboard_url"] === "string" && data["lan_dashboard_url"].trim()) ||
    (typeof data["lanDashboardUrl"] === "string" && data["lanDashboardUrl"].trim()) ||
    undefined;

  const hostVersion =
    (typeof data["host_version"] === "string" && data["host_version"].trim()) ||
    (typeof data["hermes_version"] === "string" && data["hermes_version"].trim()) ||
    (typeof data["version"] === "string" && data["version"].trim()) ||
    undefined;

  const configVersion =
    typeof data["config_version"] === "number" ? data["config_version"] : undefined;
  const latestConfigVersion =
    typeof data["latest_config_version"] === "number" ? data["latest_config_version"] : undefined;

  note(`pairing.redeem.ok pair_id=${payload.pair_id} device_id=${deviceId}`);

  return {
    deviceId,
    ...(deviceCredential ? { deviceCredential } : {}),
    ...(gatewayToken ? { gatewayToken } : {}),
    gatewayTokenScope,
    ...(gatewayUrl ? { gatewayUrl: gatewayUrl.replace(/\/+$/, "") } : {}),
    ...(dashboardUrl ? { dashboardUrl: dashboardUrl.replace(/\/+$/, "") } : {}),
    ...(lanGatewayUrl ? { lanGatewayUrl: lanGatewayUrl.replace(/\/+$/, "") } : {}),
    ...(lanDashboardUrl ? { lanDashboardUrl: lanDashboardUrl.replace(/\/+$/, "") } : {}),
    ...(hostVersion ? { hostVersion } : {}),
    ...(configVersion !== undefined ? { configVersion } : {}),
    ...(latestConfigVersion !== undefined ? { latestConfigVersion } : {}),
    sessionCookieCaptured: Boolean(capturedCookie),
  };
}

export async function signInWithDeviceCredential(input: {
  dashboardBaseUrl: string;
  deviceId?: string | undefined;
  credential?: string | undefined;
}): Promise<boolean> {
  const secret = (input.credential ?? (await getDeviceCredential())).trim();
  if (!secret) return false;
  const cleanBase = input.dashboardBaseUrl.trim().replace(/\/+$/, "");
  if (!cleanBase) return false;
  try {
    const response = await CapacitorHttp.request({
      url: `${cleanBase}/auth/pairing-login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: {
        provider: "companion-pair",
        ...(input.deviceId ? { device_id: input.deviceId } : {}),
        device_credential: secret,
      },
      connectTimeout: 10_000,
      readTimeout: 10_000,
      responseType: "text",
    });
    if (response.status >= 200 && response.status < 300) {
      await captureResponseCookies(
        response.headers as Record<string, string | string[] | undefined> | undefined,
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function deriveGatewayAndDashboardUrls(
  route: CompanionPairingRouteEntry,
  redeemResult?: CompanionPairingRedeemResult,
  isLan = false,
): { gatewayUrl: string; dashboardUrl: string } {
  const explicitGateway = isLan
    ? redeemResult?.lanGatewayUrl || route.gatewayUrl
    : redeemResult?.gatewayUrl || route.gatewayUrl;
  const explicitDashboard = isLan
    ? redeemResult?.lanDashboardUrl || route.dashboardUrl
    : redeemResult?.dashboardUrl || route.dashboardUrl;

  const rawUrl = route.url.replace(/\/+$/, "");
  let gatewayUrl = explicitGateway ?? "";
  let dashboardUrl = explicitDashboard ?? "";

  if (!gatewayUrl && !dashboardUrl) {
    if (rawUrl.endsWith("/dashboard")) {
      dashboardUrl = rawUrl;
      gatewayUrl = rawUrl.replace(/\/dashboard$/, "");
    } else {
      const parsed = new URL(rawUrl);
      if (parsed.port === "9119") {
        dashboardUrl = rawUrl;
        parsed.port = "8642";
        gatewayUrl = parsed.toString().replace(/\/+$/, "");
      } else {
        gatewayUrl = rawUrl;
        try {
          dashboardUrl = dashboardUrlFromGateway(rawUrl);
        } catch {
          dashboardUrl = rawUrl;
        }
      }
    }
  } else if (gatewayUrl && !dashboardUrl) {
    try {
      dashboardUrl = dashboardUrlFromGateway(gatewayUrl);
    } catch {
      dashboardUrl = rawUrl;
    }
  } else if (!gatewayUrl && dashboardUrl) {
    gatewayUrl = dashboardUrl.endsWith("/dashboard")
      ? dashboardUrl.replace(/\/dashboard$/, "")
      : rawUrl;
  }

  return { gatewayUrl, dashboardUrl };
}

export async function completeCompanionPairing(input: {
  rawPayload: string;
  config: HermesConfig;
  update: (patch: Partial<HermesConfig>) => void;
  deviceName?: string | undefined;
  onStep?: ((step: string) => void) | undefined;
}): Promise<CompanionPairingOutcome> {
  const payload = parseCompanionPairingPayload(input.rawPayload);

  input.onStep?.("Probing host routes…");
  const probed = await probePairingRoutes(payload);

  input.onStep?.("Redeeming pairing offer…");
  const redeemed = await redeemPairingOffer(payload, probed.winningRoute, input.deviceName);

  const primaryRoute = probed.tailscaleRoute ?? probed.winningRoute;
  const primaryUrls = deriveGatewayAndDashboardUrls(primaryRoute, redeemed, false);
  const lanUrls = probed.lanRoute
    ? deriveGatewayAndDashboardUrls(probed.lanRoute, redeemed, true)
    : null;

  const effectiveToken = redeemed.gatewayToken ?? redeemed.deviceCredential ?? input.config.token;

  // If redemption used listener/plugin-public and returned a device_credential without a session cookie,
  // attempt provider login to establish hermes_session_at / hermes_session_rt cookie.
  if (!redeemed.sessionCookieCaptured && redeemed.deviceCredential && primaryUrls.dashboardUrl) {
    await signInWithDeviceCredential({
      dashboardBaseUrl: primaryUrls.dashboardUrl,
      deviceId: redeemed.deviceId,
      credential: redeemed.deviceCredential,
    });
  }

  const savedHosts = input.config.savedHosts ?? [];
  const existingHost = savedHosts.find((h) => h.baseUrl === primaryUrls.gatewayUrl);
  const hostId = existingHost?.id ?? `host_${Date.now().toString(36)}`;

  // Persist credentials in hardware-backed SecureStorage BEFORE running compatibility check
  if (effectiveToken) {
    await setSecureToken(effectiveToken);
    await setHostToken(hostId, effectiveToken);
  }
  if (redeemed.deviceCredential) {
    await setDeviceCredential(redeemed.deviceCredential);
    await setHostDeviceCredential(hostId, redeemed.deviceCredential);
  }

  const savedEntry: SavedHost = {
    id: hostId,
    label: payload.host_name,
    baseUrl: primaryUrls.gatewayUrl,
    dashboardBaseUrl: primaryUrls.dashboardUrl,
    ...(lanUrls
      ? {
          lanBaseUrl: lanUrls.gatewayUrl,
          lanDashboardBaseUrl: lanUrls.dashboardUrl,
          autoRouteLan: true,
        }
      : {}),
    activeProfile: input.config.activeProfile || "default",
    profilePathPrefix: input.config.profilePathPrefix || "",
    deviceId: redeemed.deviceId,
    gatewayTokenScope: redeemed.gatewayTokenScope,
  };

  const nextSavedHosts = existingHost
    ? savedHosts.map((h) => (h.id === hostId ? savedEntry : h))
    : [...savedHosts, savedEntry];

  const patch: Partial<HermesConfig> = {
    baseUrl: primaryUrls.gatewayUrl,
    dashboardBaseUrl: primaryUrls.dashboardUrl,
    lanBaseUrl: lanUrls?.gatewayUrl ?? "",
    lanDashboardBaseUrl: lanUrls?.dashboardUrl ?? "",
    autoRouteLan: Boolean(lanUrls),
    ...(effectiveToken ? { token: effectiveToken } : {}),
    deviceId: redeemed.deviceId,
    gatewayTokenScope: redeemed.gatewayTokenScope,
    savedHosts: nextSavedHosts,
  };

  // Amendment 4: Always persist host profile and credentials BEFORE version compatibility check
  input.update(patch);
  const nextConfig: HermesConfig = { ...input.config, ...patch };

  // Update active route snapshot using existing resolveOptimalHostRoute logic
  await resolveOptimalHostRoute(nextConfig).catch(() => undefined);

  input.onStep?.("Checking Hermes host version…");
  let compatibility: HostCompatibilityReport;
  if (redeemed.hostVersion) {
    compatibility = evaluateHostCompatibility({
      version: redeemed.hostVersion,
      configVersion: redeemed.configVersion,
      latestConfigVersion: redeemed.latestConfigVersion,
    });
  } else {
    try {
      const updateInfo = await checkHostUpdate(
        probed.winningRoute.kind.toLowerCase() === "lan" && lanUrls
          ? lanUrls.dashboardUrl
          : primaryUrls.dashboardUrl,
      );
      compatibility = evaluateHostCompatibility({
        version: updateInfo.currentVersion,
        configVersion: updateInfo.configVersion,
        latestConfigVersion: updateInfo.latestConfigVersion,
      });
    } catch {
      compatibility = evaluateHostCompatibility({ version: undefined });
    }
  }

  // Amendment 4: Land on /status if version check fails or warns; only land on chat when compatible
  const destination: "chat" | "status" = compatibility.status === "compatible" ? "chat" : "status";

  return {
    hostId,
    hostName: payload.host_name,
    deviceId: redeemed.deviceId,
    gatewayTokenScope: redeemed.gatewayTokenScope,
    winningRoute: probed.winningRoute,
    compatibility,
    destination,
    nextConfig,
  };
}
