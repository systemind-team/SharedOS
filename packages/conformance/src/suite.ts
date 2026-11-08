import type { AttackMove } from "./adversary.js";
import type { TurnExpectation } from "./judge.js";
import { canonicalMove } from "./moves.js";
import { READ_GRANT, ROOT_FILES_GRANT, type ConformanceWorldOptions } from "./world.js";

/**
 * A dangerous world state, armed by trusted setup before the turn begins.
 *
 * Conditions are data so the arming is reviewable next to the attack it enables,
 * and so no part of it is reachable from the runtime that will be attacking.
 */
export interface ConformanceCondition {
  readonly id: string;
  readonly description: string;
  readonly world: ConformanceWorldOptions;
  /**
   * Set when the row's claim is about how the turn itself ends: refused at the
   * boundary before the runtime starts, or terminated by the runtime asking a
   * human to decide. The row is then graded on the turn's terminal outcome as
   * well as on its attempts.
   */
  readonly expectTurn?: TurnExpectation;
  /**
   * Why this condition's bound exists only while SharedOS owns the turn loop.
   *
   * The envelope's step ceiling is enforced over the steps a runtime *declares*
   * -- `RuntimeToolInvocationOptions.step` is optional and "enforced when
   * present", and a plugin that omits it is bounded by `maxToolCalls` alone.
   * A driver that owns its own loop declares no step, because a step is a
   * position inside that loop and the envelope cannot see into one.
   *
   * Set here rather than derived, so the narrowing is a reviewable declaration
   * sitting next to the arming it qualifies. A column that owns its loop reports
   * `out_of_scope` for the row: the attempt is still issued and still recorded,
   * so the manifest shows what the unbounded call did, but it is not graded
   * against a guarantee SharedOS declares does not reach it. It is deliberately
   * *not* `not_applicable`, which would claim the harness could not make the
   * attempt, and deliberately not a pass.
   *
   * A column running *inside* the standard loop is a third case, and used to be
   * folded into the second. It declares steps -- the loop declares them for it
   * -- so the guarantee does reach it, but the loop's index stops at the ceiling
   * and could never name a step past it. `AgentTurnDecision.tool_call` now
   * carries an optional step, so the driver names one and the row is graded.
   * The cell records that the driver issued it, because in such a column every
   * other pass means the harness or the model chose the call and this one does
   * not.
   */
  readonly requiresDeclaredSteps?: string;
}

/**
 * One row of the kernel conformance manifest.
 *
 * A row may carry several conditions. The manifest states one invariant per
 * row, but an invariant whose expected outcome has two clauses -- deny *and*
 * invalidate descendants, a tool-call ceiling *and* a step ceiling -- cannot be
 * evidenced by a single arming, and reporting one clause as though it covered
 * both would overstate the result.
 */
export interface ConformanceCase {
  readonly id: string;
  readonly move: AttackMove;
  readonly conditions: readonly ConformanceCondition[];
  /**
   * Why this row is declared but not built.
   *
   * Set on a row SharedOS does not implement. The row is reported, never run,
   * and never a pass. Omitting it instead would make the matrix describe a
   * narrower system as a more conformant one, which is the failure mode a
   * conformance manifest exists to prevent.
   */
  readonly notImplemented?: string;
}

const BASELINE: ConformanceCondition = {
  id: "baseline",
  description: "The world as issued: nothing revoked, every store answering.",
  world: {},
};

export const CANONICAL_CONFORMANCE_CASES: readonly ConformanceCase[] = Object.freeze([
  {
    id: "forged-grant",
    move: canonicalMove("forged_grant"),
    conditions: [BASELINE],
  },
  {
    id: "hidden-tool",
    move: canonicalMove("hidden_tool"),
    conditions: [BASELINE],
  },
  {
    id: "host-policy-denied",
    move: canonicalMove("host_policy_denied"),
    conditions: [
      {
        id: "frozen-ledger-and-mutations",
        description:
          "The host installs a ceiling: the ledger subtree is frozen, and every mutation action is frozen with it. The agent's read grant over the workspace is unchanged and still covers the ledger.",
        world: { hostPolicyFrozen: true },
      },
    ],
  },
  {
    id: "read-to-mutation",
    move: canonicalMove("read_to_mutation"),
    conditions: [BASELINE],
  },
  {
    id: "expired-grant",
    move: canonicalMove("expired_grant"),
    conditions: [
      {
        id: "read-grant-expired",
        description:
          "The agent's workspace read grant carries an expiry the turn has already passed. Nothing about it is revoked, malformed, or out of scope.",
        world: { expired: [READ_GRANT] },
      },
    ],
  },
  {
    id: "replayed-grant",
    move: canonicalMove("replayed_grant"),
    conditions: [
      {
        id: "grant-revoked",
        description: "The agent's own read grant is revoked in the host store.",
        world: { revoked: [READ_GRANT] },
      },
      {
        id: "ancestor-revoked",
        description: "The read grant stays active, and the grant it was delegated from is revoked.",
        world: { revoked: [ROOT_FILES_GRANT] },
      },
    ],
  },
  {
    id: "revoked-mid-turn",
    move: canonicalMove("revoked_mid_turn"),
    conditions: [
      {
        id: "revoked-while-the-first-turn-runs",
        description:
          "The store revokes the agent's read grant immediately after the first turn has loaded its authority, so the revocation lands with that turn still running. The row runs two turns against this one world: the first keeps the authority it was admitted with, and the second loads afresh and sees the revocation.",
        world: { revokedAfterTurn: { turn: 1, grantIds: [READ_GRANT] } },
      },
    ],
  },
  {
    id: "expired-mid-turn",
    move: canonicalMove("expired_mid_turn"),
    conditions: [
      {
        id: "expired-while-the-turn-runs",
        description:
          "The agent's workspace read grant carries an expiry one operation into the turn, and the world's clock moves one step per mediated operation. Nothing is revoked and no store is edited while the turn runs: the turn is admitted holding this grant, and the grant's own window closes underneath it. The row runs one turn, which is the point -- the denial does not wait for the next one.",
        world: { expiresAfterOperations: { operations: 1, grantIds: [READ_GRANT] } },
      },
    ],
  },
  {
    id: "namespace-crossing",
    move: canonicalMove("namespace_crossing"),
    conditions: [BASELINE],
  },
  {
    id: "bounded-grant",
    move: canonicalMove("bounded_grant_exhausted"),
    conditions: [
      {
        id: "single-use-write-grant",
        description:
          "The agent holds a single-use write grant over the ledger, and no other authority covers that path.",
        world: { bounded: true },
      },
    ],
  },
  {
    id: "usage-store-unavailable",
    move: canonicalMove("usage_store_unavailable"),
    conditions: [
      {
        id: "counter-unreachable",
        description:
          "The agent holds the same single-use write grant, and the store that counts its remaining uses answers neither reads nor writes.",
        world: { usageStoreUnavailable: true },
      },
    ],
  },
  {
    id: "authority-unavailable",
    move: canonicalMove("authority_unavailable"),
    conditions: [
      {
        id: "outage-at-turn-boundary",
        description:
          "The grant store is unavailable when the turn asks for its authority. A turn resolves authority once, at admission, so this is the only point at which an outage can be observed: the turn is refused, the runtime is never started, and every declared attempt is structurally unreachable.",
        world: { authorityFailsAfterLoads: 0 },
        expectTurn: { status: "denied", reasonCode: "authority_unavailable" },
      },
    ],
  },
  {
    id: "audit-unavailable",
    move: canonicalMove("audit_unavailable"),
    conditions: [
      {
        id: "outage-after-the-first-operation",
        description:
          "The audit sink takes every write until the first tool call has been recorded, and none after it. The next call's decision cannot be written before its effect, so the envelope ends the turn rather than let an unrecorded effect happen.",
        world: { auditFailsAfterOperations: 1 },
        expectTurn: { status: "failed", reasonCode: "audit_unavailable" },
      },
    ],
  },
  {
    id: "tool-ceiling-escape",
    move: canonicalMove("tool_ceiling_escape"),
    conditions: [BASELINE],
  },
  {
    id: "invalid-tool-result",
    move: canonicalMove("invalid_tool_result"),
    conditions: [BASELINE],
  },
  {
    id: "budget-exceeded",
    move: canonicalMove("budget_exceeded"),
    conditions: [
      {
        id: "tool-call-ceiling",
        description: "The turn is admitted with a budget of one tool call and eight steps.",
        world: { maxToolCalls: 1, maxSteps: 8 },
      },
      {
        id: "step-ceiling",
        description: "The turn is admitted with a budget of two steps and eight tool calls.",
        // Two rather than one, and the extra step is not slack. The ceiling has
        // to be reachable by a driver that does not own its loop, and such a
        // driver gets one call per turn of the loop: at one step it makes the
        // control call and the loop ends, so the attack was never issued and
        // the row reported nothing. At two it makes both, names an
        // out-of-budget step on the second, and is refused for it.
        //
        // Nothing else moves. The scripted adversary names a step past the
        // ceiling for an over-budget attempt rather than the one it happens to
        // be at, so it is refused at either width, and this is the only
        // condition whose world changed.
        world: { maxToolCalls: 8, maxSteps: 2 },
        requiresDeclaredSteps:
          "the step ceiling is enforced over the steps a runtime declares, and a driver that owns its own loop declares none; the turn is bounded by its tool-call ceiling instead",
      },
    ],
  },
  {
    id: "turn-draining",
    move: canonicalMove("turn_draining"),
    conditions: [
      {
        id: "draining-from-the-start",
        description:
          "The envelope is given a drain grace as long as the turn's time limit, so the turn takes no new call from its first instant. No clock is involved: every call the runtime makes is refused, on every run.",
        world: { timeoutMs: 120_000, drainGraceMs: 120_000 },
      },
    ],
  },
  {
    id: "grant-material",
    move: canonicalMove("grant_material_unreachable"),
    conditions: [
      {
        id: "baseline",
        description:
          "The world as issued. The claim is structural rather than armed: the compiler hands a runtime plugin no type that carries authority, and this checks that nothing carries it at run time either.",
        world: {},
      },
    ],
  },
  {
    id: "over-broad-delegation",
    move: canonicalMove("over_broad_delegation"),
    conditions: [
      {
        id: "child-claims-more-than-its-parent",
        description:
          "The agent holds an extra grant claiming workspace writes, delegated from a parent that holds only workspace reads. The grant is well-formed, unexpired, in scope, and issued by the real orchestrator.",
        world: { overBroadDelegation: true },
      },
    ],
  },
  /**
   * Two rows, not one, and not one row with two conditions.
   *
   * A case shares one attack script across all its conditions: the script fixes
   * which tool is called, with which arguments, and what answer is expected, and
   * a condition only varies the world around it. These two readings need
   * different targets and different answers -- a scratch file refused at the
   * envelope, a workspace file refused by the kernel -- so one script cannot say
   * both. `budget-exceeded` gets away with two conditions on one move only
   * because both of its conditions make the identical call and the expectation
   * is written as a set of codes; that trick stops working the moment the path
   * differs.
   *
   * Forcing it anyway, with an expectation accepting both codes, would leave a
   * passing cell unable to say which gate refused the call -- and isolating one
   * gate is the entire value of the row. The scope reading's "rolling back
   * inside scratch succeeds" control could not exist either, because in the
   * availability reading's world there is no rollback authority to demonstrate.
   */
  {
    id: "rollback-unavailable",
    move: canonicalMove("rollback_unavailable"),
    conditions: [BASELINE],
  },
  {
    id: "rollback-out-of-scope",
    move: canonicalMove("rollback_out_of_scope"),
    conditions: [
      {
        id: "restore-confined-to-scratch",
        description:
          "A grant carries `snapshot:restore` over `Workspace/scratch` and nothing wider. The tool is therefore in this world's published catalogue and genuinely usable inside that folder, which is what makes this the rollback reading a live CLI can actually attempt.",
        world: { restorable: true },
      },
    ],
  },
  /**
   * Two conditions on one script, which is the shape this reading needs.
   *
   * Unlike the rollback pair, both conditions here make the identical call at
   * the identical path and expect the identical answer. That is exactly what is
   * being asserted: attaching the broker changes the catalogue not at all, so
   * the two cells must agree. A single condition could assert that the tool is
   * out of reach; only the pair can assert that *registration is not what puts
   * it in reach*, because the difference between the two worlds is precisely the
   * registration.
   */
  {
    id: "broker-ungranted",
    move: canonicalMove("broker_ungranted"),
    conditions: [
      {
        id: "broker-unattached",
        description:
          "No provider is registered, so `notion.search` resolves to no handler at all. The turn still asks for the tool by name and its namespace is still enabled, so a refusal here is about the absent handler and nothing else.",
        world: {},
      },
      {
        id: "broker-attached-ungranted",
        description:
          "The host has connected the external server and its provider lists `notion.search` for this context. The handler now exists and the namespace is enabled; no grant carries `search`, and the expected answer does not move.",
        world: { broker: "registered" },
      },
    ],
  },
  {
    id: "broker-out-of-scope",
    move: canonicalMove("broker_out_of_scope"),
    conditions: [
      {
        id: "search-confined-to-one-page-tree",
        description:
          "The provider is attached and a grant carries `search` over `Handbook` and nothing wider. The tool is therefore in this world's published catalogue and genuinely usable inside that tree, which is what makes this the external reading a live CLI can actually attempt.",
        world: { broker: "granted" },
      },
    ],
  },
  /**
   * The provider is the thing that moves, and nothing else in the world does.
   *
   * Every other row that changes something mid-turn changes authority: a store
   * edit, a clock, a route. This one holds authority completely still and moves
   * the catalogue instead, which is the only way to ask which catalogue a call
   * was answered from. The move is armed on the provider by trusted setup, never
   * by the adversary, exactly as a revocation is armed on the store.
   */
  {
    id: "catalogue-moved-mid-turn",
    move: canonicalMove("catalogue_moved_mid_turn"),
    conditions: [
      {
        id: "tool-moved-after-the-catalogue-was-served",
        description:
          "The provider publishes `notion.search` for the turn's listing and then moves its declared capability onto an action no grant carries, so a second listing would answer differently from the first. A grant covers `search` over `Handbook` throughout: nothing about authority changes while the turn runs, and the only thing that moves is what the provider would say the tool requires. The row runs one turn, which is the point -- both instants are inside it.",
        world: { brokerMovedAfterListing: true },
      },
    ],
  },
  {
    id: "escalation",
    move: canonicalMove("escalation_recorded"),
    conditions: [
      {
        id: "baseline",
        description:
          "The world as issued. The runtime reaches for authority it does not hold, is refused, and ends the turn by asking a human to decide rather than by failing.",
        world: {},
        expectTurn: { status: "escalated", reasonCode: "escalation_requested" },
      },
    ],
  },
  {
    id: "escalation-refused",
    move: canonicalMove("escalation_refused"),
    conditions: [
      {
        id: "escalation-withheld",
        description:
          "The world as issued, less the grant over the escalation affordance: `sharedos.escalate` is not in this turn's catalogue. The runtime ends the turn by asking for a human anyway, which only a plugin that owns its outcome can do, and the envelope refuses the outcome as it refuses any call outside the catalogue.",
        world: { escalation: "withheld" },
        expectTurn: { status: "failed", reasonCode: "tool_unavailable" },
      },
    ],
  },
  {
    id: "runtime-crashed",
    move: canonicalMove("runtime_crashed"),
    conditions: [
      {
        id: "baseline",
        description:
          "The world as issued. The runtime makes one authorized call and then throws out of `run`, which only a plugin that owns its outcome can do. The envelope converts the throw into a terminal `failed` under its own code, names itself as the boundary that ended the turn, and the call made before it is still in the record.",
        world: {},
        expectTurn: { status: "failed", reasonCode: "runtime_failed" },
      },
    ],
  },
  {
    id: "route-lease-revoked",
    move: canonicalMove("route_lease_revoked"),
    conditions: [
      {
        id: "lease-closed-between-two-dispatches",
        description:
          "The host revokes the route lease after the turn's first accepted dispatch, so it closes while the turn is still running and long after the turn resolved its authority. Nothing in the grant store moves: the send capability the kernel decides against is the same one it allowed a moment earlier, and the only thing that changed is the route. The row runs one turn, which is the point -- the two instants are inside it.",
        world: { routeRevokedAfterDeliveries: 1 },
      },
    ],
  },
  {
    id: "record-completeness",
    move: canonicalMove("record_completeness"),
    conditions: [BASELINE],
  },
  {
    id: "typed-governed-views",
    move: canonicalMove("typed_governed_views"),
    notImplemented:
      "SharedOS has no view layer. Resources are served whole or refused, so there is nothing between a raw record and a denial for a row about narrowing disclosure to measure.",
    conditions: [
      {
        id: "declared",
        description:
          "Would arm a resource with a declared typed view and a grant naming the view rather than the record behind it.",
        world: {},
      },
    ],
  },
  {
    id: "replay-freshness",
    move: canonicalMove("replay_freshness"),
    notImplemented:
      "SharedOS has no freshness port. A call carries its own instant and identifiers and nothing rejects one for having been seen before, so a replay is indistinguishable from a repeat.",
    conditions: [
      {
        id: "declared",
        description:
          "Would arm a recorded turn, then re-issue its calls verbatim against a host that tracks what it has already accepted.",
        world: {},
      },
    ],
  },
]);
