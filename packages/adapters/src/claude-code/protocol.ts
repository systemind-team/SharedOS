import type {
  JsonObject,
  JsonValue,
  ProtocolError,
  ToolDefinition,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { z } from "zod";

import type { HarnessFrame, HarnessProtocol, HarnessStep } from "../harness.js";
import { toolResultBody } from "../internal.js";
import { TextBlockSchema, UnknownBlockSchema, contentBlockSteps } from "../protocol-base.js";

/**
 * Claude Code speaks Anthropic message content blocks inside a stream-json
 * envelope.
 *
 * The content blocks -- `tool_use`, `tool_result`, `text` -- are the stable
 * part and are what this module translates. The `{type:"assistant"|"user"|
 * "result"}` envelope is the CLI's `--output-format stream-json` framing.
 */
export const CLAUDE_CODE_PROTOCOL_ID = "anthropic.messages.stream-json";

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

const AssistantSchema = z
  .object({
    type: z.literal("assistant"),
    message: z
      .object({
        content: z.array(z.union([TextBlockSchema, ToolUseBlockSchema, UnknownBlockSchema])),
      })
      .passthrough(),
  })
  .passthrough();

const ResultSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
  })
  .passthrough();

type ResultFrame = z.infer<typeof ResultSchema>;

/**
 * Whether a `result` frame ends the turn in failure.
 *
 * `subtype` is the field to read, and `is_error` is only a second witness.
 * Before Claude Code 2.1.89 a run stopped at its turn limit or by an error
 * during execution reported `error_max_turns` or `error_during_execution`
 * with `is_error: false`, so a protocol that trusted `is_error` read the
 * failed turn as complete with empty output. Any subtype other than
 * `success` is a failure on every version. The reverse also happens: an API
 * error arrives as `subtype: "success"` with `is_error: true` and the error
 * text as `result`, so `is_error` is still read.
 */
function resultFailed(frame: ResultFrame): boolean {
  return frame.is_error === true || (frame.subtype !== undefined && frame.subtype !== "success");
}

/**
 * The failure a `result` frame reports.
 *
 * The code is the subtype when Claude stopped the run itself
 * (`error_max_turns`, `error_during_execution`), and otherwise the frame's
 * `terminal_reason` (`api_error` for a failed API call), so a failure never
 * carries the code `success`. A frame naming neither is `harness_failed`.
 *
 * Only a transient API error is retryable. A turn limit, a budget, a refused
 * credential or an exhausted balance fails the same way when the turn is run
 * again, and so does an error Claude reported without saying more.
 */
function resultFailure(frame: ResultFrame): ProtocolError {
  const stopped = frame.subtype === "success" ? undefined : frame.subtype;
  const errors = reportedErrors(frame["errors"]);
  const text = nonEmptyString(frame.result);
  return {
    code: stopped ?? nonEmptyString(frame["terminal_reason"]) ?? "harness_failed",
    message: text ?? failureMessage(frame.subtype, frame["num_turns"], errors),
    retryable:
      frame.subtype?.startsWith("error_max_") !== true &&
      [text, ...errors].some((said) => said !== undefined && transientApiError(said)),
  };
}

/**
 * What a failed result says when Claude wrote no text for it.
 *
 * Claude ends a run it stopped itself, at `--max-turns` for one, with a
 * subtype and no `result`. The subtype is then the only reason there is, so
 * it is named rather than dropped for a generic line, followed by what the
 * frame's `errors` list says when it says anything. `num_turns` is read
 * loosely: a count in a shape this does not expect leaves the count out, and
 * never the frame.
 */
function failureMessage(
  subtype: string | undefined,
  turns: unknown,
  errors: readonly string[],
): string {
  const after =
    typeof turns === "number" && Number.isInteger(turns) && turns > 0
      ? ` after ${String(turns)} model turns`
      : "";
  const what =
    subtype === "error_max_turns"
      ? `Claude Code stopped at its turn limit${after}`
      : "The Claude Code harness reported a failure";
  const named = subtype === undefined ? what : `${what} (${subtype})`;
  return errors.length === 0 ? `${named}.` : `${named}: ${errors.join("; ")}`;
}

/** The `errors` list of a result frame, read loosely: entries that are not text are left out. */
function reportedErrors(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const said = nonEmptyString(entry);
        return said === undefined ? [] : [said];
      })
    : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Whether Claude's text reports an API error worth asking again about.
 *
 * The frame carries no status of its own; Claude writes the provider's into
 * the text, as `API Error: 529 {...}`, or names a transport failure, as
 * `API Error: Request timed out.` Rate limits, timeouts, overload and server
 * errors pass with time. Anything else, an authentication or billing refusal
 * among them, is the same answer next time.
 */
function transientApiError(text: string): boolean {
  const apiError = /^API Error\b[^:]*:\s*(.*)$/su.exec(text.trim());
  if (apiError === null) {
    return false;
  }
  const detail = apiError[1] ?? "";
  const status = /^(\d{3})\b/u.exec(detail)?.[1];
  if (status !== undefined) {
    const code = Number(status);
    return code === 408 || code === 429 || code >= 500;
  }
  return /timed? ?out|connection error|overloaded|rate.?limit|ECONNRESET|socket hang up/iu.test(
    detail,
  );
}

function toolUseStep(block: unknown): HarnessStep | undefined {
  const toolUse = ToolUseBlockSchema.safeParse(block);
  return toolUse.success
    ? {
        type: "tool_call",
        callId: toolUse.data.id,
        tool: toolUse.data.name,
        arguments: (toolUse.data.input ?? {}) as JsonObject,
      }
    : undefined;
}

export const claudeCodeProtocol: HarnessProtocol = {
  id: CLAUDE_CODE_PROTOCOL_ID,

  describeTools(tools: readonly ToolDefinition[]): JsonValue {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })) as unknown as JsonValue;
  },

  interpret(frame: HarnessFrame): readonly HarnessStep[] {
    const assistant = AssistantSchema.safeParse(frame);
    if (assistant.success) {
      return contentBlockSteps(assistant.data.message.content, toolUseStep);
    }

    const result = ResultSchema.safeParse(frame);
    if (result.success) {
      if (resultFailed(result.data)) {
        return [{ type: "failed", error: resultFailure(result.data) }];
      }
      const text = result.data.result;
      return [text === undefined ? { type: "complete" } : { type: "complete", output: { text } }];
    }

    return [];
  },

  /**
   * A tool result goes back as a user message, which is how the Messages
   * protocol carries one. A denial is reported with `is_error`, so the harness
   * learns it was refused rather than being told the call crashed.
   */
  encodeToolResult(result: ToolResult): HarnessFrame {
    return {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: result.callId,
            is_error: result.status !== "succeeded",
            content: [{ type: "text", text: JSON.stringify(toolResultBody(result)) }],
          },
        ],
      },
    };
  },
};
