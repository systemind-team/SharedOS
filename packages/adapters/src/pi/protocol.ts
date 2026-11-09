import type { JsonObject, JsonValue, ToolDefinition, ToolResult } from "@aicoo/sharedos-contracts";
import { z } from "zod";

import type { HarnessFrame, HarnessProtocol, HarnessStep } from "../harness.js";
import { toolResultBody } from "../internal.js";
import { TextBlockSchema, UnknownBlockSchema, contentBlockSteps } from "../protocol-base.js";

/**
 * Pi speaks newline-delimited JSON events in its RPC mode (`pi --mode rpc`).
 *
 * The message vocabulary is the layer this module targets: an `AssistantMessage`
 * whose content carries `toolCall` blocks, a `ToolResultMessage` carrying the
 * result back, and the `agent_end` / `response` frames that end a turn. It is
 * deliberately not Pi's streaming delta events, which restate the same content
 * token by token; Pi's own guidance is to treat the assembled message as
 * authoritative, and reading both would issue every call twice.
 *
 * Two asymmetries are worth stating plainly, because both are properties of the
 * harness rather than of this adapter:
 *
 * - Pi does not declare tools on the RPC wire. Its paths for a host-supplied
 *   tool are `defineTool` through the SDK and the native MCP client it has
 *   shipped since 0.99, which is how the MCP column reaches it;
 *   {@link HarnessProtocol.describeTools} renders the `defineTool` shape and no
 *   frame is emitted for it.
 * - Pi executes its own tools. `tool_execution_start` announces a call Pi is
 *   already running, not a request for the host to run one, so it is not read
 *   as a tool call. The `toolCall` content block -- the model's actual request
 *   -- is.
 */
export const PI_PROTOCOL_ID = "pi.rpc.jsonl";

const ToolCallBlockSchema = z.object({
  type: z.literal("toolCall"),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Pi carries assembled arguments as an object, not as a JSON string. */
  arguments: z.record(z.unknown()).optional(),
});

const AssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.array(z.union([TextBlockSchema, ToolCallBlockSchema, UnknownBlockSchema])),
    stopReason: z.string().optional(),
  })
  .passthrough();

const MessageEndSchema = z
  .object({ type: z.literal("message_end"), message: AssistantMessageSchema })
  .passthrough();

const AgentEndSchema = z
  .object({
    type: z.literal("agent_end"),
    willRetry: z.boolean().optional(),
  })
  .passthrough();

/**
 * A failed RPC command, which Pi answers on the same wire as its events.
 *
 * `success: false` is the harness refusing the request outright, which is a
 * failed turn rather than a turn that produced nothing.
 */
const ResponseSchema = z
  .object({
    type: z.literal("response"),
    command: z.string().optional(),
    success: z.boolean(),
    error: z.string().optional(),
  })
  .passthrough();

const ErrorSchema = z
  .object({
    type: z.literal("error"),
    error: z.unknown().optional(),
    message: z.string().optional(),
  })
  .passthrough();

function toolCallStep(block: unknown): HarnessStep | undefined {
  const toolCall = ToolCallBlockSchema.safeParse(block);
  return toolCall.success
    ? {
        type: "tool_call",
        callId: toolCall.data.id,
        tool: toolCall.data.name,
        arguments: (toolCall.data.arguments ?? {}) as JsonObject,
      }
    : undefined;
}

export const piProtocol: HarnessProtocol = {
  id: PI_PROTOCOL_ID,

  describeTools(tools: readonly ToolDefinition[]): JsonValue {
    return tools.map((tool) => ({
      name: tool.name,
      // Pi shows `label` in its UI and requires it on a defined tool. The tool
      // name is used rather than inventing prose, so nothing here is a second
      // description that could drift from the first.
      label: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })) as unknown as JsonValue;
  },

  interpret(frame: HarnessFrame): readonly HarnessStep[] {
    const end = MessageEndSchema.safeParse(frame);
    if (end.success) {
      return contentBlockSteps(end.data.message.content, toolCallStep);
    }

    const response = ResponseSchema.safeParse(frame);
    if (response.success && !response.data.success) {
      return [
        {
          type: "failed",
          error: {
            code: "harness_command_rejected",
            message:
              response.data.error ??
              `Pi rejected the ${response.data.command ?? "requested"} command.`,
            retryable: true,
          },
        },
      ];
    }

    const failure = ErrorSchema.safeParse(frame);
    if (failure.success) {
      return [
        {
          type: "failed",
          error: {
            code: "harness_failed",
            message: failure.data.message ?? "The Pi harness reported a failure.",
            retryable: true,
          },
        },
      ];
    }

    const agentEnd = AgentEndSchema.safeParse(frame);
    if (agentEnd.success) {
      // A retrying run has not finished; ending the turn here would report an
      // outcome the harness has not reached.
      return agentEnd.data.willRetry === true ? [] : [{ type: "complete" }];
    }

    return [];
  },

  /**
   * A tool result goes back as Pi's own `toolResult` message. A denial is
   * reported with `isError`, so the harness learns it was refused rather than
   * being told the call crashed.
   *
   * Pi correlates on `toolCallId` alone, but `toolName` is carried too because
   * Pi's own results do: a result that omitted it would be the one shape on
   * this wire the harness never produces.
   */
  encodeToolResult(result: ToolResult): HarnessFrame {
    return {
      role: "toolResult",
      toolCallId: result.callId,
      toolName: result.tool,
      content: [{ type: "text", text: JSON.stringify(toolResultBody(result)) }],
      isError: result.status !== "succeeded",
    };
  },
};
