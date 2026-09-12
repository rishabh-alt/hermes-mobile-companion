import { useQuery } from "@tanstack/react-query";
import { Check, Cpu, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { fetchModels } from "@/lib/hermes/client";
import { modelOptions } from "@/lib/hermes/rest";
import { haptic } from "@/lib/hermes/haptics";
import type { HermesConfig, ReasoningLevel } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: HermesConfig;
  active?: string;
  fallback?: string;
  onSelect: (model: string) => void;
  onSelectFallback: (model: string) => void;
  onUpdateConfig: (patch: Partial<HermesConfig>) => void;
}

interface Entry {
  id: string;
  label?: string | undefined;
}

const LEVELS: { value: ReasoningLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Prefers the gateway's own curated list, falling back to the raw model list. */
async function loadModels(config: HermesConfig): Promise<Entry[]> {
  try {
    const options = await modelOptions(config);
    const visible = options.filter((o) => !o.hidden && o.id);
    if (visible.length) {
      return visible.map((o) => ({ id: o.id, label: o.label ?? o.provider }));
    }
  } catch {
    // gateway may not expose /api/model/options
  }
  const models = await fetchModels(config);
  return models.map((m) => ({ id: m.id, label: m.owned_by }));
}

export function ModelSheet({
  open,
  onOpenChange,
  config,
  active,
  fallback,
  onSelect,
  onSelectFallback,
  onUpdateConfig,
}: Props) {
  const models = useQuery({
    queryKey: ["hermes-models", config.baseUrl, config.token],
    queryFn: () => loadModels(config),
    enabled: open && Boolean(config.baseUrl),
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[80dvh] translate-y-0 gap-3 overflow-y-auto rounded-b-none rounded-t-3xl border-border/70 p-5 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" /> Model &amp; route
          </DialogTitle>
        </DialogHeader>

        <section className="space-y-3 rounded-xl bg-secondary/40 p-3">
          <div>
            <p className="text-sm font-medium">Reasoning</p>
            <p className="text-[11px] text-muted-foreground">
              How much Hermes thinks before answering.
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => {
                    haptic("tap");
                    onUpdateConfig({ reasoning: level.value });
                  }}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-xs transition-colors",
                    config.reasoning === level.value
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-background/50",
                  )}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-muted-foreground" /> Fast mode
            </span>
            <Switch
              checked={config.fastMode}
              onCheckedChange={(checked) => {
                haptic("tap");
                onUpdateConfig({ fastMode: checked });
              }}
            />
          </label>
        </section>

        {models.isLoading && <p className="py-6 text-sm text-muted-foreground">Loading models…</p>}
        {models.isError && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-destructive">{(models.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => models.refetch()}>
              <RefreshCw /> Try again
            </Button>
          </div>
        )}

        <div className="space-y-1">
          {models.data?.map((model) => {
            const isActive = model.id === active;
            const isFallback = model.id === fallback;
            return (
              <div
                key={model.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-transparent px-3 py-2.5",
                  isActive ? "border-primary/40 bg-primary/10" : "bg-secondary/40",
                )}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    haptic("tap");
                    onSelect(model.id);
                    onOpenChange(false);
                  }}
                >
                  <p className="truncate text-sm font-medium">{model.id}</p>
                  {model.label && (
                    <p className="truncate text-[11px] text-muted-foreground">{model.label}</p>
                  )}
                </button>
                {isActive && <Check className="h-4 w-4 text-primary" />}
                <Button
                  size="sm"
                  variant={isFallback ? "secondary" : "ghost"}
                  className="shrink-0 text-[11px]"
                  onClick={() => {
                    haptic("tap");
                    onSelectFallback(isFallback ? "" : model.id);
                  }}
                >
                  {isFallback ? "Fallback" : "Set fallback"}
                </Button>
              </div>
            );
          })}
          {models.data?.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">The gateway listed no models.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
