import { Link, useNavigate } from "@tanstack/react-router";
import {
  Blocks,
  Bot,
  Brain,
  Calendar,
  Check,
  Columns3,
  FileText,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptic } from "@/lib/hermes/haptics";
import {
  deleteSession,
  groupSessions,
  importGatewaySession,
  updateSession,
  useSessions,
} from "@/lib/hermes/sessions";
import type { Session } from "@/lib/hermes/types";
import { useGateway } from "@/lib/hermes/useGateway";
import { pullSession } from "@/lib/hermes/session-sync";
import {
  deleteSession as deleteGatewaySession,
  listProfiles,
  listSessions,
  renameSession as renameGatewaySession,
} from "@/lib/hermes/rest";
import { createGatewaySession } from "@/lib/hermes/session-api";
import { useHermesConfig } from "@/lib/hermes/config";
import { cn } from "@/lib/utils";

interface Props {
  activeId?: string | undefined;
  onNavigate?: (() => void) | undefined;
}

const MENU = [
  { to: "/capabilities", label: "Capabilities", icon: Blocks },
  { to: "/messaging", label: "Messaging", icon: MessageSquare },
  { to: "/artifacts", label: "Artifacts", icon: FileText },
  { to: "/jobs", label: "Scheduled jobs", icon: Calendar },
  { to: "/kanban", label: "Kanban", icon: Columns3 },
] as const;

export function SessionDrawer({ activeId, onNavigate }: Props) {
  const { config, configured } = useHermesConfig();
  const { sessions } = useSessions();
  const remote = useGateway((c) => listSessions(c, 40), []);
  const profiles = useGateway(listProfiles, ["drawer-profiles"]);
  const [tab, setTab] = useState<"sessions" | "bots">("sessions");
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const { pinned, groups } = groupSessions(filtered);

  const localIds = new Set(sessions.map((s) => s.id));
  const q = query.trim().toLowerCase();
  const remoteVisible = (remote.data ?? [])
    .filter((s) => !localIds.has(s.id))
    .filter((s) => !q || (s.title ?? "").toLowerCase().includes(q))
    .slice(0, 30);

  const startNew = async () => {
    if (!configured) {
      void navigate({ to: "/settings" });
      return;
    }
    haptic("tap");
    const session = await createGatewaySession(config);
    const serverSession = await pullSession(config, session.id);
    importGatewaySession(session.id, session.title ?? "New chat", serverSession, session.model);
    onNavigate?.();
    void navigate({ to: "/c/$sessionId", params: { sessionId: session.id } });
  };

  const row = (session: Session) => {
    const isRenaming = renaming === session.id;
    return (
      <div
        key={session.id}
        className={cn(
          "group flex items-center gap-1 rounded-lg px-2 transition-colors",
          session.id === activeId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
        )}
      >
        {isRenaming ? (
          <form
            className="flex flex-1 items-center gap-1 py-1"
            onSubmit={async (e) => {
              e.preventDefault();
              const nextTitle = draft.trim() || session.title;
              if (nextTitle !== session.title) {
                try {
                  setMutationError(null);
                  await renameGatewaySession(config, session.id, nextTitle);
                  const refreshed = await listSessions(config, 60);
                  const authoritative = refreshed.find((item) => item.id === session.id);
                  if (!authoritative) throw new Error("Hermes did not return the renamed session.");
                  updateSession(session.id, { title: authoritative.title ?? nextTitle });
                  remote.refresh();
                } catch (err) {
                  setMutationError((err as Error)?.message ?? "Couldn't rename this session.");
                  return;
                }
              }
              setRenaming(null);
            }}
          >
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 bg-background/60 text-sm"
            />
            <Button type="submit" size="icon-sm" variant="ghost">
              <Check />
            </Button>
          </form>
        ) : (
          <>
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                session.id === activeId ? "bg-primary" : "bg-muted-foreground/40",
              )}
            />
            <Link
              to="/c/$sessionId"
              params={{ sessionId: session.id }}
              onClick={() => {
                haptic("tap");
                onNavigate?.();
              }}
              className="min-w-0 flex-1 py-2 pl-2 text-left"
            >
              <p className="truncate text-[15px] leading-tight text-sidebar-foreground">
                {session.title}
              </p>
              <p className="truncate pt-0.5 text-xs text-muted-foreground">
                {session.model ? `${session.model.split("/").pop()} · ` : ""}
                {session.messages.length} messages
              </p>
            </Link>
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-60">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={session.pinned ? "Unpin chat" : "Pin chat"}
                onClick={() => {
                  haptic("tap");
                  updateSession(session.id, { pinned: !session.pinned });
                }}
              >
                {session.pinned ? <PinOff /> : <Pin />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Rename chat"
                onClick={() => {
                  setDraft(session.title);
                  setRenaming(session.id);
                }}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete chat"
                onClick={async () => {
                  haptic("error");
                  try {
                    setMutationError(null);
                    await deleteGatewaySession(config, session.id);
                    const refreshed = await listSessions(config, 60);
                    if (refreshed.some((item) => item.id === session.id)) {
                      throw new Error("Hermes did not confirm deletion of this session.");
                    }
                    deleteSession(session.id);
                    remote.refresh();
                    if (session.id === activeId) navigate({ to: "/" });
                  } catch (err) {
                    setMutationError((err as Error)?.message ?? "Couldn't delete this session.");
                  }
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="safe-top flex items-center gap-2 px-4 pb-2 pt-2">
        <p className="flex-1 text-2xl font-semibold tracking-tight">Hermes</p>
      </div>

      <div className="flex items-center gap-5 border-b border-sidebar-border px-4">
        {(["sessions", "bots"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-xs font-medium uppercase tracking-wider transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {mutationError && (
          <p
            role="alert"
            className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {mutationError}
          </p>
        )}
        {tab === "bots" ? (
          <div className="px-1 py-2 text-sm">
            <Link
              to="/bots"
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <Bot className="h-4 w-4 text-muted-foreground" /> All profiles
            </Link>
            {profiles.data?.map((profile) => (
              <div key={profile.name} className="px-3 py-2">
                <p className="truncate text-[15px] leading-tight">{profile.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[profile.model, profile.skills ? `${profile.skills} skills` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ))}
            {!profiles.data?.length && (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                {profiles.configured ? "No profiles reported yet." : "Connect Hermes in Settings."}
              </p>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={startNew}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            >
              <Plus className="h-4 w-4 text-muted-foreground" /> New session
            </button>
            {MENU.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
                activeProps={{ className: "bg-sidebar-accent" }}
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}

            <div className="relative px-1 py-3">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions…"
                className="h-9 rounded-lg border-0 bg-transparent pl-9 text-sm focus-visible:bg-background/40"
              />
            </div>

            <section>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </p>
              {pinned.length ? (
                pinned.map(row)
              ) : (
                <p className="px-3 pb-2 text-xs text-muted-foreground/70">
                  Long-press a chat to pin it
                </p>
              )}
            </section>

            {groups.map((group) => (
              <section key={group.label} className="pt-3">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map(row)}
              </section>
            ))}

            {!!remoteVisible.length && (
              <section className="pt-3">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  On your Mac
                </p>
                {remoteVisible.map((item) => (
                  <Link
                    key={item.id}
                    to="/c/$sessionId"
                    params={{ sessionId: item.id }}
                    onClick={() => {
                      haptic("tap");
                      onNavigate?.();
                    }}
                    className="block rounded-lg px-3 py-2 hover:bg-sidebar-accent/60"
                  >
                    <p className="truncate text-[15px] leading-tight text-sidebar-foreground">
                      {item.title ?? item.id}
                    </p>
                    <p className="truncate pt-0.5 text-xs text-muted-foreground">
                      {[
                        item.model?.split("/").pop(),
                        item.message_count && `${item.message_count} messages`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </Link>
                ))}
              </section>
            )}

            {!pinned.length && !groups.length && !remoteVisible.length && (
              <p className="px-3 py-6 text-sm text-muted-foreground">No sessions yet.</p>
            )}
          </>
        )}
      </div>

      <div className="safe-bottom flex items-center gap-1 border-t border-sidebar-border px-3 pt-2">
        <Link
          to="/memory"
          onClick={onNavigate}
          className="flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Brain className="h-4 w-4 text-muted-foreground" /> Memory
        </Link>
        <Link
          to="/settings"
          onClick={onNavigate}
          aria-label="Settings"
          className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
