import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import jsQR from "jsqr";
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
  configureAppLockPin,
  disableAppLock,
  enrollBiometricLock,
  isAppLockConfigured,
  lockAppNow,
  readAppLockRecord,
} from "@/lib/hermes/app-lock";
import {
  applyPhoneConfigBackup,
  createPhoneConfigBackup,
  resetPhoneConfigToDefaults,
} from "@/lib/hermes/config-backup";
import { evaluateHostCompatibility, useActiveHostRoute } from "@/lib/hermes/compat";
import { downloadTextFile } from "@/lib/hermes/export";
import {
  buildNtfySubscriptionUrls,
  sendNtfyNotification,
  syncNtfyWebhookToHost,
} from "@/lib/hermes/ntfy-inbox";
import {
  addDashboardVaultCredential,
  applyHostUpdate,
  checkHostUpdate,
  correctDashboardMemoryFact,
  dashboardUrlFromGateway,
  deleteArchivedSession,
  exchangePairingCode,
  parsePairingInput,
  readArchivedSessions,
  readDashboardEnvKeys,
  readDashboardMemoryStatus,
  readDashboardVaultCredentials,
  readPairedDevices,
  resetDashboardMemory,
  restoreArchivedSession,
  revokeDashboardVaultCredential,
  revokePairedDevice,
  saveDashboardEnvKey,
  type ArchivedSessionRow,
  type DashboardEnvKeyStatus,
  type GatewayBindInfo,
  type HostMemoryStatus,
  type HostUpdateInfo,
  type MemoryFactItem,
  type PairedDeviceRow,
  type VaultCredentialRow,
} from "@/lib/hermes/dashboard";
import { encodeGatewayAddressQr } from "@/lib/hermes/qr";
import { completeCompanionPairing, isCompanionPairingPayloadCandidate } from "@/lib/hermes/pairing";
import { nativeGet } from "@/lib/hermes/native-get";
import {
  getDashboardCookie,
  getHostDeviceCredential,
  getHostToken,
  setDeviceCredential,
  setHostDeviceCredential,
  setHostToken,
} from "@/lib/hermes/secure-storage";
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

  useEffect(() => {
    setProbes([]);
  }, [config.baseUrl, config.lanBaseUrl, config.dashboardBaseUrl]);

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
                        onClearProbes={() => setProbes([])}
                        onSignedIn={setDashboardReady}
                      />
                    )}
                    {section.id === "appearance" && (
                      <AppearanceFields config={config} update={update} />
                    )}
                    {section.id === "notifications" && (
                      <NotificationsFields
                        config={config}
                        update={update}
                        dashboardUrl={effectiveDashboardUrl}
                        dashboardReady={dashboardReady}
                      />
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
                          {section.id === "browser" && (
                            <DashboardCredentialVaultPanel baseUrl={effectiveDashboardUrl} />
                          )}
                          {section.id === "gateway" && (
                            <DashboardGatewayDevicesPanel baseUrl={effectiveDashboardUrl} />
                          )}
                          {section.id === "sessions" && (
                            <DashboardArchivedSessionsPanel baseUrl={effectiveDashboardUrl} />
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
      ...(config.lanBaseUrl ? { lanBaseUrl: config.lanBaseUrl } : {}),
      ...(config.lanDashboardBaseUrl ? { lanDashboardBaseUrl: config.lanDashboardBaseUrl } : {}),
      ...(config.autoRouteLan !== undefined ? { autoRouteLan: config.autoRouteLan } : {}),
      activeProfile: config.activeProfile,
      profilePathPrefix: config.profilePathPrefix,
      provider: config.provider,
      model: config.model,
      dashboardUsername: config.dashboardUsername,
      ...(config.deviceId ? { deviceId: config.deviceId } : {}),
      ...(config.gatewayTokenScope ? { gatewayTokenScope: config.gatewayTokenScope } : {}),
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
    const storedDeviceCred = await getHostDeviceCredential(host.id);
    if (storedDeviceCred) {
      await setDeviceCredential(storedDeviceCred);
    }
    update({
      baseUrl: host.baseUrl,
      dashboardBaseUrl: host.dashboardBaseUrl,
      lanBaseUrl: host.lanBaseUrl ?? "",
      lanDashboardBaseUrl: host.lanDashboardBaseUrl ?? "",
      autoRouteLan: host.autoRouteLan ?? false,
      activeProfile: host.activeProfile ?? "default",
      profilePathPrefix: host.profilePathPrefix ?? "",
      ...(host.provider !== undefined ? { provider: host.provider } : {}),
      ...(host.model !== undefined ? { model: host.model } : {}),
      ...(host.dashboardUsername !== undefined
        ? { dashboardUsername: host.dashboardUsername }
        : {}),
      ...(host.deviceId !== undefined ? { deviceId: host.deviceId } : {}),
      ...(host.gatewayTokenScope !== undefined
        ? { gatewayTokenScope: host.gatewayTokenScope }
        : {}),
      ...(storedToken ? { token: storedToken } : {}),
    });
    setNoteText(`Switched to ${host.label}.`);
  };

  const removeHost = (hostId: string) => {
    update({ savedHosts: savedHosts.filter((h) => h.id !== hostId) });
    void setHostToken(hostId, "");
    void setHostDeviceCredential(hostId, "");
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Saved servers</p>
        <span className="text-[11px] text-muted-foreground">{savedHosts.length} saved</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          placeholder="Name this server (e.g. Home Mac)"
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
          aria-label="Server HTTPS address QR code"
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
        Shares your server link only — never your token or password.
      </p>
    </div>
  );
}

function formatProbeStatus(status: ProbeStatus): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "auth":
      return "Needs token";
    case "transport":
      return "Unreachable";
    case "unsupported":
      return "Not supported";
    case "failed":
      return "Error";
  }
}

function ConnectionFields({
  config,
  update,
  checking,
  probes,
  onCheck,
  onClearProbes,
  onSignedIn,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
  checking: boolean;
  probes: ProbeRow[];
  onCheck: () => void;
  onClearProbes: () => void;
  onSignedIn: (signedIn: boolean) => void;
}) {
  const navigate = useNavigate();
  const [qrOpen, setQrOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(() => Boolean(config.baseUrl.trim()));
  const [shareQrOpen, setShareQrOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [deviceNameDraft, setDeviceNameDraft] = useState("Hermes Companion (Android)");
  const [qrInput, setQrInput] = useState("");
  const [qrNote, setQrNote] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { snapshot: routingProbe, probing: testingRoute, probeNow } = useActiveHostRoute(config);
  const qrFileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const decodeVideoFrameWithJsQr = (video: HTMLVideoElement): string | null => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    if (!canvasRef.current && typeof document !== "undefined") {
      canvasRef.current = document.createElement("canvas");
    }
    const canvas = canvasRef.current;
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
    return code?.data?.trim() || null;
  };

  const decodeBitmapWithJsQr = (bitmap: ImageBitmap): string | null => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const code = jsQR(imageData.data, bitmap.width, bitmap.height, {
      inversionAttempts: "attemptBoth",
    });
    return code?.data?.trim() || null;
  };

  const applyScannedAddress = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setQrNote("Scan a QR code or paste a pairing code first.");
      return;
    }
    setPairingBusy(true);
    setQrNote(null);
    try {
      if (isCompanionPairingPayloadCandidate(trimmed)) {
        stopCamera();
        const outcome = await completeCompanionPairing({
          rawPayload: trimmed,
          config,
          update,
          deviceName: deviceNameDraft,
          onStep: (step) => setQrNote(step),
        });
        onSignedIn(true);
        setQrInput("");
        setQrOpen(false);
        setPasteOpen(false);
        haptic("done");
        if (outcome.destination === "chat") {
          setQrNote(`Paired with ${outcome.hostName}. Opening chat…`);
          await navigate({ to: "/" });
        } else {
          setQrNote(
            `Paired with ${outcome.hostName}. ${outcome.compatibility.headline} — opening Server status.`,
          );
          await navigate({ to: "/status" });
        }
        return;
      }

      const parsed = parsePairingInput(trimmed, config.baseUrl);
      let derivedDashboard = config.dashboardBaseUrl;
      try {
        derivedDashboard = dashboardUrlFromGateway(parsed.baseUrl);
      } catch {
        // Keep existing dashboardBaseUrl if custom path is used.
      }
      if (parsed.oneTimeCode) {
        setQrNote("Connecting with one-time pairing code…");
        const exchanged = await exchangePairingCode(parsed.baseUrl, parsed.oneTimeCode);
        update({
          baseUrl: parsed.baseUrl,
          dashboardBaseUrl: exchanged.dashboardBaseUrl || derivedDashboard,
          ...(exchanged.token ? { token: exchanged.token } : {}),
        });
        setQrNote(
          exchanged.token
            ? "Connected! Server address and token were paired automatically."
            : "Server address saved. Enter your access token below.",
        );
      } else {
        update({ baseUrl: parsed.baseUrl, dashboardBaseUrl: derivedDashboard });
        setManualOpen(true);
        setQrNote("Server address saved. Enter your access token below.");
      }
      stopCamera();
      setQrInput("");
      setQrOpen(false);
      setPasteOpen(false);
      haptic("done");
    } catch (err) {
      haptic("error");
      setQrNote(err instanceof Error ? err.message : "Could not read that QR code.");
    } finally {
      setPairingBusy(false);
    }
  };

  const attachVideoElement = (node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current && node.srcObject !== streamRef.current) {
      node.srcObject = streamRef.current;
      void node.play().catch(() => undefined);
    }
  };

  const startCamera = async () => {
    setQrNote(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setQrNote("Camera isn't available in this browser. Choose a QR photo or paste the code.");
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
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

      const poll = async () => {
        if (!streamRef.current) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            let detectedValue: string | null = null;
            if (detector) {
              const found = await detector.detect(video).catch(() => []);
              detectedValue = found[0]?.rawValue?.trim() || null;
            }
            if (!detectedValue) {
              detectedValue = decodeVideoFrameWithJsQr(video);
            }
            if (detectedValue) {
              await applyScannedAddress(detectedValue);
              return;
            }
          } catch {
            // Continue scanning frames while camera is open.
          }
        }
        if (streamRef.current) window.setTimeout(() => void poll(), 260);
      };
      void poll();
    } catch {
      stopCamera();
      setQrNote(
        "Camera permission was blocked. Allow camera access to scan a pairing code from your Hermes dashboard, or paste the code below.",
      );
    }
  };

  return (
    <div className="space-y-3">
      {/* Primary Connect Flow: Scan QR Code */}
      <div className="space-y-2.5 rounded-xl border border-border/70 bg-secondary/20 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Pair with QR code</p>
            <p className="text-xs text-muted-foreground">
              Scan a pairing code from your Hermes dashboard (Companion tab or{" "}
              <span className="font-mono">hermes companion pair</span>).
            </p>
          </div>
          {config.baseUrl.trim().startsWith("https://") && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setShareQrOpen((prev) => !prev)}
            >
              Share QR
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-[44px] flex-1"
            disabled={pairingBusy}
            onClick={() => {
              if (qrOpen) {
                stopCamera();
                setQrOpen(false);
              } else {
                setQrOpen(true);
                setPasteOpen(false);
                void startCamera();
              }
              setQrNote(null);
            }}
          >
            <QrCode className="mr-1.5 h-4 w-4" />
            {qrOpen ? "Close scanner" : "Scan QR code"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={pairingBusy}
            onClick={() => {
              stopCamera();
              setQrOpen(false);
              setPasteOpen((prev) => !prev);
              setQrNote(null);
            }}
          >
            Paste pairing code instead
          </Button>
        </div>

        {qrOpen && (
          <div className="space-y-2.5 rounded-lg border border-border/70 bg-background/80 p-3">
            <div className="space-y-1">
              <Label htmlFor="deviceNameDraft" className="text-xs">
                Device name on host
              </Label>
              <Input
                id="deviceNameDraft"
                value={deviceNameDraft}
                onChange={(e) => setDeviceNameDraft(e.target.value)}
                placeholder="e.g. Rishab's S24 Ultra"
                className="h-8 text-xs"
              />
            </div>
            {cameraActive && (
              <div className="space-y-2">
                <video
                  ref={attachVideoElement}
                  muted
                  playsInline
                  autoPlay
                  className="h-48 w-full rounded-lg bg-black object-cover"
                />
                <Button type="button" size="sm" variant="outline" onClick={stopCamera}>
                  Stop camera
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!cameraActive && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void startCamera()}
                >
                  Open camera
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
                try {
                  const bitmap = await createImageBitmap(file);
                  let decoded = decodeBitmapWithJsQr(bitmap);
                  if (!decoded) {
                    const Detector = (
                      globalThis as unknown as {
                        BarcodeDetector?: new (opts: { formats: string[] }) => {
                          detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
                        };
                      }
                    ).BarcodeDetector;
                    if (Detector) {
                      const detector = new Detector({ formats: ["qr_code"] });
                      const codes = await detector.detect(bitmap);
                      decoded = codes[0]?.rawValue?.trim() || null;
                    }
                  }
                  if (!decoded) {
                    setQrNote("No QR code found in that image. Try Paste pairing code instead.");
                    return;
                  }
                  await applyScannedAddress(decoded);
                } catch {
                  setQrNote("Could not read that QR image. Use Paste pairing code instead.");
                }
              }}
            />
          </div>
        )}

        {pasteOpen && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-background/80 p-3">
            <Label htmlFor="pastePairingPayload" className="text-xs">
              Paste pairing payload JSON or link
            </Label>
            <div className="flex gap-2">
              <Input
                id="pastePairingPayload"
                value={qrInput}
                autoCapitalize="none"
                placeholder='{"v":1,"type":"hermes-companion-pair",...}'
                onChange={(event) => setQrInput(event.target.value)}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={pairingBusy || !qrInput.trim()}
                onClick={() => void applyScannedAddress(qrInput)}
              >
                {pairingBusy ? "Pairing…" : "Pair"}
              </Button>
            </div>
          </div>
        )}

        {qrNote && <p className="text-xs text-muted-foreground">{qrNote}</p>}

        {config.deviceId && (
          <div className="space-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <p>
              Paired device ID: <span className="font-mono text-foreground">{config.deviceId}</span>
              {" · "}
              Gateway auth:{" "}
              <span className="font-mono text-foreground">
                {config.gatewayTokenScope === "device"
                  ? "per-device credential"
                  : "shared host key"}
              </span>
            </p>
            {config.gatewayTokenScope !== "device" && (
              <p>
                Revoking this device in the dashboard immediately blocks Dashboard access and future
                logins; rotating GATEWAY_API_KEY on the host is required to invalidate shared
                Gateway chat tokens on single-key servers.
              </p>
            )}
          </div>
        )}
      </div>

      {shareQrOpen && config.baseUrl.trim() && <AddressQrCard baseUrl={config.baseUrl} />}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2 text-xs text-muted-foreground"
          onClick={() => setManualOpen((v) => !v)}
        >
          <span>Enter details manually</span>
          <span>{manualOpen ? "Hide" : "Show"}</span>
        </Button>
      </div>

      {manualOpen && (
        <div className="space-y-3 rounded-xl border border-border/70 p-3">
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Server address</Label>
            <Input
              id="baseUrl"
              inputMode="url"
              autoCapitalize="none"
              placeholder="https://your-mac.example.ts.net"
              value={config.baseUrl}
              onChange={(event) => {
                onClearProbes();
                update({ baseUrl: event.target.value });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Your Hermes HTTPS link (such as your Tailscale address).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">Access token</Label>
            <Input
              id="token"
              type="password"
              autoCapitalize="none"
              placeholder="Paste your server token (if required)"
              value={config.token}
              onChange={(event) => update({ token: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={onCheck}
              disabled={checking || !config.baseUrl.trim()}
              className="flex-1"
            >
              {checking ? "Testing connection…" : "Test connection"}
            </Button>
            <Button asChild variant="outline">
              <Link to="/status">Server status</Link>
            </Button>
          </div>
          {probes.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-border/60 bg-secondary/20 p-2.5 text-xs">
              {probes.map((probe) => (
                <li key={probe.id} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{probe.label}</span>
                  <span
                    className={
                      probe.status === "ok"
                        ? "text-emerald-400"
                        : probe.status === "auth" || probe.status === "transport"
                          ? "text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {formatProbeStatus(probe.status)}
                    {probe.detail ? ` · ${probe.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DashboardPanel
            config={config}
            update={update}
            onSignedIn={onSignedIn}
            showModelFields={false}
          />
        </div>
      )}

      <div className="pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2 text-xs text-muted-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>More connection options (saved servers, Wi-Fi shortcut, backup)</span>
          <span>{showAdvanced ? "Hide" : "Show"}</span>
        </Button>
      </div>

      {showAdvanced && (
        <div className="space-y-3 pt-1">
          <SavedHostsCard config={config} update={update} />
          <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Home Wi-Fi shortcut (LAN)</p>
                <p className="text-xs text-muted-foreground">
                  Automatically probes your local Wi-Fi link on app wake and network changes, and
                  falls back to your remote Tailscale link when away.
                </p>
              </div>
              <Switch
                checked={Boolean(config.autoRouteLan)}
                onCheckedChange={(autoRouteLan) => update({ autoRouteLan })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lanBaseUrl" className="text-xs">
                Local Wi-Fi HTTPS link (optional)
              </Label>
              <Input
                id="lanBaseUrl"
                inputMode="url"
                autoCapitalize="none"
                placeholder="https://mac.local:8443"
                value={config.lanBaseUrl ?? ""}
                onChange={(event) => {
                  onClearProbes();
                  update({ lanBaseUrl: event.target.value });
                }}
                className="h-8 text-xs"
              />
            </div>
            {(config.lanBaseUrl?.trim() || config.baseUrl.trim()) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={testingRoute}
                  onClick={async () => {
                    await probeNow();
                    haptic("done");
                  }}
                >
                  {testingRoute ? "Checking speed…" : "Re-probe route now"}
                </Button>
                {routingProbe && (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    Active: {routingProbe.route.toUpperCase()} · {routingProbe.latencyMs}ms
                  </span>
                )}
              </div>
            )}
            {routingProbe?.fallbackReason && (
              <p className="text-[11px] text-muted-foreground">{routingProbe.fallbackReason}</p>
            )}
          </div>
          <div className="space-y-2 rounded-xl border border-border/70 p-3">
            <Label htmlFor="fallback" className="text-xs">
              Backup model (optional)
            </Label>
            <Input
              id="fallback"
              autoCapitalize="none"
              placeholder="Used automatically if your main model is busy"
              value={config.fallbackModel}
              onChange={(event) => update({ fallbackModel: event.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
            <div>
              <p className="text-sm font-medium">Live thinking &amp; tool activity</p>
              <p className="text-xs text-muted-foreground">
                Stream step-by-step progress while Hermes works.
              </p>
            </div>
            <Switch
              checked={config.wsEnabled}
              onCheckedChange={(value) => update({ wsEnabled: value })}
            />
          </div>
          <PhoneConfigBackupCard config={config} />
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/debug">Open debug log</Link>
          </Button>
        </div>
      )}
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
          <p className="text-xs text-muted-foreground">Choose dark, light, or system theme.</p>
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
      <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-sm font-medium">Gap-awareness context</p>
          <p className="text-xs text-muted-foreground">
            Send elapsed time context when resuming a session after 1+ hour.
          </p>
        </div>
        <Switch
          checked={config.injectGapContext !== false}
          onCheckedChange={(value) => update({ injectGapContext: value })}
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
      <AppLockSettingsCard />
    </div>
  );
}

function NotificationsFields({
  config,
  update,
  dashboardUrl,
  dashboardReady,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
  dashboardUrl: string;
  dashboardReady: boolean;
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
      <NtfyPushSettingsCard
        config={config}
        update={update}
        dashboardUrl={dashboardUrl}
        dashboardReady={dashboardReady}
      />
    </div>
  );
}

function NtfyPushSettingsCard({
  config,
  update,
  dashboardUrl,
  dashboardReady,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
  update: ReturnType<typeof useHermesConfig>["update"];
  dashboardUrl: string;
  dashboardReady: boolean;
}) {
  const [testingPush, setTestingPush] = useState(false);
  const [syncingHost, setSyncingHost] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const subUrls = useMemo(
    () =>
      buildNtfySubscriptionUrls(config.ntfyServerUrl ?? "https://ntfy.sh", config.ntfyTopic ?? ""),
    [config.ntfyServerUrl, config.ntfyTopic],
  );

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">ntfy push relay &amp; host webhook</p>
          <p className="text-xs text-muted-foreground">
            Relays live watch alerts from any screen while the app is open. For alerts when the app
            is completely closed, sync the webhook to your Hermes host below or publish from host
            cron jobs.
          </p>
        </div>
        <Switch
          checked={Boolean(config.ntfyEnabled)}
          onCheckedChange={(ntfyEnabled) => update({ ntfyEnabled })}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ntfyServerUrl" className="text-xs">
            ntfy HTTPS server
          </Label>
          <Input
            id="ntfyServerUrl"
            inputMode="url"
            autoCapitalize="none"
            placeholder="https://ntfy.sh"
            value={config.ntfyServerUrl ?? ""}
            onChange={(e) => update({ ntfyServerUrl: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ntfyTopic" className="text-xs">
            Topic name
          </Label>
          <Input
            id="ntfyTopic"
            autoCapitalize="none"
            placeholder="hermes-operator-alerts"
            value={config.ntfyTopic ?? ""}
            onChange={(e) => update({ ntfyTopic: e.target.value })}
            className="h-8 font-mono text-xs"
          />
        </div>
      </div>
      {subUrls && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {subUrls.httpsUrl}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={testingPush}
                onClick={async () => {
                  setTestingPush(true);
                  setPushNote(null);
                  try {
                    await sendNtfyNotification({
                      serverUrl: config.ntfyServerUrl,
                      topic: config.ntfyTopic ?? "",
                      title: "Hermes Companion test push",
                      message: "Background approval and cron alerts are connected.",
                      priority: "high",
                    });
                    setPushNote("Sent test notification to ntfy topic.");
                    haptic("done");
                  } catch (err) {
                    haptic("error");
                    setPushNote(
                      err instanceof Error ? err.message : "Could not send test push to ntfy.",
                    );
                  } finally {
                    setTestingPush(false);
                  }
                }}
              >
                {testingPush ? "Sending…" : "Send test push"}
              </Button>
              {dashboardReady && dashboardUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  disabled={syncingHost}
                  onClick={async () => {
                    setSyncingHost(true);
                    setPushNote(null);
                    try {
                      const syncedUrl = await syncNtfyWebhookToHost({
                        dashboardBaseUrl: dashboardUrl,
                        serverUrl: config.ntfyServerUrl,
                        topic: config.ntfyTopic ?? "",
                        enabled: Boolean(config.ntfyEnabled),
                      });
                      setPushNote(`Synced webhook (${syncedUrl}) to host config.`);
                      haptic("done");
                    } catch (err) {
                      haptic("error");
                      setPushNote(
                        err instanceof Error ? err.message : "Could not sync webhook to host.",
                      );
                    } finally {
                      setSyncingHost(false);
                    }
                  }}
                >
                  {syncingHost ? "Syncing…" : "Sync webhook to host"}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(subUrls.httpsUrl);
                  setPushNote("Copied topic URL for the ntfy mobile app.");
                  haptic("tap");
                }}
              >
                Copy URL
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  const cmd = `curl -H "Title: Hermes host alert" -H "Priority: high" -d "Job completed on $(hostname)" ${subUrls.httpsUrl}`;
                  void navigator.clipboard?.writeText(cmd);
                  setPushNote("Copied host-side curl command for cron or shell hooks.");
                  haptic("tap");
                }}
              >
                Copy host curl
              </Button>
            </div>
          </div>
        </div>
      )}
      {pushNote && <p className="text-xs text-muted-foreground">{pushNote}</p>}
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
  const [updateInfo, setUpdateInfo] = useState<HostUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const compat = useMemo(
    () =>
      evaluateHostCompatibility({
        version: updateInfo?.currentVersion,
        configVersion: updateInfo?.configVersion,
        latestConfigVersion: updateInfo?.latestConfigVersion,
      }),
    [updateInfo],
  );

  const runUpdateCheck = async () => {
    if (!dashboardUrl) return;
    setCheckingUpdate(true);
    setUpdateNote(null);
    try {
      const info = await checkHostUpdate(dashboardUrl);
      setUpdateInfo(info);
      setUpdateNote(
        info.updateAvailable
          ? `Newer release available (${info.latestVersion ?? "update ready"}).`
          : "Headless host is running the latest reported release.",
      );
      haptic("done");
    } catch (err) {
      haptic("error");
      setUpdateNote(
        err instanceof Error ? err.message : "Could not check host version on the dashboard.",
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-xl border border-border/70 p-3 text-xs">
        <p className="text-sm font-medium text-foreground">Hermes Companion</p>
        <p className="text-muted-foreground">
          Active profile: <span className="font-mono text-foreground">{config.activeProfile}</span>
        </p>
        <p className="text-muted-foreground">
          Active model:{" "}
          <span className="font-mono text-foreground">{config.model || "not selected"}</span>
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
          Verified gateway range:{" "}
          <span className="font-mono tabular-nums text-foreground">{compat.supportedRange}</span>
        </p>
      </div>

      <div className="space-y-2.5 rounded-xl border border-border/70 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              Host Hermes release &amp; compatibility
            </p>
            <p className="text-muted-foreground tabular-nums">
              {updateInfo ? (
                <>
                  Version{" "}
                  <span className="font-mono text-foreground">{updateInfo.currentVersion}</span>
                  {updateInfo.commit ? ` (${updateInfo.commit.slice(0, 7)})` : ""}
                  {updateInfo.latestVersion ? ` → Latest: ${updateInfo.latestVersion}` : ""}
                </>
              ) : (
                "Check the headless host's Hermes version and available updates."
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checkingUpdate || !dashboardUrl}
            onClick={() => void runUpdateCheck()}
          >
            {checkingUpdate ? "Checking…" : "Check version"}
          </Button>
        </div>

        {updateInfo && (
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
            <p className="font-medium text-foreground">{compat.headline}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{compat.detail}</p>
          </div>
        )}

        {updateInfo?.releaseNotes && (
          <p className="rounded-lg bg-secondary/40 p-2 text-[11px] text-muted-foreground">
            {updateInfo.releaseNotes}
          </p>
        )}

        {updateInfo?.canApply && (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
            <span className="text-[11px] text-muted-foreground">
              {updateInfo.updateAvailable
                ? "Apply update and restart the headless gateway."
                : "Re-run host upgrade check & restart."}
            </span>
            {!confirmApply ? (
              <Button
                type="button"
                size="sm"
                variant={updateInfo.updateAvailable ? "default" : "outline"}
                onClick={() => setConfirmApply(true)}
              >
                Upgrade host
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  disabled={applyingUpdate}
                  onClick={async () => {
                    setApplyingUpdate(true);
                    setUpdateNote(null);
                    try {
                      const res = await applyHostUpdate(dashboardUrl);
                      setConfirmApply(false);
                      setUpdateNote(res.message);
                      haptic("done");
                    } catch (err) {
                      haptic("error");
                      setUpdateNote(
                        err instanceof Error
                          ? err.message
                          : "The host refused the upgrade request.",
                      );
                    } finally {
                      setApplyingUpdate(false);
                    }
                  }}
                >
                  {applyingUpdate ? "Applying…" : "Confirm upgrade"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmApply(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {!dashboardReady && (
          <p className="text-[11px] text-muted-foreground">
            Public /api/status version checks work immediately; sign in to the Dashboard in
            Connection to apply host upgrades.
          </p>
        )}
        {updateNote && <p className="text-xs text-muted-foreground">{updateNote}</p>}
      </div>

      <div className="space-y-2 rounded-xl border border-border/70 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Setup &amp; probe reference</p>
            <p className="text-muted-foreground">
              Which URL goes where, supported Hermes versions, and what host probes mean.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setGuideOpen((prev) => !prev)}
          >
            {guideOpen ? "Hide" : "Show guide"}
          </Button>
        </div>
        {guideOpen && (
          <div className="space-y-2 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">1. Gateway vs. Dashboard URL:</strong> The Gateway
              address points to your HTTPS Hermes API server (default host port{" "}
              <span className="font-mono tabular-nums">8642</span> via Tailscale Serve). The
              Dashboard address points to the web admin UI (default port{" "}
              <span className="font-mono tabular-nums">9119</span>).
            </p>
            <p>
              <strong className="text-foreground">2. LAN ↔ Tailscale routing:</strong> Add your home
              Wi-Fi HTTPS address in Connection to bypass tailnet relay hops when on the same LAN.
            </p>
            <p>
              <strong className="text-foreground">3. Probe statuses:</strong>{" "}
              <span className="font-mono text-foreground">ok</span> = endpoint verified;{" "}
              <span className="font-mono text-foreground">auth</span> = token or dashboard login
              needed; <span className="font-mono text-foreground">unsupported</span> = optional
              endpoint not enabled on this Hermes version;{" "}
              <span className="font-mono text-foreground">transport</span> = network/TLS
              unreachable.
            </p>
          </div>
        )}
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

function DashboardGatewayDevicesPanel({ baseUrl }: { baseUrl: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<PairedDeviceRow[]>([]);
  const [bindInfo, setBindInfo] = useState<GatewayBindInfo | undefined>(undefined);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readPairedDevices(baseUrl)
      .then((res) => {
        if (!active) return;
        setSupported(res.supported);
        setDevices(res.devices);
        setBindInfo(res.bindInfo);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  const reload = async () => {
    try {
      const res = await readPairedDevices(baseUrl);
      setSupported(res.supported);
      setDevices(res.devices);
      setBindInfo(res.bindInfo);
    } catch {
      // Keep current state
    }
  };

  if (supported === null) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      {bindInfo && (bindInfo.host || bindInfo.port || bindInfo.publicUrl) && (
        <div className="space-y-1 border-b border-border/50 pb-2.5 text-xs">
          <p className="font-medium text-foreground">Host listener &amp; reachability</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {bindInfo.host ?? "0.0.0.0"}
            {bindInfo.port !== undefined ? `:${bindInfo.port}` : ""}
            {bindInfo.publicUrl ? ` · ${bindInfo.publicUrl}` : ""}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Paired devices</p>
          <p className="text-xs text-muted-foreground">
            {!supported
              ? "This host does not expose a paired-device inventory endpoint yet."
              : devices.length === 0
                ? "No paired client tokens reported by the host."
                : `${devices.length} paired ${devices.length === 1 ? "device" : "devices"}`}
          </p>
        </div>
        {supported && (
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Refresh
          </Button>
        )}
      </div>

      {supported && devices.length > 0 && (
        <ul className="space-y-2">
          {devices.map((dev) => (
            <li
              key={dev.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {dev.name} {dev.current ? "(this phone)" : ""}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[dev.platform, dev.lastSeen].filter(Boolean).join(" · ") || dev.id}
                </p>
              </div>
              {confirmRevokeId !== dev.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => setConfirmRevokeId(dev.id)}
                >
                  Revoke
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setNoteText(null);
                      try {
                        await revokePairedDevice(baseUrl, dev.id);
                        setConfirmRevokeId(null);
                        setNoteText(`Revoked ${dev.name}.`);
                        await reload();
                        haptic("done");
                      } catch (err) {
                        haptic("error");
                        setNoteText(
                          err instanceof Error ? err.message : "Could not revoke that device.",
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
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setConfirmRevokeId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}

function DashboardArchivedSessionsPanel({ baseUrl }: { baseUrl: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<ArchivedSessionRow[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readArchivedSessions(baseUrl)
      .then((res) => {
        if (!active) return;
        setSupported(res.supported);
        setSessions(res.sessions);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  const reload = async () => {
    try {
      const res = await readArchivedSessions(baseUrl);
      setSupported(res.supported);
      setSessions(res.sessions);
    } catch {
      // Keep current state
    }
  };

  if (supported === null) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Archived chats on host</p>
          <p className="text-xs text-muted-foreground">
            {!supported
              ? "This host does not expose archived session listing yet."
              : sessions.length === 0
                ? "No archived conversations on the host."
                : `${sessions.length} archived ${sessions.length === 1 ? "chat" : "chats"}`}
          </p>
        </div>
        {supported && (
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Refresh
          </Button>
        )}
      </div>

      {supported && sessions.length > 0 && (
        <ul className="max-h-60 space-y-2 overflow-y-auto pr-1">
          {sessions.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {[
                    item.messageCount !== undefined ? `${item.messageCount} msgs` : null,
                    item.updatedAt,
                  ]
                    .filter(Boolean)
                    .join(" · ") || item.id}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setNoteText(null);
                    try {
                      await restoreArchivedSession(baseUrl, item.id);
                      setNoteText(`Restored "${item.title}".`);
                      await reload();
                      haptic("done");
                    } catch (err) {
                      haptic("error");
                      setNoteText(
                        err instanceof Error ? err.message : "Could not restore that session.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restore
                </Button>
                {confirmDeleteId !== item.id ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(item.id)}
                  >
                    Delete
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setNoteText(null);
                      try {
                        await deleteArchivedSession(baseUrl, item.id);
                        setConfirmDeleteId(null);
                        setNoteText(`Deleted "${item.title}" from host.`);
                        await reload();
                        haptic("done");
                      } catch (err) {
                        haptic("error");
                        setNoteText(
                          err instanceof Error ? err.message : "Could not delete that session.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirm
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}

function PhoneConfigBackupCard({
  config,
}: {
  config: ReturnType<typeof useHermesConfig>["config"];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
      <div>
        <p className="text-xs font-medium">Phone config backup &amp; reset</p>
        <p className="text-[11px] text-muted-foreground">
          Exports non-secret phone settings and custom prompt templates. Tokens and passwords are
          never included.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => {
            const json = createPhoneConfigBackup(config);
            downloadTextFile("hermes-phone-config.json", json, "application/json;charset=utf-8");
            setNoteText("Exported hermes-phone-config.json (zero tokens included).");
            haptic("done");
          }}
        >
          Export config
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          Import config
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            try {
              const raw = await file.text();
              applyPhoneConfigBackup(raw);
              setNoteText("Imported phone settings from backup.");
              haptic("done");
            } catch (err) {
              haptic("error");
              setNoteText(err instanceof Error ? err.message : "Could not import backup file.");
            }
          }}
        />
        {!confirmReset ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmReset(true)}
          >
            Reset to defaults
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 text-xs"
              onClick={() => {
                resetPhoneConfigToDefaults();
                setConfirmReset(false);
                setNoteText("Reset phone settings to defaults.");
                haptic("done");
              }}
            >
              Confirm reset
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}

function AppLockSettingsCard() {
  const [enabled, setEnabled] = useState(() => isAppLockConfigured());
  const [pinDraft, setPinDraft] = useState("");
  const [noteText, setNoteText] = useState<string | null>(null);
  const record = readAppLockRecord();

  useEffect(() => {
    const sync = () => setEnabled(isAppLockConfigured());
    window.addEventListener("hermes-applock-change", sync);
    return () => window.removeEventListener("hermes-applock-change", sync);
  }, []);

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">App PIN &amp; biometric gate</p>
          <p className="text-xs text-muted-foreground">
            Require a 4–8 digit PIN (or device passkey/biometrics) when opening this console.
          </p>
        </div>
        {enabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            onClick={() => {
              lockAppNow();
              haptic("tap");
            }}
          >
            Lock now
          </Button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            configureAppLockPin(pinDraft);
            setPinDraft("");
            setEnabled(true);
            setNoteText("App PIN lock enabled (hashed locally).");
            haptic("done");
          } catch (err) {
            haptic("error");
            setNoteText(err instanceof Error ? err.message : "Invalid PIN.");
          }
        }}
      >
        <Input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pinDraft}
          onChange={(e) => setPinDraft(e.target.value)}
          placeholder={enabled ? "Change 4–8 digit PIN" : "Set 4–8 digit PIN"}
          className="h-8 font-mono text-xs"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0 text-xs">
          {enabled ? "Update PIN" : "Enable PIN"}
        </Button>
      </form>

      {enabled && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={async () => {
              setNoteText(null);
              try {
                const ok = await enrollBiometricLock();
                if (ok) {
                  setNoteText("Device biometric unlock enabled.");
                  haptic("done");
                }
              } catch (err) {
                haptic("error");
                setNoteText(
                  err instanceof Error ? err.message : "Could not enroll biometric unlock.",
                );
              }
            }}
          >
            {record?.biometricCredentialId ? "Re-enroll biometrics" : "Enable biometric unlock"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => {
              disableAppLock();
              setEnabled(false);
              setNoteText("App lock disabled.");
              haptic("tap");
            }}
          >
            Disable lock
          </Button>
        </div>
      )}
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}

function DashboardCredentialVaultPanel({ baseUrl }: { baseUrl: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
  const [credentials, setCredentials] = useState<VaultCredentialRow[]>([]);
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readDashboardVaultCredentials(baseUrl)
      .then((res) => {
        if (!active) return;
        setSupported(res.supported);
        setLocked(Boolean(res.locked));
        setCredentials(res.credentials);
      })
      .catch(() => {
        if (active) setSupported(false);
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  const reload = async () => {
    try {
      const res = await readDashboardVaultCredentials(baseUrl);
      setSupported(res.supported);
      setLocked(Boolean(res.locked));
      setCredentials(res.credentials);
    } catch {
      // Keep current state
    }
  };

  if (supported === null) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Host credential vault</p>
          <p className="text-xs text-muted-foreground">
            {!supported
              ? "This host does not expose /api/vault/credentials yet."
              : locked
                ? "Vault is locked on the host. Master unlock stays on the host."
                : `${credentials.length} stored ${credentials.length === 1 ? "credential" : "credentials"} (write-only secrets)`}
          </p>
        </div>
        {supported && (
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Refresh
          </Button>
        )}
      </div>

      {supported && !locked && (
        <form
          className="space-y-2 border-t border-border/50 pt-2.5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!domain.trim() || !secret) return;
            setBusy(true);
            setNoteText(null);
            try {
              await addDashboardVaultCredential(baseUrl, { domain, username, secret });
              setDomain("");
              setUsername("");
              setSecret("");
              setNoteText("Saved credential to host vault. Secret was not kept on this phone.");
              await reload();
              haptic("done");
            } catch (err) {
              haptic("error");
              setNoteText(
                err instanceof Error ? err.message : "Could not save credential to host vault.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-xs font-medium">Add credential (write-only)</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain / service (e.g. github.com)"
              className="h-8 text-xs"
            />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username / account"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Password or token (sent to host vault only)"
              className="h-8 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={busy || !domain.trim() || !secret}
            >
              Add
            </Button>
          </div>
        </form>
      )}

      {supported && credentials.length > 0 && (
        <ul className="max-h-52 space-y-1.5 overflow-y-auto pt-1">
          {credentials.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{item.domain}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {[item.username || "default", item.updatedAt].filter(Boolean).join(" · ")}
                </p>
              </div>
              {confirmRevokeId !== item.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmRevokeId(item.id)}
                >
                  Revoke
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-[11px]"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setNoteText(null);
                      try {
                        await revokeDashboardVaultCredential(baseUrl, item.id);
                        setConfirmRevokeId(null);
                        setNoteText(`Revoked ${item.domain} from host vault.`);
                        await reload();
                        haptic("done");
                      } catch (err) {
                        haptic("error");
                        setNoteText(
                          err instanceof Error ? err.message : "Could not revoke that credential.",
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
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setConfirmRevokeId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {noteText && <p className="text-xs text-muted-foreground">{noteText}</p>}
    </div>
  );
}
