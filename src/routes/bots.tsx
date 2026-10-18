import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, MessageSquare, Pencil, Plus, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GatewayPage, Row } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHermesConfig } from "@/lib/hermes/config";
import {
  listProfiles,
  profileSoul,
  saveProfileConfig,
  updateProfileSoul,
  type Profile,
} from "@/lib/hermes/rest";
import { useGateway } from "@/lib/hermes/useGateway";

const title = "Bots · Hermes companion";
const description = "Hermes profiles, personas, and SOUL.md instructions.";

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
  const navigate = useNavigate();
  const { config, update } = useHermesConfig();
  const profiles = useGateway(listProfiles, []);
  const [open, setOpen] = useState<string | null>(null);
  const [soul, setSoul] = useState<Record<string, string>>({});
  const [draftSoul, setDraftSoul] = useState<Record<string, string>>({});
  const [draftModel, setDraftModel] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newSoul, setNewSoul] = useState("");

  const loadSoul = (profile: Profile) => {
    const name = profile.name;
    if (soul[name] !== undefined) return;
    void profileSoul(profiles.config, name)
      .then((res) => {
        const text = res.content ?? res.soul ?? "";
        setSoul((s) => ({ ...s, [name]: text }));
        setDraftSoul((s) => ({ ...s, [name]: text }));
      })
      .catch((err: Error) => {
        setSoul((s) => ({ ...s, [name]: "" }));
        toast.error(err.message);
      });
  };

  const toggle = (profile: Profile) => {
    const name = profile.name;
    if (open === name) {
      setOpen(null);
      setEditingName(null);
      return;
    }
    setOpen(name);
    setDraftModel((m) => ({ ...m, [name]: m[name] ?? profile.model ?? "" }));
    loadSoul(profile);
  };

  const activateProfile = (profile: Profile, startChat = false) => {
    const prefix =
      profile.path ??
      (profile.name === "default" ? "" : `/profiles/${encodeURIComponent(profile.name)}`);
    update({
      activeProfile: profile.name,
      profilePathPrefix: profile.name === "default" ? "" : prefix,
      ...(profile.model ? { model: profile.model } : {}),
    });
    toast.success(`Switched to ${profile.name}`);
    if (startChat) {
      void navigate({ to: "/" });
    }
  };

  const savePersona = async (profile: Profile) => {
    const name = profile.name;
    const nextSoul = draftSoul[name] ?? soul[name] ?? "";
    const nextModel = (draftModel[name] ?? profile.model ?? "").trim();
    setSavingName(name);
    try {
      await updateProfileSoul(profiles.config, name, nextSoul);
      if (nextModel !== (profile.model ?? "")) {
        await saveProfileConfig(profiles.config, name, {
          model: nextModel,
          soul: nextSoul,
        }).catch(() => undefined);
      }
      setSoul((s) => ({ ...s, [name]: nextSoul }));
      setEditingName(null);
      toast.success(`Saved ${name} persona on host`);
      profiles.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save SOUL.md on host.");
    } finally {
      setSavingName(null);
    }
  };

  const createProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = newName.trim().replace(/\s+/g, "-").toLowerCase();
    if (!cleanName) {
      toast.error("Profile name is required.");
      return;
    }
    setSavingName(cleanName);
    try {
      await saveProfileConfig(profiles.config, cleanName, {
        ...(newModel.trim() ? { model: newModel.trim() } : {}),
        ...(newSoul.trim() ? { soul: newSoul.trim() } : {}),
      });
      if (newSoul.trim()) {
        await updateProfileSoul(profiles.config, cleanName, newSoul.trim()).catch(() => undefined);
      }
      toast.success(`Created profile ${cleanName}`);
      setCreating(false);
      setNewName("");
      setNewModel("");
      setNewSoul("");
      profiles.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create profile on host.");
    } finally {
      setSavingName(null);
    }
  };

  return (
    <GatewayPage
      title="Bots"
      subtitle={profiles.data ? `${profiles.data.length} profiles on host` : undefined}
      loading={profiles.loading}
      unavailable={profiles.unavailable}
      error={profiles.error}
      configured={profiles.configured}
      empty={profiles.data?.length === 0 && !creating}
      emptyText="No profiles on this gateway."
      onRefresh={profiles.refresh}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Active on phone:{" "}
          <span className="font-medium text-foreground">{config.activeProfile}</span>
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New bot profile
        </Button>
      </div>

      {creating && (
        <form
          onSubmit={createProfile}
          className="mb-4 space-y-3 rounded-xl border border-border/70 bg-secondary/20 p-3"
        >
          <p className="text-sm font-medium">Create headless bot persona</p>
          <div className="space-y-1.5">
            <Label htmlFor="new-bot-name">Profile slug</Label>
            <Input
              id="new-bot-name"
              placeholder="researcher, ops-bot, coder"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-bot-model">Default model (optional)</Label>
            <Input
              id="new-bot-model"
              placeholder={config.model || "claude-3-7-sonnet"}
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-bot-soul">SOUL.md instructions</Label>
            <textarea
              id="new-bot-soul"
              rows={4}
              placeholder="You are a concise DevOps & automation specialist running on a headless server..."
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-xs leading-relaxed focus:outline-none"
              value={newSoul}
              onChange={(e) => setNewSoul(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={Boolean(savingName)}>
              {savingName ? "Creating…" : "Create on host"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {profiles.data?.map((profile) => {
        const isActive =
          config.activeProfile === profile.name ||
          (!config.activeProfile && Boolean(profile.is_default));
        const isExpanded = open === profile.name;
        const isEditing = editingName === profile.name;
        const currentSoul = soul[profile.name];

        return (
          <Row
            key={profile.name}
            title={profile.name}
            meta={[
              profile.model,
              profile.skills ? `${profile.skills} skills` : null,
              profile.is_default ? "host default" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            right={
              <div className="flex items-center gap-1.5">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Check className="h-3 w-3" />
                    Active
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => activateProfile(profile, false)}
                  >
                    Use
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Chat with ${profile.name}`}
                  onClick={() => activateProfile(profile, true)}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </div>
            }
            onClick={() => toggle(profile)}
          >
            {isExpanded && (
              <div className="mb-3 space-y-2.5 rounded-xl border border-border/60 bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">SOUL.md Persona</span>
                  <div className="flex items-center gap-1.5">
                    {!isEditing ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraftSoul((s) => ({
                            ...s,
                            [profile.name]: s[profile.name] ?? currentSoul ?? "",
                          }));
                          setEditingName(profile.name);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit SOUL.md
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingName === profile.name}
                          onClick={() => void savePersona(profile)}
                        >
                          <Save className="mr-1 h-3.5 w-3.5" />
                          {savingName === profile.name ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingName(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor={`model-${profile.name}`} className="text-xs">
                        Preferred model
                      </Label>
                      <Input
                        id={`model-${profile.name}`}
                        value={draftModel[profile.name] ?? profile.model ?? ""}
                        onChange={(e) =>
                          setDraftModel((m) => ({ ...m, [profile.name]: e.target.value }))
                        }
                        placeholder="Default model for this bot"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`soul-${profile.name}`} className="text-xs">
                        SOUL.md system instructions
                      </Label>
                      <textarea
                        id={`soul-${profile.name}`}
                        rows={7}
                        className="w-full rounded-lg border border-border/70 bg-background p-2.5 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
                        value={draftSoul[profile.name] ?? ""}
                        onChange={(e) =>
                          setDraftSoul((s) => ({ ...s, [profile.name]: e.target.value }))
                        }
                        placeholder="Write system persona instructions for this profile..."
                      />
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
                    {currentSoul === undefined
                      ? "Loading…"
                      : currentSoul.trim() || "No SOUL.md set yet. Tap Edit SOUL.md to configure."}
                  </pre>
                )}
              </div>
            )}
          </Row>
        );
      })}
    </GatewayPage>
  );
}
