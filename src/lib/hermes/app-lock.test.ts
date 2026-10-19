import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureAppLockPin,
  disableAppLock,
  encodeBase64Url,
  enrollBiometricLock,
  getPinLockoutRemainingMs,
  isAppCurrentlyLocked,
  isAppLockConfigured,
  lockAppNow,
  unlockWithBiometric,
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
        PublicKeyCredential: class {},
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

  it("hashes the PIN with a random salt, locks on demand, and unlocks with the matching PIN", () => {
    configureAppLockPin("4291");
    expect(isAppLockConfigured()).toBe(true);
    const saved = store.get("hermes.applock.v1") ?? "";
    expect(saved).not.toContain("4291");
    expect(saved).toContain("pinSalt");
    expect(isAppCurrentlyLocked()).toBe(false);

    lockAppNow();
    expect(isAppCurrentlyLocked()).toBe(true);

    expect(verifyAndUnlockPin("0000")).toBe(false);
    expect(isAppCurrentlyLocked()).toBe(true);

    expect(verifyAndUnlockPin("4291")).toBe(true);
    expect(isAppCurrentlyLocked()).toBe(false);
  });

  it("enforces exponential lockout after 5 failed PIN attempts", () => {
    configureAppLockPin("4291");
    lockAppNow();
    const t0 = 1_700_000_000_000;

    for (let i = 0; i < 5; i++) {
      expect(verifyAndUnlockPin("0000", t0)).toBe(false);
    }

    expect(getPinLockoutRemainingMs(t0)).toBe(30_000);
    // Even the right PIN is rejected while locked out
    expect(verifyAndUnlockPin("4291", t0 + 5_000)).toBe(false);
    expect(isAppCurrentlyLocked()).toBe(true);

    // Once the lockout window expires, the valid PIN unlocks and resets attempts
    expect(verifyAndUnlockPin("4291", t0 + 30_001)).toBe(true);
    expect(isAppCurrentlyLocked()).toBe(false);
    expect(getPinLockoutRemainingMs(t0 + 30_001)).toBe(0);
  });

  it("verifies enrolled biometric credential ID via allowCredentials and rejects mismatched assertions", async () => {
    configureAppLockPin("4291");
    const enrolledRawId = new Uint8Array([10, 20, 30, 40, 50, 60]).buffer;
    const enrolledId = encodeBase64Url(enrolledRawId);

    const createMock = vi.fn().mockResolvedValue({
      id: enrolledId,
      rawId: enrolledRawId,
    });
    const getMock = vi.fn();

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          create: createMock,
          get: getMock,
        },
      },
    });

    expect(await enrollBiometricLock()).toBe(true);
    lockAppNow();
    expect(isAppCurrentlyLocked()).toBe(true);

    // Mismatched credential assertion must be rejected
    getMock.mockResolvedValueOnce({
      id: "wrong-credential-id",
      rawId: new Uint8Array([99, 98, 97]).buffer,
    });
    expect(await unlockWithBiometric()).toBe(false);
    expect(isAppCurrentlyLocked()).toBe(true);
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: expect.objectContaining({
          allowCredentials: [
            expect.objectContaining({
              type: "public-key",
            }),
          ],
        }),
      }),
    );

    // Matching credential assertion unlocks the app
    getMock.mockResolvedValueOnce({
      id: enrolledId,
      rawId: enrolledRawId,
    });
    expect(await unlockWithBiometric()).toBe(true);
    expect(isAppCurrentlyLocked()).toBe(false);
  });

  it("rejects non-numeric or too-short PINs", () => {
    expect(() => configureAppLockPin("12")).toThrow(/4 to 8 digits/i);
    expect(() => configureAppLockPin("abcd")).toThrow(/4 to 8 digits/i);
  });
});
