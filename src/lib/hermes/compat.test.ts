import { describe, expect, it, vi } from "vitest";
import { evaluateHostCompatibility, parseSemverTuple, resolveOptimalHostRoute } from "./compat";
import { defaultConfig } from "./config";

vi.mock("./secure-storage", () => ({
  getSecureToken: vi.fn().mockResolvedValue(""),
  setSecureToken: vi.fn().mockResolvedValue(undefined),
  getSecureAdminKey: vi.fn().mockResolvedValue(""),
  setSecureAdminKey: vi.fn().mockResolvedValue(undefined),
}));

describe("gateway version compatibility & LAN/Tailscale routing", () => {
  it("parses semantic versions and detects compatible 0.22.2 hosts", () => {
    expect(parseSemverTuple("0.22.2")).toEqual([0, 22, 2]);
    const report = evaluateHostCompatibility({
      version: "0.22.2",
      configVersion: 51,
      latestConfigVersion: 51,
    });
    expect(report.status).toBe("compatible");
    expect(report.headline).toContain("0.22.2");
  });

  it("flags outdated gateways (< 0.20.0), newer untested releases (> 0.22.x), and pending schema migrations", () => {
    const outdated = evaluateHostCompatibility({ version: "0.17.4" });
    expect(outdated.status).toBe("outdated");

    const newer = evaluateHostCompatibility({ version: "0.24.0" });
    expect(newer.status).toBe("newer-untested");

    const mismatch = evaluateHostCompatibility({
      version: "0.22.2",
      configVersion: 49,
      latestConfigVersion: 51,
    });
    expect(mismatch.status).toBe("schema-mismatch");
  });

  it("prefers the LAN HTTPS endpoint when reachable and falls back to Tailscale when LAN times out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // 1. LAN reachable
    fetchMock.mockResolvedValueOnce({ status: 200 });
    const lanResult = await resolveOptimalHostRoute({
      ...defaultConfig,
      baseUrl: "https://mac.example.ts.net",
      lanBaseUrl: "https://mac.local:8443",
      autoRouteLan: true,
    });
    expect(lanResult.route).toBe("lan");
    expect(lanResult.activeBaseUrl).toBe("https://mac.local:8443");

    // 2. LAN fails -> automatic fallback to Tailscale
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    fetchMock.mockResolvedValueOnce({ status: 200 });
    const fallbackResult = await resolveOptimalHostRoute({
      ...defaultConfig,
      baseUrl: "https://mac.example.ts.net",
      lanBaseUrl: "https://mac.local:8443",
      autoRouteLan: true,
    });
    expect(fallbackResult.route).toBe("tailscale");
    expect(fallbackResult.activeBaseUrl).toBe("https://mac.example.ts.net");
    expect(fallbackResult.fallbackReason).toMatch(/Tailscale/i);
  });
});
