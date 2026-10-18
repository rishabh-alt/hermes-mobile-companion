import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Bug, RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHermesConfig } from "@/lib/hermes/config";
import {
  fetchModelOptions,
  gatewayStatus,
  reloadHostGateway,
  usageAnalytics,
} from "@/lib/hermes/rest";
import type { HermesConfig } from "@/lib/hermes/types";
import { useGateway } from "@/lib/hermes/useGateway";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Connection · Hermes companion" },
      {
        name: "description",
        content: "Monitor your headless Hermes server, switch models, and inspect token usage.",
      },
      { property: "og:title", content: "Connection · Hermes companion" },
      {
        property: "og:description",
        content: "Monitor your headless Hermes server, switch models, and inspect token usage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatusRoute,
});

interface Readout {
  status: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  models: string[];
}

async function load(config: HermesConfig): Promise<Readout> {
  const [status, usage, modelSnapshot] = await Promise.all([
    gatewayStatus(config).catch(() => null),
    usageAnalytics(config).catch(() => null),
    fetchModelOptions(config).catch(() => null),
  ]);
  const models = modelSnapshot
    ? Array.from(new Set(modelSnapshot.providers.flatMap((p) => p.models)))
    : [];
  return { status, usage, models };
}

function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value
      .slice(0, 6)
      .map((item) => (typeof item === "object" ? formatCompactObject(item) : String(item)))
      .join(", ");
  }
  if (typeof value === "object") {
    return formatCompactObject(value);
  }
  return String(value);
}

function formatCompactObject(obj: unknown): string {
  if (!obj || typeof obj !== "object") return String(obj);
  const entries = Object.entries(obj as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "function",
  );
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 5)
    .map(([k, v]) => {
      const label = k.replace(/[_-]/g, " ");
      if (typeof v === "number") {
        return `${label}: ${Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)}`;
      }
      if (typeof v === "object") return `${label}: …`;
      return `${label}: ${String(v)}`;
    })
    .join(" · ");
}

function extractNestedRows(
  source: Record<string, unknown> | null,
): Array<{ label: string; value: string; children?: Array<[string, string]> }> {
  if (!source) return [];
  return Object.entries(source)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "function")
    .map(([key, value]) => {
      const label = key.replace(/[_-]/g, " ");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const subEntries = Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]): [string, string] => [k.replace(/[_-]/g, " "), formatMetricValue(v)]);
        return {
          label,
          value: `${subEntries.length} metrics`,
          children: subEntries,
        };
      }
      return {
        label,
        value: formatMetricValue(value),
      };
    });
}

function StatusRoute() {
  const { config, update } = useHermesConfig();
  const readout = useGateway<Readout>(load);
  const [reloading, setReloading] = useState(false);
  const [fallbackDraft, setFallbackDraft] = useState(config.fallbackModel);
  const reachable = Boolean(readout.data?.status) && !readout.error;
  const models = readout.data?.models ?? [];

  const handleReloadHost = async () => {
    setReloading(true);
    try {
      await reloadHostGateway(config);
      toast.success("Reloaded headless host configuration");
      readout.refresh();
    } catch {
      readout.refresh();
      toast.success("Refreshed host status");
    } finally {
      setReloading(false);
    }
  };

  return (
    <GatewayPage
      title="Connection & Host"
      subtitle={config.baseUrl || "not connected"}
      loading={readout.loading}
      unavailable={false}
      error={readout.error}
      configured={readout.configured}
      onRefresh={readout.refresh}
    >
      <div className="mb-4 space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={
                reachable
                  ? "h-2.5 w-2.5 rounded-full bg-primary"
                  : "h-2.5 w-2.5 rounded-full bg-destructive"
              }
            />
            <span className="text-sm font-medium">
              {reachable ? "Headless server reachable" : "Couldn't reach your Hermes server"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Profile: {config.activeProfile}</span>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {config.baseUrl || "No HTTPS gateway configured"}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" variant="outline" onClick={readout.refresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Ping host
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={reloading}
            onClick={() => void handleReloadHost()}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {reloading ? "Reloading…" : "Reload host config"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Settings
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/debug">
              <Bug className="mr-1.5 h-3.5 w-3.5" />
              Debug log
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-2.5 rounded-xl border border-border/70 bg-secondary/15 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Model & Failover Routing
        </p>
        <Row title="Primary model" meta={config.model || "none selected"} />
        {models.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {models.slice(0, 6).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={config.model === m ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  update({ model: m });
                  toast.success(`Primary model set to ${m}`);
                }}
              >
                {m}
              </Button>
            ))}
          </div>
        )}
        <div className="space-y-1.5 pt-1">
          <p className="text-xs text-muted-foreground">
            Fallback model (used if primary provider rate-limits)
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              update({ fallbackModel: fallbackDraft.trim() });
              toast.success(
                fallbackDraft.trim()
                  ? `Fallback model set to ${fallbackDraft.trim()}`
                  : "Cleared fallback model",
              );
            }}
          >
            <Input
              value={fallbackDraft}
              onChange={(e) => setFallbackDraft(e.target.value)}
              placeholder="e.g. gpt-4o-mini or claude-3-5-haiku"
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" variant="outline" className="h-8">
              Save
            </Button>
          </form>
        </div>
      </div>

      {extractNestedRows(readout.data?.status ?? null).map((item) => (
        <Row key={`s-${item.label}`} title={item.label} meta={item.value}>
          {item.children && item.children.length > 0 && (
            <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-lg bg-secondary/25 p-2 text-xs">
              {item.children.map(([k, v]) => (
                <div key={k} className="truncate">
                  <span className="text-muted-foreground">{k}: </span>
                  <span className="font-mono text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
        </Row>
      ))}

      {readout.data?.usage && (
        <>
          <div className="flex items-center gap-1.5 pt-6 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span>Usage & Token Breakdown (7 days)</span>
          </div>
          {extractNestedRows(readout.data.usage).map((item) => (
            <Row key={`u-${item.label}`} title={item.label} meta={item.value}>
              {item.children && item.children.length > 0 && (
                <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-lg bg-secondary/25 p-2 text-xs">
                  {item.children.map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-muted-foreground">{k}: </span>
                      <span className="font-mono text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </Row>
          ))}
        </>
      )}
    </GatewayPage>
  );
}
