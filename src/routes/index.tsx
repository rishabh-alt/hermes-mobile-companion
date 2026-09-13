import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useHermesConfig } from "@/lib/hermes/config";
import { createGatewaySession } from "@/lib/hermes/session-api";
import { importGatewaySession } from "@/lib/hermes/sessions";
import { pullSession } from "@/lib/hermes/session-sync";
import { listSessions } from "@/lib/hermes/rest";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!configured) {
      void navigate({ to: "/settings", replace: true });
      return;
    }
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const remote = await listSessions(config, 1);
        const session = remote[0] ?? (await createGatewaySession(config));
        const serverSession = await pullSession(config, session.id);
        importGatewaySession(session.id, session.title ?? "New chat", serverSession, session.model);
        if (!cancelled) {
          await navigate({ to: "/c/$sessionId", params: { sessionId: session.id }, replace: true });
        }
      } catch {
        if (!cancelled) setError("Couldn't load sessions from your Hermes gateway.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, configured, navigate, ready]);

  if (error) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="font-medium">{error}</p>
        <p className="text-sm text-muted-foreground">Check the connection and try again.</p>
        <Button asChild>
          <Link to="/settings">Open settings</Link>
        </Button>
      </div>
    );
  }
  return <div className="h-[100dvh] w-full bg-background" />;
}
