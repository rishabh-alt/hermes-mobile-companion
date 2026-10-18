import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  readDashboardSection,
  saveDashboardValue,
  type DashboardField,
} from "@/lib/hermes/dashboard";

function shown(value: unknown) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return typeof value === "string" ? value : String(value);
}

export function DashboardFields({ baseUrl, sectionId }: { baseUrl: string; sectionId: string }) {
  const [fields, setFields] = useState<DashboardField[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readDashboardSection(baseUrl, sectionId)
      .then((rows) => {
        if (cancelled) return;
        setFields(rows);
        setDrafts(Object.fromEntries(rows.map((row) => [row.key, shown(row.value)])));
        if (rows.length === 0) setNote("This section has no editable fields on the host.");
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setNote(err instanceof Error ? err.message : "The dashboard refused this section.");
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, sectionId]);

  const save = async (field: DashboardField, value: unknown) => {
    setBusy(field.key);
    setNote(null);
    try {
      const { savedValue } = await saveDashboardValue(baseUrl, field.key, value);
      const effective = savedValue !== undefined ? savedValue : value;
      setFields((rows) =>
        rows.map((row) => (row.key === field.key ? { ...row, value: effective } : row)),
      );
      setDrafts((current) => ({ ...current, [field.key]: shown(effective) }));
      setNote(`Saved and verified ${field.key} on the host.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The dashboard refused that change.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5 rounded-xl border border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs font-medium">{field.key}</p>
            <span className="text-[11px] text-muted-foreground">{field.type}</span>
          </div>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          {field.type === "boolean" ? (
            <Switch
              checked={field.value === true}
              disabled={busy === field.key}
              onCheckedChange={(value) => {
                setFields((rows) =>
                  rows.map((row) => (row.key === field.key ? { ...row, value } : row)),
                );
                void save(field, value);
              }}
            />
          ) : field.type === "select" ? (
            <select
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={shown(field.value)}
              disabled={busy === field.key}
              onChange={(event) => {
                const value = event.target.value;
                setFields((rows) =>
                  rows.map((row) => (row.key === field.key ? { ...row, value } : row)),
                );
                void save(field, value);
              }}
            >
              {field.options.map((option) => (
                <option key={option || "empty"} value={option}>
                  {option || "empty"}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex gap-2">
              <Input
                value={drafts[field.key] ?? ""}
                placeholder={field.type === "array" ? "comma-separated values" : ""}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy === field.key}
                onClick={() => {
                  const raw = drafts[field.key] ?? "";
                  const parsed =
                    field.type === "number"
                      ? Number(raw)
                      : field.type === "array"
                        ? raw
                            .split(",")
                            .map((part) => part.trim())
                            .filter(Boolean)
                        : raw;
                  void save(field, parsed);
                }}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      ))}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
