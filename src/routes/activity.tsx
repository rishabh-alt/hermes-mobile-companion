import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import { Button } from "@/components/ui/button";
import { HermesError } from "@/lib/hermes/client";
import { buildActivity, cardsFromBoard } from "@/lib/hermes/activity";
import { useHermesConfig } from "@/lib/hermes/config";
import { listCronJobs, listSessions, kanbanBoard } from "@/lib/hermes/rest";
import { useGateway } from "@/lib/hermes/useGateway";
import { followHostWatch } from "@/lib/hermes/watch";

export const Route = createFileRoute("/activity")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const { config, configured } = useHermesConfig();
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const sessions = useGateway((config) => listSessions(config, 80), ["activity-sessions"]);
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
        if (frame.event === "session.changed") refresh();
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
    <AppShell title="Activity" subtitle="Read-only. Nothing here changes the host.">
      <div className="safe-bottom space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Work the host already recorded, including chats that did not start on this phone.
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
                {lane.items.map((item) => (
                  <li
                    key={`${lane.id}-${item.id}`}
                    className="rounded-lg bg-secondary/40 px-3 py-2"
                  >
                    {item.sessionId ? (
                      <Link
                        to="/c/$sessionId"
                        params={{ sessionId: item.sessionId }}
                        className="block text-sm"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <p className="text-sm">{item.title}</p>
                    )}
                    {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
