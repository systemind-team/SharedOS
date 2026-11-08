import { z } from "zod";

import { AddressSchema } from "./address.js";
import { CapabilityRequestSchema } from "./capability.js";
import { IdentifierSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";
import { EnabledToolNamespacesSchema } from "./tool.js";

/**
 * The identity, purpose, time, and tool-namespace inputs to a permission
 * decision.
 *
 * An access context deliberately carries no authority. Grants are loaded by the
 * kernel from a trusted `GrantSource` at the moment of the decision, so a
 * caller cannot present, extend, or replay authority by constructing a context.
 */
export const AccessContextSchema = z
  .object({
    namespaceId: IdentifierSchema,
    actor: AddressSchema,
    authority: AddressSchema,
    owner: AddressSchema,
    purpose: z.string().trim().min(1),
    traceId: IdentifierSchema,
    /**
     * The execution this context belongs to, carried by every kernel call the
     * turn makes. The executor copies it from the request. With one the turn is
     * that execution's alone, and a second open while it runs is refused;
     * without one, opens that share the other fields share a lease (ADR 0010).
     */
    executionId: IdentifierSchema.optional(),
    enabledToolNamespaces: EnabledToolNamespacesSchema,
    now: TimestampSchema,
  })
  .strict();

export type AccessContext = z.infer<typeof AccessContextSchema>;

/** A portable explanation of one authorization check. */
export const AuthorizationDecisionSchema = z
  .object({
    allowed: z.boolean(),
    reasonCode: IdentifierSchema,
    matchedGrantId: IdentifierSchema.optional(),
    /**
     * The authority that would have satisfied this request, when none did.
     *
     * Named for what it is rather than for its type. A `CapabilityRequest` is
     * not a `CapabilityRequirement`, and `ToolDefinition.requiredCapability` --
     * the bare resource-and-action a tool declares -- is the field a reader of
     * this package meets first.
     *
     * A description, not an offer. It grants nothing, no port accepts one as
     * input, and the denial is still a denial: `allowed` stays `false` and
     * fail-closed behaviour is untouched. What it buys is that a host running a
     * consent workflow can name the capability an approval is about instead of
     * reconstructing it from prose (ADR 0019).
     *
     * Present on a `no_matching_grant` denial from an authorization check, and
     * on nothing else. A `canDiscover` denial carries none even under that same
     * code: it is asked about a tool's declared ceiling rather than a call, so a
     * description built there would name more authority than an operation
     * needed. Of the other codes, `grant_exhausted` names a grant that exists,
     * `host_policy_denied` names one that exists and was overridden, and the
     * infrastructure denials name a fact SharedOS could not establish; for all
     * of them, issuing a grant is not the remedy, and a description would say
     * that it is.
     *
     * It restates the caller's own request and context and reveals nothing
     * further. It does not say whether the path exists, whether any grant for it
     * exists, or who holds one -- and it must not be extended to, because a
     * denial that answered those would be an existence oracle.
     */
    requiredAuthority: CapabilityRequestSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type AuthorizationDecision = z.infer<typeof AuthorizationDecisionSchema>;
