import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { GatewayPage } from "@/components/hermes/gateway-page";
import { Button } from "@/components/ui/button";
import { useHermesConfig } from "@/lib/hermes/config";
import { commentOnCard, moveCard } from "@/lib/hermes/kanban-actions";
import { useGateway } from "@/lib/hermes/useGateway";
import { kanbanBoard } from "@/lib/hermes/rest";
import { cn } from "@/lib/utils";

const title = "Kanban · Hermes companion";
const description = "The Hermes Kanban board with your agent's tasks.";

export const Route = createFileRoute("/kanban")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KanbanRoute,
});

interface Card {
  id?: string;
  title?: string;
  text?: string;
  description?: string;
  status?: string;
  priority?: string;
  attention?: boolean;
  blocked?: boolean;
  session_id?: string;
  worker_session_id?: string;
}
interface Column {
  id?: string;
  name?: string;
  title?: string;
  cards?: Card[];
  items?: Card[];
}

function cardNeedsAttention(card: Card): boolean {
  if (card.attention === true || card.blocked === true) return true;
  const status = (card.status ?? "").toLowerCase();
  const priority = (card.priority ?? "").toLowerCase();
  return (
    /blocked|attention|review|waiting|error|failed/.test(status) ||
    /urgent|high|critical/.test(priority)
  );
}

function columnsOf(board: Record<string, unknown> | null): Column[] {
  if (!board) return [];
  for (const key of ["columns", "lanes", "board", "data"]) {
    const value = board[key];
    if (Array.isArray(value)) return value as Column[];
    if (
      value &&
      typeof value === "object" &&
      Array.isArray((value as Record<string, unknown>)["columns"])
    ) {
      return (value as Record<string, unknown>)["columns"] as Column[];
    }
  }
  return [];
}

function KanbanRoute() {
  const { config } = useHermesConfig();
  const board = useGateway(kanbanBoard, []);
  const columns = columnsOf(board.data);
  const [note, setNote] = useState<string | null>(null);
  const [commentingCardId, setCommentingCardId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  return (
    <GatewayPage
      title="Kanban"
      loading={board.loading}
      unavailable={board.unavailable}
      error={board.error}
      configured={board.configured}
      empty={!board.loading && !!board.data && columns.length === 0}
      emptyText="This board is empty."
      onRefresh={board.refresh}
    >
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4">
        {columns.map((column, i) => {
          const rawCards = column.cards ?? column.items ?? [];
          const cards = [...rawCards].sort(
            (a, b) => Number(cardNeedsAttention(b)) - Number(cardNeedsAttention(a)),
          );
          return (
            <div key={column.id ?? i} className="w-64 shrink-0">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                {column.name ?? column.title ?? `Column ${i + 1}`}
                <span className="ml-1 tabular-nums">{cards.length}</span>
              </p>
              <div className="space-y-2">
                {cards.map((card, j) => {
                  const needsAttention = cardNeedsAttention(card);
                  const workerSessionId = card.worker_session_id ?? card.session_id;
                  return (
                    <div
                      key={card.id ?? j}
                      className={cn(
                        "rounded-lg bg-secondary/40 p-3",
                        needsAttention && "border border-primary/40",
                      )}
                    >
                      {needsAttention && (
                        <p className="mb-1 text-[11px] font-medium text-primary">
                          Needs attention{card.status ? ` · ${card.status}` : ""}
                        </p>
                      )}
                      <p className="text-sm">{card.title ?? card.text ?? "Untitled"}</p>
                      {card.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                      )}
                      {workerSessionId && (
                        <div className="mt-2">
                          <Link
                            to="/c/$sessionId"
                            params={{ sessionId: workerSessionId }}
                            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            Open worker session →
                          </Link>
                        </div>
                      )}
                      {card.id && (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (commentingCardId === card.id) {
                                  setCommentingCardId(null);
                                  setCommentDraft("");
                                } else {
                                  setCommentingCardId(card.id ?? null);
                                  setCommentDraft("");
                                }
                              }}
                            >
                              Comment
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (!card.id) return;
                                void moveCard(config, card.id, "blocked")
                                  .then(() => board.refresh())
                                  .catch(() => setNote("The board did not block that card."));
                              }}
                            >
                              Block
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                if (!card.id) return;
                                void moveCard(config, card.id, "done")
                                  .then(() => board.refresh())
                                  .catch(() => setNote("The board did not accept that card."));
                              }}
                            >
                              Accept
                            </Button>
                          </div>
                          {commentingCardId === card.id && (
                            <form
                              className="flex gap-1.5"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const body = commentDraft.trim();
                                if (!body || !card.id) return;
                                void commentOnCard(config, card.id, body)
                                  .then(() => {
                                    setCommentingCardId(null);
                                    setCommentDraft("");
                                    board.refresh();
                                  })
                                  .catch(() => setNote("The board did not take that comment."));
                              }}
                            >
                              <input
                                value={commentDraft}
                                onChange={(event) => setCommentDraft(event.target.value)}
                                placeholder="Write a comment…"
                                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                              />
                              <Button type="submit" size="sm">
                                Post
                              </Button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </GatewayPage>
  );
}
