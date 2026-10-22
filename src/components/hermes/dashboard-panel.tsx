import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dashboardUrlFromGateway,
  readDashboardModel,
  saveDashboardModel,
  signInToDashboard,
} from "@/lib/hermes/dashboard";
import { haptic } from "@/lib/hermes/haptics";
import type { HermesConfig } from "@/lib/hermes/types";

export function DashboardPanel({
  config,
  update,
  onSignedIn,
  showModelFields = true,
}: {
  config: HermesConfig;
  update: (patch: Partial<HermesConfig>) => void;
  onSignedIn?: (signedIn: boolean) => void;
  showModelFields?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveUrl =
    config.dashboardBaseUrl.trim() ||
    (() => {
      try {
        return dashboardUrlFromGateway(config.baseUrl);
      } catch {
        return "";
      }
    })();

  const run = async (action: "fill" | "sign-in" | "read" | "save") => {
    setBusy(true);
    setNote(null);
    try {
      if (action === "fill") {
        update({ dashboardBaseUrl: dashboardUrlFromGateway(config.baseUrl) });
        return;
      }
      const targetUrl = effectiveUrl;
      if (action === "sign-in") {
        if (!config.dashboardBaseUrl.trim() && targetUrl) {
          update({ dashboardBaseUrl: targetUrl });
        }
        await signInToDashboard({
          baseUrl: targetUrl,
          username: config.dashboardUsername,
          password,
        });
        setPassword("");
        const saved = await readDashboardModel(targetUrl);
        setProvider(saved.provider);
        setModel(saved.model);
        setNote("Signed in to dashboard. Host settings below are now unlocked.");
        onSignedIn?.(true);
        haptic("done");
        return;
      }
      const saved =
        action === "read"
          ? await readDashboardModel(targetUrl)
          : await saveDashboardModel(targetUrl, { provider, model });
      setProvider(saved.provider);
      setModel(saved.model);
      update({ provider: saved.provider, model: saved.model });
      setNote(
        action === "read"
          ? "Loaded current model from server."
          : "Saved default model on server for new chats.",
      );
      haptic("done");
    } catch (err) {
      haptic("error");
      setNote(err instanceof Error ? err.message : "Could not sign in to the dashboard.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Dashboard login</p>
          <p className="text-xs text-muted-foreground">
            Sign in once to unlock server settings, memory, and API keys below.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setShowCustomUrl((v) => !v)}
        >
          {showCustomUrl ? "Hide URL" : "Custom URL"}
        </Button>
      </div>
      {showCustomUrl && (
        <div className="space-y-2">
          <Label htmlFor="dashboardUrl" className="text-xs">
            Dashboard URL
          </Label>
          <div className="flex gap-2">
            <Input
              id="dashboardUrl"
              inputMode="url"
              autoCapitalize="none"
              placeholder="https://your-mac.example.ts.net/dashboard"
              value={config.dashboardBaseUrl}
              onChange={(event) => update({ dashboardBaseUrl: event.target.value })}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 text-xs"
              disabled={busy || !config.baseUrl.trim()}
              onClick={() => void run("fill")}
            >
              Auto-fill
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dashboardUser" className="text-xs">
            Username
          </Label>
          <Input
            id="dashboardUser"
            autoCapitalize="none"
            placeholder="admin"
            value={config.dashboardUsername}
            onChange={(event) => update({ dashboardUsername: event.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dashboardPassword" className="text-xs">
            Password
          </Label>
          <Input
            id="dashboardPassword"
            type="password"
            autoCapitalize="none"
            autoComplete="off"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !effectiveUrl}
        onClick={() => void run("sign-in")}
      >
        {busy ? "Signing in…" : "Sign in to dashboard"}
      </Button>
      {showModelFields && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dashboardProvider" className="text-xs">
                Default provider
              </Label>
              <Input
                id="dashboardProvider"
                autoCapitalize="none"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dashboardModel" className="text-xs">
                Default model
              </Label>
              <Input
                id="dashboardModel"
                autoCapitalize="none"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run("read")}
            >
              Load from server
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void run("save")}>
              Save default model
            </Button>
          </div>
        </div>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
