import {
  ExecutionRequestSchema,
  ExecutionResultSchema,
  JsonValueSchema,
  MAX_EXECUTION_TOOL_CALLS,
  PROTOCOL_VERSION,
  MAX_EXECUTION_TIMEOUT_MS,
  RuntimeEventSchema,
  RuntimeManifestSchema,
  RuntimeTurnOutcomeSchema,
  ToolCallSchema,
  ToolResultSchema,
  type AccessContext,
  type ExecutionEvent,
  type ExecutionRequest,
  type ExecutionResult,
  type JsonObject,
  type JsonValue,
  type ProtocolError,
  type ReachResult,
  type RuntimeEvent,
  type RuntimeManifest,
  type RuntimeTurnOutcome,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from "@aicoo/sharedos-contracts";
import {
  ReplayError,
  replayContext,
  AUDIT_UNAVAILABLE,
  AuditUnavailableError,
  ExecutionInProgressError,
  SPAN,
  canonicalJson,
  measure,
  reachThroughTools,
  type SpanSink,
} from "@aicoo/sharedos-core";
import type { SharedOSKernel, TurnAuthorityScope } from "@aicoo/sharedos-core";
import {
  deepFreeze,
  protocolError,
  raceAbort,
  refusedToolResult,
} from "@aicoo/sharedos-core/internal";

import { escalationOffered } from "./escalation.js";
import { createTurnDeadlines } from "./internal.js";
import {
  reportTurnError,
  type RuntimeHost,
  type RuntimeLimits,
  type RuntimePlugin,
  type RuntimeToolInvocationOptions,
  type RuntimeTurnRequest,
  type TurnErrorReporter,
} from "./runtime-plugin.js";

export interface SharedOSExecutorOptions {
  clock?: () => string;
  createId?: () => string;
  defaultMaxSteps?: number;
  defaultMaxToolCalls?: number;
  defaultTimeoutMs?: number;
  /**
   * How long before a turn's deadline it stops taking new tool calls, so the
   * calls already inside a handler can answer before the deadline stops them.
   *
   * Inside the limit, never on top of it: with `timeoutMs` 120 000 and a grace
   * of 5 000 a new call is refused from 115 s, a handler running then is left
   * alone, and the abort reaches it at 120 s as it always did. A handler still
   * running at the deadline is recorded `interrupted`. An audit outage drains
   * the same way, for the grace or the time left, whichever is shorter. A
   * host's own cancellation does not: it stops the turn at once, as before.
   *
   * Zero, the default, is the behaviour before this option. It is not capped
   * against a request's `timeoutMs`; a grace no smaller than the limit leaves a
   * turn no time in which a call is taken, and choosing it is the host's.
   */
  drainGraceMs?: number;
  /**
   * Where the envelope reports what it cost, when a host is measuring.
   *
   * A second clock, and deliberately not the one `clock` supplies: that one
   * names instants for a record and a conformance run freezes it. See
   * {@link SpanSink}.
   */
  spans?: SpanSink;
  /**
   * Notification for a throw the turn body did not convert into an outcome.
   *
   * The envelope contains such a throw and ends the turn `failed` with
   * `runtime_failed`; the error itself comes here rather than being discarded.
   * See {@link TurnErrorReporter} for what it may and may not be used for.
   *
   * Not only the plugin's. The turn body also calls `openTurnAuthority`,
   * `admitTurn`, `reach`, and `listTools`, and a host port that throws arrives here too
   * under the same terminal code. That conflation is in the wire vocabulary and
   * is not fixed by this hook; the error's own stack is what separates them,
   * which is the reason for handing it over rather than classifying it here.
   */
  onTurnError?: TurnErrorReporter;
}

export interface ExecuteTurnOptions {
  signal?: AbortSignal;
  /** Synchronous observation hook for streaming an immutable event snapshot. */
  onEvent?: (event: ExecutionEvent) => void;
}

export interface TurnExecutionPort {
  execute(input: ExecutionRequest, options?: ExecuteTurnOptions): Promise<ExecutionResult>;
}

/**
 * The minimal deny-by-default kernel surface required by a turn executor.
 *
 * Hosts normally pass a {@link SharedOSKernel}. Keeping this port explicit also
 * permits narrow test doubles without granting a runtime direct access to
 * registries, namespace settings, or other host policy state.
 *
 * Every member is required. The first four are what a turn asks of the kernel.
 * The other four are what makes it a turn: `openTurnAuthority` is the boundary
 * authority is resolved at and held from (ADR 0010), and the three recorders
 * are how an ask, an ending and a call the envelope refused reach the trail the
 * kernel owns (ADR 0023). A kernel without them would run a turn that re-reads
 * its authority on every call and records none of what the envelope decided,
 * which is not a narrower turn but a different one.
 */
export type TurnKernel = Pick<
  SharedOSKernel,
  | "replayProtection"
  | "admitTurn"
  | "reach"
  | "listTools"
  | "invokeTool"
  | "openTurnAuthority"
  | "recordEscalation"
  | "recordTurnEnd"
  | "recordRefusedCall"
>;

/**
 * The non-replaceable security envelope around one replaceable RuntimePlugin.
 * Scheduling, retries, and network-level stopping remain host responsibilities.
 */
export class SharedOSExecutor implements TurnExecutionPort {
  readonly #kernel: TurnKernel;
  readonly #runtime: RuntimePlugin;
  readonly #manifest: RuntimeManifest;
  readonly #clock: () => string;
  readonly #createId: () => string;
  readonly #defaultMaxSteps: number;
  readonly #defaultMaxToolCalls: number | undefined;
  readonly #defaultTimeoutMs: number;
  readonly #drainGraceMs: number;
  readonly #spans: SpanSink | undefined;
  readonly #onTurnError: TurnErrorReporter | undefined;

  constructor(kernel: TurnKernel, runtime: RuntimePlugin, options: SharedOSExecutorOptions = {}) {
    if (runtime === null || typeof runtime !== "object" || typeof runtime.run !== "function") {
      throw new TypeError("Runtime plugin must provide a run function");
    }
    const manifest = RuntimeManifestSchema.safeParse(runtime.manifest);
    if (!manifest.success) {
      throw new TypeError("Runtime manifest does not match the SharedOS v1 contract");
    }

    this.#kernel = kernel;
    this.#manifest = deepFreeze(structuredClone(manifest.data));
    this.#runtime = Object.freeze({
      manifest: this.#manifest,
      run: runtime.run.bind(runtime),
    });
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#defaultMaxSteps = options.defaultMaxSteps ?? 16;
    this.#defaultMaxToolCalls = options.defaultMaxToolCalls;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.#drainGraceMs = options.drainGraceMs ?? 0;
    this.#spans = options.spans;
    this.#onTurnError = options.onTurnError;

    if (!Number.isInteger(this.#defaultMaxSteps) || this.#defaultMaxSteps <= 0) {
      throw new TypeError("defaultMaxSteps must be a positive integer");
    }
    if (
      this.#defaultMaxToolCalls !== undefined &&
      (!Number.isInteger(this.#defaultMaxToolCalls) ||
        this.#defaultMaxToolCalls <= 0 ||
        this.#defaultMaxToolCalls > MAX_EXECUTION_TOOL_CALLS)
    ) {
      throw new TypeError(`defaultMaxToolCalls must be between 1 and ${MAX_EXECUTION_TOOL_CALLS}`);
    }
    if (
      !Number.isInteger(this.#defaultTimeoutMs) ||
      this.#defaultTimeoutMs <= 0 ||
      this.#defaultTimeoutMs > MAX_EXECUTION_TIMEOUT_MS
    ) {
      throw new TypeError(`defaultTimeoutMs must be between 1 and ${MAX_EXECUTION_TIMEOUT_MS}`);
    }
    if (
      !Number.isInteger(this.#drainGraceMs) ||
      this.#drainGraceMs < 0 ||
      this.#drainGraceMs > MAX_EXECUTION_TIMEOUT_MS
    ) {
      throw new TypeError(`drainGraceMs must be between 0 and ${MAX_EXECUTION_TIMEOUT_MS}`);
    }
  }

  get runtimeManifest(): RuntimeManifest {
    return structuredClone(this.#manifest);
  }

  async execute(
    input: ExecutionRequest,
    options: ExecuteTurnOptions = {},
  ): Promise<ExecutionResult> {
    return measure(
      this.#spans,
      SPAN.TURN,
      () => this.#replayExecute(input, options),
      (result, span) => {
        span.set("executionId", result.executionId);
        span.set("status", result.status);
      },
    );
  }

  async #replayExecute(
    input: ExecutionRequest,
    options: ExecuteTurnOptions,
  ): Promise<ExecutionResult> {
    const parsed = ExecutionRequestSchema.safeParse(structuredClone(input));
    if (!parsed.success)
      throw new TypeError("ExecutionRequest does not match the SharedOS v1 contract");
    const request = {
      ...parsed.data,
      context: { ...parsed.data.context, executionId: parsed.data.executionId },
    };
    if (options.signal?.aborted === true) return this.#execute(request, options);
    try {
      return await this.#kernel.replayProtection.run(
        {
          namespaceId: request.context.namespaceId,
          kind: "execution",
          scope: "",
          id: request.executionId,
        },
        {
          ...request,
          context: replayContext(request.context),
          runtime: this.#manifest,
          defaults: {
            maxSteps: this.#defaultMaxSteps,
            maxToolCalls: this.#defaultMaxToolCalls,
            timeoutMs: this.#defaultTimeoutMs,
            drainGraceMs: this.#drainGraceMs,
          },
        },
        () => this.#execute(request, options),
        (value) => {
          const result = ExecutionResultSchema.parse(value);
          if (
            result.executionId !== request.executionId ||
            result.traceId !== request.context.traceId
          )
            throw new Error("Mismatched replay result");
          return result;
        },
      );
    } catch (error) {
      if (!(error instanceof ReplayError)) throw error;
      const now = this.#clock();
      const refused: ExecutionResult = {
        version: PROTOCOL_VERSION,
        executionId: request.executionId,
        traceId: request.context.traceId,
        events: [],
        startedAt: now,
        completedAt: now,
        status: error.code === "replay_conflict" ? "denied" : "failed",
        error: protocolError(error.code, "Operation replay refused"),
      };
      await this.#recordTurnEnd(request, refused);
      return refused;
    }
  }

  async #execute(
    input: ExecutionRequest,
    options: ExecuteTurnOptions = {},
  ): Promise<ExecutionResult> {
    const parsed = ExecutionRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new TypeError("ExecutionRequest does not match the SharedOS v1 contract");
    }

    const request = parsed.data;
    const result = await this.#runTurn(request, options);
    await this.#recordTurnEnd(request, result);
    return result;
  }

  /**
   * Write how the turn ended into the trail the kernel owns.
   *
   * One site rather than one per terminal return, and derived from the result
   * instead of from each branch, so an ending added later cannot be the one
   * nobody remembered to record. The abort signal is deliberately not passed on:
   * a cancelled turn is the case that most needs recording, and handing the
   * recorder the signal that cancelled it would drop exactly that event.
   *
   * A failure here is swallowed. A dropped audit write matters -- that is what
   * `SharedOSKernelOptions.onAuditError` is for, and the kernel calls it -- but
   * it must not turn a turn that completed into one that threw.
   */
  async #recordTurnEnd(request: ExecutionRequest, result: ExecutionResult): Promise<void> {
    const reasonCode = terminalReasonCode(result);
    const endedBy = terminalSource(result.events);
    try {
      await this.#kernel.recordTurnEnd(contextAt(request.context, result.completedAt), {
        executionId: result.executionId,
        status: result.status,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...(endedBy === undefined ? {} : { endedBy }),
      });
    } catch {
      // Deliberately empty; see the docblock above.
    }
  }

  /**
   * Write a call this boundary refused into the trail the kernel owns.
   *
   * Nothing reached the kernel, so nothing was audited -- a guessed tool name, a
   * spent step budget, a spent call budget were visible only in the execution
   * event stream, which no production consumer reads. Swallowed on failure for
   * the reason {@link SharedOSExecutor.execute} records terminals: an
   * observation must not change the outcome it observed (ADR 0023).
   */
  async #recordRefusedCall(
    context: AccessContext,
    result: ToolResult,
    cause?: string,
  ): Promise<void> {
    if (result.status === "succeeded") {
      return;
    }
    try {
      await this.#kernel.recordRefusedCall(contextAt(context, result.completedAt), {
        callId: result.callId,
        tool: result.tool,
        reasonCode: result.error.code,
        ...(cause === undefined ? {} : { cause }),
      });
    } catch {
      // Deliberately empty; see the docblock above.
    }
  }

  async #runTurn(
    request: ExecutionRequest,
    options: ExecuteTurnOptions = {},
  ): Promise<ExecutionResult> {
    const startedAt = this.#clock();
    const events: ExecutionEvent[] = [];
    const emit = (type: string, data: JsonValue): void => {
      const event: ExecutionEvent = {
        version: PROTOCOL_VERSION,
        eventId: this.#createId(),
        executionId: request.executionId,
        traceId: request.context.traceId,
        sequence: events.length,
        type,
        data,
        occurredAt: this.#clock(),
      };
      events.push(event);
      try {
        options.onEvent?.(deepFreeze(structuredClone(event)));
      } catch {
        // An observational stream sink cannot replace the execution outcome.
      }
    };
    // What the plugin stated for the record, through `RuntimeHost.annotate`.
    // Held here rather than by the plugin so that every way out of the turn
    // carries it, including the ones that have no outcome to carry anything:
    // a cancelled turn, a plugin that threw, an outcome that did not parse.
    const annotations = new Map<string, JsonValue>();
    const resultMetadata = (outcome?: Pick<RuntimeTurnOutcome, "metadata">): JsonObject =>
      runtimeResultMetadata(this.#manifest, outcome, annotations);

    const contextError = validateTurnContext(request);
    if (contextError !== undefined) {
      emit("turn.denied", { code: contextError.code });
      return resultFor(
        request,
        events,
        startedAt,
        this.#clock(),
        "denied",
        contextError,
        resultMetadata(),
      );
    }

    const timeoutMs = request.options?.timeoutMs ?? this.#defaultTimeoutMs;
    const maxSteps = request.options?.maxSteps ?? this.#defaultMaxSteps;
    const limits: RuntimeLimits = deepFreeze({
      maxSteps,
      maxToolCalls: request.options?.maxToolCalls ?? this.#defaultMaxToolCalls ?? maxSteps,
      timeoutMs,
    });
    const abort = createTurnDeadlines(options.signal, timeoutMs, this.#drainGraceMs);
    let runtimeHostActive = true;
    let toolCallCount = 0;
    const steps = new Set<number>();
    let authority: TurnAuthorityScope | undefined;
    let opening: Promise<TurnAuthorityScope> | undefined;
    // An audit outage on a record that comes before an effect. Noted where the
    // envelope itself called the kernel, never read off whatever the plugin
    // threw: the turn then ends `audit_unavailable` by the envelope's decision,
    // and a plugin can neither swallow the rejection and carry on nor throw the
    // error itself to be credited with a refusal the envelope did not make.
    let auditOutage: AuditUnavailableError | undefined;
    // Whether running this turn again could repeat something it already did. A
    // call the kernel refused outright (`denied`) or whose decision could not be
    // recorded did nothing. Every other call may have taken effect, and so may
    // one still with the kernel when the turn ends. Only a call that cannot be
    // repeated safely counts: a `read` tool, and one its definition declares
    // `idempotent`, are safe to run twice, and a search that outlived its
    // deadline is the case a retry is for. The classification is the kernel's
    // listed catalogue, never the plugin's word. It decides `retryable` on
    // every ending that offers one: refusing a retry costs a host one decision,
    // and allowing one after a committed effect costs it a second payment.
    let effectPossible = false;
    let writesWithKernel = 0;
    const safeToRetry = (): boolean => !effectPossible && writesWithKernel === 0;
    // Mediated calls the turn has not yet seen the end of, `tool.completed`
    // included, so an ending that drains knows what it is waiting for.
    const inFlight = new Set<Promise<unknown>>();
    const watchAudit = <T>(work: Promise<T>): Promise<T> =>
      work.catch((error: unknown) => {
        if (error instanceof AuditUnavailableError) {
          auditOutage ??= error;
        }
        throw error;
      });

    try {
      if (abort.signal.aborted) {
        return cancelledResult(request, events, startedAt, this.#clock(), resultMetadata(), true);
      }

      const executionContext = {
        ...structuredClone(contextAt(request.context, this.#clock())),
        // The request's id, over any the context arrived with: it is what makes
        // this turn's lease its own.
        executionId: request.executionId,
      };

      // The turn boundary. Authority is resolved once here and held for every
      // decision the turn goes on to make, so a grant removed from the store
      // while this turn runs is observed by the next turn rather than part-way
      // through this one. The promise is kept as well as the handle, because a
      // turn cancelled while this is still in flight never receives the handle
      // and would leave the lease answering for a turn that has ended.
      opening = watchAudit(
        this.#kernel.openTurnAuthority(executionContext, { signal: abort.signal }),
      );
      try {
        authority = await raceAbort(opening, abort.signal);
      } catch (error) {
        // Read where the envelope asked, not off what the turn body throws
        // later, so a plugin cannot be credited with this refusal. The run
        // already open under this id is untouched.
        if (!(error instanceof ExecutionInProgressError)) {
          throw error;
        }
        const refusal = protocolError(error.code, "An execution with this id is still running.");
        emit("turn.denied", { code: refusal.code });
        return resultFor(
          request,
          events,
          startedAt,
          this.#clock(),
          "denied",
          refusal,
          resultMetadata(),
        );
      }

      const admission = await raceAbort(
        watchAudit(
          this.#kernel.admitTurn(executionContext, request.agent, { signal: abort.signal }),
        ),
        abort.signal,
      );
      if (!admission.allowed) {
        const error = protocolError(
          admission.reasonCode,
          "The access context does not grant permission to invoke this agent.",
        );
        emit("turn.denied", { code: error.code });
        return resultFor(
          request,
          events,
          startedAt,
          this.#clock(),
          "denied",
          error,
          resultMetadata(),
        );
      }

      // Where the turn may operate, read from the same authority every decision
      // in it is made against. Handed to the runtime as answered: a reach that
      // could not be established says so, rather than becoming an empty list
      // that would read as "nothing" -- a true answer for a turn that reaches
      // nothing, and a false one here. The turn runs either way; a call that
      // depends on the unreadable budget fails closed on its own (ADR 0021).
      const reach = await raceAbort(
        watchAudit(this.#kernel.reach(executionContext, { signal: abort.signal })),
        abort.signal,
      );

      const allowedTools = await raceAbort(
        watchAudit(this.#kernel.listTools(executionContext, { signal: abort.signal })),
        abort.signal,
      );
      const requestedNames = new Set(request.tools.map(({ name }) => name));
      const effectiveTools = allowedTools.filter(({ name }) => requestedNames.has(name));
      const effectiveToolNames = new Set(effectiveTools.map(({ name }) => name));
      const repeatableToolNames = new Set(
        effectiveTools.filter(isSafeToRepeat).map(({ name }) => name),
      );
      // Narrowed to what this turn's catalogue operates on: a runtime acts only
      // through the tools it was handed, so reach it cannot exercise is not
      // somewhere it can work.
      const runtimeRequest = toRuntimeTurnRequest(
        request,
        executionContext,
        effectiveTools,
        reach.status === "computed"
          ? { status: "computed", reach: [...reachThroughTools(reach.reach, effectiveTools)] }
          : reach,
      );

      emit("turn.started", {
        agent: request.agent,
        visibleTools: effectiveTools.map(({ name }) => name),
        runtime: runtimeProvenance(this.#manifest),
      });

      // The envelope's whole share of one mediated call: budget checks, the
      // effective-catalogue check, the kernel round trip, and the two events
      // the call leaves behind. Named separately from the kernel's own span
      // because they are different costs with different owners, and the
      // difference between them is what the envelope charges for existing.
      const mediateTool = async (
        call: ToolCall,
        invocationOptions: RuntimeToolInvocationOptions = {},
      ): Promise<ToolResult> => {
        assertRuntimeHostActive(runtimeHostActive, abort.signal);
        const parsedCall = ToolCallSchema.safeParse(structuredClone(call));
        if (!parsedCall.success) {
          throw new TypeError("Runtime tool call does not match the SharedOS v1 contract");
        }
        const step = parseRuntimeStep(invocationOptions.step);
        const eventData = toolEventData(parsedCall.data, step);
        emit("tool.requested", eventData);

        if (abort.draining.aborted) {
          // The turn is ending and takes nothing new. Refused and recorded like
          // any call the envelope stops, so the trail shows a call that was
          // asked for and did not run rather than nothing at all.
          const result = refusedToolResult(
            parsedCall.data,
            "denied",
            this.#clock(),
            TURN_DRAINING,
            "The turn is ending and takes no new tool calls.",
          );
          emit("tool.completed", completedToolEventData(result, step));
          await this.#recordRefusedCall(executionContext, result);
          return result;
        }

        if (step !== undefined && !stepIsWithinBudget(step, steps, limits.maxSteps)) {
          const result = refusedToolResult(
            parsedCall.data,
            "denied",
            this.#clock(),
            "step_limit_exceeded",
            "The runtime reached its maximum number of steps.",
          );
          emit("tool.completed", completedToolEventData(result, step));
          await this.#recordRefusedCall(executionContext, result);
          return result;
        }
        if (step !== undefined) {
          steps.add(step);
        }

        if (toolCallCount >= limits.maxToolCalls) {
          const result = refusedToolResult(
            parsedCall.data,
            "denied",
            this.#clock(),
            "tool_call_limit_exceeded",
            "The runtime reached its maximum number of tool calls.",
          );
          emit("tool.completed", completedToolEventData(result, step));
          await this.#recordRefusedCall(executionContext, result);
          return result;
        }
        toolCallCount += 1;

        if (!effectiveToolNames.has(parsedCall.data.tool)) {
          const result = unavailableToolResult(parsedCall.data, this.#clock());
          emit("tool.completed", completedToolEventData(result, step));
          // The clearest attempted violation the system produces, and until now
          // it reached no audit sink at all: the kernel never saw the call.
          await this.#recordRefusedCall(executionContext, result, "not_offered");
          return result;
        }

        // Counted on the kernel's own promise rather than on the race below, so
        // a call the turn stopped waiting for is still known to be out there.
        const repeatable = repeatableToolNames.has(parsedCall.data.tool);
        writesWithKernel += repeatable ? 0 : 1;
        const withKernel = watchAudit(
          this.#kernel.invokeTool(contextAt(executionContext, this.#clock()), parsedCall.data, {
            signal: abort.signal,
            executionId: request.executionId,
          }),
        ).then(
          (settled) => {
            writesWithKernel -= repeatable ? 0 : 1;
            effectPossible ||= !repeatable && !isRefusedBeforeEffect(settled);
            return settled;
          },
          (error: unknown) => {
            writesWithKernel -= repeatable ? 0 : 1;
            // Known to have done nothing only when the kernel itself refused it
            // for the outage, before its port was entered. Once the turn has
            // been aborted a sibling rejects with the abort's reason, which is
            // this same error, so after that point a rejection proves nothing.
            const refusedForOutage =
              error instanceof AuditUnavailableError &&
              error.effect === "none" &&
              !abort.signal.aborted;
            effectPossible ||= !repeatable && !refusedForOutage;
            if (error === auditOutage) {
              // Ended here, not left to the plugin: every later decision in the
              // turn would fail its record too, and a plugin that caught this
              // and called again would spend a bounded use on each attempt.
              // Drained rather than aborted, so a sibling inside its handler
              // answers instead of being stopped part-way; with no grace the
              // two are the same thing.
              abort.drain(error);
            }
            throw error;
          },
        );
        const resultCandidate = await raceAbort(withKernel, abort.signal);
        const result = ToolResultSchema.safeParse(resultCandidate);
        if (!result.success) {
          throw new TypeError("Kernel returned an invalid tool result");
        }
        assertRuntimeHostActive(runtimeHostActive, abort.signal);
        emit("tool.completed", completedToolEventData(result.data, step));
        return result.data;
      };

      const host: RuntimeHost = Object.freeze({
        limits,
        invokeTool: (
          call: ToolCall,
          invocationOptions: RuntimeToolInvocationOptions = {},
        ): Promise<ToolResult> => {
          const mediated = measure(
            this.#spans,
            SPAN.TOOL_MEDIATE,
            () => mediateTool(call, invocationOptions),
            (result, span) => {
              span.set("callId", result.callId);
              span.set("tool", result.tool);
              span.set("outcome", result.status);
            },
          );
          const tracked = mediated.then(
            () => void inFlight.delete(tracked),
            () => void inFlight.delete(tracked),
          );
          inFlight.add(tracked);
          return mediated;
        },
        draining: abort.draining,
        emit: (event: RuntimeEvent): void => {
          assertRuntimeHostActive(runtimeHostActive, abort.signal);
          const parsedEvent = RuntimeEventSchema.safeParse(structuredClone(event));
          if (!parsedEvent.success) {
            throw new TypeError("Runtime event does not match the SharedOS v1 contract");
          }
          emit("runtime.event", {
            runtime: runtimeProvenance(this.#manifest),
            type: parsedEvent.data.type,
            data: parsedEvent.data.data,
          });
        },
        annotate: (key: string, value: JsonValue): void => {
          // `__proto__` with the rest: `JsonObjectSchema` drops that key from
          // every object it reads, so taking it here would put a shape on the
          // result that no validated path can produce.
          if (
            typeof key !== "string" ||
            key.length === 0 ||
            key === RUNTIME_METADATA_KEY ||
            key === "__proto__"
          ) {
            throw new TypeError(
              "Runtime annotation key must be a non-empty string other than 'runtime' or '__proto__'",
            );
          }
          const parsedValue = JsonValueSchema.safeParse(cloneOrUndefined(value));
          if (!parsedValue.success) {
            throw new TypeError("Runtime annotation value must be a JSON value");
          }
          // No `assertRuntimeHostActive`, deliberately. A turn that is aborted
          // but not yet closed is the turn that most needs what it was told on
          // its result, so the write is taken. Once the turn has closed the
          // result is built and nothing can reach it, so the write is dropped
          // rather than refused: a statement for the record must never become
          // a fault in whatever was making it.
          if (!runtimeHostActive) {
            return;
          }
          annotations.set(key, deepFreeze(parsedValue.data));
        },
      });

      const outcomeCandidate: unknown = await raceAbort(
        this.#runtime.run(runtimeRequest, host, abort.signal),
        abort.signal,
      );
      if (auditOutage !== undefined) {
        // A plugin that swallowed the refusal and answered anyway. The ending
        // is the envelope's, and with a grace the turn's signal has not fired
        // to make it, so it is made here.
        throw auditOutage;
      }
      const outcome = RuntimeTurnOutcomeSchema.safeParse(outcomeCandidate);
      if (!outcome.success) {
        const error = protocolError(
          "invalid_runtime_outcome",
          "The runtime plugin returned an invalid terminal outcome.",
        );
        emit("turn.failed", { code: error.code, source: "envelope" });
        return resultFor(
          request,
          events,
          startedAt,
          this.#clock(),
          "failed",
          error,
          resultMetadata(),
        );
      }

      if (outcome.data.type === "complete") {
        emit("turn.completed", {});
        return {
          version: PROTOCOL_VERSION,
          executionId: request.executionId,
          traceId: request.context.traceId,
          status: "succeeded",
          output: outcome.data.output,
          events,
          startedAt,
          completedAt: this.#clock(),
          metadata: resultMetadata(outcome.data),
        };
      }

      if (outcome.data.type === "escalate") {
        // The ask is gated by the catalogue, and the envelope holds that gate
        // from outside the plugin. The standard loop's drivers and the MCP
        // latch each read their turn's catalogue before ending a turn on the
        // name, but a replacement plugin is a replacement for exactly that
        // check, and a limit only the reference implementations honour is not
        // a limit. So it is repeated here, against the catalogue this turn was
        // actually served: a plugin escalating on a turn that holds no grant
        // over the affordance is refused as any call outside the catalogue is,
        // under the same code from the same boundary, and the turn fails --
        // a runtime returning an outcome it was not allowed to return is a
        // runtime misbehaving, as with `invalid_runtime_outcome`. Nothing
        // reached the kernel, so nothing is audited; the event stream is where
        // an envelope refusal lives.
        if (!escalationOffered(effectiveTools)) {
          const error = protocolError(
            "tool_unavailable",
            "The runtime ended the turn by escalation, but this turn's catalogue does not offer the affordance.",
          );
          // `source` says who ended the turn. A record reader -- the conformance
          // judge is one -- can then credit the envelope with a refusal it made,
          // and credit nothing for a failure the runtime reported as its own.
          emit("turn.failed", { code: error.code, source: "envelope" });
          return resultFor(
            request,
            events,
            startedAt,
            this.#clock(),
            "failed",
            error,
            resultMetadata(outcome.data),
          );
        }

        // The escalation is recorded through the kernel, which owns audit, and
        // then the turn ends. Nothing here waits for a reviewer: resolving an
        // escalation means issuing a grant to the trusted store, which the next
        // turn loads. The kernel writes the ask after the fact, so a sink that
        // cannot take it still hands back the stub: the outcome is the runtime's
        // to declare, and the turn ends escalated either way.
        const escalation = await raceAbort(
          watchAudit(
            this.#kernel.recordEscalation(
              contextAt(executionContext, this.#clock()),
              outcome.data.reason,
              { signal: abort.signal, executionId: request.executionId },
            ),
          ),
          abort.signal,
        );
        emit("turn.escalated", { reason: escalation.reason, reviewer: escalation.reviewer });
        return {
          version: PROTOCOL_VERSION,
          executionId: request.executionId,
          traceId: request.context.traceId,
          status: "escalated",
          escalation,
          events,
          startedAt,
          completedAt: this.#clock(),
          metadata: resultMetadata(outcome.data),
        };
      }

      emit("turn.failed", { code: outcome.data.error.code, source: "runtime" });
      return resultFor(
        request,
        events,
        startedAt,
        this.#clock(),
        "failed",
        // A plugin says whether its own failure is the passing kind. It does not
        // know what the calls it made went on to do, and the harness adapters
        // state `retryable` on any harness failure, so its `true` stands only
        // where running the turn again repeats nothing.
        outcome.data.error.retryable === true && !safeToRetry()
          ? { ...outcome.data.error, retryable: false }
          : outcome.data.error,
        resultMetadata(outcome.data),
      );
    } catch (thrown) {
      if (abort.draining.aborted && !abort.signal.aborted && inFlight.size > 0) {
        // The turn is ending and its calls are not all back. They are given
        // until the turn's signal, which a drain leaves for exactly this, and
        // the turn ends as soon as the last one has answered.
        await raceAbort(Promise.allSettled(inFlight), abort.signal).catch(() => undefined);
      }

      if (auditOutage !== undefined) {
        // Ahead of the cancellation check, because the latch ends the turn by
        // aborting it. The envelope refused to go on, so the ending is the
        // envelope's and the plugin is not named (ADR 0023).
        const error = protocolError(
          AUDIT_UNAVAILABLE,
          "The audit sink could not record a decision, so the turn was ended.",
          safeToRetry(),
        );
        emit("turn.failed", { code: error.code, source: "envelope" });
        reportTurnError(this.#onTurnError, auditOutage, {
          executionId: request.executionId,
          traceId: request.context.traceId,
        });
        return resultFor(
          request,
          events,
          startedAt,
          this.#clock(),
          "failed",
          error,
          resultMetadata(),
        );
      }

      // A turn that is draining is ending on its deadline, and a plugin that
      // stops when told to does so by throwing. That is the turn being
      // cancelled, not the plugin failing, as it already is once the signal
      // itself has fired.
      if (abort.draining.aborted) {
        emit("turn.cancelled", {});
        return cancelledResult(
          request,
          events,
          startedAt,
          this.#clock(),
          resultMetadata(),
          safeToRetry(),
        );
      }

      const error = protocolError("runtime_failed", "The runtime plugin failed.", safeToRetry());
      emit("turn.failed", { code: error.code, source: "envelope" });
      // Reported here rather than from the `finally`, which also runs for a
      // turn that ended normally and would have to work out whether there was
      // anything to report. This is the one path that has an error in hand.
      reportTurnError(this.#onTurnError, thrown, {
        executionId: request.executionId,
        traceId: request.context.traceId,
      });
      return resultFor(
        request,
        events,
        startedAt,
        this.#clock(),
        "failed",
        error,
        resultMetadata(),
      );
    } finally {
      runtimeHostActive = false;
      // Released on every path out, including cancellation: an unclosed lease
      // would keep answering for a turn that has already ended. Closing is
      // idempotent, so covering both the handle and the promise it came from is
      // safe and covers the abandoned-while-opening case too.
      authority?.close();
      void opening?.then(
        (scope) => scope.close(),
        () => undefined,
      );
      abort.abort(new Error("turn closed"));
      abort.dispose();
    }
  }
}

function toRuntimeTurnRequest(
  request: ExecutionRequest,
  context: AccessContext,
  tools: readonly ToolDefinition[],
  reach: ReachResult,
): RuntimeTurnRequest {
  return deepFreeze(
    structuredClone({
      version: request.version,
      executionId: request.executionId,
      agent: request.agent,
      message: request.message,
      tools: [...tools],
      context: {
        actor: context.actor,
        owner: context.owner,
        namespaceId: context.namespaceId,
        purpose: context.purpose,
        traceId: context.traceId,
        now: context.now,
        reach,
      },
      ...(request.state === undefined ? {} : { state: request.state }),
      ...(request.options === undefined ? {} : { options: request.options }),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    }),
  );
}

/**
 * Whether one declared step is inside the turn's step budget.
 *
 * The standard loop bounds itself, but a replacement plugin is a
 * replacement for exactly that loop, so a limit only the reference
 * implementation honours is not a limit. The envelope holds the ceiling from
 * outside: a step at or past `maxSteps` is refused, and so is a new step once
 * `maxSteps` distinct ones have been seen -- which is what stops a plugin from
 * renumbering its way around the first rule.
 *
 * A plugin that declares no step at all is not step-bounded, because the
 * envelope sees tool calls and cannot infer model turns from them. That plugin
 * is still bounded by `maxToolCalls`, which needs nothing from the runtime.
 */
function stepIsWithinBudget(step: number, seen: ReadonlySet<number>, maxSteps: number): boolean {
  return step < maxSteps && (seen.has(step) || seen.size < maxSteps);
}

function parseRuntimeStep(step: number | undefined): number | undefined {
  if (step === undefined) {
    return undefined;
  }
  if (!Number.isInteger(step) || step < 0) {
    throw new TypeError("Runtime tool invocation step must be a non-negative integer");
  }
  return step;
}

function toolEventData(call: ToolCall, step: number | undefined): JsonObject {
  return {
    callId: call.id,
    tool: call.tool,
    ...(step === undefined ? {} : { step }),
  };
}

/**
 * What a completed call contributes to the durable event stream.
 *
 * The refusal code is included because a call the envelope terminated never
 * reaches the kernel and so never reaches audit: the event stream is the only
 * place it is recorded at all. Without the code, an execution record could say
 * that an envelope refusal happened but not whether it was a guess at an
 * unexposed tool or a blown call budget, and the distinction had to be taken on
 * trust from whatever the runtime chose to report about itself.
 *
 * Arguments, results, and payloads stay out, exactly as they do in audit.
 */
function completedToolEventData(result: ToolResult, step: number | undefined): JsonObject {
  return {
    callId: result.callId,
    status: result.status,
    tool: result.tool,
    ...(step === undefined ? {} : { step }),
    ...(result.status === "succeeded" ? {} : { code: result.error.code }),
  };
}

function assertRuntimeHostActive(active: boolean, signal: AbortSignal): void {
  if (!active || signal.aborted) {
    throw new Error("Runtime host is closed");
  }
}

/**
 * Whether a settled call is known to have done nothing.
 *
 * `denied` is a refusal made before the tool ran. `failed` is not read that
 * way: it covers a handler that threw part-way as well as arguments that never
 * reached one, and the result does not say which.
 */
function isRefusedBeforeEffect(result: unknown): boolean {
  const parsed = ToolResultSchema.safeParse(result);
  return parsed.success && parsed.data.status === "denied";
}

function contextAt(context: AccessContext, now: string): AccessContext {
  return { ...context, now };
}

function validateTurnContext(request: ExecutionRequest): ProtocolError | undefined {
  if (canonicalJson(request.context.actor) !== canonicalJson(request.agent)) {
    return protocolError("actor_mismatch", "Access actor does not match the executing agent.");
  }

  if (canonicalJson(request.message.receiver) !== canonicalJson(request.agent)) {
    return protocolError(
      "receiver_mismatch",
      "Message receiver does not match the executing agent.",
    );
  }

  if (
    request.message.traceId !== request.context.traceId ||
    request.message.purpose !== request.context.purpose
  ) {
    return protocolError(
      "message_context_mismatch",
      "Message trace or purpose does not match the access context.",
    );
  }

  return undefined;
}

function resultFor(
  request: ExecutionRequest,
  events: readonly ExecutionEvent[],
  startedAt: string,
  completedAt: string,
  status: "denied" | "failed" | "cancelled",
  error: ProtocolError,
  metadata: JsonObject,
): ExecutionResult {
  const base = {
    version: PROTOCOL_VERSION,
    executionId: request.executionId,
    traceId: request.context.traceId,
    events: [...events],
    startedAt,
    completedAt,
    metadata,
  };

  return { ...base, status, error };
}

function cancelledResult(
  request: ExecutionRequest,
  events: readonly ExecutionEvent[],
  startedAt: string,
  completedAt: string,
  metadata: JsonObject,
  retryable: boolean,
): ExecutionResult {
  return resultFor(
    request,
    events,
    startedAt,
    completedAt,
    "cancelled",
    protocolError("turn_cancelled", "The agent turn was cancelled.", retryable),
    metadata,
  );
}

/** The code a new tool call is refused under once the turn takes nothing new. */
export const TURN_DRAINING = "turn_draining";

/**
 * Whether a second run of the tool repeats nothing: a `read`, or a `write` its
 * definition declares `idempotent`. Conservative by the schema's own rule, which
 * makes `readWrite` required and refuses a `read` that is `destructive`.
 */
function isSafeToRepeat(definition: ToolDefinition): boolean {
  return definition.readWrite === "read" || definition.annotations?.idempotent === true;
}

/**
 * The envelope's refusal for a tool outside the permission-filtered catalogue.
 *
 * It carries `tool_unavailable`, the same code `SharedOSKernel` uses when the
 * tool is absent, sealed, or undiscoverable. The two boundaries refuse the same
 * attempt for the same reason, and emitting two codes for it made the
 * conformance matrix's declared signal depend on which boundary happened to get
 * there first. The boundary that refused is still distinguishable: it is
 * `OperationRecord.source`, which is where that distinction belongs.
 */
function unavailableToolResult(call: ToolCall, completedAt: string): ToolResult {
  return refusedToolResult(
    call,
    "denied",
    completedAt,
    "tool_unavailable",
    "The tool is not available in this permission-filtered turn.",
  );
}

/**
 * The code a terminal ending carried, where it had one.
 *
 * A cancelled turn may carry none -- the deadline path builds a result without
 * an error -- so it is named here rather than left absent, because "the turn
 * stopped" and "the turn stopped because it ran out of time" are different
 * facts and only the second is useful in a trail.
 */
function terminalReasonCode(result: ExecutionResult): string | undefined {
  switch (result.status) {
    case "denied":
    case "failed":
      return result.error.code;
    case "cancelled":
      return result.error?.code ?? "turn_cancelled";
    default:
      return undefined;
  }
}

/**
 * Whether the envelope refused the turn or the runtime reported its own failure.
 *
 * Read back from the event the envelope already emits rather than threaded
 * through every return, and it is the distinction a record reader needs before
 * crediting enforcement: a plugin that reports its own error is not the envelope
 * stopping it.
 *
 * Exported for that reader. Whoever assembles a record from a turn's events has
 * the same question, and a second loop over `turn.failed` would be a second
 * place to decide what the event means.
 */
export function terminalSource(
  events: readonly ExecutionEvent[],
): "envelope" | "runtime" | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "turn.failed" || typeof event.data !== "object" || event.data === null) {
      continue;
    }
    const source = (event.data as Record<string, unknown>)["source"];
    return source === "runtime" || source === "envelope" ? source : undefined;
  }
  return undefined;
}

function runtimeProvenance(manifest: RuntimeManifest): JsonObject {
  return {
    id: manifest.id,
    version: manifest.version,
    protocolVersion: manifest.protocolVersion,
  };
}

/** The metadata key the envelope writes its own provenance under. */
const RUNTIME_METADATA_KEY = "runtime";

/**
 * The turn's result metadata, in the one order it is ever built.
 *
 * The outcome's own metadata first, then what the plugin annotated, then the
 * envelope's provenance. Later wins: an annotation is the statement the
 * envelope holds for every ending, so it outranks a copy the plugin also put
 * on one particular outcome, and `runtime` is the envelope's alone -- which is
 * why `RuntimeHost.annotate` refuses that key rather than silently losing it
 * here.
 */
function runtimeResultMetadata(
  manifest: RuntimeManifest,
  outcome?: Pick<RuntimeTurnOutcome, "metadata">,
  annotations?: ReadonlyMap<string, JsonValue>,
): JsonObject {
  return {
    ...(outcome?.metadata ?? {}),
    ...(annotations === undefined ? {} : Object.fromEntries(annotations)),
    [RUNTIME_METADATA_KEY]: {
      ...runtimeProvenance(manifest),
      ...(manifest.metadata === undefined ? {} : { metadata: manifest.metadata }),
    },
  };
}

/** A structured clone, or `undefined` for a value that cannot be cloned at all. */
function cloneOrUndefined(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}
