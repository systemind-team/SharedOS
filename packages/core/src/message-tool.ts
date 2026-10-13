import type {
  AccessContext,
  MessageDeliveryResult,
  MessageEnvelope,
  ToolCall,
  ToolDefinition,
} from "@aicoo/sharedos-contracts";
import {
  MessageEnvelopeSchema,
  MessageRequestArgumentsSchema,
  PROTOCOL_VERSION,
} from "@aicoo/sharedos-contracts";

import { addressesEqual } from "./authorization.js";
import type { ProviderErrorContext } from "./diagnostics.js";
import {
  MESSAGE_SEND_ACTION,
  MESSAGING_NAMESPACE,
  type MessageCapabilityResolver,
  type MessageRequestRouter,
} from "./message-service.js";
import type { ToolHandler } from "./tool-registry.js";
import { deepFreeze, refusedToolResult } from "./internal.js";

export const MESSAGE_TOOL_NAMESPACE = "messages";
export const MESSAGE_REQUEST_TOOL_NAME = "messages.request";

export const MESSAGE_REQUEST_TOOL_DEFINITION: ToolDefinition = {
  name: MESSAGE_REQUEST_TOOL_NAME,
  description: "Send an authorized request to another agent and wait for its durable reply",
  namespace: MESSAGE_TOOL_NAMESPACE,
  source: "sharedos",
  readWrite: "write",
  inputSchema: {
    type: "object",
    properties: {
      recipient: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "human" },
              userId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: "^(?!\\s)[\\s\\S]*\\S$",
              },
            },
            required: ["kind", "userId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "agent" },
              agentId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: "^(?!\\s)[\\s\\S]*\\S$",
              },
            },
            required: ["kind", "agentId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "group" },
              conversationId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: "^(?!\\s)[\\s\\S]*\\S$",
              },
            },
            required: ["kind", "conversationId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "service" },
              serviceId: {
                type: "string",
                minLength: 1,
                maxLength: 256,
                pattern: "^(?!\\s)[\\s\\S]*\\S$",
              },
            },
            required: ["kind", "serviceId"],
            additionalProperties: false,
          },
        ],
      },
      payload: {},
    },
    required: ["recipient", "payload"],
    additionalProperties: false,
  },
  /**
   * The reply payload, whose shape is the recipient's and not ours to declare.
   *
   * `{ type: "object" }` rather than `{}`: MCP types `outputSchema` as an object
   * schema, and the reference SDK validates that literally -- a `tools/list`
   * carrying a typeless one is rejected whole, so every tool in the catalogue
   * disappears along with it. Clients that skip the check connect regardless,
   * which is what makes this worth spelling out here: the same catalogue reaches
   * one harness intact and another not at all.
   */
  outputSchema: { type: "object" },
  requiredCapability: {
    resource: { namespace: MESSAGING_NAMESPACE, path: [] },
    action: MESSAGE_SEND_ACTION,
  },
  annotations: { readOnly: false, destructive: true, idempotent: false },
};

/**
 * How this tool hands an authorized envelope to the kernel for delivery.
 *
 * It passes the call, not the call's id. The kernel records the dispatch under
 * the id and, when the transport refuses it, keeps the transport's code against
 * the call object so the tool's own record can name it as its `cause`. The
 * object is the key for the reason it is the key below: an id is something a
 * caller chose, and two calls in flight can share one.
 */
export type AuthorizedMessageDelivery = (
  context: AccessContext,
  envelope: MessageEnvelope,
  signal: AbortSignal,
  call: ToolCall,
) => Promise<MessageDeliveryResult>;

/**
 * How this tool hands a contained throw back to the kernel's diagnostic sink.
 *
 * The tool is built per invocation inside the kernel and holds no options of its
 * own, so the reporter is passed in rather than read: the trace and namespace
 * are filled in from the context the *handler* was called with, which is the
 * one the operation was decided against.
 */
export type MessageRequestErrorReporter = (
  error: unknown,
  context: AccessContext,
  operation: Omit<ProviderErrorContext, "traceId" | "namespaceId">,
) => void;

export interface MessageRequestToolOptions {
  readonly capabilityResolver: MessageCapabilityResolver;
  readonly router: MessageRequestRouter;
  readonly createMessageId: (context: AccessContext, call: ToolCall) => string;
  readonly deliverAuthorizedMessage: AuthorizedMessageDelivery;
  readonly reportProviderError?: MessageRequestErrorReporter;
}

/**
 * Create the message-request handler.
 *
 * `resolveRequirement` builds the envelope the kernel then authorizes, and
 * `invoke` must send *that* envelope rather than rebuild one -- what was
 * authorized and what is delivered would otherwise be two separate readings of
 * the same arguments. The envelope is therefore carried between the two hooks,
 * keyed on the call object itself.
 *
 * On the call object, not on the handler and not on `call.id`. A handler with
 * one prepared slot is only safe while no two calls are in flight through it,
 * which stopped being true when the kernel began holding one effective
 * catalogue for a whole turn (ADR 0026): concurrent calls then shared this
 * handler, and the second to resolve its requirement overwrote the first's
 * envelope. Keying on `call.id` narrows that to calls that share an id, where
 * it is worse -- the guard below passes and one call's authorization decision
 * is spent on another call's recipient. The kernel passes one frozen `ToolCall`
 * to both hooks, so the object itself is the only key that identifies the call
 * rather than something a caller chose.
 */
export function createMessageRequestTool(options: MessageRequestToolOptions): ToolHandler {
  const prepared = new WeakMap<
    ToolCall,
    { readonly callId: string; readonly envelope: MessageEnvelope }
  >();

  return {
    definition: MESSAGE_REQUEST_TOOL_DEFINITION,
    parseArguments(arguments_) {
      return MessageRequestArgumentsSchema.parse(arguments_);
    },
    resolveRequirement(context, call) {
      const trustedContext = deepFreeze(structuredClone(context));
      const trustedCall = deepFreeze(structuredClone(call));
      const arguments_ = MessageRequestArgumentsSchema.parse(trustedCall.arguments);
      const envelope = deepFreeze(
        MessageEnvelopeSchema.parse({
          version: PROTOCOL_VERSION,
          id: options.createMessageId(structuredClone(trustedContext), call),
          sender: trustedContext.actor,
          receiver: arguments_.recipient,
          purpose: trustedContext.purpose,
          payload: arguments_.payload,
          traceId: trustedContext.traceId,
          createdAt: trustedContext.now,
        }),
      );
      const requirement = options.capabilityResolver.resolve(
        structuredClone(trustedContext),
        structuredClone(envelope),
      );
      prepared.set(call, { callId: call.id, envelope });
      return requirement;
    },
    async invoke(context, call, signal) {
      const held = prepared.get(call);
      if (held === undefined || held.callId !== call.id) {
        return refusedToolResult(
          call,
          "failed",
          context.now,
          "message_request_not_prepared",
          "The message request was not prepared for authorization",
        );
      }

      const request = held.envelope;
      const delivery = await options.deliverAuthorizedMessage(
        context,
        structuredClone(request),
        signal,
        call,
      );
      if (delivery.status !== "accepted" && delivery.status !== "delivered") {
        return refusedToolResult(
          call,
          "failed",
          context.now,
          "message_request_not_accepted",
          "The message request was not accepted for delivery",
        );
      }

      signal.throwIfAborted();
      let candidate: MessageEnvelope;
      try {
        candidate = await options.router.resolveReply(
          structuredClone(context),
          structuredClone(request),
          structuredClone(delivery),
          signal,
        );
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        // The router is a host port like any other, and the code it is answered
        // with is documented like any other; the error behind it was the one
        // that had nowhere to go.
        options.reportProviderError?.(error, context, {
          kind: "message",
          reasonCode: "message_reply_resolution_failed",
          operationId: call.id,
          tool: call.tool,
        });
        return refusedToolResult(
          call,
          "failed",
          context.now,
          "message_reply_resolution_failed",
          "The message router could not resolve a reply",
        );
      }

      const parsed = MessageEnvelopeSchema.safeParse(candidate);
      if (!parsed.success || !replyMatchesRequest(parsed.data, request)) {
        return refusedToolResult(
          call,
          "failed",
          context.now,
          "invalid_message_reply",
          "The message router returned an invalid reply",
        );
      }

      return {
        callId: call.id,
        tool: call.tool,
        status: "succeeded",
        output: parsed.data.payload,
        completedAt: context.now,
      };
    },
  };
}

function replyMatchesRequest(reply: MessageEnvelope, request: MessageEnvelope): boolean {
  return (
    reply.replyTo === request.id &&
    addressesEqual(reply.sender, request.receiver) &&
    addressesEqual(reply.receiver, request.sender) &&
    reply.purpose === request.purpose &&
    reply.traceId === request.traceId
  );
}
