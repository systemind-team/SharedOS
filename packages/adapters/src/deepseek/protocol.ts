import type { JsonObject, JsonValue, ToolDefinition, ToolResult } from "@aicoo/sharedos-contracts";
import { z } from "zod";

import type { HarnessFrame, HarnessProtocol, HarnessStep } from "../harness.js";
import { parseToolArguments, toolResultBody } from "../internal.js";
import { TextBlockSchema, UnknownBlockSchema, contentBlockSteps } from "../protocol-base.js";
import { TURN_END_FAILURES, turnEndCode } from "./turn-end.js";

/**
 * DeepSeek Harness speaks its own session-log vocabulary over a
 * newline-delimited JSON-RPC 2.0 stdio transport.
 *
 * That vocabulary is the layer this module targets: `tool/call` carrying the
 * model's raw argument string, `assistant/message` carrying assembled content
 * blocks, and `turn/end` carrying a structured reason. It is deliberately not
 * the `dsh` CLI's command-line surface, which is a plugin composition that
 * varies per deployment. What carries these frames -- the SDK runtime server,
 * the ACP bridge, or a recorded log -- is the transport's problem.
 *
 * One asymmetry is worth stating plainly, because it is a property of the
 * harness rather than of this adapter. DeepSeek Harness executes its own tools:
 * its wire has no frame meaning "here is your catalogue". A host that wants the
 * catalogue to be the permission-filtered one must deliver it out of band, and
 * the harness's own path for that is an MCP server (`dsh-mcp-client`). So
 * {@link HarnessProtocol.describeTools} renders the harness's `ToolSchema` shape, which is what
 * that out-of-band channel carries, and no frame is emitted for it.
 */
export const DEEPSEEK_PROTOCOL_ID = "deepseek.harness.session-events";

const ToolCallBlockSchema = z.object({
  type: z.literal("tool-call"),
  id: z.string().min(1),
  name: z.string().min(1),
  /** The harness carries model arguments as a raw JSON string, unparsed. */
  arguments: z.string(),
});

/**
 * A session-log event, either bare or inside its `session.event` notification.
 *
 * The SDK runtime wraps every event in a JSON-RPC notification; a recorded log
 * holds the bare envelopes. Both are accepted because they carry the identical
 * event and refusing one would make a replayed log and a live session speak
 * different protocols.
 */
const EventEnvelopeSchema = z
  .object({
    type: z.string().min(1),
    data: z.record(z.unknown()),
  })
  .passthrough();

const NotificationSchema = z
  .object({
    method: z.literal("session.event"),
    params: z.object({ event: EventEnvelopeSchema }).passthrough(),
  })
  .passthrough();

const ToolCallEventSchema = z
  .object({ callId: z.string().min(1), name: z.string().min(1), arguments: z.string() })
  .passthrough();

const AssistantMessageEventSchema = z
  .object({
    message: z
      .object({
        content: z.array(z.union([TextBlockSchema, ToolCallBlockSchema, UnknownBlockSchema])),
      })
      .passthrough(),
  })
  .passthrough();

const TurnEndEventSchema = z
  .object({
    reason: z
      .object({
        kind: z.string().min(1),
        error: z
          .object({ code: z.string().optional(), message: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const deepseekProtocol: HarnessProtocol = {
  id: DEEPSEEK_PROTOCOL_ID,

  describeTools(tools: readonly ToolDefinition[]): JsonValue {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })) as unknown as JsonValue;
  },

  interpret(frame: HarnessFrame): readonly HarnessStep[] {
    const event = readEvent(frame);
    if (event === undefined) {
      return [];
    }

    if (event.type === "tool/call") {
      const call = ToolCallEventSchema.safeParse(event.data);
      if (!call.success) {
        return [];
      }
      const parsed = parseToolArguments(call.data.arguments);
      return parsed === undefined
        ? [
            {
              type: "failed",
              error: {
                code: "harness_arguments_unparseable",
                message: "DeepSeek Harness sent tool arguments that are not a JSON object.",
              },
            },
          ]
        : [
            {
              type: "tool_call",
              callId: call.data.callId,
              tool: call.data.name,
              arguments: parsed,
            },
          ];
    }

    if (event.type === "assistant/message") {
      const assistant = AssistantMessageEventSchema.safeParse(event.data);
      if (!assistant.success) {
        return [];
      }
      // Prose only. A tool call reaches the turn through `tool/call`, which is
      // the event the harness pairs with its result; reading the block here as
      // well would issue every call twice.
      return contentBlockSteps(assistant.data.message.content);
    }

    if (event.type === "turn/end") {
      const end = TurnEndEventSchema.safeParse(event.data);
      if (!end.success) {
        return [];
      }
      // A turn the harness abandoned is reported as a failed turn rather than
      // as a quiet completion, so a harness that gave up cannot be mistaken
      // for one that answered.
      const kind = end.data.reason.kind;
      const failure = TURN_END_FAILURES[kind];
      if (failure === undefined) {
        return [{ type: "complete" }];
      }
      return [
        {
          type: "failed",
          error: {
            code: end.data.reason.error?.code ?? turnEndCode(kind),
            message: end.data.reason.error?.message ?? failure,
            retryable: true,
          },
        },
      ];
    }

    return [];
  },

  /**
   * A tool result goes back as a prompt carrying one `tool-result` block, which
   * is how this harness represents a result returning to the model. A denial is
   * reported with `isError`, so the harness learns it was refused rather than
   * being told the call crashed.
   *
   * `sessionId` is stamped by the transport, which owns session identity; the
   * protocol translates content and nothing else.
   */
  encodeToolResult(result: ToolResult): HarnessFrame {
    return {
      jsonrpc: "2.0",
      method: "session/prompt",
      params: {
        contentBlocks: [
          {
            type: "tool-result",
            toolCallId: result.callId,
            content: [{ type: "text", text: JSON.stringify(toolResultBody(result)) }],
            isError: result.status !== "succeeded",
          },
        ],
      },
    };
  },
};

/** The session-log event a frame carries, wrapped or bare. */
function readEvent(frame: HarnessFrame): { type: string; data: JsonObject } | undefined {
  const notification = NotificationSchema.safeParse(frame);
  if (notification.success) {
    const event = notification.data.params.event;
    return { type: event.type, data: event.data as JsonObject };
  }
  const bare = EventEnvelopeSchema.safeParse(frame);
  return bare.success ? { type: bare.data.type, data: bare.data.data as JsonObject } : undefined;
}
