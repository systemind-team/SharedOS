import { counted, exceptEscalation } from "./internal.js";
import type { RuntimeLimits } from "./runtime-plugin.js";

export interface DescribeLimitsOptions {
  /**
   * Whether the turn's catalogue offers the escalate affordance, as
   * `escalationOffered(request.tools)` answers. Asking for a human ends the
   * turn without passing through the budgets, so a turn that offers it is told
   * that this still works once the call budget is spent.
   */
  readonly escalation?: boolean;
  /**
   * Whether the text is an MCP server's instructions to a harness with tools
   * of its own. Only calls to the server's tools count against the budget
   * then, so the budget is named as calls to this server's tools: "tool calls"
   * would take in the harness's own, which nothing here counts or refuses.
   */
  readonly mcpServer?: boolean;
}

/**
 * The turn's limits, as the words a model is shown.
 *
 * A model that is not told its budget learns it by running into it: the call
 * that crosses a limit is refused, and the model is left to work out that the
 * next one will be too. This is the telling, before the turn, in the manner of
 * `describeReach`. The seats in `@aicoo/sharedos-adapters` put it after the
 * reach in what they hand over, and it is exported so a host writing its own
 * driver says the same thing the same way.
 *
 * Only a limit the host set is spoken. SharedOS sets none of its own, so an
 * unset limit is no limit and gets no sentence, and a turn with none set has
 * nothing to say: the result is `undefined`, and a seat appends nothing.
 *
 * - `maxToolCalls` is the number of tool calls the turn may make, and once it
 *   is spent every further one is refused, so the model should finish with
 *   what it has. Asking for a human is named as the exception where the turn
 *   offers it (`escalation`), and over MCP the budget is named as calls to the
 *   server's tools (`mcpServer`).
 * - `maxSteps` is the number of steps, counted as the standard loop counts
 *   them: each tool call is one, and so is the final answer. Nothing is
 *   refused when they run out. A loop whose last step went on a tool call
 *   ends there without an answer, so the model is told to keep the last step
 *   for its answer. A runtime whose calls declare no step is not bounded by
 *   `maxSteps` and leaves it out; the MCP harness runtime does.
 * - `timeoutMs` is a duration from the turn's start, in hours, minutes and
 *   seconds rather than milliseconds.
 *
 * It only tells. The model decides when to end, and the turn still ends at
 * `maxSteps` or the deadline when the host set them.
 */
export function describeLimits(
  limits: Partial<RuntimeLimits> | undefined,
  options: DescribeLimitsOptions = {},
): string | undefined {
  const maxToolCalls = positiveInteger("maxToolCalls", limits?.maxToolCalls);
  const maxSteps = positiveInteger("maxSteps", limits?.maxSteps);
  const timeoutMs = positiveInteger("timeoutMs", limits?.timeoutMs);
  if (maxToolCalls === undefined && maxSteps === undefined && timeoutMs === undefined) {
    return undefined;
  }

  const sentences = ["Limits the host set on this turn."];
  if (maxToolCalls !== undefined) {
    const escalation = exceptEscalation(options.escalation === true);
    sentences.push(
      options.mcpServer === true
        ? `You may make at most ${counted(maxToolCalls, "call")} to this server's tools. ` +
            "Once that budget is used up, every further call to them this turn is " +
            `refused${escalation}, so finish with what you have.`
        : `You may make at most ${counted(maxToolCalls, "tool call")}. Once that budget ` +
            `is used up, every further tool call this turn is refused${escalation}, so ` +
            "finish with what you have.",
    );
  }
  if (maxSteps !== undefined) {
    sentences.push(
      `You may take at most ${counted(maxSteps, "step")}: each tool call you make is a ` +
        "step, and so is your final answer. A turn whose last step is a tool call ends " +
        "without an answer, so keep the last step for your answer.",
    );
  }
  if (timeoutMs !== undefined) {
    sentences.push(
      `The turn ends ${describeDuration(timeoutMs)} after it began, whether or not ` +
        "you have answered, so answer before then.",
    );
  }
  return sentences.join(" ");
}

/**
 * A number of milliseconds as a model reads a length of time: "2 minutes",
 * "1 minute and 30 seconds", "2 hours and 15 minutes". Hours are the largest
 * unit, and a part that is zero is left out. Under a second it stays in
 * milliseconds, and a fraction of a second past that is kept as a decimal
 * rather than rounded away, so the text never says more time than there is.
 */
function describeDuration(ms: number): string {
  if (ms < 1_000) {
    return counted(ms, "millisecond");
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = (ms % 60_000) / 1_000;
  const parts = [
    ...(hours > 0 ? [counted(hours, "hour")] : []),
    ...(minutes > 0 ? [counted(minutes, "minute")] : []),
    ...(seconds > 0 ? [counted(seconds, "second")] : []),
  ];
  const last = parts.pop() ?? "";
  return parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
}

function positiveInteger(name: string, value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new TypeError(`describeLimits ${name} must be a positive integer`);
  }
  return value;
}
