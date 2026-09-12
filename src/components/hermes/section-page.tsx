import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import { useHermesConfig } from "@/lib/hermes/config";

interface Props {
  title: string;
  icon: LucideIcon;
  blurb: string;
  children?: ReactNode;
}

/** Simple section screen for Hermes areas the gateway may not expose yet. */
export function SectionPage({ title, icon: Icon, blurb, children }: Props) {
  const { configured } = useHermesConfig();
  return (
    <AppShell title={title}>
      <div className="mx-auto w-full max-w-xl overflow-y-auto p-6 pb-20">
        {children ?? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Icon className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-lg font-medium">{title}</h1>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {configured ? blurb : "Connect Hermes in Settings to use this area."}
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
