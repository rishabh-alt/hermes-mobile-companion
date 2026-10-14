import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  dashboardUrlFromGateway,
  mainModelFromConfig,
  normalizeDashboardUrl,
} from "./dashboard";

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
});
