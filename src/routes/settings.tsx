import { createFileRoute, Link } from "@tanstack/react-router";
import { QrCode } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { playCompletionChime } from "@/lib/hermes/chime";
import { useHermesConfig } from "@/lib/hermes/config";
import { haptic } from "@/lib/hermes/haptics";
import { claimHostAdmin, readHostModel, saveHostModel } from "@/lib/hermes/model-admin";
import { note } from "@/lib/hermes/debug-log";
import { DashboardPanel } from "@/components/hermes/dashboard-panel";
import { DashboardFields } from "@/components/hermes/dashboard-fields";
import {
  correctDashboardMemoryFact,
  dashboardUrlFromGateway,
  exchangePairingCode,
  parsePairingInput,
  readDashboardEnvKeys,
  readDashboardMemoryStatus,
  resetDashboardMemory,
  saveDashboardEnvKey,
  type DashboardEnvKeyStatus,
  type HostMemoryStatus,
  type MemoryFactItem,
} from "@/lib/hermes/dashboard";
import { encodeGatewayAddressQr } from "@/lib/hermes/qr";
import { nativeGet } from "@/lib/hermes/native-get";
import { getDashboardCookie, getHostToken, setHostToken } from "@/lib/hermes/secure-storage";
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
import type {
  DrawerDensityMode,
  FontScale,
  SavedHost,
  ThemeMode,
  ToolDetailMode,
} from "@/lib/hermes/types";

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

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
];

const TOOL_ENV_KEYS = ["FIRECRAWL_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "GITHUB_TOKEN"];

function SettingsRoute() {
  const { config, update } = useHermesConfig();
  const [query, setQuery] = useState("");
  const [openSection, setOpenSection] = useState<string>("connection");
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
  const [dashboardReady, setDashboardReady] = useState(false);

  useEffect(() => {
    void getDashboardCookie().then((cookie) => {
      if (cookie) setDashboardReady(true);
    });
  }, []);

  const sections = useMemo(
    () => searchSections(settingsSections(features, { dashboardSignedIn: dashboardReady }), query),
    [features, query, dashboardReady],
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

  const effectiveDashboardUrl = useMemo(() => {
    if (config.dashboardBaseUrl.trim()) return config.dashboardBaseUrl.trim();
    try {
      return dashboardUrlFromGateway(config.baseUrl);
    } catch {
      return "";
    }
  }, [config.baseUrl, config.dashboardBaseUrl]);

  return (
    <AppShell title="Settings" subtitle="Headless host console">
      <div className="mx-auto h-full min-h-0 w-full max-w-xl space-y-4 overflow-y-auto p-4 pb-16">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
        />
        <Accordion
          type="single"
          collapsible
          value={openSection}
          onValueChange={setOpenSection}
          className="rounded-xl border border-border/70 px-3"
        >
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
                  <div className="space-y-2 rounded-xl border border-border/70 p-3">
                    <p className="text-sm text-muted-foreground">{section.reason}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenSection("connection")}
                    >
                      Open Connection &amp; sign in
                    </Button>
                  </div>
                ) : (
                  <>
                    {section.id === "connection" && (
                      <ConnectionFields
                        config={config}
                        update={update}
                        checking={checking}
                        probes={probes}
                        onCheck={checkHost}
                        onSignedIn={setDashboardReady}
                      />
                    )}
                    {section.id === "appearance" && (
                      <AppearanceFields config={config} update={update} />
                    )}
                    {section.id === "notifications" && (
                      <NotificationsFields config={config} update={update} />
                    )}
                    {section.id === "about" && (
                      <AboutFields
                        config={config}
                        dashboardUrl={effectiveDashboardUrl}
                        dashboardReady={dashboardReady}
                        probes={probes}
                        checking={checking}
                        onCheck={checkHost}
                      />
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
                    {section.id === "model" && section.access === "write" && dashboardReady && (
                      <DashboardPanel
                        config={config}
                        update={update}
                        onSignedIn={setDashboardReady}
                      />
                    )}
                    {section.id === "model" && section.access === "write" && !dashboardReady && (
                      <ModelAdminPanel config={config} update={update} />
                    )}
                    {section.access === "write" &&
                      section.id !== "model" &&
                      dashboardReady &&
                      effectiveDashboardUrl && (
                        <div className="space-y-4">
                          {section.id === "memory" && (
                            <DashboardMemoryPanel baseUrl={effectiveDashboardUrl} />
                          )}
                          <DashboardFields baseUrl={effectiveDashboardUrl} sectionId={section.id} />
                          {(section.id === "providers" || section.id === "tools") && (
                            <DashboardEnvKeysPanel
                              baseUrl={effectiveDashboardUrl}
                              suggestedKeys={
                                section.id === "providers" ? PROVIDER_ENV_KEYS : TOOL_ENV_KEYS
                              }
                            />
                          )}
                        </div>
                      )}
                    {section.access === "write" &&
                      section.id !== "model" &&
                      (!dashboardReady || !effectiveDashboardUrl) && (
                        <div className="space-y-2 rounded-xl border border-border/70 p-3">
                          <p className="text-sm text-muted-foreground">
                            Sign in to the headless Dashboard in Connection to edit this section.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setOpenSection("connection")}
                          >
                            Open Connection &amp; sign in
                          </Button>
                        </div>
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

function SavedHostsCard({
  config,
  update,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
}) {
  const [labelDraft, setLabelDraft] = useState("");
  const [noteText, setNoteText] = useState<string | null>(null);
  const savedHosts = config.savedHosts ?? [];

  const saveCurrentHost = async () => {
    const cleanUrl = config.baseUrl.trim();
    if (!cleanUrl.startsWith("https://")) {
      setNoteText("Enter an https:// gateway address before saving a server.");
      return;
    }
    let hostLabel = labelDraft.trim();
    if (!hostLabel) {
      try {
        hostLabel = new URL(cleanUrl).hostname;
      } catch {
        hostLabel = "Headless server";
      }
    }
    const existing = savedHosts.find((h) => h.baseUrl === cleanUrl);
    const id = existing?.id ?? `host_${Date.now().toString(36)}`;
    const entry: SavedHost = {
      id,
      label: hostLabel,
      baseUrl: cleanUrl,
      dashboardBaseUrl: config.dashboardBaseUrl || dashboardUrlFromGateway(cleanUrl),
      activeProfile: config.activeProfile,
      profilePathPrefix: config.profilePathPrefix,
      provider: config.provider,
      model: config.model,
      dashboardUsername: config.dashboardUsername,
    };
    if (config.token.trim()) {
      await setHostToken(id, config.token.trim());
    }
    const nextList = existing
      ? savedHosts.map((h) => (h.id === id ? entry : h))
      : [...savedHosts, entry];
    update({ savedHosts: nextList });
    setLabelDraft("");
    setNoteText(`Saved "${hostLabel}" (token stored in secure storage).`);
  };

  const switchToHost = async (host: SavedHost) => {
    const storedToken = await getHostToken(host.id);
    update({
      baseUrl: host.baseUrl,
      dashboardBaseUrl: host.dashboardBaseUrl,
      activeProfile: host.activeProfile ?? "default",
      profilePathPrefix: host.profilePathPrefix ?? "",
      ...(host.provider !== undefined ? { provider: host.provider } : {}),
      ...(host.model !== undefined ? { model: host.model } : {}),
      ...(host.dashboardUsername !== undefined
        ? { dashboardUsername: host.dashboardUsername }
        : {}),
      ...(storedToken ? { token: storedToken } : {}),
    });
    setNoteText(`Switched to ${host.label}.`);
  };

  const removeHost = (hostId: string) => {
    update({ savedHosts: savedHosts.filter((h) => h.id !== hostId) });
    void setHostToken(hostId, "");
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Saved headless servers</p>
        <span className="text-[11px] text-muted-foreground">{savedHosts.length} saved</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          placeholder="Server label (e.g. Old PC Headless)"
          className="h-8 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-xs"
          onClick={() => void saveCurrentHost()}
        >
          Save current
        </Button>
      </div>
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
      {savedHosts.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {savedHosts.map((host) => {
            const isCurrent = config.baseUrl.trim() === host.baseUrl.trim();
            return (
              <li
                key={host.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 px-2.5 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{host.label}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {host.baseUrl}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={isCurrent ? "default" : "outline"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void switchToHost(host)}
                  >
                    {isCurrent ? "Active" : "Switch"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => removeHost(host.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddressQrCard({ baseUrl }: { baseUrl: string }) {
  const matrix = useMemo(() => {
    try {
      return encodeGatewayAddressQr(baseUrl);
    } catch {
      return null;
    }
  }, [baseUrl]);

  if (!matrix) return null;
  const size = matrix.length;

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border/70 bg-background/60 p-3 text-center">
      <div className="rounded-lg bg-white p-2.5">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-36 w-36"
          role="img"
          aria-label="Gateway HTTPS address QR code"
        >
          {matrix.flatMap((row, r) =>
            row.map((cell, c) =>
              cell ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null,
            ),
          )}
        </svg>
      </div>
      <p className="font-mono text-[11px] text-foreground">{baseUrl}</p>
      <p className="text-[11px] text-muted-foreground">
        Address-only QR — contains zero tokens or passwords.
      </p>
    </div>
  );
}

function ConnectionFields({
  config,
  update,
  checking,
  probes,
  onCheck,
  onSignedIn,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
  checking: boolean;
  probes: ProbeRow[];
  onCheck: () => void;
  onSignedIn: (signedIn: boolean) => void;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const [shareQrOpen, setShareQrOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [qrInput, setQrInput] = useState("");
  const [qrNote, setQrNote] = useState<string | null>(null);
  const qrFileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const applyScannedAddress = async (raw: string) => {
    try {
      const parsed = parsePairingInput(raw, config.baseUrl);
      let derivedDashboard = config.dashboardBaseUrl;
      try {
        derivedDashboard = dashboardUrlFromGateway(parsed.baseUrl);
      } catch {
        // Keep existing dashboardBaseUrl if custom path is used.
      }
      if (parsed.oneTimeCode) {
        setQrNote("Exchanging one-time pairing code with host…");
        const exchanged = await exchangePairingCode(parsed.baseUrl, parsed.oneTimeCode);
        update({
          baseUrl: parsed.baseUrl,
          dashboardBaseUrl: exchanged.dashboardBaseUrl || derivedDashboard,
          ...(exchanged.token ? { token: exchanged.token } : {}),
        });
        setQrNote(
          exchanged.token
            ? "Paired gateway address and token via one-time code."
            : "Gateway address saved. Enter your token and Dashboard login below.",
        );
      } else {
        update({ baseUrl: parsed.baseUrl, dashboardBaseUrl: derivedDashboard });
        setQrNote("Gateway HTTPS address applied. Enter your token and Dashboard login below.");
      }
      stopCamera();
      setQrInput("");
      setQrOpen(false);
      haptic("done");
    } catch (err) {
      haptic("error");
      setQrNote(err instanceof Error ? err.message : "Invalid gateway QR payload.");
    }
  };

  const startCamera = async () => {
    setQrNote(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setQrNote("Camera access is not available here. Use Scan QR photo or paste the URL.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = media;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => undefined);
      }
      const Detector = (
        globalThis as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        setQrNote("Live QR decoding requires BarcodeDetector. Capture a photo or paste below.");
        return;
      }
      const detector = new Detector({ formats: ["qr_code"] });
      const poll = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const first = found[0]?.rawValue;
          if (first) {
            await applyScannedAddress(first);
            return;
          }
        } catch {
          // Continue scanning frames while camera is open.
        }
        if (streamRef.current) window.setTimeout(() => void poll(), 350);
      };
      void poll();
    } catch {
      stopCamera();
      setQrNote("Camera permission was denied. Use Scan QR photo or paste the URL.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="baseUrl">Gateway address</Label>
          <div className="flex items-center gap-1">
            {config.baseUrl.trim().startsWith("https://") && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShareQrOpen((prev) => !prev)}
              >
                Share QR
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (qrOpen) stopCamera();
                setQrOpen((prev) => !prev);
                setQrNote(null);
              }}
            >
              <QrCode className="mr-1.5 h-3.5 w-3.5" />
              Address QR
            </Button>
          </div>
        </div>
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
      {shareQrOpen && config.baseUrl.trim() && <AddressQrCard baseUrl={config.baseUrl} />}
      {qrOpen && (
        <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
          <p className="text-xs font-medium">Address-only QR &amp; one-time code pairing</p>
          <p className="text-xs text-muted-foreground">
            Scan an HTTPS gateway QR or paste a short-lived one-time pairing code. Raw bearer tokens
            and passwords in QR payloads are rejected.
          </p>
          {cameraActive && (
            <div className="space-y-2">
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-44 w-full rounded-lg bg-black object-cover"
              />
              <Button type="button" size="sm" variant="outline" onClick={stopCamera}>
                Stop camera
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={qrInput}
              autoCapitalize="none"
              placeholder="https://your-mac.example.ts.net or one-time code"
              onChange={(event) => setQrInput(event.target.value)}
            />
            <Button type="button" size="sm" onClick={() => void applyScannedAddress(qrInput)}>
              Apply
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {!cameraActive && (
              <Button type="button" size="sm" variant="outline" onClick={() => void startCamera()}>
                Live camera scan
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => qrFileRef.current?.click()}
            >
              Scan QR photo
            </Button>
          </div>
          <input
            ref={qrFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const Detector = (
                globalThis as unknown as {
                  BarcodeDetector?: new (opts: { formats: string[] }) => {
                    detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
                  };
                }
              ).BarcodeDetector;
              if (!Detector) {
                setQrNote(
                  "This WebView does not expose BarcodeDetector. Paste the https URL above.",
                );
                return;
              }
              try {
                const bitmap = await createImageBitmap(file);
                const detector = new Detector({ formats: ["qr_code"] });
                const codes = await detector.detect(bitmap);
                const first = codes[0]?.rawValue;
                if (!first) {
                  setQrNote("No QR code found in that image.");
                  return;
                }
                await applyScannedAddress(first);
              } catch {
                setQrNote("Could not decode that QR image. Paste the https URL above.");
              }
            }}
          />
        </div>
      )}
      {qrNote && <p className="text-xs text-muted-foreground">{qrNote}</p>}
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
      <SavedHostsCard config={config} update={update} />
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
      <DashboardPanel config={config} update={update} onSignedIn={onSignedIn} />
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

function AppearanceFields({
  config,
  update,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
}) {
  const scale: FontScale = config.fontScale ?? "md";
  const theme: ThemeMode = config.theme ?? "dark";
  const toolDetail: ToolDetailMode = config.toolDetail ?? "compact";
  const drawerDensity: DrawerDensityMode = config.drawerDensity ?? "comfortable";

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Theme</p>
          <p className="text-xs text-muted-foreground">Choose dark console, daylight, or system.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "dark", label: "Dark" },
              { id: "light", label: "Light" },
              { id: "system", label: "System" },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={theme === item.id ? "default" : "outline"}
              onClick={() => update({ theme: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Haptics</p>
          <p className="text-xs text-muted-foreground">Vibrate on send, finish, and errors.</p>
        </div>
        <Switch checked={config.haptics} onCheckedChange={(value) => update({ haptics: value })} />
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Reasoning traces</p>
          <p className="text-xs text-muted-foreground">
            Display model thinking blocks inside chat turns.
          </p>
        </div>
        <Switch
          checked={config.showReasoning !== false}
          onCheckedChange={(value) => update({ showReasoning: value })}
        />
      </div>
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Tool detail</p>
          <p className="text-xs text-muted-foreground">
            Default state for tool call rows inside chat turns.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "compact", label: "Compact rows" },
              { id: "expanded", label: "Expanded output" },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={toolDetail === item.id ? "default" : "outline"}
              onClick={() => update({ toolDetail: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Drawer density</p>
          <p className="text-xs text-muted-foreground">
            Row spacing in the session navigation drawer.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "comfortable", label: "Comfortable" },
              { id: "compact", label: "Compact" },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={drawerDensity === item.id ? "default" : "outline"}
              onClick={() => update({ drawerDensity: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Text size</p>
          <p className="text-xs text-muted-foreground">Adjust reading density on this phone.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "sm", label: "Compact" },
              { id: "md", label: "Default" },
              { id: "lg", label: "Large" },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={scale === item.id ? "default" : "outline"}
              onClick={() => update({ fontScale: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotificationsFields({
  config,
  update,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
}) {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<string>(
    supported ? Notification.permission : "unsupported",
  );
  const prefs = config.notificationPrefs ?? {
    turnComplete: true,
    approvals: true,
    cronFailures: true,
  };

  const requestPermission = async () => {
    if (!supported) return;
    const next = await Notification.requestPermission();
    setPermission(next);
    if (next === "granted") {
      new Notification("Hermes alerts enabled", {
        body: "You will be notified when background turns or approvals arrive.",
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">System permission</p>
          <p className="text-xs text-muted-foreground">Status: {permission}</p>
        </div>
        {supported && permission !== "granted" && (
          <Button type="button" size="sm" variant="outline" onClick={requestPermission}>
            Allow alerts
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Turn finished</p>
          <p className="text-xs text-muted-foreground">
            Notify when Hermes completes a reply while the app is backgrounded.
          </p>
        </div>
        <Switch
          checked={prefs.turnComplete}
          onCheckedChange={(turnComplete) =>
            update({ notificationPrefs: { ...prefs, turnComplete } })
          }
        />
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Approvals &amp; questions</p>
          <p className="text-xs text-muted-foreground">
            Notify when Hermes pauses for command approval or clarification.
          </p>
        </div>
        <Switch
          checked={prefs.approvals}
          onCheckedChange={(approvals) => update({ notificationPrefs: { ...prefs, approvals } })}
        />
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Scheduled job failures</p>
          <p className="text-xs text-muted-foreground">
            Alert when a background cron job fails on your Hermes host.
          </p>
        </div>
        <Switch
          checked={prefs.cronFailures !== false}
          onCheckedChange={(cronFailures) =>
            update({ notificationPrefs: { ...prefs, cronFailures } })
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Completion sound</p>
          <p className="text-xs text-muted-foreground">
            Play a subtle two-tone chime when a turn finishes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              playCompletionChime(true);
            }}
          >
            Test
          </Button>
          <Switch
            checked={Boolean(prefs.completionChime)}
            onCheckedChange={(completionChime) =>
              update({ notificationPrefs: { ...prefs, completionChime } })
            }
          />
        </div>
      </div>
    </div>
  );
}

function AboutFields({
  config,
  dashboardUrl,
  dashboardReady,
  probes,
  checking,
  onCheck,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  dashboardUrl: string;
  dashboardReady: boolean;
  probes: ProbeRow[];
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-xl border border-border/70 p-3 text-xs">
        <p className="text-sm font-medium text-foreground">Hermes Companion</p>
        <p className="text-muted-foreground">
          Active profile: <span className="font-mono text-foreground">{config.activeProfile}</span>
        </p>
        <p className="text-muted-foreground">
          Gateway: <span className="font-mono text-foreground">{config.baseUrl || "not set"}</span>
        </p>
        <p className="text-muted-foreground">
          Dashboard:{" "}
          <span className="font-mono text-foreground">{dashboardUrl || "not configured"}</span> ·{" "}
          {dashboardReady ? "signed in" : "not signed in"}
        </p>
        <p className="text-muted-foreground">
          Transport: SSE fetch streaming · Native HTTP Dashboard
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={checking || !config.baseUrl.trim()}
        onClick={onCheck}
      >
        {checking ? "Checking host…" : "Verify host probes"}
      </Button>
      {probes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {probes.map((p) => `${p.label}: ${p.status}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function DashboardEnvKeysPanel({
  baseUrl,
  suggestedKeys,
}: {
  baseUrl: string;
  suggestedKeys: string[];
}) {
  const [statuses, setStatuses] = useState<DashboardEnvKeyStatus[]>([]);
  const [selectedKey, setSelectedKey] = useState(suggestedKeys[0] ?? "OPENAI_API_KEY");
  const [customKey, setCustomKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  const refreshStatus = () => {
    void readDashboardEnvKeys(baseUrl)
      .then(setStatuses)
      .catch(() => undefined);
  };

  useEffect(() => {
    refreshStatus();
  }, [baseUrl]);

  const targetKey = selectedKey === "__custom__" ? customKey.trim() : selectedKey;

  const submitKey = async (valueToWrite: string) => {
    if (!targetKey) return;
    setBusy(true);
    setNoteText(null);
    try {
      await saveDashboardEnvKey(baseUrl, targetKey, valueToWrite);
      setSecretValue("");
      refreshStatus();
      setNoteText(
        valueToWrite
          ? `Saved ${targetKey} to /api/env on the host.`
          : `Cleared ${targetKey} on the host.`,
      );
      haptic("done");
    } catch (err) {
      haptic("error");
      setNoteText(err instanceof Error ? err.message : "The dashboard refused that key update.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">Environment keys (/api/env)</p>
        <p className="text-xs text-muted-foreground">
          Write-only secret storage. Keys are sent straight to the host and never kept on this
          phone.
        </p>
      </div>
      {statuses.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {statuses
            .filter(
              (item) => suggestedKeys.includes(item.key) || /API_KEY|TOKEN|SECRET/i.test(item.key),
            )
            .slice(0, 12)
            .map((item) => (
              <span key={item.key} className="font-mono">
                {item.key}: {item.configured ? (item.masked ?? "set") : "unset"}
              </span>
            ))}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`env-select-${suggestedKeys[0]}`}>Key name</Label>
        <select
          id={`env-select-${suggestedKeys[0]}`}
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 font-mono text-xs"
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
        >
          {suggestedKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          <option value="__custom__">Custom key…</option>
        </select>
        {selectedKey === "__custom__" && (
          <Input
            value={customKey}
            autoCapitalize="characters"
            placeholder="CUSTOM_API_KEY"
            className="font-mono text-xs"
            onChange={(event) => setCustomKey(event.target.value)}
          />
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={secretValue}
          placeholder="Paste new secret key"
          onChange={(event) => setSecretValue(event.target.value)}
        />
        <Button
          type="button"
          disabled={busy || !targetKey || !secretValue.trim()}
          onClick={() => void submitKey(secretValue.trim())}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !targetKey}
          onClick={() => void submitKey("")}
        >
          Clear
        </Button>
      </div>
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}

function DashboardMemoryPanel({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<HostMemoryStatus | null>(null);
  const [facts, setFacts] = useState<MemoryFactItem[]>([]);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  const loadStatus = () => {
    void readDashboardMemoryStatus(baseUrl)
      .then((res) => {
        setStatus(res.status);
        setFacts(res.facts);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadStatus();
  }, [baseUrl]);

  if (!status) return null;

  const q = filter.trim().toLowerCase();
  const visibleFacts = facts.filter(
    (item) => !q || item.fact.toLowerCase().includes(q) || item.peer.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Host memory status</p>
          <p className="text-xs text-muted-foreground">
            Provider: <span className="font-mono text-foreground">{status.provider}</span> ·{" "}
            {status.status}
            {status.entryCount !== undefined ? ` · ${status.entryCount} entries` : ""}
          </p>
        </div>
        {status.canReset &&
          (!confirmReset ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
              Reset memory
            </Button>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setNoteText(null);
                  try {
                    await resetDashboardMemory(baseUrl);
                    setConfirmReset(false);
                    setNoteText("Host memory reset completed.");
                    loadStatus();
                  } catch (err) {
                    setNoteText(
                      err instanceof Error ? err.message : "The host refused to reset memory.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </Button>
            </div>
          ))}
      </div>

      {facts.length > 0 && (
        <div className="space-y-2 border-t border-border/50 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Memory inspector ({facts.length})</p>
          </div>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search peer facts…"
            className="h-8 text-xs"
          />
          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {visibleFacts.map((item) => (
              <div key={item.id} className="space-y-1.5 rounded-lg bg-secondary/40 p-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] text-muted-foreground">{item.peer}</p>
                    <p className="break-words text-foreground">{item.fact}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (editingId === item.id) {
                          setEditingId(null);
                          setEditDraft("");
                        } else {
                          setEditingId(item.id);
                          setEditDraft(item.fact);
                        }
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setNoteText(null);
                        try {
                          await correctDashboardMemoryFact(baseUrl, {
                            id: item.id,
                            peer: item.peer,
                            fact: item.fact,
                            action: "delete",
                          });
                          loadStatus();
                          setNoteText("Removed fact from host memory.");
                        } catch (err) {
                          setNoteText(
                            err instanceof Error ? err.message : "Could not remove that fact.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                {editingId === item.id && (
                  <form
                    className="flex gap-1.5 pt-1"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const nextFact = editDraft.trim();
                      if (!nextFact) return;
                      setBusy(true);
                      setNoteText(null);
                      try {
                        await correctDashboardMemoryFact(baseUrl, {
                          id: item.id,
                          peer: item.peer,
                          fact: nextFact,
                          action: "update",
                        });
                        setEditingId(null);
                        setEditDraft("");
                        loadStatus();
                        setNoteText("Updated fact on host.");
                      } catch (err) {
                        setNoteText(
                          err instanceof Error ? err.message : "Could not update that fact.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Input
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button type="submit" size="sm" disabled={busy}>
                      Save
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
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
    const response = await nativeGet(composeGatewayUrl(config, path), headers).catch(
      async (err: unknown) => {
        const message = err instanceof Error ? err.message : "native HTTP failed";
        note(`${label} native ${message}`);
        const fallback = await fetch(composeGatewayUrl(config, path), { headers });
        return { status: fallback.status, data: await fallback.text() };
      },
    );
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
    const message = err instanceof Error ? err.message : "The phone could not open the host.";
    note(`${label} transport ${message}`);
    return {
      id,
      label,
      status: interpretProbe({ ok: false, transport: true }),
      ...(isTimeout
        ? { detail: "Timed out after 10 s — the phone may not be able to reach this host." }
        : { detail: message.slice(0, 180) }),
    };
  }
}

function accessLabel(section: SettingsSection) {
  if (section.access === "phone") return "On this phone";
  if (section.access === "write") return "Can save on host";
  if (section.access === "read") return "Read from host";
  if (section.access === "blocked") {
    return section.reason?.startsWith("Signed in") ? "Signed in" : "Sign in to the dashboard";
  }
  return "Host has not opened this";
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
