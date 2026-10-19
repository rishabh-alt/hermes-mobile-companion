import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./secure-storage", () => ({
  getSecureToken: vi.fn().mockResolvedValue(""),
  setSecureToken: vi.fn().mockResolvedValue(undefined),
  getSecureAdminKey: vi.fn().mockResolvedValue(""),
  setSecureAdminKey: vi.fn().mockResolvedValue(undefined),
}));

import { defaultConfig, writeConfig } from "./config";
import {
  applyPhoneConfigBackup,
  createPhoneConfigBackup,
  parsePhoneConfigBackup,
  resetPhoneConfigToDefaults,
} from "./config-backup";

const store = new Map<string, string>();

describe("phone config backup & restore", () => {
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
          removeItem: (key: string) => store.delete(key),
        },
        dispatchEvent: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "CustomEvent", {
      configurable: true,
      value: class {
        constructor(public type: string) {}
      },
    });
  });

  it("exports non-secret config and strips tokens", () => {
    const json = createPhoneConfigBackup({
      ...defaultConfig,
      baseUrl: "https://pc.example.ts.net",
      token: "secret-chat-token",
      adminToken: "secret-admin-token",
      theme: "light",
    });

    expect(json).not.toContain("secret-chat-token");
    expect(json).not.toContain("secret-admin-token");
    const parsed = parsePhoneConfigBackup(json);
    expect(parsed.configPatch.baseUrl).toBe("https://pc.example.ts.net");
    expect(parsed.configPatch.theme).toBe("light");
  });

  it("rejects backup files containing secret tokens or http URLs", () => {
    expect(() =>
      parsePhoneConfigBackup(
        JSON.stringify({ config: { baseUrl: "https://pc.example.ts.net", token: "leaked" } }),
      ),
    ).toThrow(/Refusing backup/i);

    expect(() =>
      parsePhoneConfigBackup(JSON.stringify({ config: { baseUrl: "http://pc.example.ts.net" } })),
    ).toThrow(/https/i);

    expect(() =>
      parsePhoneConfigBackup(
        JSON.stringify({
          config: {
            baseUrl: "https://pc.example.ts.net",
            savedHosts: [
              {
                id: "host-1",
                label: "Insecure Host",
                baseUrl: "http://insecure.example.ts.net",
                dashboardBaseUrl: "",
              },
            ],
          },
        }),
      ),
    ).toThrow(/savedHosts.*https/i);

    expect(() =>
      parsePhoneConfigBackup(
        JSON.stringify({
          config: {
            baseUrl: "https://pc.example.ts.net",
            savedHosts: [
              {
                id: "host-1",
                label: "Insecure Dashboard",
                baseUrl: "https://pc.example.ts.net",
                dashboardBaseUrl: "http://pc.example.ts.net:8642",
              },
            ],
          },
        }),
      ),
    ).toThrow(/savedHosts.*https/i);
  });

  it("applies a valid backup and resets to defaults while preserving existing runtime token on import", () => {
    writeConfig({ ...defaultConfig, token: "keep-me" });
    const updated = applyPhoneConfigBackup(
      JSON.stringify({
        version: 1,
        config: {
          baseUrl: "https://headless.example.ts.net",
          fontScale: "lg",
        },
      }),
    );
    expect(updated.baseUrl).toBe("https://headless.example.ts.net");
    expect(updated.fontScale).toBe("lg");
    expect(updated.token).toBe("keep-me");

    const reset = resetPhoneConfigToDefaults();
    expect(reset.baseUrl).toBe("");
    expect(reset.token).toBe("");
  });
});
