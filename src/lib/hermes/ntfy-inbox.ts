import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isSecureBaseUrl } from "./client";
import { saveDashboardValue } from "./dashboard";
import type { HermesConfig } from "./types";
import type { WatchFrame } from "./watch";

const CRON_INBOX_KEY = "hermes.cron_inbox.v1";
const MAX_INBOX_ITEMS = 100;
const recentWatchEventKeys = new Map<string, number>();

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

/**
 * Saves the ntfy topic URL into the host's webhook config (`/api/config`) so the Hermes host
 * can publish notifications directly even when the companion app is closed.
 */
export async function syncNtfyWebhookToHost(input: {
  dashboardBaseUrl: string;
  serverUrl?: string | undefined;
  topic: string;
  enabled: boolean;
}): Promise<string> {
  const urls = buildNtfySubscriptionUrls(input.serverUrl ?? "https://ntfy.sh", input.topic);
  if (!urls) {
    throw new Error("Enter a valid https:// ntfy server and topic name first.");
  }
  await saveDashboardValue(input.dashboardBaseUrl, "webhook.url", urls.httpsUrl);
  await saveDashboardValue(input.dashboardBaseUrl, "webhook.enabled", input.enabled);
  return urls.httpsUrl;
}

function notifyBrowser(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore notification constructor restrictions in mobile webviews
    }
  }
}

export function processWatchNotificationFrame(frame: WatchFrame, config: HermesConfig): void {
  const sig = `${frame.event}:${String(frame.payload["session_id"] ?? frame.payload["job_id"] ?? "")}:${String(frame.payload["command"] ?? frame.payload["title"] ?? frame.payload["name"] ?? "")}`;
  const now = Date.now();
  const prev = recentWatchEventKeys.get(sig);
  if (prev !== undefined && now - prev < 8000) {
    return;
  }
  recentWatchEventKeys.set(sig, now);

  const prefs = config.notificationPrefs ?? {
    turnComplete: true,
    approvals: true,
    cronFailures: true,
  };
  const relayNtfy = (title: string, message: string, priority?: "default" | "high" | "urgent") => {
    if (config.ntfyEnabled && config.ntfyTopic) {
      void sendNtfyNotification({
        serverUrl: config.ntfyServerUrl ?? "https://ntfy.sh",
        topic: config.ntfyTopic,
        title,
        message,
        ...(priority ? { priority } : {}),
      }).catch(() => undefined);
    }
  };

  if (frame.event === "approval.requested" || frame.event === "approval.request") {
    const cmd = String(frame.payload["command"] ?? "A tool command awaits approval");
    const sessionId =
      typeof frame.payload["session_id"] === "string" ? frame.payload["session_id"] : undefined;
    recordCronInboxItem({
      jobName: "Tool approval requested",
      status: "approval",
      summary: cmd.slice(0, 160),
      ...(sessionId ? { sessionId } : {}),
    });
    if (prefs.approvals) {
      toast.warning(`Approval needed: ${cmd.slice(0, 80)}`);
      notifyBrowser("Hermes approval needed", cmd);
      relayNtfy("Hermes approval needed", cmd, "high");
    }
  } else if (frame.event === "cron.failed" || frame.event === "job.failed") {
    const name = String(frame.payload["name"] ?? frame.payload["job_id"] ?? "Scheduled job");
    const summary = String(
      frame.payload["summary"] ?? frame.payload["error"] ?? "Cron execution failed",
    );
    const sessionId =
      typeof frame.payload["session_id"] === "string" ? frame.payload["session_id"] : undefined;
    recordCronInboxItem({
      jobName: name,
      status: "failed",
      summary,
      ...(sessionId ? { sessionId } : {}),
    });
    if (prefs.cronFailures ?? true) {
      toast.error(`Scheduled job failed: ${name}`);
      notifyBrowser("Hermes job failed", name);
      relayNtfy(`Hermes job failed: ${name}`, summary, "high");
    }
  } else if (frame.event === "session.completed" || frame.event === "assistant.completed") {
    const title = String(frame.payload["title"] ?? "Hermes finished a background turn");
    const summary = String(frame.payload["summary"] ?? title);
    const sessionId =
      typeof frame.payload["session_id"] === "string" ? frame.payload["session_id"] : undefined;
    recordCronInboxItem({
      jobName: title,
      status: "completed",
      summary,
      ...(sessionId ? { sessionId } : {}),
    });
    if (prefs.turnComplete) {
      toast.info(title);
      notifyBrowser("Hermes turn complete", title);
      relayNtfy("Hermes turn complete", title, "default");
    }
  }
}
