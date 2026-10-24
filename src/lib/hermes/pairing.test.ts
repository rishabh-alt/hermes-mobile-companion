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
  buildRedeemUrl,
  completeCompanionPairing,
  isCompanionPairingPayloadCandidate,
  PAIRING_ERROR_MESSAGES,
  type PairingErrorCode,
  PairingFlowError,
  type PairingRedeemMode,
  parseCompanionPairingPayload,
  probePairingRoutes,
  probeSinglePairingRoute,
  redeemPairingOffer,
  signInWithDeviceCredential,
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
const SAMPLE_DEVICE_CRED = "devcred_256bit_secret_never_log_me_987654321";
const SAMPLE_GATEWAY_TOKEN = "gw_token_secret_never_log_me_123456789";

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

function assertNoSecretsInDebugLog() {
  const dumped = JSON.stringify(debugLines());
  expect(dumped).not.toContain(SAMPLE_SECRET);
  expect(dumped).not.toContain(SAMPLE_DEVICE_CRED);
  expect(dumped).not.toContain(SAMPLE_GATEWAY_TOKEN);
}

describe("Hermes Companion QR pairing flow (v1 spec + Mechanism D)", () => {
  beforeEach(async () => {
    clearDebugLog();
    await setDashboardCookie("");
    await setDeviceCredential("");
    vi.mocked(CapacitorHttp.request).mockReset();
  });

  describe("1. Payload candidate detection & schema validation", () => {
    it("detects candidate JSON payloads and ignores plain URLs or invalid JSON", () => {
      expect(isCompanionPairingPayloadCandidate(makeValidPayload())).toBe(true);
      expect(isCompanionPairingPayloadCandidate('{"pair_id":"abc"}')).toBe(true);
      expect(isCompanionPairingPayloadCandidate('{"redeem":{"mode":"gateway"}}')).toBe(true);
      expect(isCompanionPairingPayloadCandidate("https://100.104.99.93:8642")).toBe(false);
      expect(isCompanionPairingPayloadCandidate("{not-json")).toBe(false);
      expect(isCompanionPairingPayloadCandidate('{"hello":"world"}')).toBe(false);
    });

    it("accepts all four supported redeem modes (gateway, provider, plugin-public, listener) and normalizes api_server_port", () => {
      const modes: PairingRedeemMode[] = ["gateway", "provider", "plugin-public", "listener"];
      for (const mode of modes) {
        const parsed = parseCompanionPairingPayload(
          makeValidPayload({
            redeem: { mode, path: "/v1/companion/redeem", api_server_port: 8642 },
          }),
        );
        expect(parsed.redeem.mode).toBe(mode);
        expect(parsed.redeem.path).toBe("/v1/companion/redeem");
        expect(parsed.redeem.port).toBe(8642);
      }

      const withGatewayPort = parseCompanionPairingPayload(
        makeValidPayload({
          redeem: { mode: "gateway", path: "/v1/companion/redeem", gateway_port: 8443 },
        }),
      );
      expect(withGatewayPort.redeem.port).toBe(8443);
    });

    it("enforces every payload validation error code (invalid_type, unsupported_version, pairing_expired, pairing_invalid, unsupported_mode, malformed_payload)", () => {
      const expectCode = (raw: string, expectedCode: PairingErrorCode) => {
        try {
          parseCompanionPairingPayload(raw);
          expect.fail(`Expected PairingFlowError(${expectedCode}) for payload: ${raw}`);
        } catch (err) {
          expect(err).toBeInstanceOf(PairingFlowError);
          expect((err as PairingFlowError).code).toBe(expectedCode);
        }
      };

      // invalid_type
      expectCode(makeValidPayload({ type: "something-else" }), "invalid_type");

      // unsupported_version
      expectCode(makeValidPayload({ v: 2 }), "unsupported_version");

      // pairing_expired
      expectCode(
        makeValidPayload({ expires_at: Math.floor(Date.now() / 1000) - 5 }),
        "pairing_expired",
      );

      // pairing_invalid (missing pair_id or short secret)
      expectCode(makeValidPayload({ pair_id: "   " }), "pairing_invalid");
      expectCode(makeValidPayload({ secret: "too_short" }), "pairing_invalid");

      // unsupported_mode
      expectCode(
        makeValidPayload({ redeem: { mode: "magic-bluetooth", path: "/redeem" } }),
        "unsupported_mode",
      );
      expectCode(makeValidPayload({ redeem: { mode: "", path: "/redeem" } }), "unsupported_mode");

      // malformed_payload cases
      expectCode("", "malformed_payload");
      expectCode("not-json", "malformed_payload");
      expectCode("[]", "malformed_payload");
      expectCode(makeValidPayload({ v: 0 }), "malformed_payload");
      expectCode(makeValidPayload({ v: 1.5 }), "malformed_payload");
      expectCode(makeValidPayload({ expires_at: "tomorrow" }), "malformed_payload");
      expectCode(makeValidPayload({ redeem: null }), "malformed_payload");
      expectCode(
        makeValidPayload({ redeem: { mode: "provider", path: "relative/path" } }),
        "malformed_payload",
      );
      expectCode(
        makeValidPayload({ redeem: { mode: "provider", path: "//evil.example.com/redeem" } }),
        "malformed_payload",
      );
      expectCode(makeValidPayload({ routes: [] }), "malformed_payload");
      expectCode(makeValidPayload({ routes: ["not-an-object"] }), "malformed_payload");
      expectCode(
        makeValidPayload({ routes: [{ kind: "lan", url: "not-a-url" }] }),
        "malformed_payload",
      );
      expectCode(
        makeValidPayload({ routes: [{ kind: "lan", url: "ftp://192.168.1.42:9119" }] }),
        "malformed_payload",
      );
      expectCode(
        makeValidPayload({
          routes: [{ kind: "lan", url: "https://user:pass@192.168.1.42:9119" }],
        }),
        "malformed_payload",
      );
    });
  });

  describe("2. Route probing across all 4 redeem modes", () => {
    it("probes routes in order, picks first reachable route, and throws routes_unreachable when all fail", async () => {
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
      expect(probed.tailscaleRoute?.url).toBe("https://100.104.99.93:9119");
      expect(probed.lanRoute?.url).toBe("https://192.168.1.42:9119");
      expect(reqMock).toHaveBeenCalledTimes(2);

      reqMock.mockRejectedValue(new Error("Network unreachable"));
      await expect(probePairingRoutes(payload)).rejects.toThrow(
        PAIRING_ERROR_MESSAGES.routes_unreachable,
      );
      assertNoSecretsInDebugLog();
    });

    it("resolves probe and redeem URLs accurately for provider, plugin-public, listener, and gateway (Mechanism D)", async () => {
      const routeWithGateway = {
        kind: "tailscale",
        url: "https://100.104.99.93:9119",
        gatewayUrl: "https://100.104.99.93:8642",
      };
      const routeWithoutGateway = {
        kind: "tailscale",
        url: "https://100.104.99.93:9119",
      };

      // provider
      expect(
        buildRedeemUrl(routeWithGateway, { mode: "provider", path: "/auth/pairing-login" }),
      ).toBe("https://100.104.99.93:9119/auth/pairing-login");

      // plugin-public
      expect(
        buildRedeemUrl(routeWithGateway, {
          mode: "plugin-public",
          path: "/api/plugins/companion-pair/redeem",
        }),
      ).toBe("https://100.104.99.93:9119/api/plugins/companion-pair/redeem");

      // listener with custom port
      expect(
        buildRedeemUrl(routeWithoutGateway, { mode: "listener", path: "/redeem", port: 9121 }),
      ).toBe("https://100.104.99.93:9121/redeem");

      // gateway (Mechanism D) with route.gatewayUrl
      expect(
        buildRedeemUrl(routeWithGateway, {
          mode: "gateway",
          path: "/v1/companion/redeem",
          port: 8443,
        }),
      ).toBe("https://100.104.99.93:8642/v1/companion/redeem");

      // gateway (Mechanism D) without route.gatewayUrl, using port from redeem block
      expect(
        buildRedeemUrl(routeWithoutGateway, {
          mode: "gateway",
          path: "/v1/companion/redeem",
          port: 8642,
        }),
      ).toBe("https://100.104.99.93:8642/v1/companion/redeem");

      // Probe single route in gateway mode uses gatewayUrl
      const reqMock = vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: "OK",
        url: "https://100.104.99.93:8642",
      });
      const probeRes = await probeSinglePairingRoute(routeWithGateway, {
        mode: "gateway",
        path: "/v1/companion/redeem",
      });
      expect(probeRes.ok).toBe(true);
      expect(reqMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://100.104.99.93:8642",
          method: "GET",
        }),
      );
    });
  });

  describe("3. Error matrix × Redeem modes & Secret redaction", () => {
    const modes: Array<{
      mode: PairingRedeemMode;
      path: string;
      port?: number;
      gatewayUrl?: string;
    }> = [
      { mode: "gateway", path: "/v1/companion/redeem", gatewayUrl: "https://100.104.99.93:8642" },
      { mode: "provider", path: "/auth/pairing-login" },
      { mode: "plugin-public", path: "/api/plugins/companion-pair/redeem" },
      { mode: "listener", path: "/redeem", port: 9121 },
    ];

    it.each(modes)(
      "maps pairing_expired, pairing_used, pairing_invalid, and network errors in $mode mode without logging secrets",
      async ({ mode, path, port, gatewayUrl }) => {
        const payload = parseCompanionPairingPayload(
          makeValidPayload({
            routes: [
              {
                kind: "tailscale",
                url: "https://100.104.99.93:9119",
                ...(gatewayUrl ? { gateway_url: gatewayUrl } : {}),
              },
            ],
            redeem: { mode, path, ...(port ? { port } : {}) },
          }),
        );
        const route = payload.routes[0]!;
        const reqMock = vi.mocked(CapacitorHttp.request);

        // 1. pairing_expired (410 JSON & 400 plain text "expired")
        reqMock.mockResolvedValueOnce({
          status: 410,
          headers: {},
          data: JSON.stringify({ error: "pairing_expired" }),
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_expired",
          message: PAIRING_ERROR_MESSAGES.pairing_expired,
        });

        reqMock.mockResolvedValueOnce({
          status: 400,
          headers: {},
          data: "Offer has expired",
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_expired",
        });

        // 2. pairing_used (409, "already_used", "burned")
        reqMock.mockResolvedValueOnce({
          status: 409,
          headers: {},
          data: JSON.stringify({ code: "already_used" }),
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_used",
          message: PAIRING_ERROR_MESSAGES.pairing_used,
        });

        reqMock.mockResolvedValueOnce({
          status: 403,
          headers: {},
          data: JSON.stringify({ reason: "offer burned after max attempts" }),
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_used",
        });

        // 3. pairing_invalid (401 nested error object, 500 generic, 200 malformed JSON)
        reqMock.mockResolvedValueOnce({
          status: 401,
          headers: {},
          data: JSON.stringify({ error: { code: "pairing_invalid" } }),
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_invalid",
          message: PAIRING_ERROR_MESSAGES.pairing_invalid,
        });

        reqMock.mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "{malformed-json-from-server",
          url: buildRedeemUrl(route, payload.redeem),
        });
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "pairing_invalid",
        });

        // 4. routes_unreachable on redeem network drop
        reqMock.mockRejectedValueOnce(new Error("ECONNRESET during POST"));
        await expect(redeemPairingOffer(payload, route)).rejects.toMatchObject({
          code: "routes_unreachable",
          message: PAIRING_ERROR_MESSAGES.routes_unreachable,
        });

        assertNoSecretsInDebugLog();
      },
    );
  });

  describe("4. End-to-end redemption across all 4 modes (provider, plugin-public, listener, gateway)", () => {
    it("Mode B (provider): captures hermes_session cookies via CapacitorHttp, persists host profile + credentials, and routes to chat on 0.22.2", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
      const reqMock = vi
        .mocked(CapacitorHttp.request)
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "OK",
          url: "https://100.104.99.93:9119",
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            "Set-Cookie":
              "hermes_session_at=at_paired_222; Path=/; HttpOnly; SameSite=Lax, hermes_session_rt=rt_paired_222; Path=/; HttpOnly; SameSite=Lax",
          },
          data: JSON.stringify({
            device_id: "dev_s24_ultra",
            device_credential: SAMPLE_DEVICE_CRED,
            gateway_token: SAMPLE_GATEWAY_TOKEN,
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
      const steps: string[] = [];
      const outcome = await completeCompanionPairing({
        rawPayload: makeValidPayload(),
        config: currentConfig,
        update: (patch) => {
          currentConfig = { ...currentConfig, ...patch };
        },
        deviceName: "Rishab's S24 Ultra",
        onStep: (step) => steps.push(step),
      });

      expect(outcome.destination).toBe("chat");
      expect(outcome.compatibility.status).toBe("compatible");
      expect(outcome.compatibility.hostVersion).toBe("0.22.2");
      expect(steps).toEqual([
        "Probing host routes…",
        "Redeeming pairing offer…",
        "Checking Hermes host version…",
      ]);
      expect(await getDashboardCookie()).toBe(
        "hermes_session_at=at_paired_222; hermes_session_rt=rt_paired_222",
      );
      expect(await getDeviceCredential()).toBe(SAMPLE_DEVICE_CRED);
      expect(await getHostDeviceCredential(outcome.hostId)).toBe(SAMPLE_DEVICE_CRED);
      expect(await getHostToken(outcome.hostId)).toBe(SAMPLE_GATEWAY_TOKEN);
      expect(currentConfig.baseUrl).toBe("https://100.104.99.93:8642");
      expect(currentConfig.dashboardBaseUrl).toBe("https://100.104.99.93:9119");
      expect(currentConfig.lanBaseUrl).toBe("https://192.168.1.42:8642");
      expect(currentConfig.autoRouteLan).toBe(true);
      expect(currentConfig.savedHosts).toHaveLength(1);
      expect(reqMock).toHaveBeenCalledTimes(2);
      assertNoSecretsInDebugLog();
    });

    it("Mode A (plugin-public): redeems via /api/plugins/companion-pair/redeem and exchanges device_credential for dashboard session cookie", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
      const reqMock = vi
        .mocked(CapacitorHttp.request)
        // 1. Probe
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "OK",
          url: "https://100.104.99.93:9119",
        })
        // 2. Redeem on plugin-public route (no Set-Cookie header returned yet)
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: JSON.stringify({
            deviceId: "dev_plugin_pub_1",
            deviceCredential: SAMPLE_DEVICE_CRED,
            host_version: "0.22.2",
          }),
          url: "https://100.104.99.93:9119/api/plugins/companion-pair/redeem",
        })
        // 3. Follow-up signInWithDeviceCredential call captures Set-Cookie
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            "set-cookie": "hermes_session_at=at_plugin_pub; Path=/; HttpOnly",
          },
          data: JSON.stringify({ ok: true }),
          url: "https://100.104.99.93:9119/auth/pairing-login",
        });

      let currentConfig: HermesConfig = { ...defaultConfig };
      const outcome = await completeCompanionPairing({
        rawPayload: makeValidPayload({
          redeem: { mode: "plugin-public", path: "/api/plugins/companion-pair/redeem" },
        }),
        config: currentConfig,
        update: (patch) => {
          currentConfig = { ...currentConfig, ...patch };
        },
      });

      expect(outcome.destination).toBe("chat");
      expect(outcome.gatewayTokenScope).toBe("device");
      // Port 9119 auto-derives gateway :8642 and dashboard :9119
      expect(currentConfig.baseUrl).toBe("https://100.104.99.93:8642");
      expect(currentConfig.dashboardBaseUrl).toBe("https://100.104.99.93:9119");
      expect(await getDashboardCookie()).toBe("hermes_session_at=at_plugin_pub");
      expect(reqMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: "https://100.104.99.93:9119/api/plugins/companion-pair/redeem",
          method: "POST",
        }),
      );
      assertNoSecretsInDebugLog();
    });

    it("Mode C (listener): probes and redeems against custom listener port", async () => {
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
            device_credential: SAMPLE_DEVICE_CRED,
            gateway_token: SAMPLE_GATEWAY_TOKEN,
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
      assertNoSecretsInDebugLog();
    });

    it("Mode D (gateway): POSTs to route.gateway_url when provided, or winning route host + api_server port when gateway_url is omitted", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
      const reqMock = vi.mocked(CapacitorHttp.request);

      // Case D1: route provides gateway_url explicitly
      reqMock
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "OK",
          url: "https://100.104.99.93:8642",
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            "Set-Cookie": "hermes_session_at=at_gw_d1; Path=/; HttpOnly",
          },
          data: JSON.stringify({
            device_id: "dev_gw_d1",
            device_credential: SAMPLE_DEVICE_CRED,
            gateway_token: SAMPLE_GATEWAY_TOKEN,
            gateway_token_scope: "device",
            host_version: "0.22.2",
          }),
          url: "https://100.104.99.93:8642/v1/companion/redeem",
        });

      let configD1: HermesConfig = { ...defaultConfig };
      const outcomeD1 = await completeCompanionPairing({
        rawPayload: makeValidPayload({
          routes: [
            {
              kind: "tailscale",
              url: "https://100.104.99.93:9119",
              gateway_url: "https://100.104.99.93:8642",
            },
            {
              kind: "lan",
              url: "https://192.168.1.42:9119",
              gateway_url: "https://192.168.1.42:8642",
            },
          ],
          redeem: { mode: "gateway", path: "/v1/companion/redeem" },
        }),
        config: configD1,
        update: (patch) => {
          configD1 = { ...configD1, ...patch };
        },
      });

      expect(outcomeD1.destination).toBe("chat");
      expect(outcomeD1.gatewayTokenScope).toBe("device");
      expect(configD1.baseUrl).toBe("https://100.104.99.93:8642");
      expect(configD1.dashboardBaseUrl).toBe("https://100.104.99.93:9119");
      expect(configD1.lanBaseUrl).toBe("https://192.168.1.42:8642");
      expect(configD1.lanDashboardBaseUrl).toBe("https://192.168.1.42:9119");
      expect(reqMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: "https://100.104.99.93:8642/v1/companion/redeem",
          method: "POST",
        }),
      );

      // Case D2: route omits gateway_url; redeem specifies api_server_port (8642)
      reqMock.mockReset();
      reqMock
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "OK",
          url: "https://100.104.99.93:8642",
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            "Set-Cookie": "hermes_session_at=at_gw_d2; Path=/; HttpOnly",
          },
          data: JSON.stringify({
            device_id: "dev_gw_d2",
            device_credential: SAMPLE_DEVICE_CRED,
            gateway_token_scope: "device",
            host_version: "0.22.2",
          }),
          url: "https://100.104.99.93:8642/v1/companion/redeem",
        });

      let configD2: HermesConfig = { ...defaultConfig };
      const outcomeD2 = await completeCompanionPairing({
        rawPayload: makeValidPayload({
          routes: [{ kind: "tailscale", url: "https://100.104.99.93:9119" }],
          redeem: { mode: "gateway", path: "/v1/companion/redeem", api_server_port: 8642 },
        }),
        config: configD2,
        update: (patch) => {
          configD2 = { ...configD2, ...patch };
        },
      });

      expect(outcomeD2.destination).toBe("chat");
      expect(configD2.baseUrl).toBe("https://100.104.99.93:8642");
      expect(configD2.dashboardBaseUrl).toBe("https://100.104.99.93:9119");
      expect(reqMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: "https://100.104.99.93:8642/v1/companion/redeem",
          method: "POST",
        }),
      );
      assertNoSecretsInDebugLog();
    });
  });

  describe("5. Version check outcomes & saved host profile persistence", () => {
    it("keeps the paired host profile and routes to /status when host version is outdated (0.18.0), ahead (0.25.0), or needs config migration", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
      const reqMock = vi.mocked(CapacitorHttp.request);

      const scenarios = [
        {
          label: "outdated",
          body: { host_version: "0.18.0" },
          expectedStatus: "outdated",
        },
        {
          label: "newer-untested",
          body: { host_version: "0.25.0" },
          expectedStatus: "newer-untested",
        },
        {
          label: "schema-mismatch",
          body: { host_version: "0.22.2", config_version: 2, latest_config_version: 3 },
          expectedStatus: "schema-mismatch",
        },
      ] as const;

      for (const scenario of scenarios) {
        reqMock.mockReset();
        reqMock
          .mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: "OK",
            url: "https://100.104.99.93:9119",
          })
          .mockResolvedValueOnce({
            status: 200,
            headers: {
              "set-cookie": "hermes_session_at=at_compat_test; Path=/; HttpOnly",
            },
            data: JSON.stringify({
              device_id: `dev_${scenario.label}`,
              device_credential: SAMPLE_DEVICE_CRED,
              gateway_token: SAMPLE_GATEWAY_TOKEN,
              gateway_url: "https://100.104.99.93:8642",
              dashboard_url: "https://100.104.99.93:9119",
              ...scenario.body,
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

        expect(outcome.compatibility.status).toBe(scenario.expectedStatus);
        expect(outcome.destination).toBe("status");
        expect(currentConfig.baseUrl).toBe("https://100.104.99.93:8642");
        expect(currentConfig.savedHosts).toHaveLength(1);
        expect(await getDeviceCredential()).toBe(SAMPLE_DEVICE_CRED);
      }

      assertNoSecretsInDebugLog();
    });

    it("falls back to /api/update/check when redeem omits host_version, and lands on /status if update check fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
      const reqMock = vi
        .mocked(CapacitorHttp.request)
        // 1. Probe
        .mockResolvedValueOnce({
          status: 200,
          headers: {},
          data: "OK",
          url: "https://100.104.99.93:9119",
        })
        // 2. Redeem without host_version
        .mockResolvedValueOnce({
          status: 200,
          headers: {
            "set-cookie": "hermes_session_at=at_no_ver; Path=/; HttpOnly",
          },
          data: JSON.stringify({
            device_id: "dev_no_ver",
            device_credential: SAMPLE_DEVICE_CRED,
            gateway_url: "https://100.104.99.93:8642",
            dashboard_url: "https://100.104.99.93:9119",
          }),
          url: "https://100.104.99.93:9119/auth/pairing-login",
        })
        // 3. /api/update/check fails with 500
        .mockResolvedValueOnce({
          status: 500,
          headers: {},
          data: "Internal Server Error",
          url: "https://100.104.99.93:9119/api/update/check",
        });

      let currentConfig: HermesConfig = {
        ...defaultConfig,
        savedHosts: [
          {
            id: "host_existing",
            label: "Old Label",
            baseUrl: "https://100.104.99.93:8642",
            dashboardBaseUrl: "https://100.104.99.93:9119",
            activeProfile: "default",
            profilePathPrefix: "",
          },
        ],
      };

      const outcome = await completeCompanionPairing({
        rawPayload: makeValidPayload(),
        config: currentConfig,
        update: (patch) => {
          currentConfig = { ...currentConfig, ...patch };
        },
      });

      // Updates existing host in-place without duplicating, and lands on /status when version check fails
      expect(outcome.hostId).toBe("host_existing");
      expect(outcome.compatibility.status).toBe("unknown");
      expect(outcome.destination).toBe("status");
      expect(currentConfig.savedHosts).toHaveLength(1);
      expect(currentConfig.savedHosts?.[0]?.label).toBe("mogambos-macbook-pro");
      expect(reqMock).toHaveBeenCalledTimes(3);
      assertNoSecretsInDebugLog();
    });

    it("handles signInWithDeviceCredential edge cases cleanly", async () => {
      expect(await signInWithDeviceCredential({ dashboardBaseUrl: "", credential: "abc" })).toBe(
        false,
      );
      expect(
        await signInWithDeviceCredential({
          dashboardBaseUrl: "https://100.104.99.93:9119",
          credential: "   ",
        }),
      ).toBe(false);

      vi.mocked(CapacitorHttp.request).mockResolvedValueOnce({
        status: 401,
        headers: {},
        data: "Unauthorized",
        url: "https://100.104.99.93:9119/auth/pairing-login",
      });
      expect(
        await signInWithDeviceCredential({
          dashboardBaseUrl: "https://100.104.99.93:9119",
          credential: SAMPLE_DEVICE_CRED,
        }),
      ).toBe(false);

      vi.mocked(CapacitorHttp.request).mockRejectedValueOnce(new Error("Offline"));
      expect(
        await signInWithDeviceCredential({
          dashboardBaseUrl: "https://100.104.99.93:9119",
          credential: SAMPLE_DEVICE_CRED,
        }),
      ).toBe(false);
    });
  });
});
