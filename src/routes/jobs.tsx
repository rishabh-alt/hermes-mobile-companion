import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, Zap } from "lucide-react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { useGateway } from "@/lib/hermes/useGateway";
import { cronAction, listCronJobs } from "@/lib/hermes/rest";

const title = "Scheduled jobs · Hermes companion";
const description = "Cron jobs your Hermes agent runs on a schedule.";

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

  const run = (id: string, action: "pause" | "resume" | "trigger") => {
    void cronAction(jobs.config, id, action)
      .then(() => toast.success(action === "trigger" ? "Triggered" : `Job ${action}d`))
      .catch((err: Error) => toast.error(err.message))
      .finally(jobs.refresh);
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
      empty={jobs.data?.length === 0}
      emptyText="No scheduled jobs."
      onRefresh={jobs.refresh}
    >
      {jobs.data?.map((job) => {
        const paused = job.paused || job.status === "paused";
        return (
          <Row
            key={job.id}
            title={job.name ?? job.id}
            meta={[job.schedule, job.status, when(job.next_run) && `next ${when(job.next_run)}`]
              .filter(Boolean)
              .join(" · ")}
            right={
              <div className="flex items-center gap-1">
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
              </div>
            }
          >
            {job.prompt && (
              <p className="pb-3 pr-2 text-xs leading-relaxed text-muted-foreground">
                {job.prompt}
              </p>
            )}
          </Row>
        );
      })}
    </GatewayPage>
  );
}
