import type {
  AccessContext,
  Address,
  Capability,
  CapabilityConstraints,
  CapabilityGrant,
} from "@aicoo/sharedos-contracts";

import {
  addressesEqual,
  type GrantInstants,
  grantIsActive,
  parseTimestamp,
  pathIsWithin,
  pathsEqual,
} from "./internal.js";
import { constraintEnvelopeViolation, constraintsAreWithin } from "./constraints.js";

/**
 * The trusted lookup for ancestors of a derived grant.
 *
 * A delegated grant travels with a parent identifier, never with its parent's
 * contents, so the ancestor must be loaded from an authoritative source. An
 * implementation must resolve only within the requested namespace and must
 * throw rather than return a partial or stale ancestor.
 */
export interface DelegationChainResolver {
  resolve(namespaceId: string, grantId: string): Promise<CapabilityGrant | undefined>;
}

/** A structural rule the presented chain broke. */
export type DelegationViolationCode =
  | "delegation_not_permitted"
  | "delegation_depth_exceeded"
  | "bounded_parent_not_delegable"
  | "issuer_not_parent_subject"
  | "namespace_mismatch"
  | "parent_inactive"
  | "capability_widened"
  | "constraints_widened"
  | "chain_cycle"
  | "chain_too_long";

/** The chain could not be established, which is never treated as valid. */
export type DelegationUnverifiedCode =
  "resolver_unavailable" | "parent_not_found" | "resolver_failed";

export type DelegationValidation =
  | { readonly status: "valid"; readonly chain: readonly string[] }
  | {
      readonly status: "invalid";
      readonly chain: readonly string[];
      readonly code: DelegationViolationCode;
      readonly grantId: string;
    }
  | {
      readonly status: "unverified";
      readonly chain: readonly string[];
      readonly code: DelegationUnverifiedCode;
      readonly grantId: string;
    };

export interface DelegationValidationOptions {
  readonly resolver?: DelegationChainResolver;
  /**
   * The longest ancestor chain walked before failing closed. Unset unless the
   * host sets it, and unset is no limit; a cycle still fails as `chain_cycle`.
   */
  readonly maxChainLength?: number;
  /**
   * The instant the turn's authority was resolved, when it is not `now`.
   *
   * An ancestor is subject to the same split as the grant that names it: its
   * expiry is observed at `now`, everything else at the instant the turn was
   * admitted. Defaults to `now`, which decides the whole chain at one instant.
   */
  readonly admittedAt?: number;
}

/**
 * Validate the complete ancestor chain of one grant.
 *
 * A grant without `parentGrantId` is a root grant and is valid here; its own
 * expiry, revocation, and purpose remain the caller's separate check. For a
 * derived grant every link must satisfy all of:
 *
 * - the child's issuer is exactly the parent's subject;
 * - both grants live in the same namespace;
 * - the parent is itself active for the requested purpose, so revoking or
 *   expiring an ancestor invalidates every descendant. A revoked ancestor is
 *   observed at `options.admittedAt` and an expired one at `now`, exactly as
 *   for the grant presenting the chain;
 * - every child capability is covered by one parent capability;
 * - time window and purposes never widen;
 * - the parent holds delegation budget and the child's budget is strictly
 *   smaller;
 * - the parent is not itself bounded by `maxUses`. Usage counters are per
 *   grant, so n children of a k-use parent would carry n*k uses between them.
 *   Sharing one budget across a chain needs accounting that spans grants, and
 *   until that exists the parent is refused rather than multiplied.
 *
 * Anything the resolver cannot establish returns `unverified`, never `valid`.
 */
export async function validateDelegationChain(
  grant: CapabilityGrant,
  context: AccessContext,
  now: number,
  options: DelegationValidationOptions = {},
): Promise<DelegationValidation> {
  const chain: string[] = [];
  if (grant.parentGrantId === undefined) {
    return { status: "valid", chain };
  }

  const maxChainLength = options.maxChainLength;
  const at: GrantInstants = { admittedAt: options.admittedAt ?? now, now };
  const seen = new Set<string>([grant.id]);
  let child = grant;

  while (child.parentGrantId !== undefined) {
    if (options.resolver === undefined) {
      return unverified(chain, "resolver_unavailable", child.id);
    }
    if (maxChainLength !== undefined && chain.length >= maxChainLength) {
      return invalid(chain, "chain_too_long", child.id);
    }

    let parent: CapabilityGrant | undefined;
    try {
      parent = await options.resolver.resolve(child.namespaceId, child.parentGrantId);
    } catch {
      return unverified(chain, "resolver_failed", child.id);
    }

    if (parent === undefined) {
      return unverified(chain, "parent_not_found", child.id);
    }
    if (seen.has(parent.id)) {
      return invalid(chain, "chain_cycle", parent.id);
    }

    const violation = linkViolation(child, parent, context, at);
    if (violation !== undefined) {
      return invalid(chain, violation, parent.id);
    }

    seen.add(parent.id);
    chain.push(parent.id);
    child = parent;
  }

  return { status: "valid", chain };
}

function linkViolation(
  child: CapabilityGrant,
  parent: CapabilityGrant,
  context: AccessContext,
  at: GrantInstants,
): DelegationViolationCode | undefined {
  if (parent.namespaceId !== child.namespaceId) {
    return "namespace_mismatch";
  }
  if (!addressesEqual(parent.subject, child.issuer)) {
    return "issuer_not_parent_subject";
  }
  if (!grantIsActive(parent, context.purpose, at)) {
    return "parent_inactive";
  }

  const parentDepth = parent.constraints.delegationDepth;
  if (parentDepth === undefined || parentDepth < 1) {
    return "delegation_not_permitted";
  }
  if ((child.constraints.delegationDepth ?? 0) > parentDepth - 1) {
    return "delegation_depth_exceeded";
  }
  // Refused rather than attenuated: see `validateDelegationChain`.
  if (parent.constraints.maxUses !== undefined) {
    return "bounded_parent_not_delegable";
  }

  const covered = child.capabilities.every((capability) =>
    parent.capabilities.some((ancestor) => capabilityIsWithin(capability, ancestor, context)),
  );
  if (!covered) {
    return "capability_widened";
  }

  return constraintsAreAttenuated(child, parent) ? undefined : "constraints_widened";
}

/**
 * True when every access `capability` permits is also permitted by `ancestor`.
 *
 * The one containment predicate, exported so that nothing has to write a second
 * one. Namespace, resolved owner, action set, and path by segment -- with an
 * `exact` ancestor covering only its own path and a `descendants` ancestor
 * covering everything beneath it. ADR 0008 has already paid for what happens
 * when two definitions of "narrower" drift, and a containment rule that is
 * right in one place and approximate in another is worse than one that is
 * missing.
 *
 * Only the owner is read off the context, so a caller that has resolved an
 * owner without holding a whole access context -- precedent admission, ADR 0022
 * R2 -- passes `{ owner }`. An unowned resource on either side resolves against
 * it, which is what makes "the same owner" a comparison rather than a guess.
 *
 * This is the deciding-side question: is `capability` within `ancestor` *in
 * this context*. The issuing side asks whether it holds in every context, which
 * is a stricter question with its own predicate inside `deriveGrant`.
 */
export function capabilityIsWithin(
  capability: Capability,
  ancestor: Capability,
  context: Pick<AccessContext, "owner">,
): boolean {
  if (capability.resource.namespace !== ancestor.resource.namespace) {
    return false;
  }

  const owner = capability.resource.owner ?? context.owner;
  const ancestorOwner = ancestor.resource.owner ?? context.owner;
  if (!addressesEqual(owner, ancestorOwner)) {
    return false;
  }

  const ancestorActions = new Set(ancestor.actions);
  if (
    !ancestorActions.has("*") &&
    !capability.actions.every((action) => ancestorActions.has(action))
  ) {
    return false;
  }

  if (ancestor.scope === "exact") {
    return (
      capability.scope === "exact" && pathsEqual(ancestor.resource.path, capability.resource.path)
    );
  }

  return pathIsWithin(ancestor.resource.path, capability.resource.path);
}

function constraintsAreAttenuated(child: CapabilityGrant, parent: CapabilityGrant): boolean {
  const childIssuedAt = parseTimestamp(child.issuedAt);
  const parentIssuedAt = parseTimestamp(parent.issuedAt);
  if (
    childIssuedAt === undefined ||
    parentIssuedAt === undefined ||
    childIssuedAt < parentIssuedAt
  ) {
    return false;
  }

  // A child that names no start begins when it was issued, and that is the
  // start the parent's window has to contain. The ordering itself lives in one
  // place: `constraintsAreWithin` is the same check `deriveGrant` makes before
  // it issues, so a chain cannot validate under a rule its issuer did not use.
  return constraintsAreWithin(
    {
      ...child.constraints,
      ...(child.constraints.notBefore === undefined ? { notBefore: child.issuedAt } : {}),
    },
    parent.constraints,
  );
}

function invalid(
  chain: readonly string[],
  code: DelegationViolationCode,
  grantId: string,
): DelegationValidation {
  return { status: "invalid", chain: [...chain], code, grantId };
}

/** Why a delegation was refused at the point it was issued. */
export type DelegationRefusal =
  | "empty_capabilities"
  | "id_collides_with_parent"
  | "bounded_parent_not_delegable"
  | "parent_not_delegable"
  | "depth_exhausted"
  | "capability_not_within_parent"
  | "purpose_not_within_parent"
  | "window_not_within_parent"
  | "issued_before_parent";

export type DeriveGrantResult =
  | { readonly ok: true; readonly grant: CapabilityGrant }
  | { readonly ok: false; readonly reason: DelegationRefusal };

export interface DeriveGrantRequest {
  /** Identifier for the derived grant. Must be unique within the namespace. */
  readonly id: string;
  /** Who receives the derived authority. */
  readonly subject: Address;
  /** The subset being passed on. Must be within the parent, capability by capability. */
  readonly capabilities: readonly Capability[];
  readonly constraints?: Omit<CapabilityConstraints, "delegationDepth"> & {
    readonly delegationDepth?: number;
  };
  readonly issuedAt: string;
  readonly metadata?: CapabilityGrant["metadata"];
}

/**
 * Is `child` within `parent` in *every* context it could be presented in?
 *
 * `validateDelegationChain` asks the same question of one decision, where the
 * context names an owner and an unowned capability resolves against it. This is
 * the issuing side, which has no context and must hold for all of them: an
 * unowned parent resolves to whoever presents it, so a child that pins an owner
 * is wider than its parent in every context but one.
 *
 * Every axis is checked separately and on purpose. A single "looks narrower"
 * comparison is how a delegation model grows a hole: an actions subset with a
 * wider path, or an equal path with a wider scope, both read as "smaller" to a
 * casual check.
 */
function capabilityIsWithinInAnyContext(parent: Capability, child: Capability): boolean {
  if (parent.resource.namespace !== child.resource.namespace) return false;

  const parentOwner = parent.resource.owner;
  const childOwner = child.resource.owner;
  if (parentOwner === undefined) {
    if (childOwner !== undefined) return false;
  } else if (childOwner === undefined || !addressesEqual(parentOwner, childOwner)) {
    return false;
  }

  const parentActions = new Set(parent.actions);
  const grantsEveryAction = parentActions.has("*");
  if (!grantsEveryAction && !child.actions.every((action) => parentActions.has(action))) {
    return false;
  }
  // A wildcard cannot be passed on as a wildcard-plus-more, and a child that
  // asks for "*" is asking for anything the parent may later be widened to.
  if (child.actions.includes("*") && !grantsEveryAction) return false;

  if (parent.scope === "exact") {
    // An exact parent covers one path, so a descendants child would reach past it.
    return child.scope === "exact" && pathsEqual(parent.resource.path, child.resource.path);
  }

  return pathIsWithin(parent.resource.path, child.resource.path);
}

/**
 * An omitted constraint inherits the parent's, so silence never widens. Only a
 * constraint the delegator states explicitly has to be checked here; what is
 * inherited is written onto the derived grant below, because the chain check
 * reads an omitted constraint as a widening rather than as an inheritance.
 */

/**
 * Derive a narrower grant from one the delegator already holds.
 *
 * This is the supported way to produce a grant whose issuer is not the resource
 * owner. It is a pure function: it never consults a store, never mints
 * authority the parent does not carry, and refuses rather than clamping when a
 * request would exceed the parent — a silently clamped delegation reads as
 * accepted, and the delegator then believes it passed on more than it did.
 *
 * What it produces is a claim, not a decision. The derived grant names only its
 * immediate parent, and `validateDelegationChain` re-resolves the ancestors
 * from the issuing store at every use, because narrowing settles here but
 * revocation happens afterwards. Deriving a grant is therefore never sufficient
 * on its own: a host that issues one must also install a
 * `DelegationChainResolver`.
 */
export function deriveGrant(
  parent: CapabilityGrant,
  request: DeriveGrantRequest,
): DeriveGrantResult {
  if (request.capabilities.length === 0) {
    return { ok: false, reason: "empty_capabilities" };
  }
  if (request.id === parent.id) {
    return { ok: false, reason: "id_collides_with_parent" };
  }
  if (parent.constraints.maxUses !== undefined) {
    return { ok: false, reason: "bounded_parent_not_delegable" };
  }

  const parentDepth = parent.constraints.delegationDepth;
  if (parentDepth === undefined || parentDepth <= 0) {
    return { ok: false, reason: "parent_not_delegable" };
  }

  const remainingDepth = parentDepth - 1;
  const requestedDepth = request.constraints?.delegationDepth;
  if (requestedDepth !== undefined && requestedDepth > remainingDepth) {
    return { ok: false, reason: "depth_exhausted" };
  }

  // Each child capability must fit inside ONE parent capability. Satisfying it
  // from parts of several is the cross-product the kernel refuses everywhere
  // else, and it must not reappear here.
  const withinParent = request.capabilities.every((child) =>
    parent.capabilities.some((candidate) => capabilityIsWithinInAnyContext(candidate, child)),
  );
  if (!withinParent) {
    return { ok: false, reason: "capability_not_within_parent" };
  }
  // A bound the request leaves unset is inherited from the parent, so what is
  // checked is the envelope the child will actually carry.
  const envelope = inheritedEnvelope(parent.constraints, request.constraints);
  const violation = constraintEnvelopeViolation(envelope, parent.constraints);
  if (violation === "purposes") {
    return { ok: false, reason: "purpose_not_within_parent" };
  }
  if (violation !== undefined) {
    return { ok: false, reason: "window_not_within_parent" };
  }

  const issuedAt = parseTimestamp(request.issuedAt);
  const parentIssuedAt = parseTimestamp(parent.issuedAt);
  if (issuedAt === undefined || parentIssuedAt === undefined || issuedAt < parentIssuedAt) {
    return { ok: false, reason: "issued_before_parent" };
  }

  const depth = requestedDepth ?? remainingDepth;
  const constraints: CapabilityConstraints = {
    ...envelope,
    ...(request.constraints?.maxUses !== undefined ? { maxUses: request.constraints.maxUses } : {}),
    delegationDepth: depth,
  };

  return {
    ok: true,
    grant: {
      id: request.id,
      namespaceId: parent.namespaceId,
      subject: request.subject,
      // The delegator issues in its own name, so an audit trail names who
      // passed the authority on rather than only who originally owned it.
      issuer: parent.subject,
      capabilities: request.capabilities.map((capability) => ({
        ...capability,
        actions: [...capability.actions],
        resource: { ...capability.resource, path: [...capability.resource.path] },
      })),
      constraints,
      issuedAt: request.issuedAt,
      parentGrantId: parent.id,
      ...(request.metadata ? { metadata: request.metadata } : {}),
    },
  };
}

/**
 * The window and purposes a derived grant carries: each bound as the request
 * asked for it, or as the parent holds it when the request said nothing.
 */
function inheritedEnvelope(
  parent: CapabilityConstraints,
  request: DeriveGrantRequest["constraints"],
): CapabilityConstraints {
  const purposes = request?.purposes ?? parent.purposes;
  const notBefore = request?.notBefore ?? parent.notBefore;
  const expiresAt = request?.expiresAt ?? parent.expiresAt;
  return {
    ...(purposes === undefined ? {} : { purposes: [...purposes] }),
    ...(notBefore === undefined ? {} : { notBefore }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function unverified(
  chain: readonly string[],
  code: DelegationUnverifiedCode,
  grantId: string,
): DelegationValidation {
  return { status: "unverified", chain: [...chain], code, grantId };
}
