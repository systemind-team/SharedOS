import { z } from "zod";

import { AuthorizationDecisionSchema } from "./access.js";
import { CapabilityRequirementSchema, ReachResultSchema } from "./capability.js";
import { IdentifierSchema, ProtocolVersionSchema } from "./common.js";
import { ExecutionRequestSchema, ExecutionResultSchema } from "./execution.js";
import { MessageDeliveryResultSchema, MessageEnvelopeSchema } from "./message.js";
import { ResourceOperationSchema, ResourceResultSchema } from "./resource.js";
import {
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolNamespaceCatalogSchema,
  ToolNamespaceUpdateSchema,
  ToolResultSchema,
} from "./tool.js";

/** Resource operation accepted over HTTP; authority is injected by the host. */
export const RemoteResourceOperationSchema = ResourceOperationSchema.omit({
  context: true,
}).strict();
export type RemoteResourceOperation = z.infer<typeof RemoteResourceOperationSchema>;

/** Turn request accepted over HTTP; authority and visible tools are host-derived. */
export const RemoteExecutionRequestSchema = ExecutionRequestSchema.omit({
  context: true,
  tools: true,
}).strict();
export type RemoteExecutionRequest = z.infer<typeof RemoteExecutionRequestSchema>;

export const SharedOSHealthSchema = z
  .object({
    status: z.literal("ok"),
    protocolVersion: ProtocolVersionSchema,
  })
  .strict();
export type SharedOSHealth = z.infer<typeof SharedOSHealthSchema>;

/**
 * The codes the SharedOS HTTP handler itself answers with. A kernel refusal
 * travels inside a `200` result under its own vocabulary (`docs/errors.md`);
 * these are the failures of the request as a request.
 *
 * The wire schema below keeps `code` a string so that an older client still
 * reads a code a newer server added; the union is for the producing side and
 * for a reader that wants to switch on the known ones.
 */
export const SHAREDOS_API_ERROR_CODES = [
  "invalid_access_context",
  "invalid_json",
  "invalid_request",
  "permission_denied",
  "not_found",
  "method_not_allowed",
  "internal_error",
] as const;
export type SharedOSApiErrorCode = (typeof SHAREDOS_API_ERROR_CODES)[number];

export const SharedOSApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1),
        message: z.string().min(1),
        requestId: IdentifierSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type SharedOSApiErrorResponse = z.infer<typeof SharedOSApiErrorResponseSchema>;

/**
 * What either side of the HTTP boundary needs from a schema: a verdict and a
 * typed value. Structural, so the handler and the client can name a route's
 * schemas without depending on the validation library themselves.
 */
export interface WireSchema<T> {
  safeParse(
    value: unknown,
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

export type SharedOSHttpMethod = "GET" | "POST" | "PUT";

/** One HTTP operation: where it lives, its verb, and what crosses the wire each way. */
export interface SharedOSRoute<Request = unknown, Response = unknown> {
  readonly path: `/${string}`;
  readonly method: SharedOSHttpMethod;
  /** Absent for a route that takes no body. */
  readonly request?: WireSchema<Request>;
  readonly response: WireSchema<Response>;
}

/**
 * The HTTP surface, as one table the handler routes from and the client calls
 * through. A path with two verbs is two entries; the handler derives the
 * allowed verbs for a path from the table, so there is no second list to keep
 * in step. `docs/http-api.md` describes the same table for a reader.
 */
export const SHAREDOS_ROUTES = {
  health: { path: "/health", method: "GET", response: SharedOSHealthSchema },
  authorize: {
    path: "/v1/authorize",
    method: "POST",
    request: CapabilityRequirementSchema,
    response: AuthorizationDecisionSchema,
  },
  listTools: { path: "/v1/tools", method: "GET", response: z.array(ToolDefinitionSchema) },
  reach: { path: "/v1/reach", method: "GET", response: ReachResultSchema },
  listToolNamespaces: {
    path: "/v1/tools/namespaces",
    method: "GET",
    response: ToolNamespaceCatalogSchema,
  },
  updateToolNamespaces: {
    path: "/v1/tools/namespaces",
    method: "PUT",
    request: ToolNamespaceUpdateSchema,
    response: ToolNamespaceCatalogSchema,
  },
  invokeTool: {
    path: "/v1/tools/invoke",
    method: "POST",
    request: ToolCallSchema,
    response: ToolResultSchema,
  },
  invokeResource: {
    path: "/v1/resources/invoke",
    method: "POST",
    request: RemoteResourceOperationSchema,
    response: ResourceResultSchema,
  },
  sendMessage: {
    path: "/v1/messages",
    method: "POST",
    request: MessageEnvelopeSchema,
    response: MessageDeliveryResultSchema,
  },
  executeTurn: {
    path: "/v1/turns",
    method: "POST",
    request: RemoteExecutionRequestSchema,
    response: ExecutionResultSchema,
  },
} as const satisfies Readonly<Record<string, SharedOSRoute>>;
export type SharedOSRouteName = keyof typeof SHAREDOS_ROUTES;
