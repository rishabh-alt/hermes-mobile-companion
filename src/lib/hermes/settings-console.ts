export type SectionAccess = "phone" | "read" | "write" | "blocked";

export type SettingsSection = {
  id: string;
  title: string;
  summary: string;
  access: SectionAccess;
  reason?: string;
};

export type ProbeStatus = "ok" | "auth" | "transport" | "unsupported" | "failed";

type SectionKind = "phone" | "host" | "model";

const CATALOG: Array<{ id: string; title: string; summary: string; kind: SectionKind }> = [
  {
    id: "connection",
    title: "Connection",
    summary: "Phone connection to the host, plus live diagnostics.",
    kind: "phone",
  },
  {
    id: "model",
    title: "Model",
    summary: "Host model, fallbacks, and auxiliary models.",
    kind: "model",
  },
  {
    id: "chat",
    title: "Chat",
    summary: "Personality, timezone, reasoning, and attachments.",
    kind: "host",
  },
  {
    id: "appearance",
    title: "Appearance",
    summary: "Phone theme, text size, and chat display.",
    kind: "phone",
  },
  {
    id: "workspace",
    title: "Workspace",
    summary: "Host working directory, project scan, and shell.",
    kind: "host",
  },
  {
    id: "safety",
    title: "Safety",
    summary: "Approvals, command allowlist, and checkpoints.",
    kind: "host",
  },
  {
    id: "browser",
    title: "Browser & passwords",
    summary: "Browser policy and the host credential vault.",
    kind: "host",
  },
  {
    id: "memory",
    title: "Memory & context",
    summary: "Memory, profile, and compression.",
    kind: "host",
  },
  {
    id: "voice",
    title: "Voice",
    summary: "Dictation and speech providers.",
    kind: "host",
  },
  {
    id: "notifications",
    title: "Notifications",
    summary: "Phone alerts. A killed app cannot be woken by the host yet.",
    kind: "phone",
  },
  {
    id: "providers",
    title: "Providers",
    summary: "Accounts, API keys, custom endpoints, and local models.",
    kind: "host",
  },
  {
    id: "gateway",
    title: "Gateway",
    summary: "Host bind, paired devices, and diagnostics.",
    kind: "host",
  },
  {
    id: "tools",
    title: "Tools & keys",
    summary: "Toolsets, tool keys, and output limits.",
    kind: "host",
  },
  {
    id: "sessions",
    title: "Sessions",
    summary: "Archive, restore, and auto-archive.",
    kind: "host",
  },
  {
    id: "runtime",
    title: "Host runtime",
    summary: "Turn limits, delegation, and keep-awake.",
    kind: "host",
  },
  {
    id: "billing",
    title: "Billing",
    summary: "Plan and usage, only when the host exposes them.",
    kind: "host",
  },
  {
    id: "about",
    title: "About",
    summary: "App version, host version, and update checks.",
    kind: "phone",
  },
];

const BLOCKED = "This gateway does not advertise config changes.";

export function settingsSections(features: {
  admin_config_rw?: boolean;
  model_options?: boolean;
  model_admin?: boolean;
}): SettingsSection[] {
  return CATALOG.map((section) => {
    if (section.kind === "phone") return { ...section, access: "phone" };
    if (section.kind === "model" && features.model_admin) {
      return {
        ...section,
        access: "write",
        reason: "Saves through the separate model admin key, not the chat token.",
      };
    }
    if (section.kind === "model" && features.model_options) {
      return {
        ...section,
        access: "read",
        reason: "The model list can be read. Saving the host default needs the model admin door.",
      };
    }
    return { ...section, access: "blocked", reason: BLOCKED };
  });
}

export function searchSections(sections: SettingsSection[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections.filter((section) =>
    `${section.title} ${section.summary}`.toLowerCase().includes(needle),
  );
}

export function interpretProbe(result: {
  ok: boolean;
  status?: number;
  transport?: boolean;
}): ProbeStatus {
  if (result.transport) return "transport";
  if (result.ok && result.status === 200) return "ok";
  if (result.status === 401 || result.status === 403) return "auth";
  if (result.status === 404) return "unsupported";
  return "failed";
}

export function firstSessionMessagesPath(payload: unknown): string | null {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const list = body["data"] ?? body["sessions"];
  if (!Array.isArray(list) || list.length === 0) return null;
  const first = list[0];
  const id =
    first && typeof first === "object" ? (first as Record<string, unknown>)["id"] : undefined;
  if (typeof id !== "string" || !id.trim()) return null;
  return `/api/sessions/${encodeURIComponent(id)}/messages`;
}

export const DIAGNOSTIC_PROBES = [
  { id: "health", label: "Health", path: "/health" },
  { id: "models", label: "Models", path: "/v1/models" },
  { id: "sessions", label: "Sessions", path: "/api/sessions" },
  { id: "capabilities", label: "Capabilities", path: "/v1/capabilities" },
] as const;
