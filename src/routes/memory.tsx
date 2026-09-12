import { createFileRoute } from "@tanstack/react-router";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { fetchMemory } from "@/lib/hermes/client";
import { useGateway } from "@/lib/hermes/useGateway";
import type { MemoryPeer } from "@/lib/hermes/types";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory · Hermes companion" },
      {
        name: "description",
        content: "Inspect what your Hermes agent remembers about you and its peers.",
      },
      { property: "og:title", content: "Memory · Hermes companion" },
      {
        property: "og:description",
        content: "Inspect what your Hermes agent remembers about you and its peers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MemoryRoute,
});

function MemoryRoute() {
  const memory = useGateway<MemoryPeer[] | null>((config) => fetchMemory(config));
  const peers = memory.data ?? [];

  return (
    <GatewayPage
      title="Memory"
      subtitle="What Hermes remembers"
      loading={memory.loading}
      unavailable={memory.unavailable || (!memory.loading && memory.data === null && !memory.error)}
      error={memory.error}
      configured={memory.configured}
      empty={peers.length === 0}
      emptyText="Hermes hasn't stored any memories yet."
      onRefresh={memory.refresh}
    >
      {peers.map((peer) => (
        <Row
          key={peer.id}
          title={peer.name}
          meta={peer.updatedAt ? `Updated ${peer.updatedAt}` : undefined}
        >
          <ul className="space-y-1 pb-3">
            {peer.facts.map((fact, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                · {fact}
              </li>
            ))}
            {peer.facts.length === 0 && (
              <li className="text-xs text-muted-foreground">Nothing recorded for this peer.</li>
            )}
          </ul>
        </Row>
      ))}
    </GatewayPage>
  );
}
