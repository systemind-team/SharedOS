import {
  JsonObjectSchema,
  JsonValueSchema,
  PROTOCOL_VERSION,
  SHAREDOS_VERSION,
  ProtocolErrorSchema,
  ToolCallSchema,
  type ExecutionResult,
  type JsonObject,
  type JsonValue,
  type ProtocolError,
  type RuntimeManifest,
  type RuntimeTurnOutcome,
  type ToolCall,
  type ToolResult,
} from "@aicoo/sharedos-contracts";

import { deepFreeze, protocolError, raceAbort } from "@aicoo/sharedos-core/internal";

import { createAbortController } from "./internal.js";
import {
  ESCALATION_ASKED_ANNOTATION,
  escalationAskedAnnotation,
  escalationReason,
} from "./escalation.js";
import {
  PROMPT_HASH_ANNOTATION,
  reportTurnError,
  type RuntimeHost,
  type RuntimePlugin,
  type RuntimeTurnRequest,
  type TurnErrorReporter,
} from "./runtime-plugin.js";

export type AgentTurnInput =
  { readonly type: "start" } | { readonly type: "tool_result"; readonly result: ToolResult };

export type AgentTurnDecision =
  | {
      readonly type: "tool_call";
      readonly call: ToolCall;
      /**
       * The step this call is made at, when the driver wants to say.
       *
       * The loop declares the position it is at, which is the right answer for
       * a driver that simply asks for one call per turn of the loop. It is the
       * wrong answer for a driver deliberately reaching past its budget: the
       * loop's own index can never exceed `maxSteps`, because the loop stops
       * there, so the envelope's step ceiling was unreachable from inside this
       * runtime and every driven column reported the row as unavailable.
       *
       * Declaring it here makes the ceiling reachable and keeps it enforced:
       * the envelope refuses a call at or past `maxSteps` whoever named the
       * step, so a driver can claim a step it has no right to and be refused
       * for it. A driver that says nothing is bounded exactly as before.
       *
       * It reaches forward only. The loop knows where it is, and a declared
       * step behind that position is not a reach past the budget but a claim
       * the loop can see is false; it is refused as a malformed decision rather
       * than written into the record as the position the call was made at.
       */
      readonly step?: number;
    }
  | { readonly type: "complete"; readonly output: JsonValue; readonly metadata?: JsonObject }
  /**
   * `metadata` rides on a failure exactly as it does on a completion. A turn
   * that failed still ran: the model that answered, what it cost, and why it
   * stopped are facts about the turn rather than about its ending, and a record
   * that dropped them on failure would know least about the turns that most
   * need explaining.
   */
  | { readonly type: "fail"; readonly error: ProtocolError; readonly metadata?: JsonObject }
  /**
   * End the turn by asking a human to decide.
   *
   * `RuntimeTurnOutcome` has carried an escalate variant from the start, but
   * nothing running inside this loop could produce one: a driver could complete
   * or fail and that was all. Escalation was therefore reachable only by a
   * plugin that replaced the loop entirely, which is why every driven column
   * reported the escalation row as structurally unavailable -- a limit of this
   * type, not of any vendor.
   *
   * The reason is the driver's own words and is recorded verbatim, at any
   * length; one that is empty once trimmed has its decision refused (see
   * `escalationReason`). Nothing here advances the escalation: SharedOS records
   * that a decision was asked for and grants nothing while it is pending.
   */
  | { readonly type: "escalate"; readonly reason: string; readonly metadata?: JsonObject };

export interface AgentTurnSession {
  /**
   * What the session will tell the seat before its first decision, hashed.
   *
   * A driver that composes text for a model -- a system message, a prompt --
   * states the hash here, once, and nowhere else. The loop hands it to
   * `RuntimeHost.annotate` as soon as `open` has resolved and before the first
   * step, and the envelope writes it on the turn's result however the turn then
   * ends, which is what a cancelled turn needs: a session that never returns a
   * decision returns no metadata of its own, and the record would otherwise not
   * say what that turn was asked. The loop cannot state it earlier than `open`
   * returns, so a driver whose `open` itself sends the text should hash it
   * before sending; a turn cancelled inside `open` has no hash to record. A
   * driver that hands the seat no text leaves it absent.
   */
  readonly promptHash?: string;
  next(input: AgentTurnInput, signal: AbortSignal): Promise<AgentTurnDecision>;
  close?(outcome: ExecutionResult["status"], signal: AbortSignal): void | Promise<void>;
}

/**
 * What sits in the standard loop's driver slot.
 *
 * Model- or provider-specific code implements this port. The loop asks it what
 * to do next; it never reaches the envelope itself.
 */
export interface AgentTurnDriver {
  /**
   * Who this driver is, for the record.
   *
   * The executor stamps the plugin's manifest on every execution record, and
   * the loop is the same whichever driver is seated, so the loop reports the
   * seated driver's manifest as its own: evidence is filed under what produced
   * it. A driver that states none is reported as `sharedos.standard`.
   */
  readonly manifest?: RuntimeManifest;
  /**
   * Open the session one turn is driven through.
   *
   * A turn cancelled while this is in flight stops waiting for it. A session
   * handed back after that is still closed, with the turn's ending, so `close`
   * may be called on a session that was never asked for a decision. A driver
   * whose `open` rejects releases whatever it had taken itself: there is no
   * session to close.
   */
  open(request: RuntimeTurnRequest, signal: AbortSignal): Promise<AgentTurnSession>;
}

export interface StandardRuntimeOptions {
  /** The one driver this runtime seats. */
  driver: AgentTurnDriver;
  /**
   * How long closing a driver's session may take before the turn stops
   * waiting for it. Unset unless the host sets it, and unset is no limit.
   */
  closeTimeoutMs?: number;
  /**
   * Notification for a throw the loop contained rather than propagated.
   *
   * A driver that throws ends the turn `driver_failed`, which is a cooperative
   * outcome the envelope never sees as an exception -- so the executor's own
   * hook cannot report it and this one exists. Same contract; see
   * {@link TurnErrorReporter}.
   */
  onTurnError?: TurnErrorReporter;
}

export const STANDARD_RUNTIME_MANIFEST: RuntimeManifest = deepFreeze({
  id: "sharedos.standard",
  version: SHAREDOS_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  metadata: {
    package: "@aicoo/sharedos-runtime",
    executionModel: "bounded-driver-loop",
  },
});

/**
 * The SharedOS loop, with one driver seated.
 *
 * "Standard" names the SharedOS-owned default at each layer: this is the
 * default runtime, and a host may install another `RuntimePlugin` in its place.
 * The loop asks the seated driver what to do next, forwards every tool call to
 * the envelope, stops at `maxSteps` when the host set one, and asks nothing
 * more of the driver once the turn is draining. What differs between two uses
 * of it is only the driver, so the runtime reports the driver's manifest (see
 * {@link AgentTurnDriver.manifest}) and a record names what sat in the seat.
 *
 * The driver slot takes any {@link AgentTurnDriver}: a host's own, or
 * `StandardTurnDriver` from `@aicoo/sharedos-adapters`, which puts a model API
 * in the seat.
 */
export function createStandardRuntime(options: StandardRuntimeOptions): RuntimePlugin {
  return new StandardLoop(options);
}

class StandardLoop implements RuntimePlugin {
  readonly manifest: RuntimeManifest;
  readonly #driver: AgentTurnDriver;
  readonly #closeTimeoutMs: number | undefined;
  readonly #onTurnError: TurnErrorReporter | undefined;

  constructor(options: StandardRuntimeOptions) {
    this.#driver = options.driver;
    this.manifest = options.driver.manifest ?? STANDARD_RUNTIME_MANIFEST;
    this.#onTurnError = options.onTurnError;
    this.#closeTimeoutMs = options.closeTimeoutMs;
    if (
      this.#closeTimeoutMs !== undefined &&
      (!Number.isInteger(this.#closeTimeoutMs) || this.#closeTimeoutMs <= 0)
    ) {
      throw new TypeError("closeTimeoutMs must be a positive integer");
    }
  }

  async run(
    request: RuntimeTurnRequest,
    host: RuntimeHost,
    signal: AbortSignal,
  ): Promise<RuntimeTurnOutcome> {
    let session: AgentTurnSession | undefined;
    let opening: Promise<AgentTurnSession> | undefined;
    let closeOutcome: ExecutionResult["status"] = "failed";
    try {
      // The promise is kept as well as the session, because a turn cancelled
      // while this is still in flight never receives the session and would
      // leave whatever it holds open with nothing left to close it.
      opening = this.#driver.open(request, signal);
      session = await raceAbort(opening, signal);
      if (typeof session.promptHash === "string") {
        // After `open`, before the first step, so a turn that stalls in its
        // first request still records what it was asked.
        host.annotate(PROMPT_HASH_ANNOTATION, session.promptHash);
      }
      let nextInput: AgentTurnInput = { type: "start" };

      const maxSteps = host.limits.maxSteps ?? Number.POSITIVE_INFINITY;
      for (let step = 0; step < maxSteps; step += 1) {
        // Once the turn takes nothing new the seat is not asked again. A
        // decision already being made is left to land: one that ends the turn
        // is honoured below, and a tool call is refused by the envelope.
        host.draining?.throwIfAborted();
        const decisionCandidate: unknown = await raceAbort(session.next(nextInput, signal), signal);
        const decision = parseAgentTurnDecision(decisionCandidate);
        if (decision === undefined) {
          closeOutcome = "failed";
          return {
            type: "fail",
            error: protocolError(
              "invalid_driver_decision",
              "The agent turn driver returned an invalid decision.",
            ),
          };
        }

        if (decision.type === "complete") {
          closeOutcome = "succeeded";
          return decision;
        }
        if (decision.type === "fail") {
          closeOutcome = "failed";
          return decision;
        }
        if (decision.type === "escalate") {
          // Stated before it is honoured, so the record carries the ask
          // whatever the envelope then makes of the outcome.
          host.annotate(ESCALATION_ASKED_ANNOTATION, escalationAskedAnnotation(decision.reason));
          // Passed straight through, as `complete` and `fail` are. An escalated
          // turn is a terminal outcome the envelope records and audits; it is
          // not a failure, and reporting it as one would lose the distinction
          // between a turn that broke and a turn that asked.
          closeOutcome = "escalated";
          return decision;
        }

        // The driver's own step when it declared one, the loop's otherwise.
        // The envelope decides either way; naming a step is not being granted
        // it. A step behind the loop's own is refused here, because the loop
        // is the one party that knows it is false: the declaration exists to
        // reach past the budget, and a position already passed is not that.
        if (decision.step !== undefined && decision.step < step) {
          closeOutcome = "failed";
          return {
            type: "fail",
            error: protocolError(
              "invalid_driver_decision",
              "The agent turn driver declared a step behind the loop's own position.",
            ),
          };
        }
        const result = await host.invokeTool(decision.call, { step: decision.step ?? step });
        // A result that arrives once the turn is draining ends the loop here.
        // It is in the turn's events and the audit trail; the seat is not
        // asked about it, on the last step included.
        host.draining?.throwIfAborted();
        nextInput = { type: "tool_result", result };
      }

      closeOutcome = "failed";
      return {
        type: "fail",
        error: protocolError(
          "step_limit_exceeded",
          "The agent turn reached its maximum number of steps.",
        ),
      };
    } catch (error) {
      // A draining turn is ending on its deadline or on the envelope's own
      // decision, and what stopped the loop is that, not a driver that failed.
      if (signal.aborted || host.draining?.aborted === true) {
        closeOutcome = "cancelled";
        throw error;
      }
      closeOutcome = "failed";
      // `driver_failed` is the whole of what the turn is told, and it says a
      // driver stopped rather than why. The error goes to the host's own sink
      // and no further -- the outcome below is unchanged, and a thrown message
      // may carry anything the driver had in scope.
      reportTurnError(this.#onTurnError, error, {
        executionId: request.executionId,
        traceId: request.context.traceId,
      });
      return {
        type: "fail",
        error: protocolError("driver_failed", "The agent turn driver failed.", true),
      };
    } finally {
      if (session === undefined && opening !== undefined) {
        // The turn stopped waiting for `open`, which may still answer: a driver
        // need not honour its signal, and one that does can lose the race. The
        // session is closed when it arrives, under the same limit, and the turn
        // does not wait for it, since an `open` that never answers would then
        // hold a turn its deadline had already ended.
        const outcome = closeOutcome;
        const timeoutMs = this.#closeTimeoutMs;
        void opening.then((late) => closeSession(late, outcome, timeoutMs)).catch(() => undefined);
      }
      await closeSession(session, closeOutcome, this.#closeTimeoutMs);
    }
  }
}

function parseAgentTurnDecision(value: unknown): AgentTurnDecision | undefined {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === "tool_call" && hasOnlyKeys(candidate, ["type", "call", "step"])) {
    const call = ToolCallSchema.safeParse(candidate.call);
    if (!call.success) {
      return undefined;
    }
    if (candidate.step === undefined) {
      return { type: "tool_call", call: call.data };
    }
    // A declared step is a position, so it is bounded the way the envelope's
    // own is. Anything else is a malformed decision rather than an audacious
    // one, and is refused here instead of reaching the envelope as a number it
    // cannot compare.
    if (
      typeof candidate.step !== "number" ||
      !Number.isInteger(candidate.step) ||
      candidate.step < 0
    ) {
      return undefined;
    }
    return { type: "tool_call", call: call.data, step: candidate.step };
  }

  if (candidate.type === "fail" && hasOnlyKeys(candidate, ["type", "error", "metadata"])) {
    const error = ProtocolErrorSchema.safeParse(candidate.error);
    const metadata =
      candidate.metadata === undefined
        ? { success: true as const, data: undefined }
        : JsonObjectSchema.safeParse(candidate.metadata);
    if (!error.success || !metadata.success) {
      return undefined;
    }
    return {
      type: "fail",
      error: error.data,
      ...(metadata.data === undefined ? {} : { metadata: metadata.data }),
    };
  }

  if (candidate.type === "escalate" && hasOnlyKeys(candidate, ["type", "reason", "metadata"])) {
    const reason = escalationReason(candidate.reason);
    const metadata =
      candidate.metadata === undefined
        ? { success: true as const, data: undefined }
        : JsonObjectSchema.safeParse(candidate.metadata);
    if (reason === undefined || !metadata.success) {
      return undefined;
    }
    return {
      type: "escalate",
      reason,
      ...(metadata.data === undefined ? {} : { metadata: metadata.data }),
    };
  }

  if (candidate.type === "complete" && hasOnlyKeys(candidate, ["type", "output", "metadata"])) {
    const output = JsonValueSchema.safeParse(candidate.output);
    const metadata =
      candidate.metadata === undefined
        ? { success: true as const, data: undefined }
        : JsonObjectSchema.safeParse(candidate.metadata);
    if (!output.success || !metadata.success) {
      return undefined;
    }

    return {
      type: "complete",
      output: output.data,
      ...(metadata.data === undefined ? {} : { metadata: metadata.data }),
    };
  }

  return undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

async function closeSession(
  session: AgentTurnSession | undefined,
  outcome: ExecutionResult["status"],
  timeoutMs: number | undefined,
): Promise<void> {
  if (session?.close === undefined) {
    return;
  }

  const abort = createAbortController(undefined, timeoutMs);
  try {
    await raceAbort(Promise.resolve(session.close(outcome, abort.signal)), abort.signal);
  } catch {
    // Closing a provider session must not replace the protocol result. It may
    // hang only when the host set no close timeout.
  } finally {
    abort.abort(new Error("session close finished"));
    abort.dispose();
  }
}
