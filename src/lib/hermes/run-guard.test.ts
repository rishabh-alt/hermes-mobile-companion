import { describe, expect, it } from "vitest";
import { createRunGuard } from "./run-guard";

describe("createRunGuard", () => {
  it("rejects stream callbacks after a newer generation starts", () => {
    let generation = 4;
    const controller = new AbortController();
    const isCurrent = createRunGuard(4, () => generation, controller.signal);

    expect(isCurrent()).toBe(true);
    generation += 1;
    expect(isCurrent()).toBe(false);
  });

  it("rejects stream callbacks after the active run is aborted", () => {
    const controller = new AbortController();
    const isCurrent = createRunGuard(4, () => 4, controller.signal);

    expect(isCurrent()).toBe(true);
    controller.abort();
    expect(isCurrent()).toBe(false);
  });
});
