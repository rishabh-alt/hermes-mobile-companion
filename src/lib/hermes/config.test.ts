import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string>>(),
  set: vi.fn<(value: string) => Promise<void>>(),
}));

vi.mock("./secure-storage", () => ({
  getSecureToken: secure.get,
  setSecureToken: secure.set,
}));

import { defaultConfig, loadConfig, writeConfig } from "./config";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  secure.get.mockReset().mockResolvedValue("");
  secure.set.mockReset().mockResolvedValue();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
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

describe("gateway token persistence", () => {
  it("never writes the token to WebView localStorage", () => {
    writeConfig({ ...defaultConfig, baseUrl: "https://example.com", token: "private-token" });
    const persisted = values.get("hermes.config.v1") ?? "";
    expect(persisted).not.toContain("private-token");
    expect(JSON.parse(persisted)).not.toHaveProperty("token");
  });

  it("migrates a legacy plaintext token to secure storage and removes it", async () => {
    values.set(
      "hermes.config.v1",
      JSON.stringify({ baseUrl: "https://example.com", token: "legacy-token" }),
    );

    const loaded = await loadConfig();

    expect(loaded.token).toBe("legacy-token");
    expect(secure.set).toHaveBeenCalledWith("legacy-token");
    expect(JSON.parse(values.get("hermes.config.v1") ?? "{}")).not.toHaveProperty("token");
  });

  it("purges legacy browser-stored session transcripts during secure config migration", async () => {
    values.set(
      "hermes.sessions.v1",
      JSON.stringify([{ id: "old-local-session", messages: [{ text: "private" }] }]),
    );

    await loadConfig();

    expect(values.has("hermes.sessions.v1")).toBe(false);
  });
});
