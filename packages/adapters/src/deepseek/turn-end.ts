/**
 * Why a DeepSeek Harness turn that did not complete ended, in the words a
 * failure carries, by the `kind` of its `turn/end` reason.
 *
 * Shared by the two ways the harness is read: the session-event vocabulary
 * and the headless profile's `--json` stream carry the same reason object.
 * `completed` is the only ending that is an outcome.
 */
export const TURN_END_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  aborted: "The DeepSeek Harness turn was cancelled before it completed.",
  blocked: "The DeepSeek Harness turn was blocked before it completed.",
  error: "The DeepSeek Harness turn ended in an error.",
  "max-tokens": "The DeepSeek Harness turn reached its output-token ceiling.",
  interrupted: "The DeepSeek Harness turn was interrupted and never completed.",
});

/** The failure code for a turn that ended with this `kind`, when the reason names none of its own. */
export function turnEndCode(kind: string): string {
  return `harness_turn_${kind.replaceAll("-", "_")}`;
}
