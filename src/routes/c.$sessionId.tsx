import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ChatView } from "@/components/hermes/chat-view";
import { ensureSession } from "@/lib/hermes/sessions";

export const Route = createFileRoute("/c/$sessionId")({
  head: () => ({
    meta: [
      { title: "Chat · Hermes companion" },
      {
        name: "description",
        content: "Talk to your Hermes agent with streaming replies, thinking and tool calls.",
      },
      { property: "og:title", content: "Chat · Hermes companion" },
      {
        property: "og:description",
        content: "Talk to your Hermes agent with streaming replies, thinking and tool calls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { sessionId } = Route.useParams();

  useEffect(() => {
    ensureSession(sessionId);
  }, [sessionId]);

  return <ChatView sessionId={sessionId} />;
}
