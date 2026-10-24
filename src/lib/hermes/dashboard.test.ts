import { describe, expect, it, vi } from "vitest";

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
import {
  captureResponseCookies,
  cookieHeader,
  dashboardJson,
  dashboardUrlFromGateway,
  mainModelFromConfig,
  mergeCookieStrings,
  normalizeDashboardUrl,
  parseArchivedSessionsPayload,
  parseDashboardEnvPayload,
  parseHostMemoryPayload,
  parseHostUpdatePayload,
  parseMemoryFactsPayload,
  parsePairedDevicesPayload,
  parsePairingInput,
  parseVaultCredentialsPayload,
  sanitizePairingUrl,
} from "./dashboard";
import { encodeGatewayAddressQr } from "./qr";
import { getDashboardCookie, setDashboardCookie } from "./secure-storage";

describe("dashboard address", () => {
  it("keeps the /dashboard prefix and drops one trailing slash", () => {
    expect(normalizeDashboardUrl("https://mac.example.ts.net/dashboard/")).toBe(
      "https://mac.example.ts.net/dashboard",
    );
  });

  it("derives the dashboard path from a bare chat address", () => {
    expect(dashboardUrlFromGateway("https://mac.example.ts.net")).toBe(
      "https://mac.example.ts.net/dashboard",
    );
  });

  it("reads the nested main model without treating the whole config as the name", () => {
    expect(mainModelFromConfig({ model: { provider: "xai", default: "grok-4.7" } })).toEqual({
      provider: "xai",
      model: "grok-4.7",
    });
  });

  it("keeps only the cookie pair from a set-cookie header and handles Expires commas and arrays", async () => {
    expect(cookieHeader("session=abc; Path=/; HttpOnly, theme=dark; Path=/")).toBe(
      "session=abc; theme=dark",
    );
    expect(
      cookieHeader([
        "hermes_session_at=at_tok_1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax",
        "hermes_session_rt=rt_tok_1; Path=/; HttpOnly; SameSite=Lax",
      ]),
    ).toBe("hermes_session_at=at_tok_1; hermes_session_rt=rt_tok_1");
    expect(
      mergeCookieStrings(
        "hermes_session_at=old_at; hermes_session_rt=rt_tok_1",
        "hermes_session_at=new_at",
      ),
    ).toBe("hermes_session_at=new_at; hermes_session_rt=rt_tok_1");

    await setDashboardCookie("");
    await captureResponseCookies({
      "Set-Cookie": [
        "hermes_session_at=at_live_99; Path=/; HttpOnly",
        "hermes_session_rt=rt_live_99; Path=/; HttpOnly",
      ],
    });
    expect(await getDashboardCookie()).toBe(
      "hermes_session_at=at_live_99; hermes_session_rt=rt_live_99",
    );

    const reqMock = vi.mocked(CapacitorHttp.request);
    reqMock.mockResolvedValueOnce({
      status: 200,
      headers: {
        "set-cookie": "hermes_session_at=at_rotated_100; Path=/; HttpOnly",
      },
      data: JSON.stringify({ ok: true }),
      url: "https://mac.example.ts.net/dashboard/api/status",
    });
    await dashboardJson("https://mac.example.ts.net/dashboard", "/api/status", "GET");
    expect(reqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "hermes_session_at=at_live_99; hermes_session_rt=rt_live_99",
        }),
      }),
    );
    expect(await getDashboardCookie()).toBe(
      "hermes_session_at=at_rotated_100; hermes_session_rt=rt_live_99",
    );
  });

  it("accepts address-only https QR payloads and rejects token-bearing payloads", () => {
    expect(sanitizePairingUrl("https://mac.example.ts.net/")).toBe("https://mac.example.ts.net");
    expect(sanitizePairingUrl('{"baseUrl":"https://mac.example.ts.net"}')).toBe(
      "https://mac.example.ts.net",
    );
    expect(() =>
      sanitizePairingUrl('{"baseUrl":"https://mac.example.ts.net","token":"secret"}'),
    ).toThrow(/Refusing QR/i);
    expect(() => sanitizePairingUrl("http://mac.example.ts.net")).toThrow(/https/i);
  });

  it("parses one-time pairing codes while rejecting embedded tokens", () => {
    expect(parsePairingInput("hermes-pair:https://mac.example.ts.net#PAIR99")).toEqual({
      baseUrl: "https://mac.example.ts.net",
      oneTimeCode: "PAIR99",
    });
    expect(parsePairingInput("CODE-1234", "https://mac.example.ts.net")).toEqual({
      baseUrl: "https://mac.example.ts.net",
      oneTimeCode: "CODE-1234",
    });
  });

  it("parses safe /api/env status metadata without exposing secrets", () => {
    expect(
      parseDashboardEnvPayload({
        keys: [
          { key: "OPENAI_API_KEY", configured: true, masked: "sk-...1234" },
          { key: "FIRECRAWL_API_KEY", configured: false },
        ],
      }),
    ).toEqual([
      { key: "OPENAI_API_KEY", configured: true, masked: "sk-...1234" },
      { key: "FIRECRAWL_API_KEY", configured: false },
    ]);
  });

  it("parses /api/memory provider, status, and peer facts metadata", () => {
    const payload = {
      memory: {
        provider: "sqlite",
        enabled: true,
        status: "ready",
        entry_count: 14,
        peers: [{ name: "user", facts: [{ id: "f1", fact: "Uses Tailscale Serve" }] }],
      },
    };
    expect(parseHostMemoryPayload(payload)).toEqual({
      provider: "sqlite",
      enabled: true,
      status: "ready",
      entryCount: 14,
      canReset: true,
    });
    expect(parseMemoryFactsPayload(payload)).toEqual([
      { id: "f1", peer: "user", fact: "Uses Tailscale Serve" },
    ]);
  });

  it("generates a square QR matrix for a valid https gateway URL and rejects http", () => {
    const matrix = encodeGatewayAddressQr("https://mac.example.ts.net");
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0]?.length).toBe(matrix.length);
    expect(() => encodeGatewayAddressQr("http://mac.example.ts.net")).toThrow(/https/i);
  });

  it("parses paired devices payload from host gateway", () => {
    expect(
      parsePairedDevicesPayload({
        devices: [
          {
            id: "dev_pixel",
            name: "Pixel 9 Pro",
            platform: "Android",
            last_seen: "2m ago",
            current: true,
          },
        ],
      }),
    ).toEqual([
      {
        id: "dev_pixel",
        name: "Pixel 9 Pro",
        platform: "Android",
        lastSeen: "2m ago",
        current: true,
      },
    ]);
  });

  it("parses archived sessions list and filters out active sessions", () => {
    expect(
      parseArchivedSessionsPayload({
        sessions: [
          { id: "s_arch", title: "Old migration log", archived: true, message_count: 12 },
          { id: "s_live", title: "Current work", archived: false },
        ],
      }),
    ).toEqual([
      {
        id: "s_arch",
        title: "Old migration log",
        messageCount: 12,
      },
    ]);
  });

  it("parses host update check payload and detects available updates and config_version", () => {
    expect(
      parseHostUpdatePayload({
        update: {
          current_version: "0.21.0",
          latest_version: "0.22.0",
          commit: "a1b2c3d",
          can_apply: true,
          config_version: 3,
          latest_config_version: 4,
        },
      }),
    ).toEqual({
      currentVersion: "0.21.0",
      latestVersion: "0.22.0",
      commit: "a1b2c3d",
      updateAvailable: true,
      canApply: true,
      configVersion: 3,
      latestConfigVersion: 4,
    });
  });

  it("parses host credential vault metadata without exposing secrets", () => {
    expect(
      parseVaultCredentialsPayload({
        credentials: [
          {
            id: "cred_gh",
            domain: "github.com",
            username: "rdeol",
            password: "never-returned-to-phone",
            updated_at: "2026-10-18",
          },
        ],
      }),
    ).toEqual([
      {
        id: "cred_gh",
        domain: "github.com",
        username: "rdeol",
        updatedAt: "2026-10-18",
      },
    ]);
  });
});
