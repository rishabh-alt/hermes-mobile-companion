import { createFileRoute } from "@tanstack/react-router";
import { GatewayPage } from "@/components/hermes/gateway-page";
import { useGateway } from "@/lib/hermes/useGateway";
import { kanbanBoard } from "@/lib/hermes/rest";

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
}
interface Column {
  id?: string;
  name?: string;
  title?: string;
  cards?: Card[];
  items?: Card[];
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
  const board = useGateway(kanbanBoard, []);
  const columns = columnsOf(board.data);

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
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4">
        {columns.map((column, i) => {
          const cards = column.cards ?? column.items ?? [];
          return (
            <div key={column.id ?? i} className="w-64 shrink-0">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                {column.name ?? column.title ?? `Column ${i + 1}`}
                <span className="ml-1">{cards.length}</span>
              </p>
              <div className="space-y-2">
                {cards.map((card, j) => (
                  <div key={card.id ?? j} className="rounded-lg bg-secondary/40 p-3">
                    <p className="text-sm">{card.title ?? card.text ?? "Untitled"}</p>
                    {card.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </GatewayPage>
  );
}
