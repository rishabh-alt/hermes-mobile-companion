import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HermesError } from "@/lib/hermes/client";
import { fetchMemory } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import { composeGatewayUrl } from "@/lib/hermes/profiles";
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
  const { config } = useHermesConfig();
  const memory = useGateway<MemoryPeer[] | null>((config) => fetchMemory(config));
  const peers = memory.data ?? [];
  const [correction, setCorrection] = useState("");
  const [note, setNote] = useState<string | null>(null);

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
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = correction.trim();
          if (!text) return;
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (config.token.trim()) headers["Authorization"] = `Bearer ${config.token.trim()}`;
          void fetch(composeGatewayUrl(config, "/api/memory/correct"), {
            method: "POST",
            headers,
            body: JSON.stringify({ text }),
          })
            .then(async (response) => {
              if (!response.ok)
                throw new HermesError("The host did not take that correction.", response.status);
              setCorrection("");
              setNote("Saved on the host.");
              memory.refresh();
            })
            .catch((err: unknown) =>
              setNote(
                err instanceof HermesError ? err.message : "The host did not take that correction.",
              ),
            );
        }}
      >
        <Input
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
          placeholder="Correct a memory"
        />
        <Button type="submit">Save</Button>
      </form>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
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
