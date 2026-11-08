import { describe, expect, it } from "vitest";

import { describeLimits } from "./index.js";

const HEADER = "Limits the host set on this turn.";
const CALLS =
  "You may make at most 20 tool calls. Once that budget is used up, every further tool call " +
  "this turn is refused, so finish with what you have.";
const STEPS =
  "You may take at most 30 steps: each tool call you make is a step, and so is your final " +
  "answer. A turn whose last step is a tool call ends without an answer, so keep the last " +
  "step for your answer.";
const DEADLINE =
  "The turn ends 2 minutes after it began, whether or not you have answered, so answer " +
  "before then.";

describe("describeLimits", () => {
  it("says nothing when the host set no limit, since an unset limit is no limit", () => {
    expect(describeLimits(undefined)).toBeUndefined();
    expect(describeLimits({})).toBeUndefined();
    expect(
      describeLimits({ maxSteps: undefined, maxToolCalls: undefined, timeoutMs: undefined }),
    ).toBeUndefined();
    expect(describeLimits({}, { escalation: true, mcpServer: true })).toBeUndefined();
  });

  it("names a tool-call budget alone, and that every later call is refused once it is spent", () => {
    expect(describeLimits({ maxToolCalls: 20 })).toBe(`${HEADER} ${CALLS}`);
  });

  it("names a step budget alone, and how a turn that spends it on a call ends", () => {
    const text = describeLimits({ maxSteps: 30 });

    expect(text).toBe(`${HEADER} ${STEPS}`);
    // Nothing is refused when steps run out: the loop ends the turn instead, so
    // the refusal sentence, which is the call budget's, is not said.
    expect(text).not.toContain("refused");
  });

  it("names a deadline alone, with nothing about budgets the host did not set", () => {
    const text = describeLimits({ timeoutMs: 120_000 });

    expect(text).toBe(`${HEADER} ${DEADLINE}`);
    expect(text).not.toContain("budget");
  });

  it("names all three in order: calls, steps, then the deadline", () => {
    expect(describeLimits({ maxSteps: 30, maxToolCalls: 20, timeoutMs: 120_000 })).toBe(
      `${HEADER} ${CALLS} ${STEPS} ${DEADLINE}`,
    );
  });

  it("names asking for a human as the call that still works, where the turn offers it", () => {
    expect(describeLimits({ maxToolCalls: 20 }, { escalation: true })).toBe(
      `${HEADER} You may make at most 20 tool calls. Once that budget is used up, every ` +
        "further tool call this turn is refused, except asking for a human with " +
        "sharedos.escalate, so finish with what you have.",
    );
    // No exception where none is offered, and none to name without a call budget.
    expect(describeLimits({ maxToolCalls: 20 }, { escalation: false })).toBe(`${HEADER} ${CALLS}`);
    expect(describeLimits({ maxSteps: 30, timeoutMs: 120_000 }, { escalation: true })).toBe(
      `${HEADER} ${STEPS} ${DEADLINE}`,
    );
  });

  it("names an MCP harness's budget as calls to the server's tools, which are all it counts", () => {
    expect(describeLimits({ maxToolCalls: 1 }, { mcpServer: true })).toBe(
      `${HEADER} You may make at most 1 call to this server's tools. Once that budget is used ` +
        "up, every further call to them this turn is refused, so finish with what you have.",
    );
    expect(describeLimits({ maxToolCalls: 4 }, { mcpServer: true, escalation: true })).toBe(
      `${HEADER} You may make at most 4 calls to this server's tools. Once that budget is used ` +
        "up, every further call to them this turn is refused, except asking for a human with " +
        "sharedos.escalate, so finish with what you have.",
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
