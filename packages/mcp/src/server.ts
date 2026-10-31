import type {
  JsonObject,
  JsonValue,
  PublishedToolDefinition,
  PublishedToolMetadata,
  SharedOSToolCatalog,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { isJsonObject, SHAREDOS_VERSION } from "@aicoo/sharedos-contracts";
import {
  SPAN,
  measure,
  portableToolName,
  type SpanScope,
  type SpanSink,
} from "@aicoo/sharedos-core";
import { compactObject } from "@aicoo/sharedos-core/internal";

import {
  CallToolParamsSchema,
  InitializeParamsSchema,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  type JsonRpcResponse,
  jsonRpcError,
  jsonRpcResult,
  negotiateProtocolVersion,
} from "./protocol.js";

/** One `tools/call`, after the exposed name has been mapped back to canonical. */
export interface McpToolInvocation {
  readonly callId: string;
  /** The canonical SharedOS tool name, or the raw one when it matched nothing. */
  readonly tool: string;
  readonly arguments: JsonObject;
  /** The name the harness actually sent, when it was not the canonical one. */
  readonly alias?: string;
}

/**
 * What the MCP surface is allowed to do, and the only thing it is allowed to do.
 *
 * Discovery and invocation, nothing else. There is no method here for reading
 * grants, resolving authority, or listing what a call *would* need: the server
 * is a projection and a doorway, and every question about authority is answered
 * on the other side of it.
 */
export interface McpToolInvoker {
  /** The permission-filtered catalogue for this session. */
  catalog(signal: AbortSignal): Promise<SharedOSToolCatalog>;
  /** One call, re-authorized against the arguments actually presented. */
  invoke(invocation: McpToolInvocation, signal: AbortSignal): Promise<ToolResult>;
}

export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpToolServerOptions {
  readonly invoker: McpToolInvoker;
  readonly serverInfo?: McpServerInfo;
  /** Guidance handed to the client at initialize time. */
  readonly instructions?: string;
  /** Mints the SharedOS call id for one `tools/call`. */
  readonly createId?: () => string;
  /**
   * Where the cost of answering one frame is reported.
   *
   * This is the span that bounds enforcement over the toolshare path: it opens
   * when a frame arrives here and closes when the response leaves, so the
   * model's own thinking time is outside it by construction rather than by
   * subtraction. What is also outside it, and cannot be brought in, is the
   * vendor CLI's own tool router -- that code runs before a frame reaches this
   * server and SharedOS never sees it.
   */
  readonly spans?: SpanSink;
}

export const SHAREDOS_MCP_SERVER_NAME = "sharedos";

/**
 * What a server built without `serverInfo` reports in `initialize`. The version
 * names the build a harness connected to, so it is `SHAREDOS_VERSION`.
 */
const DEFAULT_SERVER_INFO: McpServerInfo = Object.freeze({
  name: SHAREDOS_MCP_SERVER_NAME,
  version: SHAREDOS_VERSION,
});

/**
 * SharedOS's catalogue and authorization broker, spoken as MCP.
 *
 * The server is transport-agnostic on purpose: it turns one JSON-RPC message
 * into one JSON-RPC response, and knows nothing about stdio, HTTP, sessions, or
 * processes. That is what lets the same translation be exercised deterministically
 * in a unit test and then serve a live CLI without changing the code under test.
 *
 * It holds no policy. Every `tools/call` is handed to the invoker, which puts it
 * through `RuntimeHost.invokeTool` and the kernel; the server never decides that
 * a call should be refused, and never decides that one should be allowed. Its
 * one substantive job is translation, and the translation rule that matters is
 * that a SharedOS refusal is a *tool result*, never a transport error --
 * see {@link toCallToolResult}.
 */
export class McpToolServer {
  readonly #invoker: McpToolInvoker;
  readonly #serverInfo: McpServerInfo;
  readonly #instructions: string | undefined;
  readonly #createId: () => string;
  readonly #spans: SpanSink | undefined;
  #initialized = false;
  #negotiatedVersion: string | undefined;

  constructor(options: McpToolServerOptions) {
    this.#invoker = options.invoker;
    this.#serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
    this.#instructions = options.instructions;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#spans = options.spans;
  }

  /** The revision agreed with this client, once `initialize` has been answered. */
  get protocolVersion(): string | undefined {
    return this.#negotiatedVersion;
  }

  get initialized(): boolean {
    return this.#initialized;
  }

  /**
   * Handle one JSON-RPC message.
   *
   * Returns `undefined` for a notification, which is what JSON-RPC requires: a
   * notification has no id and therefore no addressable reply, including when it
   * is malformed.
   */
  async handle(message: unknown, signal: AbortSignal): Promise<JsonRpcResponse | undefined> {
    return measure(this.#spans, SPAN.MCP_HANDLE, (span) => this.#handle(message, signal, span));
  }

  async #handle(
    message: unknown,
    signal: AbortSignal,
    span: SpanScope,
  ): Promise<JsonRpcResponse | undefined> {
    const request = JsonRpcRequestSchema.safeParse(message);
    if (!request.success) {
      const notification = JsonRpcNotificationSchema.safeParse(message);
      if (notification.success) {
        this.#handleNotification(notification.data.method);
        return undefined;
      }
      return jsonRpcError(
        idOf(message),
        idOf(message) === null ? JSON_RPC_PARSE_ERROR : JSON_RPC_INVALID_REQUEST,
        "Message is not a JSON-RPC 2.0 request or notification.",
      );
    }

    const { id, method, params } = request.data;
    span.set("method", method);

    try {
      switch (method) {
        case "initialize":
          return jsonRpcResult(id, this.#initialize(params));
        case "ping":
          return jsonRpcResult(id, {});
        case "tools/list":
          return jsonRpcResult(id, await this.#listTools(signal));
        case "tools/call":
          return await this.#callTool(id, params, signal, span);
        default:
          return jsonRpcError(
            id,
            JSON_RPC_METHOD_NOT_FOUND,
            `SharedOS exposes tool discovery and invocation only; ${method} is not implemented.`,
          );
      }
    } catch (error) {
      if (signal.aborted) {
        // A cancelled turn aborts the request. It is not a protocol fault and
        // must not be reported to the harness as one.
        throw error;
      }
      return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, "SharedOS could not answer this request.");
    }
  }

  #handleNotification(method: string): void {
    if (method === "notifications/initialized") {
      this.#initialized = true;
    }
  }

  #initialize(params: unknown): JsonObject {
    const parsed = InitializeParamsSchema.safeParse(params ?? {});
    const version = negotiateProtocolVersion(
      parsed.success ? parsed.data.protocolVersion : undefined,
    );
    this.#negotiatedVersion = version;

    return {
      protocolVersion: version,
      // `listChanged` is false and stated rather than omitted. A SharedOS
      // catalogue is resolved once per turn and cannot change underneath a
      // running harness, so a client that polls for changes would be waiting on
      // a notification this server will never have cause to send.
      capabilities: { tools: { listChanged: false } },
      serverInfo: { ...this.#serverInfo },
      ...(this.#instructions === undefined ? {} : { instructions: this.#instructions }),
    };
  }

  async #listTools(signal: AbortSignal): Promise<JsonObject> {
    const catalog = await this.#invoker.catalog(signal);
    return {
      tools: catalog.tools.map((tool) => toMcpTool(tool)),
      // The catalogue is served whole. Paginating it would let a harness see a
      // prefix and act on it, and a partially discovered catalogue is exactly
      // the stale-discovery failure `catalogHash` exists to catch.
      _meta: {
        "sharedos/catalogHash": catalog.catalogHash,
        "sharedos/executionId": catalog.executionId,
      },
    };
  }

  async #callTool(
    id: string | number,
    params: unknown,
    signal: AbortSignal,
    span: SpanScope,
  ): Promise<JsonRpcResponse> {
    const parsed = CallToolParamsSchema.safeParse(params);
    if (!parsed.success) {
      return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, "tools/call requires a tool name.");
    }

    const catalog = await this.#invoker.catalog(signal);
    const resolved = resolveCanonicalName(catalog.tools, parsed.data.name);
    const invocation: McpToolInvocation = {
      callId: this.#createId(),
      tool: resolved,
      arguments: (parsed.data.arguments ?? {}) as JsonObject,
      ...(resolved === parsed.data.name ? {} : { alias: parsed.data.name }),
    };

    // The call id goes on the span, not just into the invocation. Every span
    // this call produces -- here, in the envelope, in the kernel, around the
    // provider -- carries the same id, which is what lets a report take the
    // provider's own time back out of the transport figure.
    span.set("callId", invocation.callId);
    span.set("tool", invocation.tool);

    const result = await this.#invoker.invoke(invocation, signal);
    span.set("outcome", result.status);
    const published = catalog.tools.find((tool) => tool.name === resolved);
    return jsonRpcResult(id, toCallToolResult(result, published));
  }
}

/** One published tool in MCP's own shape. */
export function toMcpTool(tool: PublishedToolDefinition): JsonObject {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: compactObject(tool.annotations) }),
    ...(tool.metadata === undefined ? {} : { _meta: sharedOsMeta(tool.metadata) }),
  };
}

function sharedOsMeta(metadata: PublishedToolMetadata): JsonObject {
  return compactObject({
    "sharedos/namespace": metadata.namespace,
    "sharedos/source": metadata.source,
  });
}

/**
 * Map an exposed name back to the canonical SharedOS tool ID.
 *
 * The canonical name is what SharedOS published, so an exact match is the
 * ordinary case. The portable form is accepted too, because a transport that
 * cannot carry a dot will have rewritten it, and refusing the rewrite would turn
 * a transport limitation into a permission failure.
 *
 * Anything else is returned unchanged rather than rejected here. A guess at a
 * tool that was never published has to reach the kernel to be refused and
 * recorded: resolving it to `undefined` in the adapter would erase the attempt,
 * and an attempted violation that leaves no trace is the one outcome this
 * boundary must not produce. Resolution can only ever select a tool already in
 * the permission-filtered catalogue, so it can never widen authority.
 */
export function resolveCanonicalName(
  tools: readonly PublishedToolDefinition[],
  exposed: string,
): string {
  if (tools.some((tool) => tool.name === exposed)) {
    return exposed;
  }

  const portableMatches = tools.filter((tool) => portableToolName(tool.name) === exposed);
  const only = portableMatches[0];
  return portableMatches.length === 1 && only !== undefined ? only.name : exposed;
}

/**
 * A SharedOS `ToolResult` as an MCP `CallToolResult`.
 *
 * The rule that matters: a refusal is a *tool* error, never a transport error.
 * A JSON-RPC error means the request could not be processed, and a harness that
 * receives one has no reason to believe anything about its authority -- most
 * retry, some abandon the turn. A denial is a processed request with an answer,
 * and the answer is "no". Reporting it as `isError: true` is what lets a harness
 * learn it was refused, tell the user, and carry on to its next call.
 *
 * `denied` and `failed` stay distinguishable in the payload. They mean different
 * things -- policy refused this, versus the tool broke -- and collapsing them
 * would make a denial rate uncountable from the evidence.
 */
export function toCallToolResult(
  result: ToolResult,
  published?: PublishedToolDefinition,
): JsonObject {
  if (result.status === "succeeded") {
    const structured =
      published?.outputSchema !== undefined && isJsonObject(result.output)
        ? { structuredContent: result.output }
        : {};
    return {
      content: [
        { type: "text", text: renderText(result.output) },
        ...imageContent(result.metadata?.["sharedos/content"]),
      ],
      ...structured,
      isError: false,
    };
  }

  const body: JsonObject = {
    status: result.status,
    code: result.error.code,
    message: result.error.message,
    ...(result.error.retryable === undefined ? {} : { retryable: result.error.retryable }),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    isError: true,
    _meta: { "sharedos/status": result.status, "sharedos/code": result.error.code },
  };
}

/** Optional, host-neutral presentation hints. Output remains the structured
 * result. Only bounded inline images are recognized: no URLs are fetched and
 * arbitrary metadata cannot introduce executable or remote resources.
 */
function imageContent(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || value.length > 4) return [];
  const images: JsonObject[] = [];
  let bytes = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { type, data, mimeType } = raw as Record<string, unknown>;
    if (
      type !== "image" ||
      typeof data !== "string" ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(mimeType)) ||
      data.length === 0 ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      continue;
    bytes += data.length;
    if (bytes > 4 * 1024 * 1024) return [];
    images.push({ type: "image", data, mimeType: String(mimeType) });
  }
  return images;
}

function renderText(output: JsonValue): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}

function idOf(message: unknown): string | number | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}
