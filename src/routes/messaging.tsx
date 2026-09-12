import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useGateway } from "@/lib/hermes/useGateway";
import {
  listMessagingPlatforms,
  listWebhooks,
  setWebhookEnabled,
  testMessagingPlatform,
} from "@/lib/hermes/rest";
import { cn } from "@/lib/utils";

const title = "Messaging · Hermes companion";
const description = "Chat platforms and webhooks connected to your Hermes agent.";

export const Route = createFileRoute("/messaging")({
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
  component: MessagingRoute,
});

function MessagingRoute() {
  const [tab, setTab] = useState<"platforms" | "webhooks">("platforms");
  const platforms = useGateway(listMessagingPlatforms, ["platforms"]);
  const webhooks = useGateway(listWebhooks, ["webhooks"]);
  const active = tab === "platforms" ? platforms : webhooks;

  return (
    <GatewayPage
      title="Messaging"
      loading={active.loading}
      unavailable={active.unavailable}
      error={active.error}
      configured={active.configured}
      empty={(active.data as unknown[] | null)?.length === 0}
      emptyText="Nothing connected yet."
      onRefresh={active.refresh}
    >
      <div className="mb-2 flex items-center gap-4 border-b border-border/40 pb-2 text-sm">
        {(["platforms", "webhooks"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("capitalize", tab === key ? "text-foreground" : "text-muted-foreground")}
          >
            {key}
          </button>
        ))}
      </div>

      {tab === "platforms" &&
        platforms.data?.map((platform) => (
          <Row
            key={platform.id}
            title={platform.name ?? platform.id}
            meta={platform.description ?? platform.status}
            right={
              <div className="flex items-center gap-2">
                {(platform.connected || platform.enabled) && (
                  <span className="text-[11px] text-primary">connected</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void testMessagingPlatform(platforms.config, platform.id)
                      .then(() => toast.success(`${platform.name ?? platform.id} responded`))
                      .catch((err: Error) => toast.error(err.message));
                  }}
                >
                  Test
                </Button>
              </div>
            }
          />
        ))}

      {tab === "webhooks" &&
        webhooks.data?.map((hook) => (
          <Row
            key={hook.name}
            title={hook.name}
            meta={hook.url}
            right={
              <Switch
                checked={hook.enabled !== false}
                onCheckedChange={(next) => {
                  void setWebhookEnabled(webhooks.config, hook.name, next).finally(
                    webhooks.refresh,
                  );
                }}
              />
            }
          />
        ))}
    </GatewayPage>
  );
}
