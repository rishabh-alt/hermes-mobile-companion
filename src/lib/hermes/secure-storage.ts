import { Capacitor, registerPlugin } from "@capacitor/core";

interface SecureStoragePlugin {
  getToken(): Promise<{ value: string }>;
  setToken(options: { value: string }): Promise<void>;
  getAdminKey(): Promise<{ value: string }>;
  setAdminKey(options: { value: string }): Promise<void>;
  getSecret(options: { name: string }): Promise<{ value: string }>;
  setSecret(options: { name: string; value: string }): Promise<void>;
}

const nativeStorage = registerPlugin<SecureStoragePlugin>("SecureStorage");

export async function getSecureToken() {
  if (!Capacitor.isNativePlatform()) return "";
  const result = await nativeStorage.getToken();
  return result.value;
}

export async function setSecureToken(value: string) {
  if (!Capacitor.isNativePlatform()) return;
  await nativeStorage.setToken({ value });
}

export async function getSecureAdminKey() {
  if (!Capacitor.isNativePlatform()) return "";
  const result = await nativeStorage.getAdminKey();
  return result.value;
}

export async function setSecureAdminKey(value: string) {
  if (!Capacitor.isNativePlatform()) return;
  await nativeStorage.setAdminKey({ value });
}

export async function getDashboardPassword() {
  return readNamedSecret("dashboard_password");
}

export async function setDashboardPassword(value: string) {
  await writeNamedSecret("dashboard_password", value);
}

export async function getDashboardCookie() {
  return readNamedSecret("dashboard_cookie");
}

export async function setDashboardCookie(value: string) {
  await writeNamedSecret("dashboard_cookie", value);
}

const memoryHostTokens = new Map<string, string>();
const memoryNamedSecrets = new Map<string, string>();

export async function getDeviceCredential() {
  return readNamedSecret("device_credential");
}

export async function setDeviceCredential(value: string) {
  await writeNamedSecret("device_credential", value);
}

export async function getHostDeviceCredential(hostId: string) {
  const key = `device_credential_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return readNamedSecret(key);
}

export async function setHostDeviceCredential(hostId: string, value: string) {
  const key = `device_credential_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  await writeNamedSecret(key, value);
}

export async function getHostToken(hostId: string) {
  const key = `host_token_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (!Capacitor.isNativePlatform()) return memoryHostTokens.get(key) ?? "";
  return readNamedSecret(key);
}

export async function setHostToken(hostId: string, value: string) {
  const key = `host_token_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (value) {
    memoryHostTokens.set(key, value);
  } else {
    memoryHostTokens.delete(key);
  }
  await writeNamedSecret(key, value);
}

async function readNamedSecret(name: string) {
  if (!Capacitor.isNativePlatform()) return memoryNamedSecrets.get(name) ?? "";
  const result = await nativeStorage.getSecret({ name });
  return result.value;
}

async function writeNamedSecret(name: string, value: string) {
  if (value) {
    memoryNamedSecrets.set(name, value);
  } else {
    memoryNamedSecrets.delete(name);
  }
  if (!Capacitor.isNativePlatform()) return;
  await nativeStorage.setSecret({ name, value });
}
