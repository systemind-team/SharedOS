import type {
  AccessContext,
  AuthorizationDecision,
  Capability,
  CapabilityGrant,
  CapabilityRequirement,
  JsonObject,
  ReachResult,
  ResourceReach,
  ResourceRef,
} from "@aicoo/sharedos-contracts";
import { isJsonObject } from "@aicoo/sharedos-contracts";

import type { HostPolicy, PolicyResolution, ResolvedAuthority } from "./authority.js";
import { describeRequiredAuthority } from "./capability-request.js";
import type { ProviderErrorReporter } from "./diagnostics.js";
import {
  type DelegationChainResolver,
  type DelegationValidation,
  validateDelegationChain,
} from "./delegation.js";
import {
  addressesEqual,
  canonicalJson,
  type GrantInstants,
  grantInactiveReason,
  parseTimestamp,
  pathIsWithin,
  pathsEqual,
  reportProviderError,
} from "./internal.js";

export { addressesEqual };

export type AuthorizationReasonCode =
  | "allowed"
  | "invalid_context"
  | "invalid_request"
  | "no_matching_grant"
  | "grant_exhausted"
  | "delegation_chain_invalid"
  | "authority_unavailable"
  | "delegation_chain_unverified"
  | "usage_store_unavailable"
  | "host_policy_denied"
  | "host_policy_unavailable";

/**
 * Denials caused by SharedOS being unable to establish a fact, not by policy.
 *
 * Fail-closed behaviour makes these look like denials at the call site. An
 * experiment must separate them from expected permission denials before
 * computing any rate, so they are named once here and marked `failClosed` in
 * the audit record.
 */
export const INFRASTRUCTURE_DENIAL_REASONS: readonly AuthorizationReasonCode[] = [
  "authority_unavailable",
  "delegation_chain_unverified",
  "usage_store_unavailable",
  "host_policy_unavailable",
];

export function isInfrastructureDenial(reasonCode: string): boolean {
  return (INFRASTRUCTURE_DENIAL_REASONS as readonly string[]).includes(reasonCode);
}

/**
 * The first condition a resolved grant failed, in the order they are checked.
 *
 * These are the causes the `no_matching_grant` checklist enumerates, and a
 * denial names them only to the host. A caller learns that it may not proceed;
 * which of its grants nearly matched, and how, is the host's to see.
 */
export type GrantRejectionReason =
  | "issuer"
  | "subject"
  | "namespace"
  | "window"
  | "purpose"
  | "verifier"
  | "capability"
  | "delegation"
  | "exhausted";

export interface GrantRejection {
  readonly grantId: string;
  readonly reason: GrantRejectionReason;
}

/**
 * Why a denial happened, addressed to the host rather than to the caller.
 *
 * Three reason codes are deliberately indistinguishable at the call site --
 * `no_matching_grant` collapses nine causes, and `authority_unavailable`
 * collapses four -- so that no caller can map the permission topology by
 * reading refusals. That reticence is owed to the caller, not to the operator:
 * the host wired the store, issued the grant, and built the context, and is
 * entitled to know which of those was wrong. `SharedOSKernel` records this on
 * the `authorization.checked` audit event, which never leaves the host.
 *
 * `missingDependency` is the one field that reports a configuration fault
 * rather than a policy outcome: a grant matched and could not be honoured
 * because the authorizer was constructed without the store it needed.
 */
export interface AuthorizationExplanation {
  readonly reasonCode: AuthorizationReasonCode;
  readonly grantsResolved: number;
  readonly rejections: readonly GrantRejection[];
  readonly missingDependency?: "usageStore" | "delegationResolver";
}

export interface GrantUsageStore {
  getUsage(namespaceId: string, grantId: string): Promise<number>;
  tryConsume(namespaceId: string, grantId: string, maximumUses: number): Promise<boolean>;
  /**
   * Give back one use `tryConsume` took, for a decision whose operation never
   * ran because its record could not be written. Atomic, and never below zero.
   *
   * Optional. Without it, or when it throws, the use stays spent.
   */
  release?(namespaceId: string, grantId: string): Promise<void>;
}

export interface CapabilityGrantVerifier {
  verify(grant: CapabilityGrant, context: AccessContext): Promise<boolean>;
}

/**
 * A decision that allowed, and the grant that produced it.
 *
 * Named apart from `AuthorizationDecision` so a port can be given the allow arm
 * alone. A denial is not assignable to it, which is how {@link HostCeiling} is
 * prevented from ever seeing one.
 */
export interface AllowedDecision {
  readonly allowed: true;
  readonly reasonCode: "allowed";
  readonly matchedGrantId: string;
  readonly metadata?: JsonObject;
}

/**
 * A refusal by host policy, the one input to a decision no grant expresses.
 *
 * The only denial a ceiling may author. Its code is fixed here rather than
 * taken from the ceiling, so the vocabulary stays SharedOS's: a host cannot
 * invent a reason code by returning one, and cannot borrow `no_matching_grant`
 * to make its own refusal look like an absent grant. Say more in `metadata`.
 */
export interface HostPolicyDenial {
  readonly allowed: false;
  readonly reasonCode: "host_policy_denied";
  readonly metadata?: JsonObject;
}

/**
 * The only two things a ceiling may say: the decision it was handed, or no.
 *
 * Widening is inexpressible rather than forbidden. A ceiling is handed an
 * {@link AllowedDecision} and can therefore never receive a denial to turn into
 * an allow; the allow arm it may return is pinned to `reasonCode: "allowed"`
 * and requires a `matchedGrantId`, which {@link CapabilityAuthorizer} checks is
 * the one it handed over. Anything else is a malfunction and fails closed as
 * `host_policy_unavailable`. A host outside TypeScript is held to the same at
 * runtime, where a foreign `reasonCode` on a refusal is replaced rather than
 * carried.
 */
export type HostCeilingVerdict = AllowedDecision | HostPolicyDenial;

/**
 * Product or organization policy, consulted on a grant that would otherwise
 * allow.
 *
 * A host narrows what its agents may do for reasons no grant expresses -- a
 * relationship model, a content-sensitivity check, an org-wide freeze. Doing
 * that outside the kernel makes it a second enforcement point SharedOS cannot
 * see: the refusal reaches no audit sink and no conformance cell, and the
 * denial counts a deployment produces say "nobody authorized this" about calls a
 * grant did authorize. This is where that judgment goes instead (ADR 0020).
 *
 * **Synchronous, and that is the contract.** A synchronous return structurally
 * forbids the network call, the database read, and the model call. A ceiling
 * needing a remote policy service is not this port: a per-call round trip here
 * is a latency and availability change to every operation SharedOS mediates.
 * Load the policy into memory and refresh it on your own schedule, which is what
 * correctness would require anyway.
 *
 * **It may only narrow, and the types say so.** `narrow` takes an
 * {@link AllowedDecision} and returns a {@link HostCeilingVerdict}: the decision
 * it was given, or a {@link HostPolicyDenial} whose code is fixed. A denial
 * cannot be passed in, so none can be turned into an allow, and a code cannot
 * be authored. A host outside TypeScript is held to the same at runtime, and
 * nothing else is read from what it returns: an `allowed` result carrying a
 * different `matchedGrantId` is treated as a malfunction and fails closed, and
 * any other `reasonCode` on a refusal is replaced with `host_policy_denied` so
 * one refusal vocabulary survives (ADR 0012). Say more in `metadata`, which is
 * preserved -- except that
 * audit drops the `consumed` and `failClosed` keys the kernel states itself, and
 * anything that is not a JSON object is dropped whole.
 *
 * **It is consulted before a bounded use is consumed**, so a call policy stopped
 * does not spend a `maxUses` grant: that counter records what an actor did.
 *
 * **It is consulted per matching grant, not once per request.** A refusal ends
 * that grant's candidacy and the walk continues, because two grants can match
 * one request and differ in ways policy distinguishes. Decide from `request` and
 * `context`; `decision.matchedGrantId` is there so a refusal can record which
 * grant it overrode, and a ceiling that branches on it is describing grant
 * issuance rather than a ceiling.
 *
 * **Discovery consults it too**, so a catalogue is not offered on authority that
 * invocation would refuse -- the agreement ADR 0016 established for expiry. Note
 * what it is asked there: a tool's *declared* ceiling, which ADR 0012 allows to
 * be broader than the argument-selected resource of any particular call.
 *
 * **Its policy arrives as the fourth argument.** When the kernel was given a
 * `PolicySource`, `policy` is what that source loaded for this turn, handed
 * back exactly as loaded -- not cloned, because SharedOS does not know its
 * shape -- and the same value for every decision in the turn. When it was not,
 * `policy` is `undefined` and the ceiling decides over state it closes over.
 * The pairing is the host's: SharedOS cannot check that the type a ceiling
 * expects is the type its source produces, which is why the parameter admits
 * `undefined` rather than promising a value. A turn whose policy could not be
 * loaded never reaches `narrow`: every decision the ceiling would have been
 * consulted on is refused `host_policy_unavailable` instead.
 *
 * A throw fails closed as `host_policy_unavailable`, an infrastructure denial
 * like every other unavailable trusted component.
 */
export interface HostCeiling<Policy = HostPolicy> {
  narrow(
    decision: AllowedDecision,
    request: CapabilityRequirement,
    context: AccessContext,
    policy: Policy | undefined,
  ): HostCeilingVerdict;
}

/**
 * The instant one decision is made at, when it is not the turn's own.
 *
 * `ResolvedAuthority.context` carries the instant the turn's authority was
 * resolved, and that is what a turn is admitted against. A caller that knows the
 * instant of the *operation* -- `SharedOSKernel` does, because the executor
 * stamps a live context onto every call -- names it here, and a grant whose
 * validity window has closed since admission is refused without re-reading the
 * store. Omitting it decides at the turn's instant, which is what a kernel call
 * outside any turn is. See `grantIsActive` in `internal.ts` for which removals
 * move and which do not, and ADR 0016 for why.
 */
export interface AuthorizationInstantOptions {
  readonly now?: string;
}

export interface AuthorizeOptions extends AuthorizationInstantOptions {
  /**
   * Consumption is reserved for execution. Discovery calls must leave this
   * false so merely viewing a catalog cannot spend a bounded grant.
   */
  readonly consume?: boolean;
  /**
   * Called once with the host-facing account of a denial, before it is
   * returned. Never called for an allow.
   *
   * The callback runs synchronously on a frozen value and must not throw: a
   * diagnostic that can change a decision is a decision.
   */
  readonly onExplain?: (explanation: AuthorizationExplanation) => void;
}

export interface DiscoverOptions extends AuthorizationInstantOptions {
  /**
   * The same account {@link AuthorizeOptions.onExplain} hands over, for a
   * discovery check that refuses a call somebody made.
   *
   * Left unset when a catalogue is being filtered: that denies constantly and
   * by design, and explaining each one would bury the denials that surprised
   * somebody. `SharedOSKernel.listTools` passes none. `invokeTool` passes one,
   * because a call refused at this check is refused nowhere else, and it is the
   * path a missing `usageStore` always takes for a tool whose only grant is
   * bounded.
   */
  readonly onExplain?: (explanation: AuthorizationExplanation) => void;
}

export interface CapabilityAuthorizerOptions {
  readonly usageStore?: GrantUsageStore;
  readonly grantVerifier?: CapabilityGrantVerifier;
  /**
   * Trusted ancestor lookup for delegated grants. Without it, a grant that
   * claims a parent can never authorize anything.
   */
  readonly delegationResolver?: DelegationChainResolver;
  readonly maxDelegationChainLength?: number;
  /**
   * Product or organization policy the kernel consults. See {@link HostCeiling}.
   *
   * Installed by whoever constructs the authorizer, which is the party that
   * already chooses the `GrantSource`. That is not a new privilege: anyone who
   * decides what authority exists can already decide it is none.
   *
   * The per-turn policy it decides against, when it has one, comes from
   * `SharedOSKernelOptions.policySource` -- on the kernel rather than here,
   * because the load is a turn-boundary event and the kernel owns the turn
   * boundary. The authorizer only carries what was loaded to the ceiling.
   */
  readonly hostCeiling?: HostCeiling;
  /**
   * Where a throw from {@link HostCeiling.narrow} is reported.
   *
   * The same shape `SharedOSKernelOptions.onProviderError` takes, and a host
   * wanting both passes one function to both: the ceiling is installed here
   * rather than on the kernel, so the kernel's hook cannot reach it. Without
   * this, a ceiling that fails denies every operation in the deployment as
   * `host_policy_unavailable` and says nothing about why.
   */
  readonly onProviderError?: ProviderErrorReporter;
}

/**
 * An atomic, process-local usage store suitable for tests and single-process
 * hosts. Distributed hosts should inject a durable compare-and-set store.
 */
export class InMemoryGrantUsageStore implements GrantUsageStore {
  readonly #usageByNamespace = new Map<string, Map<string, number>>();

  async getUsage(namespaceId: string, grantId: string): Promise<number> {
    return this.#usageByNamespace.get(namespaceId)?.get(grantId) ?? 0;
  }

  async tryConsume(namespaceId: string, grantId: string, maximumUses: number): Promise<boolean> {
    let namespaceUsage = this.#usageByNamespace.get(namespaceId);
    if (namespaceUsage === undefined) {
      namespaceUsage = new Map<string, number>();
      this.#usageByNamespace.set(namespaceId, namespaceUsage);
    }

    const current = namespaceUsage.get(grantId) ?? 0;
    if (current >= maximumUses) {
      return false;
    }

    namespaceUsage.set(grantId, current + 1);
    return true;
  }

  async release(namespaceId: string, grantId: string): Promise<void> {
    const namespaceUsage = this.#usageByNamespace.get(namespaceId);
    const current = namespaceUsage?.get(grantId) ?? 0;
    if (current > 0) {
      namespaceUsage?.set(grantId, current - 1);
    }
  }
}

export class CapabilityAuthorizer {
  readonly #usageStore: GrantUsageStore | undefined;
  readonly #grantVerifier: CapabilityGrantVerifier | undefined;
  readonly #delegationResolver: DelegationChainResolver | undefined;
  readonly #maxDelegationChainLength: number | undefined;
  readonly #hostCeiling: HostCeiling | undefined;
  readonly #onProviderError: ProviderErrorReporter | undefined;

  constructor(options: CapabilityAuthorizerOptions = {}) {
    this.#usageStore = options.usageStore;
    this.#grantVerifier = options.grantVerifier;
    this.#delegationResolver = options.delegationResolver;
    this.#maxDelegationChainLength = options.maxDelegationChainLength;
    this.#hostCeiling = options.hostCeiling;
    this.#onProviderError = options.onProviderError;
  }

  /**
   * Whether a host ceiling is installed.
   *
   * Read by the kernel so `authority.resolved` can say so. Without it, an audit
   * stream containing no `host_policy_denied` is ambiguous between a deployment
   * with no policy port and one whose port never fired, and that ambiguity is
   * the difference between a count and a guess (ADR 0020).
   */
  get hasHostCeiling(): boolean {
    return this.#hostCeiling !== undefined;
  }

  /**
   * Give back the bounded use an allowed decision spent.
   *
   * For the kernel, when that decision's record could not be written and its
   * operation therefore never ran. Nothing happens for a grant with no
   * `maxUses`, or a store with no `release`.
   */
  async release(authority: ResolvedAuthority, grantId: string): Promise<void> {
    const grant = authority.grants.find(({ id }) => id === grantId);
    if (grant?.constraints.maxUses !== undefined) {
      await this.#usageStore?.release?.(authority.context.namespaceId, grantId);
    }
  }

  async authorize(
    authority: ResolvedAuthority,
    request: CapabilityRequirement,
    options: AuthorizeOptions = {},
  ): Promise<AuthorizationDecision> {
    return this.#decide(
      authority,
      request,
      capabilityMatches,
      options.consume ?? false,
      options.now,
      // Describes what was missing when nothing matched; see
      // `describeRequiredCapability`.
      true,
      options.onExplain,
    );
  }

  /**
   * Non-consuming catalog check. A narrow grant can discover a tool whose
   * declared resource is a broader ceiling; invocation still checks the exact
   * argument-selected resource.
   */
  async canDiscover(
    authority: ResolvedAuthority,
    ceiling: CapabilityRequirement,
    options: DiscoverOptions = {},
  ): Promise<AuthorizationDecision> {
    // `describeMissing` is `false`: a discovery check is made against a tool's
    // declared capability, which may be a broader ceiling than any call, so a
    // description built here would name authority no operation needed. The
    // account is another matter. It says which grants were turned away and why,
    // asks for nothing, and stays with the host, so it is handed over when the
    // caller asks for it; see `DiscoverOptions.onExplain` for who does.
    return this.#decide(
      authority,
      ceiling,
      capabilityIntersectsCeiling,
      false,
      options.now,
      false,
      options.onExplain,
    );
  }

  /**
   * The reachable surface an authority describes, with the authority removed.
   *
   * Answers "where may this actor look" without disclosing who allowed it, for
   * how long, or how much budget is left. Only grants that would authorize
   * something at this instant contribute: an expired, revoked, wrong-purpose,
   * wrong-subject, unverified or chain-broken grant is not reach, and neither
   * is a bounded grant whose budget is spent -- advertising a door that is
   * already closed is worse than not advertising it.
   *
   * Nothing is consumed. Asking is not opening, so reading reach never spends a
   * bounded grant. A usage store that cannot be read makes the whole answer
   * `unavailable` rather than the reach narrower: a surface that silently omits
   * a live grant because a dependency is down looks exactly like one that is
   * true, and the reader has no way to tell (ADR 0021).
   *
   * This is descriptive, never permissive. Every operation is authorized
   * independently afterwards, which is what makes an over-wide entry harmless
   * and what makes reach safe to put in front of a model. The host ceiling is
   * deliberately not consulted: a `descendants` entry is not one request, so a
   * per-entry verdict would be neither sound nor complete, and a ceiling that
   * refuses still refuses at the operation.
   *
   * Entries are deduplicated and canonically ordered, so the same authority
   * produces the same reach however the store happened to order its grants.
   *
   * Only `usage_store_unavailable` is emitted here; `SharedOSKernel.reach` adds
   * `authority_unavailable` when the authority itself could not be loaded.
   *
   * See ADR 0021, which reads this for a *subject* by deriving a context from
   * the reader's own, and `SharedOSKernel.reach`, which reads it for the turn's
   * own scope.
   */
  async reach(
    authority: ResolvedAuthority,
    options: AuthorizationInstantOptions = {},
  ): Promise<ReachResult> {
    const context = structuredClone(authority.context);
    const admittedAt = parseTimestamp(context.now);
    const now = options.now === undefined ? admittedAt : parseTimestamp(options.now);
    if (
      admittedAt === undefined ||
      now === undefined ||
      context.purpose.length === 0 ||
      context.traceId.length === 0
    ) {
      // The same contexts `#decideOnGrants` refuses as `invalid_context`. A
      // context that can authorize nothing reaches nothing.
      return { status: "computed", reach: [] };
    }
    const at: GrantInstants = { admittedAt, now };

    const entries = new Map<string, { readonly order: string; readonly entry: ResourceReach }>();
    for (const grant of structuredClone([...authority.grants])) {
      if ((await this.#grantRejection(context, grant, at)) !== undefined) {
        continue;
      }
      if ((await this.#validateDelegation(context, grant, at)).status !== "valid") {
        continue;
      }
      const budget = await this.#budgetLeft(context, grant);
      if (budget === "unavailable") {
        return { status: "unavailable", reasonCode: "usage_store_unavailable" };
      }
      if (budget === "spent") {
        continue;
      }

      for (const capability of grant.capabilities) {
        // A capability naming another owner cannot authorize anything here --
        // a request outside this context's world is `invalid_request` before a
        // grant is even consulted -- so listing it would advertise a door this
        // context has no handle for. Reach describes one world, and the owner
        // is therefore implied rather than carried.
        if (!addressesEqual(capability.resource.owner ?? context.owner, context.owner)) {
          continue;
        }
        const entry: ResourceReach = {
          namespace: capability.resource.namespace,
          path: [...capability.resource.path],
          actions: [...capability.actions].sort(),
          scope: capability.scope,
        };
        entries.set(canonicalJson(entry), {
          // Namespace first, then path, then scope, then actions: the order a
          // reader would group them in. Deduplication uses the whole entry;
          // ordering deliberately does not, so two entries that differ only in
          // their actions still sit together.
          order: canonicalJson([entry.namespace, entry.path, entry.scope, entry.actions]),
          entry,
        });
      }
    }

    return {
      status: "computed",
      reach: [...entries.values()]
        .sort((left, right) => (left.order < right.order ? -1 : left.order > right.order ? 1 : 0))
        .map(({ entry }) => entry),
    };
  }

  /**
   * Whether a bounded grant still has a use left, read without spending one.
   *
   * An unbounded grant always does. A bounded one whose store is missing or
   * throws is `unavailable` rather than `spent`: guessing available would
   * advertise authority SharedOS could not establish, and guessing spent would
   * make reach narrower for a reason the reader cannot see. The caller decides
   * what an unreadable budget means for the whole answer.
   */
  async #budgetLeft(
    context: AccessContext,
    grant: CapabilityGrant,
  ): Promise<"available" | "spent" | "unavailable"> {
    const maximumUses = grant.constraints.maxUses;
    if (maximumUses === undefined) {
      return "available";
    }
    if (this.#usageStore === undefined) {
      return "unavailable";
    }
    try {
      return (await this.#usageStore.getUsage(context.namespaceId, grant.id)) < maximumUses
        ? "available"
        : "spent";
    } catch {
      return "unavailable";
    }
  }

  async #decide(
    authority: ResolvedAuthority,
    request: CapabilityRequirement,
    matches: (
      capability: Capability,
      request: CapabilityRequirement,
      context: AccessContext,
    ) => boolean,
    consume: boolean,
    operationNow: string | undefined,
    describeMissing: boolean,
    onExplain: ((explanation: AuthorizationExplanation) => void) | undefined,
  ): Promise<AuthorizationDecision> {
    const context = structuredClone(authority.context);
    const grants = structuredClone([...authority.grants]);
    request = structuredClone(request);
    const admittedAt = parseTimestamp(context.now);
    // An unparsable operation instant is a broken context, not an absent one:
    // falling back to the turn's instant would silently decide at a moment the
    // caller did not ask for, which is the one thing naming an instant is for.
    const now = operationNow === undefined ? admittedAt : parseTimestamp(operationNow);
    if (
      admittedAt === undefined ||
      now === undefined ||
      context.purpose.length === 0 ||
      context.traceId.length === 0
    ) {
      onExplain?.(
        Object.freeze({
          reasonCode: "invalid_context" as const,
          grantsResolved: grants.length,
          rejections: Object.freeze([]) as readonly GrantRejection[],
        }),
      );
      return deny("invalid_context");
    }
    const at: GrantInstants = { admittedAt, now };

    const rejections: GrantRejection[] = [];
    let missingDependency: AuthorizationExplanation["missingDependency"];
    // Every denial leaves through here, so the host-facing account cannot drift
    // from the caller-facing code. An allow needs no account: `matchedGrantId`
    // already names the grant that carried it.
    const explained = (decision: AuthorizationDecision): AuthorizationDecision => {
      if (!decision.allowed && onExplain !== undefined) {
        onExplain(
          Object.freeze({
            reasonCode: decision.reasonCode as AuthorizationReasonCode,
            grantsResolved: grants.length,
            rejections: Object.freeze([...rejections]) as readonly GrantRejection[],
            ...(missingDependency === undefined ? {} : { missingDependency }),
          }),
        );
      }
      return decision;
    };

    if (
      request.action.length === 0 ||
      request.resource.namespace.length === 0 ||
      !resourceBelongsToContext(request.resource, context)
    ) {
      return explained(deny("invalid_request"));
    }

    let foundExhaustedGrant = false;
    let policyDenial: AuthorizationDecision | undefined;
    let delegationFailure: DelegationFailure | undefined;

    for (const grant of grants) {
      const ineligible = await this.#grantRejection(context, grant, at);
      if (ineligible !== undefined) {
        rejections.push({ grantId: grant.id, reason: ineligible });
        continue;
      }

      const capability = grant.capabilities.find((candidate) =>
        matches(candidate, request, context),
      );
      if (capability === undefined) {
        rejections.push({ grantId: grant.id, reason: "capability" });
        continue;
      }

      const delegation = await this.#validateDelegation(context, grant, at);
      if (delegation.status !== "valid") {
        rejections.push({ grantId: grant.id, reason: "delegation" });
        delegationFailure = worstDelegationFailure(delegationFailure, {
          status: delegation.status,
          code: delegation.code,
          grantId: delegation.grantId,
        });
        continue;
      }

      // Last gate before consumption, so a call policy refuses does not spend a
      // bounded use. The walk continues rather than stopping: two grants can
      // match one request and differ in ways a policy distinguishes, and
      // stopping here would deny a call the next grant would have allowed.
      const narrowed = this.#applyCeiling(grant.id, request, context, authority.hostPolicy);
      if (narrowed.reasonCode === "host_policy_unavailable") {
        return explained(narrowed);
      }
      if (!narrowed.allowed) {
        policyDenial ??= narrowed;
        continue;
      }

      const maximumUses = grant.constraints.maxUses;
      if (maximumUses === undefined) {
        return allow(grant.id);
      }

      if (this.#usageStore === undefined) {
        // A grant that matched in every other respect. Nothing about the
        // request is wrong; the authorizer was built without the store a
        // bounded grant is spent against.
        missingDependency = "usageStore";
        return explained(deny("usage_store_unavailable"));
      }

      try {
        const available = consume
          ? await this.#usageStore.tryConsume(context.namespaceId, grant.id, maximumUses)
          : (await this.#usageStore.getUsage(context.namespaceId, grant.id)) < maximumUses;

        if (available) {
          return allow(grant.id);
        }

        rejections.push({ grantId: grant.id, reason: "exhausted" });
        foundExhaustedGrant = true;
      } catch {
        return explained(deny("usage_store_unavailable"));
      }
    }

    if (delegationFailure !== undefined) {
      if (delegationFailure.status === "unverified" && this.#delegationResolver === undefined) {
        missingDependency = "delegationResolver";
      }
      return explained(
        deny(
          delegationFailure.status === "unverified"
            ? "delegation_chain_unverified"
            : "delegation_chain_invalid",
          { delegation: { code: delegationFailure.code, grantId: delegationFailure.grantId } },
        ),
      );
    }

    // Above exhaustion because under-counting policy denials is the defect the
    // ceiling exists to fix. Below both delegation outcomes, for two reasons
    // rather than one: an unverified chain is fail-closed, and reporting a
    // deliberate refusal in its place would hide an infrastructure failure
    // behind a policy label; an invalid chain is not fail-closed, but it says
    // the grant is not valid authority at all, which is upstream of whether
    // policy would have allowed it. The grant policy refused is not among the
    // rejections: it matched, and the decision's `matchedGrantId` names it.
    if (policyDenial !== undefined) {
      return explained(policyDenial);
    }

    if (foundExhaustedGrant) {
      return explained(deny("grant_exhausted"));
    }

    const missing = deny("no_matching_grant");
    if (!describeMissing) {
      return explained(missing);
    }
    const requiredAuthority = await describeRequiredAuthority(context, request);
    return explained(requiredAuthority === undefined ? missing : { ...missing, requiredAuthority });
  }

  /**
   * Hand one would-be allow to the host ceiling, and read only what it may say.
   *
   * The returned decision is rebuilt here rather than passed through, so a
   * ceiling cannot widen by construction rather than by prohibition: an
   * `allowed` result is answered with a decision built here, and one naming a
   * different grant than the one it was shown is a malfunction that fails
   * closed. A denial keeps only its metadata; its reason code is replaced,
   * because a ceiling free to return `no_matching_grant` could reintroduce the
   * misattribution the separate code exists to end (ADR 0020).
   *
   * The *shape* of what came back is checked before any field is read, and that
   * is not defensive clutter. Two mistakes a host makes without a type error --
   * writing `async narrow`, or falling off the end of a branch that meant to
   * allow -- both yield something whose `allowed` is `undefined`. Read
   * optimistically, the first would be recorded as a deliberate
   * `host_policy_denied`, inflating the one count this port exists to make
   * trustworthy, and the second would throw past every call site and end the
   * turn with no audit event at all. Both are malfunctions, so both fail closed.
   *
   * A turn whose policy could not be loaded is refused here without consulting
   * the ceiling, under the same code a broken ceiling produces: the port is
   * unavailable either way, and it was reported once, at the turn boundary,
   * rather than on each decision it fails.
   */
  #applyCeiling(
    grantId: string,
    request: CapabilityRequirement,
    context: AccessContext,
    hostPolicy: PolicyResolution | undefined,
  ): AuthorizationDecision {
    if (this.#hostCeiling === undefined) {
      return allow(grantId);
    }
    if (hostPolicy?.status === "unavailable") {
      return deny("host_policy_unavailable");
    }

    let narrowed: unknown;
    try {
      narrowed = this.#hostCeiling.narrow(
        allow(grantId),
        structuredClone(request),
        structuredClone(context),
        hostPolicy?.policy,
      );
    } catch (error) {
      reportProviderError(this.#onProviderError, error, context, {
        kind: "policy",
        reasonCode: "host_policy_unavailable",
        resource: request.resource,
        action: request.action,
      });
      return deny("host_policy_unavailable");
    }

    if (!isVerdict(narrowed)) {
      return deny("host_policy_unavailable");
    }

    if (narrowed.allowed) {
      return narrowed.matchedGrantId === grantId ? allow(grantId) : deny("host_policy_unavailable");
    }

    return {
      allowed: false,
      reasonCode: "host_policy_denied",
      matchedGrantId: grantId,
      ...(isJsonObject(narrowed.metadata) ? { metadata: narrowed.metadata } : {}),
    };
  }

  async #validateDelegation(
    context: AccessContext,
    grant: CapabilityGrant,
    at: GrantInstants,
  ): Promise<DelegationValidation> {
    return validateDelegationChain(grant, context, at.now, {
      admittedAt: at.admittedAt,
      ...(this.#delegationResolver === undefined ? {} : { resolver: this.#delegationResolver }),
      ...(this.#maxDelegationChainLength === undefined
        ? {}
        : { maxChainLength: this.#maxDelegationChainLength }),
    });
  }

  /**
   * The first eligibility condition this grant failed, or `undefined` if it
   * passed them all.
   *
   * `issuer` is checked first because it is the mistake people actually make:
   * `context.authority` is whose grants are being exercised, which on a
   * delegated chain is the delegator and not the owner of the data.
   */
  async #grantRejection(
    context: AccessContext,
    grant: CapabilityGrant,
    at: GrantInstants,
  ): Promise<GrantRejectionReason | undefined> {
    if (!addressesEqual(grant.issuer, context.authority)) {
      return "issuer";
    }
    if (!addressesEqual(grant.subject, context.actor)) {
      return "subject";
    }
    if (grant.namespaceId !== context.namespaceId) {
      return "namespace";
    }
    const inactive = grantInactiveReason(grant, context.purpose, at);
    if (inactive !== undefined) {
      return inactive;
    }

    if (this.#grantVerifier !== undefined) {
      try {
        if (!(await this.#grantVerifier.verify(grant, context))) {
          return "verifier";
        }
      } catch {
        return "verifier";
      }
    }

    return undefined;
  }
}

interface DelegationFailure {
  readonly status: "invalid" | "unverified";
  readonly code: string;
  readonly grantId: string;
}

/** An unverifiable chain outranks an invalid one so failures stay fail-closed. */
function worstDelegationFailure(
  current: DelegationFailure | undefined,
  candidate: DelegationFailure,
): DelegationFailure {
  if (
    current === undefined ||
    (current.status === "invalid" && candidate.status === "unverified")
  ) {
    return candidate;
  }
  return current;
}

function allow(grantId: string): AllowedDecision {
  return { allowed: true, reasonCode: "allowed", matchedGrantId: grantId };
}

function deny(
  reasonCode: Exclude<AuthorizationReasonCode, "allowed">,
  metadata?: JsonObject,
): AuthorizationDecision {
  return { allowed: false, reasonCode, ...(metadata === undefined ? {} : { metadata }) };
}

/**
 * Whether a host port returned something that can be read as a decision.
 *
 * Only `allowed` is required, because it is the only field read before the
 * shape has been established; `matchedGrantId` and `metadata` are each checked
 * where they are used. A `Promise`, `undefined`, or a bare string all fail here,
 * which is the point -- see {@link CapabilityAuthorizer} on why an unchecked
 * read of `allowed` is worse than a throw.
 */
function isVerdict(value: unknown): value is AuthorizationDecision {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { allowed?: unknown }).allowed === "boolean"
  );
}

export function capabilityMatches(
  capability: Capability,
  request: CapabilityRequirement,
  context: AccessContext,
): boolean {
  const grantedResource = capability.resource;
  const requestedResource = request.resource;

  if (
    grantedResource.namespace !== requestedResource.namespace ||
    (!capability.actions.includes(request.action) && !capability.actions.includes("*"))
  ) {
    return false;
  }

  const grantedOwner = grantedResource.owner ?? context.owner;
  const requestedOwner = requestedResource.owner ?? context.owner;
  if (!addressesEqual(grantedOwner, requestedOwner)) {
    return false;
  }

  if (capability.scope === "exact") {
    return pathsEqual(grantedResource.path, requestedResource.path);
  }

  return pathIsWithin(grantedResource.path, requestedResource.path);
}

export function capabilityIntersectsCeiling(
  capability: Capability,
  ceiling: CapabilityRequirement,
  context: AccessContext,
): boolean {
  const grantedResource = capability.resource;
  const ceilingResource = ceiling.resource;

  if (
    grantedResource.namespace !== ceilingResource.namespace ||
    (!capability.actions.includes(ceiling.action) && !capability.actions.includes("*"))
  ) {
    return false;
  }

  const grantedOwner = grantedResource.owner ?? context.owner;
  const ceilingOwner = ceilingResource.owner ?? context.owner;
  if (!addressesEqual(grantedOwner, ceilingOwner)) {
    return false;
  }

  if (capability.scope === "exact") {
    return pathIsWithin(ceilingResource.path, grantedResource.path);
  }

  return (
    pathIsWithin(grantedResource.path, ceilingResource.path) ||
    pathIsWithin(ceilingResource.path, grantedResource.path)
  );
}

function resourceBelongsToContext(resource: ResourceRef, context: AccessContext): boolean {
  return resource.owner === undefined || addressesEqual(resource.owner, context.owner);
}
