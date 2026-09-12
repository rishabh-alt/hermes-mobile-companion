import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { useGateway } from "@/lib/hermes/useGateway";
import { listProfiles, profileSoul } from "@/lib/hermes/rest";

const title = "Bots · Hermes companion";
const description = "Hermes profiles and their personas.";

export const Route = createFileRoute("/bots")({
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
  component: BotsRoute,
});

function BotsRoute() {
  const profiles = useGateway(listProfiles, []);
  const [open, setOpen] = useState<string | null>(null);
  const [soul, setSoul] = useState<Record<string, string>>({});

  const toggle = (name: string) => {
    if (open === name) {
      setOpen(null);
      return;
    }
    setOpen(name);
    if (soul[name] === undefined) {
      void profileSoul(profiles.config, name)
        .then((res) =>
          setSoul((s) => ({ ...s, [name]: res.content ?? res.soul ?? "No SOUL.md set." })),
        )
        .catch((err: Error) => setSoul((s) => ({ ...s, [name]: err.message })));
    }
  };

  return (
    <GatewayPage
      title="Bots"
      subtitle={profiles.data ? `${profiles.data.length} profiles` : undefined}
      loading={profiles.loading}
      unavailable={profiles.unavailable}
      error={profiles.error}
      configured={profiles.configured}
      empty={profiles.data?.length === 0}
      emptyText="No profiles on this gateway."
      onRefresh={profiles.refresh}
    >
      {profiles.data?.map((profile) => (
        <Row
          key={profile.name}
          title={profile.name}
          meta={[profile.model, profile.skills ? `${profile.skills} skills` : null]
            .filter(Boolean)
            .join(" · ")}
          right={
            profile.is_default ? (
              <span className="text-[11px] text-muted-foreground">default</span>
            ) : undefined
          }
          onClick={() => toggle(profile.name)}
        >
          {open === profile.name && (
            <pre className="mb-3 whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
              {soul[profile.name] ?? "Loading…"}
            </pre>
          )}
        </Row>
      ))}
    </GatewayPage>
  );
}
