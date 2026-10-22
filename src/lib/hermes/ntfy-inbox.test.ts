import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNtfySubscriptionUrls,
  clearCronInbox,
  markAllCronInboxRead,
  normalizeNtfyServerUrl,
  readCronInbox,
  recordCronInboxItem,
  sendNtfyNotification,
} from "./ntfy-inbox";

const store = new Map<string, string>();

describe("cron results inbox & ntfy push relay", () => {
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

  it("records, deduplicates, marks read, and clears cron inbox results", () => {
    recordCronInboxItem({
      id: "run-1",
      jobId: "job-morning",
      jobName: "Weekday school brief",
      status: "completed",
      summary: "Delivered morning brief to Telegram.",
    });
    recordCronInboxItem({
      id: "run-2",
      jobId: "job-loop",
      jobName: "Twice-daily initiative loop",
      status: "failed",
      summary: "Gateway timeout during web search.",
    });

    const items = readCronInbox();
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("run-2");
    expect(items.every((item) => !item.read)).toBe(true);

    markAllCronInboxRead();
    expect(readCronInbox().every((item) => item.read)).toBe(true);

    clearCronInbox();
    expect(readCronInbox()).toHaveLength(0);
  });

  it("builds https and ntfy:// subscription URLs and rejects http:// ntfy servers", async () => {
    expect(() => normalizeNtfyServerUrl("http://ntfy.example.com")).toThrow(/https/i);
    const urls = buildNtfySubscriptionUrls("https://ntfy.sh", "hermes-alerts-99");
    expect(urls).toEqual({
      httpsUrl: "https://ntfy.sh/hermes-alerts-99",
      appDeepLink: "ntfy://ntfy.sh/hermes-alerts-99",
      jsonStreamUrl: "https://ntfy.sh/hermes-alerts-99/json",
    });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendNtfyNotification({
        topic: "hermes-alerts-99",
        title: "Hermes approval needed",
        message: "rm -rf /tmp/build",
        priority: "urgent",
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntfy.sh/hermes-alerts-99",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
