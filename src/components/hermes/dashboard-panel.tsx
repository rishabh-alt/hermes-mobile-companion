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
}: {
  config: HermesConfig;
  update: (patch: Partial<HermesConfig>) => void;
}) {
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: "fill" | "sign-in" | "read" | "save") => {
    setBusy(true);
    setNote(null);
    try {
      if (action === "fill") {
        update({ dashboardBaseUrl: dashboardUrlFromGateway(config.baseUrl) });
        return;
      }
      if (action === "sign-in") {
        await signInToDashboard({
          baseUrl: config.dashboardBaseUrl,
          username: config.dashboardUsername,
          password,
        });
        setPassword("");
        const saved = await readDashboardModel(config.dashboardBaseUrl);
        setProvider(saved.provider);
        setModel(saved.model);
        setNote("Signed in. The password stays on this phone, not in the chat.");
        haptic("done");
        return;
      }
      const saved =
        action === "read"
          ? await readDashboardModel(config.dashboardBaseUrl)
          : await saveDashboardModel(config.dashboardBaseUrl, { provider, model });
      setProvider(saved.provider);
      setModel(saved.model);
      update({ provider: saved.provider, model: saved.model });
      setNote(
        action === "read"
          ? "Read from the Mac."
          : "Saved on the Mac. New chats use it. Restart Hermes yourself if a running chat does not.",
      );
      haptic("done");
    } catch (err) {
      haptic("error");
      setNote(err instanceof Error ? err.message : "The dashboard refused that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div>
        <p className="text-sm font-medium">Dashboard</p>
        <p className="text-xs text-muted-foreground">
          Settings and the main model live here, not on the chat address.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dashboardUrl">Dashboard address</Label>
        <Input
          id="dashboardUrl"
          inputMode="url"
          autoCapitalize="none"
          placeholder="https://your-mac.example.ts.net/dashboard"
          value={config.dashboardBaseUrl}
          onChange={(event) => update({ dashboardBaseUrl: event.target.value })}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !config.baseUrl.trim()}
          onClick={() => run("fill")}
        >
          Use the chat address plus /dashboard
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dashboardUser">Dashboard username</Label>
        <Input
          id="dashboardUser"
          autoCapitalize="none"
          value={config.dashboardUsername}
          onChange={(event) => update({ dashboardUsername: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dashboardPassword">Dashboard password</Label>
        <Input
          id="dashboardPassword"
          type="password"
          autoCapitalize="none"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <Button type="button" disabled={busy} onClick={() => run("sign-in")}>
        Sign in
      </Button>
      <div className="space-y-2">
        <Label htmlFor="dashboardProvider">Main provider</Label>
        <Input
          id="dashboardProvider"
          autoCapitalize="none"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dashboardModel">Main model</Label>
        <Input
          id="dashboardModel"
          autoCapitalize="none"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => run("read")}>
          Read
        </Button>
        <Button type="button" disabled={busy} onClick={() => run("save")}>
          Save main model
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
