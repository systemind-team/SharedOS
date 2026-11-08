import type { JsonObject, ToolCall } from "@aicoo/sharedos-contracts";
import { hashJson } from "@aicoo/sharedos-core";
import {
  describeLimits,
  describeReach,
  escalationOffered,
  escalationRequest,
  type AgentTurnDecision,
  type RuntimeTurnRequest,
} from "@aicoo/sharedos-runtime";

import { defaultPrompt } from "./internal.js";

/**
 * What every seat here does the same way, stated once.
 *
 * Three things sit in the seat: a model behind the standard driver, a vendor's
 * wire format behind the evaluation driver, and a vendor CLI behind the MCP
 * runtime. They differ in who owns the loop and how a call arrives. They do not
 * differ in what the seat is told before the turn, in how the escalate
 * affordance is recognised, or in how a call the seat asked for becomes a
 * `ToolCall`, and those three live here.
 */

/** How a turn's message and reach become the two texts a seat is handed. */
export interface SeatTextOptions {
  /** Overrides how the turn message becomes the prompt. */
  readonly prompt?: (request: RuntimeTurnRequest) => string;
  /**
   * What the seat is told before the prompt: a model's system message, an MCP
   * server's initialize instructions, a harness's preamble.
   *
   * By default it is `request.context.reach` rendered by `describeReach`: where
   * this turn's tools may operate, with the authority left out. After it come
   * the limits the host set on the turn, rendered by `describeLimits` from
   * `request.options`, and nothing when it set none. The prompt carries the
   * task and this carries the environment the task runs in. A string is the
   * host's standing guidance, placed before the turn's reach so a seat that
   * shows its model one block reads the guidance before the map. A function
   * replaces the composition and says exactly what the seat is told;
   * returning `undefined` hands over no instructions at all.
   */
  readonly instructions?: string | ((request: RuntimeTurnRequest) => string | undefined);
}

/** What about the seat itself changes what it is told. */
export interface SeatKind {
  /**
   * Whether the seat is a harness reached over MCP rather than a seat in the
   * standard loop. Such a harness keeps its own loop and declares no step, so
   * `maxSteps` does not bound it and it is not told one. It also has tools of
   * its own, which no SharedOS budget counts, so its call budget is named as
   * calls to the server's tools.
   */
  readonly mcpServer: boolean;
}

/** The two texts a seat is handed, and their identity. */
export interface SeatText {
  readonly instructions: string | undefined;
  readonly prompt: string;
  readonly promptHash: string;
}

/**
 * Compose what the seat is about to be told, and hash it before it is told
 * anything.
 *
 * Taken here, ahead of the first request, the launch or the opening frame, so
 * the identity a record carries is the one the seat's first words were built
 * from and not a reconstruction, and so a turn cancelled at any later point
 * still says what it was asked.
 */
export async function seatText(
  options: SeatTextOptions,
  request: RuntimeTurnRequest,
  seat: SeatKind = { mcpServer: false },
): Promise<SeatText> {
  const instructions = turnInstructions(options.instructions, request, seat);
  const prompt = (options.prompt ?? defaultPrompt)(request);
  return { instructions, prompt, promptHash: await handedPromptHash(instructions, prompt) };
}

function turnInstructions(
  configured: SeatTextOptions["instructions"],
  request: RuntimeTurnRequest,
  seat: SeatKind,
): string | undefined {
  if (typeof configured === "function") {
    return configured(request);
  }
  const limits = describeLimits(
    seat.mcpServer ? { ...request.options, maxSteps: undefined } : request.options,
    { escalation: escalationOffered(request.tools), mcpServer: seat.mcpServer },
  );
  const environment = [
    describeReach(request.context.reach),
    ...(limits === undefined ? [] : [limits]),
  ];
  return [...(configured === undefined ? [] : [configured]), ...environment].join("\n\n");
}

/**
 * What a runtime handed the seat as text before the turn began, as one identity.
 *
 * `instructions` is what the seat is told about where it is and `prompt` is the
 * task. Hashed together, in one shape, by every seat, so the same words carry
 * the same hash whichever seat heard them, and two runs of one column can be
 * checked to have told the seat the same thing before a moved cell is credited
 * to the model. A reworded prompt is a different question, and the record is
 * where that has to be visible: the catalogue already carries a hash for the
 * same reason, and the prompt is the other thing the model reads.
 *
 * It covers what SharedOS said, and only that. A CLI's own system prompt is
 * added on the far side of the wire and never seen here, so it is not claimed.
 */
export async function handedPromptHash(
  instructions: string | undefined,
  prompt: string,
): Promise<string> {
  return hashJson({ instructions: instructions ?? null, prompt });
}

/**
 * The step to declare for the nth call a driver releases this turn, if any.
 *
 * `undefined`, the default for every call, leaves the step to the loop, which
 * is what a driver asking for one call at a time should do. It exists for the
 * one thing a driver cannot otherwise express: reaching past its own budget.
 * The loop's index stops at `maxSteps`, so a call at or past the ceiling can
 * only be made by a driver that names the step itself. Supplying this makes the
 * driver the attacker for that call, which is a different claim from the seat
 * choosing it, and a column that uses it should say so.
 */
export type DeclareStep = (index: number, request: RuntimeTurnRequest) => number | undefined;

/**
 * One turn's reading of what its seat asks for.
 *
 * ## The catalogue gates the name
 *
 * The escalate affordance is published in the catalogue like any other tool
 * and is permission-filtered like one, but it never becomes an operation:
 * there is nothing for the kernel to authorize, because the seat is saying the
 * turn is over and a human has to decide. It is recognised by name, so an
 * escalation is a tool the seat chose rather than a phrase read out of its
 * prose, and only when this turn's catalogue offers it.
 *
 * That condition is load-bearing. Ending the turn on the name skips the
 * envelope, and with it the envelope's check that the tool was published to
 * this agent. So the catalogue is read first: a seat that names the affordance
 * without holding it (a hallucinated tool, one remembered from another turn, a
 * harness that guessed) has its call passed through to be refused
 * `tool_unavailable` like any other unpublished name. Anything less would hand
 * every seat a channel to the owner that no host granted, on the strength of a
 * string.
 */
export class SeatCalls {
  readonly #request: RuntimeTurnRequest;
  readonly #declareStep: DeclareStep | undefined;
  readonly #offered: boolean;
  /** Calls released to the loop this turn, which is what a step policy indexes. */
  #released = 0;

  constructor(request: RuntimeTurnRequest, declareStep?: DeclareStep) {
    this.#request = request;
    this.#declareStep = declareStep;
    this.#offered = escalationOffered(request.tools);
  }

  /** Whether this turn's catalogue offers the escalate affordance at all. */
  get escalationOffered(): boolean {
    return this.#offered;
  }

  /** The reason, when this call is the escalate affordance and the turn holds it. */
  escalation(tool: string, arguments_: JsonObject | undefined): string | undefined {
    return askedToEscalate(this.#offered, tool, arguments_);
  }

  /** A call the seat asked for, as the decision a driver hands the loop. */
  release(call: ToolCall): AgentTurnDecision {
    const index = this.#released;
    this.#released += 1;
    const step = this.#declareStep?.(index, this.#request);
    return { type: "tool_call", call, ...(step === undefined ? {} : { step }) };
  }

  /** A call in the seat's words, stamped with the turn's trace and instant. */
  toolCall(id: string, tool: string, arguments_: JsonObject): ToolCall {
    return seatToolCall(this.#request.context, id, tool, arguments_);
  }
}

/** The rule {@link SeatCalls} states, for a caller that holds `offered` itself. */
export function askedToEscalate(
  offered: boolean,
  tool: string,
  arguments_: JsonObject | undefined,
): string | undefined {
  return offered ? escalationRequest(tool, arguments_) : undefined;
}

export function seatToolCall(
  context: { readonly traceId: string; readonly now: string },
  id: string,
  tool: string,
  arguments_: JsonObject,
): ToolCall {
  return { id, tool, arguments: arguments_, traceId: context.traceId, requestedAt: context.now };
}

/**
 * What a seat states about its turn, on the turn's result metadata.
 *
 * One vocabulary for every seat here, so a reader of `ExecutionResult.metadata`
 * finds the same fact under the same key whichever seat ran. A seat states the
 * keys that apply to it and leaves the rest absent; an absent key is "not
 * stated", never zero. The envelope adds its own beside these (`runtime`,
 * `promptHash`, `escalationAsked`).
 *
 * The conformance record lifts `model`, `modelProvider`, `catalogHash`, the
 * token counts and `callsAfterEscalation`. The rest are for the host that ran
 * the turn.
 */
export type SeatMetadata = {
  /**
   * The model behind the seat. The standard driver states the one the provider
   * served, because a provider may substitute; the MCP harness runtime states
   * the one the run declared, because a vendor CLI selects its own model and
   * SharedOS cannot confirm which answered.
   */
  readonly model?: string;
  /** Who served it (standard driver), or who the run declared (MCP harness runtime). */
  readonly modelProvider?: string;
  /** The model the standard driver asked for, when the served one may differ. */
  readonly requestedModel?: string;
  /** The sampling settings the model client was configured with. */
  readonly modelSettings?: JsonObject;
  /** Why the last reply ended, in the provider's words. */
  readonly finishReason?: string;
  /** Summed over every model call this turn; absent until a reply reports one. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /**
   * Calls the standard driver refused in place because their arguments were not
   * a JSON object. None of them reached the envelope, so no operation shows them.
   */
  readonly malformedToolCalls?: number;
  /** The vendor harness that ran, by its id. */
  readonly harness?: string;
  /** How the harness reached the catalogue. */
  readonly toolshare?: "mcp";
  /** The MCP server name the harness namespaced its aliases under. */
  readonly mcpServer?: string;
  /** The catalogue the harness was served, so a run can prove which tool set it received. */
  readonly catalogHash?: string;
  /** Names the harness rewrote, for reading its transcript back; never an authorization input. */
  readonly toolAliases?: { readonly alias: string; readonly tool: string }[];
  /**
   * On a turn that ended `escalated` over MCP: how the harness itself ended.
   * "The CLI reported success after asking" and "the CLI crashed after asking"
   * are different runs.
   */
  readonly harnessOutcome?: "complete" | "fail" | "escalate";
  /** With `harnessOutcome: "fail"`, the code the harness failed under. */
  readonly harnessErrorCode?: string;
  /**
   * On a turn that ended `escalated` over MCP: calls the harness made after its
   * ask. Each was answered `escalation_pending` and reached neither the
   * envelope nor the kernel, so this is the only place they can be read.
   */
  readonly callsAfterEscalation?: number;
};
