import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Cpu, RefreshCw, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchModelOptions } from "@/lib/hermes/rest";
import { visibleProviderModels } from "@/lib/hermes/route-picker";
import { haptic } from "@/lib/hermes/haptics";
import type { HermesConfig, ReasoningLevel } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

interface Selection {
  provider: string;
  model: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: HermesConfig;
  active?: string;
  activeProvider?: string;
  onSelect: (selection: Selection) => Promise<void>;
  onUpdateConfig: (patch: Partial<HermesConfig>) => void;
}

const LEVELS: { value: ReasoningLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function ModelSheet({
  open,
  onOpenChange,
  config,
  active,
  activeProvider,
  onSelect,
  onUpdateConfig,
}: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [lockingModel, setLockingModel] = useState<string | null>(null);
  const models = useQuery({
    queryKey: ["hermes-model-options", config.baseUrl, config.token],
    queryFn: () => fetchModelOptions(config),
    enabled: open && Boolean(config.baseUrl),
    retry: false,
  });

  const providers = useMemo(
    () => (models.data ? visibleProviderModels(models.data, search) : []),
    [models.data, search],
  );

  const selectedProvider = activeProvider || models.data?.activeProvider || "";
  const selectedModel = active || models.data?.activeModel || "";
  const activeCapabilities = providers.find((provider) => provider.slug === selectedProvider)
    ?.capabilities[selectedModel];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[88dvh] translate-y-0 gap-3 overflow-y-auto rounded-b-none rounded-t-3xl border-border/70 p-5 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" /> Model &amp; route
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search models or providers"
            className="pl-9"
          />
        </div>

        <section className="space-y-3 rounded-xl bg-secondary/40 p-3">
          <div>
            <p className="text-sm font-medium">Reasoning</p>
            <p className="text-[11px] text-muted-foreground">
              How much Hermes thinks before answering.
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {LEVELS.map((level) => {
                const unavailable =
                  level.value === "off" && activeCapabilities?.canDisableReasoning === false;
                return (
                  <button
                    key={level.value}
                    disabled={unavailable}
                    title={unavailable ? "This model cannot disable reasoning." : undefined}
                    onClick={() => {
                      haptic("tap");
                      onUpdateConfig({ reasoning: level.value });
                    }}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      config.reasoning === level.value
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:bg-background/50",
                    )}
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-muted-foreground" /> Fast mode
            </span>
            <Switch
              disabled={activeCapabilities?.fast === false}
              checked={config.fastMode}
              onCheckedChange={(checked) => {
                haptic("tap");
                onUpdateConfig({ fastMode: checked });
              }}
            />
          </label>
        </section>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {models.data
              ? `${providers.length} connected provider${providers.length === 1 ? "" : "s"}`
              : ""}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void models.refetch()}
            disabled={models.isFetching}
          >
            <RefreshCw className={cn(models.isFetching && "animate-spin")} /> Refresh models
          </Button>
        </div>

        {models.isLoading && <p className="py-6 text-sm text-muted-foreground">Loading models…</p>}
        {models.isError && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-destructive">{(models.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void models.refetch()}>
              <RefreshCw /> Try again
            </Button>
          </div>
        )}

        {selectionError && <p className="text-sm text-destructive">{selectionError}</p>}

        <div className="space-y-2">
          {providers.map((provider) => {
            const isOpen =
              expanded === provider.slug || providers.length === 1 || Boolean(search.trim());
            return (
              <section
                key={provider.slug}
                className="overflow-hidden rounded-xl border border-border/70"
              >
                <button
                  className="flex w-full items-center gap-2 px-3 py-3 text-left"
                  onClick={() => setExpanded(isOpen ? null : provider.slug)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{provider.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {provider.models.length} models
                      {provider.isCurrent ? " · current provider" : ""}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                  />
                </button>
                {isOpen && (
                  <div className="space-y-1 border-t border-border/70 p-2">
                    {provider.models
                      .filter(
                        (model) =>
                          !search.trim() ||
                          provider.name.toLowerCase().includes(search.toLowerCase()) ||
                          model.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((model) => {
                        const isActive =
                          provider.slug === selectedProvider && model === selectedModel;
                        const unavailable = provider.unavailableModels.includes(model);
                        return (
                          <button
                            key={model}
                            disabled={unavailable || lockingModel !== null}
                            onClick={() => {
                              haptic("tap");
                              setSelectionError(null);
                              setLockingModel(`${provider.slug}/${model}`);
                              void onSelect({ provider: provider.slug, model })
                                .then(() => onOpenChange(false))
                                .catch((error: unknown) => {
                                  setSelectionError(
                                    error instanceof Error
                                      ? error.message
                                      : "Hermes could not apply that route.",
                                  );
                                })
                                .finally(() => setLockingModel(null));
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40",
                              isActive ? "bg-primary/10 text-foreground" : "hover:bg-secondary/60",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{model}</span>
                            {isActive && <Check className="h-4 w-4 text-primary" />}
                            {unavailable && (
                              <span className="text-[10px] text-muted-foreground">Unavailable</span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </section>
            );
          })}
          {models.data && providers.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">
              {search.trim()
                ? "No connected models match that search."
                : "No configured providers exposed models."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
