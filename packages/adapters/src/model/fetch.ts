import type { Agent } from "undici";

type Fetch = typeof globalThis.fetch;

/**
 * The fetch a model call uses when the host passes none.
 *
 * Node's built-in fetch gives up after 300 s with no response headers, and
 * after 300 s with no body data. A model that thinks longer than that before
 * it answers would fail, and every retry would fail the same way. On Node a
 * model call therefore goes through undici's own fetch with both waits
 * switched off, so only the host's request timeout or the turn's deadline
 * ends it. Elsewhere the platform's fetch is used as it is.
 *
 * undici is imported on first use, not at the top of the module, so the
 * package's main entry still loads where there is no Node.
 */
export function modelFetch(): Promise<Fetch> {
  shared ??= isNode()
    ? undiciFetch({ headersTimeout: 0, bodyTimeout: 0 }).catch(() => platformFetch())
    : Promise.resolve(platformFetch());
  return shared;
}

let shared: Promise<Fetch> | undefined;

/** undici's fetch, sending every request through one agent built with `options`. */
export async function undiciFetch(options: Agent.Options): Promise<Fetch> {
  const undici = await import("undici");
  const dispatcher = new undici.Agent(options);
  // undici declares its own Request and Response types; at run time they are
  // the same Fetch API objects the DOM types describe.
  const fetch = undici.fetch as unknown as (
    input: Parameters<Fetch>[0],
    init: RequestInit & { dispatcher: Agent },
  ) => ReturnType<Fetch>;
  return (input, init) => fetch(input, { ...init, dispatcher });
}

function platformFetch(): Fetch {
  return globalThis.fetch.bind(globalThis);
}

function isNode(): boolean {
  return typeof process !== "undefined" && typeof process.versions?.node === "string";
}
