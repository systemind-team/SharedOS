import type { JsonValue, ToolDefinition, ToolResult } from "@aicoo/sharedos-contracts";
import { z } from "zod";

import type { HarnessFrame, HarnessProtocol, HarnessStep } from "../harness.js";
import { deepseekProtocol } from "./protocol.js";
import { TURN_END_FAILURES, turnEndCode } from "./turn-end.js";

/**
 * DeepSeek Harness's headless profile, read through its `--json` stream.
 *
 * `dsh --profile headless` answers one task and exits. Without `--json` it
 * prints only the final answer, and none of the session events
 * `deepseekProtocol` reads, so a turn read that way completed with nothing to
 * show. With `--json` it prints one event per line, the same from dsh
 * 0.1.6-alpha.1 through 0.2.2-rc.1:
 *
 *     {type:"session", sessionId, cwd}
 *     {type:"status", phase:"turn_start"|"step_start"|"step_end"|"turn_end", turn, step?, reason?}
 *     {type:"thinking", text}            {type:"text", text}
 *     {type:"tool_call", callId, tool, input}
 *     {type:"tool_result", callId, status:"completed"|"error", result, error?}
 *     {type:"final", text}               until 0.2.1
 *     {type:"final", sessionId, reason, text}   from 0.2.2
 *     {type:"error", message}
 *
 * The turn's outcome is read from `final` and `error`, and nothing else.
 * dsh cuts every string but `final.text` at 8 KiB and marks the event
 * `truncated`, so the answer is `final.text`, which is the run's last
 * assistant text, whole. A run can hold more than one turn, and only its last
 * one decides how the run ended: that is how dsh sets its own exit code, so
 * a `turn_end` on the way is not read as the run's end.
 *
 * `final.reason` is that last turn's `turn/end` reason, or null when no turn
 * ended. `{kind:"completed"}` is a completed turn; any other kind is a failed
 * one, read as `deepseekProtocol` reads a `turn/end`; null is a run that
 * ended no turn. Before 0.2.2 `final` carries no reason, so its text is kept
 * as the turn's message and the CLI's exit code decides, which is the reason
 * dsh's own exit code is set from. `error` is a run dsh could not drive at
 * all: a usage error, or an Agent failure no turn recovered from.
 *
 * dsh executes its own tools, and on this path the SharedOS ones reach it
 * over MCP. A `tool_call` event is a record of a call already made, never one
 * to make, so it yields nothing.
 */
export const DEEPSEEK_HEADLESS_PROTOCOL_ID = "deepseek.headless.jsonl";

const TurnEndReasonSchema = z
  .object({
    kind: z.string().min(1),
    error: z
      .object({ code: z.string().optional(), message: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const FinalSchema = z
  .object({
    type: z.literal("final"),
    text: z.string(),
    reason: TurnEndReasonSchema.nullable().optional(),
  })
  .passthrough();

const ErrorSchema = z.object({ type: z.literal("error"), message: z.string() }).passthrough();

/**
 * The codes dsh's own retry policy treats as transient by default. A turn
 * that failed on one of them may answer if it is run again; one that failed
 * on anything else, a missing credential or an exhausted quota among them,
 * fails the same way.
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
]);

export const deepseekHeadlessProtocol: HarnessProtocol = {
  id: DEEPSEEK_HEADLESS_PROTOCOL_ID,

  /** The harness's own `ToolSchema` shape, as `deepseekProtocol` renders it. */
  describeTools(tools: readonly ToolDefinition[]): JsonValue {
    return deepseekProtocol.describeTools(tools);
  },

  interpret(frame: HarnessFrame): readonly HarnessStep[] {
    const final = FinalSchema.safeParse(frame);
    if (final.success) {
      const { reason, text } = final.data;
      if (reason === undefined) {
        return text.trim() === "" ? [] : [{ type: "message", text }];
      }
      if (reason === null) {
        return [
          {
            type: "failed",
            error: {
              code: "harness_ended_without_outcome",
              message: "The DeepSeek Harness run ended without ending a turn.",
              retryable: false,
            },
          },
        ];
      }
      if (reason.kind === "completed") {
        return [{ type: "complete", output: { text } }];
      }
      const code = reason.error?.code;
      return [
        {
          type: "failed",
          error: {
            code: code ?? turnEndCode(reason.kind),
            message:
              reason.error?.message ??
              TURN_END_FAILURES[reason.kind] ??
              `The DeepSeek Harness turn ended without completing (${reason.kind}).`,
            retryable:
              reason.kind === "interrupted" ||
              (reason.kind === "error" && code !== undefined && TRANSIENT_CODES.has(code)),
          },
        },
      ];
    }

    const error = ErrorSchema.safeParse(frame);
    if (error.success) {
      return [
        {
          type: "failed",
          error: {
            code: "harness_failed",
            message:
              error.data.message.trim() === ""
                ? "The DeepSeek Harness run failed."
                : error.data.message,
            retryable: false,
          },
        },
      ];
    }

    return [];
  },

  /**
   * The harness's own result shape, as `deepseekProtocol` writes it. A
   * headless run reads nothing after its task, so this stream has no place
   * for a result; the shape is here for a transport that does.
   */
  encodeToolResult(result: ToolResult): HarnessFrame {
    return deepseekProtocol.encodeToolResult(result);
  },
};
