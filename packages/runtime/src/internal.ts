import { after } from "@aicoo/sharedos-core/internal";

/**
 * One signal for a turn: the host's, if it gave one, with the turn's own
 * deadline and the executor's own abort folded in, and a `dispose` that
 * releases both once the turn is over. With no `timeoutMs` the turn has no
 * deadline of its own.
 */
export function createAbortController(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal; abort: (reason?: unknown) => void; dispose: () => void } {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abortFromParent, { once: true });
  if (parent?.aborted) {
    abortFromParent();
  }

  const cancelTimeout =
    timeoutMs === undefined
      ? undefined
      : after(timeoutMs, () => controller.abort(new Error("turn timeout")));

  return {
    signal: controller.signal,
    abort: (reason?: unknown): void => controller.abort(reason),
    dispose: (): void => {
      cancelTimeout?.();
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

/**
 * The two signals of a turn that drains before it stops.
 *
 * `signal` is the one above: the host's cancellation and the turn's deadline,
 * and the only one a tool handler is given. `draining` is aborted first, `graceMs`
 * ahead of the deadline, and says only that the turn takes nothing new. What is
 * already inside a handler is left alone until `signal`, so it answers with its
 * real outcome rather than being stopped half-way through an effect. The grace
 * is inside the limit: `timeoutMs` is still when the turn ends at the latest.
 *
 * `drain` starts the same thing early, for an ending the envelope makes itself,
 * and the hard stop then follows after the grace or at the deadline, whichever
 * comes first. With no grace the two signals are one and `drain` is `abort`.
 * A host's own cancellation never drains: it asked for a stop, and gets it.
 * With no `timeoutMs` there is no deadline to drain ahead of, and the turn
 * drains only when `drain` is called.
 */
export function createTurnDeadlines(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
  graceMs: number,
): {
  signal: AbortSignal;
  draining: AbortSignal;
  drain: (reason?: unknown) => void;
  abort: (reason?: unknown) => void;
  dispose: () => void;
} {
  const hard = createAbortController(parent, timeoutMs);
  const soft = new AbortController();
  // Registered before anything else can listen, so nothing observes a turn that
  // is stopped and not yet draining.
  const drainFromHard = (): void => soft.abort(hard.signal.reason);
  hard.signal.addEventListener("abort", drainFromHard, { once: true });
  if (hard.signal.aborted) {
    drainFromHard();
  }

  let cancelSoft =
    graceMs > 0 && timeoutMs !== undefined && !soft.signal.aborted
      ? after(Math.max(0, timeoutMs - graceMs), () => soft.abort(new Error("turn draining")))
      : undefined;
  let cancelStopAfterGrace: (() => void) | undefined;
  let disposed = false;

  return {
    signal: hard.signal,
    draining: soft.signal,
    drain: (reason?: unknown): void => {
      // The reason is for the hard stop, where it already went. The draining
      // signal is handed to the plugin, and says only that the turn is ending.
      soft.abort(new Error("turn draining"));
      if (graceMs === 0) {
        hard.abort(reason);
      } else if (!hard.signal.aborted && !disposed) {
        // Not once disposed: a call that outlives its turn can still ask, and a
        // timer armed then has nobody left to clear it.
        cancelStopAfterGrace ??= after(graceMs, () => hard.abort(reason));
      }
    },
    abort: hard.abort,
    dispose: (): void => {
      disposed = true;
      cancelSoft?.();
      cancelStopAfterGrace?.();
      cancelSoft = undefined;
      hard.signal.removeEventListener("abort", drainFromHard);
      hard.dispose();
    },
  };
}

/** A count with its noun, singular for one: "1 step", "20 tool calls". */
export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
