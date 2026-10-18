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

export async function getHostToken(hostId: string) {
  const key = `host_token_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (!Capacitor.isNativePlatform()) return memoryHostTokens.get(key) ?? "";
  return readNamedSecret(key);
}

export async function setHostToken(hostId: string, value: string) {
  const key = `host_token_${hostId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  memoryHostTokens.set(key, value);
  await writeNamedSecret(key, value);
}

async function readNamedSecret(name: string) {
  if (!Capacitor.isNativePlatform()) return "";
  const result = await nativeStorage.getSecret({ name });
  return result.value;
}

async function writeNamedSecret(name: string, value: string) {
  if (!Capacitor.isNativePlatform()) return;
  await nativeStorage.setSecret({ name, value });
}
