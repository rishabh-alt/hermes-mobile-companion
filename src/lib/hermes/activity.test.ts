import { describe, expect, it } from "vitest";
import { buildActivity, cardsFromBoard } from "./activity";

describe("buildActivity", () => {
  it("puts host work in the lane it actually came from", () => {
    const feed = buildActivity({
      sessions: [
        { id: "tg", title: "From Telegram", source: "telegram" },
        { id: "cli", title: "From the terminal", source: "cli" },
        { id: "phone", title: "From this phone", source: "api_server" },
      ],
      jobs: [{ id: "job-1", name: "Morning digest", paused: false }],
      jobsUnavailable: false,
      kanbanCards: [{ id: "card-1", title: "Needs a review", column: "review" }],
      kanbanUnavailable: false,
    });

    const lane = (id: string) => feed.lanes.find((item) => item.id === id);
    expect(lane("telegram")?.items.map((item) => item.title)).toEqual(["From Telegram"]);
    expect(lane("cli")?.items.map((item) => item.title)).toEqual(["From the terminal"]);
    expect(lane("phone")?.items.map((item) => item.title)).toEqual(["From this phone"]);
    expect(lane("cron")?.items.map((item) => item.title)).toEqual(["Morning digest"]);
    expect(lane("kanban")?.items.map((item) => item.title)).toEqual(["Needs a review"]);
    expect(feed.readOnly).toBe(true);
  });

  it("does not call a missing host list empty", () => {
    const feed = buildActivity({
      sessions: [],
      jobs: null,
      jobsUnavailable: true,
      kanbanCards: null,
      kanbanUnavailable: true,
    });

    expect(feed.lanes.find((lane) => lane.id === "cron")).toMatchObject({
      unavailable: true,
      items: [],
    });
    expect(feed.lanes.find((lane) => lane.id === "kanban")).toMatchObject({
      unavailable: true,
      items: [],
    });
  });

  it("does not file desktop or discord work under Telegram", () => {
    const feed = buildActivity({
      sessions: [
        { id: "desk", title: "Desktop chat", source: "desktop" },
        { id: "disc", title: "Discord chat", source: "discord" },
      ],
      jobs: [],
      jobsUnavailable: false,
      kanbanCards: [],
      kanbanUnavailable: false,
    });

    expect(feed.lanes.find((lane) => lane.id === "telegram")?.items).toEqual([]);
    expect(feed.lanes.find((lane) => lane.id === "other")?.items.map((item) => item.id)).toEqual([
      "desk",
      "disc",
    ]);
  });
});

describe("cardsFromBoard", () => {
  it("reads card titles from the board columns the phone already gets", () => {
    expect(
      cardsFromBoard({
        columns: [{ name: "review", cards: [{ id: "c1", title: "Needs a review" }] }],
      }),
    ).toEqual([{ id: "c1", title: "Needs a review", column: "review" }]);
  });
});
