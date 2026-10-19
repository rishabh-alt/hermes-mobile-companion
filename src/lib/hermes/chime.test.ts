import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./secure-storage", () => ({
  getSecureToken: vi.fn().mockResolvedValue(""),
  setSecureToken: vi.fn().mockResolvedValue(undefined),
  getSecureAdminKey: vi.fn().mockResolvedValue(""),
  setSecureAdminKey: vi.fn().mockResolvedValue(undefined),
}));

import { playCompletionChime, resetCompletionChimeAudioForTest } from "./chime";
import { defaultConfig, writeConfig } from "./config";

const store = new Map<string, string>();

describe("playCompletionChime", () => {
  beforeEach(() => {
    store.clear();
    resetCompletionChimeAudioForTest();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
          removeItem: (key: string) => store.delete(key),
        },
        dispatchEvent: vi.fn(),
        addEventListener: vi.fn(),
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

  it("reuses a single shared AudioContext and resumes it when suspended", () => {
    let instances = 0;
    const resumeMock = vi.fn().mockResolvedValue(undefined);
    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume = resumeMock;
      constructor() {
        instances += 1;
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
    }

    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;

    expect(playCompletionChime(true)).toBe(true);
    expect(playCompletionChime(true)).toBe(true);
    expect(instances).toBe(1);
    expect(resumeMock).toHaveBeenCalled();
  });
});
