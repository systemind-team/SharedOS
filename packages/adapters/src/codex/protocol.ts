import type { JsonValue, ToolDefinition, ToolResult } from "@aicoo/sharedos-contracts";
import { parseToolArguments, toolResultBody } from "../internal.js";

import { z } from "zod";

import type { HarnessFrame, HarnessProtocol, HarnessStep } from "../harness.js";

/**
 * Codex is read in two shapes, for the two ways it is reached.
 *
 * The OpenAI Responses function-calling shape serves a transport that speaks
 * the API directly, and the scripted conformance column: function tool
 * declarations, `function_call` items, `function_call_output` results. The CLI
 * in JSON mode (`codex exec --json`), which `CODEX_MCP_HARNESS` (mcp-runtime)
 * launches, prints none of that on stdout: a turn there is `thread.started`,
 * `turn.started`, a series of `item.*` events and a `turn.completed` or
 * `turn.failed`, the model's prose is an `agent_message` item, and its tool
 * calls travel over MCP. A protocol that read only the Responses shape
 * completed a turn Codex answered in prose with nothing to show, and the host
 * heard silence.
 *
 * The CLI's envelope is the vendor's to change, so only the events a turn's
 * outcome turns on are read; the rest are progress and yield nothing. A frame
 * of neither shape yields nothing as well.
 */
export const CODEX_PROTOCOL_ID = "openai.responses.function-calling";

const FunctionCallSchema = z
  .object({
    type: z.literal("function_call"),
    call_id: z.string().min(1),
    name: z.string().min(1),
    /** Responses sends arguments as a JSON-encoded string, not an object. */
    arguments: z.string(),
  })
  .passthrough();

const OutputTextSchema = z.object({ type: z.literal("output_text"), text: z.string() });

const MessageSchema = z
  .object({
    type: z.literal("message"),
    content: z.array(z.union([OutputTextSchema, z.object({ type: z.string() }).passthrough()])),
  })
  .passthrough();

const CompletedSchema = z
  .object({
    type: z.literal("response.completed"),
    response: z.object({ output_text: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/** An error as the Responses protocol carries one: a code, null when there is none, and a message. */
const ErrorBodySchema = z
  .object({ code: z.string().nullish(), message: z.string().optional() })
  .passthrough();

/**
 * A failed response, in the Responses shape.
 *
 * The protocol puts the error on the response that failed, as
 * `response.error`. The error is also read at the top level, where this
 * module once expected it, so a transcript recorded in that shape reads as
 * it did.
 */
const ResponseFailedSchema = z
  .object({
    type: z.literal("response.failed"),
    response: z.object({ error: ErrorBodySchema.nullish() }).passthrough().optional(),
    error: ErrorBodySchema.optional(),
    message: z.string().optional(),
  })
  .passthrough();

/**
 * The Responses stream's own `error` event, which ends the stream.
 *
 * It carries `code`, null when there is none, beside its `message`, or the
 * error nested under `error`. The CLI's `error` event carries neither, and
 * is read by `CliErrorSchema` instead: the two share a `type` and mean
 * different things.
 */
const ResponsesErrorSchema = z
  .object({ type: z.literal("error"), code: z.string().nullable(), message: z.string().optional() })
  .passthrough();

const NestedErrorSchema = z
  .object({ type: z.literal("error"), error: ErrorBodySchema })
  .passthrough();

/**
 * What `codex exec --json` prints as `{type:"error", message}`: a report, and
 * not the turn's end.
 *
 * The CLI prints one for every stream error it recovers from
 * ("Reconnecting... 2/5 ...") as well as for the one it does not, and the
 * turn carries on either way. It ends on `turn.failed`, which carries the
 * error that ended it, on `turn.completed`, or, when the CLI printed
 * neither, on the process's exit. The runtime keeps the first outcome it is
 * given, so reading this event as a failure reported a turn that reconnected
 * once and then completed as failed. It is read as a notice instead: a turn
 * the CLI leaves with no `turn.failed`, an interrupted one, then fails with
 * the last error the CLI printed rather than only its exit code.
 */
const CliErrorSchema = z.object({ type: z.literal("error"), message: z.string() }).passthrough();

/**
 * The CLI's events, as `codex exec --json` prints them. An `item.completed`
 * whose item is an `agent_message` carries the model's prose; `turn.completed` ends the turn; `turn.failed` ends it with
 * the CLI's reason. `thread.started`, `turn.started`, `item.started`,
 * `item.updated` and every other item kind (reasoning, `mcp_tool_call`,
 * `command_execution`) are progress, and are left to the final `[]`.
 */
const AgentMessageItemSchema = z
  .object({
    type: z.literal("item.completed"),
    item: z.object({ type: z.literal("agent_message"), text: z.string() }).passthrough(),
  })
  .passthrough();

const TurnCompletedSchema = z.object({ type: z.literal("turn.completed") }).passthrough();

const TurnFailedSchema = z
  .object({
    type: z.literal("turn.failed"),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const codexProtocol: HarnessProtocol = {
  id: CODEX_PROTOCOL_ID,

  describeTools(tools: readonly ToolDefinition[]): JsonValue {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })) as unknown as JsonValue;
  },

  interpret(frame: HarnessFrame): readonly HarnessStep[] {
    const call = FunctionCallSchema.safeParse(frame);
    if (call.success) {
      const parsed = parseToolArguments(call.data.arguments);
      if (parsed === undefined) {
        return [
          {
            type: "failed",
            error: {
              code: "harness_arguments_unparseable",
              message: "Codex sent tool arguments that are not a JSON object.",
            },
          },
        ];
      }
      return [
        { type: "tool_call", callId: call.data.call_id, tool: call.data.name, arguments: parsed },
      ];
    }

    const responseFailed = ResponseFailedSchema.safeParse(frame);
    if (responseFailed.success) {
      const error = responseFailed.data.response?.error ?? responseFailed.data.error;
      return [failure(error?.code, error?.message ?? responseFailed.data.message)];
    }

    const streamError = ResponsesErrorSchema.safeParse(frame);
    if (streamError.success) {
      return [failure(streamError.data.code, streamError.data.message)];
    }
    const nestedError = NestedErrorSchema.safeParse(frame);
    if (nestedError.success) {
      return [failure(nestedError.data.error.code, nestedError.data.error.message)];
    }

    const cliError = CliErrorSchema.safeParse(frame);
    if (cliError.success) {
      const text = cliError.data.message;
      return text.trim() === "" ? [] : [{ type: "notice", text }];
    }

    const completed = CompletedSchema.safeParse(frame);
    if (completed.success) {
      const text = completed.data.response?.output_text;
      return [text === undefined ? { type: "complete" } : { type: "complete", output: { text } }];
    }

    const message = MessageSchema.safeParse(frame);
    if (message.success) {
      return message.data.content
        .filter((block): block is { type: "output_text"; text: string } => {
          return (
            block.type === "output_text" && typeof (block as { text?: unknown }).text === "string"
          );
        })
        .map((block) => ({ type: "message", text: block.text }) as const);
    }

    const prose = AgentMessageItemSchema.safeParse(frame);
    if (prose.success) {
      const text = prose.data.item.text;
      return text.trim() === "" ? [] : [{ type: "message", text }];
    }

    if (TurnCompletedSchema.safeParse(frame).success) {
      // No output here: the driver joins the messages read above into the
      // turn's output, so a turn answered in prose has that prose.
      return [{ type: "complete" }];
    }

    const failedTurn = TurnFailedSchema.safeParse(frame);
    if (failedTurn.success) {
      const reason = failedTurn.data.error?.message;
      return [
        {
          type: "failed",
          error: {
            code: "harness_failed",
            message:
              reason === undefined || reason.trim() === ""
                ? "The Codex CLI reported a failed turn."
                : reason,
            retryable: true,
          },
        },
      ];
    }

    return [];
  },

  encodeToolResult(result: ToolResult): HarnessFrame {
    return {
      type: "function_call_output",
      call_id: result.callId,
      output: JSON.stringify(toolResultBody(result)),
    };
  },
};

/**
 * A Responses failure as a failed step. The vendor's code is kept when the
 * frame names one, and its text always: "401 Unauthorized" is the one detail
 * an operator needs, and a generic line in its place would lose it.
 */
function failure(code: string | null | undefined, message: string | undefined): HarnessStep {
  return {
    type: "failed",
    error: {
      code: code ?? "harness_failed",
      message:
        message === undefined || message.trim() === ""
          ? "The Codex harness reported a failure."
          : message,
      retryable: true,
    },
  };
}
