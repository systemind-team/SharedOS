import { describe, expect, it } from "vitest";

import type {
  AccessContext,
  CapabilityGrant,
  JsonObject,
  ResourceOperation,
  ResourceResult,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import {
  PublishedToolDefinitionSchema,
  SharedOSToolCatalogSchema,
  ToolDefinitionSchema,
  ToolNameSchema,
  ToolPolicySchema,
} from "@aicoo/sharedos-contracts";
import {
  SharedOSKernel,
  ToolRegistry,
  catalogHash,
  portableToolName,
  publishToolCatalog,
  publishToolDefinition,
  type GrantSource,
  type ResourceProvider,
} from "@aicoo/sharedos-core";
import { FILES_NAMESPACE, createFileTools } from "@aicoo/sharedos-os";

import {
  McpToolServer,
  SharedOSToolBridge,
  claudeAgentSdkMcpOptions,
  claudeCodeMcpConfig,
  codexMcpConfig,
  declareToolPolicy,
  deepseekMcpConfig,
  harnessMcpConfigFile,
  harnessToolAlias,
  piMcpConfig,
  kernelToolBridge,
  mintExecutionToken,
  parseToolPolicy,
  resolveCanonicalName,
  toCallToolResult,
  verifyExecutionToken,
  toolPolicyHash,
  type ExecutionTokenClaims,
  canonicalActor,
} from "./index.js";
import { createStreamableHttpMcpServer, serveMcpOverStdio } from "./node.js";

const NOW = "2026-08-23T00:00:00.000Z";
const ACTOR = { kind: "agent", agentId: "agent-bob" } as const;
const OWNER = { kind: "human", userId: "user-alice" } as const;
const GRANTED = ["Work", "Public"];
const UNGRANTED = ["Work", "Private"];

const SEARCH_TOOL: ToolDefinition = {
  name: "files.search",
  description: "Semantically search files inside an explicitly granted path.",
  namespace: FILES_NAMESPACE,
  source: "sharedos",
  readWrite: "read",
  inputSchema: { type: "object", properties: { path: { type: "array" } } },
  requiredCapability: {
    resource: { namespace: FILES_NAMESPACE, path: [], owner: OWNER },
    action: "search",
  },
  annotations: { readOnly: true },
};

function grant(actions: readonly string[], path: readonly string[] = GRANTED): CapabilityGrant {
  return {
    id: "grant-1",
    namespaceId: "world-1",
    subject: ACTOR,
    issuer: OWNER,
    capabilities: [
      {
        resource: { namespace: FILES_NAMESPACE, path: [...path], owner: OWNER },
        actions: [...actions],
        scope: "descendants",
      },
    ],
    constraints: { purposes: ["mcp-toolshare"] },
    issuedAt: NOW,
  };
}

function context(): AccessContext {
  return {
    actor: ACTOR,
    authority: OWNER,
    owner: OWNER,
    namespaceId: "world-1",
    enabledToolNamespaces: [FILES_NAMESPACE],
    purpose: "mcp-toolshare",
    traceId: "trace-1",
    now: NOW,
  };
}

function grantSource(grants: readonly CapabilityGrant[]): GrantSource {
  return {
    async load() {
      await Promise.resolve();
      return grants;
    },
  };
}

function filesProvider(): ResourceProvider {
  return {
    namespace: FILES_NAMESPACE,
    async invoke(operation: ResourceOperation): Promise<ResourceResult> {
      await Promise.resolve();
      return {
        operationId: operation.operationId,
        status: "succeeded",
        output: { hits: [operation.resource.path.join("/")] },
        completedAt: NOW,
      };
    },
  };
}

function kernelWith(grants: readonly CapabilityGrant[]): SharedOSKernel {
  const tools = new ToolRegistry();
  for (const handler of createFileTools(filesProvider())) {
    tools.register(handler);
  }
  return new SharedOSKernel({ grantSource: grantSource(grants), tools });
}

const NEVER_ABORTED = new AbortController().signal;

async function request(
  server: McpToolServer,
  method: string,
  params?: unknown,
  id: number | string = 1,
): Promise<JsonObject> {
  const response = await server.handle(
    { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) },
    NEVER_ABORTED,
  );
  return response as unknown as JsonObject;
}

function resultOf(response: JsonObject): JsonObject {
  expect(response["error"], JSON.stringify(response)).toBeUndefined();
  return response["result"] as JsonObject;
}

describe("the canonical tool name", () => {
  it("is narrower than an opaque identifier, so it survives an MCP wire unchanged", () => {
    expect(ToolNameSchema.safeParse("files.search").success).toBe(true);
    expect(ToolNameSchema.safeParse("mcp__sharedos__files_search").success).toBe(true);
    expect(ToolNameSchema.safeParse("files search").success).toBe(false);
    expect(ToolNameSchema.safeParse("files/search").success).toBe(false);
    expect(ToolNameSchema.safeParse("").success).toBe(false);
  });

  it("is enforced at registration rather than merely documented", () => {
    const registry = new ToolRegistry();
    expect(ToolDefinitionSchema.safeParse({ ...SEARCH_TOOL, name: "files search" }).success).toBe(
      false,
    );
    expect(() =>
      registry.register({
        definition: { ...SEARCH_TOOL, name: "files search" },
        parseArguments: (arguments_) => arguments_,
        invoke: async () => {
          throw new Error("unreachable");
        },
      }),
    ).toThrow("tool definition does not match the SharedOS contract");
  });

  it("keeps two brokered providers distinguishable rather than colliding on `search`", () => {
    const published = publishToolCatalog([
      { ...SEARCH_TOOL, name: "github.search", namespace: FILES_NAMESPACE },
      { ...SEARCH_TOOL, name: "notion.search", namespace: FILES_NAMESPACE },
    ]);
    expect(published.map(({ name }) => name)).toEqual(["github.search", "notion.search"]);
  });
});

describe("the published projection", () => {
  it("carries the operation surface and none of the authority", () => {
    const published = publishToolDefinition(SEARCH_TOOL);

    expect(PublishedToolDefinitionSchema.safeParse(published).success).toBe(true);
    expect(published.name).toBe("files.search");
    expect(published.annotations).toEqual({ readOnlyHint: true });
    expect(published.metadata).toEqual({ namespace: FILES_NAMESPACE, source: "sharedos" });
    for (const forbidden of ["requiredCapability", "readWrite", "resolveRequirement", "grants"]) {
      expect(Object.keys(published)).not.toContain(forbidden);
    }
    expect(JSON.stringify(published)).not.toContain('search","resource');
  });

  it("determines readOnlyHint from the required classification, never from a guess", () => {
    const write: ToolDefinition = {
      ...SEARCH_TOOL,
      name: "files.create",
      readWrite: "write",
      requiredCapability: { ...SEARCH_TOOL.requiredCapability, action: "create" },
      annotations: { destructive: true },
    };
    expect(publishToolDefinition(write).annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("refuses a catalogue that publishes one name twice", () => {
    expect(() => publishToolCatalog([SEARCH_TOOL, { ...SEARCH_TOOL }])).toThrow(
      "duplicate tool name",
    );
  });
});

describe("the catalogue hash", () => {
  it("does not depend on the order the tools arrived in", async () => {
    const a = publishToolCatalog([SEARCH_TOOL, { ...SEARCH_TOOL, name: "files.read" }]);
    const b = publishToolCatalog([{ ...SEARCH_TOOL, name: "files.read" }, SEARCH_TOOL]);
    expect(await catalogHash(a)).toBe(await catalogHash(b));
  });

  it("does not depend on how a host ordered the keys inside a schema", async () => {
    const left = publishToolCatalog([
      { ...SEARCH_TOOL, inputSchema: { type: "object", additionalProperties: false } },
    ]);
    const right = publishToolCatalog([
      { ...SEARCH_TOOL, inputSchema: { additionalProperties: false, type: "object" } },
    ]);
    expect(await catalogHash(left)).toBe(await catalogHash(right));
  });

  it("changes on schema drift, a renamed tool, and a missing tool alike", async () => {
    const base = await catalogHash(publishToolCatalog([SEARCH_TOOL]));
    const drifted = await catalogHash(
      publishToolCatalog([{ ...SEARCH_TOOL, inputSchema: { type: "string" } }]),
    );
    const renamed = await catalogHash(publishToolCatalog([{ ...SEARCH_TOOL, name: "files.find" }]));
    const missing = await catalogHash(publishToolCatalog([]));

    expect(new Set([base, drifted, renamed, missing]).size).toBe(4);
  });

  it("does not change when only the execution the catalogue was served for changes", async () => {
    const kernel = kernelWith([grant(["search"])]);
    const one = await kernel.listPublishedTools(context(), { executionId: "exec-1" });
    const two = await kernel.listPublishedTools(context(), { executionId: "exec-2" });

    expect(one.executionId).not.toBe(two.executionId);
    expect(one.catalogHash).toBe(two.catalogHash);
    expect(SharedOSToolCatalogSchema.safeParse(one).success).toBe(true);
  });
});

describe("the permission-filtered catalogue on the wire", () => {
  it("publishes only what the access context may discover", async () => {
    const kernel = kernelWith([grant(["search"])]);
    const catalog = await kernel.listPublishedTools(context(), { executionId: "exec-1" });

    expect(catalog.tools.map(({ name }) => name)).toEqual(["files.search"]);
  });

  it("publishes nothing, and still a well-formed catalogue, when authority is unavailable", async () => {
    const kernel = new SharedOSKernel({
      grantSource: {
        async load() {
          await Promise.resolve();
          throw new Error("the grant store is down");
        },
      },
    });
    const catalog = await kernel.listPublishedTools(context(), { executionId: "exec-1" });

    expect(catalog.tools).toEqual([]);
    expect(SharedOSToolCatalogSchema.safeParse(catalog).success).toBe(true);
  });
});

describe("the MCP server", () => {
  function serverFor(kernel: SharedOSKernel): McpToolServer {
    let counter = 0;
    return new McpToolServer({
      invoker: kernelToolBridge({ kernel, context: context(), executionId: "exec-1" }),
      createId: () => `call-${(counter += 1)}`,
    });
  }

  it("negotiates a revision it knows, and answers an unknown one with its newest", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));

    const known = resultOf(await request(server, "initialize", { protocolVersion: "2024-11-05" }));
    expect(known["protocolVersion"]).toBe("2024-11-05");

    const unknown = resultOf(
      await request(server, "initialize", { protocolVersion: "1999-01-01" }),
    );
    expect(unknown["protocolVersion"]).toBe("2025-06-18");
  });

  it("advertises the tool surface and nothing else", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const initialized = resultOf(await request(server, "initialize"));

    expect(initialized["capabilities"]).toEqual({ tools: { listChanged: false } });

    for (const method of ["resources/list", "prompts/list", "sampling/createMessage"]) {
      const response = await request(server, method);
      expect((response["error"] as JsonObject)["code"]).toBe(-32_601);
    }
  });

  it("serves the catalogue with the hash that identifies it", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const listed = resultOf(await request(server, "tools/list"));
    const tools = listed["tools"] as JsonObject[];

    expect(tools.map((tool) => tool["name"])).toEqual(["files.search"]);
    expect(tools[0]?.["inputSchema"]).toBeDefined();
    expect(tools[0]?.["annotations"]).toEqual({ readOnlyHint: true });
    expect((listed["_meta"] as JsonObject)["sharedos/catalogHash"]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("executes an authorized call through the kernel", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const called = resultOf(
      await request(server, "tools/call", {
        name: "files.search",
        arguments: { path: GRANTED, query: "architecture" },
      }),
    );

    expect(called["isError"]).toBe(false);
    expect(JSON.stringify(called["content"])).toContain("Work/Public");
  });

  it("reports a denial as a tool error and never as a transport error", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const response = await request(server, "tools/call", {
      name: "files.search",
      arguments: { path: UNGRANTED, query: "architecture" },
    });

    expect(response["error"]).toBeUndefined();
    const called = response["result"] as JsonObject;
    expect(called["isError"]).toBe(true);
    expect((called["_meta"] as JsonObject)["sharedos/status"]).toBe("denied");
    expect(JSON.stringify(called["content"])).toContain("denied");
  });

  it("keeps denied and failed distinguishable in the payload", () => {
    const base = { callId: "c1", tool: "files.search", completedAt: NOW } as const;
    const denied = toCallToolResult({
      ...base,
      status: "denied",
      error: { code: "permission_denied", message: "no" },
    } as ToolResult);
    const failed = toCallToolResult({
      ...base,
      status: "failed",
      error: { code: "tool_execution_failed", message: "boom" },
    } as ToolResult);

    expect((denied["_meta"] as JsonObject)["sharedos/status"]).toBe("denied");
    expect((failed["_meta"] as JsonObject)["sharedos/status"]).toBe("failed");
    expect(denied["isError"]).toBe(true);
    expect(failed["isError"]).toBe(true);
  });

  it("lets a guess at an unpublished tool reach the kernel to be refused and recorded", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const called = resultOf(
      await request(server, "tools/call", { name: "files.delete", arguments: { path: GRANTED } }),
    );

    expect(called["isError"]).toBe(true);
    expect((called["_meta"] as JsonObject)["sharedos/code"]).toBe("tool_unavailable");
  });

  it("maps a portable rewrite back to the canonical name", async () => {
    const tools = publishToolCatalog([SEARCH_TOOL]);
    expect(resolveCanonicalName(tools, "files_search")).toBe("files.search");
    expect(resolveCanonicalName(tools, "files.search")).toBe("files.search");
    expect(resolveCanonicalName(tools, "not.a.tool")).toBe("not.a.tool");
    expect(portableToolName("files.snapshot.restore")).toBe("files_snapshot_restore");
  });

  it("answers a notification with nothing, because a notification has no reply", async () => {
    const server = serverFor(kernelWith([grant(["search"])]));
    const response = await server.handle(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      NEVER_ABORTED,
    );

    expect(response).toBeUndefined();
    expect(server.initialized).toBe(true);
  });
});

describe("the turn-scoped bridge", () => {
  function bridgeFor(host: {
    invokeTool(call: ToolCall): Promise<ToolResult>;
  }): SharedOSToolBridge {
    return new SharedOSToolBridge({
      executionId: "exec-1",
      context: { traceId: "trace-1", now: NOW },
      tools: [SEARCH_TOOL],
      host,
    });
  }

  const succeed = async (call: ToolCall): Promise<ToolResult> => ({
    callId: call.id,
    tool: call.tool,
    status: "succeeded",
    output: { ok: true },
    completedAt: NOW,
  });

  it("puts every call through the execution envelope, with the turn's own trace", async () => {
    const seen: ToolCall[] = [];
    const bridge = bridgeFor({
      invokeTool: async (call) => {
        seen.push(call);
        return succeed(call);
      },
    });

    await bridge.invoke(
      { callId: "c1", tool: "files.search", arguments: { path: GRANTED } },
      NEVER_ABORTED,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.traceId).toBe("trace-1");
    expect(seen[0]?.tool).toBe("files.search");
  });

  it("closes with the turn, so a harness that outlives it finds a shut door", async () => {
    const bridge = bridgeFor({ invokeTool: succeed });
    await expect(bridge.catalog(NEVER_ABORTED)).resolves.toBeDefined();

    bridge.close();

    expect(bridge.closed).toBe(true);
    await expect(bridge.catalog(NEVER_ABORTED)).rejects.toThrow("closed with its turn");
    await expect(
      bridge.invoke({ callId: "c2", tool: "files.search", arguments: {} }, NEVER_ABORTED),
    ).rejects.toThrow("closed with its turn");
  });

  it("keeps a harness alias out of the call and in the diagnostic record", async () => {
    const seen: ToolCall[] = [];
    const bridge = bridgeFor({
      invokeTool: async (call) => {
        seen.push(call);
        return succeed(call);
      },
    });

    await bridge.invoke(
      {
        callId: "c1",
        tool: "files.search",
        arguments: {},
        alias: "mcp__sharedos__files_search",
      },
      NEVER_ABORTED,
    );

    expect(seen[0]?.tool).toBe("files.search");
    expect(JSON.stringify(seen[0])).not.toContain("mcp__sharedos");
    expect(bridge.aliases).toEqual([
      { alias: "mcp__sharedos__files_search", tool: "files.search", at: NOW },
    ]);
  });

  it("refuses a request whose turn has already been cancelled", async () => {
    const bridge = bridgeFor({ invokeTool: succeed });
    const controller = new AbortController();
    controller.abort(new Error("turn cancelled"));

    await expect(bridge.catalog(controller.signal)).rejects.toThrow("turn cancelled");
  });
});

describe("the execution token", () => {
  const claims: ExecutionTokenClaims = {
    executionId: "exec-1",
    namespaceId: "world-1",
    actor: "agent:agent-bob",
    catalogHash: "a".repeat(64),
    expiresAt: "2026-08-23T01:00:00.000Z",
  };

  it("round-trips and carries no authority", async () => {
    const token = await mintExecutionToken(claims, "secret");
    const verified = await verifyExecutionToken(token, "secret", { now: NOW });

    expect(verified.valid).toBe(true);
    expect(verified.valid && verified.claims).toEqual(claims);
    expect(JSON.stringify(claims)).not.toContain("grant");
  });

  it("is refused when it was signed by someone else, has expired, or was tampered with", async () => {
    const token = await mintExecutionToken(claims, "secret");

    expect(await verifyExecutionToken(token, "other", { now: NOW })).toEqual({
      valid: false,
      reason: "signature_mismatch",
    });
    expect(
      await verifyExecutionToken(token, "secret", { now: "2026-08-23T02:00:00.000Z" }),
    ).toEqual({ valid: false, reason: "expired" });
    expect(await verifyExecutionToken(`${token}x`, "secret", { now: NOW })).toEqual({
      valid: false,
      reason: "signature_mismatch",
    });
    expect(await verifyExecutionToken("not-a-token", "secret", { now: NOW })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("is refused when it names a different session than the one serving it", async () => {
    const token = await mintExecutionToken(claims, "secret");

    expect(
      await verifyExecutionToken(token, "secret", {
        now: NOW,
        expect: { catalogHash: "b".repeat(64) },
      }),
    ).toEqual({ valid: false, reason: "claims_mismatch" });
    expect(
      await verifyExecutionToken(token, "secret", { now: NOW, expect: { executionId: "exec-1" } }),
    ).toMatchObject({ valid: true });
  });
});

describe("the declared tool policy", () => {
  const brokerOnly = () =>
    declareToolPolicy({
      inventory: "complete",
      harnessLocal: [],
      externalDirect: [],
      evidence: ["host-review://fixture/broker-only-config"],
    });

  it.each(["shell", "apply_patch", "Write", "Read", "TodoWrite"])(
    "classifies local %s outside the broker",
    (tool) => {
      expect(declareToolPolicy({ harnessLocal: [tool] })).toMatchObject({
        version: "2",
        mode: "mixed",
        inventory: "unknown",
        harnessLocal: [tool],
      });
      expect(ToolPolicySchema.safeParse({ ...brokerOnly(), harnessLocal: [tool] }).success).toBe(
        false,
      );
    },
  );

  it("classifies independently connected MCP servers outside the broker", () => {
    expect(declareToolPolicy({ externalDirect: ["github", "browser"] }).mode).toBe("mixed");
    expect(() => parseToolPolicy({ ...brokerOnly(), externalDirect: ["github"] })).toThrow(
      "must be mixed",
    );
  });

  it("does not label an omitted or partial inventory broker-only", () => {
    expect(declareToolPolicy().mode).toBe("unknown");
    expect(declareToolPolicy({ harnessLocal: [] }).mode).toBe("unknown");
    expect(declareToolPolicy({ harnessLocal: [], externalDirect: [] }).mode).toBe("unknown");
    expect(() => declareToolPolicy({ mode: "broker-only" })).toThrow("must be unknown");
    expect(() => declareToolPolicy({ inventory: "complete" })).toThrow("explicitly list");
    expect(() =>
      declareToolPolicy({ inventory: "complete", harnessLocal: [], externalDirect: [] }),
    ).toThrow("supporting evidence");
  });

  it("accepts a declared complete broker-only configuration and preserves its evidence", () => {
    const policy = brokerOnly();
    expect(policy).toEqual({
      version: "2",
      mode: "broker-only",
      inventory: "complete",
      managedMcp: ["sharedos"],
      harnessLocal: [],
      externalDirect: [],
      evidence: ["host-review://fixture/broker-only-config"],
    });
    expect(parseToolPolicy(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
    expect(Object.isFrozen(policy.evidence)).toBe(true);
    expect(() => parseToolPolicy({ ...policy, evidence: [] })).toThrow("supporting evidence");
    expect(() => parseToolPolicy({ ...policy, managedMcp: [] })).toThrow();
  });

  it("rejects legacy strict/hybrid declarations rather than upgrading their claims", () => {
    for (const mode of ["strict", "hybrid"]) {
      expect(
        ToolPolicySchema.safeParse({
          mode,
          managedMcp: ["sharedos"],
          harnessLocal: ["shell"],
          externalDirect: [],
        }).success,
      ).toBe(false);
    }
  });

  it("hashes the classification, inventory, and evidence as part of the declaration", async () => {
    const policy = brokerOnly();
    expect(await toolPolicyHash(policy)).not.toBe(await toolPolicyHash(declareToolPolicy()));
    expect(await toolPolicyHash(policy)).not.toBe(
      await toolPolicyHash({ ...policy, evidence: ["host-review://fixture/other"] }),
    );
  });
});

describe("harness configuration", () => {
  const connection = { url: "http://127.0.0.1:41234/mcp" };

  it("declares a connection and never a tool", () => {
    const emitted = [
      codexMcpConfig(connection),
      JSON.stringify(claudeCodeMcpConfig(connection)),
      deepseekMcpConfig(connection),
      JSON.stringify(claudeAgentSdkMcpOptions(connection)),
    ];

    for (const contents of emitted) {
      expect(contents).toContain("127.0.0.1:41234/mcp");
      expect(contents).not.toContain("files.search");
      expect(contents).not.toContain("inputSchema");
    }
  });

  it("emits each harness's own file", () => {
    expect(harnessMcpConfigFile("codex", connection).filename).toBe("config.toml");
    expect(harnessMcpConfigFile("claude-code", connection).filename).toBe(".mcp.json");
    expect(harnessMcpConfigFile("deepseek", connection).filename).toBe("cordis.patch.yml");
    expect(harnessMcpConfigFile("pi", connection).filename).toBe(".mcp.json");
    expect(codexMcpConfig(connection)).toContain("required = true");
    expect(claudeAgentSdkMcpOptions(connection)["allowedTools"]).toEqual(["mcp__sharedos__*"]);
  });

  it("adds the dsh plugin with `insert`, because a bare id only overrides one", () => {
    const overlay = deepseekMcpConfig(connection);

    // dsh answers a bare `id:` entry naming a plugin that is not already in the
    // tree with `patch: entry "..." not found` on stderr, then boots without it.
    // A run that reached the model with no MCP client at all would read as a
    // harness that declined to use the catalogue rather than as a broken config.
    expect(overlay.startsWith("- insert:")).toBe(true);
    expect(overlay).toContain("@deepseek-ai/dsh-mcp-client");
    expect(overlay).toContain("transport: streamable-http");
    expect(overlay).not.toMatch(/^- id:/mu);
  });

  it("gives Pi an eager connection, because a lazy one may outlive the turn", () => {
    const config = piMcpConfig(connection);
    const server = (config["mcpServers"] as JsonObject)["sharedos"] as JsonObject;

    expect(server["url"]).toBe(connection.url);
    expect(server["lifecycle"]).toBe("eager");
    expect(JSON.stringify(config)).not.toContain("files.search");
  });

  it("records the harness-side alias without ever authorizing against it", () => {
    expect(harnessToolAlias("sharedos", "files.search")).toBe("mcp__sharedos__files_search");
  });
});

describe("a harness talking to the real transport", () => {
  it("discovers, calls, and is refused, over Streamable HTTP", async () => {
    const kernel = kernelWith([grant(["search"])]);
    const server = new McpToolServer({
      invoker: kernelToolBridge({ kernel, context: context(), executionId: "exec-1" }),
    });
    const http = await createStreamableHttpMcpServer({ server });

    try {
      const post = async (body: unknown): Promise<JsonObject> => {
        const response = await fetch(http.url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        return (await response.json()) as JsonObject;
      };

      const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      expect((initialized["result"] as JsonObject)["serverInfo"]).toMatchObject({
        name: "sharedos",
      });

      const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      expect(((listed["result"] as JsonObject)["tools"] as JsonObject[]).length).toBeGreaterThan(0);

      const allowed = await post({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "files.search", arguments: { path: GRANTED, query: "x" } },
      });
      expect((allowed["result"] as JsonObject)["isError"]).toBe(false);

      const denied = await post({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "files.search", arguments: { path: UNGRANTED, query: "x" } },
      });
      expect(denied["error"]).toBeUndefined();
      expect((denied["result"] as JsonObject)["isError"]).toBe(true);
    } finally {
      await http.close();
    }
  });

  it("answers a session id from a turn that has ended with 404, not with tools", async () => {
    const kernel = kernelWith([grant(["search"])]);
    const http = await createStreamableHttpMcpServer({
      server: new McpToolServer({
        invoker: kernelToolBridge({ kernel, context: context(), executionId: "exec-1" }),
      }),
    });

    try {
      const response = await fetch(http.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "mcp-session-id": "a-session-from-a-previous-turn",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(404);
    } finally {
      await http.close();
    }
  });

  it("refuses a sandboxed harness presenting no token", async () => {
    const kernel = kernelWith([grant(["search"])]);
    const http = await createStreamableHttpMcpServer({
      server: new McpToolServer({
        invoker: kernelToolBridge({ kernel, context: context(), executionId: "exec-1" }),
      }),
      authorize: (token) => token === "the-execution-token",
    });

    try {
      const anonymous = await fetch(http.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(anonymous.status).toBe(401);

      const authorized = await fetch(http.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: "Bearer the-execution-token",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(authorized.status).toBe(200);
    } finally {
      await http.close();
    }
  });

  it("serves the same catalogue over stdio", async () => {
    const { PassThrough } = await import("node:stream");
    const kernel = kernelWith([grant(["search"])]);
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on("data", (chunk: Buffer) => lines.push(chunk.toString("utf8")));

    const served = serveMcpOverStdio(
      new McpToolServer({
        invoker: kernelToolBridge({ kernel, context: context(), executionId: "exec-1" }),
      }),
      { input, output },
    );

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    input.end();
    await served;

    const answered = JSON.parse(lines.join("").trim()) as JsonObject;
    const tools = (answered["result"] as JsonObject)["tools"] as JsonObject[];
    expect(tools.map((tool) => tool["name"])).toContain("files.search");
  });
});

describe("canonicalActor", () => {
  it("renders every address kind as kind:id, the pair a recipient grant path uses", () => {
    expect(canonicalActor({ kind: "agent", agentId: "agent-bob" })).toBe("agent:agent-bob");
    expect(canonicalActor({ kind: "human", userId: "user-alice" })).toBe("human:user-alice");
    expect(canonicalActor({ kind: "group", conversationId: "c-1" })).toBe("group:c-1");
    expect(canonicalActor({ kind: "service", serviceId: "svc" })).toBe("service:svc");
  });
});
