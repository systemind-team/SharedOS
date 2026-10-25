import type { JsonObject } from "@aicoo/sharedos-contracts";

import { z } from "zod";

/**
 * One tool call a model asked for, exactly as it came off the wire.
 *
 * The name is the provider's alphabet, not SharedOS's, and the arguments are
 * still an unparsed string. Neither is normalised here: a client's job is to
 * carry what the model said, and deciding what an unparseable argument blob or
 * an unrecognised name means is a policy question that belongs to the driver.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/** A tool offered to the model, already rendered into the provider's alphabet. */
export interface ModelTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObject;
}

/**
 * One turn of conversation.
 *
 * `assistant` carries the tool calls the model asked for and `tool` carries one
 * result back, because a chat-completions provider requires the pair to appear
 * in that order and requires every call in an assistant message to be answered
 * before the next one is sent.
 */
export type ModelMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly ModelToolCall[];
    }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface ModelCompletionRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelTool[];
}

/** What a provider billed for one reply, when it said. */
export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** What the model answered with. */
export interface ModelReply {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  /**
   * Why generation stopped, in the provider's own vocabulary.
   *
   * `stop` and `tool_calls` are the model ending its reply; `length` is the
   * provider ending it at the output-token ceiling. Carried because the two are
   * different facts about the same reply: a completion that was cut off mid-way
   * looks, without this, exactly like a completion the model chose to end, and
   * a record whose purpose is honest attribution has to tell them apart.
   */
  readonly finishReason?: string;
  /** Absent when the provider reported no usage; never estimated. */
  readonly usage?: ModelUsage;
  /**
   * The model the provider says actually answered.
   *
   * Recorded separately from the one that was asked for because they differ:
   * DeepSeek maps an unrecognised name onto a default rather than rejecting it,
   * so a run configured for one model can be served by another. The record
   * should say what answered, which is the weaker claim and the honest one.
   */
  readonly model?: string;
}

/**
 * A model API in the SharedOS driver seat.
 *
 * Deliberately narrower than any provider SDK: one call, tools in, tool calls
 * out. Everything that decides whether a call is allowed to happen -- the
 * catalogue, the turn loop, per-call re-authorization, audit -- stays in the
 * execution envelope, so a second provider is a second implementation of this
 * interface and no new enforcement path.
 */
export interface ModelClient {
  /** The model this client was configured to ask for. */
  readonly model: string;
  /** The provider that serves it, recorded alongside the model on every turn. */
  readonly provider: string;
  /**
   * Settings this client sends that change what the model does, beyond naming
   * it -- a reasoning mode, say. Recorded on every turn beside the model so two
   * runs under one model name are not read as the same configuration when they
   * were not. Absent when the client sends nothing the provider would not
   * default to.
   */
  readonly settings?: JsonObject;
  complete(request: ModelCompletionRequest, signal: AbortSignal): Promise<ModelReply>;
}

/** A model call that did not produce an answer. Carries no response body. */
export class ModelRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelRequestError";
    if (status !== undefined) {
      this.status = status;
    }
  }
}

/**
 * The subset of a chat-completions response this driver reads.
 *
 * Parsed rather than cast. The response is remote input, and a driver that
 * trusted its shape would turn a provider's bad day into a kernel-looking
 * failure somewhere further in.
 */
const ChatCompletionSchema = z.object({
  model: z.string().min(1).optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                function: z.object({
                  name: z.string().min(1),
                  arguments: z.string(),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .nullish(),
});

/** The efforts OpenAI's `reasoning_effort` field names, least to most. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface OpenAiCompatibleModelClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Names the provider on every record this client's turns produce. */
  readonly provider: string;
  /** The chat-completions root, without a trailing slash. */
  readonly baseUrl: string;
  readonly maxOutputTokens?: number;
  /**
   * Left at zero by default, which reduces variation between runs but does not
   * remove it. This column is not deterministic and must not be described as if
   * it were: a temperature of zero is not a seed, and the same prompt can still
   * produce a different call sequence on a different day.
   */
  readonly temperature?: number;
  /** How long one model call may take, independently of the turn's own budget. */
  readonly requestTimeoutMs?: number;
  /**
   * Whether the model reasons before it answers, sent as DeepSeek's `thinking`
   * request field. Opt-in: the field is not part of the OpenAI wire shape, and
   * a provider that does not know it rejects the request, so nothing is sent
   * until a host asks. When set it is reported through {@link ModelClient.settings}
   * so the turn's record says which mode the model ran in.
   */
  readonly thinking?: "enabled" | "disabled";
  /**
   * How hard the model reasons before it answers, sent as OpenAI's
   * `reasoning_effort` request field. Opt-in like `thinking`: nothing is sent
   * until a host asks, since a provider that does not know the field rejects
   * the request. A host asks for `"none"` where a vendor refuses function
   * tools on a chat completion that reasons by default. When set it is
   * reported through {@link ModelClient.settings} beside `thinking`.
   */
  readonly reasoningEffort?: ReasoningEffort;
  /** Injected for tests, which must never reach a network. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Room for a tool-heavy turn. A reply that hits this ceiling is not a decision
 * the model finished making, and the driver fails the turn on it rather than
 * grading the cut as a choice; the ceiling is set so that a turn issuing
 * several calls with JSON arguments does not reach it in ordinary use.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
/**
 * One retry, on the failures that are worth retrying.
 *
 * A conformance run is dozens of turns and a single 429 would otherwise leave a
 * row reported `not exercised` -- indistinguishable, in the manifest, from a
 * model that chose not to make the call. Retrying a rate limit is recovering
 * evidence; retrying a 400 would only be asking the same wrong question twice.
 */
const RETRYABLE_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;

/**
 * A chat-completions client for any provider speaking the OpenAI wire shape.
 *
 * DeepSeek is the one this was built against, but nothing here is DeepSeek
 * specific: the endpoint, model, and provider label are all supplied, so
 * pointing the column at another compatible provider is configuration rather
 * than a second client.
 */
export class OpenAiCompatibleModelClient implements ModelClient {
  readonly model: string;
  readonly provider: string;
  readonly settings?: JsonObject;
  readonly #apiKey: string;
  readonly #thinking?: "enabled" | "disabled";
  readonly #reasoningEffort?: ReasoningEffort;
  readonly #baseUrl: string;
  readonly #maxOutputTokens: number;
  readonly #temperature: number;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAiCompatibleModelClientOptions) {
    if (options.apiKey.trim() === "") {
      throw new TypeError("A model client needs an API key");
    }
    this.model = options.model;
    this.provider = options.provider;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.#temperature = options.temperature ?? 0;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const settings: JsonObject = {};
    if (options.thinking !== undefined) {
      this.#thinking = options.thinking;
      settings["thinking"] = options.thinking;
    }
    if (options.reasoningEffort !== undefined) {
      this.#reasoningEffort = options.reasoningEffort;
      settings["reasoning_effort"] = options.reasoningEffort;
    }
    if (Object.keys(settings).length > 0) this.settings = settings;
  }

  async complete(request: ModelCompletionRequest, signal: AbortSignal): Promise<ModelReply> {
    const body = JSON.stringify({
      model: this.model,
      messages: request.messages.map(encodeModelMessage),
      ...(request.tools.length === 0
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: "auto",
          }),
      max_tokens: this.#maxOutputTokens,
      temperature: this.#temperature,
      ...(this.#thinking === undefined ? {} : { thinking: { type: this.#thinking } }),
      ...(this.#reasoningEffort === undefined ? {} : { reasoning_effort: this.#reasoningEffort }),
    });

    let lastError: ModelRequestError | undefined;
    for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.#request(body, signal);
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }
        const failure =
          error instanceof ModelRequestError
            ? error
            : new ModelRequestError(`the model call failed: ${describe(error)}`);
        if (attempt === RETRYABLE_ATTEMPTS || !isRetryable(failure)) {
          throw failure;
        }
        lastError = failure;
        await delay(RETRY_DELAY_MS, signal);
      }
    }

    throw lastError ?? new ModelRequestError("the model call failed");
  }

  async #request(body: string, signal: AbortSignal): Promise<ModelReply> {
    // Two deadlines, not one. The turn's signal ends the whole execution; this
    // one ends a single hung request so a stalled connection is a failed call
    // rather than a failed run.
    const deadline = AbortSignal.timeout(this.#requestTimeoutMs);
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#apiKey}`,
      },
      body,
      signal: AbortSignal.any([signal, deadline]),
    });

    if (!response.ok) {
      // The body is read and discarded rather than surfaced. A provider error
      // can quote the request back, and the request carries the turn's prompt
      // and arguments; the status is what a caller can act on anyway.
      await response.text().catch(() => "");
      throw new ModelRequestError(
        `the model provider answered ${String(response.status)}`,
        response.status,
      );
    }

    const reply = decodeChatCompletion(await response.json());
    if (reply === undefined) {
      throw new ModelRequestError("the model provider returned an unreadable completion");
    }
    return reply;
  }
}

/**
 * One chat-completions response body, read into what the driver needs of it.
 *
 * `undefined` is a body the schema refused, and the caller decides what that
 * means -- the client turns it into a request error. It is a function rather
 * than a method so the read can be measured on its own: this is the native
 * harness's frame parse, the counterpart of a vendor adapter's `interpret`, and
 * the bench charges it per call the way it charges the others.
 */
export function decodeChatCompletion(payload: unknown): ModelReply | undefined {
  const parsed = ChatCompletionSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }

  const [choice] = parsed.data.choices;
  const message = choice?.message;
  const usage = parsed.data.usage;
  return {
    text: message?.content ?? "",
    toolCalls: (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
    ...(typeof choice?.finish_reason === "string" ? { finishReason: choice.finish_reason } : {}),
    ...(usage === undefined || usage === null
      ? {}
      : {
          usage: {
            ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
            ...(usage.completion_tokens === undefined
              ? {}
              : { outputTokens: usage.completion_tokens }),
          },
        }),
  };
}

/** One message in the shape the provider's wire carries it. */
export function encodeModelMessage(message: ModelMessage): JsonObject {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls.length === 0
        ? {}
        : {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }),
    };
  }
  return { role: message.role, content: message.content };
}

function isRetryable(error: ModelRequestError): boolean {
  return error.status === undefined || error.status === 429 || error.status >= 500;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
