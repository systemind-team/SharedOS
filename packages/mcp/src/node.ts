import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

import {
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
  type JsonRpcResponse,
  jsonRpcError,
} from "./protocol.js";
import type { McpToolServer } from "./server.js";

/**
 * Node transports for the SharedOS MCP surface.
 *
 * Kept out of the package's main entry point so the protocol translation stays
 * host-neutral and testable without a socket. Both transports here are thin:
 * they frame bytes and hand whole JSON-RPC messages to {@link McpToolServer},
 * which is where every decision lives.
 */

export interface StdioMcpTransportOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly signal?: AbortSignal;
  /** Notified of a line that could not be handled at all. Diagnosis only. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Serve MCP over newline-delimited JSON on a stream pair.
 *
 * This is the transport for the case where SharedOS *is* the subprocess: a
 * harness spawns it, speaks MCP on its stdio, and the server dies when the
 * harness invocation ends. That lifetime is the attraction -- a turn-scoped
 * bridge and a process lifetime that already match need nothing to keep them in
 * step.
 *
 * Resolves when the input ends or the signal aborts.
 */
export async function serveMcpOverStdio(
  server: McpToolServer,
  options: StdioMcpTransportOptions,
): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }

  const lines = createInterface({ input: options.input });
  // A signal that is already aborted must not be served: close the input and
  // return at once rather than waiting for EOF.
  if (controller.signal.aborted) {
    lines.close();
    options.signal?.removeEventListener("abort", abort);
    return;
  }
  // Messages are answered in arrival order. MCP permits interleaving, but a
  // bridge that answered out of order would let a harness observe two calls
  // resolving against one turn in an order the audit trail does not show.
  let queue: Promise<void> = Promise.resolve();

  const write = (response: JsonRpcResponse): void => {
    options.output.write(`${JSON.stringify(response)}\n`);
  };

  lines.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "") {
      return;
    }
    queue = queue.then(async () => {
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch {
        write(jsonRpcError(null, JSON_RPC_PARSE_ERROR, "Message is not valid JSON."));
        return;
      }
      try {
        const response = await server.handle(message, controller.signal);
        if (response !== undefined) {
          write(response);
        }
      } catch (error) {
        options.onError?.(error);
      }
    });
  });

  await new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    lines.once("close", finish);
    controller.signal.addEventListener("abort", finish, { once: true });
    if (controller.signal.aborted) finish();
  });

  await queue;
  lines.close();
  options.signal?.removeEventListener("abort", abort);
}

export interface StreamableHttpMcpServerOptions {
  readonly server: McpToolServer;
  /** Defaults to `/mcp`, which is the path every harness config here emits. */
  readonly path?: string;
  /** Loopback only unless a host deliberately widens it. */
  readonly host?: string;
  /** 0 asks the OS for a free port, which is what a turn-scoped bridge wants. */
  readonly port?: number;
  /**
   * Validates the bearer token on each request.
   *
   * Absent for a loopback bridge whose port is known only to the subprocess it
   * was opened for. Supplied for a sandboxed or remote harness, where it is the
   * execution token that identifies the broker session -- see `token.ts`, and
   * note that the token identifies a session and never carries authority.
   */
  readonly authorize?: (token: string | undefined) => boolean | Promise<boolean>;
  readonly onError?: (error: unknown) => void;
}

export interface StreamableHttpMcpServer {
  readonly url: string;
  readonly port: number;
  readonly sessionId: string;
  close(): Promise<void>;
}

/**
 * Serve MCP over Streamable HTTP on loopback.
 *
 * This is the transport the emitted harness configurations point at, because it
 * is the one all three CLIs accept without a shim, and because a sandboxed
 * harness cannot be handed a stdio pair at all.
 *
 * Only the request path is implemented: a POST carries one message and receives
 * its answer. There is no server-initiated stream, so GET is refused rather than
 * left open. SharedOS has nothing to push -- a turn's catalogue is fixed for the
 * turn, which is precisely why `listChanged` is advertised false.
 */
export async function createStreamableHttpMcpServer(
  options: StreamableHttpMcpServerOptions,
): Promise<StreamableHttpMcpServer> {
  const path = options.path ?? "/mcp";
  const host = options.host ?? "127.0.0.1";
  const sessionId = crypto.randomUUID();
  const controller = new AbortController();

  const httpServer: Server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: "internal_error" }));
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== path) {
      response.writeHead(404).end();
      return;
    }

    if (options.authorize !== undefined && !(await options.authorize(bearerToken(request)))) {
      response
        .writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="sharedos"',
        })
        .end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // A session id from an earlier bridge must not be answered by this one.
    // Refusing with 404 is what tells a client to re-initialize rather than to
    // keep calling into a turn that has ended.
    const presented = header(request, "mcp-session-id");
    if (presented !== undefined && presented !== sessionId) {
      response.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: "unknown_session",
          message: "This SharedOS MCP session has closed with its turn.",
        }),
      );
      return;
    }

    if (request.method === "DELETE") {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== "POST") {
      response
        .writeHead(405, { allow: "POST, DELETE" })
        .end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const body = await readBody(request);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      writeJson(
        response,
        400,
        sessionId,
        jsonRpcError(null, JSON_RPC_PARSE_ERROR, "Invalid JSON."),
      );
      return;
    }

    const messages = Array.isArray(message) ? message : [message];
    if (messages.length === 0) {
      writeJson(
        response,
        400,
        sessionId,
        jsonRpcError(null, JSON_RPC_INVALID_REQUEST, "Empty JSON-RPC batch."),
      );
      return;
    }

    const responses: JsonRpcResponse[] = [];
    for (const entry of messages) {
      const answer = await options.server.handle(entry, controller.signal);
      if (answer !== undefined) {
        responses.push(answer);
      }
    }

    if (responses.length === 0) {
      // Notifications and responses only: accepted, with nothing to say back.
      response.writeHead(202, { "mcp-session-id": sessionId }).end();
      return;
    }

    if (acceptsEventStream(request)) {
      writeEventStream(response, sessionId, responses);
      return;
    }
    writeJson(response, 200, sessionId, Array.isArray(message) ? responses : responses[0]);
  }

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => {
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the SharedOS MCP server did not bind to a port"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    url: `http://${host}:${port}${path}`,
    port,
    sessionId,
    close: async () => {
      controller.abort(new Error("the SharedOS MCP bridge closed"));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
    },
  };
}

function bearerToken(request: IncomingMessage): string | undefined {
  const value = header(request, "authorization");
  return value !== undefined && value.toLowerCase().startsWith("bearer ")
    ? value.slice("bearer ".length).trim()
    : undefined;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function acceptsEventStream(request: IncomingMessage): boolean {
  return (header(request, "accept") ?? "").includes("text/event-stream");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(
  response: ServerResponse,
  status: number,
  sessionId: string,
  payload: unknown,
): void {
  response
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "mcp-session-id": sessionId,
    })
    .end(JSON.stringify(payload));
}

function writeEventStream(
  response: ServerResponse,
  sessionId: string,
  responses: readonly JsonRpcResponse[],
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "mcp-session-id": sessionId,
  });
  for (const entry of responses) {
    response.write(`event: message\ndata: ${JSON.stringify(entry)}\n\n`);
  }
  response.end();
}
