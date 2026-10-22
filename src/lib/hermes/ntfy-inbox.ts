import { useEffect, useState } from "react";
import { isSecureBaseUrl } from "./client";

const CRON_INBOX_KEY = "hermes.cron_inbox.v1";
const MAX_INBOX_ITEMS = 100;

export interface CronInboxItem {
  id: string;
  jobId?: string | undefined;
  jobName: string;
  status: "completed" | "failed" | "approval";
  summary: string;
  timestamp: number;
  read: boolean;
  sessionId?: string | undefined;
}

export function readCronInbox(): CronInboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CRON_INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): CronInboxItem[] => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const id = String(row["id"] ?? "").trim();
      const jobName = String(row["jobName"] ?? "").trim();
      if (!id || !jobName) return [];
      const rawStatus = row["status"];
      const status: CronInboxItem["status"] =
        rawStatus === "failed" || rawStatus === "approval" ? rawStatus : "completed";
      const timestamp =
        typeof row["timestamp"] === "number" && !Number.isNaN(row["timestamp"])
          ? row["timestamp"]
          : Date.now();
      return [
        {
          id,
          jobName,
          status,
          summary: String(row["summary"] ?? ""),
          timestamp,
          read: row["read"] === true,
          ...(typeof row["jobId"] === "string" && row["jobId"] ? { jobId: row["jobId"] } : {}),
          ...(typeof row["sessionId"] === "string" && row["sessionId"]
            ? { sessionId: row["sessionId"] }
            : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

function writeCronInbox(items: CronInboxItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CRON_INBOX_KEY, JSON.stringify(items.slice(0, MAX_INBOX_ITEMS)));
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("hermes-cron-inbox-change"));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function recordCronInboxItem(
  input: Omit<CronInboxItem, "id" | "timestamp" | "read"> & {
    id?: string | undefined;
    timestamp?: number | undefined;
  },
): CronInboxItem {
  const existing = readCronInbox();
  const id = input.id?.trim() || `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = input.timestamp ?? Date.now();
  const item: CronInboxItem = {
    id,
    jobName: input.jobName.trim() || "Scheduled job",
    status: input.status,
    summary: input.summary.trim(),
    timestamp,
    read: false,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  const deduplicated = existing.filter((row) => row.id !== id);
  writeCronInbox([item, ...deduplicated]);
  return item;
}

export function markAllCronInboxRead(): void {
  const current = readCronInbox();
  writeCronInbox(current.map((item) => ({ ...item, read: true })));
}

export function clearCronInbox(): void {
  writeCronInbox([]);
}

export function useCronInbox() {
  const [items, setItems] = useState<CronInboxItem[]>(() => readCronInbox());

  useEffect(() => {
    const sync = () => setItems(readCronInbox());
    window.addEventListener("hermes-cron-inbox-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hermes-cron-inbox-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const unreadCount = items.filter((item) => !item.read).length;
  return {
    items,
    unreadCount,
    markAllRead: markAllCronInboxRead,
    clear: clearCronInbox,
  };
}

export function normalizeNtfyServerUrl(raw?: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://ntfy.sh";
  if (!isSecureBaseUrl(trimmed)) {
    throw new Error("ntfy server URL must use https://.");
  }
  return trimmed;
}

export function sanitizeNtfyTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^A-Za-z0-9_-]/g, "");
}

export function buildNtfySubscriptionUrls(
  serverUrl: string,
  topic: string,
): { httpsUrl: string; appDeepLink: string; jsonStreamUrl: string } | null {
  const cleanTopic = sanitizeNtfyTopic(topic);
  if (!cleanTopic) return null;
  let base = "https://ntfy.sh";
  try {
    base = normalizeNtfyServerUrl(serverUrl);
  } catch {
    return null;
  }
  const hostAndPath = base.replace(/^https:\/\//i, "");
  return {
    httpsUrl: `${base}/${cleanTopic}`,
    appDeepLink: `ntfy://${hostAndPath}/${cleanTopic}`,
    jsonStreamUrl: `${base}/${cleanTopic}/json`,
  };
}

export async function sendNtfyNotification(input: {
  serverUrl?: string | undefined;
  topic: string;
  title: string;
  message: string;
  priority?: "default" | "high" | "urgent" | undefined;
  tags?: string[] | undefined;
}): Promise<boolean> {
  const urls = buildNtfySubscriptionUrls(input.serverUrl ?? "https://ntfy.sh", input.topic);
  if (!urls) {
    throw new Error("Enter a valid https:// ntfy server and topic name.");
  }
  const headers: Record<string, string> = {
    Title: input.title,
    Priority: input.priority ?? "default",
  };
  if (input.tags?.length) {
    headers["Tags"] = input.tags.join(",");
  }
  const response = await fetch(urls.httpsUrl, {
    method: "POST",
    headers,
    body: input.message,
  });
  if (!response.ok) {
    throw new Error(`ntfy server returned ${response.status}`);
  }
  return true;
}
