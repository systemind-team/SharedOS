import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleModelClient } from "./client.js";
import { modelFetch, undiciFetch } from "./fetch.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/**
 * A provider that waits `headersMs` before it answers, then `bodyMs` before the
 * body. `Infinity` means it never sends that part.
 */
async function slowProvider(headersMs: number, bodyMs: number, body: string): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    later(headersMs, () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      later(bodyMs, () => response.end(body));
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function later(ms: number, run: () => void): void {
  if (ms !== Infinity) setTimeout(run, ms);
}

describe("the fetch a model call uses by default", () => {
  // Node's own fetch waits 300 s for each, which is too long to show here, so
  // the agent's settings are shown to reach the request with a short wait
  // instead, and the default is shown to outlast it. The provider never sends
  // the part being waited for, so only the wait can end the request: undici
  // checks its waits about once a second, and a provider that answered after a
  // second would race it.
  it("hands the agent's wait limits to the request", async () => {
    const silentHeaders = await slowProvider(Infinity, 0, "{}");
    const short = await undiciFetch({ headersTimeout: 200 });
    await expect(short(silentHeaders)).rejects.toMatchObject({
      cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
    });

    const silentBody = await slowProvider(0, Infinity, "{}");
    const response = await (await undiciFetch({ bodyTimeout: 200 }))(silentBody);
    await expect(response.text()).rejects.toMatchObject({
      cause: { code: "UND_ERR_BODY_TIMEOUT" },
    });
  });

  it("waits as long as the provider takes, before the answer and inside it", async () => {
    const url = await slowProvider(1_000, 1_000, '{"ok":true}');
    const response = await (await modelFetch())(url);

    expect(await response.text()).toBe('{"ok":true}');
  });

  it("is what a client with no fetch of its own calls the provider with", async () => {
    const url = await slowProvider(
      300,
      300,
      JSON.stringify({ choices: [{ message: { content: "thought it through" } }] }),
    );
    const client = new OpenAiCompatibleModelClient({
      apiKey: "secret-key",
      model: "requested-model",
      provider: "test-provider",
      baseUrl: url,
    });

    const reply = await client.complete(
      { messages: [{ role: "user", content: "think" }], tools: [] },
      new AbortController().signal,
    );

    expect(reply).toEqual({ text: "thought it through", toolCalls: [] });
  });
});

describe("the fetch a model call uses by default on Bun", () => {
  // Bun's fetch gives up after 5 minutes without data, and Bun's stand-in for
  // undici ignores the agent. The tests run on Node, so Bun is stood in for by
  // the version it sets and a global fetch that records what it is handed.
  afterEach(() => {
    Reflect.deleteProperty(process.versions, "bun");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function onBun(): Promise<{
    fetch: typeof globalThis.fetch;
    calls: (RequestInit | undefined)[];
  }> {
    Object.defineProperty(process.versions, "bun", { value: "1.4.4", configurable: true });
    const calls: (RequestInit | undefined)[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      calls.push(init);
      return new Response("{}");
    });
    // modelFetch keeps the fetch it picked, so a fresh copy of the module picks again.
    vi.resetModules();
    const fresh = await import("./fetch.js");
    return { fetch: await fresh.modelFetch(), calls };
  }

  it("sends each request with Bun's idle wait switched off", async () => {
    const { fetch, calls } = await onBun();
    const signal = new AbortController().signal;

    await fetch("http://provider.test/chat/completions", { method: "POST", body: "{}", signal });

    expect(calls).toEqual([{ timeout: false, method: "POST", body: "{}", signal }]);
  });

  it("keeps a timeout the caller passes", async () => {
    const { fetch, calls } = await onBun();

    await fetch("http://provider.test/chat/completions", { timeout: 60_000 } as RequestInit);

    expect(calls).toEqual([{ timeout: 60_000 }]);
  });
});
