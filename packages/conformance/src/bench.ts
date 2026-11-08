import type {
  JsonObject,
  RuntimeManifest,
  RuntimeTurnOutcome,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { SPAN, portableToolName, type Span, type SpanSink } from "@aicoo/sharedos-core";
import { McpToolServer, openToolBridge } from "@aicoo/sharedos-mcp";
import {
  SharedOSExecutor,
  escalationOffered,
  type RuntimeHost,
  type RuntimePlugin,
  type RuntimeTurnRequest,
} from "@aicoo/sharedos-runtime";

import {
  ToolNameCodec,
  claudeCodeFrameWriter,
  claudeCodeProtocol,
  codexFrameWriter,
  codexProtocol,
  decodeChatCompletion,
  deepseekFrameWriter,
  deepseekProtocol,
  encodeModelMessage,
  modelToolResultMessage,
  piFrameWriter,
  piProtocol,
  readModelToolCall,
  type HarnessFrameWriter,
  type HarnessProtocol,
} from "@aicoo/sharedos-adapters";

import {
  HostileRuntime,
  attemptArguments,
  type AttackAttempt,
  type AttackMove,
} from "./adversary.js";
import { assembleExecutionRecord } from "./assemble.js";
import {
  CLAUDE_CODE_SCRIPTED_COLUMN,
  CODEX_SCRIPTED_COLUMN,
  DEEPSEEK_SCRIPTED_COLUMN,
  ADVERSARY_COLUMN,
  MODEL_SCRIPTED_COLUMN,
  PI_SCRIPTED_COLUMN,
  type RuntimeColumn,
} from "./columns.js";
import { hashExperimentInputs } from "./hashing.js";
import type { ExecutionRecord } from "./record.js";
import { SHAREDOS_VERSION } from "./runner.js";
import { CANONICAL_CONFORMANCE_CASES, type ConformanceCase } from "./suite.js";
import {
  CONFORMANCE_NOW,
  conformanceRuntimeContext,
  createConformanceWorld,
  type ConformanceWorld,
} from "./world.js";
import { PROTOCOL_VERSION } from "@aicoo/sharedos-contracts";

/**
 * The version of the measurement rules, so a report names what produced it.
 *
 * Separate from the conformance judge's version. The two change for unrelated
 * reasons -- a grading rule is about what counts as enforcement, this is about
 * what counts as a millisecond -- and one number for both would oblige a re-run
 * of the wrong thing.
 */
export const BENCH_VERSION = "1";

/** What the bench drives per turn. */
export interface BenchWorkload {
  /** Conformance case ids, as `docs/conformance/kernel-conformance.json` records them. */
  readonly caseIds: readonly string[];
  /** Attempts a harness can actually put on a wire, not attempts declared. */
  readonly callsPerTurn: number;
  readonly warmupTurns: number;
  readonly measuredTurns: number;
}

export interface BenchOptions {
  /** Turns whose spans are discarded, so a figure is not a report about JIT warmup. */
  readonly warmupTurns?: number;
  readonly measuredTurns?: number;
  /**
   * What the run was taken on, supplied by the host.
   *
   * A latency figure is a figure about a machine, and this package cannot read
   * one: it is host-neutral and has no `process`. The Node script that drives a
   * published run fills this in, and a report without it is a report nobody can
   * say where it came from.
   */
  readonly environment?: JsonObject;
}

/** A latency distribution over observed spans. Never a fitted curve. */
export interface Distribution {
  readonly n: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** Operations per second of SharedOS-attributable time: `1000 / meanMs`. */
  readonly opsPerSecond: number;
}

export interface ByteSummary {
  readonly n: number;
  readonly meanBytes: number;
  readonly totalBytes: number;
}

/**
 * One filled row of the enforcement-cost table.
 *
 * `tokens` is `0` on every path here and the zero is structural: it is asserted
 * from the absence of a model call inside the span, not measured by counting
 * one. `wireBytes` is `null` where the legend's `—` belongs -- a path with no
 * transport has no frames to count, which is not the same as a pending number.
 */
export interface BenchMeasure {
  readonly id: string;
  readonly component: string;
  readonly path: "in-process" | "mcp-toolshare";
  /** What one operation is, for this row's throughput figure. */
  readonly unit: string;
  readonly latency: Distribution;
  readonly tokens: number;
  readonly evidenceBytes: ByteSummary | null;
  readonly wireBytes: ByteSummary | null;
  /** What the number is and is not a measurement of. */
  readonly basis: string;
}

/** One harness adapter's translation cost, measured with no model in any span. */
export interface TranslationMeasure {
  readonly columnId: string;
  readonly label: string;
  readonly protocolId: string;
  readonly latency: Distribution;
  readonly catalogueWidth: number;
}

/**
 * Where the cost of one mediated call goes.
 *
 * Printed because the end-to-end figure is otherwise a number with no account
 * of itself, and an unaccounted number is one nobody can act on. Every segment
 * here is a span that carries the call's id, so the remainder is a real
 * subtraction rather than a category for whatever was not measured.
 */
export interface CallBreakdown {
  readonly path: "in-process" | "mcp-toolshare";
  readonly segments: readonly BreakdownSegment[];
  /** The outer span, less every named segment: cloning, validation, and audit. */
  readonly remainder: Distribution;
  readonly whole: Distribution;
}

export interface BreakdownSegment {
  readonly span: string;
  readonly label: string;
  readonly latency: Distribution;
  /** Segments per mediated call. Two authorization checks on some paths. */
  readonly perCall: number;
}

export interface SystemsCostReport {
  readonly version: "1";
  readonly benchVersion: string;
  readonly sharedOsVersion: string;
  readonly workload: BenchWorkload;
  readonly measures: readonly BenchMeasure[];
  readonly translation: readonly TranslationMeasure[];
  readonly breakdown: readonly CallBreakdown[];
  /** Model-free constants this run observed, alongside the latency figures. */
  readonly structural: StructuralFootprint;
  /** What taking one measurement costs, printed rather than subtracted. */
  readonly timerOverhead: Distribution;
  readonly environment?: JsonObject;
}

export interface StructuralFootprint {
  readonly recordBytes: ByteSummary;
  readonly authorityLoadsPerTurn: number;
  readonly decisionsPerTurn: number;
  readonly auditEventsPerTurn: number;
  readonly toolCallsPerTurn: number;
  /** Bytes of the catalogue a harness receives from `tools/list`, once per turn. */
  readonly catalogueWireBytes: number;
  readonly catalogueWidth: number;
}

/** Buffers spans for a bench run. SharedOS itself accumulates nothing. */
export class SpanCollector implements SpanSink {
  #spans: Span[] = [];

  record(span: Span): void {
    this.#spans.push(span);
  }

  get spans(): readonly Span[] {
    return this.#spans;
  }

  /** Drop everything seen so far, which is how a warmup phase is discarded. */
  reset(): void {
    this.#spans = [];
  }
}

/**
 * A distribution over observed durations.
 *
 * Percentiles are nearest-rank over the sorted sample: the reported p95 is a
 * duration that actually occurred, not an interpolation between two that did.
 * At the sample sizes a live path produces -- tens of spans, not thousands --
 * interpolating would invent a number in a gap where no observation exists,
 * and the gap is the honest thing to report.
 *
 * Throughput is `1000 / mean`, not `1000 / p50`. The question the row answers
 * is how much SharedOS-attributable time a stream of operations costs, and a
 * median discards exactly the tail that makes a stream slower than its typical
 * member.
 */
export function summarize(durations: readonly number[]): Distribution {
  if (durations.length === 0) {
    throw new TypeError("A distribution needs at least one observation");
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const meanMs = total / sorted.length;
  return {
    n: sorted.length,
    meanMs,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    minMs: sorted[0] as number,
    maxMs: sorted[sorted.length - 1] as number,
    opsPerSecond: meanMs === 0 ? Number.POSITIVE_INFINITY : 1000 / meanMs,
  };
}

function nearestRank(sorted: readonly number[], quantile: number): number {
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1] as number;
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function summarizeBytes(values: readonly number[]): ByteSummary {
  const totalBytes = values.reduce((sum, value) => sum + value, 0);
  return {
    n: values.length,
    meanBytes: values.length === 0 ? 0 : totalBytes / values.length,
    totalBytes,
  };
}

/**
 * Foreign work taken back out, correlated on the call id every span carries.
 *
 * A provider's read is the host's storage, not enforcement, and an end-to-end
 * figure that included it would report the host's disk as a SharedOS cost. The
 * subtraction is a join rather than an ambient stack, so it stays correct when
 * more than one call is in flight.
 *
 * A span whose foreign child is missing is kept whole: the call was refused
 * before the provider was reached, so there is nothing to subtract and the
 * whole span is SharedOS's.
 */
export function attributable(
  spans: readonly Span[],
  outer: string,
  foreign: string,
): readonly number[] {
  const foreignByCall = new Map<string, number>();
  for (const span of spans) {
    if (span.name !== foreign) {
      continue;
    }
    const callId = span.attributes["callId"];
    if (typeof callId === "string") {
      foreignByCall.set(callId, (foreignByCall.get(callId) ?? 0) + span.durationMs);
    }
  }

  const durations: number[] = [];
  for (const span of spans) {
    if (span.name !== outer) {
      continue;
    }
    const callId = span.attributes["callId"];
    const subtract = typeof callId === "string" ? (foreignByCall.get(callId) ?? 0) : 0;
    durations.push(Math.max(0, span.durationMs - subtract));
  }
  return durations;
}

/**
 * The moves the bench issues, and why these ones.
 *
 * The published baseline case set, minus the rows that end the turn. Using the
 * declared attack set rather than a workload written for the occasion is what
 * keeps the cost figure about the same calls the conformance matrix grades: a
 * mix of controls that succeed and attempts that are refused, in the ratio the
 * suite actually declares. A benchmark whose workload was all successes would
 * report the cost of the cheapest path SharedOS has.
 *
 * Terminal moves are left out because a turn that escalates stops early, and a
 * throughput figure taken over a truncated turn is a figure about truncation.
 */
export function benchMoves(
  cases: readonly ConformanceCase[] = CANONICAL_CONFORMANCE_CASES,
): readonly AttackMove[] {
  return benchCases(cases).map((kase) => kase.move);
}

/** The cases those moves come from: implemented, non-terminal, and run under the baseline. */
export function benchCases(
  cases: readonly ConformanceCase[] = CANONICAL_CONFORMANCE_CASES,
): readonly ConformanceCase[] {
  return cases.filter(
    (kase) =>
      kase.notImplemented === undefined &&
      kase.move.terminal === undefined &&
      kase.conditions.some((condition) => condition.id === "baseline"),
  );
}

/** The attempts of those moves a harness can actually put on a wire. */
export function benchAttempts(moves: readonly AttackMove[]): readonly AttackAttempt[] {
  return moves.flatMap((move) =>
    move.attempts.filter(
      (attempt) =>
        (attempt.turn ?? 1) === 1 &&
        attempt.unreachable === undefined &&
        attempt.inspect === undefined &&
        attempt.tool !== undefined,
    ),
  );
}

const BENCH_CEILING = 64;

/**
 * What one measured turn produced, apart from its durations.
 *
 * The byte figures are differences rather than sums: the marginal cost of a
 * call is what the record loses when its operations and events are removed, and
 * the marginal cost of a decision is what the record and the audit stream lose
 * when the decisions are. Differencing is used because the members do not
 * partition the serialization -- separators, keys, and array structure belong to
 * no single member -- and a sum over members would under-report every row by the
 * punctuation between them.
 */
export interface TurnOutcome {
  readonly record: ExecutionRecord;
  readonly recordBytes: number;
  readonly recordWithoutCalls: number;
  readonly recordWithoutDecisions: number;
  readonly auditBytes: number;
  readonly auditWithoutDecisions: number;
  readonly toolCalls: number;
  readonly decisions: number;
  readonly authorityLoads: number;
  readonly auditEvents: number;
}

/** One measured turn; the byte figures are explained on {@link TurnOutcome}. */
async function runTurn(
  world: ConformanceWorld,
  runtime: RuntimePlugin,
  executionId: string,
  spans: SpanSink | undefined,
  auditFrom: number,
): Promise<TurnOutcome> {
  const request = world.request(executionId);
  let sequence = 0;
  const result = await new SharedOSExecutor(world.kernel, runtime, {
    clock: () => CONFORMANCE_NOW,
    createId: () => `${executionId}.event-${(sequence += 1)}`,
    ...(spans === undefined ? {} : { spans }),
  }).execute(request);

  const auditEvents = world.auditEvents.slice(auditFrom);
  const hashes = await hashExperimentInputs({
    spec: { bench: "systems-cost", version: BENCH_VERSION },
    world: { namespaceId: world.context.namespaceId, tools: world.tools },
    evaluator: { judge: "sharedos-bench", version: BENCH_VERSION },
    policy: { enabledToolNamespaces: world.context.enabledToolNamespaces, tools: world.tools },
  });

  const record = assembleExecutionRecord({
    request,
    result,
    auditEvents,
    experiment: {
      experimentId: "systems-cost",
      taskId: "bench",
      runId: executionId,
      specHash: hashes.specHash,
      worldHash: hashes.worldHash,
      evaluatorHash: hashes.evaluatorHash,
    },
    system: {
      protocolVersion: PROTOCOL_VERSION,
      sharedOsVersion: SHAREDOS_VERSION,
      adapterId: runtime.manifest.id,
      policyHash: hashes.policyHash,
    },
  });

  const callEvents = new Set(["tool.requested", "tool.completed"]);
  const withoutCalls = {
    ...record,
    execution: {
      ...record.execution,
      operations: [],
      events: record.execution.events.filter((event) => !callEvents.has(event.type)),
    },
  };
  const withoutDecisions = { ...record, execution: { ...record.execution, decisions: [] } };
  const auditWithoutDecisions = auditEvents.filter(
    (event) => event.type !== "authorization.checked",
  );

  return {
    record,
    recordBytes: bytes(record),
    recordWithoutCalls: bytes(withoutCalls),
    recordWithoutDecisions: bytes(withoutDecisions),
    auditBytes: bytes(auditEvents),
    auditWithoutDecisions: bytes(auditWithoutDecisions),
    toolCalls: record.cost.toolCalls,
    decisions: record.execution.decisions.length,
    authorityLoads: record.cost.authorityLoads,
    auditEvents: record.cost.auditEvents,
  };
}

export interface PathRun {
  readonly spans: readonly Span[];
  readonly turns: readonly TurnOutcome[];
  readonly wireBytesPerCall: readonly number[];
  readonly catalogueWireBytes: number;
  readonly catalogueWidth: number;
  /** The canonical names the catalogue published, in the order they were served. */
  readonly catalogueTools: readonly string[];
}

/**
 * The in-process path: the scripted adversary in the delegate seat, one fixed
 * world, and no model anywhere in the loop.
 */
export async function runInProcessPath(
  moves: readonly AttackMove[],
  options: BenchSettings,
): Promise<PathRun> {
  const collector = new SpanCollector();
  const world = createConformanceWorld(
    { maxToolCalls: BENCH_CEILING, maxSteps: BENCH_CEILING },
    { spans: collector },
  );
  const turns: TurnOutcome[] = [];

  for (let turn = 1; turn <= options.warmupTurns + options.measuredTurns; turn += 1) {
    const measured = turn > options.warmupTurns;
    if (turn === options.warmupTurns + 1) {
      collector.reset();
    }
    const outcome = await runTurn(
      world,
      new HostileRuntime(moves, { turn: 1 }),
      `bench.in-process.turn-${turn}`,
      collector,
      world.auditEvents.length,
    );
    if (measured) {
      turns.push(outcome);
    }
  }

  return {
    spans: collector.spans,
    turns,
    wireBytesPerCall: [],
    catalogueWireBytes: 0,
    catalogueWidth: world.tools.length,
    catalogueTools: world.tools.map(({ name }) => name),
  };
}

interface ToolshareFrames {
  readonly wireBytesPerCall: number[];
  catalogueWireBytes: number;
  catalogueWidth: number;
  catalogueTools: string[];
}

/**
 * A runtime that reaches the kernel the way an MCP-connected harness does.
 *
 * It opens the same turn-scoped bridge `createMcpHarnessRuntime` opens, serves
 * the same `McpToolServer`, and sends the same three kinds of frame a client
 * sends -- `initialize`, `tools/list`, then one `tools/call` per attempt, using
 * the published names it discovered rather than the canonical ones. What it
 * leaves out is the CLI and the model, and leaving them out is the point: the
 * span this measures opens when a frame reaches the server and closes when the
 * response leaves it, so a model outside that boundary cannot be inside the
 * figure. A live CLI moves how many frames arrive, which is a behavioural term
 * and belongs to the multiplier table, not here.
 */
class ToolshareBenchRuntime implements RuntimePlugin {
  readonly manifest: RuntimeManifest = {
    id: "sharedos.bench.toolshare",
    version: "1.0.0",
    protocolVersion: PROTOCOL_VERSION,
    metadata: { bench: true, path: "mcp-toolshare" },
  };

  readonly #attempts: readonly AttackAttempt[];
  readonly #spans: SpanSink | undefined;
  readonly #frames: ToolshareFrames;

  constructor(
    attempts: readonly AttackAttempt[],
    frames: ToolshareFrames,
    spans: SpanSink | undefined,
  ) {
    this.#attempts = attempts;
    this.#frames = frames;
    this.#spans = spans;
  }

  async run(
    turn: RuntimeTurnRequest,
    host: RuntimeHost,
    signal: AbortSignal,
  ): Promise<RuntimeTurnOutcome> {
    const bridge = openToolBridge({
      executionId: turn.executionId,
      context: { traceId: turn.context.traceId, now: turn.context.now },
      tools: turn.tools,
      host,
    });
    let minted = 0;
    const server = new McpToolServer({
      invoker: bridge,
      createId: () => `${turn.executionId}.mcp-${(minted += 1)}`,
      ...(this.#spans === undefined ? {} : { spans: this.#spans }),
    });

    try {
      let id = 0;
      await server.handle(
        {
          jsonrpc: "2.0",
          id: (id += 1),
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "sharedos-bench", version: BENCH_VERSION },
          },
        },
        signal,
      );
      await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, signal);

      const listed = await server.handle(
        { jsonrpc: "2.0", id: (id += 1), method: "tools/list" },
        signal,
      );
      const published = publishedNames(listed);
      this.#frames.catalogueWireBytes = bytes(listed);
      this.#frames.catalogueWidth = published.size;
      this.#frames.catalogueTools = [...published.keys()];

      const context = conformanceRuntimeContext(1);
      for (const attempt of this.#attempts) {
        const canonical = attempt.tool as string;
        const request = {
          jsonrpc: "2.0",
          id: (id += 1),
          method: "tools/call",
          params: {
            name: published.get(canonical) ?? canonical,
            arguments: attemptArguments(context, attempt) as JsonObject,
          },
        };
        const response = await server.handle(request, signal);
        this.#frames.wireBytesPerCall.push(bytes(request) + bytes(response));
      }

      return { type: "complete", output: { calls: this.#attempts.length } };
    } finally {
      bridge.close();
    }
  }
}

/**
 * What a client will actually put in `tools/call`, read out of `tools/list`.
 *
 * The portable form, because that is what a client whose namespacing cannot
 * carry a dot sends, and resolving it back is real work on this path:
 * `McpToolServer` maps `files_read` to `files.read` on every call and the
 * bridge records the rewrite. Sending the canonical name would skip that and
 * report a cheaper path than any harness uses.
 *
 * A tool the catalogue never contained keeps its canonical name, because a
 * client cannot rewrite a name it was never given -- which is the same reason
 * such an attempt is unreachable through a well-behaved client at all.
 */
function publishedNames(listed: unknown): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const tools = (listed as { result?: { tools?: readonly JsonObject[] } })?.result?.tools ?? [];
  for (const tool of tools) {
    const name = tool["name"];
    if (typeof name === "string") {
      names.set(name, portableToolName(name));
    }
  }
  return names;
}

export async function runToolsharePath(
  moves: readonly AttackMove[],
  options: BenchSettings,
): Promise<PathRun> {
  const collector = new SpanCollector();
  const world = createConformanceWorld(
    { maxToolCalls: BENCH_CEILING, maxSteps: BENCH_CEILING },
    { spans: collector },
  );
  const attempts = benchAttempts(moves);
  const turns: TurnOutcome[] = [];
  const frames: ToolshareFrames = {
    wireBytesPerCall: [],
    catalogueWireBytes: 0,
    catalogueWidth: 0,
    catalogueTools: [],
  };

  for (let turn = 1; turn <= options.warmupTurns + options.measuredTurns; turn += 1) {
    const measured = turn > options.warmupTurns;
    if (turn === options.warmupTurns + 1) {
      collector.reset();
      frames.wireBytesPerCall.length = 0;
    }
    const outcome = await runTurn(
      world,
      new ToolshareBenchRuntime(attempts, frames, collector),
      `bench.toolshare.turn-${turn}`,
      collector,
      world.auditEvents.length,
    );
    if (measured) {
      turns.push(outcome);
    }
  }

  return {
    spans: collector.spans,
    turns,
    wireBytesPerCall: frames.wireBytesPerCall,
    catalogueWireBytes: frames.catalogueWireBytes,
    catalogueWidth: frames.catalogueWidth,
    catalogueTools: frames.catalogueTools,
  };
}

/**
 * What the timing instrument itself costs, measured the same way it measures.
 *
 * Printed with the report rather than subtracted from it. The operations here
 * are microseconds, and two `performance.now()` reads are not free at that
 * scale; a reader who cannot see the instrument's own cost cannot tell a real
 * figure from an artefact of taking it. Subtracting it would be worse -- it
 * would produce a number that is neither the operation nor the measurement.
 */
export function timerOverhead(samples = 4096): Distribution {
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    durations.push(performance.now() - started);
  }
  return summarize(durations);
}

export interface RecordWriteRun {
  readonly durations: readonly number[];
  readonly recordBytes: readonly number[];
}

/**
 * One record assembled, validated, and serialized.
 *
 * Measured over one turn's evidence, re-assembled repeatedly, because that is
 * the operation: a host assembles a record once per turn from evidence it
 * already holds, and the cost of producing the evidence belongs to the rows
 * that produced it. Serialization is inside the span because a record that was
 * not serialized was not written.
 */
export async function runRecordWritePath(
  moves: readonly AttackMove[],
  options: BenchSettings,
): Promise<RecordWriteRun> {
  const world = createConformanceWorld({ maxToolCalls: BENCH_CEILING, maxSteps: BENCH_CEILING });
  const auditFrom = world.auditEvents.length;
  const request = world.request("bench.record.turn-1");
  let sequence = 0;
  const result = await new SharedOSExecutor(world.kernel, new HostileRuntime(moves, { turn: 1 }), {
    clock: () => CONFORMANCE_NOW,
    createId: () => `bench.record.turn-1.event-${(sequence += 1)}`,
  }).execute(request);
  const auditEvents = world.auditEvents.slice(auditFrom);
  const hashes = await hashExperimentInputs({
    spec: { bench: "systems-cost", version: BENCH_VERSION },
    world: { namespaceId: world.context.namespaceId, tools: world.tools },
    evaluator: { judge: "sharedos-bench", version: BENCH_VERSION },
    policy: { enabledToolNamespaces: world.context.enabledToolNamespaces, tools: world.tools },
  });

  const assemble = (): number => {
    const started = performance.now();
    const record = assembleExecutionRecord({
      request,
      result,
      auditEvents,
      experiment: {
        experimentId: "systems-cost",
        taskId: "bench",
        runId: "bench.record.turn-1",
        specHash: hashes.specHash,
        worldHash: hashes.worldHash,
        evaluatorHash: hashes.evaluatorHash,
      },
      system: {
        protocolVersion: PROTOCOL_VERSION,
        sharedOsVersion: SHAREDOS_VERSION,
        adapterId: "sharedos.conformance.hostile",
        policyHash: hashes.policyHash,
      },
    });
    const serialized = JSON.stringify(record);
    const elapsed = performance.now() - started;
    written.push(new TextEncoder().encode(serialized).length);
    return elapsed;
  };

  const written: number[] = [];
  for (let index = 0; index < options.warmupTurns; index += 1) {
    assemble();
  }
  written.length = 0;

  const durations: number[] = [];
  for (let index = 0; index < options.measuredTurns; index += 1) {
    durations.push(assemble());
  }
  return { durations, recordBytes: written };
}

export interface TranslationSubject {
  readonly columnId: string;
  readonly label: string;
  readonly protocolId: string;
  /** The frame that carries one call, in the subject's own wire shape. */
  toolCall(callId: string, tool: string, arguments_: JsonObject): JsonObject;
  /**
   * One call's round trip: read the frame that carries it, encode the result
   * that answers it. Nothing the subject computes here is kept -- the figure
   * is the translation, not what it translated into.
   */
  roundTrip(frame: JsonObject, result: ToolResult): void;
}

/**
 * The adapter layer, measured with no model in any span.
 *
 * One operation is one call's round trip through the vendor's own shapes:
 * interpret the frame that carries the call, and encode the result that answers
 * it. `describeTools` is deliberately outside -- it runs once per turn, not once
 * per call, and folding a per-turn cost into a per-call figure would make the
 * number depend on how many calls the turn happened to make.
 */
export async function runTranslationPath(
  subjects: readonly TranslationSubject[],
  moves: readonly AttackMove[],
  options: BenchSettings,
  catalogueWidth: number,
): Promise<readonly TranslationMeasure[]> {
  const attempts = benchAttempts(moves);
  const context = conformanceRuntimeContext(1);
  const measures: TranslationMeasure[] = [];

  for (const subject of subjects) {
    const frames = attempts.map((attempt, index) => ({
      frame: subject.toolCall(
        `bench-call-${index}`,
        attempt.tool as string,
        attemptArguments(context, attempt) as JsonObject,
      ),
      result: {
        callId: `bench-call-${index}`,
        tool: attempt.tool as string,
        status: "denied" as const,
        completedAt: CONFORMANCE_NOW,
        error: { code: "no_matching_grant", message: "The access context does not grant this." },
      },
    }));

    const once = (): number => {
      const started = performance.now();
      for (const { frame, result } of frames) {
        subject.roundTrip(frame, result);
      }
      return (performance.now() - started) / frames.length;
    };

    for (let index = 0; index < options.warmupTurns; index += 1) {
      once();
    }
    const durations: number[] = [];
    for (let index = 0; index < options.measuredTurns; index += 1) {
      durations.push(once());
    }

    measures.push({
      columnId: subject.columnId,
      label: subject.label,
      protocolId: subject.protocolId,
      latency: summarize(durations),
      catalogueWidth,
    });
  }

  return measures;
}

/**
 * A vendor adapter as a translation subject: its real reader and the frame
 * writer that drives it, the same pair the scripted column is exercised with.
 */
export function harnessTranslationSubject(
  column: Pick<RuntimeColumn, "id" | "label">,
  protocol: HarnessProtocol,
  writer: HarnessFrameWriter,
): TranslationSubject {
  return {
    columnId: column.id,
    label: column.label,
    protocolId: protocol.id,
    toolCall: (callId, tool, arguments_) => writer.toolCall(callId, tool, arguments_),
    roundTrip: (frame, result) => {
      protocol.interpret(frame);
      protocol.encodeToolResult(result);
    },
  };
}

/** The protocol id the native harness's translation is reported under. */
export const MODEL_TRANSLATION_PROTOCOL_ID = "model.chat-completions";

/**
 * The native harness as a translation subject.
 *
 * `StandardTurnDriver` has a translation layer like any vendor adapter, and it is
 * measured here on the same terms. The frame that carries a call is one
 * chat-completions response body, in the shape the provider's wire carries it;
 * reading it is the client's decode plus the driver's own per-call read -- the
 * model's alphabet back to the catalogue's, the argument blob parsed, the
 * escalate affordance recognised by name when the turn was offered it. The
 * result is encoded as the tool message the model reads back, in the wire
 * shape the client sends. The codec is built once from the catalogue, as the
 * driver builds it once per turn: a per-turn cost stays outside a per-call
 * figure, exactly as `describeTools` does for the vendor subjects.
 *
 * What it measures is the driver's code, not a copy of it: the session calls
 * `readModelToolCall` and `modelToolResultMessage` on the same path.
 */
export function modelTranslationSubject(catalogue: readonly string[]): TranslationSubject {
  const tools = catalogue.map((name) => ({ name }));
  const codec = new ToolNameCodec(tools);
  const offered = escalationOffered(tools);
  const context = conformanceRuntimeContext(1);
  const wire = { traceId: context.traceId, now: context.now };
  return {
    columnId: MODEL_SCRIPTED_COLUMN.id,
    label: MODEL_SCRIPTED_COLUMN.label,
    protocolId: MODEL_TRANSLATION_PROTOCOL_ID,
    toolCall: (callId, tool, arguments_) => ({
      id: "chatcmpl-bench",
      object: "chat.completion",
      model: "bench",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: callId,
                type: "function",
                // A provider carries arguments as a JSON-encoded string, so a
                // frame carrying an object would be one the real client rejects.
                function: { name: codec.toWire(tool), arguments: JSON.stringify(arguments_) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }),
    roundTrip: (frame, result) => {
      const reply = decodeChatCompletion(frame);
      for (const call of reply?.toolCalls ?? []) {
        readModelToolCall(call, codec, offered, wire);
      }
      encodeModelMessage(modelToolResultMessage(result));
    },
  };
}

/**
 * The four scripted adapters, paired with the frames that drive them.
 *
 * Ids and labels are the scripted columns' own, so a column is named the same
 * way here as in the conformance manifest. The native harness is not in this
 * list because its subject needs the catalogue's names; see
 * {@link modelTranslationSubject}, and {@link runSystemsCostBench} for where
 * the two are joined.
 */
export const TRANSLATION_SUBJECTS: readonly TranslationSubject[] = Object.freeze([
  harnessTranslationSubject(CODEX_SCRIPTED_COLUMN, codexProtocol, codexFrameWriter),
  harnessTranslationSubject(CLAUDE_CODE_SCRIPTED_COLUMN, claudeCodeProtocol, claudeCodeFrameWriter),
  harnessTranslationSubject(DEEPSEEK_SCRIPTED_COLUMN, deepseekProtocol, deepseekFrameWriter),
  harnessTranslationSubject(PI_SCRIPTED_COLUMN, piProtocol, piFrameWriter),
]);

/** {@link BenchOptions} with every default already applied. */
export interface BenchSettings {
  readonly warmupTurns: number;
  readonly measuredTurns: number;
}

const DEFAULT_OPTIONS: BenchSettings = Object.freeze({
  warmupTurns: 60,
  measuredTurns: 200,
});

/**
 * Measure what enforcement costs, apart from what the model costs.
 *
 * Nothing here runs a model, and the two paths differ in exactly one way: what
 * carries a call to the kernel. Both are bounded to code SharedOS owns, so a
 * difference between them is the toolshare boundary and nothing else.
 */
export async function runSystemsCostBench(options: BenchOptions = {}): Promise<SystemsCostReport> {
  const settings: BenchSettings = {
    warmupTurns: options.warmupTurns ?? DEFAULT_OPTIONS.warmupTurns,
    measuredTurns: options.measuredTurns ?? DEFAULT_OPTIONS.measuredTurns,
  };
  const cases = benchCases();
  const moves = cases.map((kase) => kase.move);
  const attempts = benchAttempts(moves);

  const inProcess = await runInProcessPath(moves, settings);
  const toolshare = await runToolsharePath(moves, settings);
  const recordWrite = await runRecordWritePath(moves, settings);
  const translation = await runTranslationPath(
    [modelTranslationSubject(toolshare.catalogueTools), ...TRANSLATION_SUBJECTS],
    moves,
    settings,
    toolshare.catalogueWidth,
  );

  const measures: BenchMeasure[] = [
    authorizationMeasure(inProcess, "in-process"),
    authorizationMeasure(toolshare, "mcp-toolshare"),
    {
      id: "execution-record-write.in-process",
      component: "Execution-record write",
      path: "in-process",
      unit: "one record assembled, validated, and serialized",
      latency: summarize(recordWrite.durations),
      tokens: 0,
      evidenceBytes: summarizeBytes(recordWrite.recordBytes),
      wireBytes: null,
      basis:
        "one turn's evidence, re-assembled; the same code on both paths, so it is measured once",
    },
    endToEndMeasure(inProcess, "in-process"),
    endToEndMeasure(toolshare, "mcp-toolshare"),
  ];

  const turns = inProcess.turns;
  return {
    version: "1",
    benchVersion: BENCH_VERSION,
    sharedOsVersion: SHAREDOS_VERSION,
    workload: {
      caseIds: cases.map(({ id }) => id),
      callsPerTurn: attempts.length,
      warmupTurns: settings.warmupTurns,
      measuredTurns: settings.measuredTurns,
    },
    measures,
    translation,
    breakdown: [callBreakdown(inProcess, "in-process"), callBreakdown(toolshare, "mcp-toolshare")],
    structural: {
      recordBytes: summarizeBytes(turns.map(({ recordBytes }) => recordBytes)),
      authorityLoadsPerTurn: mean(turns.map(({ authorityLoads }) => authorityLoads)),
      decisionsPerTurn: mean(turns.map(({ decisions }) => decisions)),
      auditEventsPerTurn: mean(turns.map(({ auditEvents }) => auditEvents)),
      toolCallsPerTurn: mean(turns.map(({ toolCalls }) => toolCalls)),
      catalogueWireBytes: toolshare.catalogueWireBytes,
      catalogueWidth: toolshare.catalogueWidth,
    },
    timerOverhead: timerOverhead(),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
  };
}

/**
 * The authorization row for one path.
 *
 * The load and the in-turn checks are pooled, because the unit is one
 * authorization decision and a turn makes both kinds. They are also reported
 * apart, in `basis`, because pooling a once-per-turn store read with the
 * per-call checks against what it returned produces a distribution with two
 * modes, and a p95 that lands on the rarer one would read as a tail rather than
 * as a different operation.
 */
function authorizationMeasure(run: PathRun, path: BenchMeasure["path"]): BenchMeasure {
  const loads = run.spans.filter(({ name }) => name === SPAN.AUTHORITY_LOAD);
  const checks = run.spans.filter(({ name }) => name === SPAN.AUTHORIZE);
  const pooled = [...loads, ...checks].map(({ durationMs }) => durationMs);
  const loadStats = summarize(loads.map(({ durationMs }) => durationMs));
  const checkStats = summarize(checks.map(({ durationMs }) => durationMs));

  const decisionBytes = run.turns.flatMap((turn) =>
    turn.decisions === 0
      ? []
      : [
          (turn.recordBytes -
            turn.recordWithoutDecisions +
            (turn.auditBytes - turn.auditWithoutDecisions)) /
            turn.decisions,
        ],
  );

  return {
    id: `capability-authorization.${path}`,
    component: "Capability authorization",
    path,
    unit: "one authorization decision: the turn-boundary load, and each in-turn check",
    latency: summarize(pooled),
    tokens: 0,
    evidenceBytes: summarizeBytes(decisionBytes),
    wireBytes: null,
    basis:
      `pooled over ${loadStats.n} turn-boundary loads (p50 ${round(loadStats.p50Ms)} ms) and ` +
      `${checkStats.n} in-turn checks (p50 ${round(checkStats.p50Ms)} ms)`,
  };
}

/**
 * The end-to-end row for one path: one mediated tool call, provider removed.
 *
 * In-process the span is the envelope's mediation of one call. Over toolshare it
 * is the MCP server's answer to one frame, which contains that same mediation
 * plus the JSON-RPC translation, the catalogue lookup, and the name resolution.
 * Both have the provider subtracted by call id, so neither reports the host's
 * storage as enforcement.
 */
function endToEndMeasure(run: PathRun, path: BenchMeasure["path"]): BenchMeasure {
  const outer = path === "in-process" ? SPAN.TOOL_MEDIATE : SPAN.MCP_HANDLE;
  const spans =
    path === "in-process"
      ? run.spans
      : run.spans.filter(
          ({ name, attributes }) =>
            name !== SPAN.MCP_HANDLE || attributes["method"] === "tools/call",
        );
  const durations = attributable(spans, outer, SPAN.TOOL_HANDLER);

  const callBytes = run.turns.flatMap((turn) =>
    turn.toolCalls === 0 ? [] : [(turn.recordBytes - turn.recordWithoutCalls) / turn.toolCalls],
  );

  return {
    id: `end-to-end.${path}`,
    component: "End-to-end SharedOS overhead",
    path,
    unit: "one mediated tool call",
    latency: summarize(durations),
    tokens: 0,
    evidenceBytes: summarizeBytes(callBytes),
    wireBytes: run.wireBytesPerCall.length === 0 ? null : summarizeBytes(run.wireBytesPerCall),
    basis:
      path === "in-process"
        ? "the envelope's mediation of one call, provider subtracted by call id"
        : "one `tools/call` frame in to its response out, provider subtracted by call id; " +
          "the transport and the process boundary lie outside this span by its own definition, " +
          "and so does the vendor CLI's own tool router",
  };
}

const BREAKDOWN_SEGMENTS: readonly { readonly span: string; readonly label: string }[] =
  Object.freeze([
    { span: SPAN.TOOL_CATALOGUE, label: "Resolve the effective catalogue" },
    { span: SPAN.TOOL_DISCOVER, label: "Discovery filter" },
    { span: SPAN.AUTHORIZE, label: "Authorization decision, audit included" },
    { span: SPAN.TOOL_HANDLER, label: "Provider (not enforcement)" },
  ]);

/**
 * Account for one mediated call, segment by segment.
 *
 * The remainder is what the outer span cost that no segment explains: the
 * defensive copies, the schema validation, and the two execution events every
 * call leaves behind. It is computed per call and then summarized, rather than
 * as a difference of medians, because a difference of medians is not the median
 * of a difference and would quietly stop being a duration anyone observed.
 */
function callBreakdown(run: PathRun, path: CallBreakdown["path"]): CallBreakdown {
  const outerName = path === "in-process" ? SPAN.TOOL_MEDIATE : SPAN.MCP_HANDLE;
  const outer = run.spans.filter(
    (span) =>
      span.name === outerName &&
      (path === "in-process" || span.attributes["method"] === "tools/call"),
  );

  const byCall = new Map<string, Map<string, number>>();
  const countsByCall = new Map<string, Map<string, number>>();
  for (const span of run.spans) {
    const callId = span.attributes["callId"];
    if (typeof callId !== "string") {
      continue;
    }
    const totals = byCall.get(callId) ?? new Map<string, number>();
    totals.set(span.name, (totals.get(span.name) ?? 0) + span.durationMs);
    byCall.set(callId, totals);
    const counts = countsByCall.get(callId) ?? new Map<string, number>();
    counts.set(span.name, (counts.get(span.name) ?? 0) + 1);
    countsByCall.set(callId, counts);
  }

  const segments: BreakdownSegment[] = [];
  for (const { span, label } of BREAKDOWN_SEGMENTS) {
    const durations = run.spans
      .filter((candidate) => candidate.name === span)
      .map(({ durationMs }) => durationMs);
    if (durations.length === 0) {
      continue;
    }
    segments.push({
      span,
      label,
      latency: summarize(durations),
      perCall: durations.length / Math.max(1, outer.length),
    });
  }

  const remainders: number[] = [];
  for (const span of outer) {
    const callId = span.attributes["callId"];
    const totals = typeof callId === "string" ? byCall.get(callId) : undefined;
    const named = BREAKDOWN_SEGMENTS.reduce(
      (sum, { span: name }) => sum + (totals?.get(name) ?? 0),
      0,
    );
    remainders.push(Math.max(0, span.durationMs - named));
  }

  return {
    path,
    segments,
    remainder: summarize(remainders),
    whole: summarize(outer.map(({ durationMs }) => durationMs)),
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toPrecision(3));
}

/**
 * Render the report as a stable Markdown document.
 *
 * Two things are deliberately printed that a summary table would drop. Every
 * latency cell carries its *n*, because a p95 over forty observations is one or
 * two of them and an unlabelled one reads as a distribution. And every row
 * carries the basis it was measured on, because two of these rows are bounded
 * by definitions -- what is inside the span and what is outside it -- that the
 * number alone cannot state.
 */
export function renderSystemsCostReport(report: SystemsCostReport): string {
  const lines = [
    "# Systems cost",
    "",
    "Generated by `pnpm bench`. What enforcement costs, apart from what the model",
    "costs. No model is in any span on this page: the in-process path drives the",
    "scripted adversary against one fixed world, and the toolshare path drives the",
    "real MCP server with the frames a client would send.",
    "",
    `- SharedOS: \`${report.sharedOsVersion}\``,
    `- Measurement rules: version \`${report.benchVersion}\``,
    `- Workload: ${report.workload.callsPerTurn} issuable attempts per turn, ` +
      `${report.workload.measuredTurns} measured turns after ${report.workload.warmupTurns} discarded`,
    `- Cases: ${report.workload.caseIds.map((id) => `\`${id}\``).join(", ")}`,
    ...(report.environment === undefined
      ? []
      : [`- Environment: ${describeEnvironment(report.environment)}`]),
    "",
    "Percentiles are nearest-rank: a printed p95 is a duration that occurred, not",
    "an interpolation between two that did. Throughput is `1000 / mean`, not",
    "`1000 / p50`, because a median discards the tail that makes a stream of",
    "operations slower than its typical member.",
    "",
    `Taking one measurement costs ${micro(report.timerOverhead.p50Ms)} at the median over ` +
      `${report.timerOverhead.n} samples. It is`,
    "printed rather than subtracted: subtracting it would produce a number that is",
    "neither the operation nor the measurement of it.",
    "",
    "`—` in the wire-bytes column is the legend's \"declared not to apply on this",
    'path": an in-process row has no transport to count. It is not a pending',
    "measurement.",
    "",
    "## Enforcement cost",
    "",
    "| Component | Path | p50 | p95 | Tokens | Evidence bytes | Wire bytes | Ops/sec | n |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const measure of report.measures) {
    lines.push(
      `| ${measure.component} | ${measure.path} | ${ms(measure.latency.p50Ms)} | ` +
        `${ms(measure.latency.p95Ms)} | ${measure.tokens} | ` +
        `${measure.evidenceBytes === null ? "—" : `${Math.round(measure.evidenceBytes.meanBytes)} B`} | ` +
        `${measure.wireBytes === null ? "—" : `${Math.round(measure.wireBytes.meanBytes)} B`} | ` +
        `${Math.round(measure.latency.opsPerSecond)} | ${measure.latency.n} |`,
    );
  }

  lines.push("", "Every `0` in the token column is structural: it is asserted from the absence");
  lines.push("of a model call inside the span, not measured by counting one.", "");
  lines.push("### What each row measured", "");
  for (const measure of report.measures) {
    lines.push(
      `- **${measure.component} — ${measure.path}.** One operation is ${measure.unit}. ` +
        `${measure.basis}.`,
    );
  }

  lines.push("", "## Where one mediated call goes", "");
  lines.push("Every segment below is a span carrying the call's own id, so the remainder is");
  lines.push("a subtraction rather than a name for what went unmeasured. It is the defensive");
  lines.push("copies, the schema validation, and the two execution events a call leaves");
  lines.push("behind.", "");
  lines.push("Shares are totals over the whole run, not ratios of medians. A segment appears");
  lines.push("fewer than once per call because the envelope refuses some calls before the");
  lines.push("kernel is reached at all -- a guess at an unexposed tool never resolves a");
  lines.push("catalogue -- and that is the column headed *Per call*.", "");
  for (const breakdown of report.breakdown) {
    lines.push(`### ${breakdown.path}`, "");
    lines.push("| Segment | p50 | Share of the call | Per call |");
    lines.push("| --- | --- | --- | --- |");
    for (const segment of breakdown.segments) {
      lines.push(
        `| ${segment.label} | ${ms(segment.latency.p50Ms)} | ` +
          `${share(total(segment.latency), total(breakdown.whole))} | ` +
          `${round(segment.perCall)} |`,
      );
    }
    lines.push(
      `| Remainder | ${ms(breakdown.remainder.p50Ms)} | ` +
        `${share(total(breakdown.remainder), total(breakdown.whole))} | 1 |`,
    );
    lines.push(`| **Whole call** | ${ms(breakdown.whole.p50Ms)} | 100% | 1 |`);
    lines.push("");
  }

  lines.push("## Harness translation cost", "");
  lines.push("The adapter layer, with no model in any span. One operation is one call's");
  lines.push("round trip through the vendor's shapes: interpret the frame that carries the");
  lines.push("call, and encode the result that answers it. `describeTools` runs once per");
  lines.push("turn rather than once per call and is outside these figures.", "");
  lines.push(
    `${MODEL_SCRIPTED_COLUMN.label} is the native harness's own layer, on the same terms: one`,
  );
  lines.push("chat-completions reply decoded, each call's name and arguments read back into");
  lines.push("the catalogue's, and the result encoded as the tool message the model reads.");
  lines.push("The tool-name codec is built once per turn, as the driver builds it, and is");
  lines.push("outside the figure for the same reason `describeTools` is.", "");
  lines.push("| Column | Parse + translate per call | Catalogue width | n |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(`| ${ADVERSARY_COLUMN.label} | — | ${report.structural.catalogueWidth} | — |`);
  for (const entry of report.translation) {
    lines.push(
      `| ${entry.label} | ${micro(entry.latency.p50Ms)} | ${entry.catalogueWidth} | ${entry.latency.n} |`,
    );
  }
  lines.push(
    "",
    `${ADVERSARY_COLUMN.label}'s \`—\` is the absence of a translation layer, not a pending measurement.`,
  );
  lines.push("");
  lines.push("The width is the catalogue SharedOS served. A harness that republishes it");
  lines.push("behind a proxy tool of its own, as Pi's codemode exposure or an MCP extension");
  lines.push("does, changes what the harness serializes, not what was served, and that is a");
  lines.push("property of the harness rather than a measurement this bench can take.");

  lines.push("", "## Structural footprint of this run", "");
  lines.push("| Quantity | Value |");
  lines.push("| --- | --- |");
  lines.push(
    `| Record bytes per turn | ${Math.round(report.structural.recordBytes.meanBytes)} B mean |`,
  );
  lines.push(`| Authority loads per turn | ${round(report.structural.authorityLoadsPerTurn)} |`);
  lines.push(`| Decisions per turn | ${round(report.structural.decisionsPerTurn)} |`);
  lines.push(`| Audit events per turn | ${round(report.structural.auditEventsPerTurn)} |`);
  lines.push(`| Mediated tool calls per turn | ${round(report.structural.toolCallsPerTurn)} |`);
  lines.push(
    `| Catalogue served per turn | ${report.structural.catalogueWireBytes} B over the wire, ` +
      `${report.structural.catalogueWidth} tools |`,
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function total(distribution: Distribution): number {
  return distribution.meanMs * distribution.n;
}

function share(part: number, whole: number): string {
  if (whole === 0) {
    return "—";
  }
  const percent = (part / whole) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

function ms(value: number): string {
  return value < 1 ? micro(value) : `${round(value)} ms`;
}

function micro(value: number): string {
  return `${round(value * 1000)} µs`;
}

function describeEnvironment(environment: JsonObject): string {
  return Object.entries(environment)
    .map(([key, value]) => `${key} \`${String(value)}\``)
    .join(", ");
}
