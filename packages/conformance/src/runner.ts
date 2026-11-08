import type { RuntimeManifest } from "@aicoo/sharedos-contracts";
import { SharedOSExecutor } from "@aicoo/sharedos-runtime";

import {
  moveTurnCount,
  readAdversarialReport,
  type AdversarialTurnReport,
  type AttackMove,
  type AttemptReceipt,
} from "./adversary.js";
import {
  ADVERSARY_COLUMN,
  CLAUDE_CODE_SCRIPTED_COLUMN,
  CODEX_SCRIPTED_COLUMN,
  DEEPSEEK_SCRIPTED_COLUMN,
  MODEL_SCRIPTED_COLUMN,
  PI_SCRIPTED_COLUMN,
  type ColumnLimits,
  type RuntimeColumn,
} from "./columns.js";
import { assembleExecutionRecord } from "./assemble.js";
import { hashExperimentInputs, hashJson } from "./hashing.js";
import {
  JUDGE_VERSION,
  judgeCase,
  type ConformanceStatus,
  type EnforcementPoint,
} from "./judge.js";
import type { ExecutionRecord } from "./record.js";
import {
  CANONICAL_CONFORMANCE_CASES,
  type ConformanceCase,
  type ConformanceCondition,
} from "./suite.js";
import { createConformanceWorld, type ConformanceWorld } from "./world.js";
import { PROTOCOL_VERSION, SHAREDOS_VERSION } from "@aicoo/sharedos-contracts";

/** The SharedOS build an execution record was produced by: the one in contracts. */
export { SHAREDOS_VERSION };

/**
 * One cell of the manifest.
 *
 * Every field here is invariant-relevant and stable across runs. Model names,
 * adapter versions, timings, and event volumes belong to the evidence artifact,
 * so a committed manifest diffs only when enforcement behaviour changes.
 */
export interface ConformanceCell {
  readonly columnId: string;
  readonly status: ConformanceStatus;
  readonly refusedBy: readonly EnforcementPoint[];
  readonly reasonCodes: readonly string[];
  /**
   * The codes behind those refusals where the record carried one: a refusal
   * the kernel let stand rather than made, named in the host's vocabulary.
   * Reported, never graded.
   */
  readonly causes: readonly string[];
  readonly declared: number;
  readonly attempted: number;
  /** Attempts a runtime structurally cannot make, declared rather than omitted. */
  readonly notApplicable: number;
  readonly recordUsable: boolean;
  readonly recordGaps: readonly string[];
  /** Adversarial attempts this column issued on the row's behalf, not by choice. */
  readonly driverIssued: readonly string[];
  /** Turns run against one world for this cell. One unless the move spans more. */
  readonly turns: number;
  readonly detail?: string;
}

export interface ConformanceRow {
  readonly caseId: string;
  readonly conditionId: string;
  readonly kind: AttackMove["kind"];
  readonly invariant: string;
  readonly expectedOutcome: string;
  readonly condition: string;
  readonly cells: readonly ConformanceCell[];
}

export interface ConformanceManifest {
  readonly version: "1";
  readonly judgeVersion: string;
  /** Hash of the case definitions this manifest was produced from. */
  readonly caseSetHash: string;
  /**
   * Hash of the worlds those cases were run against. Separate from the case set
   * on purpose; see {@link worldSetIdentity}.
   */
  readonly worldSetHash: string;
  readonly columns: readonly ConformanceColumnIdentity[];
  readonly rows: readonly ConformanceRow[];
}

/** One column as the manifest names it, with what it told the seat. */
export interface ConformanceColumnIdentity {
  readonly id: string;
  readonly label: string;
  /**
   * Hash of what this column's runtime told the seat, row by row; see
   * {@link promptSetIdentity}. Absent for a column that tells the seat nothing.
   */
  readonly promptSetHash?: string;
}

/** Everything behind one cell. Large, and expected to churn on runtime metadata. */
export interface ConformanceEvidence {
  readonly caseId: string;
  readonly conditionId: string;
  readonly columnId: string;
  readonly runtime: RuntimeManifest;
  /**
   * One record per turn, in order. A row about what the next turn sees produces
   * two, and keeping both is what lets the claim be re-checked without re-running
   * anything.
   */
  readonly records: readonly ExecutionRecord[];
  readonly reports: readonly (AdversarialTurnReport | undefined)[];
}

export interface ConformanceRun {
  readonly manifest: ConformanceManifest;
  readonly evidence: readonly ConformanceEvidence[];
}

/**
 * The columns a committed manifest is produced from.
 *
 * The scripted adversary in the SharedOS executor; the native harness with a
 * transcript in the model's seat; and each vendor adapter driven by scripted
 * frames. The native and vendor columns exercise their driver's own translation
 * against the real kernel and envelope; what is left out is the provider or the
 * transport that would have produced the frames, so a live column is a separate
 * claim and is not made here.
 */
export const DEFAULT_COLUMNS: readonly RuntimeColumn[] = Object.freeze([
  ADVERSARY_COLUMN,
  MODEL_SCRIPTED_COLUMN,
  CODEX_SCRIPTED_COLUMN,
  CLAUDE_CODE_SCRIPTED_COLUMN,
  DEEPSEEK_SCRIPTED_COLUMN,
  PI_SCRIPTED_COLUMN,
]);

/**
 * What the case-set hash is taken over: the declarations, without the prose.
 *
 * A `description` is documentation. It says why an attempt exists and what a
 * reader should make of it; nothing in the suite branches on it, and two case
 * sets differing only in prose put exactly the same calls to the kernel. Hashing
 * it anyway made every editorial fix look like a different experiment, and --
 * because the live columns are expensive to produce and are compared to the
 * scripted ones by this hash -- put a live re-run behind rewording a sentence.
 * The predictable result was that sentences did not get reworded.
 *
 * Everything a run's behaviour depends on stays in: ids, tools, arguments,
 * conditions, expectations, and the markers that decide whether an attempt is
 * issued at all. Change any of those and the hash moves, which is the point.
 *
 * Strips every `description` key at any depth rather than the two known sites,
 * so a description added to a new declaration shape is covered without anyone
 * remembering to come back here.
 */
export function caseSetIdentity(cases: readonly ConformanceCase[]): unknown {
  return withoutDescriptions(cases);
}

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutDescriptions);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "description")
      .map(([key, entry]) => [key, withoutDescriptions(entry)]),
  );
}

/**
 * What the world-set hash is taken over: the worlds those cases materialise.
 *
 * The case set says what will be attempted. It does not say what it will be
 * attempted *against*. A condition's `world` overrides are declarations and are
 * inside the case-set hash, but the world they modify is not: its grants, its
 * enabled namespaces, and its registered tools are defined in `world.ts` and can
 * be rewritten without one case changing.
 *
 * That is not hypothetical. `grant-sealed` gained the `purge` capability that
 * makes the namespace the only gate still closed against `files.purge`, and the
 * case-set hash did not move -- so nothing on disk recorded that the live
 * columns had been produced against a different world than the scripted ones.
 * A hash that cannot see the change it most needs to see is worse than no hash,
 * because it is read as a guarantee.
 *
 * Hashed separately rather than folded into the case set, because the two answer
 * different questions and one identifier could not say which had moved: a
 * changed case set means two runs asked different things, a changed world set
 * means they asked the same thing of different states. Only both together say
 * two runs may be compared.
 */
export function worldSetIdentity(cases: readonly ConformanceCase[]): unknown {
  return cases.map((kase) => ({
    case: kase.id,
    conditions: kase.conditions.map((condition) => ({
      condition: condition.id,
      world: worldDescription(createConformanceWorld(condition.world), condition),
    })),
  }));
}

export interface RunConformanceSuiteOptions {
  readonly cases?: readonly ConformanceCase[];
  readonly columns?: readonly RuntimeColumn[];
}

/**
 * Run every case under every column and grade the result.
 *
 * Cells are produced in declared order and nothing here reads a clock or a
 * random source, so one case set against one set of columns yields the same
 * manifest every time.
 */
export async function runConformanceSuite(
  options: RunConformanceSuiteOptions = {},
): Promise<ConformanceRun> {
  const cases = options.cases ?? CANONICAL_CONFORMANCE_CASES;
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const [caseSetHash, worldSetHash] = await Promise.all([
    hashJson(caseSetIdentity(cases)),
    hashJson(worldSetIdentity(cases)),
  ]);

  const rows: ConformanceRow[] = [];
  const evidence: ConformanceEvidence[] = [];

  for (const kase of cases) {
    for (const condition of kase.conditions) {
      const cells: ConformanceCell[] = [];
      for (const column of columns) {
        if (kase.notImplemented !== undefined) {
          cells.push(declaredCell(column, kase.move, "not_implemented", kase.notImplemented));
          continue;
        }
        const unsupported = column.limits?.(kase.move, condition)?.unsupported;
        if (unsupported !== undefined) {
          cells.push(declaredCell(column, kase.move, "not_applicable", unsupported));
          continue;
        }
        const cell = await runCell(kase, condition, column);
        cells.push(cell.cell);
        evidence.push(cell.evidence);
      }
      rows.push({
        caseId: kase.id,
        conditionId: condition.id,
        kind: kase.move.kind,
        invariant: kase.move.invariant,
        expectedOutcome: kase.move.expectedOutcome,
        condition: condition.description,
        cells,
      });
    }
  }

  return {
    manifest: {
      version: "1",
      judgeVersion: JUDGE_VERSION,
      caseSetHash,
      worldSetHash,
      columns: await Promise.all(
        columns.map(async ({ id, label }) => {
          const handed = promptSetIdentity(evidence, id);
          return handed === undefined
            ? { id, label }
            : { id, label, promptSetHash: await hashJson(handed) };
        }),
      ),
      rows,
    },
    evidence,
  };
}

/**
 * What the prompt-set hash is taken over: what one column told the seat, per turn.
 *
 * The case set says what will be attempted and the world set what it will be
 * attempted against. Neither says how the seat was asked. The prompt is written
 * by code, not declared by a case, so rewording it moved no hash -- and a
 * reworded prompt is a different question, whose answer cannot be compared to
 * the last one on the model's choices. That is not hypothetical either: one
 * sentence about what the tool-call channel carries took five `not exercised`
 * cells to none on the same model, and nothing on disk would have said the two
 * runs were asked differently.
 *
 * Taken from the records rather than from the prompt builder, so it says what
 * was sent: each turn's `promptHash`, which the runtime computed over the
 * instructions and the prompt it actually handed over, in row order. It is per
 * column because the wording differs by design between a seat whose channel
 * carries any name and one behind an MCP router, and a single hash could not
 * say which column's question had changed. A column that hands the seat no
 * text -- the adversary, a driven vendor column whose frames are written for it
 * -- has no identity here rather than a hash over nothing.
 *
 * Only turns that ran contribute: a declared cell has no record. So the set is
 * also a statement of which rows this column put to the seat, and a row that
 * became reachable is a different set, which is the correct reading.
 */
export function promptSetIdentity(
  evidence: readonly ConformanceEvidence[],
  columnId: string,
): readonly unknown[] | undefined {
  const handed = evidence
    .filter((entry) => entry.columnId === columnId)
    .flatMap((entry) =>
      entry.records.flatMap((record, index) =>
        record.system.promptHash === undefined
          ? []
          : [
              {
                case: entry.caseId,
                condition: entry.conditionId,
                turn: index + 1,
                promptHash: record.system.promptHash,
              },
            ],
      ),
    );
  return handed.length === 0 ? undefined : handed;
}

/**
 * A cell that was decided without running anything.
 *
 * Two things are reported this way: a row SharedOS does not implement, and a
 * row this column structurally cannot run. Neither is a result about
 * enforcement, and running a turn to produce one would only manufacture
 * evidence for a claim nobody made. The cell still carries the move's declared
 * attempt count, so the manifest says how much of the row went unmeasured
 * rather than only that some of it did.
 */
function declaredCell(
  column: RuntimeColumn,
  move: AttackMove,
  status: "not_implemented" | "not_applicable",
  reason: string,
): ConformanceCell {
  return {
    columnId: column.id,
    status,
    refusedBy: [],
    reasonCodes: [],
    causes: [],
    declared: move.attempts.length,
    attempted: 0,
    notApplicable: status === "not_applicable" ? move.attempts.length : 0,
    recordUsable: false,
    recordGaps: [],
    driverIssued: [],
    turns: 0,
    detail: reason,
  };
}

/**
 * Run one cell: the move, under one condition, against one column.
 *
 * A move whose attempts name more than one turn is run once per turn against a
 * single world, so a claim about what the *next* turn sees is evidenced by an
 * actual next turn rather than by a second fixture. Receipts are merged across
 * turns -- attempt ids are unique within a move -- and every turn's record is
 * kept. The last turn's record is what the row is graded against, because that
 * is the turn the claim is about.
 */
async function runCell(
  kase: ConformanceCase,
  condition: ConformanceCondition,
  column: RuntimeColumn,
): Promise<{ cell: ConformanceCell; evidence: ConformanceEvidence }> {
  const world = createConformanceWorld(condition.world);
  const executionId = `${kase.id}.${condition.id}.${column.id}`;
  const turns = moveTurnCount(kase.move);
  const limits: ColumnLimits = column.limits?.(kase.move, condition) ?? {};
  const hashes = await hashExperimentInputs({
    // Without the prose, as the case-set hash is taken: a reworded description
    // is the same experiment, and a hash that moved for one would say otherwise
    // on every record of the cell.
    spec: { case: kase.id, move: withoutDescriptions(kase.move), condition: condition.id },
    world: worldDescription(world, condition),
    evaluator: { judge: "sharedos-conformance", version: JUDGE_VERSION },
    policy: {
      enabledToolNamespaces: world.context.enabledToolNamespaces,
      tools: world.tools,
    },
  });

  const records: ExecutionRecord[] = [];
  const reports: (AdversarialTurnReport | undefined)[] = [];
  const receipts: AttemptReceipt[] = [];

  for (let turn = 1; turn <= turns; turn += 1) {
    const turnId = turns === 1 ? executionId : `${executionId}.turn-${turn}`;
    const request = world.request(turnId, turn);

    let sequence = 0;
    const result = await new SharedOSExecutor(
      world.kernel,
      column.create([kase.move], { turn, executionId: turnId }),
      {
        // The world's clock, not the frozen constant. It is frozen for every
        // condition that did not arm one that moves, so this changes nothing on
        // any existing row -- and a row whose claim is that a window closes
        // mid-turn cannot be run against a clock that never reaches it.
        clock: world.clock,
        createId: () => `${turnId}.event-${(sequence += 1)}`,
        ...world.envelope,
      },
    ).execute(request);

    const record = assembleExecutionRecord({
      request,
      result,
      auditEvents: world.auditEvents,
      experiment: {
        experimentId: "kernel-conformance",
        taskId: kase.id,
        runId:
          turns === 1 ? `${condition.id}.${column.id}` : `${condition.id}.${column.id}.${turn}`,
        specHash: hashes.specHash,
        worldHash: hashes.worldHash,
        evaluatorHash: hashes.evaluatorHash,
      },
      system: {
        protocolVersion: PROTOCOL_VERSION,
        sharedOsVersion: SHAREDOS_VERSION,
        adapterId: column.id,
        policyHash: hashes.policyHash,
        // Assembly reconciles this declaration with the runtime; neither proves isolation.
        ...(column.toolPolicy === undefined ? {} : { toolPolicy: column.toolPolicy }),
      },
    });

    const report = readAdversarialReport(result);
    records.push(record);
    reports.push(report);
    // A column that cannot report on itself has its attempts recovered from the
    // record, which is the stricter source: a runtime that quietly skipped a
    // call leaves no operation behind to be mistaken for a denial.
    receipts.push(
      ...(column.receipts === undefined
        ? (report?.receipts ?? [])
        : column.receipts(kase.move, { executionId: turnId, turn, record })),
    );
  }

  const record = records[records.length - 1] as ExecutionRecord;
  const judgement = judgeCase(
    kase.move,
    { receipts, record },
    {
      ...(condition.expectTurn === undefined ? {} : { expectTurn: condition.expectTurn }),
      ...(limits.unreachable === undefined ? {} : { unreachable: limits.unreachable }),
      ...(limits.driverIssued === undefined ? {} : { driverIssued: limits.driverIssued }),
    },
  );

  // Applied after judging rather than instead of it, so the row is still run and
  // its receipts still kept. What the ungraded call actually did stays in the
  // evidence; only the verdict is withheld, because SharedOS declares no
  // guarantee here to hold it against.
  const status: ConformanceStatus =
    limits.outOfScope === undefined ? judgement.status : "out_of_scope";

  return {
    cell: {
      columnId: column.id,
      status,
      refusedBy: judgement.refusedBy,
      reasonCodes: judgement.reasonCodes,
      causes: judgement.causes,
      declared: judgement.declared,
      attempted: judgement.attempted,
      driverIssued: judgement.driverIssued,
      notApplicable: judgement.attempts.filter(({ status }) => status === "not_applicable").length,
      recordUsable: judgement.recordUsable,
      recordGaps: judgement.recordGaps,
      turns,
      ...(limits.outOfScope !== undefined
        ? { detail: limits.outOfScope }
        : judgement.detail === undefined
          ? {}
          : { detail: judgement.detail }),
    },
    evidence: {
      caseId: kase.id,
      conditionId: condition.id,
      columnId: column.id,
      runtime: record.system.runtime,
      records,
      reports,
    },
  };
}

/** What the condition materialised, hashed separately from the specification. */
function worldDescription(world: ConformanceWorld, condition: ConformanceCondition): unknown {
  return {
    condition: condition.world,
    namespaceId: world.context.namespaceId,
    enabledToolNamespaces: world.context.enabledToolNamespaces,
    // The grants the condition actually issued, not the ones the baseline
    // world would have. A condition that adds authority has a different world,
    // and a world hash that could not tell them apart would let two different
    // worlds claim to be reproductions of each other.
    grants: world.grants,
    // Whole definitions, prose included. A tool's description and its input
    // schema are not documentation the way a case description is: they are
    // served to the model over MCP and are the only thing it has to choose a
    // call from -- a live CLI found that an opaque `inputSchema` changes what a
    // model does. Rewording one is therefore a different world, which is the
    // opposite of the rule the case set follows for its own descriptions.
    tools: world.tools,
  };
}

export interface StrictFailure {
  readonly caseId: string;
  readonly conditionId: string;
  readonly columnId: string;
  readonly status: ConformanceStatus;
  readonly detail: string;
}

/**
 * Cells that must break a build.
 *
 * `not_exercised` is included on purpose: a row that proved nothing is a broken
 * suite, and treating it as a soft result is how a manifest ends up reporting
 * guarantees nobody tested.
 *
 * `not_implemented` is excluded, and is one of two statuses that are standing
 * results rather than regressions: the row is declared, its absence is stated
 * in the manifest, and a build that failed on it would only pressure someone
 * into deleting the row. It is counted and printed by the conformance script
 * so the gap stays in view.
 *
 * `out_of_scope` is excluded for the same reason and needs the same care. It
 * records a guarantee SharedOS has declared does not reach a column, which is a
 * narrowing of the claim rather than a defect -- but a narrowing is exactly the
 * thing that could be used to make a build go green, so the row stays printed,
 * stays out of every pass rate, and carries the reason it was narrowed.
 */
export function strictFailures(manifest: ConformanceManifest): readonly StrictFailure[] {
  const failures: StrictFailure[] = [];
  for (const row of manifest.rows) {
    for (const cell of row.cells) {
      if (cell.status === "fail" || cell.status === "not_exercised") {
        failures.push({
          caseId: row.caseId,
          conditionId: row.conditionId,
          columnId: cell.columnId,
          status: cell.status,
          detail: cell.detail ?? row.invariant,
        });
      }
    }
  }
  return failures;
}

/** Render the manifest as a stable Markdown document. */
export function renderConformanceSummary(manifest: ConformanceManifest): string {
  const columns = manifest.columns;
  const header = [
    "Invariant",
    "Expected outcome",
    "Condition",
    ...columns.map(({ label }) => label),
  ];
  const lines = [
    "# Kernel conformance manifest",
    "",
    "Generated by `pnpm conformance`. Every row is an attempted violation, run by a",
    "scripted adversary against a world armed by trusted setup.",
    "",
    "The `Adversary` column is the reference: a plugin that owns its outcome, issues",
    "every declared attempt itself, and calls the host directly. It goes through no",
    "driver and no catalogue rendering, so its cell says what the kernel does to an",
    "attempt and nothing about the loop SharedOS ships.",
    "",
    "The `Standard` column is that loop: the native harness, the standard loop with",
    "the model driver in the seat and the permission-filtered catalogue rendered",
    "into the model's own tool-call shape. In the committed manifest a transcript",
    "stands where the provider would, written here from the declared attempt, and",
    "the driver's real translation reads it back. What is left out is the model:",
    "a live one chooses, and a committed cell cannot depend on a choice.",
    "",
    "Vendor columns are scripted the same way. Their frames are written here, from",
    "the declared attempt, in the wire shape that vendor's protocol is understood to",
    "use, and are parsed back by the adapter's real protocol translation against the",
    "real kernel and envelope. No vendor session was captured. Two things are left",
    "out — the transport that would carry the frames from a live CLI, and whether",
    "the vendor still emits these shapes — so these columns say nothing about a",
    "live session. Live-run columns are a separate claim and are not made here.",
    "",
    `- Case set: \`${manifest.caseSetHash}\``,
    `- World set: \`${manifest.worldSetHash}\``,
    `- Grading rules: version \`${manifest.judgeVersion}\``,
    `- Columns: ${manifest.columns.map(({ label }) => `\`${label}\``).join(", ")}`,
    ...manifest.columns
      .filter(({ promptSetHash }) => promptSetHash !== undefined)
      .map(({ label, promptSetHash }) => `- Prompt set, \`${label}\`: \`${promptSetHash}\``),
    "",
    "The case-set hash covers the declarations only: ids, tools, arguments,",
    "conditions, expectations, and the markers that decide whether an attempt is",
    "issued. Prose descriptions are excluded, so rewording one does not read as a",
    "different experiment and does not oblige a live re-run.",
    "",
    "The world-set hash covers what those attempts were made against: the grants",
    "each condition issues, the enabled tool namespaces, and the whole definition",
    "of every registered tool. It is separate because a world can be rewritten",
    "without a case changing, and two runs are comparable only when both hashes",
    "match. Tool prose is inside this one: a description and an input schema are",
    "served to the model, so rewording them is a different world.",
    "",
    "The prompt-set hash covers how the seat was asked: what the column's runtime",
    "told it before each turn -- the turn's reach as a system message, as MCP",
    "initialize instructions or on a driven harness's opening request, and the",
    "prompt written from the declared attempts --",
    "taken from each turn's record rather than from the code that wrote it. It is",
    "per column, because the wording differs by design between a seat whose",
    "channel carries any name and one behind an MCP router, and a column that",
    "tells the seat nothing carries none. A turn that was cancelled, timed out, or",
    "ended by the loop itself after the seat was asked still counts: what it was",
    "asked is stated to the envelope before the model or CLI is sent anything, and",
    "the envelope writes it on every ending, so a stall moves no hash. A live run",
    "of a column is comparable to the last one on the model's",
    "choices only when this hash matches too: a reworded prompt is a different",
    "question, not a different kernel.",
    "",
    "A cell is `pass` only when every declared attempt met its expected outcome and",
    "every control attempt succeeded. `not exercised` means the attempt -- or, on a",
    "row graded on how the turn ended, the ask for that ending -- never reached",
    "SharedOS, and is never a pass. `not applicable` means a runtime structurally",
    "cannot make the attempt. `not implemented` means SharedOS does not do this:",
    "the row is declared so the gap is stated rather than omitted, and it is never",
    "run and never a pass. `out of scope` means the attempt was made and recorded",
    "and SharedOS declares no guarantee over it on this path; it is not a pass, not",
    "a failure, and never averaged into either.",
    "",
    "`pass (driver)` is a pass whose attack the column's driver had to issue. It",
    "arises where the loop's own step index can never exceed the ceiling, so only a",
    "driver naming its own step can reach the bound. The kernel refused the call and",
    "the refusal is real; what differs is who made it. In a column where every other",
    "pass means the harness or the model chose the call, printing this one plain",
    "would put the driver's doing under their name.",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];

  for (const row of manifest.rows) {
    const cells = columns.map(({ id }) => {
      const cell = row.cells.find((candidate) => candidate.columnId === id);
      return cell === undefined ? "—" : cellLabel(cell);
    });
    lines.push(
      `| ${[row.invariant, row.expectedOutcome, row.conditionId, ...cells].join(" | ")} |`,
    );
  }

  lines.push("", "## Evidence per row", "");
  for (const row of manifest.rows) {
    lines.push(`### ${row.invariant} — \`${row.conditionId}\``, "", row.condition, "");
    for (const cell of row.cells) {
      const label = columns.find(({ id }) => id === cell.columnId)?.label ?? cell.columnId;
      lines.push(
        cell.status === "not_implemented"
          ? `- **${label}** — ${statusLabel(cell.status)}; ${cell.declared} ` +
              `${cell.declared === 1 ? "attempt" : "attempts"} declared, none runnable; ` +
              `${cell.detail ?? "no reason given"}`
          : cell.turns === 0
            ? `- **${label}** — ${statusLabel(cell.status)}; ${cell.declared} ` +
              `${cell.declared === 1 ? "attempt" : "attempts"} declared, none issued; ` +
              `${cell.detail ?? "no reason given"}`
            : `- **${label}** — ${statusLabel(cell.status)}; ` +
              `${cell.attempted} of ${cell.declared} attempts issued` +
              `${cell.notApplicable === 0 ? "" : `, ${cell.notApplicable} structurally unreachable`}` +
              `${cell.turns <= 1 ? "" : ` over ${cell.turns} turns`}; ` +
              `refused by ${list(cell.refusedBy, "nothing")}; ` +
              `reason ${list(cell.reasonCodes, "none")}; ` +
              causeClause(cell) +
              `record ${cell.recordUsable ? "usable" : `unusable (${list(cell.recordGaps, "unknown")})`}` +
              `${cell.detail === undefined ? "" : `; ${cell.detail}`}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function statusLabel(status: ConformanceStatus): string {
  return status.replaceAll("_", " ");
}

/**
 * How one cell prints, attribution included.
 *
 * A pass whose attack the driver had to issue is marked rather than printed
 * plain. In a column where every other pass means "the harness or model did
 * this", an unmarked one here would read as the same claim, and it is not: the
 * kernel refused the call, and the call was the driver's doing.
 */
function cellLabel(cell: ConformanceCell): string {
  const label = statusLabel(cell.status);
  return cell.status === "pass" && cell.driverIssued.length > 0 ? `${label} (driver)` : label;
}

function list(values: readonly string[], empty = ""): string {
  return values.length === 0 ? empty : values.map((value) => `\`${value}\``).join(", ");
}

/** The cell's causes as a clause of the evidence line, or nothing when it has none. */
function causeClause(cell: ConformanceCell): string {
  // Read as absent rather than dereferenced: a manifest written before the
  // field existed has none, and rendering one is still a legitimate ask.
  const causes = cell.causes ?? [];
  return causes.length === 0 ? "" : `cause ${list(causes)}; `;
}
