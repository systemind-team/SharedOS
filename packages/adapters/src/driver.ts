import type { RuntimeManifest } from "@aicoo/sharedos-contracts";
import {
  type AgentTurnDecision,
  type AgentTurnDriver,
  type AgentTurnInput,
  type RuntimeTurnRequest,
  type AgentTurnSession,
} from "@aicoo/sharedos-runtime";

import type {
  HarnessChannel,
  HarnessProtocol,
  HarnessStep,
  HarnessTransport,
  HarnessTurnRequest,
} from "./harness.js";
import { failed } from "./internal.js";
import { SeatCalls, seatText, type DeclareStep, type SeatTextOptions } from "./seat.js";

/**
 * `instructions` reaches the harness on `HarnessTurnRequest.instructions`, for
 * its transport to hand over with the prompt.
 */
export interface EvalHarnessDriverOptions extends SeatTextOptions {
  readonly manifest: RuntimeManifest;
  readonly protocol: HarnessProtocol;
  readonly transport: HarnessTransport;
  /**
   * Guard against a harness that streams unrelated frames without end. Unset
   * unless the host sets it, and unset is no limit.
   */
  readonly maxIgnoredFrames?: number;
  /** See {@link DeclareStep}. */
  readonly declareStep?: DeclareStep;
}

/**
 * One vendor's wire format, seated in the standard loop for evaluation.
 *
 * It puts SharedOS in the model provider's seat and speaks the vendor's
 * API-layer tool-call shape exactly, which is how a vendor's codec is graded
 * against the kernel: over a recorded transcript in the committed conformance
 * columns, or over a live CLI's stdio in `scripts/native-conformance.mjs`. It is
 * not how a vendor CLI runs in a product. No coding-agent CLI accepts a
 * host-supplied catalogue on its own protocol; `createMcpHarnessRuntime` is the
 * path for that. It is also the one driver that can name a step past its budget
 * (`declareStep`), which only an evaluation has a reason to do.
 *
 * A driver is only translation. The turn loop, the permission-filtered
 * catalogue, per-call re-authorization, and audit all belong to the SharedOS
 * execution envelope, which is why adding a harness requires no kernel change
 * and no second enforcement path.
 *
 * Tool calls are passed through exactly as the harness emitted them, including
 * names that are not in the catalogue. Filtering those here would be the
 * adapter quietly enforcing policy, and worse, it would erase the attempt: a
 * guess at an unexposed tool has to reach the envelope to be refused and
 * recorded.
 */
export class EvalHarnessDriver implements AgentTurnDriver {
  readonly manifest: RuntimeManifest;
  readonly #protocol: HarnessProtocol;
  readonly #transport: HarnessTransport;
  readonly #text: SeatTextOptions;
  readonly #maxIgnoredFrames: number | undefined;
  readonly #declareStep: EvalHarnessDriverOptions["declareStep"];

  constructor(options: EvalHarnessDriverOptions) {
    this.manifest = options.manifest;
    this.#protocol = options.protocol;
    this.#transport = options.transport;
    this.#text = {
      ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    };
    this.#maxIgnoredFrames = options.maxIgnoredFrames;
    this.#declareStep = options.declareStep;
    if (
      this.#maxIgnoredFrames !== undefined &&
      (!Number.isInteger(this.#maxIgnoredFrames) || this.#maxIgnoredFrames <= 0)
    ) {
      throw new TypeError("maxIgnoredFrames must be a positive integer");
    }
  }

  async open(request: RuntimeTurnRequest, signal: AbortSignal): Promise<AgentTurnSession> {
    // Hashed before the transport opens, which is where the harness is first
    // told anything.
    const text = await seatText(this.#text, request);
    const turn: HarnessTurnRequest = {
      executionId: request.executionId,
      prompt: text.prompt,
      ...(text.instructions === undefined ? {} : { instructions: text.instructions }),
      tools: this.#protocol.describeTools(request.tools),
      context: request.context,
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    };
    const channel = await this.#transport.open(turn, signal);
    return new HarnessSession(
      channel,
      this.#protocol,
      this.#maxIgnoredFrames,
      new SeatCalls(request, this.#declareStep),
      text.promptHash,
    );
  }
}

class HarnessSession implements AgentTurnSession {
  readonly #channel: HarnessChannel;
  readonly #protocol: HarnessProtocol;
  readonly #maxIgnoredFrames: number | undefined;
  /**
   * Steps a single frame produced but the turn has not consumed yet.
   *
   * A harness may ask for several tools in one frame. SharedOS re-authorizes
   * every call separately, so they are executed one at a time rather than
   * batched: the conservative order, and the one whose audit trail matches what
   * actually happened.
   */
  readonly #pending: HarnessStep[] = [];
  readonly #messages: string[] = [];
  readonly #calls: SeatCalls;
  /** What the harness was told before it answered, hashed; the loop states it. */
  readonly promptHash: string;

  constructor(
    channel: HarnessChannel,
    protocol: HarnessProtocol,
    maxIgnoredFrames: number | undefined,
    calls: SeatCalls,
    promptHash: string,
  ) {
    this.#channel = channel;
    this.#protocol = protocol;
    this.#maxIgnoredFrames = maxIgnoredFrames;
    this.#calls = calls;
    this.promptHash = promptHash;
  }

  async next(input: AgentTurnInput, signal: AbortSignal): Promise<AgentTurnDecision> {
    if (input.type === "tool_result") {
      await this.#channel.write(this.#protocol.encodeToolResult(input.result), signal);
    }

    const maxIgnoredFrames = this.#maxIgnoredFrames ?? Number.POSITIVE_INFINITY;
    for (let frames = 0; frames <= maxIgnoredFrames; frames += 1) {
      const decision = this.#drainPending();
      if (decision !== undefined) {
        return decision;
      }

      const frame = await this.#channel.read(signal);
      if (frame === undefined) {
        return failed(
          "harness_ended_without_outcome",
          "The harness stopped speaking without completing the turn.",
        );
      }
      this.#pending.push(...this.#protocol.interpret(frame));
    }

    return failed(
      "harness_frame_limit_exceeded",
      "The harness emitted too many frames without producing an outcome.",
    );
  }

  #drainPending(): AgentTurnDecision | undefined {
    while (this.#pending.length > 0) {
      const step = this.#pending.shift() as HarnessStep;
      if (step.type === "message") {
        this.#messages.push(step.text);
        continue;
      }
      if (step.type === "failed") {
        return { type: "fail", error: step.error };
      }
      if (step.type === "complete") {
        return {
          type: "complete",
          output: step.output ?? { text: this.#messages.join("\n") },
          ...(step.metadata === undefined ? {} : { metadata: step.metadata }),
        };
      }
      // The escalate affordance ends the turn here rather than becoming a
      // `ToolCall`, and only when the turn holds it; `SeatCalls` says why.
      const escalation = this.#calls.escalation(step.tool, step.arguments);
      if (escalation !== undefined) {
        return { type: "escalate", reason: escalation };
      }
      return this.#calls.release(this.#calls.toolCall(step.callId, step.tool, step.arguments));
    }
    return undefined;
  }

  async close(): Promise<void> {
    await this.#channel.close();
  }
}
