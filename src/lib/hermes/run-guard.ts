export function createRunGuard(
  generation: number,
  currentGeneration: () => number,
  signal: AbortSignal,
) {
  return () => generation === currentGeneration() && !signal.aborted;
}

export interface ProfileRunTicket {
  generation: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  abort: () => void;
  release: () => void;
}

/** Shared switch boundary for profile-sensitive pull and stream work. */
export class ProfileRunBoundary {
  #generation = 0;
  #controllers = new Set<AbortController>();

  get generation() {
    return this.#generation;
  }

  start(): ProfileRunTicket {
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controllers.add(controller);
    return {
      generation,
      signal: controller.signal,
      isCurrent: () => generation === this.#generation && !controller.signal.aborted,
      abort: () => controller.abort(),
      release: () => this.#controllers.delete(controller),
    };
  }

  invalidate() {
    this.#generation += 1;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }
}

export const profileRunBoundary = new ProfileRunBoundary();
