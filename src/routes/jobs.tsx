import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCheck,
  History,
  Inbox,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordCronInboxItem, useCronInbox } from "@/lib/hermes/ntfy-inbox";
import {
  createCronJob,
  cronAction,
  cronDeliveryTargets,
  cronRuns,
  deleteCronJob,
  listCronJobs,
  updateCronJob,
  type CronJob,
  type CronRun,
} from "@/lib/hermes/rest";
import { useGateway } from "@/lib/hermes/useGateway";

const title = "Scheduled jobs · Hermes companion";
const description = "Cron jobs your Hermes agent runs on a schedule.";

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "Every 15m", cron: "*/15 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 9 AM", cron: "0 9 * * *" },
  { label: "Weekdays 8 AM", cron: "0 8 * * 1-5" },
  { label: "Weekly Mon", cron: "0 9 * * 1" },
];

export const Route = createFileRoute("/jobs")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: JobsRoute,
});

function when(value: string | number | undefined) {
  if (!value) return undefined;
  const date = new Date(typeof value === "number" ? value : Date.parse(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function JobsRoute() {
  const jobs = useGateway(listCronJobs, []);
  const targets = useGateway(cronDeliveryTargets, ["cron-delivery-targets"]);
  const cronInbox = useCronInbox();
  const [editingJob, setEditingJob] = useState<Partial<CronJob> | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedRunsId, setExpandedRunsId] = useState<string | null>(null);
  const [runsByJob, setRunsByJob] = useState<Record<string, CronRun[]>>({});
  const [loadingRunsId, setLoadingRunsId] = useState<string | null>(null);

  const availableTargets = [
    ...(targets.data ?? []),
    ...["telegram", "discord", "slack"]
      .filter((fallback) => !(targets.data ?? []).some((t) => t.id === fallback))
      .map((id) => ({ id, label: id })),
  ];

  const run = (id: string, action: "pause" | "resume" | "trigger") => {
    void cronAction(jobs.config, id, action)
      .then(() => toast.success(action === "trigger" ? "Triggered" : `Job ${action}d`))
      .catch((err: Error) => toast.error(err.message))
      .finally(jobs.refresh);
  };

  const toggleRuns = (jobId: string) => {
    if (expandedRunsId === jobId) {
      setExpandedRunsId(null);
      return;
    }
    setExpandedRunsId(jobId);
    setLoadingRunsId(jobId);
    const jobName = jobs.data?.find((j) => j.id === jobId)?.name ?? jobId;
    void cronRuns(jobs.config, jobId, 10)
      .then((rows) => {
        setRunsByJob((prev) => ({ ...prev, [jobId]: rows }));
        for (const r of rows.slice(0, 5)) {
          recordCronInboxItem({
            id: r.id ? `run-${r.id}` : `run-${jobId}-${r.started_at ?? "latest"}`,
            jobId,
            jobName,
            status: r.status === "failed" || r.status === "error" ? "failed" : "completed",
            summary: (r.summary ?? r.output ?? `Run ${r.status ?? "completed"}`).slice(0, 200),
            ...(r.session_id ? { sessionId: r.session_id } : {}),
          });
        }
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoadingRunsId(null));
  };

  const submitJobForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingJob) return;
    const name = (editingJob.name ?? "").trim();
    const schedule = (editingJob.schedule ?? "").trim();
    const prompt = (editingJob.prompt ?? "").trim();
    const deliver_to = (editingJob.deliver_to ?? "").trim();
    if (!name || !schedule || !prompt) {
      toast.error("Name, schedule, and prompt are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        schedule,
        prompt,
        ...(deliver_to ? { deliver_to } : {}),
      };
      if (editingJob.id) {
        await updateCronJob(jobs.config, editingJob.id, payload);
        toast.success("Job updated");
      } else {
        await createCronJob(jobs.config, payload);
        toast.success("Job created");
      }
      setEditingJob(null);
      jobs.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save job.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GatewayPage
      title="Scheduled jobs"
      subtitle={
        jobs.data ? `${jobs.data.length} job${jobs.data.length === 1 ? "" : "s"}` : undefined
      }
      loading={jobs.loading}
      unavailable={jobs.unavailable}
      error={jobs.error}
      configured={jobs.configured}
      empty={jobs.data?.length === 0 && !editingJob && cronInbox.items.length === 0}
      emptyText="No scheduled jobs."
      onRefresh={jobs.refresh}
    >
      <div className="mb-4 space-y-2.5 rounded-xl border border-border/70 bg-secondary/15 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cron Results Inbox
            </p>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              · {cronInbox.items.length} recorded
              {cronInbox.unreadCount > 0 ? ` (${cronInbox.unreadCount} unread)` : ""}
            </span>
          </div>
          {cronInbox.items.length > 0 && (
            <div className="flex items-center gap-1.5">
              {cronInbox.unreadCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={cronInbox.markAllRead}
                >
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  Mark read
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={cronInbox.clear}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        {cronInbox.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Completed cron runs, background task summaries, and approval alerts recorded while the
            app is open or inspected appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {cronInbox.items.slice(0, 8).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">{item.jobName}</span>
                    <span className="text-muted-foreground">·</span>
                    <span
                      className={
                        item.status === "failed"
                          ? "font-medium text-destructive"
                          : item.status === "approval"
                            ? "font-medium text-amber-400"
                            : "text-emerald-400"
                      }
                    >
                      {item.status}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {when(item.timestamp)}
                    </span>
                  </div>
                  <p className="truncate text-muted-foreground">{item.summary}</p>
                </div>
                {item.sessionId && (
                  <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[11px]">
                    <Link to="/c/$sessionId" params={{ sessionId: item.sessionId }}>
                      <MessageSquare className="mr-1 h-3 w-3" />
                      Open chat
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-3 flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setEditingJob({
              name: "",
              schedule: "0 9 * * *",
              prompt: "",
              deliver_to: "",
            })
          }
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New job
        </Button>
      </div>

      {editingJob && (
        <form
          onSubmit={submitJobForm}
          className="mb-4 space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3"
        >
          <p className="text-sm font-medium">
            {editingJob.id ? `Edit ${editingJob.name || editingJob.id}` : "New scheduled job"}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="job-name">Job name</Label>
            <Input
              id="job-name"
              placeholder="Morning briefing"
              value={editingJob.name ?? ""}
              onChange={(e) => setEditingJob((cur) => ({ ...cur, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-schedule">Cron schedule</Label>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {CRON_PRESETS.map((preset) => (
                <Button
                  key={preset.cron}
                  type="button"
                  size="sm"
                  variant={editingJob.schedule === preset.cron ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() =>
                    setEditingJob((cur) => ({
                      ...cur,
                      schedule: preset.cron,
                    }))
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <Input
              id="job-schedule"
              className="font-mono text-xs"
              placeholder="0 9 * * *"
              value={editingJob.schedule ?? ""}
              onChange={(e) => setEditingJob((cur) => ({ ...cur, schedule: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-deliver">Delivery target (optional)</Label>
            {availableTargets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {availableTargets.map((target) => (
                  <Button
                    key={target.id}
                    type="button"
                    size="sm"
                    variant={editingJob.deliver_to === target.id ? "default" : "outline"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() =>
                      setEditingJob((cur) => ({
                        ...cur,
                        deliver_to: cur?.deliver_to === target.id ? "" : target.id,
                      }))
                    }
                  >
                    {target.label}
                  </Button>
                ))}
              </div>
            )}
            <Input
              id="job-deliver"
              placeholder="telegram, slack, or session id"
              value={editingJob.deliver_to ?? ""}
              onChange={(e) => setEditingJob((cur) => ({ ...cur, deliver_to: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-prompt">Agent prompt</Label>
            <Input
              id="job-prompt"
              placeholder="Summarize overnight alerts and open PRs"
              value={editingJob.prompt ?? ""}
              onChange={(e) => setEditingJob((cur) => ({ ...cur, prompt: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save job"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingJob(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {jobs.data?.map((job) => {
        const paused = job.paused || job.status === "paused";
        const runs = runsByJob[job.id] ?? [];
        const isExpanded = expandedRunsId === job.id;
        return (
          <Row
            key={job.id}
            title={job.name ?? job.id}
            meta={[
              job.schedule,
              job.status,
              job.deliver_to && `→ ${job.deliver_to}`,
              when(job.next_run) && `next ${when(job.next_run)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            right={
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Run history"
                  onClick={() => toggleRuns(job.id)}
                >
                  <History className="h-4 w-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit job"
                  onClick={() => setEditingJob(job)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={paused ? "Resume" : "Pause"}
                  onClick={() => run(job.id, paused ? "resume" : "pause")}
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Trigger now"
                  onClick={() => run(job.id, "trigger")}
                >
                  <Zap className="h-4 w-4" />
                </Button>
                {confirmDeleteId === job.id ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      void deleteCronJob(jobs.config, job.id)
                        .then(() => {
                          toast.success("Job deleted");
                          setConfirmDeleteId(null);
                        })
                        .catch((err: Error) => toast.error(err.message))
                        .finally(jobs.refresh);
                    }}
                  >
                    Confirm
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete job"
                    onClick={() => setConfirmDeleteId(job.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            }
          >
            {job.prompt && (
              <p className="pb-2 pr-2 text-xs leading-relaxed text-muted-foreground">
                {job.prompt}
              </p>
            )}
            {isExpanded && (
              <div className="mb-3 space-y-1.5 rounded-lg border border-border/60 bg-secondary/20 p-2.5 text-xs">
                <p className="font-medium text-foreground">Recent runs</p>
                {loadingRunsId === job.id ? (
                  <p className="text-muted-foreground">Loading run history…</p>
                ) : runs.length === 0 ? (
                  <p className="text-muted-foreground">No recorded runs yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {runs.map((entry, idx) => {
                      const runSessionId = entry.session_id;
                      return (
                        <li
                          key={entry.id ?? idx}
                          className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
                        >
                          <div>
                            <span className="font-mono text-foreground">
                              {entry.status ?? "done"}
                            </span>
                            {entry.started_at ? ` · ${when(entry.started_at)}` : ""}
                            {entry.summary || entry.output
                              ? ` — ${(entry.summary ?? entry.output ?? "").slice(0, 140)}`
                              : ""}
                          </div>
                          {runSessionId && (
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px]"
                            >
                              <Link to="/c/$sessionId" params={{ sessionId: runSessionId }}>
                                <MessageSquare className="mr-1 h-3 w-3" />
                                Open chat
                              </Link>
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </Row>
        );
      })}
    </GatewayPage>
  );
}
