import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureAppLockPin,
  disableAppLock,
  isAppCurrentlyLocked,
  isAppLockConfigured,
  lockAppNow,
  verifyAndUnlockPin,
} from "./app-lock";

const store = new Map<string, string>();

describe("app lock PIN & gate", () => {
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
    disableAppLock();
  });

  it("is unlocked by default when no PIN is configured", () => {
    expect(isAppLockConfigured()).toBe(false);
    expect(isAppCurrentlyLocked()).toBe(false);
  });

  it("hashes the PIN, locks on demand, and unlocks with the matching PIN", () => {
    configureAppLockPin("4291");
    expect(isAppLockConfigured()).toBe(true);
    expect(store.get("hermes.applock.v1")).not.toContain("4291");
    expect(isAppCurrentlyLocked()).toBe(false);

    lockAppNow();
    expect(isAppCurrentlyLocked()).toBe(true);

    expect(verifyAndUnlockPin("0000")).toBe(false);
    expect(isAppCurrentlyLocked()).toBe(true);

    expect(verifyAndUnlockPin("4291")).toBe(true);
    expect(isAppCurrentlyLocked()).toBe(false);
  });

  it("rejects non-numeric or too-short PINs", () => {
    expect(() => configureAppLockPin("12")).toThrow(/4 to 8 digits/i);
    expect(() => configureAppLockPin("abcd")).toThrow(/4 to 8 digits/i);
  });
});
