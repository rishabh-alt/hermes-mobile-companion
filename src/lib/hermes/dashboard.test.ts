import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  dashboardUrlFromGateway,
  mainModelFromConfig,
  normalizeDashboardUrl,
  parseDashboardEnvPayload,
  parseHostMemoryPayload,
  parseMemoryFactsPayload,
  parsePairingInput,
  sanitizePairingUrl,
} from "./dashboard";
import { encodeGatewayAddressQr } from "./qr";

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

  it("keeps only the cookie pair from a set-cookie header", () => {
    expect(cookieHeader("session=abc; Path=/; HttpOnly, theme=dark; Path=/")).toBe(
      "session=abc; theme=dark",
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
});
