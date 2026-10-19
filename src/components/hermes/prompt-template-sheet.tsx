import { useMemo, useState } from "react";
import { BookOpen, Plus, Search, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { haptic } from "@/lib/hermes/haptics";
import {
  addCustomPromptTemplate,
  getAllPromptTemplates,
  removeCustomPromptTemplate,
  type PromptTemplate,
} from "@/lib/hermes/prompt-templates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (promptText: string) => void;
  onSendNow?: ((promptText: string) => void) | undefined;
}

export function PromptTemplateSheet({ open, onOpenChange, onInsert, onSendNow }: Props) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [version, setVersion] = useState(0);

  const templates = useMemo(() => {
    void version;
    const all = getAllPromptTemplates();
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.prompt.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    );
  }, [search, version]);

  const categories = useMemo(() => {
    const order: PromptTemplate["category"][] = [
      "Custom",
      "Headless PC",
      "Logs & Health",
      "Code & Git",
    ];
    return order
      .map((category) => ({
        category,
        items: templates.filter((t) => t.category === category),
      }))
      .filter((group) => group.items.length > 0);
  }, [templates]);

  const handleSaveCustom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTitle.trim() || !newPrompt.trim()) return;
    addCustomPromptTemplate(newTitle, newPrompt);
    setNewTitle("");
    setNewPrompt("");
    setCreating(false);
    setVersion((v) => v + 1);
    haptic("done");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-h-[88dvh] translate-y-0 gap-3 overflow-y-auto rounded-b-none rounded-t-3xl border-border/70 p-5 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Prompt templates
            </DialogTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={() => setCreating((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? "Cancel" : "New"}
            </Button>
          </div>
        </DialogHeader>

        {creating && (
          <form
            onSubmit={handleSaveCustom}
            className="space-y-2 rounded-2xl border border-border/70 bg-secondary/35 p-3"
          >
            <p className="text-xs font-medium">Save custom prompt template</p>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Template title (e.g. Check GPU & Ollama)"
              className="h-8 text-xs"
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="Write the prompt Hermes should run…"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!newTitle.trim() || !newPrompt.trim()}>
                Save template
              </Button>
            </div>
          </form>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search headless commands or custom templates…"
            className="pl-9"
          />
        </div>

        <div className="space-y-4">
          {categories.map((group) => (
            <section key={group.category} className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.category}
              </p>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-2xl border border-border/70 bg-secondary/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">{item.title}</p>
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                          {item.prompt}
                        </p>
                      </div>
                      {item.custom && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${item.title}`}
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            removeCustomPromptTemplate(item.id);
                            setVersion((v) => v + 1);
                            haptic("tap");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2.5 text-xs"
                        onClick={() => {
                          haptic("tap");
                          onInsert(item.prompt);
                          onOpenChange(false);
                        }}
                      >
                        <BookOpen className="h-3 w-3" />
                        Insert in composer
                      </Button>
                      {onSendNow && (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 gap-1 px-2.5 text-xs"
                          onClick={() => {
                            haptic("send");
                            onSendNow(item.prompt);
                            onOpenChange(false);
                          }}
                        >
                          <Send className="h-3 w-3" />
                          Run now
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {categories.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No prompt templates match &ldquo;{search}&rdquo;.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
