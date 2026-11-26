import {
  AccessContextSchema,
  PROTOCOL_VERSION,
  SHAREDOS_ROUTES,
  type AccessContext,
  type AuthorizationDecision,
  type CapabilityRequirement,
  type ExecutionResult,
  type MessageDeliveryResult,
  type MessageEnvelope,
  type ReachResult,
  type RemoteExecutionRequest,
  type ResourceOperation,
  type ResourceResult,
  type SharedOSApiErrorCode,
  type SharedOSHttpMethod,
  type SharedOSRouteName,
  type ToolCall,
  type ToolDefinition,
  type ToolNamespaceCatalog,
  type ToolNamespaceUpdate,
  type ToolResult,
  type WireSchema,
} from "@aicoo/sharedos-contracts";
import type { SharedOSKernel } from "@aicoo/sharedos-core";
import type { TurnExecutionPort } from "@aicoo/sharedos-runtime";

export interface SharedOSApiCallOptions {
  readonly signal?: AbortSignal;
}

export interface SharedOSApi {
  authorize(
    context: AccessContext,
    request: CapabilityRequirement,
    options?: SharedOSApiCallOptions,
  ): Promise<AuthorizationDecision>;
  listTools(
    context: AccessContext,
    options?: SharedOSApiCallOptions,
  ): Promise<readonly ToolDefinition[]>;
  reach(context: AccessContext, options?: SharedOSApiCallOptions): Promise<ReachResult>;
  listToolNamespaces(
    context: AccessContext,
    options?: SharedOSApiCallOptions,
  ): Promise<ToolNamespaceCatalog>;
  updateToolNamespaces(
    context: AccessContext,
    update: ToolNamespaceUpdate,
    options?: SharedOSApiCallOptions,
  ): Promise<ToolNamespaceCatalog>;
  invokeTool(
    context: AccessContext,
    call: ToolCall,
    options?: SharedOSApiCallOptions,
  ): Promise<ToolResult>;
  invokeResource(
    context: AccessContext,
    operation: ResourceOperation,
    options?: SharedOSApiCallOptions,
  ): Promise<ResourceResult>;
  sendMessage(
    context: AccessContext,
    envelope: MessageEnvelope,
    options?: SharedOSApiCallOptions,
  ): Promise<MessageDeliveryResult>;
  executeTurn(
    context: AccessContext,
    request: RemoteExecutionRequest,
    options?: SharedOSApiCallOptions,
  ): Promise<ExecutionResult>;
}

export interface KernelSharedOSApiOptions {
  kernel: SharedOSKernel;
  turns: TurnExecutionPort;
}

/** Builds the HTTP application surface from the same kernel used by embedded consumers. */
export function createKernelSharedOSApi(options: KernelSharedOSApiOptions): SharedOSApi {
  return {
    authorize: (context, requirement, callOptions) =>
      options.kernel.authorize(context, requirement, callOptions),
    listTools: (context, callOptions) => options.kernel.listTools(context, callOptions),
    reach: (context, callOptions) => options.kernel.reach(context, callOptions),
    listToolNamespaces: (context, callOptions) =>
      options.kernel.listToolNamespaces(context, callOptions),
    updateToolNamespaces: (context, update, callOptions) =>
      options.kernel.updateToolNamespaces(context, update, callOptions),
    invokeTool: (context, call, callOptions) =>
      options.kernel.invokeTool(context, call, callOptions),
    invokeResource: (context, operation, callOptions) =>
      options.kernel.invokeResource(
        context,
        {
          operationId: operation.operationId,
          resource: operation.resource,
          action: operation.action,
          ...(operation.input === undefined ? {} : { input: operation.input }),
          ...(operation.metadata === undefined ? {} : { metadata: operation.metadata }),
        },
        callOptions,
      ),
    sendMessage: (context, envelope, callOptions) =>
      options.kernel.sendMessage(context, envelope, callOptions),
    executeTurn: async (context, request, callOptions) => {
      // The catalogue is resolved inside the turn's authority lease by the
      // executor, so a transient failure to load authority ends the turn
      // closed instead of silently running it with no tools.
      return options.turns.execute(
        { ...request, context },
        callOptions?.signal === undefined ? {} : { signal: callOptions.signal },
      );
    },
  };
}

export interface SharedOSHttpOptions {
  api: SharedOSApi;
  resolveContext(request: Request): Promise<AccessContext>;
  onError?: (error: unknown, request: Request, requestId: string) => void | Promise<void>;
}

/**
 * A failure of the request as a request, answered with its status and one of
 * the handler's own codes. A host's `resolveContext` may throw one as well,
 * under a code of its own, which is why the type admits any string.
 *
 * The `(string & {})` widening is a design decision, not a typing shortcut.
 * It costs autocomplete on `code` and buys two things: a host's own codes
 * pass through unrenamed, and a client built against this release still
 * reads a code a later server adds. Narrowing it back to the union changes
 * what hosts and clients may rely on, so it needs an explicit sign-off of its
 * own rather than a procedural clean-up.
 */
export class SharedOSHttpError extends Error {
  readonly status: number;
  readonly code: SharedOSApiErrorCode | (string & {});

  constructor(status: number, code: SharedOSApiErrorCode | (string & {}), message: string) {
    super(message);
    this.name = "SharedOSHttpError";
    this.status = status;
    this.code = code;
  }
}

export function createSharedOSHandler(
  options: SharedOSHttpOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    try {
      return await routeRequest(options, request, requestId);
    } catch (error) {
      try {
        await options.onError?.(error, request, requestId);
      } catch {
        // Observability hooks must never replace the protocol error response.
      }
      return errorResponse(error, requestId);
    }
  };
}

/** The route table by path, then by verb: what the handler answers and with which operation. */
const ROUTES_BY_PATH: ReadonlyMap<
  string,
  ReadonlyMap<SharedOSHttpMethod, SharedOSRouteName>
> = (() => {
  const byPath = new Map<string, Map<SharedOSHttpMethod, SharedOSRouteName>>();
  for (const [name, route] of Object.entries(SHAREDOS_ROUTES)) {
    const verbs = byPath.get(route.path) ?? new Map<SharedOSHttpMethod, SharedOSRouteName>();
    verbs.set(route.method, name as SharedOSRouteName);
    byPath.set(route.path, verbs);
  }
  return byPath;
})();

function resolveRoute(request: Request, pathname: string): SharedOSRouteName {
  const verbs = ROUTES_BY_PATH.get(pathname);
  if (verbs === undefined) {
    throw new SharedOSHttpError(404, "not_found", "SharedOS endpoint not found.");
  }
  const name = verbs.get(request.method as SharedOSHttpMethod);
  if (name === undefined) {
    throw new SharedOSHttpError(
      405,
      "method_not_allowed",
      `Use ${[...verbs.keys()].join(" or ")} for this endpoint.`,
    );
  }
  return name;
}

async function routeRequest(
  options: SharedOSHttpOptions,
  request: Request,
  requestId: string,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === SHAREDOS_ROUTES.health.path) {
    resolveRoute(request, pathname);
    return json({ status: "ok", protocolVersion: PROTOCOL_VERSION }, 200, requestId);
  }

  const resolvedContext = await options.resolveContext(request);
  const parsedContext = AccessContextSchema.safeParse(resolvedContext);
  if (!parsedContext.success) {
    throw new SharedOSHttpError(
      500,
      "invalid_access_context",
      "The host returned an invalid access context.",
    );
  }
  const context = parsedContext.data;
  const callOptions: SharedOSApiCallOptions = { signal: request.signal };
  const route = resolveRoute(request, pathname);

  switch (route) {
    case "health":
      return json({ status: "ok", protocolVersion: PROTOCOL_VERSION }, 200, requestId);
    case "authorize": {
      const body = await parseBody(request, SHAREDOS_ROUTES.authorize.request);
      return json(await options.api.authorize(context, body, callOptions), 200, requestId);
    }
    case "listTools":
      return json(await options.api.listTools(context, callOptions), 200, requestId);
    case "reach":
      return json(await options.api.reach(context, callOptions), 200, requestId);
    case "listToolNamespaces":
      return json(await options.api.listToolNamespaces(context, callOptions), 200, requestId);
    case "updateToolNamespaces": {
      const body = await parseBody(request, SHAREDOS_ROUTES.updateToolNamespaces.request);
      return json(
        await options.api.updateToolNamespaces(context, body, callOptions),
        200,
        requestId,
      );
    }
    case "invokeTool": {
      const body = await parseBody(request, SHAREDOS_ROUTES.invokeTool.request);
      return json(await options.api.invokeTool(context, body, callOptions), 200, requestId);
    }
    case "invokeResource": {
      const body = await parseBody(request, SHAREDOS_ROUTES.invokeResource.request);
      const operation: ResourceOperation = { ...body, context };
      return json(
        await options.api.invokeResource(context, operation, callOptions),
        200,
        requestId,
      );
    }
    case "sendMessage": {
      const body = await parseBody(request, SHAREDOS_ROUTES.sendMessage.request);
      const result = await options.api.sendMessage(context, body, callOptions);
      return json(result, result.status === "accepted" ? 202 : 200, requestId);
    }
    case "executeTurn": {
      const body = await parseBody(request, SHAREDOS_ROUTES.executeTurn.request);
      return json(await options.api.executeTurn(context, body, callOptions), 200, requestId);
    }
  }
}

async function parseBody<T>(request: Request, schema: WireSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new SharedOSHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SharedOSHttpError(
      400,
      "invalid_request",
      "Request body does not match the v1 contract.",
    );
  }

  return parsed.data;
}

function json(payload: unknown, status: number, requestId: string): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof SharedOSHttpError) {
    return json(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
      requestId,
    );
  }

  if (hasErrorCode(error, "permission_denied")) {
    return json(
      {
        error: {
          code: "permission_denied" satisfies SharedOSApiErrorCode,
          message: "No matching capability grant allows this operation.",
          requestId,
        },
      },
      403,
      requestId,
    );
  }

  return json(
    {
      error: {
        code: "internal_error" satisfies SharedOSApiErrorCode,
        message: "SharedOS request failed.",
        requestId,
      },
    },
    500,
    requestId,
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
