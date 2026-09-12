import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Switch } from "@/components/ui/switch";
import { useGateway } from "@/lib/hermes/useGateway";
import { listMcpServers, listSkills, listTools, setMcpEnabled } from "@/lib/hermes/rest";
import { cn } from "@/lib/utils";

const title = "Capabilities · Hermes companion";
const description = "Skills, tools and MCP servers your Hermes agent can use.";

export const Route = createFileRoute("/capabilities")({
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
  component: CapabilitiesRoute,
});

type Tab = "skills" | "tools" | "mcp";

function CapabilitiesRoute() {
  const [tab, setTab] = useState<Tab>("skills");

  const skills = useGateway(listSkills, ["skills"]);
  const tools = useGateway(listTools, ["tools"]);
  const mcp = useGateway(listMcpServers, ["mcp"]);
  const active = tab === "skills" ? skills : tab === "tools" ? tools : mcp;

  const counts = {
    skills: skills.data?.length ?? 0,
    tools: tools.data?.length ?? 0,
    mcp: mcp.data?.length ?? 0,
  };

  return (
    <GatewayPage
      title="Capabilities"
      loading={active.loading}
      unavailable={active.unavailable}
      error={active.error}
      configured={active.configured}
      empty={(active.data as unknown[] | null)?.length === 0}
      emptyText="Nothing installed here yet."
      onRefresh={active.refresh}
    >
      <div className="mb-2 flex items-center gap-4 border-b border-border/40 pb-2 text-sm">
        {(["skills", "tools", "mcp"] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "capitalize transition-colors",
              tab === key ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {key === "mcp" ? "MCP" : key}
            <span className="ml-1 text-[11px] text-muted-foreground">{counts[key]}</span>
          </button>
        ))}
      </div>

      {tab === "skills" &&
        skills.data?.map((skill) => (
          <Row
            key={skill.name}
            title={skill.name}
            meta={skill.description ?? skill.category}
            right={
              skill.uses ? (
                <span className="text-[11px] text-muted-foreground">×{skill.uses}</span>
              ) : undefined
            }
          />
        ))}

      {tab === "tools" &&
        tools.data?.map((tool) => (
          <Row key={tool.name} title={tool.name} meta={tool.description} />
        ))}

      {tab === "mcp" &&
        mcp.data?.map((server) => (
          <Row
            key={server.name}
            title={server.name}
            meta={server.status ?? server.url ?? server.command}
            right={
              <Switch
                checked={server.enabled !== false}
                onCheckedChange={(next) => {
                  void setMcpEnabled(mcp.config, server.name, next).finally(mcp.refresh);
                }}
              />
            }
          />
        ))}
    </GatewayPage>
  );
}
