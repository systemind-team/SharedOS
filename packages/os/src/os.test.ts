import { describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  CapabilityGrant,
  JsonObject,
  ResourceOperation,
  ResourceResult,
  ToolCall,
} from "@aicoo/sharedos-contracts";
import { SharedOSKernel, type GrantSource, type ResourceProvider } from "@aicoo/sharedos-core";

import {
  createFileTools,
  createRepoTools,
  FILES_NAMESPACE,
  FilesAppendArgumentsSchema,
  FilesDeleteArgumentsSchema,
  FilesReplaceArgumentsSchema,
  FilesSnapshotRestoreArgumentsSchema,
  REPO_NAMESPACE,
  registerStandardOsTools,
} from "./index.js";

const now = "2026-08-03T00:00:00.000Z";
const actor = { kind: "agent", agentId: "agent-bob" } as const;
const owner = { kind: "human", userId: "user-alice" } as const;

function grantFor(
  actions: string[],
  path = ["Memory", "Self"],
  namespace = FILES_NAMESPACE,
): CapabilityGrant {
  return {
    id: "grant-1",
    namespaceId: "world-1",
    subject: actor,
    issuer: owner,
    capabilities: [
      {
        resource: { namespace, path, owner },
        actions,
        scope: "descendants",
      },
    ],
    constraints: { purposes: ["prepare-report"] },
    issuedAt: now,
  };
}

function contextFor(enabledToolNamespaces: string[] = [FILES_NAMESPACE]): AccessContext {
  return {
    actor,
    authority: owner,
    owner,
    namespaceId: "world-1",
    enabledToolNamespaces,
    purpose: "prepare-report",
    traceId: "trace-1",
    now,
  };
}

/** The trusted store the kernel loads authority from. */
function grantSource(grants: readonly CapabilityGrant[]): GrantSource {
  return {
    async load() {
      await Promise.resolve();
      return grants;
    },
  };
}

function call(tool: string, arguments_: JsonObject): ToolCall {
  return {
    id: `call-${tool.replaceAll(".", "-")}`,
    tool,
    arguments: arguments_,
    traceId: "trace-1",
    requestedAt: now,
  };
}

function provider(
  invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
    operationId: operation.operationId,
    status: "succeeded",
    output: { ok: true },
    completedAt: now,
  })),
): ResourceProvider {
  return { namespace: FILES_NAMESPACE, invoke };
}

function repoProvider(
  invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
    operationId: operation.operationId,
    status: "succeeded",
    output: { ok: true },
    completedAt: now,
  })),
): ResourceProvider {
  return { namespace: REPO_NAMESPACE, invoke };
}

describe("standard OS file tools", () => {
  it("shows a file tool for a narrow grant and authorizes the exact call path", async () => {
    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { hits: [] },
      completedAt: now,
    }));
    const kernel = new SharedOSKernel({ grantSource: grantSource([grantFor(["search"])]) });
    for (const handler of createFileTools(provider(invoke))) kernel.registerTool(handler);
    const context = contextFor();

    await expect(kernel.listTools(context)).resolves.toEqual([
      expect.objectContaining({ name: "files.search" }),
    ]);

    const mutableCall = call("files.search", {
      path: ["Memory", "Self"],
      query: "launch",
    });
    const allowedPromise = kernel.invokeTool(context, mutableCall);
    mutableCall.arguments.path = ["Memory", "@alice"];
    const allowed = await allowedPromise;
    const denied = await kernel.invokeTool(
      context,
      call("files.search", { path: ["Memory", "@alice"], query: "launch" }),
    );

    expect(allowed.status).toBe("succeeded");
    expect(denied.status).toBe("denied");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          namespace: FILES_NAMESPACE,
          path: ["Memory", "Self"],
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("publishes one files vocabulary without memory or workspace aliases", () => {
    const names = createFileTools(provider()).map(({ definition }) => definition.name);
    expect(names).toEqual([
      "files.list",
      "files.stat",
      "files.read",
      "files.search",
      "files.grep",
      "files.create",
      "files.replace",
      "files.append",
      "files.delete",
      "files.snapshot.create",
      "files.snapshot.list",
      "files.snapshot.restore",
    ]);
    expect(names.some((name) => name.startsWith("memory."))).toBe(false);
    expect(names.some((name) => name.startsWith("workspace."))).toBe(false);
  });

  it("maps mutating calls to distinct file actions and provider inputs", async () => {
    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { action: operation.action },
      completedAt: now,
    }));
    const kernel = new SharedOSKernel({
      grantSource: grantSource([grantFor(["create", "replace", "append", "delete"])]),
    });
    for (const handler of createFileTools(provider(invoke))) kernel.registerTool(handler);
    const context = contextFor();
    const path = ["Memory", "Self", "MEMORY.md"];

    await kernel.invokeTool(context, call("files.create", { path, content: "# Memory" }));
    await kernel.invokeTool(
      context,
      call("files.replace", { path, content: "# Updated", expectedVersion: "v1" }),
    );
    await kernel.invokeTool(
      context,
      call("files.append", { path, content: "\n- Decision", expectedVersion: "v2" }),
    );
    await kernel.invokeTool(context, call("files.delete", { path }));

    expect(invoke.mock.calls.map(([operation]) => operation.action)).toEqual([
      "create",
      "replace",
      "append",
      "delete",
    ]);
    expect(invoke.mock.calls[3]?.[0].input).toEqual({ recursive: false });
  });

  it("preserves opaque version tokens instead of normalizing model input", async () => {
    const schemas = [
      FilesReplaceArgumentsSchema,
      FilesAppendArgumentsSchema,
      FilesDeleteArgumentsSchema,
      FilesSnapshotRestoreArgumentsSchema,
    ];
    const argumentsFor = (schema: (typeof schemas)[number], expectedVersion: string) => ({
      path: ["Memory", "Self", "MEMORY.md"],
      ...(schema === FilesSnapshotRestoreArgumentsSchema
        ? { snapshotId: "snapshot-1" }
        : schema === FilesReplaceArgumentsSchema || schema === FilesAppendArgumentsSchema
          ? { content: "# Memory" }
          : {}),
      expectedVersion,
    });
    const invalidWhitespace = ["", " ", "\tversion", "version\n", "\uFEFFversion", "version\u00A0"];
    for (const schema of schemas) {
      for (const value of invalidWhitespace) {
        expect(schema.safeParse(argumentsFor(schema, value)).success).toBe(false);
      }
      expect(schema.safeParse(argumentsFor(schema, "a".repeat(10_000))).success).toBe(true);
      expect(schema.safeParse(argumentsFor(schema, "😀".repeat(10_000))).success).toBe(true);
    }

    expect(
      FilesReplaceArgumentsSchema.parse({
        path: ["Memory", "Self", "MEMORY.md"],
        content: "# Memory",
        expectedVersion: "v1",
      }).expectedVersion,
    ).toBe("v1");

    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { ok: true },
      completedAt: now,
    }));
    const handlers = createFileTools(provider(invoke));
    const expectedPublishedVersionSchema = {
      type: "string",
      minLength: 1,
      pattern: "^(?!\\s)[\\s\\S]*\\S$",
    };
    for (const name of [
      "files.replace",
      "files.append",
      "files.delete",
      "files.snapshot.restore",
    ]) {
      const handler = handlers.find(({ definition }) => definition.name === name);
      expect(
        (handler?.definition.inputSchema.properties as JsonObject | undefined)?.expectedVersion,
      ).toEqual(expectedPublishedVersionSchema);
    }

    const kernel = new SharedOSKernel({
      grantSource: grantSource([grantFor(["replace", "append", "delete", "snapshot:restore"])]),
    });
    for (const candidate of handlers) kernel.registerTool(candidate);
    const cases: ReadonlyArray<{
      readonly tool: string;
      readonly invalidVersion: string;
      readonly arguments: JsonObject;
    }> = [
      {
        tool: "files.replace",
        invalidVersion: "\uFEFFv1",
        arguments: {
          path: ["Memory", "Self", "MEMORY.md"],
          content: "# Memory",
        },
      },
      {
        tool: "files.append",
        invalidVersion: "v1\u00A0",
        arguments: {
          path: ["Memory", "Self", "MEMORY.md"],
          content: "\n- Entry",
        },
      },
      {
        tool: "files.delete",
        invalidVersion: "v1\n",
        arguments: { path: ["Memory", "Self", "MEMORY.md"] },
      },
      {
        tool: "files.snapshot.restore",
        invalidVersion: "\tv1",
        arguments: {
          path: ["Memory", "Self", "MEMORY.md"],
          snapshotId: "snapshot-1",
        },
      },
    ];
    for (const candidate of cases) {
      const result = await kernel.invokeTool(
        contextFor(),
        call(candidate.tool, {
          ...candidate.arguments,
          expectedVersion: candidate.invalidVersion,
        }),
      );
      expect(result).toMatchObject({ status: "failed" });
    }
    expect(invoke).not.toHaveBeenCalled();

    for (const candidate of cases) {
      const result = await kernel.invokeTool(
        contextFor(),
        call(candidate.tool, {
          ...candidate.arguments,
          expectedVersion: "v 1",
        }),
      );
      expect(result).toMatchObject({ status: "succeeded" });
    }
    expect(
      invoke.mock.calls.map(
        ([operation]) => (operation.input as JsonObject | undefined)?.expectedVersion,
      ),
    ).toEqual(["v 1", "v 1", "v 1", "v 1"]);
  });

  it("does not widen append-only authority into replace or delete", async () => {
    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { action: operation.action },
      completedAt: now,
    }));
    const kernel = new SharedOSKernel({
      grantSource: grantSource([grantFor(["append"], ["Memory", "Self", "Logs"])]),
    });
    for (const handler of createFileTools(provider(invoke))) kernel.registerTool(handler);
    const context = contextFor();
    const path = ["Memory", "Self", "Logs", "2026-08-07.md"];

    const appended = await kernel.invokeTool(
      context,
      call("files.append", { path, content: "- Durable decision" }),
    );
    const replaced = await kernel.invokeTool(
      context,
      call("files.replace", { path, content: "overwritten" }),
    );
    const deleted = await kernel.invokeTool(context, call("files.delete", { path }));

    expect(appended.status).toBe("succeeded");
    expect(replaced.status).toBe("denied");
    expect(deleted.status).toBe("denied");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0].action).toBe("append");
  });

  it("does not let read or mutation authority reach snapshot restore", async () => {
    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { action: operation.action },
      completedAt: now,
    }));
    const kernel = new SharedOSKernel({
      grantSource: grantSource([
        grantFor([
          "read",
          "create",
          "replace",
          "append",
          "delete",
          "snapshot:create",
          "snapshot:list",
        ]),
      ]),
    });
    for (const handler of createFileTools(provider(invoke))) kernel.registerTool(handler);
    const context = contextFor();
    const path = ["Memory", "Self", "MEMORY.md"];

    // Everything a principal could hold short of restore itself: the whole read
    // and mutation vocabulary, plus the two snapshot actions that only look at
    // history. Rollback is a distinct action, so none of it reaches restore.
    const created = await kernel.invokeTool(context, call("files.snapshot.create", { path }));
    const listed = await kernel.invokeTool(context, call("files.snapshot.list", { path }));
    const restored = await kernel.invokeTool(
      context,
      call("files.snapshot.restore", { path, snapshotId: "snapshot-1" }),
    );

    expect(created.status).toBe("succeeded");
    expect(listed.status).toBe("succeeded");
    expect(restored).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });

    // Undiscoverable as well as uninvocable: a rollback path that showed up in
    // the catalogue would invite the call even though it could never succeed.
    const visible = (await kernel.listTools(context)).map(({ name }) => name);
    expect(visible).toContain("files.snapshot.create");
    expect(visible).not.toContain("files.snapshot.restore");

    // The refusal is an authorization decision, not a provider that declined.
    expect(invoke.mock.calls.map(([operation]) => operation.action)).toEqual([
      "snapshot:create",
      "snapshot:list",
    ]);
  });

  it("rejects providers from a second resource namespace", () => {
    expect(() => createFileTools({ ...provider(), namespace: "memory" })).toThrow(
      "Expected a files provider",
    );
  });
});

describe("a resource tool's parse, between the requirement and the invocation", () => {
  it("reads one call's arguments for that call only, and parses for a host that invokes on its own", async () => {
    const operations: ResourceOperation[] = [];
    const invoke = vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => {
      operations.push(operation);
      return {
        operationId: operation.operationId,
        status: "succeeded",
        output: {},
        completedAt: now,
      };
    });
    const read = createFileTools(provider(invoke)).find(
      ({ definition }) => definition.name === "files.read",
    );
    if (read === undefined) throw new Error("files.read is not registered");
    const call = (id: string, path: string[]) =>
      Object.freeze({
        id,
        tool: "files.read",
        arguments: { path },
        traceId: "trace-1",
        requestedAt: now,
      });
    const first = call("call-1", ["Memory", "Self", "MEMORY.md"]);
    const second = call("call-1", ["Workspace", "notes.md"]);

    // Two calls sharing an id, as a caller is free to send. What the
    // requirement parsed is kept against the call object, so the second call
    // cannot be invoked with the first call's path.
    expect(read.resolveRequirement?.(contextFor(), first).resource.path).toEqual(
      first.arguments.path,
    );
    expect(read.resolveRequirement?.(contextFor(), second).resource.path).toEqual(
      second.arguments.path,
    );
    await read.invoke(contextFor(), second, new AbortController().signal);
    await read.invoke(contextFor(), first, new AbortController().signal);
    // No requirement was resolved for this one; it is parsed where it is used.
    await read.invoke(
      contextFor(),
      call("call-3", ["Workspace", "todo.md"]),
      new AbortController().signal,
    );

    expect(operations.map(({ resource }) => resource.path)).toEqual([
      ["Workspace", "notes.md"],
      ["Memory", "Self", "MEMORY.md"],
      ["Workspace", "todo.md"],
    ]);
  });
});

describe("standard OS repository tools", () => {
  const REPOSITORY = ["Projects", "sharedos"];
  const BOTH_PLANES = [FILES_NAMESPACE, REPO_NAMESPACE];

  function tracked() {
    return vi.fn(async (operation: ResourceOperation): Promise<ResourceResult> => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { action: operation.action },
      completedAt: now,
    }));
  }

  /** Both planes registered over the same directory, so only the grant differs. */
  function kernelFor(grant: CapabilityGrant, files = tracked(), repo = tracked()) {
    const kernel = new SharedOSKernel({ grantSource: grantSource([grant]) });
    for (const handler of createFileTools(provider(files))) kernel.registerTool(handler);
    for (const handler of createRepoTools(repoProvider(repo))) kernel.registerTool(handler);
    return { kernel, files, repo };
  }

  it("does not let a files capability reach the repo plane, or a repo capability reach files", async () => {
    const context = contextFor(BOTH_PLANES);

    // The broadest file authority expressible -- every action, over the very
    // directory the repository occupies. `capabilityMatches` compares the
    // namespace first, so none of it is repository authority.
    const holder = kernelFor(grantFor(["*"], REPOSITORY, FILES_NAMESPACE));
    const visible = (await holder.kernel.listTools(context)).map(({ name }) => name);
    expect(visible).toContain("files.delete");
    expect(visible.filter((name) => name.startsWith("repo."))).toEqual([]);

    const committed = await holder.kernel.invokeTool(
      context,
      call("repo.commit", { path: REPOSITORY, message: "chore: rebuild the index" }),
    );
    expect(committed).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect(holder.repo).not.toHaveBeenCalled();

    // And the reverse. A repository grant is not a licence to read the working
    // tree through `files.read`, which would reach paths the Git subset never
    // exposes.
    const committer = kernelFor(grantFor(["*"], REPOSITORY, REPO_NAMESPACE));
    const reachable = (await committer.kernel.listTools(context)).map(({ name }) => name);
    expect(reachable).toContain("repo.commit");
    expect(reachable.filter((name) => name.startsWith("files."))).toEqual([]);

    const read = await committer.kernel.invokeTool(
      context,
      call("files.read", { path: [...REPOSITORY, "README.md"] }),
    );
    expect(read).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect(committer.files).not.toHaveBeenCalled();

    // The refusals are authorization, not a namespace that was switched off:
    // both planes are enabled for this context and both were consulted.
    expect(context.enabledToolNamespaces).toEqual(BOTH_PLANES);
  });

  it("publishes the vetted git subset as five actions and nothing outside it", () => {
    const definitions = createRepoTools(repoProvider()).map(({ definition }) => definition);

    expect(
      definitions.map(({ name, requiredCapability }) => [name, requiredCapability.action]),
    ).toEqual([
      ["repo.status", "status"],
      ["repo.diff", "diff"],
      ["repo.log", "log"],
      ["repo.stage", "stage"],
      ["repo.commit", "commit"],
    ]);

    for (const { namespace, requiredCapability } of definitions) {
      expect(namespace).toBe(REPO_NAMESPACE);
      expect(requiredCapability.resource.namespace).toBe(REPO_NAMESPACE);
    }

    // Everything else stays behind whatever authorizes an arbitrary shell
    // command; the provider must not widen the reachable set of Git operations.
    const names = definitions.map(({ name }) => name);
    for (const forbidden of ["push", "reset", "checkout", "clean", "config", "remote"]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }
  });

  it("does not widen staging authority into commit", async () => {
    const context = contextFor(BOTH_PLANES);
    const held = kernelFor(
      grantFor(["status", "diff", "log", "stage"], REPOSITORY, REPO_NAMESPACE),
    );

    const staged = await held.kernel.invokeTool(
      context,
      call("repo.stage", { path: REPOSITORY, pathspec: [["packages", "os", "src", "index.ts"]] }),
    );
    const committed = await held.kernel.invokeTool(
      context,
      call("repo.commit", { path: REPOSITORY, message: "feat: give git its own plane" }),
    );

    expect(staged.status).toBe("succeeded");
    expect(committed).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect((await held.kernel.listTools(context)).map(({ name }) => name)).not.toContain(
      "repo.commit",
    );
    expect(held.repo.mock.calls.map(([operation]) => operation.action)).toEqual(["stage"]);
  });

  it("authorizes the repository the arguments name and passes the pathspec as input", async () => {
    const context = contextFor(BOTH_PLANES);
    const held = kernelFor(grantFor(["stage"], REPOSITORY, REPO_NAMESPACE));

    const outside = await held.kernel.invokeTool(
      context,
      call("repo.stage", { path: ["Projects", "other"], pathspec: [["README.md"]] }),
    );
    expect(outside.status).toBe("denied");

    // A traversal marker is not a path segment, so the contract refuses it
    // before the provider's own confinement is reached.
    const traversal = await held.kernel.invokeTool(
      context,
      call("repo.stage", { path: REPOSITORY, pathspec: [["..", "secrets.env"]] }),
    );
    expect(traversal.status).toBe("failed");

    const allowed = await held.kernel.invokeTool(
      context,
      call("repo.stage", { path: REPOSITORY, pathspec: [["docs", "adr"]] }),
    );
    expect(allowed.status).toBe("succeeded");
    expect(held.repo).toHaveBeenCalledOnce();
    expect(held.repo).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ namespace: REPO_NAMESPACE, path: REPOSITORY }),
        action: "stage",
        input: { pathspec: [["docs", "adr"]] },
      }),
      expect.any(AbortSignal),
    );
  });

  it("registers a git provider beside the files provider", () => {
    const registered: string[] = [];
    registerStandardOsTools(
      { registerTool: (handler) => registered.push(handler.definition.name) },
      { files: provider(), repo: repoProvider() },
    );
    expect(registered.filter((name) => name.startsWith("files."))).toHaveLength(12);
    expect(registered.filter((name) => name.startsWith("repo."))).toHaveLength(5);

    // The kernel's resource registry is keyed by namespace, so the second plane
    // needed no kernel change to sit beside the first.
    const kernel = new SharedOSKernel({ grantSource: grantSource([]) });
    kernel.registerResourceProvider(provider());
    expect(() => kernel.registerResourceProvider(repoProvider())).not.toThrow();
  });

  it("refuses to build either plane's tools over the other plane's provider", () => {
    expect(() => createRepoTools({ ...repoProvider(), namespace: FILES_NAMESPACE })).toThrow(
      "Expected a repo provider",
    );
    expect(() => createFileTools({ ...provider(), namespace: REPO_NAMESPACE })).toThrow(
      "Expected a files provider",
    );
  });
});
