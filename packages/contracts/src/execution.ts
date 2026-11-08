import { z } from "zod";

import { AccessContextSchema } from "./access.js";
import { AddressSchema, AgentAddressSchema } from "./address.js";
import { CapabilityRequestSchema } from "./capability.js";
import { IdentifierSchema, ProtocolVersionSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { MessageEnvelopeSchema } from "./message.js";
import { ProtocolErrorSchema } from "./protocol-error.js";
import { ToolDefinitionSchema } from "./tool.js";

/**
 * The limits a host sets on one turn. Each is unset unless the host sets it,
 * and an unset limit is no limit: SharedOS adds no ceiling of its own.
 */
export const ExecutionOptionsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type ExecutionOptions = z.infer<typeof ExecutionOptionsSchema>;

/** One permission-controlled agent turn. Tick scheduling stays with the host. */
export const ExecutionRequestSchema = z
  .object({
    version: ProtocolVersionSchema,
    executionId: IdentifierSchema,
    agent: AgentAddressSchema,
    context: AccessContextSchema,
    message: MessageEnvelopeSchema,
    tools: z.array(ToolDefinitionSchema),
    state: JsonObjectSchema.optional(),
    options: ExecutionOptionsSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

/** An append-only event emitted while executing a request. */
export const ExecutionEventSchema = z
  .object({
    version: ProtocolVersionSchema,
    eventId: IdentifierSchema,
    executionId: IdentifierSchema,
    traceId: IdentifierSchema,
    sequence: z.number().int().nonnegative(),
    type: z.string().trim().min(1).max(128),
    data: JsonValueSchema,
    occurredAt: TimestampSchema,
  })
  .strict();

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

/**
 * A stopped turn awaiting a human decision.
 *
 * This is a stub by design. SharedOS records that authority was asked for, who
 * would decide it, and when -- and nothing else. It does not model review
 * queues, approval tokens, or resumption, because granting authority is
 * host-owned control-plane work and an escalation that could be resolved from
 * inside a turn would be an escalation an agent could grant itself.
 *
 * `reviewer` is assumed rather than resolved: it is the owner the turn already
 * runs on behalf of. A host with a real review roster substitutes its own.
 */
export const EscalationSchema = z
  .object({
    reason: z.string().trim().min(1),
    reviewer: AddressSchema,
    requestedAt: TimestampSchema,
    /**
     * The authority this escalation is asking for, when it can name one.
     *
     * `reason` is what a model wrote; this is what a control plane can act on.
     * Resolution is unchanged and still host-owned -- the host turns the request
     * into a grant and the next turn loads it -- but it no longer has to
     * reconstruct the resource, action, owner, and purpose from a sentence
     * before it can do so (ADR 0019).
     *
     * Optional because an escalation a model chose may be about something no
     * capability describes.
     */
    requestedAuthority: CapabilityRequestSchema.optional(),
    /** Always pending. Nothing inside SharedOS advances it. */
    status: z.literal("pending"),
  })
  .strict();

export type Escalation = z.infer<typeof EscalationSchema>;

const ExecutionResultBaseSchema = z.object({
  version: ProtocolVersionSchema,
  executionId: IdentifierSchema,
  traceId: IdentifierSchema,
  events: z.array(ExecutionEventSchema),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  metadata: JsonObjectSchema.optional(),
});

export const ExecutionResultSchema = z.discriminatedUnion("status", [
  ExecutionResultBaseSchema.extend({
    status: z.literal("succeeded"),
    output: JsonValueSchema,
  }).strict(),
  ExecutionResultBaseSchema.extend({
    status: z.literal("denied"),
    error: ProtocolErrorSchema,
  }).strict(),
  ExecutionResultBaseSchema.extend({
    status: z.literal("failed"),
    error: ProtocolErrorSchema,
  }).strict(),
  ExecutionResultBaseSchema.extend({
    status: z.literal("cancelled"),
    error: ProtocolErrorSchema.optional(),
  }).strict(),
  ExecutionResultBaseSchema.extend({
    status: z.literal("escalated"),
    escalation: EscalationSchema,
  }).strict(),
]);

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
