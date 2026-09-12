import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { testConnection } from "@/lib/hermes/client";
import { useHermesConfig } from "@/lib/hermes/config";
import { haptic } from "@/lib/hermes/haptics";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Hermes companion" },
      {
        name: "description",
        content: "Connect this app to the Hermes gateway running on your Mac.",
      },
      { property: "og:title", content: "Settings · Hermes companion" },
      {
        property: "og:description",
        content: "Connect this app to the Hermes gateway running on your Mac.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { config, update } = useHermesConfig();
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const models = await testConnection(config);
      if (!config.model && models[0]?.id) update({ model: models[0].id });
      haptic("done");
      setResult(
        models[0]?.id
          ? `Connected — using ${models[0].id}. ${models.length} models available.`
          : `Connected — ${models.length} models available.`,
      );
    } catch (err) {
      haptic("error");
      setResult((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppShell title="Settings" subtitle="Connection to your Mac">
      <div className="mx-auto w-full max-w-xl space-y-6 overflow-y-auto p-4 pb-16">
        <div className="space-y-2">
          <Label htmlFor="baseUrl">Gateway address</Label>
          <Input
            id="baseUrl"
            inputMode="url"
            autoCapitalize="none"
            placeholder="https://your-mac.example.ts.net"
            value={config.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
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
            placeholder="optional"
            value={config.token}
            onChange={(e) => update({ token: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fallback">Fallback model</Label>
          <Input
            id="fallback"
            autoCapitalize="none"
            placeholder="used if the main model fails"
            value={config.fallbackModel}
            onChange={(e) => update({ fallbackModel: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
          <div>
            <p className="text-sm font-medium">Live agent channel</p>
            <p className="text-xs text-muted-foreground">
              Show thoughts and tool activity in realtime.
            </p>
          </div>
          <Switch checked={config.wsEnabled} onCheckedChange={(v) => update({ wsEnabled: v })} />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 p-3">
          <div>
            <p className="text-sm font-medium">Haptics</p>
            <p className="text-xs text-muted-foreground">Vibrate on send, finish and errors.</p>
          </div>
          <Switch checked={config.haptics} onCheckedChange={(v) => update({ haptics: v })} />
        </div>

        <Button onClick={test} disabled={testing || !config.baseUrl.trim()} className="w-full">
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {result && <p className="text-sm text-muted-foreground">{result}</p>}

        <Button asChild variant="outline" className="w-full">
          <Link to="/status">Connection &amp; usage</Link>
        </Button>
      </div>
    </AppShell>
  );
}
