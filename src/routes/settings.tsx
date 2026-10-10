import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchModels, HermesError } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import { haptic } from "@/lib/hermes/haptics";
import { claimHostAdmin, readHostModel, saveHostModel } from "@/lib/hermes/model-admin";
import { note } from "@/lib/hermes/debug-log";
import { saveHostSetting } from "@/lib/hermes/settings-door";
import { nativeGet } from "@/lib/hermes/native-get";
import { composeGatewayUrl } from "@/lib/hermes/profiles";
import {
  DIAGNOSTIC_PROBES,
  firstSessionMessagesPath,
  interpretProbe,
  searchSections,
  settingsSections,
  type ProbeStatus,
  type SettingsSection,
} from "@/lib/hermes/settings-console";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Hermes companion" },
      { name: "description", content: "Phone console for a headless Hermes host." },
    ],
  }),
  component: SettingsRoute,
});

type ProbeRow = { id: string; label: string; status: ProbeStatus; detail?: string };

function SettingsRoute() {
  const { config, update } = useHermesConfig();
  const [query, setQuery] = useState("");
  const [features, setFeatures] = useState<{
    admin_config_rw?: boolean;
    model_options?: boolean;
    model_admin?: boolean;
    settings_admin?: boolean;
  }>({});
  const [probes, setProbes] = useState<ProbeRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const sections = useMemo(
    () => searchSections(settingsSections(features), query),
    [features, query],
  );

  const checkHost = async () => {
    setChecking(true);
    setProbes([]);
    try {
      const results = await Promise.allSettled(
        DIAGNOSTIC_PROBES.map((probe) => runProbe(config, probe.id, probe.label, probe.path)),
      );
      const rows = results.map((r, i) => {
        const probe = DIAGNOSTIC_PROBES[i]!;
        return r.status === "fulfilled"
          ? r.value
          : {
              id: probe.id,
              label: probe.label,
              status: "transport" as ProbeStatus,
              detail: "Probe crashed unexpectedly.",
            };
      });
      const sessions = rows.find((row) => row.id === "sessions");
      if (sessions?.status === "ok") {
        const path = firstSessionMessagesPath(sessions.payload);
        rows.push(
          path
            ? await runProbe(config, "transcript", "Transcript", path)
            : { id: "transcript", label: "Transcript", status: "ok", detail: "No sessions yet." },
        );
      }
      const capabilities = rows.find((row) => row.id === "capabilities");
      const raw =
        capabilities?.payload && typeof capabilities.payload === "object"
          ? ((capabilities.payload as { features?: Record<string, unknown> }).features ?? {})
          : {};
      setFeatures({
        admin_config_rw: raw["admin_config_rw"] === true,
        model_options: raw["model_options"] === true,
        model_admin: raw["model_admin"] === true,
        settings_admin: raw["settings_admin"] === true,
      });
      if (raw["model_options"] === true && !config.model) {
        try {
          const list = await fetchModels(config);
          if (list[0]?.id) update({ model: list[0].id });
        } catch {
          // Model inventory is reported by its own probe.
        }
      }
      setProbes(rows.map(({ payload: _payload, ...row }) => row));
      haptic(
        rows.some((row) => row.status === "auth" || row.status === "transport") ? "error" : "done",
      );
    } finally {
      setChecking(false);
    }
  };

  const loadModels = async () => {
    setModelNote(null);
    try {
      const list = await fetchModels(config);
      setModels(list.map((model) => model.id));
      setModelNote(
        list.length ? `${list.length} models on the host.` : "The host returned no models.",
      );
      if (!config.model && list[0]?.id) update({ model: list[0].id });
    } catch (err) {
      setModels([]);
      setModelNote(err instanceof HermesError ? err.message : "Could not read models.");
    }
  };

  return (
    <AppShell title="Settings" subtitle="Headless host console">
      <div className="mx-auto w-full max-w-xl space-y-4 overflow-y-auto p-4 pb-16">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
        />
        <Accordion type="single" collapsible className="rounded-xl border border-border/70 px-3">
          {sections.map((section) => (
            <AccordionItem key={section.id} value={section.id}>
              <AccordionTrigger>
                <span className="flex min-w-0 flex-col items-start">
                  <span>{section.title}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {accessLabel(section)}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{section.summary}</p>
                {section.access === "blocked" ? (
                  <p className="text-sm text-muted-foreground">{section.reason}</p>
                ) : (
                  <>
                    {section.id === "connection" && (
                      <ConnectionFields
                        config={config}
                        update={update}
                        checking={checking}
                        probes={probes}
                        onCheck={checkHost}
                      />
                    )}
                    {section.id === "appearance" && (
                      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
                        <div>
                          <p className="text-sm font-medium">Haptics</p>
                          <p className="text-xs text-muted-foreground">
                            Vibrate on send, finish, and errors.
                          </p>
                        </div>
                        <Switch
                          checked={config.haptics}
                          onCheckedChange={(value) => update({ haptics: value })}
                        />
                      </div>
                    )}
                    {section.id === "model" && section.access === "read" && (
                      <div className="space-y-2">
                        <Button type="button" variant="outline" onClick={loadModels}>
                          Read host models
                        </Button>
                        {modelNote && <p className="text-xs text-muted-foreground">{modelNote}</p>}
                        {models.length > 0 && (
                          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                            {models.map((id) => (
                              <li key={id}>{id}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {section.id === "model" && section.access === "write" && (
                      <ModelAdminPanel config={config} update={update} />
                    )}
                    {section.access === "write" && section.id !== "model" && (
                      <HostDoorPanel config={config} sectionId={section.id} />
                    )}
                    {section.reason && (
                      <p className="text-sm text-muted-foreground">{section.reason}</p>
                    )}
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        {sections.length === 0 && (
          <p className="text-sm text-muted-foreground">No settings match that search.</p>
        )}
      </div>
    </AppShell>
  );
}

function ConnectionFields({
  config,
  update,
  checking,
  probes,
  onCheck,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
  checking: boolean;
  probes: ProbeRow[];
  onCheck: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="baseUrl">Gateway address</Label>
        <Input
          id="baseUrl"
          inputMode="url"
          autoCapitalize="none"
          placeholder="https://your-mac.example.ts.net"
          value={config.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          HTTPS Tailscale Serve or tunnel URL. Plain HTTP is rejected to protect your token.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="token">Access token</Label>
        <Input
          id="token"
          type="password"
          autoCapitalize="none"
          value={config.token}
          onChange={(event) => update({ token: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fallback">Fallback model</Label>
        <Input
          id="fallback"
          autoCapitalize="none"
          placeholder="used if the main model fails"
          value={config.fallbackModel}
          onChange={(event) => update({ fallbackModel: event.target.value })}
        />
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Live agent channel</p>
          <p className="text-xs text-muted-foreground">Show thoughts and tool activity.</p>
        </div>
        <Switch
          checked={config.wsEnabled}
          onCheckedChange={(value) => update({ wsEnabled: value })}
        />
      </div>
      <Button
        type="button"
        onClick={onCheck}
        disabled={checking || !config.baseUrl.trim()}
        className="w-full"
      >
        {checking ? "Checking…" : "Check host"}
      </Button>
      {probes.length > 0 && (
        <ul className="space-y-1 text-xs">
          {probes.map((probe) => (
            <li key={probe.id}>
              {probe.label}: {probe.status}
              {probe.detail ? ` — ${probe.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="outline" className="w-full">
        <Link to="/status">Connection &amp; usage</Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/debug">Debug log</Link>
      </Button>
    </div>
  );
}

async function runProbe(
  config: ReturnType<typeof useHermesConfig>["config"],
  id: string,
  label: string,
  path: string,
): Promise<ProbeRow & { payload?: unknown }> {
  try {
    const headers: Record<string, string> = {};
    if (config.token.trim()) headers["Authorization"] = `Bearer ${config.token.trim()}`;
    const response = await nativeGet(composeGatewayUrl(config, path), headers);
    const ok = response.status >= 200 && response.status < 300;
    const status = interpretProbe({ ok, status: response.status });
    let payload: unknown;
    if (ok) {
      try {
        payload = JSON.parse(response.data) as unknown;
      } catch {
        payload = undefined;
      }
    }
    return { id, label, status, payload };
  } catch (err) {
    const isTimeout =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && /timeout/i.test(err.message));
    note(`${label} transport${isTimeout ? " timeout" : ""}`);
    return {
      id,
      label,
      status: interpretProbe({ ok: false, transport: true }),
      ...(isTimeout
        ? { detail: "Timed out after 10 s — the phone may not be able to reach this host." }
        : {}),
    };
  }
}

function accessLabel(section: SettingsSection) {
  if (section.access === "phone") return "On this phone";
  if (section.access === "write") return "Can save on host";
  if (section.access === "read") return "Read from host";
  return "Host has not opened this";
}

function HostDoorPanel({
  config,
  sectionId,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  sectionId: string;
}) {
  const [value, setValue] = useState("");
  const [noteText, setNoteText] = useState<string | null>(null);
  const field =
    sectionId === "safety"
      ? { key: "approvals.mode", label: "Approval mode", hint: "manual, smart, or off" }
      : sectionId === "voice"
        ? { key: "voice.submit_mode", label: "Voice submit", hint: "direct or draft" }
        : sectionId === "providers"
          ? {
              key: "OPENAI_API_KEY",
              label: "Provider key",
              hint: "Write-only. Not stored on this phone.",
            }
          : {
              key: "terminal.backend",
              label: "Terminal backend",
              hint: "local, docker, ssh, and the other host backends",
            };
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void saveHostSetting(config, field.key, value)
          .then(() => {
            if (sectionId === "providers") setValue("");
            setNoteText("Saved and read back from the host.");
          })
          .catch((err: unknown) =>
            setNoteText(err instanceof HermesError ? err.message : "The host refused that change."),
          );
      }}
    >
      <Label htmlFor={field.key}>{field.label}</Label>
      <Input
        id={field.key}
        type={sectionId === "providers" ? "password" : "text"}
        value={value}
        autoComplete="off"
        placeholder={field.hint}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit">Save</Button>
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </form>
  );
}

function ModelAdminPanel({
  config,
  update,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
}) {
  const [model, setModel] = useState(config.model);
  const [provider, setProvider] = useState(config.provider);
  const [reasoning, setReasoning] = useState(config.reasoning as string);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(config.adminToken.trim());

  const run = async (action: "claim" | "read" | "save") => {
    setBusy(true);
    setNote(null);
    try {
      if (action === "claim") {
        update({ adminToken: await claimHostAdmin(config) });
        setNote("This phone is set up. You can change the host model here.");
        haptic("done");
        return;
      }
      const saved =
        action === "read"
          ? await readHostModel(config)
          : await saveHostModel(config, { model, provider, reasoning_effort: reasoning });
      setModel(saved.model);
      setProvider(saved.provider);
      setReasoning(saved.reasoning_effort || reasoning);
      update({ model: saved.model, provider: saved.provider });
      setNote(
        action === "read" ? "Read back from the host." : "Saved and read back from the host.",
      );
      haptic("done");
    } catch (err) {
      haptic("error");
      setNote(err instanceof HermesError ? err.message : "The host refused that change.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {ready ? (
        <p className="text-sm text-muted-foreground">
          This phone is set up. The key stays on the phone.
        </p>
      ) : (
        <Button type="button" disabled={busy} onClick={() => run("claim")}>
          Set up this phone
        </Button>
      )}
      <div className="space-y-2">
        <Label htmlFor="hostModel">Host model</Label>
        <Input id="hostModel" value={model} onChange={(event) => setModel(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hostProvider">Provider</Label>
        <Input
          id="hostProvider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hostReasoning">Reasoning</Label>
        <Input
          id="hostReasoning"
          value={reasoning}
          onChange={(event) => setReasoning(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !ready}
          onClick={() => run("read")}
        >
          Read
        </Button>
        <Button type="button" disabled={busy || !ready} onClick={() => run("save")}>
          Save
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
