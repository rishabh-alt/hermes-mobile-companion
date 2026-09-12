import { Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SessionDrawer } from "@/components/hermes/session-drawer";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/hermes/haptics";
import { cn } from "@/lib/utils";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  activeSessionId?: string | undefined;
  children: ReactNode;
}

export function AppShell({ title, subtitle, right, activeSessionId, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* Persistent rail on large screens */}
      <aside className="hidden w-72 shrink-0 border-r border-sidebar-border lg:block">
        <SessionDrawer activeId={activeSessionId} />
      </aside>

      {/* Mobile drawer */}
      <div
        aria-hidden={!open}
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <button
          aria-label="Close menu"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-[85%] max-w-80 border-r border-sidebar-border shadow-2xl transition-transform duration-300 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <SessionDrawer activeId={activeSessionId} onNavigate={() => setOpen(false)} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top flex items-center gap-2 border-b border-border/70 bg-background/85 px-2 pb-2 backdrop-blur-xl">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            aria-label="Open chats"
            onClick={() => {
              haptic("tap");
              setOpen(true);
            }}
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-sm font-semibold tracking-tight">{title}</div>
            {subtitle && (
              <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
            )}
          </div>
          {right}
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
