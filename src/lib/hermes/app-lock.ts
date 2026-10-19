const APP_LOCK_KEY = "hermes.applock.v1";

export interface AppLockRecord {
  enabled: boolean;
  pinHash: string;
  biometricCredentialId?: string | undefined;
}

let unlockedInMemory = false;

/**
 * Deterministic fast FNV-1a + round-mixed digest for PIN comparison.
 * Avoids storing raw digits in localStorage while working synchronously in all WebViews.
 */
export function hashPin(pin: string): string {
  const clean = pin.trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const salted = `hermes.pin.v1:${clean}:companion`;
  for (let i = 0; i < salted.length; i++) {
    const code = salted.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function readAppLockRecord(): AppLockRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APP_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (row["enabled"] !== true || typeof row["pinHash"] !== "string" || !row["pinHash"]) {
      return null;
    }
    return {
      enabled: true,
      pinHash: row["pinHash"],
      ...(typeof row["biometricCredentialId"] === "string" && row["biometricCredentialId"]
        ? { biometricCredentialId: row["biometricCredentialId"] }
        : {}),
    };
  } catch {
    return null;
  }
}

export function isAppLockConfigured(): boolean {
  return readAppLockRecord() !== null;
}

export function isAppCurrentlyLocked(): boolean {
  const record = readAppLockRecord();
  if (!record) return false;
  return !unlockedInMemory;
}

export function configureAppLockPin(pin: string): void {
  const clean = pin.trim();
  if (!/^\d{4,8}$/.test(clean)) {
    throw new Error("PIN must be 4 to 8 digits.");
  }
  const existing = readAppLockRecord();
  const next: AppLockRecord = {
    enabled: true,
    pinHash: hashPin(clean),
    ...(existing?.biometricCredentialId
      ? { biometricCredentialId: existing.biometricCredentialId }
      : {}),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_LOCK_KEY, JSON.stringify(next));
  }
  unlockedInMemory = true;
  notifyLockChange();
}

export function disableAppLock(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(APP_LOCK_KEY);
  }
  unlockedInMemory = false;
  notifyLockChange();
}

export function lockAppNow(): void {
  if (!isAppLockConfigured()) return;
  unlockedInMemory = false;
  notifyLockChange();
}

export function verifyAndUnlockPin(pin: string): boolean {
  const record = readAppLockRecord();
  if (!record) {
    unlockedInMemory = true;
    return true;
  }
  if (hashPin(pin.trim()) === record.pinHash) {
    unlockedInMemory = true;
    notifyLockChange();
    return true;
  }
  return false;
}

export async function enrollBiometricLock(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !window.PublicKeyCredential ||
    !navigator.credentials?.create
  ) {
    throw new Error("Biometric passkey unlock is not supported in this WebView.");
  }
  const record = readAppLockRecord();
  if (!record) {
    throw new Error("Set a fallback PIN first before enabling biometric unlock.");
  }
  const challenge = new Uint8Array(16);
  const userId = new Uint8Array(16);
  crypto.getRandomValues(challenge);
  crypto.getRandomValues(userId);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Hermes Companion" },
      user: {
        id: userId,
        name: "hermes-operator",
        displayName: "Hermes Operator",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 30_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential?.id) return false;
  const updated: AppLockRecord = {
    ...record,
    biometricCredentialId: credential.id,
  };
  window.localStorage.setItem(APP_LOCK_KEY, JSON.stringify(updated));
  notifyLockChange();
  return true;
}

export async function unlockWithBiometric(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials?.get) {
    return false;
  }
  const record = readAppLockRecord();
  if (!record?.biometricCredentialId) return false;
  const challenge = new Uint8Array(16);
  crypto.getRandomValues(challenge);
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        userVerification: "required",
        timeout: 30_000,
      },
    });
    if (assertion) {
      unlockedInMemory = true;
      notifyLockChange();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function notifyLockChange() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("hermes-applock-change"));
    } catch {
      // Ignore in test environments without CustomEvent
    }
  }
}
