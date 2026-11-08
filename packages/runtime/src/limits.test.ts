import { describe, expect, it } from "vitest";

import { describeLimits } from "./index.js";

const HEADER = "Limits the host set on this turn.";
const SPENT =
  "Once a budget is used up, every further tool call this turn is refused, so finish with what you have.";

describe("describeLimits", () => {
  it("says nothing when the host set no limit, since an unset limit is no limit", () => {
    expect(describeLimits(undefined)).toBeUndefined();
    expect(describeLimits({})).toBeUndefined();
    expect(
      describeLimits({ maxSteps: undefined, maxToolCalls: undefined, timeoutMs: undefined }),
    ).toBeUndefined();
  });

  it("names a tool-call budget alone, and what follows once it is spent", () => {
    expect(describeLimits({ maxToolCalls: 20 })).toBe(
      `${HEADER} You may make at most 20 tool calls. ${SPENT}`,
    );
  });

  it("names a step budget alone, and how a step is counted", () => {
    expect(describeLimits({ maxSteps: 30 })).toBe(
      `${HEADER} You may take at most 30 steps: each tool call you make is a step, and so is ` +
        `your final answer, so keep one for the answer. ${SPENT}`,
    );
  });

  it("names a deadline alone, with nothing about budgets the host did not set", () => {
    const text = describeLimits({ timeoutMs: 120_000 });

    expect(text).toBe(
      `${HEADER} The turn ends 2 minutes after it began, whether or not you have answered, ` +
        "so answer before then.",
    );
    expect(text).not.toContain("budget");
  });

  it("names all three in order: calls, steps, then the deadline", () => {
    expect(describeLimits({ maxSteps: 30, maxToolCalls: 20, timeoutMs: 90_000 })).toBe(
      `${HEADER} You may make at most 20 tool calls. You may take at most 30 steps: each tool ` +
        "call you make is a step, and so is your final answer, so keep one for the answer. " +
        `${SPENT} The turn ends 1 minute and 30 seconds after it began, whether or not you ` +
        "have answered, so answer before then.",
    );
  });

  it("speaks of one call and one step in the singular", () => {
    const text = describeLimits({ maxToolCalls: 1, maxSteps: 1 });

    expect(text).toContain("at most 1 tool call.");
    expect(text).toContain("at most 1 step:");
  });

  it.each([
    [1, "1 millisecond"],
    [500, "500 milliseconds"],
    [1_000, "1 second"],
    [1_500, "1.5 seconds"],
    [45_000, "45 seconds"],
    [60_000, "1 minute"],
    [90_000, "1 minute and 30 seconds"],
    [120_000, "2 minutes"],
    [3_600_000, "1 hour"],
    [3_725_000, "1 hour, 2 minutes and 5 seconds"],
    [8_100_000, "2 hours and 15 minutes"],
    [7_200_500, "2 hours and 0.5 seconds"],
    [30 * 86_400_000, "720 hours"],
  ])("reads a deadline of %i ms as %s", (timeoutMs, duration) => {
    expect(describeLimits({ timeoutMs })).toContain(` ends ${duration} after it began`);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a limit of %s, which no host can set", (value) => {
    expect(() => describeLimits({ maxToolCalls: value })).toThrow(TypeError);
    expect(() => describeLimits({ maxSteps: value })).toThrow(TypeError);
    expect(() => describeLimits({ timeoutMs: value })).toThrow(TypeError);
  });
});
