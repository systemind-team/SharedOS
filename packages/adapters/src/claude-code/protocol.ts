import type { JsonObject, JsonValue, ToolDefinition, ToolResult } from "@aicoo/sharedos-contracts";
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

/**
 * What a failed result says when Claude wrote no text for it.
 *
 * Claude ends a run it stopped itself, at `--max-turns` for one, with a
 * subtype and no `result`. The subtype is then the only reason there is, so
 * it is named rather than dropped for a generic line. `num_turns` is read
 * loosely: a count in a shape this does not expect leaves the count out, and
 * never the frame.
 */
function failureMessage(subtype: string | undefined, turns: unknown): string {
  if (subtype === "error_max_turns") {
    const after =
      typeof turns === "number" && Number.isInteger(turns) && turns > 0
        ? ` after ${String(turns)} model turns`
        : "";
    return `Claude Code stopped at its turn limit${after} (error_max_turns).`;
  }
  return subtype === undefined
    ? "The Claude Code harness reported a failure."
    : `The Claude Code harness reported a failure (${subtype}).`;
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
      if (result.data.is_error === true || result.data.subtype === "error") {
        return [
          {
            type: "failed",
            error: {
              code: result.data.subtype ?? "harness_failed",
              message:
                result.data.result ?? failureMessage(result.data.subtype, result.data["num_turns"]),
              retryable: true,
            },
          },
        ];
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
