import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHermesConfig } from "@/lib/hermes/config";
import { createGatewaySession } from "@/lib/hermes/session-api";
import { importGatewaySession } from "@/lib/hermes/sessions";
import { listSessions } from "@/lib/hermes/rest";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hermes companion — chat with your agent" },
      {
        name: "description",
        content: "A polished mobile companion for the Hermes agent running on your Mac.",
      },
      { property: "og:title", content: "Hermes companion — chat with your agent" },
      {
        property: "og:description",
        content: "A polished mobile companion for the Hermes agent running on your Mac.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { config, configured, ready } = useHermesConfig();

  useEffect(() => {
    if (!ready || !configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await listSessions(config, 1);
        const session = remote[0] ?? (await createGatewaySession(config));
        importGatewaySession(session.id, session.title ?? "New chat", [], session.model);
        if (!cancelled) {
          await navigate({ to: "/c/$sessionId", params: { sessionId: session.id }, replace: true });
        }
      } catch {
        if (!cancelled) await navigate({ to: "/settings", replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, configured, navigate, ready]);

  return <div className="h-[100dvh] w-full bg-background" />;
}
