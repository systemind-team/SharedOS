import { z } from "zod";

import { AddressSchema } from "./address.js";
import { CapabilityRequestSchema, ResourceRefSchema } from "./capability.js";
import { IdentifierSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";

export const AuditEventTypeSchema = z.enum([
  "authority.resolved",
  "authorization.checked",
  "escalation.requested",
  /**
   * An escalation answered from precedent instead of by a person.
   *
   * Written by the host's control plane through `@aicoo/sharedos-precedent`,
   * never by a turn: the turn that escalated ended when it escalated. Its
   * outcome is `allowed` or `denied` -- a decision that was made -- and its
   * metadata names the matcher and the precedents cited, which is how an
   * operator selects everything one matcher produced. See ADR 0022 R4.
   */
  "escalation.auto_decided",
  "resource.invoked",
  "tool.catalog.listed",
  "tool.namespace.catalog.listed",
  "tool.namespace.selection.updated",
  "tool.invoked",
  "message.sent",
  "turn.ended",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/**
 * `escalated` is its own outcome, not a denial.
 *
 * A denial is a decision SharedOS made. An escalation is a decision it declined
 * to make and handed to a human, and counting the two together would inflate
 * every denial rate by the cases where the system correctly asked for help.
 *
 * `interrupted` is its own outcome, not a failure. It is written for an
 * operation whose port was entered and stopped before it answered -- a turn that
 * timed out or was cancelled mid-call, or an audit outage under a decision the
 * port itself asked for -- so any part of its effect may have committed.
 * `failed` also covers refusals where nothing ran, and a reader that took an
 * interrupted call for one of those would retry something already done.
 */
export const AuditOutcomeSchema = z.enum([
  "allowed",
  "denied",
  "succeeded",
  "failed",
  "escalated",
  "interrupted",
]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * Which enforcement boundary performed or refused what an event records.
 *
 * It was free to infer until the execution envelope began recording as well --
 * anything in audit was the kernel's, because the envelope wrote nothing -- and
 * the moment that stopped being true it became a fact with nowhere to live.
 * ADR 0012 keeps one refusal vocabulary across both boundaries on purpose: a
 * code says what was refused, and this says who refused it (ADR 0023).
 */
export const AuditSourceSchema = z.enum(["kernel", "envelope"]);
export type AuditSource = z.infer<typeof AuditSourceSchema>;

/**
 * One audit record, the durable shape a host persists.
 *
 * The rule for where a fact lives (ADR 0023): what SharedOS itself states about
 * every event of a kind is a field, typed here; `metadata` holds what a host
 * port supplied and the details particular to one event type. The two were one
 * untyped bag until a port's metadata began to be recorded beside the kernel's
 * own flags, at which point a port could overwrite a flag the kernel had not
 * set. Fields cannot be collided with.
 *
 * The kernel-stated fields, since an inferred type renders here without them:
 * `source` (`kernel` or `envelope`, who performed or refused the operation;
 * never on `turn.ended`), `cause` (which situation a coarse `reason` stood in
 * for, on `tool.invoked`), `failClosed` (present and `true` when SharedOS could
 * not establish a fact and refused rather than guess), `consumed` (whether a
 * bounded use was spent, on `authorization.checked`), `endedBy` (`envelope` or
 * `runtime`, who ended a failed turn), `requestedAuthority` (what an escalation
 * asks for), and `id`, the record's identity and the only safe idempotency key.
 * `docs/errors.md`, "Audit events", has the table and the `metadata` keys a host
 * may rely on per event type.
 */
export const AuditEventSchema = z
  .object({
    version: z.literal("1"),
    /**
     * The identity of this record, unique among every record a kernel emits.
     *
     * Minted when the event is made and never derived from its content. Two
     * records may agree on every other field: `at` is the turn's instant rather
     * than the emission's, and a bare `authorize` carries no `operationId`, so
     * the same question asked twice in one turn is two records that read the
     * same. A durable sink that needs an idempotency key -- for a retried
     * batch, a replayed outbox -- keys on this and on nothing else. Keying on a
     * hash of the content drops every repeat as a duplicate, and a repeat is
     * not a duplicate: an agent that asked twice is an agent that asked twice.
     */
    id: IdentifierSchema,
    type: AuditEventTypeSchema,
    outcome: AuditOutcomeSchema,
    at: TimestampSchema,
    traceId: IdentifierSchema,
    namespaceId: IdentifierSchema,
    actor: AddressSchema,
    authority: AddressSchema,
    owner: AddressSchema,
    purpose: z.string().trim().min(1),
    resource: ResourceRefSchema.optional(),
    action: IdentifierSchema.optional(),
    grantId: IdentifierSchema.optional(),
    /**
     * Content identifier of the exact authority set the decision was made
     * against. A turn resolves authority once, so every decision in it carries
     * the same value; the `authority.resolved` event that opened the turn
     * carries the grant ids behind it.
     */
    authorityHash: IdentifierSchema.optional(),
    operationId: IdentifierSchema.optional(),
    tool: IdentifierSchema.optional(),
    messageId: IdentifierSchema.optional(),
    receiver: AddressSchema.optional(),
    /** The code the caller was given, where the outcome had one. */
    reason: IdentifierSchema.optional(),
    /**
     * Which boundary performed or refused the operation. On the operation
     * events and the catalogue listing; never "who recorded", which for a
     * `turn.ended` is always the envelope and so says nothing.
     */
    source: AuditSourceSchema.optional(),
    /**
     * Which situation a coarse `reason` stood in for, on `tool.invoked`.
     *
     * `tool_unavailable` is one code over "not registered", "namespace
     * disabled", "not discoverable to you" and "not offered this turn", and
     * `message_request_not_accepted` is one code over whatever the transport
     * answered, so that a caller cannot map what it may not reach. An audit
     * reader is not the caller. `reason` stays the code the caller was given
     * and this says which one it was.
     */
    cause: IdentifierSchema.optional(),
    /**
     * Present and `true` when SharedOS failed closed: it could not establish a
     * fact, and refused rather than guess. Exclude these before computing a
     * denial rate; a deliberate refusal never carries it.
     */
    failClosed: z.boolean().optional(),
    /** Whether a bounded use was spent, on `authorization.checked`. */
    consumed: z.boolean().optional(),
    /**
     * Who ended a failed turn, on `turn.ended`: the envelope refusing, or the
     * runtime reporting its own failure. A reader crediting enforcement must
     * not credit a plugin's self-reported error.
     */
    endedBy: z.enum(["envelope", "runtime"]).optional(),
    /**
     * The authority an escalation is asking for, when it names one.
     *
     * A field rather than something folded into `metadata`, for the same reason
     * `resource` is: it is a contract type with its own schema, and a
     * reviewer's queue built from audit reads it directly rather than trusting
     * that an untyped bag holds the right shape (ADR 0019).
     */
    requestedAuthority: CapabilityRequestSchema.optional(),
    /** What a host port supplied, and the details particular to one event type. */
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type AuditEvent = z.infer<typeof AuditEventSchema>;
