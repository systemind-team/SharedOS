import { JsonObjectSchema } from "@aicoo/sharedos-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelRequestError,
  OpenAiCompatibleModelClient,
  type ModelCompletionRequest,
  type OpenAiCompatibleModelClientOptions,
} from "./client.js";
import { parseToolArguments } from "../internal.js";

const REQUEST: ModelCompletionRequest = {
  messages: [
    { role: "system", content: "be brief" },
    { role: "user", content: "read the workspace" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace"]}' }],
    },
    { role: "tool", toolCallId: "call-1", content: '{"status":"succeeded"}' },
  ],
  tools: [
    { name: "files_read", description: "Read one authorized file", parameters: { type: "object" } },
  ],
};

/** A completion in the chat-completions wire shape, with everything the client reads. */
const COMPLETION = {
  id: "chatcmpl-1",
  model: "served-model",
  choices: [
    {
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call-2", type: "function", function: { name: "files_read", arguments: "{}" } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
};

function respond(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Fetch = typeof globalThis.fetch;

function client(
  fetch: Fetch,
  options: Partial<OpenAiCompatibleModelClientOptions> = {},
): OpenAiCompatibleModelClient {
  return new OpenAiCompatibleModelClient({
    apiKey: "secret-key",
    model: "requested-model",
    provider: "test-provider",
    baseUrl: "https://provider.example/v1/",
    fetch,
    ...options,
  });
}

function requestInit(fetch: ReturnType<typeof vi.fn<Fetch>>, call = 0): RequestInit {
  const init = fetch.mock.calls[call]?.[1];
  if (init === undefined) {
    throw new Error(`fetch was not called ${String(call + 1)} time(s)`);
  }
  return init;
}

const signal = (): AbortSignal => new AbortController().signal;

describe("the chat-completions client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("speaks the chat-completions wire shape to the configured endpoint", async () => {
    const fetch = vi.fn<Fetch>(async () => respond(COMPLETION));
    await client(fetch).complete(REQUEST, signal());

    expect(fetch).toHaveBeenCalledTimes(1);
    // One trailing slash on the base URL, none in the request: the root is
    // normalised so a host cannot produce `//chat/completions` by configuration.
    expect(fetch.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    const init = requestInit(fetch);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer secret-key",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "requested-model",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "read the workspace" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "files_read", arguments: '{"path":["Workspace"]}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: '{"status":"succeeded"}' },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "files_read",
            description: "Read one authorized file",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: "auto",
      max_completion_tokens: 4_096,
      temperature: 0,
    });
  });

  it("offers no tools field at all when there is nothing to offer", async () => {
    const fetch = vi.fn<Fetch>(async () => respond(COMPLETION));
    await client(fetch, { maxOutputTokens: 256, temperature: 0.5 }).complete(
      { messages: REQUEST.messages, tools: [] },
      signal(),
    );

    // An empty `tools` array is rejected by some providers; `tool_choice`
    // without tools by others. Neither is sent.
    const body = JSON.parse(requestInit(fetch).body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).toMatchObject({ max_completion_tokens: 256, temperature: 0.5 });
  });

  it("sends the thinking field only when asked, and reports it as a setting", async () => {
    const silent = vi.fn<Fetch>(async () => respond(COMPLETION));
    const untouched = client(silent);
    await untouched.complete(REQUEST, signal());
    // Not part of the OpenAI wire shape: a provider that does not know the
    // field rejects the request, so the default sends nothing and records
    // nothing.
    expect(JSON.parse(requestInit(silent).body as string)).not.toHaveProperty("thinking");
    expect(untouched.settings).toBeUndefined();

    const fetch = vi.fn<Fetch>(async () => respond(COMPLETION));
    const configured = client(fetch, { thinking: "disabled" });
    await configured.complete(REQUEST, signal());
    expect(JSON.parse(requestInit(fetch).body as string)).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(configured.settings).toEqual({ thinking: "disabled" });
  });

  it("sends reasoning_effort only when asked, and reports it as a setting", async () => {
    const silent = vi.fn<Fetch>(async () => respond(COMPLETION));
    const untouched = client(silent);
    await untouched.complete(REQUEST, signal());
    expect(JSON.parse(requestInit(silent).body as string)).not.toHaveProperty("reasoning_effort");
    expect(untouched.settings).toBeUndefined();

    // A vendor that reasons by default may refuse function tools on a chat
    // completion unless the effort is "none"; the host says so, and the
    // turn's record says the model ran that way.
    const fetch = vi.fn<Fetch>(async () => respond(COMPLETION));
    const configured = client(fetch, { reasoningEffort: "none", thinking: "disabled" });
    await configured.complete(REQUEST, signal());
    expect(JSON.parse(requestInit(fetch).body as string)).toMatchObject({
      reasoning_effort: "none",
      thinking: { type: "disabled" },
    });
    expect(configured.settings).toEqual({ thinking: "disabled", reasoning_effort: "none" });
  });

  it("reads the reply, the served model, the finish reason, and the usage", async () => {
    const fetch = vi.fn<Fetch>(async () => respond(COMPLETION));
    const reply = await client(fetch).complete(REQUEST, signal());

    expect(reply).toEqual({
      text: "",
      toolCalls: [{ id: "call-2", name: "files_read", arguments: "{}" }],
      model: "served-model",
      finishReason: "tool_calls",
      usage: { inputTokens: 40, outputTokens: 12 },
    });
  });

  it("reads a completion that reports neither a finish reason nor usage", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      respond({ choices: [{ message: { content: "all done" } }] }),
    );
    const reply = await client(fetch).complete(REQUEST, signal());

    // Absent, not invented. The driver treats an absent finish reason as the
    // provider having said nothing, which is different from `stop`.
    expect(reply).toEqual({ text: "all done", toolCalls: [] });
  });

  it("retries a rate limit once and takes the answer", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(respond("slow down", 429))
      .mockResolvedValueOnce(respond(COMPLETION));

    const pending = client(fetch).complete(REQUEST, signal());
    await vi.advanceTimersByTimeAsync(1_500);
    const reply = await pending;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reply.model).toBe("served-model");
  });

  it("retries a server error once and then gives up", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<Fetch>(async () => respond("upstream fell over", 503));

    const pending = client(fetch).complete(REQUEST, signal());
    // The rejection is observed before the clock moves, so an unhandled
    // rejection cannot fire between the second attempt and the assertion.
    const outcome = pending.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_500);
    const error = await outcome;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect((error as ModelRequestError).status).toBe(503);
  });

  it("does not retry a client error, because the same question gets the same answer", async () => {
    const fetch = vi.fn<Fetch>(async () => respond("bad request", 400));

    await expect(client(fetch).complete(REQUEST, signal())).rejects.toMatchObject({
      name: "ModelRequestError",
      status: 400,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces the status and never the provider's body", async () => {
    // A provider error can quote the request back, and the request carries the
    // turn's prompt and arguments. The status is what a caller can act on.
    const fetch = vi.fn<Fetch>(async () =>
      respond('{"error":"you sent: SECRET PROMPT CONTENTS"}', 400),
    );

    const error = await client(fetch)
      .complete(REQUEST, signal())
      .then(
        () => undefined,
        (thrown: unknown) => thrown as Error,
      );

    expect(error?.message).toBe("the model provider answered 400");
    expect(error?.message).not.toContain("SECRET");
  });

  it("refuses a completion it cannot read rather than casting it", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<Fetch>(async () => respond({ choices: [] }));

    const pending = client(fetch).complete(REQUEST, signal());
    const outcome = pending.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_500);
    const error = await outcome;

    // Unreadable is retried once like any statusless failure -- a provider's
    // bad moment -- and then refused as its own error, not as a parse crash.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect((error as Error).message).toBe("the model provider returned an unreadable completion");
  });

  it("ends a hung request at its own deadline, independently of the turn's", async () => {
    // A fetch that answers only once its signal fires. The per-request deadline
    // is what fires it: the turn's signal is never aborted here.
    const fetch = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((resolve) => {
          init?.signal?.addEventListener("abort", () => resolve(respond(COMPLETION)));
        }),
    );
    const turn = new AbortController();

    await client(fetch, { requestTimeoutMs: 10 }).complete(REQUEST, turn.signal);

    const sent = requestInit(fetch).signal;
    expect(sent?.aborted).toBe(true);
    expect((sent?.reason as Error).name).toBe("TimeoutError");
    expect(turn.signal.aborted).toBe(false);
  });

  it("lets the turn's abort win over a pending retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<Fetch>(async () => respond("slow down", 429));
    const turn = new AbortController();

    const pending = client(fetch).complete(REQUEST, turn.signal);
    const outcome = pending.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    turn.abort(new Error("turn closed"));
    const error = await outcome;

    // Aborted mid-delay: the retry never happens, and the abort reason is
    // rethrown as-is rather than wrapped as a model failure.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toBe("turn closed");
    expect(error).not.toBeInstanceOf(ModelRequestError);
  });

  it("refuses to be built without a key", () => {
    expect(() => client(vi.fn<Fetch>(), { apiKey: "  " })).toThrow(/API key/u);
  });
});

describe("tool argument parsing", () => {
  it("reads an object, and treats an empty blob as no arguments", () => {
    expect(parseToolArguments('{"path":["Workspace"]}')).toEqual({ path: ["Workspace"] });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("   ")).toEqual({});
  });

  it("returns undefined for anything that is not a JSON object", () => {
    expect(parseToolArguments("not json")).toBeUndefined();
    expect(parseToolArguments("[1, 2]")).toBeUndefined();
    expect(parseToolArguments('"a string"')).toBeUndefined();
    expect(parseToolArguments("null")).toBeUndefined();
  });

  it("refuses a number literal that overflowed to an infinity, at any depth", () => {
    expect(parseToolArguments('{"n":1e999}')).toBeUndefined();
    expect(parseToolArguments('{"n":-1e999}')).toBeUndefined();
    expect(parseToolArguments('{"a":{"b":[1,{"c":1e999}]}}')).toBeUndefined();
    expect(parseToolArguments('{"n":1.5e308,"z":-0}')).toEqual({ n: 1.5e308, z: -0 });
  });

  it("drops a __proto__ key at every depth, as the schema does, and keeps the rest in order", () => {
    const top = parseToolArguments('{"__proto__":{"polluted":true},"path":"x","n":1}');
    expect(top).toEqual({ path: "x", n: 1 });
    expect(Object.getOwnPropertyNames(top)).toEqual(["path", "n"]);
    expect(Object.getPrototypeOf(top)).toBe(Object.prototype);

    const nested = parseToolArguments(
      '{"a":{"b":1,"__proto__":2,"c":3},"d":[{"__proto__":4,"e":5}]}',
    );
    expect(nested).toEqual({ a: { b: 1, c: 3 }, d: [{ e: 5 }] });
    expect(Object.getOwnPropertyNames((nested as { a: object }).a)).toEqual(["b", "c"]);
    expect(Object.getOwnPropertyNames((nested as { d: object[] }).d[0])).toEqual(["e"]);
  });

  it("gives the verdict and the value JsonObjectSchema gives, blob for blob", () => {
    const blobs = [
      '{"path":["Workspace"]}',
      "1",
      "true",
      "[]",
      "{}",
      '{"":""}',
      '{"a":null,"b":[],"c":{}}',
      '{"a":1,"a":2}',
      '{"1":"x","b":"y","0":"z"}',
      '{"constructor":1,"toString":2,"hasOwnProperty":3}',
      '{"n":1e999}',
      '{"a":[[[{"n":-1e999}]]]}',
      '{"__proto__":1}',
      '{"__proto__":1e999}',
      '{"a":{"__proto__":{"__proto__":1},"b":[{"__proto__":2}]}}',
      `{"deep":${"[".repeat(64)}1${"]".repeat(64)}}`,
      `{"path":["Workspace","src","index.ts"],"content":"${"x".repeat(4096)}"}`,
    ];
    const ownNames = (value: unknown): unknown =>
      value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.getOwnPropertyNames(value).map((key) => [
              key,
              ownNames((value as Record<string, unknown>)[key]),
            ]),
          )
        : value;
    for (const blob of blobs) {
      const expected = JsonObjectSchema.safeParse(JSON.parse(blob));
      const actual = parseToolArguments(blob);
      expect(actual === undefined, blob).toBe(!expected.success);
      if (expected.success) {
        expect(actual, blob).toEqual(expected.data);
        expect(ownNames(actual), blob).toEqual(ownNames(expected.data));
      }
    }
  });
});
