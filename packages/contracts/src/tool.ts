import { z } from "zod";

import { CapabilityRequirementSchema } from "./capability.js";
import { IdentifierSchema, TimestampSchema } from "./common.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { ProtocolErrorSchema } from "./protocol-error.js";

/**
 * A canonical SharedOS tool identity.
 *
 * Deliberately narrower than {@link IdentifierSchema}. A tool name is not an
 * opaque host identifier: it is published to external harnesses as the raw MCP
 * `Tool.name`, so the character set has to be one every harness and transport
 * carries unchanged. Keeping the two schemas distinct makes the invariant
 *
 *     ToolDefinition.name = SharedOS canonical tool ID = raw MCP Tool.name
 *
 * enforceable at registration rather than merely documented.
 *
 * Names are globally unique across namespaces, so a catalogue that brokers two
 * providers exposing the same underlying operation still publishes two distinct
 * names -- `github.search` and `notion.search`, never `search` twice.
 *
 * A harness is free to rewrite this into an alias of its own
 * (`mcp__sharedos__files_search`). That alias is presentation, never identity,
 * and never participates in authorization.
 */
export const ToolNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/u, {
    message: "tool names may contain only letters, digits, underscore, dot, and hyphen",
  });
export type ToolName = z.infer<typeof ToolNameSchema>;

/** A logical group of tools that a trusted host may enable for one access context. */
export const ToolNamespaceSchema = IdentifierSchema;
export type ToolNamespace = z.infer<typeof ToolNamespaceSchema>;

/**
 * The host-defined origin of a tool, for example `sharedos`, `native`, `mcp`,
 * or `composio`. This is catalog metadata, never proof of authority.
 */
export const ToolSourceSchema = IdentifierSchema;
export type ToolSource = z.infer<typeof ToolSourceSchema>;

/** A conservative catalog classification. Capabilities remain the authorization source. */
export const ToolReadWriteSchema = z.enum(["read", "write"]);
export type ToolReadWrite = z.infer<typeof ToolReadWriteSchema>;

export const EnabledToolNamespacesSchema = z
  .array(ToolNamespaceSchema)
  .superRefine((namespaces, context) => {
    if (new Set(namespaces).size !== namespaces.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enabled tool namespaces must be unique",
      });
    }
  });
export type EnabledToolNamespaces = z.infer<typeof EnabledToolNamespacesSchema>;

/**
 * An idempotent patch to a host-owned tool namespace selection.
 *
 * The host applies this atomically and returns the authoritative effective
 * selection after product policy ceilings have been enforced.
 */
export const ToolNamespaceUpdateSchema = z
  .object({
    enable: EnabledToolNamespacesSchema.optional(),
    disable: EnabledToolNamespacesSchema.optional(),
  })
  .strict()
  .superRefine((update, context) => {
    const enable = update.enable ?? [];
    const disable = update.disable ?? [];
    if (enable.length === 0 && disable.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a tool namespace update must enable or disable at least one namespace",
      });
    }

    const enabled = new Set(enable);
    for (const namespace of disable) {
      if (enabled.has(namespace)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a tool namespace cannot be enabled and disabled in the same update",
          path: ["disable"],
        });
      }
    }
  });
export type ToolNamespaceUpdate = z.infer<typeof ToolNamespaceUpdateSchema>;

export const ToolAnnotationsSchema = z
  .object({
    readOnly: z.boolean().optional(),
    destructive: z.boolean().optional(),
    idempotent: z.boolean().optional(),
  })
  .strict();

export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;

/** A JSON-Schema-described tool bound to one permission requirement. */
export const ToolDefinitionSchema = z
  .object({
    name: ToolNameSchema,
    description: z.string().min(1),
    namespace: ToolNamespaceSchema,
    source: ToolSourceSchema,
    readWrite: ToolReadWriteSchema,
    inputSchema: JsonObjectSchema,
    outputSchema: JsonObjectSchema.optional(),
    requiredCapability: CapabilityRequirementSchema,
    annotations: ToolAnnotationsSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.readWrite === "read" && definition.annotations?.destructive === true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a read-classified tool cannot be destructive",
        path: ["annotations", "destructive"],
      });
    }
    if (definition.readWrite === "write" && definition.annotations?.readOnly === true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a write-classified tool cannot be read-only",
        path: ["annotations", "readOnly"],
      });
    }
  });

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * MCP tool annotation hints, in the vocabulary a harness receives them in.
 *
 * These are the same three facts {@link ToolAnnotationsSchema} carries, renamed
 * to the MCP wire spelling. They stay a separate type rather than a rename at
 * the edge because they are a *hint* surface: advisory metadata a model may use
 * to decide how to call a tool, and never an authorization input on either side
 * of the boundary.
 *
 * `openWorldHint` has no SharedOS equivalent and is therefore never emitted.
 * Inventing a value for it would put an unfixed field into `catalogHash`.
 */
export const PublishedToolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();
export type PublishedToolAnnotations = z.infer<typeof PublishedToolAnnotationsSchema>;

/** Catalogue provenance a harness may see. Metadata, never proof of authority. */
export const PublishedToolMetadataSchema = z
  .object({
    namespace: ToolNamespaceSchema.optional(),
    source: ToolSourceSchema.optional(),
  })
  .strict();
export type PublishedToolMetadata = z.infer<typeof PublishedToolMetadataSchema>;

/**
 * Everything a model or harness is allowed to see about one tool.
 *
 * This is the projection SharedOS publishes across the MCP boundary, and it is
 * defined by what it omits. `requiredCapability`, `resolveRequirement`, grants,
 * issuing authority, namespace settings, credentials, and handler references do
 * not appear here and never cross the boundary: a harness receives the operation
 * surface, and SharedOS keeps the authority.
 *
 * `name` is the canonical SharedOS tool ID and is simultaneously the raw MCP
 * `Tool.name`. There is deliberately no second identity field. A published
 * catalogue with two names for one tool is a catalogue where authorization and
 * discovery can disagree, and {@link ToolNameSchema} exists precisely so the
 * canonical name is always carriable as-is.
 */
export const PublishedToolDefinitionSchema = z
  .object({
    name: ToolNameSchema,
    description: z.string().min(1),
    inputSchema: JsonObjectSchema,
    outputSchema: JsonObjectSchema.optional(),
    annotations: PublishedToolAnnotationsSchema.optional(),
    metadata: PublishedToolMetadataSchema.optional(),
  })
  .strict();
export type PublishedToolDefinition = z.infer<typeof PublishedToolDefinitionSchema>;

/**
 * The effective, permission-filtered catalogue for exactly one turn.
 *
 * `catalogHash` covers the tools and nothing else, so two harnesses that were
 * handed the same semantic tool set produce the same hash even though their
 * `executionId`s, transports, and harness-side aliases differ. That is the whole
 * point of carrying it: an experiment can then prove the harnesses were compared
 * on equal terms rather than assuming it.
 */
export const SharedOSToolCatalogSchema = z
  .object({
    version: z.literal("1"),
    executionId: IdentifierSchema,
    catalogHash: z.string().regex(/^[0-9a-f]{64}$/u),
    tools: z.array(PublishedToolDefinitionSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const names = catalog.tools.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "published tool names must be unique within one catalogue",
        path: ["tools"],
      });
    }
    const sorted = [...names].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (names.some((name, index) => name !== sorted[index])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "published tools must be sorted by canonical name",
        path: ["tools"],
      });
    }
  });
export type SharedOSToolCatalog = z.infer<typeof SharedOSToolCatalogSchema>;

/**
 * The declared tool surface of one experiment or runtime configuration.
 *
 * `strict` asserts that every effect available to the harness went through
 * SharedOS. It is checked, not just declared: a strict policy that also lists
 * `externalDirect` entries is rejected here rather than producing a run whose
 * headline claim its own manifest contradicts.
 *
 * `harnessLocal` is still permitted under `strict`, because a harness with no
 * local tools at all cannot always be produced -- but the entries have to be
 * named, so a reader can see exactly which effects were outside the kernel.
 */
export const ToolPolicySchema = z
  .object({
    mode: z.enum(["strict", "hybrid"]),
    managedMcp: z.array(IdentifierSchema),
    harnessLocal: z.array(ToolNameSchema),
    externalDirect: z.array(IdentifierSchema),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "strict" && policy.externalDirect.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a strict tool policy cannot declare externally connected tools",
        path: ["externalDirect"],
      });
    }
    if (policy.managedMcp.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a tool policy must name at least one managed SharedOS endpoint",
        path: ["managedMcp"],
      });
    }
  });
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

export const ToolNamespaceDescriptorSchema = z
  .object({
    namespace: ToolNamespaceSchema,
    sources: z.array(ToolSourceSchema).min(1),
    toolCount: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (new Set(descriptor.sources).size !== descriptor.sources.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool namespace sources must be unique",
        path: ["sources"],
      });
    }
  });
export type ToolNamespaceDescriptor = z.infer<typeof ToolNamespaceDescriptorSchema>;

export const ToolNamespaceCatalogSchema = z
  .object({
    namespaces: z.array(ToolNamespaceDescriptorSchema),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        enabled: z.number().int().nonnegative(),
        disabled: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const names = catalog.namespaces.map(({ namespace }) => namespace);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool namespaces in a catalog must be unique",
        path: ["namespaces"],
      });
    }

    const enabled = catalog.namespaces.filter((namespace) => namespace.enabled).length;
    const disabled = catalog.namespaces.length - enabled;
    if (
      catalog.summary.total !== catalog.namespaces.length ||
      catalog.summary.enabled !== enabled ||
      catalog.summary.disabled !== disabled
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool namespace catalog summary does not match its entries",
        path: ["summary"],
      });
    }
  });
export type ToolNamespaceCatalog = z.infer<typeof ToolNamespaceCatalogSchema>;

export const ToolCallSchema = z
  .object({
    id: IdentifierSchema,
    tool: IdentifierSchema,
    arguments: JsonObjectSchema,
    traceId: IdentifierSchema,
    requestedAt: TimestampSchema,
  })
  .strict();

export type ToolCall = z.infer<typeof ToolCallSchema>;

const ToolResultBaseSchema = z.object({
  callId: IdentifierSchema,
  tool: IdentifierSchema,
  completedAt: TimestampSchema,
  metadata: JsonObjectSchema.optional(),
});

export const ToolResultSchema = z.discriminatedUnion("status", [
  ToolResultBaseSchema.extend({
    status: z.literal("succeeded"),
    output: JsonValueSchema,
  }).strict(),
  ToolResultBaseSchema.extend({
    status: z.literal("denied"),
    error: ProtocolErrorSchema,
  }).strict(),
  ToolResultBaseSchema.extend({
    status: z.literal("failed"),
    error: ProtocolErrorSchema,
  }).strict(),
]);

export type ToolResult = z.infer<typeof ToolResultSchema>;
