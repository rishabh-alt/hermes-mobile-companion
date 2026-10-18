import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useGateway } from "@/lib/hermes/useGateway";
import {
  listMcpServers,
  listSkills,
  listTools,
  setMcpEnabled,
  skillContent,
  testMcpServer,
} from "@/lib/hermes/rest";
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
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [skillBodies, setSkillBodies] = useState<Record<string, string>>({});
  const [loadingSkill, setLoadingSkill] = useState<string | null>(null);

  const skills = useGateway(listSkills, ["skills"]);
  const tools = useGateway(listTools, ["tools"]);
  const mcp = useGateway(listMcpServers, ["mcp"]);
  const active = tab === "skills" ? skills : tab === "tools" ? tools : mcp;

  const counts = {
    skills: skills.data?.length ?? 0,
    tools: tools.data?.length ?? 0,
    mcp: mcp.data?.length ?? 0,
  };

  const toggleSkill = (name: string) => {
    if (openSkill === name) {
      setOpenSkill(null);
      return;
    }
    setOpenSkill(name);
    if (skillBodies[name] !== undefined) return;
    setLoadingSkill(name);
    void skillContent(skills.config, name)
      .then((res) => {
        const body = res.content ?? res.markdown ?? "";
        setSkillBodies((prev) => ({
          ...prev,
          [name]: body.trim() || "No SKILL.md content returned by the host.",
        }));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Could not read skill content.";
        setSkillBodies((prev) => ({ ...prev, [name]: msg }));
      })
      .finally(() => setLoadingSkill(null));
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
        skills.data?.map((skill) => {
          const isOpen = openSkill === skill.name;
          return (
            <div key={skill.name} className="border-b border-border/40 last:border-b-0">
              <Row
                title={skill.name}
                meta={skill.description ?? skill.category}
                right={
                  <div className="flex items-center gap-2">
                    {skill.uses ? (
                      <span className="text-[11px] text-muted-foreground">×{skill.uses}</span>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleSkill(skill.name)}
                    >
                      {isOpen ? "Hide" : "Inspect"}
                    </Button>
                  </div>
                }
              />
              {isOpen && (
                <div className="mb-3 rounded-lg border border-border/70 bg-secondary/30 p-3">
                  {loadingSkill === skill.name ? (
                    <p className="text-xs text-muted-foreground">Loading SKILL.md…</p>
                  ) : (
                    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                      {skillBodies[skill.name]}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}

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
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void testMcpServer(mcp.config, server.name)
                      .then(() => toast.success(`${server.name} MCP server responded`))
                      .catch((err: unknown) =>
                        toast.error(
                          err instanceof Error ? err.message : `Could not reach ${server.name}.`,
                        ),
                      );
                  }}
                >
                  Test
                </Button>
                <Switch
                  checked={server.enabled !== false}
                  onCheckedChange={(next) => {
                    void setMcpEnabled(mcp.config, server.name, next)
                      .then(() => toast.success(`${server.name} ${next ? "enabled" : "disabled"}`))
                      .catch((err: unknown) =>
                        toast.error(
                          err instanceof Error ? err.message : "The host rejected that MCP toggle.",
                        ),
                      )
                      .finally(mcp.refresh);
                  }}
                />
              </div>
            }
          />
        ))}
    </GatewayPage>
  );
}
