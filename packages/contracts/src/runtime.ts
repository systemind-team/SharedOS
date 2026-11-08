import { z } from "zod";

import { IdentifierSchema, ProtocolVersionSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { ProtocolErrorSchema } from "./protocol-error.js";

/** Stable, JSON-safe provenance for one installed runtime implementation. */
export const RuntimeManifestSchema = z
  .object({
    id: IdentifierSchema,
    version: IdentifierSchema,
    protocolVersion: ProtocolVersionSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;

/** A runtime-originated observation. The SharedOS envelope assigns its audit identity. */
export const RuntimeEventSchema = z
  .object({
    type: IdentifierSchema,
    data: JsonValueSchema,
  })
  .strict();

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

const RuntimeTurnOutcomeBaseSchema = z.object({
  metadata: JsonObjectSchema.optional(),
});

/**
 * The only terminal outcomes a runtime plugin may return for one bounded turn.
 *
 * `escalate` is a third terminal state rather than a flavour of `fail`. A turn
 * that stopped because it needed authority it does not hold is a different
 * event from one that was refused and from one that erred, and collapsing it
 * into either would make "the agent asked for help" unrecoverable from the
 * record. It grants nothing: SharedOS records the request, names the reviewer
 * the host would route it to, and stops.
 */
export const RuntimeTurnOutcomeSchema = z.discriminatedUnion("type", [
  RuntimeTurnOutcomeBaseSchema.extend({
    type: z.literal("complete"),
    output: JsonValueSchema,
  }).strict(),
  RuntimeTurnOutcomeBaseSchema.extend({
    type: z.literal("fail"),
    error: ProtocolErrorSchema,
  }).strict(),
  RuntimeTurnOutcomeBaseSchema.extend({
    type: z.literal("escalate"),
    /** Why the turn stopped and what it needs a human to decide. */
    reason: z.string().trim().min(1),
  }).strict(),
]);

export type RuntimeTurnOutcome = z.infer<typeof RuntimeTurnOutcomeSchema>;
