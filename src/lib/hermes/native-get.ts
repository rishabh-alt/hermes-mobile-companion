import { CapacitorHttp } from "@capacitor/core";

/** Short Check-host probes only. Chat and the live watch must not call this. */
export async function nativeGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<{ status: number; data: string }> {
  const response = await CapacitorHttp.get({
    url,
    headers,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    responseType: "text",
  });
  const data = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
  return { status: response.status, data };
}
