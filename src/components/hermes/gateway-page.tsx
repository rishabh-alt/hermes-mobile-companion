import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string | undefined;
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  configured: boolean;
  empty?: boolean | undefined;
  emptyText?: string | undefined;
  onRefresh?: (() => void) | undefined;
  children: ReactNode;
}

export function GatewayPage({
  title,
  subtitle,
  loading,
  unavailable,
  error,
  configured,
  empty,
  emptyText,
  onRefresh,
  children,
}: Props) {
  const notice = !configured
    ? "Connect Hermes in Settings to use this screen."
    : unavailable
      ? "Not available on this gateway."
      : error
        ? error
        : loading
          ? "Loading…"
          : empty
            ? (emptyText ?? "Nothing here yet.")
            : null;

  return (
    <AppShell
      title={title}
      {...(subtitle ? { subtitle } : {})}
      right={
        onRefresh ? (
          <Button size="icon" variant="ghost" aria-label="Refresh" onClick={onRefresh}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        ) : undefined
      }
    >
      <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto px-4 pb-24 pt-3">
        {notice ? (
          <p
            className={cn(
              "py-10 text-center text-sm",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {notice}
          </p>
        ) : (
          children
        )}
      </div>
    </AppShell>
  );
}

export function Row({
  title,
  meta,
  right,
  onClick,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{title}</span>
        {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
      </div>
      {right}
    </>
  );
  return (
    <div className="border-b border-border/40 last:border-0">
      {onClick ? (
        <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left">
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 py-3">{body}</div>
      )}
      {children}
    </div>
  );
}
