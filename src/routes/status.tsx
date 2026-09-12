import { createFileRoute } from "@tanstack/react-router";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { gatewayStatus, usageAnalytics } from "@/lib/hermes/rest";
import { useGateway } from "@/lib/hermes/useGateway";
import { useHermesConfig } from "@/lib/hermes/config";
import type { HermesConfig } from "@/lib/hermes/types";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Connection · Hermes companion" },
      {
        name: "description",
        content: "See whether your Mac is reachable, which model is in use, and recent usage.",
      },
      { property: "og:title", content: "Connection · Hermes companion" },
      {
        property: "og:description",
        content: "See whether your Mac is reachable, which model is in use, and recent usage.",
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
}

async function load(config: HermesConfig): Promise<Readout> {
  const [status, usage] = await Promise.all([
    gatewayStatus(config).catch(() => null),
    usageAnalytics(config).catch(() => null),
  ]);
  return { status, usage };
}

/** Flattens a shallow object into readable label/value rows. */
function entries(source: Record<string, unknown> | null): [string, string][] {
  if (!source) return [];
  return Object.entries(source)
    .filter(([, value]) => value !== null && typeof value !== "function")
    .map(([key, value]) => [
      key.replace(/[_-]/g, " "),
      typeof value === "object" ? JSON.stringify(value) : String(value),
    ]);
}

function StatusRoute() {
  const { config } = useHermesConfig();
  const readout = useGateway<Readout>(load);
  const reachable = Boolean(readout.data?.status) && !readout.error;

  return (
    <GatewayPage
      title="Connection"
      subtitle={config.baseUrl || "not connected"}
      loading={readout.loading}
      unavailable={false}
      error={readout.error}
      configured={readout.configured}
      onRefresh={readout.refresh}
    >
      <Row
        title={reachable ? "Your Mac is reachable" : "Couldn't reach your Mac"}
        meta={config.baseUrl}
        right={
          <span
            className={
              reachable ? "h-2 w-2 rounded-full bg-primary" : "h-2 w-2 rounded-full bg-destructive"
            }
          />
        }
      />
      <Row title="Model in use" meta={config.model || "none selected"} />
      {config.fallbackModel && <Row title="Fallback model" meta={config.fallbackModel} />}

      {entries(readout.data?.status ?? null).map(([label, value]) => (
        <Row key={`s-${label}`} title={label} meta={value} />
      ))}

      {readout.data?.usage && (
        <>
          <p className="pt-6 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Recent usage
          </p>
          {entries(readout.data.usage).map(([label, value]) => (
            <Row key={`u-${label}`} title={label} meta={value} />
          ))}
        </>
      )}
    </GatewayPage>
  );
}
