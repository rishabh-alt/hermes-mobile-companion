import { describe, expect, it } from "vitest";
import { createRunGuard, ProfileRunBoundary } from "./run-guard";

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

describe("ProfileRunBoundary", () => {
  it("aborts registered work and invalidates stale generation callbacks", () => {
    const boundary = new ProfileRunBoundary();
    const run = boundary.start();

    expect(run.isCurrent()).toBe(true);
    boundary.invalidate();

    expect(run.signal.aborted).toBe(true);
    expect(run.isCurrent()).toBe(false);
  });

  it("does not abort work started in the new profile generation", () => {
    const boundary = new ProfileRunBoundary();
    boundary.invalidate();
    const run = boundary.start();

    expect(run.generation).toBe(1);
    expect(run.isCurrent()).toBe(true);
  });
});
