export function createRunGuard(
  generation: number,
  currentGeneration: () => number,
  signal: AbortSignal,
) {
  return () => generation === currentGeneration() && !signal.aborted;
}
