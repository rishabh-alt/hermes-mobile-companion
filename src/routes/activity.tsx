import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, MessageSquare, ShieldAlert, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/hermes/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildActivity, cardsFromBoard } from "@/lib/hermes/activity";
import {
  respondToApproval,
  type ApprovalChoice,
  type ApprovalRequest,
} from "@/lib/hermes/approval";
import { answerClarify, type ClarifyRequest } from "@/lib/hermes/clarify";
import { HermesError } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import {
  cronAction,
  fetchActiveSessionPrompts,
  kanbanBoard,
  listCronJobs,
  listSessions,
} from "@/lib/hermes/rest";
import { useGateway } from "@/lib/hermes/useGateway";
import { followHostWatch } from "@/lib/hermes/watch";

export const Route = createFileRoute("/activity")({
  component: ActivityRoute,
});

interface PendingPromptMap {
  [sessionId: string]: {
    approval: ApprovalRequest | null;
    clarify: ClarifyRequest | null;
  };
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

function ActivityRoute() {
  const { config, configured } = useHermesConfig();
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [promptsBySession, setPromptsBySession] = useState<PendingPromptMap>({});
  const [clarifyDrafts, setClarifyDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessions = useGateway((c) => listSessions(c, 80), ["activity-sessions"]);
  const jobs = useGateway(listCronJobs, ["activity-jobs"]);
  const board = useGateway(kanbanBoard, ["activity-board"]);

  const refresh = () => {
    sessions.refresh();
    jobs.refresh();
    board.refresh();
  };

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    void followHostWatch(
      config,
      "/api/activity/watch",
      (frame) => {
        const prefs = config.notificationPrefs ?? {
          turnComplete: true,
          approvals: true,
          cronFailures: true,
        };
        if (frame.event === "session.changed") {
          refresh();
        } else if (frame.event === "approval.requested" || frame.event === "approval.request") {
          refresh();
          if (prefs.approvals) {
            const cmd = String(frame.payload["command"] ?? "A tool command awaits approval");
            toast.warning(`Approval needed: ${cmd.slice(0, 80)}`);
            notifyBrowser("Hermes approval needed", cmd);
          }
        } else if (frame.event === "cron.failed" || frame.event === "job.failed") {
          refresh();
          if (prefs.cronFailures ?? true) {
            const name = String(
              frame.payload["name"] ?? frame.payload["job_id"] ?? "Scheduled job",
            );
            toast.error(`Scheduled job failed: ${name}`);
            notifyBrowser("Hermes job failed", name);
          }
        } else if (frame.event === "session.completed" || frame.event === "assistant.completed") {
          refresh();
          if (prefs.turnComplete) {
            const title = String(frame.payload["title"] ?? "Hermes finished a background turn");
            toast.info(title);
            notifyBrowser("Hermes turn complete", title);
          }
        }
      },
      controller.signal,
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof HermesError && err.status === 404) {
        setWatchNote("Live updates start after the next gateway restart.");
      }
    });
    return () => controller.abort();
  }, [config, configured]);

  useEffect(() => {
    if (!configured || !sessions.data || sessions.data.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const recentIds = sessions.data.slice(0, 12).map((s) => s.id);
    void Promise.all(
      recentIds.map(async (id) => {
        const res = await fetchActiveSessionPrompts(config, id, controller.signal);
        return [id, res] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: PendingPromptMap = {};
      for (const [id, prompt] of entries) {
        if (prompt.approval || prompt.clarify) {
          next[id] = prompt;
        }
      }
      setPromptsBySession(next);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [config, configured, sessions.data]);

  const handleApproval = async (
    sessionId: string,
    request: ApprovalRequest,
    choice: ApprovalChoice,
  ) => {
    setBusyId(sessionId);
    try {
      await respondToApproval(config, {
        runId: request.runId,
        choice,
        ...(request.requestId ? { requestId: request.requestId } : {}),
      });
      toast.success(choice === "deny" ? "Command denied" : `Approved (${choice})`);
      setPromptsBySession((prev) => {
        const copy = { ...prev };
        delete copy[sessionId];
        return copy;
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send approval.");
    } finally {
      setBusyId(null);
    }
  };

  const handleClarify = async (sessionId: string, request: ClarifyRequest, answer: string) => {
    const clean = answer.trim();
    if (!clean) return;
    setBusyId(sessionId);
    try {
      await answerClarify(config, request.id, clean);
      toast.success("Sent answer to host");
      setPromptsBySession((prev) => {
        const copy = { ...prev };
        delete copy[sessionId];
        return copy;
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send answer.");
    } finally {
      setBusyId(null);
    }
  };

  const feed = useMemo(
    () =>
      buildActivity({
        sessions: sessions.data ?? [],
        jobs: jobs.unavailable ? null : jobs.data,
        jobsUnavailable: jobs.unavailable,
        kanbanCards: board.unavailable ? null : cardsFromBoard(board.data),
        kanbanUnavailable: board.unavailable,
      }),
    [board.data, board.unavailable, jobs.data, jobs.unavailable, sessions.data],
  );
  const loading = sessions.loading || jobs.loading || board.loading;

  return (
    <AppShell
      title="Activity"
      subtitle="Live headless feed · Approve tools, trigger jobs, or open chats"
    >
      <div className="safe-bottom h-full min-h-0 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Work across Telegram, CLI, Cron, Kanban, and this phone—with inline approvals when a run
            pauses.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={refresh}>
            Refresh
          </Button>
        </div>
        {watchNote && <p className="text-xs text-muted-foreground">{watchNote}</p>}
        {sessions.error && <p className="text-sm text-destructive">{sessions.error}</p>}
        {feed.lanes.map((lane) => (
          <section key={lane.id} className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              {lane.label}
              <span className="ml-1">{lane.unavailable ? "" : lane.items.length}</span>
            </h2>
            {lane.unavailable ? (
              <p className="text-sm text-muted-foreground">Not available on this gateway.</p>
            ) : lane.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing here.</p>
            ) : (
              <ul className="space-y-2">
                {lane.items.map((item) => {
                  const pending = item.sessionId ? promptsBySession[item.sessionId] : undefined;
                  return (
                    <li
                      key={`${lane.id}-${item.id}`}
                      className="space-y-2 rounded-lg border border-border/50 bg-secondary/40 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {item.sessionId ? (
                            <Link
                              to="/c/$sessionId"
                              params={{ sessionId: item.sessionId }}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            <p className="truncate text-sm font-medium">{item.title}</p>
                          )}
                          {item.detail && (
                            <p className="text-xs text-muted-foreground">{item.detail}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {lane.id === "cron" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={busyId === item.id}
                              onClick={() => {
                                setBusyId(item.id);
                                void cronAction(config, item.id, "trigger")
                                  .then(() => {
                                    toast.success(`Triggered ${item.title}`);
                                    refresh();
                                  })
                                  .catch((err: Error) => toast.error(err.message))
                                  .finally(() => setBusyId(null));
                              }}
                            >
                              <Zap className="mr-1 h-3 w-3" />
                              Run now
                            </Button>
                          )}
                          {item.sessionId && (
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                              <Link to="/c/$sessionId" params={{ sessionId: item.sessionId }}>
                                <MessageSquare className="mr-1 h-3.5 w-3.5" />
                                Open
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>

                      {item.sessionId && pending?.approval && (
                        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
                          <div className="flex items-center gap-1.5 font-medium text-amber-300">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            <span>Waiting for tool approval</span>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background/70 p-2 font-mono text-[11px] text-foreground">
                            {pending.approval.command}
                          </pre>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              disabled={busyId === item.sessionId}
                              onClick={() =>
                                void handleApproval(item.sessionId!, pending.approval!, "once")
                              }
                            >
                              <Check className="mr-1 h-3 w-3" />
                              Allow once
                            </Button>
                            {pending.approval.choices.includes("session") && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2.5 text-xs"
                                disabled={busyId === item.sessionId}
                                onClick={() =>
                                  void handleApproval(item.sessionId!, pending.approval!, "session")
                                }
                              >
                                Allow session
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2.5 text-xs"
                              disabled={busyId === item.sessionId}
                              onClick={() =>
                                void handleApproval(item.sessionId!, pending.approval!, "deny")
                              }
                            >
                              <X className="mr-1 h-3 w-3" />
                              Deny
                            </Button>
                          </div>
                        </div>
                      )}

                      {item.sessionId && pending?.clarify && (
                        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/10 p-2.5 text-xs">
                          <p className="font-medium text-foreground">{pending.clarify.question}</p>
                          {pending.clarify.choices.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {pending.clarify.choices.map((choice) => (
                                <Button
                                  key={choice}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  disabled={busyId === item.sessionId}
                                  onClick={() =>
                                    void handleClarify(item.sessionId!, pending.clarify!, choice)
                                  }
                                >
                                  {choice}
                                </Button>
                              ))}
                            </div>
                          )}
                          <form
                            className="flex gap-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleClarify(
                                item.sessionId!,
                                pending.clarify!,
                                clarifyDrafts[item.sessionId!] ?? "",
                              );
                            }}
                          >
                            <Input
                              value={clarifyDrafts[item.sessionId] ?? ""}
                              onChange={(e) =>
                                setClarifyDrafts((prev) => ({
                                  ...prev,
                                  [item.sessionId!]: e.target.value,
                                }))
                              }
                              placeholder="Type an answer…"
                              className="h-8 text-xs"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              className="h-8 px-3 text-xs"
                              disabled={busyId === item.sessionId}
                            >
                              Reply
                            </Button>
                          </form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
