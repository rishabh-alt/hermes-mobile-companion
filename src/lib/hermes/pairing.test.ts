import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    CapacitorHttp: {
      request: vi.fn(),
    },
  };
});

import { CapacitorHttp } from "@capacitor/core";
import { defaultConfig } from "./config";
import { clearDebugLog, debugLines } from "./debug-log";
import {
  completeCompanionPairing,
  PAIRING_ERROR_MESSAGES,
  PairingFlowError,
  parseCompanionPairingPayload,
  probePairingRoutes,
  redeemPairingOffer,
} from "./pairing";
import {
  getDashboardCookie,
  getDeviceCredential,
  getHostDeviceCredential,
  getHostToken,
  setDashboardCookie,
  setDeviceCredential,
} from "./secure-storage";
import type { HermesConfig } from "./types";

const SAMPLE_SECRET = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v";

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    type: "hermes-companion-pair",
    host_name: "mogambos-macbook-pro",
    routes: [
      { kind: "tailscale", url: "https://100.104.99.93:9119" },
      { kind: "lan", url: "https://192.168.1.42:9119" },
    ],
    redeem: { mode: "provider", path: "/auth/pairing-login" },
    pair_id: "3f9c1d2e-8a1b-4c2d-9e3f-1234567890ab",
    secret: SAMPLE_SECRET,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  });
}

describe("Hermes Companion QR pairing flow (v1 spec)", () => {
  beforeEach(async () => {
    clearDebugLog();
    await setDashboardCookie("");
    await setDeviceCredential("");
    vi.mocked(CapacitorHttp.request).mockReset();
  });

  it("validates v1 payload and rejects wrong type, future version, expired TTL, and unknown redeem mode", () => {
    const parsed = parseCompanionPairingPayload(makeValidPayload());
    expect(parsed.host_name).toBe("mogambos-macbook-pro");
    expect(parsed.routes).toHaveLength(2);
    expect(parsed.redeem.mode).toBe("provider");

    expect(() =>
      parseCompanionPairingPayload(makeValidPayload({ type: "something-else" })),
    ).toThrow(PAIRING_ERROR_MESSAGES.invalid_type);

    expect(() => parseCompanionPairingPayload(makeValidPayload({ v: 2 }))).toThrow(/v2/i);

    expect(() =>
      parseCompanionPairingPayload(
        makeValidPayload({ expires_at: Math.floor(Date.now() / 1000) - 10 }),
      ),
    ).toThrow(PAIRING_ERROR_MESSAGES.pairing_expired);

    expect(() =>
      parseCompanionPairingPayload(
        makeValidPayload({ redeem: { mode: "magic-bluetooth", path: "/redeem" } }),
      ),
    ).toThrow(/Unsupported pairing redemption mode/i);
  });

  it("probes routes in order and throws routes_unreachable copy when all routes fail", async () => {
    const payload = parseCompanionPairingPayload(makeValidPayload());
    const reqMock = vi
      .mocked(CapacitorHttp.request)
      .mockRejectedValueOnce(new Error("Tailscale interface down"))
      .mockResolvedValueOnce({
        status: 401,
        headers: {},
        data: "Unauthorized",
        url: "https://192.168.1.42:9119",
      });

    const probed = await probePairingRoutes(payload);
    expect(probed.winningRoute.kind).toBe("lan");
    expect(probed.winningRoute.url).toBe("https://192.168.1.42:9119");
    expect(reqMock).toHaveBeenCalledTimes(2);

    reqMock.mockRejectedValue(new Error("Network unreachable"));
    await expect(probePairingRoutes(payload)).rejects.toThrow(
      PAIRING_ERROR_MESSAGES.routes_unreachable,
    );
  });

  it("maps pairing_expired, pairing_used, and pairing_invalid error responses and never logs secrets", async () => {
    const payload = parseCompanionPairingPayload(makeValidPayload());
    const route = payload.routes[0]!;

    const reqMock = vi.mocked(CapacitorHttp.request);

    reqMock.mockResolvedValueOnce({
      status: 410,
      headers: {},
      data: JSON.stringify({ error: "pairing_expired" }),
      url: "https://100.104.99.93:9119/auth/pairing-login",
    });
    await expect(redeemPairingOffer(payload, route)).rejects.toThrow(
      PAIRING_ERROR_MESSAGES.pairing_expired,
    );

    reqMock.mockResolvedValueOnce({
      status: 409,
      headers: {},
      data: JSON.stringify({ error: "pairing_used" }),
      url: "https://100.104.99.93:9119/auth/pairing-login",
    });
    await expect(redeemPairingOffer(payload, route)).rejects.toThrow(
      PAIRING_ERROR_MESSAGES.pairing_used,
    );

    reqMock.mockResolvedValueOnce({
      status: 401,
      headers: {},
      data: JSON.stringify({ error: "pairing_invalid" }),
      url: "https://100.104.99.93:9119/auth/pairing-login",
    });
    await expect(redeemPairingOffer(payload, route)).rejects.toThrow(
      PAIRING_ERROR_MESSAGES.pairing_invalid,
    );

    // Ensure the secret never appears anywhere in the debug log
    const logs = JSON.stringify(debugLines());
    expect(logs).not.toContain(SAMPLE_SECRET);
  });

  it("captures hermes_session cookies via CapacitorHttp, persists host profile + credentials, and routes to chat on 0.22.2", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const reqMock = vi
      .mocked(CapacitorHttp.request)
      // 1. Route probe (tailscale)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: "OK",
        url: "https://100.104.99.93:9119",
      })
      // 2. Redeem offer (/auth/pairing-login)
      .mockResolvedValueOnce({
        status: 200,
        headers: {
          "Set-Cookie":
            "hermes_session_at=at_paired_222; Path=/; HttpOnly; SameSite=Lax, hermes_session_rt=rt_paired_222; Path=/; HttpOnly; SameSite=Lax",
        },
        data: JSON.stringify({
          device_id: "dev_s24_ultra",
          device_credential: "devcred_256bit_secret_xyz",
          gateway_token: "gw_token_999",
          gateway_token_scope: "shared",
          gateway_url: "https://100.104.99.93:8642",
          dashboard_url: "https://100.104.99.93:9119",
          lan_gateway_url: "https://192.168.1.42:8642",
          lan_dashboard_url: "https://192.168.1.42:9119",
          host_version: "0.22.2",
        }),
        url: "https://100.104.99.93:9119/auth/pairing-login",
      });

    let currentConfig: HermesConfig = { ...defaultConfig };
    const outcome = await completeCompanionPairing({
      rawPayload: makeValidPayload(),
      config: currentConfig,
      update: (patch) => {
        currentConfig = { ...currentConfig, ...patch };
      },
      deviceName: "Rishab's S24 Ultra",
    });

    expect(outcome.destination).toBe("chat");
    expect(outcome.compatibility.status).toBe("compatible");
    expect(outcome.compatibility.hostVersion).toBe("0.22.2");
    expect(await getDashboardCookie()).toBe(
      "hermes_session_at=at_paired_222; hermes_session_rt=rt_paired_222",
    );
    expect(await getDeviceCredential()).toBe("devcred_256bit_secret_xyz");
    expect(await getHostDeviceCredential(outcome.hostId)).toBe("devcred_256bit_secret_xyz");
    expect(await getHostToken(outcome.hostId)).toBe("gw_token_999");
    expect(currentConfig.baseUrl).toBe("https://100.104.99.93:8642");
    expect(currentConfig.dashboardBaseUrl).toBe("https://100.104.99.93:9119");
    expect(currentConfig.lanBaseUrl).toBe("https://192.168.1.42:8642");
    expect(currentConfig.autoRouteLan).toBe(true);
    expect(currentConfig.savedHosts).toHaveLength(1);
    expect(reqMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the paired host profile and routes to /status when version check fails after successful redeem", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    vi.mocked(CapacitorHttp.request)
      // 1. Route probe
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: "OK",
        url: "https://100.104.99.93:9119",
      })
      // 2. Redeem offer with outdated version 0.18.0
      .mockResolvedValueOnce({
        status: 200,
        headers: {
          "set-cookie": "hermes_session_at=at_old_host; Path=/; HttpOnly",
        },
        data: JSON.stringify({
          device_id: "dev_legacy",
          device_credential: "devcred_legacy_secret",
          gateway_token: "gw_legacy_tok",
          gateway_url: "https://100.104.99.93:8642",
          dashboard_url: "https://100.104.99.93:9119",
          host_version: "0.18.0",
        }),
        url: "https://100.104.99.93:9119/auth/pairing-login",
      });

    let currentConfig: HermesConfig = { ...defaultConfig };
    const outcome = await completeCompanionPairing({
      rawPayload: makeValidPayload(),
      config: currentConfig,
      update: (patch) => {
        currentConfig = { ...currentConfig, ...patch };
      },
    });

    // Amendment 4: Host profile is preserved and destination is /status (not chat)
    expect(outcome.compatibility.status).toBe("outdated");
    expect(outcome.destination).toBe("status");
    expect(currentConfig.baseUrl).toBe("https://100.104.99.93:8642");
    expect(currentConfig.savedHosts).toHaveLength(1);
    expect(currentConfig.savedHosts?.[0]?.label).toBe("mogambos-macbook-pro");
    expect(await getDeviceCredential()).toBe("devcred_legacy_secret");
  });

  it("supports ephemeral listener mode with custom port", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    const reqMock = vi
      .mocked(CapacitorHttp.request)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: "OK",
        url: "https://100.104.99.93:9121",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({
          device_id: "dev_listener_1",
          device_credential: "cred_listener_1",
          gateway_token: "tok_listener_1",
          gateway_token_scope: "device",
          gateway_url: "https://100.104.99.93:8642",
          dashboard_url: "https://100.104.99.93:9119",
          host_version: "0.22.2",
        }),
        url: "https://100.104.99.93:9121/redeem",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {
          "set-cookie": "hermes_session_at=at_from_cred; Path=/; HttpOnly",
        },
        data: JSON.stringify({ ok: true }),
        url: "https://100.104.99.93:9119/auth/pairing-login",
      });

    let currentConfig: HermesConfig = { ...defaultConfig };
    const outcome = await completeCompanionPairing({
      rawPayload: makeValidPayload({
        redeem: { mode: "listener", path: "/redeem", port: 9121 },
      }),
      config: currentConfig,
      update: (patch) => {
        currentConfig = { ...currentConfig, ...patch };
      },
    });

    expect(outcome.destination).toBe("chat");
    expect(outcome.gatewayTokenScope).toBe("device");
    expect(reqMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://100.104.99.93:9121/redeem",
        method: "POST",
      }),
    );
    expect(await getDashboardCookie()).toBe("hermes_session_at=at_from_cred");
    expect(PairingFlowError).toBeDefined();
  });
});
