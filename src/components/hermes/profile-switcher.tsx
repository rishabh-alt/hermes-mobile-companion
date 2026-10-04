import { Check, ChevronUp, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { haptic } from "@/lib/hermes/haptics";
import { prepareProfileSwitch } from "@/lib/hermes/profile-switch";
import { useHermesConfig } from "@/lib/hermes/config";
import { seedGatewaySessions } from "@/lib/hermes/sessions";
import { writeConfig } from "@/lib/hermes/config";
import { useGateway } from "@/lib/hermes/useGateway";
import { listProfiles } from "@/lib/hermes/rest";
import type { ProfileRoute } from "@/lib/hermes/profiles";
import { useNavigate } from "@tanstack/react-router";

export function ProfileSwitcher({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { config, configured } = useHermesConfig();
  const inventory = useGateway(listProfiles, ["profile-switcher"]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const active =
    inventory.data?.find((profile) => profile.name === config.activeProfile) ??
    inventory.data?.find((profile) => profile.isCurrent);

  const select = async (profile: ProfileRoute) => {
    if (profile.name === config.activeProfile || switching) return;
    setSwitching(profile.name);
    setError(null);
    try {
      const prepared = await prepareProfileSwitch(config, profile.name);
      writeConfig({ ...config, ...prepared.configPatch });
      seedGatewaySessions(prepared.sessions);
      haptic("done");
      setOpen(false);
      onNavigate?.();
      const nextSession = prepared.sessions[0];
      if (nextSession) {
        await navigate({
          to: "/c/$sessionId",
          params: { sessionId: nextSession.id },
          replace: true,
        });
      } else {
        await navigate({ to: "/", replace: true });
      }
    } catch (reason) {
      haptic("error");
      setError(reason instanceof Error ? reason.message : "Couldn't switch profile.");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Active profile: ${active?.label ?? config.activeProfile}`}
        disabled={!configured}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-50"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
          {(active?.label ?? config.activeProfile).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {active?.label ?? config.activeProfile}
          </span>
          {active?.model && (
            <span className="block truncate text-[10px] text-muted-foreground">{active.model}</span>
          )}
        </span>
        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch profile</DialogTitle>
            <DialogDescription>
              Profiles are supplied by your Hermes gateway. Switching reloads sessions and model
              settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {inventory.loading && (
              <p className="px-3 py-4 text-sm text-muted-foreground">Loading profiles…</p>
            )}
            {inventory.unavailable && (
              <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
                Profile switching is unavailable on this gateway.
              </p>
            )}
            {inventory.error && (
              <p role="alert" className="px-3 py-4 text-sm text-destructive">
                {inventory.error}
              </p>
            )}
            {inventory.data?.map((profile) => (
              <button
                key={profile.name}
                type="button"
                disabled={Boolean(switching)}
                onClick={() => void select(profile)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-accent disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{profile.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {profile.name}
                    {profile.model ? ` · ${profile.model}` : ""}
                  </span>
                </span>
                {profile.name === config.activeProfile && (
                  <Check className="h-4 w-4 text-primary" />
                )}
                {switching === profile.name && (
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => inventory.refresh()}
            disabled={inventory.loading}
            className="w-full"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh profiles
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
