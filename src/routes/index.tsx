import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { createSession, readSessions } from "@/lib/hermes/sessions";

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

  useEffect(() => {
    const existing = readSessions().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const session = existing ?? createSession();
    void navigate({ to: "/c/$sessionId", params: { sessionId: session.id }, replace: true });
  }, [navigate]);

  return <div className="h-[100dvh] w-full bg-background" />;
}
