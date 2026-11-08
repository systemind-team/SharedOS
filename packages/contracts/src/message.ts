import { z } from "zod";

import { AddressSchema } from "./address.js";
import { IdentifierSchema, ProtocolVersionSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { ProtocolErrorSchema } from "./protocol-error.js";

/**
 * Hop provenance a host may attach to an envelope. It is host-owned metadata:
 * the kernel checks its shape with the rest of the envelope, neither sets nor
 * reads it, and hands it to the transport as the host sent it.
 */
export const MessageProvenanceSchema = z
  .object({
    source: IdentifierSchema,
    parentIds: z.array(IdentifierSchema),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type MessageProvenance = z.infer<typeof MessageProvenanceSchema>;

/**
 * A message carries data and one host-bound purpose, never authority. Authority
 * is supplied separately through AccessContext and evaluated at the point of use.
 */
export const MessageEnvelopeSchema = z
  .object({
    version: ProtocolVersionSchema,
    id: IdentifierSchema,
    sender: AddressSchema,
    receiver: AddressSchema,
    purpose: z.string().trim().min(1),
    payload: JsonValueSchema,
    traceId: IdentifierSchema,
    createdAt: TimestampSchema,
    replyTo: IdentifierSchema.optional(),
    provenance: MessageProvenanceSchema.optional(),
  })
  .strict();

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

const MessageRequestRecipientIdentifierSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, {
    message: "recipient identifiers must not have leading or trailing whitespace",
  });

const MessageRequestRecipientAddressSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), userId: MessageRequestRecipientIdentifierSchema }).strict(),
  z.object({ kind: z.literal("agent"), agentId: MessageRequestRecipientIdentifierSchema }).strict(),
  z
    .object({ kind: z.literal("group"), conversationId: MessageRequestRecipientIdentifierSchema })
    .strict(),
  z
    .object({ kind: z.literal("service"), serviceId: MessageRequestRecipientIdentifierSchema })
    .strict(),
]);

/** The complete and intentionally narrow message input a model may author. */
export const MessageRequestArgumentsSchema = z
  .object({
    recipient: MessageRequestRecipientAddressSchema,
    payload: JsonValueSchema,
  })
  .strict();

export type MessageRequestArguments = z.infer<typeof MessageRequestArgumentsSchema>;

const MessageDeliveryBaseSchema = z.object({
  messageId: IdentifierSchema,
  timestamp: TimestampSchema,
  metadata: JsonObjectSchema.optional(),
});

/** The transport-neutral outcome of submitting a message for delivery. */
export const MessageDeliveryResultSchema = z.discriminatedUnion("status", [
  MessageDeliveryBaseSchema.extend({ status: z.literal("accepted") }).strict(),
  MessageDeliveryBaseSchema.extend({ status: z.literal("delivered") }).strict(),
  MessageDeliveryBaseSchema.extend({
    status: z.literal("denied"),
    error: ProtocolErrorSchema,
  }).strict(),
  MessageDeliveryBaseSchema.extend({
    status: z.literal("failed"),
    error: ProtocolErrorSchema,
  }).strict(),
]);

export type MessageDeliveryResult = z.infer<typeof MessageDeliveryResultSchema>;
