import { z } from "zod";

import { AddressSchema } from "./address.js";
import { IdentifierSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";

/**
 * One opaque resource-path segment.
 *
 * Separators, traversal markers, and control characters are rejected here so
 * every host receives the same canonical path vocabulary. Filesystem-backed
 * providers must still resolve beneath their configured root and reject
 * symlink escapes.
 */
export const PathSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$/u, {
    message: "path segments must not contain traversal markers, separators, or control characters",
  });
const ActionSchema = z.string().trim().min(1);
const PurposeSchema = z.string().trim().min(1);

/** A host-independent reference to a resource exposed through SharedOS. */
export const ResourceRefSchema = z
  .object({
    namespace: IdentifierSchema,
    path: z.array(PathSegmentSchema),
    owner: AddressSchema.optional(),
  })
  .strict();

export type ResourceRef = z.infer<typeof ResourceRefSchema>;

/** A positive capability. SharedOS is deny-by-default when no grant matches. */
export const CapabilitySchema = z
  .object({
    resource: ResourceRefSchema,
    actions: z.array(ActionSchema).min(1),
    scope: z.enum(["exact", "descendants"]),
  })
  .strict();

export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityConstraintsSchema = z
  .object({
    purposes: z.array(PurposeSchema).min(1).optional(),
    notBefore: TimestampSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    maxUses: z.number().int().positive().optional(),
    delegationDepth: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((constraints, context) => {
    if (
      constraints.notBefore !== undefined &&
      constraints.expiresAt !== undefined &&
      Date.parse(constraints.notBefore) > Date.parse(constraints.expiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notBefore must not be after expiresAt",
        path: ["notBefore"],
      });
    }
  });

export type CapabilityConstraints = z.infer<typeof CapabilityConstraintsSchema>;

/**
 * A request for authority. A request is not itself proof of authority.
 *
 * Two places produce one and none accepts one as input. A denial that matched no
 * grant describes what would have satisfied it, and an escalation may carry that
 * description on to whoever resolves it. Both are descriptions: turning one into
 * usable authority is the host's issuing workflow, which ends in a grant the
 * next turn loads (ADR 0019).
 *
 * `id`, `namespaceId`, `requester`, `owner`, and `requestedAt` are minted by the
 * kernel from the trusted access context, whatever a caller wrote: a request
 * the caller authored would be a caller-chosen correlation for a decision the
 * kernel made. `id` is derived from the ask -- namespace, requester, owner,
 * purpose, constraints, capabilities -- rather than generated, so the same ask
 * describes itself the same way twice, and `requestedAt` is left out of it so
 * the identifier survives across turns.
 */
export const CapabilityRequestSchema = z
  .object({
    id: IdentifierSchema,
    namespaceId: IdentifierSchema,
    requester: AddressSchema,
    owner: AddressSchema,
    capabilities: z.array(CapabilitySchema).min(1),
    purpose: PurposeSchema,
    constraints: CapabilityConstraintsSchema.optional(),
    requestedAt: TimestampSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

/**
 * Authority issued to one subject and bounded by explicit constraints.
 *
 * A grant that was derived from another grant names its immediate ancestor in
 * `parentGrantId`. The link is a claim, not proof: SharedOS resolves and
 * validates the complete chain before the grant may authorize anything.
 *
 * `deriveGrant` in `@aicoo/sharedos-core` is the supported way to produce one.
 * It only ever emits this single link: a chain embedded in the grant would be
 * provenance the presenter controls, and the ancestors are re-resolved from the
 * issuing store at every decision instead.
 */
export const CapabilityGrantSchema = z
  .object({
    id: IdentifierSchema,
    namespaceId: IdentifierSchema,
    subject: AddressSchema,
    issuer: AddressSchema,
    capabilities: z.array(CapabilitySchema).min(1),
    constraints: CapabilityConstraintsSchema,
    issuedAt: TimestampSchema,
    revokedAt: TimestampSchema.optional(),
    parentGrantId: IdentifierSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.parentGrantId === grant.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a grant must not name itself as its delegation parent",
        path: ["parentGrantId"],
      });
    }
  });

export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;

/** The exact capability a tool invocation requires. */
export const CapabilityRequirementSchema = z
  .object({
    resource: ResourceRefSchema,
    action: ActionSchema,
  })
  .strict();

export type CapabilityRequirement = z.infer<typeof CapabilityRequirementSchema>;

/**
 * Where an actor may operate, with the authority stripped out.
 *
 * A reader needs to know which paths are worth naming — otherwise it guesses
 * and collects denials — but it must not learn who granted the access, for how
 * long, or how many uses remain. This carries the shape of the reachable
 * surface and nothing else. It is descriptive: every call is still authorized
 * independently, so a stale or over-wide `ResourceReach` cannot permit
 * anything.
 *
 * The owner is deliberately absent as well. Reach is always derived under one
 * access context and describes that context's world; carrying an owner would
 * invite a reader to treat an entry as portable to another.
 */
export const ResourceReachSchema = z
  .object({
    namespace: IdentifierSchema,
    path: z.array(PathSegmentSchema),
    actions: z.array(ActionSchema).min(1),
    scope: z.enum(["exact", "descendants"]),
  })
  .strict();

export type ResourceReach = z.infer<typeof ResourceReachSchema>;

/** As many entries as one reach may carry, on a card or on the wire. */
export const ReachListSchema = z.array(ResourceReachSchema);

/**
 * Why a reach could not be established.
 *
 * Both are infrastructure codes the decide path already fails closed with: the
 * authority behind the reach could not be loaded, or a bounded grant's budget
 * could not be read. Neither narrows the answer. A reach that silently omitted
 * a live grant because a dependency is down would look exactly like one that is
 * true, so the whole answer is withheld under a code the reader can act on
 * (ADR 0021).
 */
export const ReachUnavailableReasonSchema = z.enum([
  "authority_unavailable",
  "usage_store_unavailable",
]);
export type ReachUnavailableReason = z.infer<typeof ReachUnavailableReasonSchema>;

/**
 * What asking for a reach answers.
 *
 * `computed` carries the reachable surface, possibly empty: a context that can
 * authorize nothing reaches nothing, and that is a true answer. `unavailable`
 * means no answer could be established, and says why in the vocabulary a denial
 * uses. The shape crosses the HTTP boundary unchanged, so a remote caller reads
 * the same result an embedded host does.
 */
export const ReachResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("computed"), reach: ReachListSchema }).strict(),
  z.object({ status: z.literal("unavailable"), reasonCode: ReachUnavailableReasonSchema }).strict(),
]);
export type ReachResult = z.infer<typeof ReachResultSchema>;
