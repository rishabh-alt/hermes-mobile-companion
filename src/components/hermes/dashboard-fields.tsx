import { useEffect, useMemo, useState } from "react";
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
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFilterQuery("");
    setSelectedCategory("all");
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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const field of fields) {
      if (field.category) set.add(field.category);
    }
    return Array.from(set);
  }, [fields]);

  const filteredFields = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return fields.filter((field) => {
      if (selectedCategory !== "all" && field.category !== selectedCategory) return false;
      if (!q) return true;
      return `${field.key} ${field.description} ${field.category ?? ""}`.toLowerCase().includes(q);
    });
  }, [fields, filterQuery, selectedCategory]);

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
      {fields.length > 6 && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={`Filter ${fields.length} settings in this section…`}
              className="h-8 text-xs"
            />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {filteredFields.length}/{fields.length}
            </span>
          </div>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant={selectedCategory === "all" ? "default" : "outline"}
                className="h-7 px-2.5 text-[11px] whitespace-nowrap shrink-0"
                onClick={() => setSelectedCategory("all")}
              >
                All ({fields.length})
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat}
                  type="button"
                  size="sm"
                  variant={selectedCategory === cat ? "default" : "outline"}
                  className="h-7 px-2.5 font-mono text-[11px] whitespace-nowrap shrink-0"
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {filteredFields.map((field) => (
        <div key={field.key} className="space-y-1.5 rounded-xl border border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs font-medium">{field.key}</p>
            <span className="text-[11px] text-muted-foreground">
              {field.category ? `${field.category} · ${field.type}` : field.type}
            </span>
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
