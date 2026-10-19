const APP_LOCK_KEY = "hermes.applock.v1";
const PBKDF_ROUNDS = 10_000;
const MAX_FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;

export interface AppLockRecord {
  enabled: boolean;
  pinHash: string;
  pinSalt?: string | undefined;
  biometricCredentialId?: string | undefined;
  failedAttempts?: number | undefined;
  lockoutUntil?: number | undefined;
}

let unlockedInMemory = false;

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function encodeBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  if (typeof btoa === "function") {
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === "function") {
    try {
      const binary = atob(padded);
      const out = new Uint8Array(new ArrayBuffer(binary.length));
      for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    } catch {
      // Fall through to UTF-8 byte encoding if credential ID is non-base64 in a test stub
    }
  }
  const out = new Uint8Array(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) {
    out[i] = input.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Legacy unsalted digest kept for seamless verification of previously stored v1 records.
 */
function legacyHashPin(pin: string): string {
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

/**
 * Multi-round salted ARX key-stretched digest (128-bit output) that runs synchronously
 * across all WebViews while resisting trivial lookup and brute-force attacks.
 */
export function hashPin(pin: string, salt = "default"): string {
  const clean = pin.trim();
  const input = `hermes.pin.v2:${salt}:${clean}:companion`;
  let s0 = 0x6a09e667;
  let s1 = 0xbb67ae85;
  let s2 = 0x3c6ef372;
  let s3 = 0xa54ff53a;

  for (let round = 0; round < PBKDF_ROUNDS; round++) {
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i) + round;
      s0 = Math.imul(s0 ^ ch, 0x85ebca6b);
      s1 = Math.imul(s1 ^ ((s0 >>> 13) + i), 0xc2b2ae35);
      s2 = Math.imul(s2 ^ (s1 >>> 16), 0x27d4eb2f);
      s3 = Math.imul(s3 ^ ((s2 >>> 15) ^ round), 0x165667b1);
    }
    s0 = (s0 << 13) | (s0 >>> 19);
    s2 = (s2 << 17) | (s2 >>> 15);
  }

  return [s0, s1, s2, s3].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
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
      ...(typeof row["pinSalt"] === "string" && row["pinSalt"] ? { pinSalt: row["pinSalt"] } : {}),
      ...(typeof row["biometricCredentialId"] === "string" && row["biometricCredentialId"]
        ? { biometricCredentialId: row["biometricCredentialId"] }
        : {}),
      ...(typeof row["failedAttempts"] === "number" && row["failedAttempts"] > 0
        ? { failedAttempts: row["failedAttempts"] }
        : {}),
      ...(typeof row["lockoutUntil"] === "number" && row["lockoutUntil"] > 0
        ? { lockoutUntil: row["lockoutUntil"] }
        : {}),
    };
  } catch {
    return null;
  }
}

function writeAppLockRecord(record: AppLockRecord): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_LOCK_KEY, JSON.stringify(record));
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

export function getPinLockoutRemainingMs(now = Date.now()): number {
  const record = readAppLockRecord();
  if (!record?.lockoutUntil) return 0;
  return Math.max(0, record.lockoutUntil - now);
}

export function configureAppLockPin(pin: string): void {
  const clean = pin.trim();
  if (!/^\d{4,8}$/.test(clean)) {
    throw new Error("PIN must be 4 to 8 digits.");
  }
  const existing = readAppLockRecord();
  const pinSalt = generateSalt();
  const next: AppLockRecord = {
    enabled: true,
    pinSalt,
    pinHash: hashPin(clean, pinSalt),
    ...(existing?.biometricCredentialId
      ? { biometricCredentialId: existing.biometricCredentialId }
      : {}),
  };
  writeAppLockRecord(next);
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

export function verifyAndUnlockPin(pin: string, now = Date.now()): boolean {
  const record = readAppLockRecord();
  if (!record) {
    unlockedInMemory = true;
    return true;
  }
  if (record.lockoutUntil && now < record.lockoutUntil) {
    return false;
  }

  const clean = pin.trim();
  const matches = record.pinSalt
    ? hashPin(clean, record.pinSalt) === record.pinHash
    : hashPin(clean) === record.pinHash || legacyHashPin(clean) === record.pinHash;

  if (matches) {
    const pinSalt = record.pinSalt ?? generateSalt();
    const cleanedRecord: AppLockRecord = {
      enabled: true,
      pinSalt,
      pinHash: record.pinSalt ? record.pinHash : hashPin(clean, pinSalt),
      ...(record.biometricCredentialId
        ? { biometricCredentialId: record.biometricCredentialId }
        : {}),
    };
    writeAppLockRecord(cleanedRecord);
    unlockedInMemory = true;
    notifyLockChange();
    return true;
  }

  const failedAttempts = (record.failedAttempts ?? 0) + 1;
  let lockoutUntil = record.lockoutUntil;
  if (failedAttempts >= MAX_FREE_ATTEMPTS) {
    const exponent = Math.min(6, failedAttempts - MAX_FREE_ATTEMPTS);
    lockoutUntil = now + BASE_LOCKOUT_MS * Math.pow(2, exponent);
  }
  writeAppLockRecord({
    ...record,
    failedAttempts,
    ...(lockoutUntil ? { lockoutUntil } : {}),
  });
  notifyLockChange();
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

  const enrolledId =
    credential?.rawId && credential.rawId.byteLength > 0
      ? encodeBase64Url(credential.rawId)
      : credential?.id;
  if (!enrolledId) return false;
  const updated: AppLockRecord = {
    ...record,
    biometricCredentialId: enrolledId,
  };
  writeAppLockRecord(updated);
  notifyLockChange();
  return true;
}

export async function unlockWithBiometric(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials?.get) {
    return false;
  }
  const record = readAppLockRecord();
  const enrolledId = record?.biometricCredentialId;
  if (!enrolledId) return false;
  const challenge = new Uint8Array(16);
  crypto.getRandomValues(challenge);
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: "public-key",
            id: decodeBase64Url(enrolledId),
            transports: ["internal"],
          },
        ],
        userVerification: "required",
        timeout: 30_000,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return false;

    const returnedId =
      assertion.rawId && assertion.rawId.byteLength > 0
        ? encodeBase64Url(assertion.rawId)
        : assertion.id;

    if (returnedId !== enrolledId && assertion.id !== enrolledId) {
      return false;
    }

    const { failedAttempts: _fa, lockoutUntil: _lu, ...cleanRecord } = record;
    writeAppLockRecord(cleanRecord);
    unlockedInMemory = true;
    notifyLockChange();
    return true;
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
