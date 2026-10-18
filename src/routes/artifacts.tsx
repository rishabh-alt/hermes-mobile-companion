import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, FileText, MessageSquare } from "lucide-react";
import { useState } from "react";
import { GatewayPage } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { useGateway } from "@/lib/hermes/useGateway";
import { listArtifacts, type Artifact } from "@/lib/hermes/rest";
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
  const [selected, setSelected] = useState<Artifact | null>(null);
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
            onClick={() => {
              setKind(key);
              setSelected(null);
            }}
            className={cn("capitalize", kind === key ? "text-foreground" : "text-muted-foreground")}
          >
            {key}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mb-4 space-y-2.5 rounded-xl border border-border/70 bg-secondary/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {selected.name ?? selected.path ?? "Artifact"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[selected.kind, selected.mime, selected.path].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          {selected.url && (selected.mime?.startsWith("image/") || selected.kind === "image") && (
            <img
              src={selected.url}
              alt={selected.name ?? "artifact"}
              className="max-h-64 w-full rounded-lg object-contain"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {selected.url && (
              <Button asChild size="sm" variant="outline">
                <a href={selected.url} download={selected.name ?? true} rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Download / open
                </a>
              </Button>
            )}
            {selected.session_id && (
              <Button asChild size="sm">
                <Link to="/c/$sessionId" params={{ sessionId: selected.session_id }}>
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                  Open session{selected.session_title ? `: ${selected.session_title}` : ""}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {artifacts.data?.map((item, i) => {
          const isImage = item.url && (item.mime?.startsWith("image/") || item.kind === "image");
          return (
            <button
              key={item.id ?? item.path ?? i}
              type="button"
              onClick={() => setSelected(item)}
              className="overflow-hidden rounded-lg border border-border/50 bg-secondary/30 text-left transition-colors hover:bg-secondary/50"
            >
              {isImage ? (
                <img
                  src={item.url}
                  alt={item.name ?? "artifact"}
                  className="h-28 w-full object-cover"
                />
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-secondary/50 text-muted-foreground">
                  <FileText className="h-7 w-7 opacity-60" />
                </div>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-medium">
                  {item.name ?? item.path ?? "artifact"}
                </p>
                {item.session_title && (
                  <p className="truncate text-[11px] text-muted-foreground">{item.session_title}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </GatewayPage>
  );
}
