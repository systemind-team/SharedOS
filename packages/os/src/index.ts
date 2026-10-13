import { z } from "zod";

import {
  JsonValueSchema,
  PathSegmentSchema,
  ResourceResultSchema,
  type AccessContext,
  type JsonObject,
  type JsonValue,
  type ResourceOperation,
  type ResourceResult,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from "@aicoo/sharedos-contracts";
import { childOperationId } from "@aicoo/sharedos-core";
import type { ResourceProvider, SharedOSKernel, ToolHandler } from "@aicoo/sharedos-core";
import { compactObject } from "@aicoo/sharedos-core/internal";

/** The canonical SharedOS resource plane. Memory is a role of files, not a second store. */
export const FILES_NAMESPACE = "files";

/**
 * The Git resource plane.
 *
 * `repo` and {@link FILES_NAMESPACE} may address the same directory and share
 * no authority: `capabilityMatches` compares `resource.namespace` before it
 * looks at anything else, so a file grant over a working tree matches nothing
 * here and a repository grant matches nothing there. Modelling `commit` as a
 * write under `files` would have made every holder of file-write authority a
 * committer, which is the permission cross-product ADR 0005 refuses. See
 * ADR 0024.
 */
export const REPO_NAMESPACE = "repo";
export const SHAREDOS_TOOL_SOURCE = "sharedos";

export const FilePathSchema = z.array(PathSegmentSchema).max(64);
export type FilePath = z.infer<typeof FilePathSchema>;

export const FilesPathArgumentsSchema = z.object({ path: FilePathSchema }).strict();
export type FilesPathArguments = z.infer<typeof FilesPathArgumentsSchema>;

export const FilesSearchArgumentsSchema = z
  .object({
    path: FilePathSchema,
    query: z.string().trim().min(1).max(8_192),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type FilesSearchArguments = z.infer<typeof FilesSearchArgumentsSchema>;

export const FilesGrepArgumentsSchema = z
  .object({
    path: FilePathSchema,
    pattern: z.string().min(1).max(8_192),
    mode: z.enum(["literal", "regex"]).default("literal"),
    caseSensitive: z.boolean().default(false),
    contextBefore: z.number().int().nonnegative().max(100).default(0),
    contextAfter: z.number().int().nonnegative().max(100).default(0),
  })
  .strict();
export type FilesGrepArguments = z.infer<typeof FilesGrepArgumentsSchema>;

export const FilesCreateArgumentsSchema = z
  .object({
    path: FilePathSchema.min(1),
    content: JsonValueSchema,
    metadata: z.record(JsonValueSchema).optional(),
  })
  .strict();
export type FilesCreateArguments = z.infer<typeof FilesCreateArgumentsSchema>;

const OpaqueVersionTokenSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, {
    message: "version tokens must not have leading or trailing whitespace",
  })
  .refine((value) => [...value].length <= 256, {
    message: "version tokens must contain at most 256 Unicode code points",
  });

const opaqueVersionTokenJsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^(?!\\s)[\\s\\S]*\\S$",
} as const;

export const FilesReplaceArgumentsSchema = z
  .object({
    path: FilePathSchema.min(1),
    content: JsonValueSchema,
    expectedVersion: OpaqueVersionTokenSchema.optional(),
  })
  .strict();
export type FilesReplaceArguments = z.infer<typeof FilesReplaceArgumentsSchema>;

export const FilesAppendArgumentsSchema = z
  .object({
    path: FilePathSchema.min(1),
    content: JsonValueSchema,
    expectedVersion: OpaqueVersionTokenSchema.optional(),
    metadata: z.record(JsonValueSchema).optional(),
  })
  .strict();
export type FilesAppendArguments = z.infer<typeof FilesAppendArgumentsSchema>;

export const FilesDeleteArgumentsSchema = z
  .object({
    path: FilePathSchema.min(1),
    expectedVersion: OpaqueVersionTokenSchema.optional(),
    recursive: z.boolean().default(false),
  })
  .strict();
export type FilesDeleteArguments = z.infer<typeof FilesDeleteArgumentsSchema>;

export const FilesSnapshotCreateArgumentsSchema = z
  .object({
    path: FilePathSchema,
    label: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
export type FilesSnapshotCreateArguments = z.infer<typeof FilesSnapshotCreateArgumentsSchema>;

export const FilesSnapshotListArgumentsSchema = z
  .object({
    path: FilePathSchema,
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type FilesSnapshotListArguments = z.infer<typeof FilesSnapshotListArgumentsSchema>;

export const FilesSnapshotRestoreArgumentsSchema = z
  .object({
    path: FilePathSchema.min(1),
    snapshotId: z.string().trim().min(1).max(256),
    expectedVersion: OpaqueVersionTokenSchema.optional(),
  })
  .strict();
export type FilesSnapshotRestoreArguments = z.infer<typeof FilesSnapshotRestoreArgumentsSchema>;

/**
 * Paths inside a repository, selecting what a diff or a stage covers.
 *
 * Provider input, not a second resource: staging is authorized at the
 * repository, and the provider confines every entry beneath it exactly as
 * `validatePathArguments` does today. They are carried in the same canonical
 * segment vocabulary as any other path (ADR 0004), so a traversal marker is
 * refused before the provider is reached -- a vocabulary constraint, not the
 * authorization boundary. See ADR 0024.
 */
export const RepoPathspecSchema = z.array(FilePathSchema.min(1)).min(1).max(64);
export type RepoPathspec = z.infer<typeof RepoPathspecSchema>;

/**
 * A single-line commit subject and body, bounded as the vetted Git subset
 * bounds it. Control characters are refused so a message cannot smuggle a
 * second argument past a provider that builds a command line.
 */
const CommitMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\u0000-\u0008\u000a-\u001f\u007f]/u.test(value), {
    message: "commit messages must not contain line breaks or control characters",
  });

const commitMessageJsonSchema = { type: "string", minLength: 1, maxLength: 500 } as const;

export const RepoStatusArgumentsSchema = z.object({ path: FilePathSchema }).strict();
export type RepoStatusArguments = z.infer<typeof RepoStatusArgumentsSchema>;

export const RepoDiffArgumentsSchema = z
  .object({
    path: FilePathSchema,
    staged: z.boolean().default(false),
    pathspec: RepoPathspecSchema.optional(),
  })
  .strict();
export type RepoDiffArguments = z.infer<typeof RepoDiffArgumentsSchema>;

export const RepoLogArgumentsSchema = z
  .object({
    path: FilePathSchema,
    maxCount: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type RepoLogArguments = z.infer<typeof RepoLogArgumentsSchema>;

export const RepoStageArgumentsSchema = z
  .object({ path: FilePathSchema, pathspec: RepoPathspecSchema })
  .strict();
export type RepoStageArguments = z.infer<typeof RepoStageArgumentsSchema>;

export const RepoCommitArgumentsSchema = z
  .object({ path: FilePathSchema, message: CommitMessageSchema })
  .strict();
export type RepoCommitArguments = z.infer<typeof RepoCommitArgumentsSchema>;

interface ParsedResourceCall {
  readonly path: string[];
  readonly input?: JsonValue;
}

interface ResourceToolSpec {
  readonly definition: ToolDefinition;
  parse(arguments_: JsonObject): ParsedResourceCall;
}

export interface StandardOsProviders {
  readonly files?: ResourceProvider;
  readonly repo?: ResourceProvider;
}

export function registerStandardOsTools(
  kernel: Pick<SharedOSKernel, "registerTool">,
  providers: StandardOsProviders,
): void {
  if (providers.files !== undefined) {
    for (const handler of createFileTools(providers.files)) {
      kernel.registerTool(handler);
    }
  }
  if (providers.repo !== undefined) {
    for (const handler of createRepoTools(providers.repo)) {
      kernel.registerTool(handler);
    }
  }
}

/**
 * Portable file tools over one host-owned provider.
 *
 * A host may expose roots such as Raw, Memory, Workspace, and Wiki, but they
 * remain paths in this one resource plane. Search indexes and context mounts
 * must preserve the same file grants; they are not independent authority.
 */
export function createFileTools(provider: ResourceProvider): readonly ToolHandler[] {
  requireProviderNamespace(provider, FILES_NAMESPACE);
  return [
    pathOnlyTool(provider, "files.list", "List entries inside a granted file path.", "list"),
    pathOnlyTool(provider, "files.stat", "Read metadata for a granted file path.", "stat"),
    pathOnlyTool(provider, "files.read", "Read content from a granted file path.", "read"),
    resourceTool(provider, {
      definition: definition({
        name: "files.search",
        namespace: FILES_NAMESPACE,
        description: "Semantically search files inside an explicitly granted path.",
        action: "search",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "query"],
          properties: {
            path: pathJsonSchema(),
            query: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
        readOnly: true,
      }),
      parse: (arguments_) => {
        const args = FilesSearchArgumentsSchema.parse(arguments_);
        return {
          path: args.path,
          input: compactObject({ query: args.query, limit: args.limit }),
        };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.grep",
        namespace: FILES_NAMESPACE,
        description: "Run deterministic literal or regex search with line context.",
        action: "grep",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "pattern"],
          properties: {
            path: pathJsonSchema(),
            pattern: { type: "string" },
            mode: { enum: ["literal", "regex"] },
            caseSensitive: { type: "boolean" },
            contextBefore: { type: "integer", minimum: 0, maximum: 100 },
            contextAfter: { type: "integer", minimum: 0, maximum: 100 },
          },
        },
        readOnly: true,
      }),
      parse: (arguments_) => {
        const { path, ...input } = FilesGrepArgumentsSchema.parse(arguments_);
        return { path, input };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.create",
        namespace: FILES_NAMESPACE,
        description: "Create a file at an explicitly granted, previously absent path.",
        action: "create",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: {
            path: pathJsonSchema(1),
            content: {},
            metadata: { type: "object" },
          },
        },
      }),
      parse: (arguments_) => {
        const { path, content, metadata } = FilesCreateArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ content, metadata }) };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.replace",
        namespace: FILES_NAMESPACE,
        description: "Replace a file's complete content, optionally at an expected version.",
        action: "replace",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: {
            path: pathJsonSchema(1),
            content: {},
            expectedVersion: opaqueVersionTokenJsonSchema,
          },
        },
        destructive: true,
      }),
      parse: (arguments_) => {
        const { path, content, expectedVersion } = FilesReplaceArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ content, expectedVersion }) };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.append",
        namespace: FILES_NAMESPACE,
        description: "Append content to a file at an explicitly granted path.",
        action: "append",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: {
            path: pathJsonSchema(1),
            content: {},
            expectedVersion: opaqueVersionTokenJsonSchema,
            metadata: { type: "object" },
          },
        },
      }),
      parse: (arguments_) => {
        const { path, content, expectedVersion, metadata } =
          FilesAppendArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ content, expectedVersion, metadata }) };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.delete",
        namespace: FILES_NAMESPACE,
        description: "Delete a file path; recursive deletion must be requested explicitly.",
        action: "delete",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: pathJsonSchema(1),
            expectedVersion: opaqueVersionTokenJsonSchema,
            recursive: { type: "boolean", default: false },
          },
        },
        destructive: true,
      }),
      parse: (arguments_) => {
        const { path, expectedVersion, recursive } = FilesDeleteArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ expectedVersion, recursive }) };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.snapshot.create",
        namespace: FILES_NAMESPACE,
        description: "Create a restorable snapshot of a granted file path.",
        action: "snapshot:create",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: pathJsonSchema(), label: { type: "string" } },
        },
      }),
      parse: (arguments_) => {
        const { path, label } = FilesSnapshotCreateArgumentsSchema.parse(arguments_);
        return label === undefined ? { path } : { path, input: { label } };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.snapshot.list",
        namespace: FILES_NAMESPACE,
        description: "List snapshots for a granted file path.",
        action: "snapshot:list",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: pathJsonSchema(),
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
        readOnly: true,
      }),
      parse: (arguments_) => {
        const { path, limit } = FilesSnapshotListArgumentsSchema.parse(arguments_);
        return limit === undefined ? { path } : { path, input: { limit } };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "files.snapshot.restore",
        namespace: FILES_NAMESPACE,
        description: "Restore a granted file path from a named snapshot.",
        action: "snapshot:restore",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "snapshotId"],
          properties: {
            path: pathJsonSchema(1),
            snapshotId: { type: "string" },
            expectedVersion: opaqueVersionTokenJsonSchema,
          },
        },
        destructive: true,
      }),
      parse: (arguments_) => {
        const { path, snapshotId, expectedVersion } =
          FilesSnapshotRestoreArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ snapshotId, expectedVersion }) };
      },
    }),
  ];
}

/**
 * The vetted Git subset over one host-owned provider, beside the file tools.
 *
 * Five tools, one per subcommand the host's `safe-git` allows, each resolving
 * to an action of its own: a plane with a single `write` could not express "may
 * stage, never commit", which is the distinction hosts already make. `push`,
 * `reset`, `checkout`, `clean`, `config`, and `remote` are deliberately absent
 * and stay behind whatever authorizes an arbitrary shell command.
 *
 * The capability names the repository; the provider confines every path
 * argument beneath it. SharedOS ships the vocabulary and the authorization and
 * never a Git implementation, so the execution hardening the host applies --
 * disabled hooks, no system or global config, no external diff or textconv
 * drivers, no clean filters, refused symlinks -- holds because the provider is
 * the only code that can turn a capability into an invocation, not because any
 * grant asked for it. See ADR 0024.
 */
export function createRepoTools(provider: ResourceProvider): readonly ToolHandler[] {
  requireProviderNamespace(provider, REPO_NAMESPACE);
  return [
    resourceTool(provider, {
      definition: definition({
        name: "repo.status",
        description: "Report the working-tree status of a granted repository.",
        namespace: REPO_NAMESPACE,
        action: "status",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: pathJsonSchema() },
        },
        readOnly: true,
      }),
      parse: (arguments_) => ({ path: RepoStatusArgumentsSchema.parse(arguments_).path }),
    }),
    resourceTool(provider, {
      definition: definition({
        name: "repo.diff",
        description: "Read the working-tree or staged diff of a granted repository.",
        namespace: REPO_NAMESPACE,
        action: "diff",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: pathJsonSchema(),
            staged: { type: "boolean", default: false },
            pathspec: pathspecJsonSchema(),
          },
        },
        readOnly: true,
      }),
      parse: (arguments_) => {
        const { path, staged, pathspec } = RepoDiffArgumentsSchema.parse(arguments_);
        return { path, input: compactObject({ staged, pathspec }) };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "repo.log",
        description: "Read commit history for a granted repository.",
        namespace: REPO_NAMESPACE,
        action: "log",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: pathJsonSchema(),
            maxCount: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
        readOnly: true,
      }),
      parse: (arguments_) => {
        const { path, maxCount } = RepoLogArgumentsSchema.parse(arguments_);
        return maxCount === undefined ? { path } : { path, input: { maxCount } };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "repo.stage",
        description: "Add paths inside a granted repository to its index.",
        namespace: REPO_NAMESPACE,
        action: "stage",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "pathspec"],
          properties: { path: pathJsonSchema(), pathspec: pathspecJsonSchema() },
        },
      }),
      parse: (arguments_) => {
        const { path, pathspec } = RepoStageArgumentsSchema.parse(arguments_);
        return { path, input: { pathspec } };
      },
    }),
    resourceTool(provider, {
      definition: definition({
        name: "repo.commit",
        description: "Commit the staged index of a granted repository.",
        namespace: REPO_NAMESPACE,
        action: "commit",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path", "message"],
          properties: { path: pathJsonSchema(), message: commitMessageJsonSchema },
        },
      }),
      parse: (arguments_) => {
        const { path, message } = RepoCommitArgumentsSchema.parse(arguments_);
        return { path, input: { message } };
      },
    }),
  ];
}

function pathOnlyTool(
  provider: ResourceProvider,
  name: string,
  description: string,
  action: string,
): ToolHandler {
  return resourceTool(provider, {
    definition: definition({
      name,
      description,
      namespace: provider.namespace,
      action,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: pathJsonSchema() },
      },
      readOnly: true,
    }),
    parse: (arguments_) => ({ path: FilesPathArgumentsSchema.parse(arguments_).path }),
  });
}

function resourceTool(provider: ResourceProvider, spec: ResourceToolSpec): ToolHandler {
  // `parseArguments` is the gate: it refuses a malformed call before anything is
  // authorized, and the kernel builds its own frozen call from what it returns,
  // so nothing parsed there can be handed on. `resolveRequirement` and `invoke`
  // are then given that one call object, and the second reads what the first
  // parsed rather than parsing the same arguments a third time. Keyed on the
  // object, as the message-request tool keys its prepared envelope: an id is
  // something a caller chose. A host that calls `invoke` on its own, without
  // resolving a requirement first, is parsed for there.
  const parsedCalls = new WeakMap<ToolCall, ParsedResourceCall>();
  const parsedFor = (call: ToolCall): ParsedResourceCall => {
    let parsed = parsedCalls.get(call);
    if (parsed === undefined) {
      parsed = spec.parse(call.arguments);
      parsedCalls.set(call, parsed);
    }
    return parsed;
  };

  return {
    definition: spec.definition,
    parseArguments: (arguments_) => {
      spec.parse(arguments_);
      return arguments_;
    },
    resolveRequirement: (context, call) => ({
      resource: {
        namespace: provider.namespace,
        path: parsedFor(call).path,
        owner: context.owner,
      },
      action: spec.definition.requiredCapability.action,
    }),
    invoke: async (context, call, signal, identity) => {
      const parsed = parsedFor(call);
      const operationId =
        identity === undefined ? call.id : await childOperationId(identity, "resource", "provider");
      const operation: ResourceOperation = {
        operationId,
        context,
        resource: { namespace: provider.namespace, path: parsed.path, owner: context.owner },
        action: spec.definition.requiredCapability.action,
        ...(parsed.input === undefined ? {} : { input: parsed.input }),
      };
      return toToolResult(call, context, await provider.invoke(operation, signal), operationId);
    },
  };
}

function toToolResult(
  call: ToolCall,
  context: AccessContext,
  candidate: ResourceResult,
  operationId = call.id,
): ToolResult {
  const parsed = ResourceResultSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.operationId !== operationId) {
    return {
      callId: call.id,
      tool: call.tool,
      status: "failed",
      completedAt: context.now,
      error: {
        code: "invalid_resource_result",
        message: "The OS file provider returned an invalid result.",
      },
    };
  }

  const result = parsed.data;
  if (result.status === "succeeded") {
    return {
      callId: call.id,
      tool: call.tool,
      status: "succeeded",
      output: result.output,
      completedAt: result.completedAt,
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    };
  }

  return {
    callId: call.id,
    tool: call.tool,
    status: result.status,
    error: result.error,
    completedAt: result.completedAt,
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}

function definition(args: {
  name: string;
  description: string;
  namespace: string;
  action: string;
  inputSchema: JsonObject;
  readOnly?: boolean;
  destructive?: boolean;
}): ToolDefinition {
  return {
    name: args.name,
    description: args.description,
    namespace: args.namespace,
    source: SHAREDOS_TOOL_SOURCE,
    readWrite: args.readOnly === true ? "read" : "write",
    inputSchema: args.inputSchema,
    requiredCapability: {
      resource: { namespace: args.namespace, path: [] },
      action: args.action,
    },
    annotations: {
      ...(args.readOnly === undefined ? {} : { readOnly: args.readOnly }),
      ...(args.destructive === undefined ? {} : { destructive: args.destructive }),
    },
  };
}

function pathJsonSchema(minItems = 0): JsonObject {
  return {
    type: "array",
    items: { type: "string" },
    minItems,
    maxItems: 64,
  };
}

function pathspecJsonSchema(): JsonObject {
  return { type: "array", items: pathJsonSchema(1), minItems: 1, maxItems: 64 };
}

function requireProviderNamespace(provider: ResourceProvider, expected: string): void {
  if (provider.namespace !== expected) {
    throw new TypeError(`Expected a ${expected} provider, received ${provider.namespace}`);
  }
}
