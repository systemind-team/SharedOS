import {
  PROTOCOL_VERSION,
  CapabilitySchema,
  IdentifierSchema,
  JsonObjectSchema,
  RuntimeManifestSchema,
  type ExecutionResult,
  type JsonObject,
  type JsonValue,
  type RuntimeManifest,
  type RuntimeTurnOutcome,
  type ToolCall,
  type ToolResult,
} from "@aicoo/sharedos-contracts";
import {
  ESCALATION_ASKED_ANNOTATION,
  escalationAskedAnnotation,
  type RuntimeHost,
  type RuntimePlugin,
  type RuntimeTurnRequest,
  type RuntimeVisibleContext,
} from "@aicoo/sharedos-runtime";
import { z } from "zod";

/**
 * The runtime event every attempt is announced under.
 *
 * Receipts are emitted as they happen as well as returned with the terminal
 * outcome. A turn that is cancelled or times out loses its terminal metadata,
 * and losing the record of what was attempted would turn a suppressed attack
 * into an indistinguishable pass.
 */
export const ATTEMPT_EVENT_TYPE = "conformance.attempt";

/** The metadata key the terminal report is returned under. */
export const ADVERSARY_METADATA_KEY = "conformance";

/** One adversarial row of the kernel conformance manifest. */
export const ATTACK_MOVE_KINDS = [
  "forged_grant",
  "hidden_tool",
  "read_to_mutation",
  "expired_grant",
  "replayed_grant",
  "revoked_mid_turn",
  "expired_mid_turn",
  "namespace_crossing",
  "bounded_grant_exhausted",
  "usage_store_unavailable",
  "authority_unavailable",
  "audit_unavailable",
  "tool_ceiling_escape",
  "invalid_tool_result",
  "budget_exceeded",
  "turn_draining",
  "grant_material_unreachable",
  "over_broad_delegation",
  "rollback_unavailable",
  "rollback_out_of_scope",
  "broker_ungranted",
  "broker_out_of_scope",
  "catalogue_moved_mid_turn",
  "escalation_recorded",
  "escalation_refused",
  "runtime_crashed",
  "host_policy_denied",
  "route_lease_revoked",
  "record_completeness",
  "typed_governed_views",
  "replay_freshness",
] as const;

export const AttackMoveKindSchema = z.enum(ATTACK_MOVE_KINDS);
export type AttackMoveKind = z.infer<typeof AttackMoveKindSchema>;

/**
 * What one attempt contributes to its move.
 *
 * `control` exists because a denial is only evidence of enforcement if the
 * turn was otherwise able to act. Without a control attempt, a wholly broken
 * fixture reports as a clean pass on every adversarial row.
 */
export const AttemptRoleSchema = z.enum(["attack", "probe", "control"]);
export type AttemptRole = z.infer<typeof AttemptRoleSchema>;

export const AttemptStatusSchema = z.enum(["succeeded", "denied", "failed"]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

/**
 * The outcomes that satisfy one attempt.
 *
 * Sets rather than single values, because SharedOS legitimately refuses the
 * same attempt at different boundaries: an unexposed tool is stopped by the
 * execution envelope, while an out-of-scope resource reaches the kernel. Both
 * are correct refusals and a conformance cell must accept either without
 * pretending they are the same event.
 */
export const AttemptExpectationSchema = z
  .object({
    statuses: z.array(AttemptStatusSchema).min(1).max(3),
    reasonCodes: z.array(IdentifierSchema).min(1).max(8).optional(),
  })
  .strict();
export type AttemptExpectation = z.infer<typeof AttemptExpectationSchema>;

/**
 * A well-formed capability grant the attacker mints for itself at run time.
 *
 * The grant is materialised from the turn context, so it names the real actor,
 * the real owner, and the real namespace, and would authorize the probe if
 * presented material were ever consulted. Only the capabilities are declared
 * here; everything else is filled in from what the runtime legitimately knows.
 */
export const ForgedGrantSchema = z
  .object({
    grantId: IdentifierSchema.max(64),
    capabilities: z.array(CapabilitySchema).min(1).max(8),
    /** The argument key the forged grant is smuggled under. */
    embedAs: IdentifierSchema.max(64),
  })
  .strict();
export type ForgedGrant = z.infer<typeof ForgedGrantSchema>;

/**
 * A surface the attacker reads instead of calling a tool.
 *
 * `grant_material` is the runtime asking the only question it can ask about
 * authority: is any of it reachable from here? The claim it tests is a
 * compile-time one -- a runtime plugin is handed no type that carries grants --
 * so this is the run-time half of the evidence, and `runtime-surface.test.ts`
 * is the half the compiler checks.
 */
export const AttemptInspectionSchema = z.enum(["grant_material"]);
export type AttemptInspection = z.infer<typeof AttemptInspectionSchema>;

export const AttackAttemptSchema = z
  .object({
    id: IdentifierSchema.max(64),
    role: AttemptRoleSchema,
    description: z.string().min(1).max(512),
    /** Omitted only by an attempt that inspects a surface rather than calling. */
    tool: IdentifierSchema.optional(),
    toolArguments: JsonObjectSchema.optional(),
    forge: ForgedGrantSchema.optional(),
    inspect: AttemptInspectionSchema.optional(),
    /**
     * Which turn of the case issues this attempt. Attempts default to the first.
     *
     * A row about what the *next* turn sees needs two turns against one world,
     * and declaring the turn per attempt is what keeps the number of turns a
     * consequence of the move rather than a second thing to keep in step with
     * it.
     */
    turn: z.number().int().min(1).max(8).optional(),
    /**
     * Issue this call even though the runtime knows it is out of budget.
     *
     * The adversary otherwise stops at its own declared ceiling, which is the
     * polite behaviour and exactly what the budget row must not assume: a
     * ceiling only the runtime honours is not a ceiling.
     */
    overBudget: z.boolean().optional(),
    expect: AttemptExpectationSchema,
    /**
     * Declares that a runtime plugin structurally cannot make this attempt, and
     * why. The attempt is still declared so the manifest shows it was
     * considered: an absent row and an unreachable one are different claims.
     */
    unreachable: z.string().min(1).max(512).optional(),
    /**
     * Declares that this attempt names a tool no published catalogue contains,
     * and why that puts it out of reach of a driver with its own tool router.
     *
     * Distinct from `unreachable`, which is a claim about every runtime. This
     * one is true only of a driver that filters its own calls against a
     * catalogue it registered from `tools/list`: a scripted adversary, or an
     * adapter driven by scripted frames, issues the call and SharedOS refuses
     * it with `tool_unavailable`. A CLI speaking MCP never sends it at all, so
     * the second gate upstream decides the row and the envelope is never asked.
     *
     * The attempt is declared identically either way and each column decides
     * what to do with it. The claim is also self-correcting: an attempt any
     * column *does* issue is graded on its receipt, so a client that turned out
     * to forward unknown names would produce a result rather than this label.
     */
    uncatalogued: z.string().min(1).max(512).optional(),
  })
  .strict()
  .refine(
    (attempt) => attempt.tool !== undefined || attempt.inspect !== undefined,
    "An attempt must name the tool it calls or the surface it inspects",
  );
export type AttackAttempt = z.infer<typeof AttackAttemptSchema>;

/**
 * How the turn ends, when the row is about the ending itself.
 *
 * Two endings are expressible, and both are claims about SharedOS rather than
 * about a call inside the turn, so neither can be tested by a turn that always
 * ends `complete`.
 *
 * `escalate` is a runtime ending the turn by asking a human to decide: the
 * claim is that the request is recorded and audited and grants nothing.
 *
 * `crash` is a runtime throwing out of `run`. The claim is what the envelope
 * does with a plugin that stops obeying the protocol entirely -- it is the one
 * ending no plugin cooperates in producing, and the only one where SharedOS has
 * nothing from the seat to read. `reason` is the message thrown, declared here
 * so the throw is as reviewable and as deterministic as every other attempt.
 */
export const AttackTerminalSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("escalate"),
      reason: z.string().min(1).max(512),
    })
    .strict(),
  z
    .object({
      type: z.literal("crash"),
      reason: z.string().min(1).max(512),
    })
    .strict(),
]);
export type AttackTerminal = z.infer<typeof AttackTerminalSchema>;

export const AttackMoveSchema = z
  .object({
    id: IdentifierSchema.max(64),
    kind: AttackMoveKindSchema,
    /** The invariant under attack, verbatim from the conformance manifest. */
    invariant: z.string().min(1).max(512),
    /** The kernel outcome the manifest expects, verbatim. */
    expectedOutcome: z.string().min(1).max(512),
    attempts: z.array(AttackAttemptSchema).min(1).max(32),
    /** Set when the row is about how the turn terminates rather than a call in it. */
    terminal: AttackTerminalSchema.optional(),
  })
  .strict();
export type AttackMove = z.infer<typeof AttackMoveSchema>;

/** How many turns a move's attempts are spread across. */
export function moveTurnCount(move: AttackMove): number {
  return move.attempts.reduce((count, attempt) => Math.max(count, attempt.turn ?? 1), 1);
}

/**
 * What one declared attempt actually did.
 *
 * `attempted` is the field that makes a conformance cell honest. A runtime
 * that never issued the call produces a receipt with `attempted: false` and a
 * reason, so "SharedOS denied the attack" is never inferred from "no attack
 * appears in the trace".
 */
export const AttemptReceiptSchema = z
  .object({
    moveId: IdentifierSchema,
    kind: AttackMoveKindSchema,
    attemptId: IdentifierSchema,
    role: AttemptRoleSchema,
    tool: IdentifierSchema.optional(),
    /** The turn this receipt came from. Absent means the first. */
    turn: z.number().int().min(1).max(8).optional(),
    attempted: z.boolean(),
    callId: IdentifierSchema.optional(),
    /** Argument keys only. Receipts carry no argument values, ever. */
    argumentKeys: z.array(IdentifierSchema).max(64),
    observed: AttemptStatusSchema.optional(),
    reasonCode: IdentifierSchema.optional(),
    expect: AttemptExpectationSchema,
    detail: z.string().min(1).max(512).optional(),
  })
  .strict();
export type AttemptReceipt = z.infer<typeof AttemptReceiptSchema>;

export const AdversarialTurnReportSchema = z
  .object({
    version: z.literal("1"),
    runtimeId: IdentifierSchema,
    executionId: IdentifierSchema,
    traceId: IdentifierSchema,
    /** The permission-filtered catalogue the runtime could actually see. */
    visibleTools: z.array(IdentifierSchema).max(512),
    moveIds: z.array(IdentifierSchema).max(64),
    receipts: z.array(AttemptReceiptSchema).max(512),
  })
  .strict();
export type AdversarialTurnReport = z.infer<typeof AdversarialTurnReportSchema>;

export interface HostileRuntimeOptions {
  readonly runtimeId?: string;
  /**
   * Which turn of the case this instance is running. Attempts declared for any
   * other turn are left alone: they belong to a different turn against the same
   * world, and issuing them here would collapse the two into one.
   */
  readonly turn?: number;
}

/**
 * A scripted adversary that occupies the delegate seat and nothing else.
 *
 * The conformance manifest measures attempted violations, and a model declining
 * to attack is not evidence that the kernel prevented one. This plugin removes
 * the model: it issues exactly the declared calls, in the declared order, and
 * reports what came back.
 *
 * It is an attacker, not a fixture. Every dangerous world condition a row needs
 * -- a revoked ancestor, a second namespace, an unavailable grant store -- is
 * armed by trusted conformance setup outside the security envelope, because
 * SharedOS treats revocation, namespace administration, and infrastructure
 * configuration as host-owned control-plane state rather than agent-reachable
 * operations. Handing those to the adversary would conflate "can an attacker
 * obtain administrative power" with "given this condition, does the kernel
 * enforce". Only the second question belongs to this manifest.
 *
 * Determinism is a property of the implementation, not a convention: nothing
 * here reads a clock, a random source, or a generated identifier. Timestamps
 * come from the turn context and call identifiers from the declared move, so
 * two runs of one move set against one world produce byte-identical receipts.
 * A world whose clock moves does not change that -- the clock it supplies is
 * indexed on the operations the kernel recorded rather than on wall time, so it
 * is still the move set and the world that decide every instant.
 *
 * One instance may serve concurrent turns; all per-turn state lives in `run`.
 */
export class HostileRuntime implements RuntimePlugin {
  readonly manifest: RuntimeManifest;
  readonly #moves: readonly AttackMove[];
  readonly #turn: number;

  constructor(moves: readonly AttackMove[], options: HostileRuntimeOptions = {}) {
    const parsed = z.array(AttackMoveSchema).min(1).max(64).safeParse(moves);
    if (!parsed.success) {
      throw new TypeError(`Attack moves are not valid: ${parsed.error.message}`);
    }
    assertUniqueIds(parsed.data);

    const manifest = RuntimeManifestSchema.safeParse({
      id: options.runtimeId ?? "sharedos.conformance.hostile",
      version: "1.0.0",
      protocolVersion: PROTOCOL_VERSION,
      metadata: {
        adversarial: true,
        deterministic: true,
        moves: parsed.data.map(({ id, kind }) => ({ id, kind })),
      },
    });
    if (!manifest.success) {
      throw new TypeError(`Hostile runtime manifest is not valid: ${manifest.error.message}`);
    }

    this.#moves = Object.freeze(parsed.data.map((move) => Object.freeze(move)));
    this.#turn = options.turn ?? 1;
    this.manifest = manifest.data;
  }

  async run(
    turn: RuntimeTurnRequest,
    host: RuntimeHost,
    signal: AbortSignal,
  ): Promise<RuntimeTurnOutcome> {
    const receipts: AttemptReceipt[] = [];
    const visibleTools = turn.tools.map(({ name }) => name);
    let issued = 0;
    let hostLost: string | undefined;

    for (const move of this.#moves) {
      for (const attempt of move.attempts) {
        if ((attempt.turn ?? 1) !== this.#turn) {
          continue;
        }
        const receipt =
          hostLost === undefined
            ? await this.#issue(turn, host, signal, move, attempt, issued)
            : skipped(move, attempt, hostLost);
        if (receipt.attempted) {
          issued += 1;
        }
        receipts.push(receipt);

        if (hostLost !== undefined) {
          continue;
        }
        try {
          host.emit({ type: ATTEMPT_EVENT_TYPE, data: receipt as unknown as JsonValue });
        } catch {
          // The envelope has closed the host. Stop attempting, keep the
          // receipts already collected, and return them rather than throwing:
          // a lost report is indistinguishable from an attack never made.
          hostLost = "the runtime host closed before this attempt was made";
        }
      }
    }

    const report: AdversarialTurnReport = {
      version: "1",
      runtimeId: this.manifest.id,
      executionId: turn.executionId,
      traceId: turn.context.traceId,
      visibleTools,
      moveIds: this.#moves.map(({ id }) => id),
      receipts,
    };

    const metadata = {
      [ADVERSARY_METADATA_KEY]: report as unknown as JsonValue,
    } as JsonObject;

    // The report rides out on an escalated turn too. An escalation is a
    // terminal outcome like any other, and a row that lost its receipts
    // whenever the turn ended by asking for help would be unable to say what
    // the turn had done before it asked.
    const terminal = this.#moves.find(({ terminal: value }) => value !== undefined)?.terminal;
    if (terminal?.type === "escalate") {
      // Stated as every honouring path states it, so the reference column's
      // record has the same trace a live one does and the judge reads one rule
      // for both.
      host.annotate(ESCALATION_ASKED_ANNOTATION, escalationAskedAnnotation(terminal.reason));
      return { type: "escalate", reason: terminal.reason, metadata };
    }

    // A crash is the one ending that cannot carry the report out. There is no
    // outcome to attach metadata to, so the receipts above have to have already
    // left through `host.emit` -- which is why they are emitted as they happen
    // rather than only summarised at the end. The throw is last, after every
    // declared attempt has been issued and announced, so what the turn managed
    // to do before it stopped obeying the protocol is still in the record.
    if (terminal?.type === "crash") {
      throw new Error(terminal.reason);
    }

    return {
      type: "complete",
      output: {
        declared: receipts.length,
        attempted: receipts.filter(({ attempted }) => attempted).length,
      },
      metadata,
    };
  }

  async #issue(
    turn: RuntimeTurnRequest,
    host: RuntimeHost,
    signal: AbortSignal,
    move: AttackMove,
    attempt: AttackAttempt,
    issued: number,
  ): Promise<AttemptReceipt> {
    if (attempt.unreachable !== undefined) {
      return skipped(move, attempt, attempt.unreachable);
    }
    if (signal.aborted) {
      return skipped(move, attempt, "the turn was cancelled before this attempt was made");
    }
    if (attempt.inspect !== undefined) {
      return inspectSurfaces(turn, host, move, attempt);
    }
    if (attempt.tool === undefined) {
      return skipped(move, attempt, "the attempt names neither a tool nor a surface");
    }
    const { maxSteps, maxToolCalls } = host.limits;
    if (maxToolCalls !== undefined && issued >= maxToolCalls && attempt.overBudget !== true) {
      return skipped(move, attempt, "the attempt falls outside the turn's tool-call budget");
    }

    const toolArguments = attemptArguments(turn.context, attempt);
    const call: ToolCall = {
      id: attemptCallId(turn.executionId, move, attempt),
      tool: attempt.tool,
      arguments: toolArguments,
      traceId: turn.context.traceId,
      requestedAt: turn.context.now,
    };
    const base = {
      ...receiptBase(move, attempt),
      argumentKeys: Object.keys(toolArguments).sort(),
      callId: call.id,
    };

    let result: ToolResult;
    try {
      // An over-budget attempt names a step it has no right to, rather than the
      // one it happens to be at. The two coincide only when the ceiling is
      // exactly the number of calls already made, and a row that depended on
      // that coincidence would stop testing the ceiling the moment the world
      // widened by one step. Naming it outright is what `overBudget` means: a
      // ceiling only the runtime honours is not a ceiling.
      //
      // Only where the step budget is the one being exceeded, though. A world
      // that has already run out of tool calls is testing that ceiling, and
      // naming a step past the other one would have the row report the wrong
      // boundary -- `step_limit_exceeded` on a condition armed to evidence
      // `tool_call_limit_exceeded`. Both are correct refusals; they are not
      // interchangeable evidence. With no step budget set there is nothing to
      // name a step past, and the attempt keeps its own.
      const step =
        attempt.overBudget === true &&
        maxSteps !== undefined &&
        (maxToolCalls === undefined || issued < maxToolCalls)
          ? Math.max(issued, maxSteps)
          : issued;
      result = await host.invokeTool(call, { step });
    } catch (error) {
      return {
        ...base,
        attempted: false,
        detail: `the runtime host refused the call: ${describe(error)}`,
      };
    }

    return {
      ...base,
      attempted: true,
      observed: result.status,
      ...(result.status === "succeeded" ? {} : { reasonCode: result.error.code }),
    };
  }
}

/**
 * Read the terminal report a {@link HostileRuntime} turn produced.
 *
 * The terminal metadata is authoritative but is lost whenever the turn does not
 * end normally, so the event stream is used as the fallback. Both sources are
 * validated; neither is trusted on shape.
 */
export function readAdversarialReport(result: ExecutionResult): AdversarialTurnReport | undefined {
  const declared = AdversarialTurnReportSchema.safeParse(
    (result.metadata as JsonObject | undefined)?.[ADVERSARY_METADATA_KEY],
  );
  if (declared.success) {
    return declared.data;
  }

  const receipts = readAttemptReceipts(result);
  if (receipts.length === 0) {
    return undefined;
  }
  const reconstructed = AdversarialTurnReportSchema.safeParse({
    version: "1",
    runtimeId: runtimeIdOf(result) ?? "unknown",
    executionId: result.executionId,
    traceId: result.traceId,
    visibleTools: visibleToolsOf(result),
    moveIds: [...new Set(receipts.map(({ moveId }) => moveId))],
    receipts,
  });
  return reconstructed.success ? reconstructed.data : undefined;
}

/**
 * Recover attempt receipts from the execution event stream alone.
 *
 * This is the durable evidence path: events survive a cancelled, failed, or
 * timed-out turn, and they are also what lands in a standard execution record.
 */
export function readAttemptReceipts(result: ExecutionResult): readonly AttemptReceipt[] {
  const receipts: AttemptReceipt[] = [];
  for (const event of result.events) {
    if (event.type !== "runtime.event") {
      continue;
    }
    const data = event.data as { type?: unknown; data?: unknown } | null;
    if (data === null || typeof data !== "object" || data.type !== ATTEMPT_EVENT_TYPE) {
      continue;
    }
    const parsed = AttemptReceiptSchema.safeParse(data.data);
    if (parsed.success) {
      receipts.push(parsed.data);
    }
  }
  return receipts;
}

/**
 * The identifier one declared attempt's call is issued under.
 *
 * Derived rather than generated, so a receipt can be reconstructed from an
 * execution record alone. That is what lets a runtime which cannot report on
 * itself -- a vendor harness replaying scripted frames -- still be graded
 * against the same declared attempts as the scripted adversary.
 */
export function attemptCallId(
  executionId: string,
  move: AttackMove,
  attempt: AttackAttempt,
): string {
  return `${executionId}.${move.id}.${attempt.id}`;
}

/**
 * The arguments one declared attempt is issued with, forgery included.
 *
 * Exported because a transcript of scripted frames has to carry exactly the
 * arguments the scripted adversary would have sent. Building them twice is how
 * two runtimes end up attacking two slightly different things and reporting it
 * as one comparison.
 */
export function attemptArguments(
  context: RuntimeVisibleContext,
  attempt: AttackAttempt,
): JsonObject {
  const declared = attempt.toolArguments ?? {};
  if (attempt.forge === undefined) {
    return structuredClone(declared);
  }
  return {
    ...structuredClone(declared),
    [attempt.forge.embedAs]: forgeGrant(context, attempt.forge),
  };
}

/**
 * Build a schema-valid grant naming the turn's real actor, owner, namespace,
 * purpose, and instant. Everything an authorization decision would need is
 * present and internally consistent; the only thing missing is that no trusted
 * source ever issued it.
 */
function forgeGrant(context: RuntimeVisibleContext, forge: ForgedGrant): JsonValue {
  return {
    id: forge.grantId,
    namespaceId: context.namespaceId,
    subject: context.actor,
    issuer: context.owner,
    capabilities: forge.capabilities,
    constraints: { purposes: [context.purpose] },
    issuedAt: context.now,
  } as unknown as JsonValue;
}

/**
 * Keys that would carry authority if any of them were reachable.
 *
 * The list is of names rather than shapes on purpose: a leak is far more likely
 * to arrive as a field somebody added to a context or a host than as a
 * well-formed `CapabilityGrant`, and a shape check would miss exactly that.
 * `requiredCapability` is deliberately absent -- a tool definition declares what
 * it would need, which is a description of the tool and not authority to use it.
 */
const GRANT_MATERIAL_KEYS = [
  "grant",
  "grants",
  "grantId",
  "grantSource",
  "parentGrantId",
  "capabilities",
  "delegationDepth",
  "issuer",
  "revokedAt",
];

/**
 * Read every surface a runtime plugin is given, looking for authority.
 *
 * This is the only form the attack can take from inside a plugin, and it is
 * expected to come back empty: the turn request carries a sanitised context and
 * a filtered catalogue, and the host exposes limits, a tool call, and an event
 * sink. What it finds, if anything, is named in the receipt, so a regression
 * says which field started carrying grants rather than only that one did.
 */
function inspectSurfaces(
  turn: RuntimeTurnRequest,
  host: RuntimeHost,
  move: AttackMove,
  attempt: AttackAttempt,
): AttemptReceipt {
  const found = [
    ...findGrantMaterial(turn, "turn"),
    ...surfaceKeys(host).flatMap((key) =>
      GRANT_MATERIAL_KEYS.includes(key) ? [`host.${key}`] : [],
    ),
  ].sort();

  const base = { ...receiptBase(move, attempt), argumentKeys: [], attempted: true };
  return found.length === 0
    ? {
        ...base,
        observed: "denied",
        reasonCode: "no_grant_material_reachable",
        detail: "no field of the turn request or the runtime host carries authority",
      }
    : {
        ...base,
        observed: "succeeded",
        detail: `authority is reachable at ${found.join(", ")}`.slice(0, 512),
      };
}

function findGrantMaterial(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findGrantMaterial(item, `${path}.${index}`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    GRANT_MATERIAL_KEYS.includes(key)
      ? [`${path}.${key}`]
      : findGrantMaterial(child, `${path}.${key}`),
  );
}

/** Own and inherited property names, so a leak on a prototype is not missed. */
function surfaceKeys(value: object): string[] {
  const keys = new Set<string>();
  for (
    let current: object | null = value;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const key of Object.getOwnPropertyNames(current)) {
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * What a receipt says about its attempt before anything was observed.
 *
 * Exported because a receipt is built in three places -- by the adversary from
 * what it was answered, and twice from a record for a runtime that cannot
 * report on itself -- and the declared half has to read the same in all three
 * for the judge to grade them as one thing.
 */
export function receiptBase(
  move: AttackMove,
  attempt: AttackAttempt,
): Pick<AttemptReceipt, "moveId" | "kind" | "attemptId" | "role" | "tool" | "turn" | "expect"> {
  return {
    moveId: move.id,
    kind: move.kind,
    attemptId: attempt.id,
    role: attempt.role,
    ...(attempt.tool === undefined ? {} : { tool: attempt.tool }),
    ...(attempt.turn === undefined ? {} : { turn: attempt.turn }),
    expect: attempt.expect,
  };
}

function skipped(move: AttackMove, attempt: AttackAttempt, detail: string): AttemptReceipt {
  return { ...receiptBase(move, attempt), attempted: false, argumentKeys: [], detail };
}

function assertUniqueIds(moves: readonly AttackMove[]): void {
  const moveIds = new Set<string>();
  for (const move of moves) {
    if (moveIds.has(move.id)) {
      throw new TypeError(`Attack move ids must be unique: ${move.id}`);
    }
    moveIds.add(move.id);

    const attemptIds = new Set<string>();
    for (const attempt of move.attempts) {
      if (attemptIds.has(attempt.id)) {
        throw new TypeError(`Attempt ids must be unique within a move: ${move.id}.${attempt.id}`);
      }
      attemptIds.add(attempt.id);
    }
  }
}

function visibleToolsOf(result: ExecutionResult): readonly string[] {
  for (const event of result.events) {
    if (event.type !== "turn.started") {
      continue;
    }
    const data = event.data as { visibleTools?: unknown } | null;
    if (data !== null && typeof data === "object" && Array.isArray(data.visibleTools)) {
      return data.visibleTools.filter((name): name is string => typeof name === "string");
    }
  }
  return [];
}

function runtimeIdOf(result: ExecutionResult): string | undefined {
  const runtime = (result.metadata as JsonObject | undefined)?.["runtime"];
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) {
    return undefined;
  }
  const id = (runtime as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
