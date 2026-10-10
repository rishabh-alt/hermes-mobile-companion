import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/hermes/app-shell";
import { Button } from "@/components/ui/button";
import { clearDebugLog, debugLines } from "@/lib/hermes/debug-log";

export const Route = createFileRoute("/debug")({
  component: DebugRoute,
});

function DebugRoute() {
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState(debugLines);
  const text = rows.join("\n");
  return (
    <AppShell title="Debug log" subtitle="Copy this back if something breaks">
      <div className="mx-auto w-full max-w-xl space-y-3 p-4">
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearDebugLog();
              setRows([]);
            }}
          >
            Clear
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/settings">Settings</Link>
          </Button>
        </div>
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 p-3 text-xs text-muted-foreground">
          {text || "No notes yet. Check host, then open a chat."}
        </pre>
      </div>
    </AppShell>
  );
}
