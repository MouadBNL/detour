let tail: Promise<void> = Promise.resolve();

/**
 * Runs `task` after every previously enqueued background task settles, so each read → transform →
 * DNR sync → persist step sees the state the previous step wrote.
 *
 * Tasks return `Result` values and never reject, so the chain needs no rejection handler.
 */
export function enqueueBackground<T>(task: () => Promise<T>): Promise<T> {
  const next = tail.then(task);
  tail = next.then(() => undefined);
  return next;
}
