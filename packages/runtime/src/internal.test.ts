import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTurnDeadlines } from "./internal.js";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("createTurnDeadlines", () => {
  it("aborts draining a grace ahead of the signal, and the signal at the limit", async () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);

    await vi.advanceTimersByTimeAsync(114_999);
    expect(deadlines.draining.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadlines.draining.aborted).toBe(true);
    expect(deadlines.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deadlines.signal.aborted).toBe(true);
    deadlines.dispose();
  });

  it("leaves no timer behind on dispose, before either deadline", () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    // The soft deadline and the hard one.
    expect(vi.getTimerCount()).toBe(2);

    deadlines.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind on dispose after a drain armed the stop that follows the grace", () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    deadlines.drain(new Error("audit outage"));
    // The soft deadline, the hard one, and the stop after the grace.
    expect(vi.getTimerCount()).toBe(3);

    deadlines.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms the stop after the grace once, however often it is asked to drain", () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    deadlines.drain(new Error("first"));
    deadlines.drain(new Error("second"));

    expect(vi.getTimerCount()).toBe(3);
    deadlines.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fires nothing once disposed, however far the clock then moves", async () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    deadlines.drain(new Error("audit outage"));
    deadlines.dispose();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(deadlines.signal.aborted).toBe(false);
  });

  it("arms nothing when asked to drain after it was disposed", () => {
    // A call that outlives its turn can still reject with the outage, and the
    // envelope then asks a turn that has already closed to drain.
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    deadlines.dispose();

    deadlines.drain(new Error("a call that settled late"));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops listening to the host's signal on dispose", () => {
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    const deadlines = createTurnDeadlines(parent.signal, 120_000, 5_000);

    deadlines.dispose();
    parent.abort(new Error("the host cancelled a later turn"));

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(deadlines.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets no soft timer without a grace, and drain is then the hard stop", () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 0);
    expect(vi.getTimerCount()).toBe(1);

    const reason = new Error("audit outage");
    deadlines.drain(reason);

    expect(deadlines.signal.aborted).toBe(true);
    expect(deadlines.signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(1);
    deadlines.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives draining a reason of its own, never the one it was asked to drain for", () => {
    const deadlines = createTurnDeadlines(undefined, 120_000, 5_000);
    const outage = new Error("what the sink threw");

    deadlines.drain(outage);

    expect(deadlines.draining.aborted).toBe(true);
    expect(deadlines.draining.reason).not.toBe(outage);
    deadlines.dispose();
  });

  it("arms no deadline when the turn has no time limit", async () => {
    const deadlines = createTurnDeadlines(undefined, undefined, 5_000);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30 * 86_400_000);
    expect(deadlines.draining.aborted).toBe(false);
    expect(deadlines.signal.aborted).toBe(false);

    // A drain the envelope starts itself still stops the turn after the grace.
    deadlines.drain(new Error("audit outage"));
    expect(deadlines.draining.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deadlines.signal.aborted).toBe(true);
    deadlines.dispose();
  });
});
