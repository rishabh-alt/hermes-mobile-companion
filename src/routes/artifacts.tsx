import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GatewayPage } from "@/components/hermes/gateway-page";
import { useGateway } from "@/lib/hermes/useGateway";
import { listArtifacts } from "@/lib/hermes/rest";
import { cn } from "@/lib/utils";

const title = "Artifacts · Hermes companion";
const description = "Images, files and links your Hermes agent has produced.";

export const Route = createFileRoute("/artifacts")({
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
  component: ArtifactsRoute,
});

const tabs = ["all", "images", "files", "links"] as const;

function ArtifactsRoute() {
  const [kind, setKind] = useState<(typeof tabs)[number]>("all");
  const artifacts = useGateway((config) => listArtifacts(config, kind), [kind]);

  return (
    <GatewayPage
      title="Artifacts"
      loading={artifacts.loading}
      unavailable={artifacts.unavailable}
      error={artifacts.error}
      configured={artifacts.configured}
      empty={artifacts.data?.length === 0}
      emptyText="No artifacts yet."
      onRefresh={artifacts.refresh}
    >
      <div className="mb-3 flex items-center gap-4 border-b border-border/40 pb-2 text-sm">
        {tabs.map((key) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={cn("capitalize", kind === key ? "text-foreground" : "text-muted-foreground")}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {artifacts.data?.map((item, i) => (
          <div
            key={item.id ?? item.path ?? i}
            className="overflow-hidden rounded-lg bg-secondary/30"
          >
            {item.url && (item.mime?.startsWith("image/") || item.kind === "image") ? (
              <img
                src={item.url}
                alt={item.name ?? "artifact"}
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="h-28 w-full bg-secondary/50" />
            )}
            <div className="p-2">
              <p className="truncate text-xs">{item.name ?? item.path ?? "artifact"}</p>
              {item.session_title && (
                <p className="truncate text-[11px] text-muted-foreground">{item.session_title}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </GatewayPage>
  );
}
