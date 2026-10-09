export type ActivityLaneId = "telegram" | "cli" | "cron" | "kanban" | "phone" | "other";

export interface ActivitySession {
  id: string;
  title?: string;
  source?: string;
}

export interface ActivityJob {
  id: string;
  name?: string;
  paused?: boolean;
  status?: string;
}

export interface ActivityCard {
  id?: string;
  title?: string;
  column?: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  detail?: string;
  sessionId?: string;
}

export interface ActivityLane {
  id: ActivityLaneId;
  label: string;
  unavailable: boolean;
  items: ActivityItem[];
}

export interface ActivityFeed {
  readOnly: true;
  lanes: ActivityLane[];
}

const LANES: Array<{ id: ActivityLaneId; label: string }> = [
  { id: "telegram", label: "Telegram" },
  { id: "cli", label: "CLI" },
  { id: "cron", label: "Cron" },
  { id: "kanban", label: "Kanban" },
  { id: "phone", label: "Phone" },
  { id: "other", label: "Other" },
];

export function laneForSource(source: string | undefined): ActivityLaneId {
  const value = (source ?? "").trim().toLowerCase();
  if (value === "telegram") return "telegram";
  if (value === "cli" || value === "oneshot" || value === "tui") return "cli";
  if (value === "cron") return "cron";
  if (value === "kanban") return "kanban";
  if (value === "api_server" || value === "hermes_browser") return "phone";
  return "other";
}

export function cardsFromBoard(board: Record<string, unknown> | null): ActivityCard[] {
  if (!board) return [];
  return columnsOf(board).flatMap((column) => {
    const name = text(column["name"]) || text(column["title"]);
    const raw = column["cards"] ?? column["items"];
    const cards = Array.isArray(raw) ? raw : [];
    return cards.filter(isRecord).map((card) => {
      const next: ActivityCard = {
        title: text(card["title"]) || text(card["text"]) || "Untitled card",
      };
      const id = text(card["id"]);
      if (id) next.id = id;
      if (name) next.column = name;
      return next;
    });
  });
}

function columnsOf(board: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of ["columns", "lanes", "board", "data"]) {
    const value = board[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value) && Array.isArray(value["columns"]))
      return value["columns"].filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildActivity(input: {
  sessions: ActivitySession[];
  jobs: ActivityJob[] | null;
  jobsUnavailable: boolean;
  kanbanCards: ActivityCard[] | null;
  kanbanUnavailable: boolean;
}): ActivityFeed {
  const buckets = new Map<ActivityLaneId, ActivityItem[]>(LANES.map((lane) => [lane.id, []]));

  for (const session of input.sessions) {
    buckets.get(laneForSource(session.source))?.push({
      id: session.id,
      title: session.title?.trim() || "Untitled session",
      sessionId: session.id,
    });
  }

  if (!input.jobsUnavailable) {
    for (const job of input.jobs ?? []) {
      const item: ActivityItem = {
        id: job.id,
        title: job.name?.trim() || "Untitled job",
      };
      const detail = job.paused ? "Paused" : job.status;
      if (detail) item.detail = detail;
      buckets.get("cron")?.push(item);
    }
  }

  if (!input.kanbanUnavailable) {
    for (const card of input.kanbanCards ?? []) {
      const item: ActivityItem = {
        id: card.id?.trim() || card.title?.trim() || "kanban-card",
        title: card.title?.trim() || "Untitled card",
      };
      if (card.column) item.detail = card.column;
      buckets.get("kanban")?.push(item);
    }
  }

  return {
    readOnly: true,
    lanes: LANES.filter(
      (lane) => lane.id !== "other" || (buckets.get("other")?.length ?? 0) > 0,
    ).map((lane) => ({
      id: lane.id,
      label: lane.label,
      unavailable:
        (lane.id === "cron" && input.jobsUnavailable) ||
        (lane.id === "kanban" && input.kanbanUnavailable),
      items: buckets.get(lane.id) ?? [],
    })),
  };
}
