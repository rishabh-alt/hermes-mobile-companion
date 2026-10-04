import { Capacitor, registerPlugin } from "@capacitor/core";

interface SecureStoragePlugin {
  getToken(): Promise<{ value: string }>;
  setToken(options: { value: string }): Promise<void>;
  getAdminKey(): Promise<{ value: string }>;
  setAdminKey(options: { value: string }): Promise<void>;
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
