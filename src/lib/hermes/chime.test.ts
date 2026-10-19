import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./secure-storage", () => ({
  getSecureToken: vi.fn().mockResolvedValue(""),
  setSecureToken: vi.fn().mockResolvedValue(undefined),
  getSecureAdminKey: vi.fn().mockResolvedValue(""),
  setSecureAdminKey: vi.fn().mockResolvedValue(undefined),
}));

import { playCompletionChime } from "./chime";
import { defaultConfig, writeConfig } from "./config";

const store = new Map<string, string>();

describe("playCompletionChime", () => {
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

  it("skips playing when completionChime preference is disabled and force is false", () => {
    writeConfig({
      ...defaultConfig,
      notificationPrefs: { turnComplete: true, approvals: true, completionChime: false },
    });
    expect(playCompletionChime(false)).toBe(false);
  });
});
