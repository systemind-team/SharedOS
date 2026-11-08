import { describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  Address,
  CapabilityRequest,
  CapabilityGrant,
  JsonObject,
  MessageDeliveryResult,
  MessageEnvelope,
  ResourceRef,
  ToolCall,
  ToolDefinition,
} from "@aicoo/sharedos-contracts";

import type { AuditEvent, AuditSink } from "./audit.js";
import type { GrantSource, LoadedPolicy, PolicySource } from "./authority.js";
import {
  CapabilityAuthorizer,
  type HostCeiling,
  type GrantUsageStore,
  InMemoryGrantUsageStore,
} from "./authorization.js";
import type { ProviderErrorContext, ProviderErrorReporter } from "./diagnostics.js";
import { AuditUnavailableError, AuditWriteTimeoutError } from "./errors.js";
import { SharedOSKernel, type SharedOSKernelOptions } from "./kernel.js";
import {
  addressPath,
  type MessageRequestRouter,
  type MessageTransport,
} from "./message-service.js";
import { MESSAGE_REQUEST_TOOL_DEFINITION, MESSAGE_REQUEST_TOOL_NAME } from "./message-tool.js";
import { catalogHash, publishToolCatalog } from "./published-tool.js";
import {
  ResourceProviderRegistry,
  type ResourceInvocationRequest,
  type ResourceProvider,
} from "./resource-registry.js";
import {
  applyToolNamespaceUpdate,
  type ToolNamespaceSettingsStore,
} from "./tool-namespace-control.js";
import { type ContextToolProvider, type ToolHandler, ToolRegistry } from "./tool-registry.js";

const NOW = "2026-08-03T09:00:00.000Z";
const ACTOR = { kind: "agent", agentId: "agent-bob" } as const;
const AUTHORITY = { kind: "human", userId: "user-alice" } as const;
const OWNER = { kind: "human", userId: "user-alice" } as const;
const RECEIVER = { kind: "agent", agentId: "agent-tina" } as const;

function grant(
  id: string,
  resource: ResourceRef,
  actions: string[],
  constraints: CapabilityGrant["constraints"] = {},
): CapabilityGrant {
  return {
    id,
    namespaceId: "world-alpha",
    subject: ACTOR,
    issuer: AUTHORITY,
    capabilities: [{ resource, actions, scope: "exact" }],
    constraints,
    issuedAt: "2026-08-03T08:00:00.000Z",
  };
}

function context(enabledToolNamespaces: readonly string[] = ["files", "calendar"]): AccessContext {
  return {
    namespaceId: "world-alpha",
    enabledToolNamespaces: [...enabledToolNamespaces],
    actor: ACTOR,
    authority: AUTHORITY,
    owner: OWNER,
    purpose: "prepare-update",
    traceId: "trace-1",
    now: NOW,
  };
}

/** A host grant store under test control; authority never rides in the context. */
class TestGrantSource implements GrantSource {
  #grants: readonly CapabilityGrant[];

  constructor(grants: readonly CapabilityGrant[] = []) {
    this.#grants = grants;
  }

  serve(grants: readonly CapabilityGrant[]): this {
    this.#grants = grants;
    return this;
  }

  async load(access: AccessContext): Promise<readonly CapabilityGrant[]> {
    await Promise.resolve();
    return this.#grants.filter((entry) => entry.namespaceId === access.namespaceId);
  }
}

function kernelWith(
  grants: readonly CapabilityGrant[] = [],
  options: Omit<SharedOSKernelOptions, "grantSource"> = {},
): SharedOSKernel {
  return new SharedOSKernel({ ...options, grantSource: new TestGrantSource(grants) });
}

const FILE_RESOURCE: ResourceRef = {
  namespace: "files",
  path: ["Workspace", "project-sharedos"],
};

const FILE_TOOL: ToolDefinition = {
  name: "files.search",
  description: "Search files visible to the current agent",
  namespace: "files",
  source: "sharedos",
  readWrite: "read",
  inputSchema: { type: "object" },
  requiredCapability: { resource: FILE_RESOURCE, action: "search" },
  annotations: { readOnly: true },
};

const CALENDAR_TOOL: ToolDefinition = {
  name: "calendar.create",
  description: "Create a calendar event",
  namespace: "calendar",
  source: "native",
  readWrite: "write",
  inputSchema: { type: "object" },
  requiredCapability: {
    resource: { namespace: "calendar", path: ["primary"] },
    action: "create",
  },
  annotations: { destructive: true },
};

const NOTION_TOOL: ToolDefinition = {
  name: "mcp.notion.search",
  description: "Search one Notion workspace",
  namespace: "notion",
  source: "mcp",
  readWrite: "read",
  inputSchema: { type: "object" },
  requiredCapability: {
    resource: { namespace: "notion", path: ["workspace-a"] },
    action: "read",
  },
  annotations: { readOnly: true },
};

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "call-1",
    tool: FILE_TOOL.name,
    arguments: { query: "architecture" },
    traceId: "trace-1",
    requestedAt: NOW,
    ...overrides,
  };
}

function successfulTool(definition = FILE_TOOL): ToolHandler {
  return {
    definition,
    parseArguments: (arguments_) => arguments_,
    async invoke(_context, call) {
      return {
        callId: call.id,
        tool: call.tool,
        status: "succeeded",
        output: { hits: ["memory-1"] },
        completedAt: NOW,
      };
    },
  };
}

describe("SharedOSKernel escalation", () => {
  it("records an escalation as its own outcome and grants nothing", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (event) => void events.push(event) } });

    const escalation = await kernel.recordEscalation(
      context(),
      "issuing a grant is outside this agent's authority",
    );

    expect(escalation).toEqual({
      reason: "issuing a grant is outside this agent's authority",
      // Assumed, not resolved: the owner the turn already runs on behalf of.
      reviewer: OWNER,
      requestedAt: NOW,
      status: "pending",
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "escalation.requested",
        // Not a denial. SharedOS did not decide this; it declined to.
        outcome: "escalated",
        reason: "escalation_requested",
        actor: ACTOR,
        metadata: expect.objectContaining({ reviewer: OWNER, reviewerAssumed: true }),
      }),
    ]);
  });

  it("does not let an escalation change what the actor may do", async () => {
    const kernel = kernelWith([]);
    kernel.registerTool(successfulTool());

    await kernel.recordEscalation(context(), "needs a human");

    // The store is the only thing that grants authority, and recording a
    // request against it changed nothing there.
    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });
  });

  it("refuses an escalation with no stated reason", async () => {
    const kernel = kernelWith([]);

    await expect(kernel.recordEscalation(context(), "   ")).rejects.toThrow(TypeError);
  });

  it("carries the capability a denial described into the escalation and its audit event", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (event) => void events.push(event) } });
    const request = {
      resource: { namespace: "files", path: ["Memory", "project-x"], owner: OWNER },
      action: "read",
    };

    // The round trip ADR 0019 exists for: the authorizer says what was missing,
    // and the host hands that back verbatim when it escalates the denial. No
    // reconstruction from prose, and nothing here grants anything.
    const denial = await kernel.authorize(context(), request);
    expect(denial.reasonCode).toBe("no_matching_grant");

    const escalation = await kernel.recordEscalation(context(), "alice should decide this", {
      ...(denial.requiredAuthority === undefined
        ? {}
        : { requestedAuthority: denial.requiredAuthority }),
    });

    expect(escalation.requestedAuthority).toEqual(denial.requiredAuthority);
    expect(escalation.status).toBe("pending");
    // A first-class audit field, so a reviewer's queue is built from audit alone
    // rather than from an untyped bag that happens to hold the right shape.
    expect(events.at(-1)).toMatchObject({
      type: "escalation.requested",
      outcome: "escalated",
      requestedAuthority: {
        capabilities: [{ resource: request.resource, actions: ["read"], scope: "exact" }],
      },
    });
  });

  it("copies the capability request, so a later edit cannot rewrite the record", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (event) => void events.push(event) } });
    const request = {
      id: "capreq-1",
      namespaceId: "world-alpha",
      requester: ACTOR,
      owner: OWNER,
      capabilities: [
        {
          resource: { namespace: "files", path: ["Memory"], owner: OWNER },
          actions: ["read"],
          scope: "exact" as const,
        },
      ],
      purpose: "prepare-update",
      requestedAt: NOW,
    };

    const escalation = await kernel.recordEscalation(context(), "alice should decide", {
      requestedAuthority: request,
    });
    request.capabilities[0]!.actions.push("delete");

    // A reviewer's queue is built from what was recorded, so the record cannot
    // be a live view of the caller's object. Guaranteed twice over today -- the
    // schema parse copies, and so does the explicit clone -- and this pins the
    // property rather than either mechanism, so removing one does not quietly
    // leave the other as the only guard. Verified by mutation: dropping the
    // clone alone does not fail this test, which is the point of saying so.
    expect(escalation.requestedAuthority?.capabilities[0]?.actions).toEqual(["read"]);
    expect(events.at(-1)).toMatchObject({
      requestedAuthority: { capabilities: [{ actions: ["read"] }] },
    });
  });

  it("mints the request from the trusted context, whatever the caller wrote about identity", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (event) => void events.push(event) } });
    const denial = await kernel.authorize(context(), {
      resource: { namespace: "files", path: ["Memory", "project-x"], owner: OWNER },
      action: "read",
    });
    const described = denial.requiredAuthority;
    if (described === undefined) {
      throw new Error("expected the denial to describe what was missing");
    }

    const authored: CapabilityRequest = {
      ...described,
      id: "chosen-by-caller",
      namespaceId: "world-other",
      requester: RECEIVER,
      owner: { kind: "human", userId: "user-mallory" },
      requestedAt: "2020-01-01T00:00:00.000Z",
    };
    const escalation = await kernel.recordEscalation(context(), "alice should decide", {
      requestedAuthority: authored,
    });

    // A request the caller authored would be a caller-chosen correlation for a
    // decision the kernel made, so what it wrote about identity is discarded
    // and minted again from the context (ADR 0019). It comes back as the same
    // identifier the denial carried, because both were minted from one ask.
    expect(escalation.requestedAuthority).toEqual(described);
    expect(escalation.requestedAuthority).toMatchObject({
      namespaceId: "world-alpha",
      requester: ACTOR,
      owner: OWNER,
      requestedAt: NOW,
    });
    expect(escalation.requestedAuthority?.id).toMatch(/^capreq-[0-9a-f]{64}$/u);
    expect(events.at(-1)?.requestedAuthority).toEqual(described);
  });

  it("refuses an escalation whose ask is not a valid request", async () => {
    const kernel = kernelWith([]);

    await expect(
      kernel.recordEscalation(context(), "alice should decide", {
        requestedAuthority: { capabilities: [], purpose: "prepare-update" },
      }),
    ).rejects.toThrow(TypeError);
  });

  it("records an escalation with no capability when nothing named one", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (event) => void events.push(event) } });

    // A model-chosen escalation usually has only a sentence. The field stays
    // absent rather than being filled with a guess.
    const escalation = await kernel.recordEscalation(context(), "this needs a person");

    expect(escalation.requestedAuthority).toBeUndefined();
    expect(events.at(-1)).not.toHaveProperty("requestedAuthority");
  });
});

describe("SharedOSKernel tools", () => {
  it("requires namespace enablement and capability authority independently", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const authority = new TestGrantSource();
    const kernel = new SharedOSKernel({ grantSource: authority });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke,
    });
    const fileGrant = grant("grant-search", FILE_RESOURCE, ["search"]);

    authority.serve([fileGrant]);
    const namespaceDisabled = context([]);
    await expect(kernel.listTools(namespaceDisabled)).resolves.toEqual([]);
    await expect(kernel.invokeTool(namespaceDisabled, toolCall())).resolves.toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });

    authority.serve([]);
    const capabilityMissing = context(["files"]);
    await expect(kernel.listTools(capabilityMissing)).resolves.toEqual([]);
    await expect(kernel.invokeTool(capabilityMissing, toolCall())).resolves.toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });

    authority.serve([fileGrant]);
    const fullyEnabled = context(["files"]);
    await expect(kernel.listTools(fullyEnabled)).resolves.toEqual([FILE_TOOL]);
    await expect(kernel.invokeTool(fullyEnabled, toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("lists namespace availability without treating it as authority", async () => {
    const kernel = kernelWith();
    kernel.registerTool(successfulTool(FILE_TOOL));
    kernel.registerTool(successfulTool(CALENDAR_TOOL));

    await expect(kernel.listToolNamespaces(context(["calendar"]))).resolves.toEqual({
      namespaces: [
        { namespace: "calendar", sources: ["native"], toolCount: 1, enabled: true },
        { namespace: "files", sources: ["sharedos"], toolCount: 1, enabled: false },
      ],
      summary: { total: 2, enabled: 1, disabled: 1 },
    });
    await expect(kernel.listTools(context(["calendar"]))).resolves.toEqual([]);
  });

  it("applies namespace updates through host-owned settings and returns the effective catalog", async () => {
    const events: AuditEvent[] = [];
    const applyUpdate = vi.fn<ToolNamespaceSettingsStore["applyUpdate"]>(async (access, update) =>
      applyToolNamespaceUpdate(access.enabledToolNamespaces, update),
    );
    const kernel = kernelWith([], {
      toolNamespaceSettings: { applyUpdate },
      audit: { record: async (event) => void events.push(event) },
    });
    kernel.registerTool(successfulTool(FILE_TOOL));
    kernel.registerTool(successfulTool(CALENDAR_TOOL));
    const access = context(["files"]);

    await expect(
      kernel.updateToolNamespaces(access, {
        enable: ["calendar"],
        disable: ["files"],
      }),
    ).resolves.toEqual({
      namespaces: [
        { namespace: "calendar", sources: ["native"], toolCount: 1, enabled: true },
        { namespace: "files", sources: ["sharedos"], toolCount: 1, enabled: false },
      ],
      summary: { total: 2, enabled: 1, disabled: 1 },
    });

    expect(access.enabledToolNamespaces).toEqual(["files"]);
    expect(applyUpdate).toHaveBeenCalledWith(
      access,
      { enable: ["calendar"], disable: ["files"] },
      expect.any(AbortSignal),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.namespace.selection.updated",
        outcome: "succeeded",
        metadata: { enabledNamespaces: ["calendar"] },
      }),
    );
  });

  it("fails namespace updates closed without a valid host settings store", async () => {
    await expect(
      kernelWith().updateToolNamespaces(context([]), { enable: ["calendar"] }),
    ).rejects.toThrow("tool namespace settings is not registered");

    const kernel = kernelWith([], {
      toolNamespaceSettings: {
        async applyUpdate() {
          return ["calendar", "calendar"];
        },
      },
    });
    await expect(
      kernel.updateToolNamespaces(context([]), { enable: ["calendar"] }),
    ).rejects.toThrow("tool namespace settings returned an invalid selection");
  });

  it("resolves user-specific MCP namespaces without mutating a global catalog", async () => {
    const githubTool: ToolDefinition = {
      ...NOTION_TOOL,
      name: "mcp.github.search",
      description: "Search one GitHub organization",
      namespace: "github",
      requiredCapability: {
        resource: { namespace: "github", path: ["org-a"] },
        action: "read",
      },
    };
    const provider: ContextToolProvider = {
      id: "user-mcp",
      async listTools(access) {
        await Promise.resolve();
        return access.namespaceId === "world-alpha"
          ? [successfulTool(NOTION_TOOL)]
          : [successfulTool(githubTool)];
      },
    };
    const kernel = kernelWith([], { toolProviders: [provider] });
    const alpha = context(["notion"]);
    const beta = { ...context(["github"]), namespaceId: "world-beta" };

    const [alphaCatalog, betaCatalog] = await Promise.all([
      kernel.listToolNamespaces(alpha),
      kernel.listToolNamespaces(beta),
    ]);

    expect(alphaCatalog.namespaces).toEqual([
      { namespace: "notion", sources: ["mcp"], toolCount: 1, enabled: true },
    ]);
    expect(betaCatalog.namespaces).toEqual([
      { namespace: "github", sources: ["mcp"], toolCount: 1, enabled: true },
    ]);
  });

  it("fails closed when a context provider returns an ambiguous catalog", async () => {
    const staticInvoke = vi.fn(successfulTool(NOTION_TOOL).invoke);
    const dynamicInvoke = vi.fn(successfulTool(NOTION_TOOL).invoke);
    const notionGrant = grant("grant-notion", { namespace: "notion", path: ["workspace-a"] }, [
      "read",
    ]);
    const kernel = kernelWith([notionGrant], {
      toolProviders: [
        {
          id: "user-mcp",
          async listTools() {
            return [
              {
                definition: NOTION_TOOL,
                parseArguments: (arguments_) => arguments_,
                invoke: dynamicInvoke,
              },
            ];
          },
        },
      ],
    });
    kernel.registerTool({
      definition: NOTION_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: staticInvoke,
    });
    const access = context(["notion"]);

    await expect(kernel.listTools(access)).rejects.toThrow("tool is already registered");
    await expect(
      kernel.invokeTool(access, toolCall({ tool: NOTION_TOOL.name })),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "tool_catalog_unavailable" },
    });
    expect(staticInvoke).not.toHaveBeenCalled();
    expect(dynamicInvoke).not.toHaveBeenCalled();
  });

  it("filters discovery and re-authorizes every invocation", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith(
      [grant("grant-search-once", FILE_RESOURCE, ["search"], { maxUses: 1 })],
      { authorizer: new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() }) },
    );
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke,
    });
    kernel.registerTool(successfulTool(CALENDAR_TOOL));
    const access = context();

    await expect(kernel.listTools(access)).resolves.toEqual([FILE_TOOL]);
    await expect(kernel.listTools(access)).resolves.toEqual([FILE_TOOL]);

    await expect(kernel.invokeTool(access, toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });
    await expect(kernel.invokeTool(access, toolCall({ id: "call-2" }))).resolves.toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects trace substitution before spending or calling a tool", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"], { maxUses: 1 })], {
      authorizer: new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() }),
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke,
    });
    const access = context();

    await expect(
      kernel.invokeTool(access, toolCall({ traceId: "trace-other" })),
    ).resolves.toMatchObject({
      status: "denied",
      error: { code: "trace_mismatch" },
    });
    await expect(kernel.invokeTool(access, toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discovers a generic OS tool from a narrow grant and gates its exact arguments", async () => {
    const dynamicTool: ToolDefinition = {
      name: "files.read",
      description: "Read one selected file path",
      namespace: "files",
      source: "sharedos",
      readWrite: "read",
      inputSchema: { type: "object" },
      requiredCapability: {
        resource: { namespace: "files", path: [] },
        action: "read",
      },
    };
    const invoke = vi.fn<ToolHandler["invoke"]>(async (_access, call) => ({
      callId: call.id,
      tool: call.tool,
      status: "succeeded",
      output: { value: "permitted memory" },
      completedAt: NOW,
    }));
    const kernel = kernelWith([
      grant("grant-project-x", { namespace: "files", path: ["Workspace", "project-x"] }, ["read"]),
    ]);
    kernel.registerTool({
      definition: dynamicTool,
      parseArguments: (arguments_) => arguments_,
      resolveRequirement(_access, call) {
        const project = call.arguments["project"];
        if (typeof project !== "string") {
          throw new TypeError("project is required");
        }
        return {
          resource: { namespace: "files", path: ["Workspace", project] },
          action: "read",
        };
      },
      invoke,
    });
    const access = context();

    await expect(kernel.listTools(access)).resolves.toEqual([dynamicTool]);
    await expect(
      kernel.invokeTool(
        access,
        toolCall({
          id: "read-x",
          tool: "files.read",
          arguments: { project: "project-x" },
        }),
      ),
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      kernel.invokeTool(
        access,
        toolCall({
          id: "read-y",
          tool: "files.read",
          arguments: { project: "project-y" },
        }),
      ),
    ).resolves.toMatchObject({
      status: "denied",
      error: { code: "no_matching_grant" },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects a dynamic requirement outside the tool declaration ceiling", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([
      grant("grant-files-discovery", FILE_RESOURCE, ["search"]),
      grant("grant-calendar", { namespace: "calendar", path: ["primary"] }, ["create"]),
    ]);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      resolveRequirement() {
        return {
          resource: { namespace: "calendar", path: ["primary"] },
          action: "create",
        };
      },
      invoke,
    });
    const access = context();

    await expect(kernel.invokeTool(access, toolCall())).resolves.toMatchObject({
      status: "failed",
      error: { code: "invalid_tool_requirement" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a result that answers a call the kernel never made", async () => {
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])]);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      async invoke(access, call) {
        // Everything up to here is correct: the requirement is inside the
        // declared ceiling and the caller genuinely holds the authority for it.
        // Only the identifier on the way back belongs to a different call.
        return {
          callId: `${call.id}-other`,
          tool: call.tool,
          status: "succeeded",
          output: { hits: [] },
          completedAt: access.now,
        };
      },
    });

    const result = await kernel.invokeTool(context(), toolCall());

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "invalid_tool_result" },
    });
    // The refusal is attributed to the call that was actually authorized, so a
    // provider cannot detach its work from the decision that permitted it.
    expect(result.callId).toBe(toolCall().id);
  });

  it("rejects a result naming a tool other than the one that was invoked", async () => {
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])]);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      async invoke(access, call) {
        return {
          callId: call.id,
          tool: "calendar.create",
          status: "succeeded",
          output: {},
          completedAt: access.now,
        };
      },
    });

    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "failed",
      error: { code: "invalid_tool_result" },
    });
  });

  it("refuses another owner's resource as a denial, not as a tool defect", async () => {
    const events: AuditEvent[] = [];
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      // The provider resolves exactly what the caller named, including an owner
      // outside this world. Clamping it here would make the kernel look correct
      // while the provider did the enforcing.
      resolveRequirement: () => ({
        resource: { ...FILE_RESOURCE, owner: { kind: "human", userId: "user-mallory" } },
        action: "search",
      }),
      invoke,
    });

    const result = await kernel.invokeTool(context(), toolCall());

    // A world crossing is a denial the authorizer has a code for. Reporting it
    // as `invalid_tool_requirement` would say the tool misbehaved, when the tool
    // faithfully resolved a request that is simply not permitted.
    expect(result).toMatchObject({
      status: "denied",
      error: { code: "invalid_request" },
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "authorization.checked",
          outcome: "denied",
          reason: "invalid_request",
        }),
      ]),
    );
  });

  it("does not expose provider exceptions or invalid protocol responses", async () => {
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])]);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      async invoke() {
        throw new Error("secret provider credential");
      },
    });
    const access = context();

    const result = await kernel.invokeTool(access, toolCall());
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "tool_execution_failed" },
    });
    expect(JSON.stringify(result)).not.toContain("secret provider credential");
  });

  it("validates arguments before authorization and execution", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])]);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments(arguments_) {
        if (typeof arguments_["query"] !== "string") {
          throw new TypeError("query is required");
        }
        return arguments_;
      },
      invoke,
    });
    const access = context();

    await expect(
      kernel.invokeTool(access, toolCall({ arguments: { query: 42 } })),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "invalid_tool_arguments" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a parser that returns anything but a JSON object, before authorization", async () => {
    const seen: unknown[] = [];
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void seen.push(event.type) },
    });
    const returns: unknown[] = [
      { query: "architecture", at: new Date(0) },
      { query: undefined },
      { query: Number.POSITIVE_INFINITY },
      new Map(),
      "architecture",
    ];
    let index = 0;
    const invoke = vi.fn(successfulTool().invoke);
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: () => returns[index],
      invoke,
    });

    for (index = 0; index < returns.length; index += 1) {
      await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
        status: "failed",
        error: { code: "invalid_tool_arguments" },
      });
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(seen).not.toContain("authorization.checked");
  });

  it("hands the tool the parser's normalization as a plain JSON object", async () => {
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])]);
    const normalized = Object.create({ inherited: "kept" }) as Record<string, unknown>;
    normalized["query"] = "architecture";
    Object.defineProperty(normalized, "hidden", { value: "dropped", enumerable: false });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: () => ({
        ...JSON.parse('{"__proto__":{"x":1}}'),
        ...normalized,
        nested: normalized,
      }),
      invoke,
    });

    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });
    const call = invoke.mock.calls[0]?.[1];
    expect(call?.arguments).toEqual({
      query: "architecture",
      nested: { query: "architecture", inherited: "kept" },
    });
    expect(Object.getOwnPropertyNames(call?.arguments)).toEqual(["query", "nested"]);
    expect(Object.getPrototypeOf(call?.arguments)).toBe(Object.prototype);
    expect(Object.isFrozen(call?.arguments["nested"])).toBe(true);
  });

  it("does not reveal whether an undiscoverable tool is registered", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], {
      audit: { record: async (event) => void events.push(event) },
    });
    kernel.registerTool(successfulTool());

    const registered = await kernel.invokeTool(context(), toolCall());
    const missing = await kernel.invokeTool(context(), toolCall({ tool: "private.connector" }));

    expect(registered).toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });
    expect(missing).toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "authorization.checked",
          outcome: "denied",
          reason: "no_matching_grant",
        }),
      ]),
    );
  });
});

describe("SharedOSKernel catalogue resolution", () => {
  const NOTION_GRANT = grant("grant-notion", { namespace: "notion", path: ["workspace-a"] }, [
    "read",
  ]);

  function notionCall(id: string): ToolCall {
    return toolCall({ id, tool: NOTION_TOOL.name });
  }

  function providerOf(listTools: ContextToolProvider["listTools"]): ContextToolProvider {
    return { id: "user-mcp", listTools };
  }

  it("isolates catalogues of executions sharing their access fields", async () => {
    let available = true;
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () =>
      available ? [successfulTool(NOTION_TOOL)] : [],
    );
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const firstContext = { ...context(["notion"]), executionId: "execution-a" };
    const secondContext = { ...context(["notion"]), executionId: "execution-b" };
    const first = await kernel.openTurnAuthority(firstContext);
    await expect(kernel.listTools(firstContext)).resolves.toEqual([NOTION_TOOL]);
    available = false;
    const second = await kernel.openTurnAuthority(secondContext);
    try {
      await expect(kernel.listTools(secondContext)).resolves.toEqual([]);
      await expect(kernel.listTools(firstContext)).resolves.toEqual([NOTION_TOOL]);
      expect(listTools).toHaveBeenCalledTimes(2);
    } finally {
      first.close();
      second.close();
    }
  });

  it("preserves a turn's lease through nested kernel calls and live namespace checks", async () => {
    let revoked = false;
    const load = vi.fn<GrantSource["load"]>(async () => (revoked ? [] : [NOTION_GRANT]));
    const kernel = new SharedOSKernel({ grantSource: { load } });
    const handler = successfulTool(NOTION_TOOL);
    kernel.registerTool({
      ...handler,
      invoke: async (access, call, signal) => {
        const nested = { ...access, now: "2026-08-03T09:01:00.000Z" };
        await expect(
          kernel.authorize(nested, NOTION_TOOL.requiredCapability, { signal }),
        ).resolves.toMatchObject({ allowed: true });
        await expect(
          kernel.authorize(
            nested,
            {
              resource: { namespace: "notion", path: ["other-workspace"] },
              action: "read",
            },
            { signal },
          ),
        ).resolves.toMatchObject({ allowed: false });
        return handler.invoke(access, call, signal);
      },
    });
    const access = { ...context(["notion"]), executionId: "nested-turn" };
    const scope = await kernel.openTurnAuthority(access);
    revoked = true;
    try {
      await expect(kernel.invokeTool(access, notionCall("nested"))).resolves.toMatchObject({
        status: "succeeded",
      });
      await expect(
        kernel.invokeTool({ ...access, enabledToolNamespaces: [] }, notionCall("disabled")),
      ).resolves.toMatchObject({ status: "denied" });
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      scope.close();
    }
  });

  it("resolves the effective catalogue once per turn, however many operations the turn makes", async () => {
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () => [
      successfulTool(NOTION_TOOL),
    ]);
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await expect(kernel.listTools(access)).resolves.toEqual([NOTION_TOOL]);
      for (let index = 0; index < 4; index += 1) {
        await expect(kernel.invokeTool(access, notionCall(`call-${index}`))).resolves.toMatchObject(
          {
            status: "succeeded",
          },
        );
      }
    } finally {
      scope.close();
    }

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("answers a call from the definition the turn listed, not one the provider changed since", async () => {
    // The property ADR 0026 is about. The provider is live, and between the
    // listing and the call it moves the tool onto a resource no grant covers.
    // A turn that re-derived would decide the call against a capability the
    // catalogue it recorded never advertised; a turn that holds one does not.
    let definition = NOTION_TOOL;
    const kernel = kernelWith([NOTION_GRANT], {
      toolProviders: [providerOf(async () => [successfulTool(definition)])],
    });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await expect(kernel.listTools(access)).resolves.toEqual([NOTION_TOOL]);
      definition = {
        ...NOTION_TOOL,
        requiredCapability: {
          resource: { namespace: "notion", path: ["workspace-b"] },
          action: "read",
        },
      };

      await expect(kernel.invokeTool(access, notionCall("call-1"))).resolves.toMatchObject({
        status: "succeeded",
      });
    } finally {
      scope.close();
    }
  });

  it("asks the provider again on the next turn, so the catalogue is held per turn and not once", async () => {
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () => [
      successfulTool(NOTION_TOOL),
    ]);
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);

    for (let turn = 0; turn < 2; turn += 1) {
      const scope = await kernel.openTurnAuthority(access);
      try {
        await kernel.listTools(access);
        await kernel.invokeTool(access, notionCall(`call-${turn}`));
      } finally {
        scope.close();
      }
    }

    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("resolves per operation outside a turn, which is a turn of one operation", async () => {
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () => [
      successfulTool(NOTION_TOOL),
    ]);
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);

    await kernel.listTools(access);
    await kernel.invokeTool(access, notionCall("call-1"));

    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("holds no failed resolution, so the next operation in the turn derives again", async () => {
    const listTools = vi
      .fn<ContextToolProvider["listTools"]>()
      .mockRejectedValueOnce(new Error("the user's MCP server is unreachable"))
      .mockResolvedValue([successfulTool(NOTION_TOOL)]);
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await expect(kernel.invokeTool(access, notionCall("call-1"))).resolves.toMatchObject({
        status: "failed",
        error: { code: "tool_catalog_unavailable" },
      });
      await expect(kernel.invokeTool(access, notionCall("call-2"))).resolves.toMatchObject({
        status: "succeeded",
      });
    } finally {
      scope.close();
    }

    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("holds one derivation for operations that need the catalogue at the same moment", async () => {
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () => {
      await Promise.resolve();
      return [successfulTool(NOTION_TOOL)];
    });
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await Promise.all([
        kernel.listTools(access),
        kernel.invokeTool(access, notionCall("call-1")),
        kernel.invokeTool(access, notionCall("call-2")),
      ]);
    } finally {
      scope.close();
    }

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("lets one operation abandon the shared derivation without answering for the rest", async () => {
    // Sharing a derivation is the point; sharing a cancellation is not. The
    // signal belongs to the operation that happened to need a catalogue first,
    // and a turn's other operations never consented to it.
    let release!: (tools: readonly ToolHandler[]) => void;
    const listTools = vi.fn<ContextToolProvider["listTools"]>(
      async () => await new Promise<readonly ToolHandler[]>((resolve) => (release = resolve)),
    );
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);
    const giving_up = new AbortController();

    const scope = await kernel.openTurnAuthority(access);
    try {
      const abandoned = kernel.listTools(access, { signal: giving_up.signal });
      const staying = kernel.invokeTool(access, notionCall("call-1"));
      const noSignal = kernel.listTools(access);
      await Promise.resolve();

      giving_up.abort(new Error("this caller gave up"));
      await expect(abandoned).rejects.toThrow("this caller gave up");

      release([successfulTool(NOTION_TOOL)]);
      await expect(staying).resolves.toMatchObject({ status: "succeeded" });
      await expect(noSignal).resolves.toEqual([NOTION_TOOL]);
    } finally {
      scope.close();
    }

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("cancels the shared derivation once every operation waiting on it has gone", async () => {
    // The other half of the same decision: a derivation nobody is waiting for
    // is work nobody asked for, so abandoning the last one still cancels it.
    let derivationSignal: AbortSignal | undefined;
    const listTools = vi.fn<ContextToolProvider["listTools"]>(
      async (_context, signal) =>
        await new Promise<readonly ToolHandler[]>((_resolve, reject) => {
          derivationSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("derivation cancelled")));
        }),
    );
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const access = context(["notion"]);
    const first = new AbortController();
    const second = new AbortController();

    const scope = await kernel.openTurnAuthority(access);
    try {
      const one = kernel.listTools(access, { signal: first.signal });
      const two = kernel.listTools(access, { signal: second.signal });
      await Promise.resolve();

      first.abort(new Error("one gave up"));
      await expect(one).rejects.toThrow("one gave up");
      expect(derivationSignal?.aborted).toBe(false);

      second.abort(new Error("two gave up"));
      await expect(two).rejects.toThrow("two gave up");
      expect(derivationSignal?.aborted).toBe(true);
    } finally {
      scope.close();
    }
  });

  it("keeps namespace enablement live, because what is held is the unfiltered registry", async () => {
    // The lease key excludes `enabledToolNamespaces` on purpose. It can, because
    // the namespace filter runs per operation over the held registry rather than
    // being baked into it.
    const listTools = vi.fn<ContextToolProvider["listTools"]>(async () => [
      successfulTool(NOTION_TOOL),
    ]);
    const kernel = kernelWith([NOTION_GRANT], { toolProviders: [providerOf(listTools)] });
    const enabled = context(["notion"]);
    const disabled = context([]);

    const scope = await kernel.openTurnAuthority(enabled);
    try {
      await expect(kernel.listTools(enabled)).resolves.toEqual([NOTION_TOOL]);
      await expect(kernel.listTools(disabled)).resolves.toEqual([]);
      await expect(kernel.invokeTool(disabled, notionCall("call-1"))).resolves.toMatchObject({
        status: "denied",
        error: { code: "tool_unavailable" },
      });
    } finally {
      scope.close();
    }

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  function auditing(): { events: AuditEvent[]; audit: AuditSink } {
    const events: AuditEvent[] = [];
    return { events, audit: { record: async (event) => void events.push(event) } };
  }

  function metadataOf(events: readonly AuditEvent[], type: AuditEvent["type"]): JsonObject {
    const event = events.find((candidate) => candidate.type === type);
    expect(event, `no ${type} event was recorded`).toBeDefined();
    return (event?.metadata ?? {}) as JsonObject;
  }

  it("names on every call the catalogue the turn was served", async () => {
    const { events, audit } = auditing();
    const kernel = kernelWith([NOTION_GRANT], {
      audit,
      toolProviders: [providerOf(async () => [successfulTool(NOTION_TOOL)])],
    });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await kernel.listTools(access);
      await expect(kernel.invokeTool(access, notionCall("call-1"))).resolves.toMatchObject({
        status: "succeeded",
      });
    } finally {
      scope.close();
    }

    // The hash over the catalogue actually served, not merely equal to itself:
    // audit, the identifier a harness is handed, and this are one value.
    const served = await catalogHash(publishToolCatalog([NOTION_TOOL]));
    expect(metadataOf(events, "tool.catalog.listed")["catalogHash"]).toBe(served);
    expect(metadataOf(events, "tool.invoked")["catalogHash"]).toBe(served);
  });

  it("names the catalogue on a refused call too, which is the one worth attributing", async () => {
    const { events, audit } = auditing();
    const kernel = kernelWith([], {
      audit,
      toolProviders: [providerOf(async () => [successfulTool(NOTION_TOOL)])],
    });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await expect(kernel.listTools(access)).resolves.toEqual([]);
      await expect(kernel.invokeTool(access, notionCall("call-1"))).resolves.toMatchObject({
        status: "denied",
        error: { code: "tool_unavailable" },
      });
    } finally {
      scope.close();
    }

    const withheld = await catalogHash(publishToolCatalog([]));
    expect(metadataOf(events, "tool.catalog.listed")["catalogHash"]).toBe(withheld);
    expect(metadataOf(events, "tool.invoked")["catalogHash"]).toBe(withheld);
  });

  it("names no catalogue on a call whose turn never listed one", async () => {
    const { events, audit } = auditing();
    const kernel = kernelWith([NOTION_GRANT], {
      audit,
      toolProviders: [providerOf(async () => [successfulTool(NOTION_TOOL)])],
    });
    const access = context(["notion"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await kernel.invokeTool(access, notionCall("call-1"));
    } finally {
      scope.close();
    }

    // Absent rather than filled in. A host that invokes without discovering was
    // served no catalogue, and naming one it never saw would be an invention.
    expect(metadataOf(events, "tool.invoked")).not.toHaveProperty("catalogHash");
  });

  it("names no catalogue outside a turn, where a listing does not answer for a call", async () => {
    const { events, audit } = auditing();
    const kernel = kernelWith([NOTION_GRANT], {
      audit,
      toolProviders: [providerOf(async () => [successfulTool(NOTION_TOOL)])],
    });
    const access = context(["notion"]);

    await kernel.listTools(access);
    await kernel.invokeTool(access, notionCall("call-1"));

    expect(metadataOf(events, "tool.catalog.listed")["catalogHash"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(metadataOf(events, "tool.invoked")).not.toHaveProperty("catalogHash");
  });
});

describe("SharedOSKernel turn admission", () => {
  it("requires a recipient-scoped execution grant", async () => {
    const authority = new TestGrantSource();
    const kernel = new SharedOSKernel({ grantSource: authority });
    const resource: ResourceRef = {
      namespace: "sharedos.execution",
      path: addressPath(RECEIVER),
      owner: OWNER,
    };

    // An admission denial describes the execution capability, which is the one
    // a host would escalate: "this agent may not run for this owner" is exactly
    // the ask a reviewer can answer by issuing a grant (ADR 0019).
    await expect(kernel.admitTurn(context(), RECEIVER)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
      requiredAuthority: {
        capabilities: [{ resource, actions: ["invoke"], scope: "exact" }],
      },
    });

    authority.serve([grant("grant-turn", resource, ["invoke"])]);
    await expect(kernel.admitTurn(context(), RECEIVER)).resolves.toMatchObject({
      allowed: true,
      matchedGrantId: "grant-turn",
    });
    // A different agent: the description names that agent's execution path, not
    // the one a grant was just served for. The field restates the request.
    await expect(
      kernel.admitTurn(context(), {
        kind: "agent",
        agentId: "agent-other",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
      requiredAuthority: {
        capabilities: [
          {
            resource: {
              namespace: "sharedos.execution",
              path: addressPath({ kind: "agent", agentId: "agent-other" }),
              owner: OWNER,
            },
            actions: ["invoke"],
            scope: "exact",
          },
        ],
      },
    });
  });
});

describe("SharedOSKernel resources", () => {
  it("never calls a resource provider without an explicit capability", async () => {
    const invoke = vi.fn<ResourceProvider["invoke"]>(async (operation) => ({
      operationId: operation.operationId,
      status: "succeeded",
      output: { matches: ["README.md"] },
      completedAt: NOW,
    }));
    const authority = new TestGrantSource();
    const kernel = new SharedOSKernel({ grantSource: authority });
    kernel.registerResourceProvider({ namespace: "files", invoke });
    const request: ResourceInvocationRequest = {
      operationId: "operation-1",
      resource: { namespace: "files", path: ["Workspace", "project", "README.md"] },
      action: "grep",
      input: { pattern: "SharedOS" },
    };

    await expect(kernel.invokeResource(context(), request)).resolves.toMatchObject({
      status: "denied",
      error: { code: "no_matching_grant" },
    });
    expect(invoke).not.toHaveBeenCalled();

    authority.serve([grant("grant-grep", request.resource, ["grep"])]);
    const access = context();
    await expect(kernel.invokeResource(access, request)).resolves.toMatchObject({
      status: "succeeded",
      output: { matches: ["README.md"] },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0].context).toEqual(access);
    expect(invoke.mock.calls[0]?.[0].resource.owner).toEqual(OWNER);
  });

  it("rejects duplicate resource and tool registrations", () => {
    const kernel = kernelWith();
    const provider: ResourceProvider = {
      namespace: "files",
      async invoke(operation) {
        return {
          operationId: operation.operationId,
          status: "succeeded",
          output: null,
          completedAt: NOW,
        };
      },
    };
    kernel.registerResourceProvider(provider);
    kernel.registerTool(successfulTool());

    expect(() => kernel.registerResourceProvider(provider)).toThrow(
      "resource namespace is already registered",
    );
    expect(() => kernel.registerTool(successfulTool())).toThrow("tool is already registered");

    const toolProvider: ContextToolProvider = {
      id: "user-mcp",
      async listTools() {
        return [];
      },
    };
    kernel.registerToolProvider(toolProvider);
    expect(() => kernel.registerToolProvider(toolProvider)).toThrow(
      "tool provider is already registered",
    );
  });
});

describe("SharedOSKernel messaging and audit", () => {
  function envelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
    return {
      version: "1",
      id: "message-1",
      sender: ACTOR,
      receiver: RECEIVER,
      purpose: "prepare-update",
      payload: { request: "Summarize the architecture" },
      traceId: "trace-1",
      createdAt: NOW,
      ...overrides,
    };
  }

  function replyTo(request: MessageEnvelope, overrides: Partial<MessageEnvelope> = {}) {
    return envelope({
      id: "message-reply-1",
      sender: request.receiver,
      receiver: request.sender,
      payload: { answer: "Architecture summarized" },
      replyTo: request.id,
      ...overrides,
    });
  }

  function messageRequestCall(arguments_: ToolCall["arguments"] = {}): ToolCall {
    return toolCall({
      id: "untrusted-model-call-1",
      tool: MESSAGE_REQUEST_TOOL_NAME,
      arguments: { recipient: RECEIVER, payload: { request: "Summarize" }, ...arguments_ },
    });
  }

  function messageResource(receiver: Address = RECEIVER): ResourceRef {
    return {
      namespace: "sharedos.messaging",
      path: addressPath(receiver),
      owner: OWNER,
    };
  }

  function authorityMutatingAudit(events: AuditEvent[], mutationResults: boolean[]): AuditSink {
    return {
      async record(event) {
        events.push(event);
        if (event.type !== "authorization.checked" || event.outcome !== "allowed") {
          return;
        }
        mutationResults.push(Reflect.set(event.actor, "agentId", "audit-poisoned-actor"));
        mutationResults.push(Reflect.set(event.owner, "userId", "audit-poisoned-owner"));
        if (event.resource !== undefined) {
          mutationResults.push(Reflect.set(event.resource, "namespace", "audit-poisoned-resource"));
        }
      },
    };
  }

  it("keeps concurrent message requests in one turn from taking each other's envelope", async () => {
    // The handler carries the envelope it prepared between `resolveRequirement`
    // and `invoke`. Since a turn holds one derived catalogue (ADR 0026), the
    // turn's calls share one handler, so that state cannot live on the handler.
    const OTHER = { kind: "agent", agentId: "agent-eve" } as const;
    const delivered: MessageEnvelope[] = [];
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => {
      // Yield between preparing and sending, which is where a second call in
      // the same turn interleaves.
      await Promise.resolve();
      delivered.push(message);
      return { messageId: message.id, status: "accepted", timestamp: NOW };
    });
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(async (_access, request) =>
      replyTo(request),
    );
    const kernel = kernelWith(
      [
        grant("grant-tina", messageResource(RECEIVER), ["send"]),
        grant("grant-eve", messageResource(OTHER), ["send"]),
      ],
      {
        messageTransport: { deliver },
        messageRequestRouter: { resolveReply },
        createMessageId: (_access, call) => `message-for-${call.id}`,
      },
    );
    const access = context(["messages"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await Promise.all([
        kernel.invokeTool(access, {
          ...messageRequestCall({ recipient: RECEIVER, payload: { for: "tina" } }),
          id: "call-tina",
        }),
        kernel.invokeTool(access, {
          ...messageRequestCall({ recipient: OTHER, payload: { for: "eve" } }),
          id: "call-eve",
        }),
      ]);
    } finally {
      scope.close();
    }

    expect(
      delivered
        .map(({ receiver, payload }) => ({ receiver, payload }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    ).toEqual([
      { receiver: OTHER, payload: { for: "eve" } },
      { receiver: RECEIVER, payload: { for: "tina" } },
    ]);
  });

  it("sends what a call was authorized for even when another call reuses its id", async () => {
    // The sharper half: with the envelope keyed on `call.id`, two concurrent
    // calls sharing an id pass the prepared-for-this-call guard, and the
    // authorization decision made for one recipient is spent delivering to the
    // other -- here to an address holding no grant at all.
    const UNGRANTED = { kind: "agent", agentId: "agent-eve" } as const;
    const delivered: MessageEnvelope[] = [];
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => {
      await Promise.resolve();
      delivered.push(message);
      return { messageId: message.id, status: "accepted", timestamp: NOW };
    });
    const kernel = kernelWith([grant("grant-tina", messageResource(RECEIVER), ["send"])], {
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply: async (_access, request) => replyTo(request) },
    });
    const access = context(["messages"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      const [granted, refused] = await Promise.all([
        kernel.invokeTool(access, messageRequestCall({ recipient: RECEIVER })),
        kernel.invokeTool(access, messageRequestCall({ recipient: UNGRANTED })),
      ]);
      expect(granted).toMatchObject({ status: "succeeded" });
      expect(refused).toMatchObject({ status: "denied", error: { code: "no_matching_grant" } });
    } finally {
      scope.close();
    }

    expect(delivered.map(({ receiver }) => receiver)).toEqual([RECEIVER]);
  });

  it("does not expose or execute the request tool without send authority", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>();
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>();
    const kernel = kernelWith([], {
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
    });
    const access = context(["messages"]);

    await expect(kernel.listTools(access)).resolves.toEqual([]);
    await expect(kernel.invokeTool(access, messageRequestCall())).resolves.toMatchObject({
      status: "denied",
      error: { code: "tool_unavailable" },
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(resolveReply).not.toHaveBeenCalled();
  });

  it("installs the request tool only when both host ports exist and never mutates the host registry", async () => {
    const messagingGrant = grant("grant-message", messageResource(), ["send"]);
    const hostTools = new ToolRegistry();
    const deliver = vi.fn<MessageTransport["deliver"]>();
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>();

    await expect(
      kernelWith([messagingGrant], { tools: hostTools, messageTransport: { deliver } }).listTools(
        context(["messages"]),
      ),
    ).resolves.toEqual([]);
    await expect(
      kernelWith([messagingGrant], {
        tools: hostTools,
        messageRequestRouter: { resolveReply },
      }).listTools(context(["messages"])),
    ).resolves.toEqual([]);
    await expect(
      kernelWith([messagingGrant], {
        tools: hostTools,
        messageTransport: { deliver },
        messageRequestRouter: { resolveReply },
      }).listTools(context(["messages"])),
    ).resolves.toEqual([MESSAGE_REQUEST_TOOL_DEFINITION]);

    expect(hostTools.definitions()).toEqual([]);
  });

  it("discovers the request tool without consuming its bounded recipient grant", async () => {
    const usage = new InMemoryGrantUsageStore();
    const messagingGrant = grant("grant-message", messageResource(), ["send"], { maxUses: 1 });
    const kernel = kernelWith([messagingGrant], {
      authorizer: new CapabilityAuthorizer({ usageStore: usage }),
      messageTransport: { deliver: vi.fn() },
      messageRequestRouter: { resolveReply: vi.fn() },
    });

    await expect(kernel.listTools(context(["messages"]))).resolves.toEqual([
      MESSAGE_REQUEST_TOOL_DEFINITION,
    ]);
    await expect(usage.getUsage("world-alpha", "grant-message")).resolves.toBe(0);
  });

  it("publishes every accepted recipient address as a closed, unambiguous schema", async () => {
    const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
      messageTransport: { deliver: vi.fn() },
      messageRequestRouter: { resolveReply: vi.fn() },
    });

    const catalog = await kernel.listPublishedTools(context(["messages"]), {
      executionId: "execution-message-schema",
    });

    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: {
        recipient: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { const: "human" },
                userId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 256,
                  pattern: "^(?!\\s)[\\s\\S]*\\S$",
                },
              },
              required: ["kind", "userId"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "agent" },
                agentId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 256,
                  pattern: "^(?!\\s)[\\s\\S]*\\S$",
                },
              },
              required: ["kind", "agentId"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "group" },
                conversationId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 256,
                  pattern: "^(?!\\s)[\\s\\S]*\\S$",
                },
              },
              required: ["kind", "conversationId"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "service" },
                serviceId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 256,
                  pattern: "^(?!\\s)[\\s\\S]*\\S$",
                },
              },
              required: ["kind", "serviceId"],
              additionalProperties: false,
            },
          ],
        },
        payload: {},
      },
      required: ["recipient", "payload"],
      additionalProperties: false,
    });
  });

  it("constructs a trusted request, consumes once, and returns only the durable reply payload", async () => {
    const usage = new InMemoryGrantUsageStore();
    const events: AuditEvent[] = [];
    let acceptedRequest: MessageEnvelope | undefined;
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => {
      acceptedRequest = message;
      return { messageId: message.id, status: "accepted", timestamp: NOW };
    });
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(
      async (_access, request, delivery) => {
        expect(delivery).toMatchObject({ status: "accepted", messageId: request.id });
        return replyTo(request);
      },
    );
    const messagingGrant = grant("grant-message", messageResource(), ["send"], { maxUses: 1 });
    const kernel = kernelWith([messagingGrant], {
      authorizer: new CapabilityAuthorizer({ usageStore: usage }),
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
      createMessageId: () => "message-generated-1",
      audit: { record: async (event) => void events.push(event) },
    });

    await expect(kernel.invokeTool(context(["messages"]), messageRequestCall())).resolves.toEqual({
      callId: "untrusted-model-call-1",
      tool: MESSAGE_REQUEST_TOOL_NAME,
      status: "succeeded",
      output: { answer: "Architecture summarized" },
      completedAt: NOW,
    });
    expect(acceptedRequest).toEqual({
      version: "1",
      id: "message-generated-1",
      sender: ACTOR,
      receiver: RECEIVER,
      purpose: "prepare-update",
      payload: { request: "Summarize" },
      traceId: "trace-1",
      createdAt: NOW,
    });
    expect(acceptedRequest?.id).not.toBe("untrusted-model-call-1");
    expect(deliver).toHaveBeenCalledOnce();
    expect(resolveReply).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "authorization.checked",
        outcome: "allowed",
        operationId: "untrusted-model-call-1",
        resource: messageResource(),
        action: "send",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.sent",
        outcome: "succeeded",
        operationId: "untrusted-model-call-1",
        messageId: "message-generated-1",
        receiver: RECEIVER,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("Summarize");
    expect(JSON.stringify(events)).not.toContain("Architecture summarized");
    await expect(usage.getUsage("world-alpha", "grant-message")).resolves.toBe(1);

    await expect(
      kernel.invokeTool(context(["messages"]), messageRequestCall()),
    ).resolves.toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it.each(["sender", "purpose", "traceId", "messageId", "intent", "replyTo"])(
    "rejects model-authored authority field %s before delivery",
    async (field) => {
      const deliver = vi.fn<MessageTransport["deliver"]>();
      const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>();
      const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
        messageTransport: { deliver },
        messageRequestRouter: { resolveReply },
      });

      await expect(
        kernel.invokeTool(context(["messages"]), messageRequestCall({ [field]: "forged" })),
      ).resolves.toMatchObject({
        status: "failed",
        error: { code: "invalid_tool_arguments" },
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(resolveReply).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["replyTo", { replyTo: "wrong-request" }],
    ["sender", { sender: ACTOR }],
    ["receiver", { receiver: RECEIVER }],
    ["purpose", { purpose: "other-purpose" }],
    ["trace", { traceId: "other-trace" }],
  ] satisfies readonly [string, Partial<MessageEnvelope>][])(
    "fails closed on a mismatched durable reply %s",
    async (_field, mismatch) => {
      const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
        messageId: message.id,
        status: "accepted",
        timestamp: NOW,
      }));
      const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(async (_access, request) =>
        replyTo(request, mismatch),
      );
      const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
        messageTransport: { deliver },
        messageRequestRouter: { resolveReply },
        createMessageId: () => "message-generated-1",
      });

      const result = await kernel.invokeTool(context(["messages"]), messageRequestCall());

      expect(result).toMatchObject({
        status: "failed",
        error: {
          code: "invalid_message_reply",
          message: "The message router returned an invalid reply",
          retryable: false,
        },
      });
      expect(JSON.stringify(result)).not.toContain("Architecture summarized");
      expect(JSON.stringify(result)).not.toContain("other-purpose");
      expect(deliver).toHaveBeenCalledOnce();
      expect(resolveReply).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "refuses with a code of its own",
      async (
        _access: AccessContext,
        envelope: MessageEnvelope,
      ): Promise<MessageDeliveryResult> => ({
        messageId: envelope.id,
        status: "denied",
        timestamp: NOW,
        error: { code: "route_lease_revoked", message: "The recipient's route is gone" },
      }),
      "route_lease_revoked",
    ],
    [
      "throws",
      async (): Promise<MessageDeliveryResult> => {
        throw new Error("transport socket closed");
      },
      "message_delivery_failed",
    ],
  ] as const)(
    "names what the transport answered as the tool record's cause when it %s",
    async (_label, deliver, transportCode) => {
      const events: AuditEvent[] = [];
      const kernel = kernelWith([grant("grant-tina", messageResource(), ["send"])], {
        audit: { record: async (event) => void events.push(event) },
        messageTransport: { deliver },
        messageRequestRouter: { resolveReply: async (_access, request) => replyTo(request) },
      });

      const result = await kernel.invokeTool(context(["messages"]), messageRequestCall());

      // The caller learns the request was not accepted and nothing about why:
      // the transport's vocabulary is the host's. The trail is not the caller.
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "message_request_not_accepted" },
      });
      expect(JSON.stringify(result)).not.toContain(transportCode);

      // Until this, only the sibling `message.sent` carried the transport's
      // code, and a reader had to join the two by call id to say why a request
      // was refused. The tool's own record says it now, in the field every
      // other coarse code already uses.
      const invoked = events.find(({ type }) => type === "tool.invoked");
      expect(invoked).toMatchObject({
        reason: "message_request_not_accepted",
        cause: transportCode,
        operationId: "untrusted-model-call-1",
      });
      expect(events.find(({ type }) => type === "message.sent")).toMatchObject({
        reason: transportCode,
        operationId: "untrusted-model-call-1",
      });
    },
  );

  it("names no cause on a request the transport accepted", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([grant("grant-tina", messageResource(), ["send"])], {
      audit: { record: async (event) => void events.push(event) },
      messageTransport: {
        deliver: async (_access, envelope) => ({
          messageId: envelope.id,
          status: "accepted",
          timestamp: NOW,
        }),
      },
      messageRequestRouter: { resolveReply: async (_access, request) => replyTo(request) },
    });

    await expect(
      kernel.invokeTool(context(["messages"]), messageRequestCall()),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(events.find(({ type }) => type === "tool.invoked")?.cause).toBeUndefined();
  });

  it("rejects malformed durable replies and sanitizes router failures", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
      messageId: message.id,
      status: "accepted",
      timestamp: NOW,
    }));
    const malformedRouter: MessageRequestRouter = {
      async resolveReply(_access, request) {
        return { ...replyTo(request), intent: "legacy-authority-shape" } as MessageEnvelope;
      },
    };
    const failingRouter: MessageRequestRouter = {
      async resolveReply() {
        throw new Error("/private/reply-log/secret: database password leaked");
      },
    };
    const options = {
      messageTransport: { deliver },
      createMessageId: () => "message-generated-1",
    };
    const messagingGrant = grant("grant-message", messageResource(), ["send"]);

    await expect(
      kernelWith([messagingGrant], {
        ...options,
        messageRequestRouter: malformedRouter,
      }).invokeTool(context(["messages"]), messageRequestCall()),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "invalid_message_reply" },
    });

    const failed = await kernelWith([messagingGrant], {
      ...options,
      messageRequestRouter: failingRouter,
    }).invokeTool(context(["messages"]), messageRequestCall());
    expect(failed).toMatchObject({
      status: "failed",
      error: {
        code: "message_reply_resolution_failed",
        message: "The message router could not resolve a reply",
      },
    });
    expect(JSON.stringify(failed)).not.toContain("secret");
    expect(JSON.stringify(failed)).not.toContain("password");
  });

  it("rejects a reply correlated only to router-mutated request authority", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
      messageId: message.id,
      status: "accepted",
      timestamp: NOW,
    }));
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(
      async (_access, mutableRequest) => {
        mutableRequest.id = "router-forged-request";
        mutableRequest.sender = RECEIVER;
        mutableRequest.receiver = ACTOR;
        mutableRequest.purpose = "router-forged-purpose";
        mutableRequest.traceId = "router-forged-trace";
        return replyTo(mutableRequest, {
          purpose: mutableRequest.purpose,
          traceId: mutableRequest.traceId,
          payload: { secret: "router-forged-reply" },
        });
      },
    );
    const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
      createMessageId: () => "message-generated-1",
    });

    const result = await kernel.invokeTool(context(["messages"]), messageRequestCall());

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "invalid_message_reply" },
    });
    expect(JSON.stringify(result)).not.toContain("router-forged");
  });

  it("keeps transport mutation out of request correlation and router input", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, mutableMessage) => {
      const authorizedId = mutableMessage.id;
      mutableMessage.id = "transport-forged-request";
      mutableMessage.purpose = "transport-forged-purpose";
      mutableMessage.traceId = "transport-forged-trace";
      return { messageId: authorizedId, status: "accepted", timestamp: NOW };
    });
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(
      async (_access, immutableRequest) => {
        expect(immutableRequest).toMatchObject({
          id: "message-generated-1",
          purpose: "prepare-update",
          traceId: "trace-1",
        });
        return replyTo(immutableRequest);
      },
    );
    const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
      createMessageId: () => "message-generated-1",
    });

    await expect(
      kernel.invokeTool(context(["messages"]), messageRequestCall()),
    ).resolves.toMatchObject({
      status: "succeeded",
      output: { answer: "Architecture summarized" },
    });
  });

  it("keeps direct send sender-bound and consumes its recipient grant once", async () => {
    const usage = new InMemoryGrantUsageStore();
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
      messageId: message.id,
      status: "delivered",
      timestamp: NOW,
    }));
    const kernel = kernelWith(
      [grant("grant-message", messageResource(), ["send"], { maxUses: 1 })],
      {
        authorizer: new CapabilityAuthorizer({ usageStore: usage }),
        messageTransport: { deliver },
      },
    );

    await expect(kernel.sendMessage(context(), envelope())).resolves.toMatchObject({
      status: "delivered",
    });
    await expect(usage.getUsage("world-alpha", "grant-message")).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledOnce();

    await expect(
      kernel.sendMessage(context(), envelope({ id: "message-2" })),
    ).resolves.toMatchObject({ status: "denied", error: { code: "grant_exhausted" } });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("rejects invalid direct message envelopes before authority, audit, or transport", async () => {
    const messagingGrant = grant("grant-message", messageResource(), ["send"], { maxUses: 1 });
    const load = vi.fn<GrantSource["load"]>(async () => [messagingGrant]);
    const getUsage = vi.fn(async () => 0);
    const tryConsume = vi.fn(async () => true);
    const record = vi.fn<AuditSink["record"]>(async () => undefined);
    const deliver = vi.fn<MessageTransport["deliver"]>();
    const kernel = new SharedOSKernel({
      grantSource: { load },
      authorizer: new CapabilityAuthorizer({ usageStore: { getUsage, tryConsume } }),
      audit: { record },
      messageTransport: { deliver },
    });
    const legacy = { ...envelope(), intent: "removed-message-field" } as MessageEnvelope;
    const { id: _removedId, ...withoutId } = envelope();
    const malformed = withoutId as unknown as MessageEnvelope;

    for (const invalid of [legacy, malformed]) {
      await expect(kernel.sendMessage(context(), invalid)).rejects.toThrow(
        "message envelope does not match the SharedOS contract",
      );
    }

    expect(load).not.toHaveBeenCalled();
    expect(getUsage).not.toHaveBeenCalled();
    expect(tryConsume).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("propagates cancellation after delivery without retrying the request", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel request wait");
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
      messageId: message.id,
      status: "accepted",
      timestamp: NOW,
    }));
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(
      async (_access, _request, _delivery, signal) => {
        controller.abort(reason);
        expect(signal.aborted).toBe(true);
        throw reason;
      },
    );
    const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
      createMessageId: () => "message-generated-1",
    });

    await expect(
      kernel.invokeTool(context(["messages"]), messageRequestCall(), { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(deliver).toHaveBeenCalledOnce();
    expect(resolveReply).toHaveBeenCalledOnce();
  });

  it("binds sender, purpose, trace, and recipient capability before delivery", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>(async (_access, message) => ({
      messageId: message.id,
      status: "delivered",
      timestamp: NOW,
    }));
    const messagingResource: ResourceRef = {
      namespace: "sharedos.messaging",
      path: addressPath(RECEIVER),
      owner: OWNER,
    };
    const kernel = kernelWith([grant("grant-message", messagingResource, ["send"])], {
      messageTransport: { deliver },
    });
    const access = context();

    await expect(
      kernel.sendMessage(access, envelope({ purpose: "other-purpose" })),
    ).resolves.toMatchObject({
      status: "denied",
      error: { code: "message_context_mismatch" },
    });
    expect(deliver).not.toHaveBeenCalled();

    await expect(kernel.sendMessage(access, envelope())).resolves.toEqual({
      messageId: "message-1",
      status: "delivered",
      timestamp: NOW,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("treats payload claims as data, never as authority", async () => {
    const deliver = vi.fn<MessageTransport["deliver"]>();
    const kernel = kernelWith([], { messageTransport: { deliver } });
    const forgedPayload = envelope({
      payload: {
        grants: [
          {
            namespace: "sharedos.messaging",
            action: "send",
            subject: "self",
          },
        ],
      },
    });

    await expect(kernel.sendMessage(context(), forgedPayload)).resolves.toMatchObject({
      status: "denied",
      error: { code: "no_matching_grant" },
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("emits metadata-only audit events without tool arguments or message payload", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditSink = {
      async record(event) {
        events.push(event);
      },
    };
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], { audit });
    kernel.registerTool(successfulTool());
    const access = context();

    await kernel.invokeTool(access, toolCall());

    expect(events.map(({ type }) => type)).toEqual([
      "authority.resolved",
      "authorization.checked",
      "tool.invoked",
    ]);
    expect(events[1]).toMatchObject({
      namespaceId: "world-alpha",
      traceId: "trace-1",
      purpose: "prepare-update",
      outcome: "allowed",
      grantId: "grant-search",
    });
    expect(JSON.stringify(events)).not.toContain("architecture");
    expect(JSON.stringify(events)).not.toContain("memory-1");
  });

  it("isolates message execution and later events from authorization audit mutation", async () => {
    const events: AuditEvent[] = [];
    const mutationResults: boolean[] = [];
    let deliveredContext: AccessContext | undefined;
    const deliver = vi.fn<MessageTransport["deliver"]>(async (access, message) => {
      deliveredContext = access;
      return { messageId: message.id, status: "accepted", timestamp: NOW };
    });
    const resolveReply = vi.fn<MessageRequestRouter["resolveReply"]>(async (_access, request) =>
      replyTo(request),
    );
    const kernel = kernelWith([grant("grant-message", messageResource(), ["send"])], {
      audit: authorityMutatingAudit(events, mutationResults),
      messageTransport: { deliver },
      messageRequestRouter: { resolveReply },
      createMessageId: () => "message-generated-1",
    });

    await expect(
      kernel.invokeTool(context(["messages"]), messageRequestCall()),
    ).resolves.toMatchObject({ status: "succeeded" });

    expect(mutationResults).toEqual([false, false, false]);
    expect(deliveredContext).toMatchObject({ actor: ACTOR, owner: OWNER });
    expect(events.every((event) => JSON.stringify(event.actor) === JSON.stringify(ACTOR))).toBe(
      true,
    );
    expect(events.every((event) => JSON.stringify(event.owner) === JSON.stringify(OWNER))).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain("audit-poisoned");
  });

  it("isolates generic tool execution and its requirement from authorization audit mutation", async () => {
    const events: AuditEvent[] = [];
    const mutationResults: boolean[] = [];
    let invokedContext: AccessContext | undefined;
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: authorityMutatingAudit(events, mutationResults),
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      async invoke(access, call) {
        invokedContext = access;
        return {
          callId: call.id,
          tool: call.tool,
          status: "succeeded",
          output: null,
          completedAt: NOW,
        };
      },
    });

    await expect(kernel.invokeTool(context(["files"]), toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });

    expect(mutationResults).toEqual([false, false, false]);
    expect(invokedContext).toMatchObject({ actor: ACTOR, owner: OWNER });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.invoked",
        resource: FILE_RESOURCE,
        action: "search",
      }),
    );
    expect(JSON.stringify(events)).not.toContain("audit-poisoned");
  });

  it("does not turn a completed side effect into a retry when outcome audit fails", async () => {
    const audit: AuditSink = {
      async record(event) {
        if (event.type === "tool.invoked") {
          throw new Error("audit store unavailable after execution");
        }
      },
    };
    const onAuditError = vi.fn(async () => {
      throw new Error("alert transport unavailable");
    });
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit,
      onAuditError,
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke,
    });

    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(onAuditError).toHaveBeenCalledOnce();
  });
});

describe("what a failing audit sink does, by when the record is written", () => {
  /** A sink that throws on one event type and keeps everything else. */
  function failingOn(type: AuditEvent["type"]) {
    const kept: AuditEvent[] = [];
    const onAuditError = vi.fn<NonNullable<SharedOSKernelOptions["onAuditError"]>>();
    const audit: AuditSink = {
      async record(event) {
        if (event.type === type) {
          throw new Error(`audit store unavailable for ${type}`);
        }
        kept.push(event);
      },
    };
    return { audit, onAuditError, kept };
  }

  const MESSAGE: MessageEnvelope = {
    version: "1",
    id: "message-1",
    sender: ACTOR,
    receiver: RECEIVER,
    purpose: "prepare-update",
    payload: { request: "Summarize" },
    traceId: "trace-1",
    createdAt: NOW,
  };
  const MESSAGE_RESOURCE: ResourceRef = {
    namespace: "sharedos.messaging",
    path: addressPath(RECEIVER),
    owner: OWNER,
  };
  const RESOURCE_REQUEST: ResourceInvocationRequest = {
    operationId: "operation-1",
    resource: FILE_RESOURCE,
    action: "search",
  };

  // Written before anything acts on them. Nothing has run, and a decision that
  // was never recorded is not one the kernel acts on, so the failure is the
  // caller's to see. `onAuditError` is for the other half.
  it.each([
    ["authority.resolved", (kernel: SharedOSKernel) => kernel.invokeTool(context(), toolCall())],
    ["authorization.checked", (kernel: SharedOSKernel) => kernel.invokeTool(context(), toolCall())],
    ["tool.catalog.listed", (kernel: SharedOSKernel) => kernel.listTools(context())],
    [
      "tool.namespace.catalog.listed",
      (kernel: SharedOSKernel) => kernel.listToolNamespaces(context()),
    ],
  ] as const)("refuses the operation when %s cannot be written", async (type, operate) => {
    const { audit, onAuditError } = failingOn(type);
    const invoke = vi.fn(successfulTool().invoke);
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit,
      onAuditError,
    });
    kernel.registerTool({ ...successfulTool(), invoke });

    // Typed, so a caller can tell an audit outage from a fault of its own, with
    // what the sink threw inside it. `effect: "none"`: no port was entered.
    const refusal = await operate(kernel).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(AuditUnavailableError);
    expect(refusal).toMatchObject({
      code: "audit_unavailable",
      effect: "none",
      cause: { message: `audit store unavailable for ${type}` },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onAuditError).not.toHaveBeenCalled();
  });

  describe("a bounded use spent by a decision that could not be recorded", () => {
    const BOUNDED = grant("grant-search", FILE_RESOURCE, ["search"], { maxUses: 1 });
    const used = (store: GrantUsageStore) => store.getUsage("world-alpha", BOUNDED.id);

    /** A kernel whose sink is down, while `sink.down`, for the decision that spends. */
    function boundedKernel(usageStore: GrantUsageStore) {
      const sink = { down: true };
      const invoke = vi.fn(successfulTool().invoke);
      const kernel = kernelWith([BOUNDED], {
        authorizer: new CapabilityAuthorizer({ usageStore }),
        audit: {
          async record(event) {
            if (sink.down && event.type === "authorization.checked" && event.consumed === true) {
              throw new Error("audit store unavailable");
            }
          },
        },
      });
      kernel.registerTool({ ...successfulTool(), invoke });
      return { kernel, sink, invoke };
    }

    it("is given back, so the call can be made once the sink answers", async () => {
      const usageStore = new InMemoryGrantUsageStore();
      const { kernel, sink, invoke } = boundedKernel(usageStore);

      await expect(kernel.invokeTool(context(), toolCall())).rejects.toBeInstanceOf(
        AuditUnavailableError,
      );
      expect(invoke).not.toHaveBeenCalled();
      await expect(used(usageStore)).resolves.toBe(0);

      sink.down = false;
      await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
        status: "succeeded",
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      await expect(used(usageStore)).resolves.toBe(1);
    });

    // The port's `release` is optional and may itself be down. Either way the
    // use stays spent, which is the behaviour before the port could give it
    // back, and the caller is still told of the audit outage and nothing else.
    it.each([
      ["has no release", undefined],
      [
        "cannot release",
        async (): Promise<void> => {
          throw new Error("usage store unavailable");
        },
      ],
    ])("stays spent when the store %s", async (_name, release) => {
      const counted = new InMemoryGrantUsageStore();
      const usageStore: GrantUsageStore = {
        getUsage: (namespaceId, grantId) => counted.getUsage(namespaceId, grantId),
        tryConsume: (namespaceId, grantId, maximumUses) =>
          counted.tryConsume(namespaceId, grantId, maximumUses),
        ...(release === undefined ? {} : { release }),
      };
      const { kernel, invoke } = boundedKernel(usageStore);

      await expect(kernel.invokeTool(context(), toolCall())).rejects.toMatchObject({
        code: "audit_unavailable",
        cause: { message: "audit store unavailable" },
      });
      expect(invoke).not.toHaveBeenCalled();
      await expect(used(usageStore)).resolves.toBe(1);
    });

    /** An in-memory store whose `release` is watched. */
    function watchedStore() {
      const counted = new InMemoryGrantUsageStore();
      const release = vi.fn((namespaceId: string, grantId: string) =>
        counted.release(namespaceId, grantId),
      );
      const usageStore: GrantUsageStore = {
        getUsage: (namespaceId, grantId) => counted.getUsage(namespaceId, grantId),
        tryConsume: (namespaceId, grantId, maximumUses) =>
          counted.tryConsume(namespaceId, grantId, maximumUses),
        release,
      };
      return { usageStore, release };
    }

    /** A sink that is down for every `authorization.checked` matched, while `sink.down`. */
    function sinkDownFor(matches: (event: AuditEvent) => boolean) {
      const sink = { down: true };
      const audit: AuditSink = {
        async record(event) {
          if (sink.down && event.type === "authorization.checked" && matches(event)) {
            throw new Error("audit store unavailable");
          }
        },
      };
      return { sink, audit };
    }

    // Every operation that spends a use spends it at its decision, before its
    // port is entered, so each gives it back the same way.
    it.each([
      [
        "a resource request",
        grant("grant-bounded", FILE_RESOURCE, ["search"], { maxUses: 1 }),
        (kernel: SharedOSKernel) => kernel.invokeResource(context(), RESOURCE_REQUEST),
      ],
      [
        "a direct send",
        grant("grant-bounded", MESSAGE_RESOURCE, ["send"], { maxUses: 1 }),
        (kernel: SharedOSKernel) => kernel.sendMessage(context(), MESSAGE),
      ],
      [
        "a turn admission",
        grant(
          "grant-bounded",
          { namespace: "sharedos.execution", path: addressPath(RECEIVER), owner: OWNER },
          ["invoke"],
          { maxUses: 1 },
        ),
        (kernel: SharedOSKernel) => kernel.admitTurn(context(), RECEIVER),
      ],
    ] as const)(
      "is given back for %s, whose port is not entered",
      async (_name, bounded, operate) => {
        const { usageStore } = watchedStore();
        const { sink, audit } = sinkDownFor((event) => event.consumed === true);
        const entered = vi.fn();
        const kernel = kernelWith([bounded], {
          audit,
          authorizer: new CapabilityAuthorizer({ usageStore }),
          messageTransport: {
            deliver: async (_access, envelope) => {
              entered();
              return { messageId: envelope.id, status: "accepted", timestamp: NOW };
            },
          },
        });
        kernel.registerResourceProvider({
          namespace: "files",
          invoke: async (operation) => {
            entered();
            return {
              operationId: operation.operationId,
              status: "succeeded",
              output: {},
              completedAt: NOW,
            };
          },
        });
        const spent = () => usageStore.getUsage("world-alpha", bounded.id);

        await expect(operate(kernel)).rejects.toMatchObject({
          code: "audit_unavailable",
          effect: "none",
        });
        expect(entered).not.toHaveBeenCalled();
        await expect(spent()).resolves.toBe(0);

        sink.down = false;
        await operate(kernel);
        await expect(spent()).resolves.toBe(1);
      },
    );

    // The decision was recorded and the tool ran, so the use was spent. A record
    // after the effect that fails is reported, and gives nothing back.
    it("stays spent when a record after the decision fails", async () => {
      const { usageStore, release } = watchedStore();
      const onAuditError = vi.fn<NonNullable<SharedOSKernelOptions["onAuditError"]>>();
      const invoke = vi.fn(successfulTool().invoke);
      const kernel = kernelWith([BOUNDED], {
        authorizer: new CapabilityAuthorizer({ usageStore }),
        onAuditError,
        audit: {
          async record(event) {
            if (event.type === "tool.invoked") {
              throw new Error("audit store unavailable");
            }
          },
        },
      });
      kernel.registerTool({ ...successfulTool(), invoke });

      await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
        status: "succeeded",
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(onAuditError).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
      await expect(used(usageStore)).resolves.toBe(1);
    });

    // A refusal spent nothing, even one made by a consuming decision.
    it("gives nothing back for a refusal whose record fails", async () => {
      const { usageStore, release } = watchedStore();
      const { sink, audit } = sinkDownFor(() => true);
      sink.down = false;
      const kernel = kernelWith([BOUNDED], {
        audit,
        authorizer: new CapabilityAuthorizer({ usageStore }),
      });
      kernel.registerResourceProvider({
        namespace: "files",
        invoke: async (operation) => ({
          operationId: operation.operationId,
          status: "succeeded",
          output: {},
          completedAt: NOW,
        }),
      });

      await expect(kernel.invokeResource(context(), RESOURCE_REQUEST)).resolves.toMatchObject({
        status: "succeeded",
      });
      sink.down = true;
      await expect(
        kernel.invokeResource(context(), { ...RESOURCE_REQUEST, operationId: "operation-2" }),
      ).rejects.toBeInstanceOf(AuditUnavailableError);

      expect(release).not.toHaveBeenCalled();
      await expect(used(usageStore)).resolves.toBe(1);
    });

    // Nothing stops a grant source returning two grants under one id. The
    // unbounded one allows the calendar call and spends nothing, so its failed
    // record gives nothing back: not the use the bounded one spent on a search
    // that ran, which would let the search run twice on `maxUses: 1`.
    it("gives nothing back for an unbounded grant sharing a bounded grant's id", async () => {
      const { usageStore, release } = watchedStore();
      const { sink, audit } = sinkDownFor((event) => event.consumed === true);
      sink.down = false;
      const invoke = vi.fn(successfulTool().invoke);
      const kernel = kernelWith(
        [BOUNDED, grant(BOUNDED.id, CALENDAR_TOOL.requiredCapability.resource, ["create"])],
        { audit, authorizer: new CapabilityAuthorizer({ usageStore }) },
      );
      kernel.registerTool({ ...successfulTool(), invoke });
      kernel.registerTool(successfulTool(CALENDAR_TOOL));

      await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
        status: "succeeded",
      });
      sink.down = true;
      await expect(
        kernel.invokeTool(context(), toolCall({ id: "call-calendar", tool: CALENDAR_TOOL.name })),
      ).rejects.toBeInstanceOf(AuditUnavailableError);
      sink.down = false;
      await expect(
        kernel.invokeTool(context(), toolCall({ id: "call-again" })),
      ).resolves.toMatchObject({ status: "denied" });

      expect(release).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(1);
      await expect(used(usageStore)).resolves.toBe(1);
    });
  });

  it("says the effect is unknown when the outage is met inside a port already entered", async () => {
    const kept: AuditEvent[] = [];
    let written = 0;
    let decisions = 0;
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      // Down for the second decision, the one the handler asks for. The tool's
      // own decision is recorded, so its handler is entered.
      audit: {
        async record(event) {
          if (event.type === "authorization.checked" && (decisions += 1) === 2) {
            throw new Error("audit store unavailable for the inner decision");
          }
          kept.push(event);
        },
      },
    });
    kernel.registerTool({
      ...successfulTool(),
      // A host tool that does some of its work and then calls back into the
      // kernel for a governed read.
      invoke: async (access, call, signal) => {
        written += 1;
        await kernel.invokeResource(access, RESOURCE_REQUEST, { signal });
        return successfulTool().invoke(access, call, signal);
      },
    });

    const refusal = await kernel.invokeTool(context(), toolCall()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(AuditUnavailableError);
    expect(refusal).toMatchObject({
      effect: "unknown",
      cause: { message: "audit store unavailable for the inner decision" },
    });
    expect(written).toBe(1);
    // The tool call was entered and stopped, so it is recorded as that rather
    // than left as an allowed decision with nothing after it, and the outage is
    // not reported as the handler's failure.
    expect(kept.at(-1)).toMatchObject({
      type: "tool.invoked",
      operationId: toolCall().id,
      outcome: "interrupted",
      reason: "audit_unavailable",
      failClosed: true,
    });
  });

  // Written after the effect, or after an answer that is already final.
  it.each([
    [
      "resource.invoked",
      async (kernel: SharedOSKernel) =>
        expect(await kernel.invokeResource(context(), RESOURCE_REQUEST)).toMatchObject({
          status: "succeeded",
        }),
    ],
    [
      "message.sent",
      async (kernel: SharedOSKernel) =>
        expect(await kernel.sendMessage(context(), MESSAGE)).toMatchObject({
          status: "accepted",
        }),
    ],
    [
      "turn.ended",
      (kernel: SharedOSKernel) =>
        kernel.recordTurnEnd(context(), { executionId: "execution-1", status: "succeeded" }),
    ],
    [
      "tool.invoked",
      (kernel: SharedOSKernel) =>
        kernel.recordRefusedCall(context(), {
          callId: "call-guessed",
          tool: "files.delete",
          reasonCode: "tool_unavailable",
          cause: "not_offered",
        }),
    ],
    [
      "tool.namespace.selection.updated",
      async (kernel: SharedOSKernel) =>
        expect(
          (await kernel.updateToolNamespaces(context(["files"]), { enable: ["calendar"] })).summary,
        ).toMatchObject({ enabled: 1 }),
    ],
  ] as const)(
    "keeps the answer and reports it when %s cannot be written",
    async (type, operate) => {
      const { audit, onAuditError } = failingOn(type);
      const kernel = kernelWith(
        [
          grant("grant-search", FILE_RESOURCE, ["search"]),
          grant("grant-send", MESSAGE_RESOURCE, ["send"]),
        ],
        {
          audit,
          onAuditError,
          messageTransport: {
            deliver: async (_access, envelope) => ({
              messageId: envelope.id,
              status: "accepted",
              timestamp: NOW,
            }),
          },
          toolNamespaceSettings: {
            applyUpdate: async (access, update) =>
              applyToolNamespaceUpdate(access.enabledToolNamespaces, update),
          },
        },
      );
      kernel.registerTool(successfulTool());
      kernel.registerResourceProvider({
        namespace: "files",
        invoke: async (operation) => ({
          operationId: operation.operationId,
          status: "succeeded",
          output: {},
          completedAt: NOW,
        }),
      });

      await operate(kernel);

      expect(onAuditError).toHaveBeenCalledOnce();
      expect(onAuditError.mock.calls[0]?.[1]).toMatchObject({ type });
    },
  );

  describe("a sink that does not answer after an effect", () => {
    /**
     * Writes every record but the named one, which it never answers. `reached`
     * resolves once that write is asked for, so a test starts its clock there.
     */
    function silentOn(type: AuditEvent["type"]) {
      let reach: (() => void) | undefined;
      const reached = new Promise<void>((resolve) => {
        reach = resolve;
      });
      const audit: AuditSink = {
        record: (event) => {
          if (event.type !== type) {
            return Promise.resolve();
          }
          reach?.();
          return new Promise<void>(() => undefined);
        },
      };
      return { audit, reached };
    }

    it("releases the result at the limit and tells the host the record is unconfirmed", async () => {
      vi.useFakeTimers();
      try {
        const { audit, reached } = silentOn("tool.invoked");
        const onAuditError = vi.fn<NonNullable<SharedOSKernelOptions["onAuditError"]>>();
        const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
          audit,
          onAuditError,
          auditWriteTimeoutMs: 2_000,
        });
        kernel.registerTool(successfulTool());

        const settled = vi.fn();
        const invoked = kernel.invokeTool(context(["files"]), toolCall()).then(settled);
        await reached;
        await vi.advanceTimersByTimeAsync(1_999);
        // Held until the limit: the result is not released ahead of its record.
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await invoked;

        expect(settled.mock.calls[0]?.[0]).toMatchObject({ status: "succeeded" });
        expect(onAuditError).toHaveBeenCalledOnce();
        expect(onAuditError.mock.calls[0]?.[0]).toBeInstanceOf(AuditWriteTimeoutError);
        expect(onAuditError.mock.calls[0]?.[0]).toMatchObject({
          code: "audit_write_timeout",
          timeoutMs: 2_000,
        });
        expect(onAuditError.mock.calls[0]?.[1]).toMatchObject({
          type: "tool.invoked",
          outcome: "succeeded",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("holds the hook to the same limit, so a hook on the same store cannot hang the result", async () => {
      vi.useFakeTimers();
      try {
        const { audit, reached } = silentOn("tool.invoked");
        const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
          audit,
          onAuditError: () => new Promise<void>(() => undefined),
          auditWriteTimeoutMs: 500,
        });
        kernel.registerTool(successfulTool());

        const invoked = kernel.invokeTool(context(["files"]), toolCall());
        await reached;
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(invoked).resolves.toMatchObject({ status: "succeeded" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("never limits a record written before an effect", async () => {
      vi.useFakeTimers();
      try {
        const { audit, reached } = silentOn("authorization.checked");
        const handler = successfulTool();
        const invoke = vi.spyOn(handler, "invoke");
        const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
          audit,
          auditWriteTimeoutMs: 500,
        });
        kernel.registerTool(handler);

        const settled = vi.fn();
        void kernel.invokeTool(context(["files"]), toolCall()).then(settled, settled);
        await reached;
        await vi.advanceTimersByTimeAsync(60_000);

        // A decision that is not recorded is not acted on, however long that takes.
        expect(settled).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits as long as the sink takes when no limit is set", async () => {
      vi.useFakeTimers();
      try {
        const { audit, reached } = silentOn("tool.invoked");
        const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], { audit });
        kernel.registerTool(successfulTool());

        const settled = vi.fn();
        void kernel.invokeTool(context(["files"]), toolCall()).then(settled, settled);
        await reached;
        await vi.advanceTimersByTimeAsync(600_000);
        expect(settled).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([0, -1, 1.5, Number.NaN])("rejects a limit of %s", (auditWriteTimeoutMs) => {
      expect(() => kernelWith([], { auditWriteTimeoutMs })).toThrow(
        "auditWriteTimeoutMs must be a positive integer",
      );
    });
  });

  describe("a port stopped after it was entered", () => {
    function recording() {
      const events: AuditEvent[] = [];
      const seen: ProviderErrorContext[] = [];
      const audit: AuditSink = { record: async (event) => void events.push(event) };
      const onProviderError: ProviderErrorReporter = (_error, operation) =>
        void seen.push(operation);
      return { events, seen, audit, onProviderError };
    }

    it("records a tool call interrupted, and still re-throws the abort unreported", async () => {
      const { events, seen, audit, onProviderError } = recording();
      const controller = new AbortController();
      let debited = 0;
      const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
        audit,
        onProviderError,
      });
      kernel.registerTool({
        ...successfulTool(),
        invoke: async () => {
          debited += 1; // the first half of the effect commits
          controller.abort(new Error("turn timed out"));
          throw new Error("stopped before the second half");
        },
      });

      await expect(
        kernel.invokeTool(context(), toolCall(), { signal: controller.signal }),
      ).rejects.toThrow(/turn timed out/u);

      expect(debited).toBe(1);
      // Before this the trail ended at `authorization.checked: allowed`, which
      // reads as a call that never started.
      expect(events.at(-1)).toMatchObject({
        type: "tool.invoked",
        operationId: toolCall().id,
        outcome: "interrupted",
        reason: "operation_aborted",
        source: "kernel",
        grantId: "grant-search",
      });
      expect(events.at(-1)).not.toHaveProperty("failClosed");
      expect(seen).toEqual([]);
    });

    it("records a resource operation and a message delivery the same way", async () => {
      const { events, audit } = recording();
      const controller = new AbortController();
      const stop = async (): Promise<never> => {
        controller.abort(new Error("caller went away"));
        throw new Error("stopped part-way");
      };
      const kernel = kernelWith(
        [
          grant("grant-search", FILE_RESOURCE, ["search"]),
          grant("grant-message", MESSAGE_RESOURCE, ["send"]),
        ],
        { audit, messageTransport: { deliver: stop } },
      );
      kernel.registerResourceProvider({ namespace: "files", invoke: stop });

      await expect(
        kernel.invokeResource(context(), RESOURCE_REQUEST, { signal: controller.signal }),
      ).rejects.toThrow(/caller went away/u);
      expect(events.at(-1)).toMatchObject({
        type: "resource.invoked",
        operationId: "operation-1",
        outcome: "interrupted",
        reason: "operation_aborted",
        grantId: "grant-search",
      });

      const second = new AbortController();
      const sending = kernelWith([grant("grant-message", MESSAGE_RESOURCE, ["send"])], {
        audit,
        messageTransport: {
          deliver: async () => {
            second.abort(new Error("caller went away"));
            throw new Error("stopped part-way");
          },
        },
      });
      await expect(
        sending.sendMessage(context(), MESSAGE, { signal: second.signal }),
      ).rejects.toThrow(/caller went away/u);
      expect(events.at(-1)).toMatchObject({
        type: "message.sent",
        messageId: "message-1",
        outcome: "interrupted",
        reason: "operation_aborted",
        grantId: "grant-message",
      });
    });

    it("records the real outcome when the port answers despite the abort", async () => {
      const { events, audit } = recording();
      const controller = new AbortController();
      const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], { audit });
      kernel.registerTool({
        ...successfulTool(),
        invoke: async (access, call, signal) => {
          controller.abort(new Error("turn timed out"));
          return successfulTool().invoke(access, call, signal);
        },
      });

      await expect(
        kernel.invokeTool(context(), toolCall(), { signal: controller.signal }),
      ).resolves.toMatchObject({ status: "succeeded" });
      expect(events.at(-1)).toMatchObject({ type: "tool.invoked", outcome: "succeeded" });
    });

    it("records nothing for a call stopped before its port was entered", async () => {
      const { events, audit } = recording();
      const controller = new AbortController();
      const invoke = vi.fn(successfulTool().invoke);
      const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], { audit });
      kernel.registerTool({
        ...successfulTool(),
        // The requirement is resolved after the decision to look and before the
        // handler, so an abort here is one the handler never sees.
        resolveRequirement: () => {
          controller.abort(new Error("caller went away"));
          return { resource: FILE_RESOURCE, action: "search" };
        },
        invoke,
      });

      await expect(
        kernel.invokeTool(context(), toolCall(), { signal: controller.signal }),
      ).rejects.toThrow(/caller went away/u);
      expect(invoke).not.toHaveBeenCalled();
      expect(events.filter((event) => event.type === "tool.invoked")).toEqual([]);
    });
  });

  it("joins an escalation to the turn it ended, when it is told which", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (e) => void events.push(e) } });

    await kernel.recordEscalation(context(), "Needs a human", { executionId: "execution-1" });
    await kernel.recordTurnEnd(context(), { executionId: "execution-1", status: "escalated" });
    await kernel.recordEscalation(context(), "A host asking outside a turn");

    // `turn.ended` has always carried the execution as its `operationId`. The
    // escalation it ended on carried nothing, so a reviewer's queue built from
    // audit joined the two on `traceId` and the order they arrived in.
    expect(events.map(({ type, operationId }) => [type, operationId])).toEqual([
      ["escalation.requested", "execution-1"],
      ["turn.ended", "execution-1"],
      ["escalation.requested", undefined],
    ]);
  });

  it("still ends the turn escalated when the escalation cannot be written", async () => {
    // The record is the turn's terminal, not a gate: the runtime has already
    // elected to escalate and nothing waits on the write. Rejecting here ended
    // the turn `runtime_failed` and blamed a plugin that had done nothing wrong.
    const { audit, onAuditError } = failingOn("escalation.requested");
    const kernel = kernelWith([], { audit, onAuditError });

    await expect(kernel.recordEscalation(context(), "Needs a human")).resolves.toMatchObject({
      reason: "Needs a human",
      status: "pending",
    });

    expect(onAuditError).toHaveBeenCalledOnce();
    expect(onAuditError.mock.calls[0]?.[1]).toMatchObject({ type: "escalation.requested" });
  });
});

describe("SharedOSKernel provider diagnostics", () => {
  const SEARCH_GRANT = grant("grant-search", FILE_RESOURCE, ["search"]);

  function reporter(): {
    readonly onProviderError: ProviderErrorReporter;
    readonly seen: { error: unknown; operation: ProviderErrorContext }[];
  } {
    const seen: { error: unknown; operation: ProviderErrorContext }[] = [];
    return { onProviderError: (error, operation) => void seen.push({ error, operation }), seen };
  }

  it("hands a tool handler's throw to the host and puts none of it on the wire", async () => {
    const thrown = new Error('postgres: relation "notes" does not exist');
    const { onProviderError, seen } = reporter();
    const events: AuditEvent[] = [];
    const kernel = kernelWith([SEARCH_GRANT], {
      onProviderError,
      audit: { record: async (event) => void events.push(event) },
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: async () => {
        throw thrown;
      },
    });

    const result = await kernel.invokeTool(context(), toolCall());

    // Whole and unwrapped: the stack is the only thing that says which provider
    // failed and where, and a code cannot carry it.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.error).toBe(thrown);
    // `reasonCode` is what closes the loop -- it is exactly what the agent was
    // told and exactly what audit recorded, so a host joins all three without
    // correlating on timing.
    expect(seen[0]?.operation).toEqual({
      kind: "tool",
      reasonCode: "tool_execution_failed",
      traceId: "trace-1",
      namespaceId: "world-alpha",
      operationId: "call-1",
      tool: FILE_TOOL.name,
      resource: FILE_RESOURCE,
      action: "search",
    });
    expect(result).toMatchObject({ status: "failed" });
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "tool_execution_failed",
    );
    // The join itself, which is the whole point of carrying `reasonCode`: the
    // audit event for this operation records the same string the hook was
    // given, so a host's log line and its audit trail meet without anyone
    // correlating on timestamps.
    expect(events.at(-1)).toMatchObject({
      type: "tool.invoked",
      reason: seen[0]?.operation.reasonCode,
    });

    // And nowhere else. Audit has never carried call data, and a thrown message
    // may hold arguments, rows, or credentials the provider had in scope.
    expect(JSON.stringify(result)).not.toContain("relation");
    expect(JSON.stringify(events)).not.toContain("relation");
  });

  it("names the kind of port that failed, so one hook can be routed", async () => {
    const { onProviderError, seen } = reporter();
    const messagingResource: ResourceRef = {
      namespace: "sharedos.messaging",
      path: addressPath(RECEIVER),
      owner: OWNER,
    };
    const resources = new ResourceProviderRegistry();
    resources.register({
      namespace: "files",
      async invoke() {
        throw new Error("blob store offline");
      },
    });
    const kernel = kernelWith(
      [
        grant("grant-read", { ...FILE_RESOURCE, owner: OWNER }, ["read"]),
        grant("grant-send", messagingResource, ["send"]),
      ],
      {
        onProviderError,
        resources,
        messageTransport: {
          async deliver() {
            throw new Error("device unreachable");
          },
        },
      },
    );

    await kernel.invokeResource(context(), {
      operationId: "operation-1",
      resource: { ...FILE_RESOURCE, owner: OWNER },
      action: "read",
    });
    await kernel.sendMessage(context(), {
      version: "1",
      id: "message-1",
      sender: ACTOR,
      receiver: RECEIVER,
      purpose: "prepare-update",
      payload: { request: "Summarize the architecture" },
      traceId: "trace-1",
      createdAt: NOW,
    });

    // One hook, two ports, and the difference is data rather than a second
    // option a host would have had to know to install. A fifth port added later
    // reaches every host that installed this one.
    expect(seen.map(({ operation }) => [operation.kind, operation.reasonCode])).toEqual([
      ["resource", "resource_execution_failed"],
      ["message", "message_delivery_failed"],
    ]);
    expect(seen[0]?.operation.operationId).toBe("operation-1");
  });

  it("carries a tool provider's own error under the catalogue failure it caused", async () => {
    const thrown = new Error("notion: 401 unauthorized");
    const { onProviderError, seen } = reporter();
    const provider: ContextToolProvider = {
      id: "notion",
      async listTools() {
        throw thrown;
      },
    };
    const kernel = kernelWith([SEARCH_GRANT], { onProviderError, toolProviders: [provider] });

    const result = await kernel.invokeTool(context(), toolCall());

    expect(result.status).toBe("failed");
    expect(seen[0]?.operation).toMatchObject({
      kind: "tool_catalog",
      reasonCode: "tool_catalog_unavailable",
    });
    // The kernel wraps a provider failure in one sentence every caller can read,
    // which would have destroyed the only account of what actually broke. It is
    // the `cause` instead, so the wrapper is what a caller matches on and the
    // provider's error is what an operator reads.
    expect((seen[0]?.error as Error).message).toMatch(/failed to resolve its catalog/u);
    expect((seen[0]?.error as Error).cause).toBe(thrown);
  });

  it("is observational: a sink that throws changes nothing", async () => {
    let called = false;
    const kernel = kernelWith([SEARCH_GRANT], {
      onProviderError: () => {
        called = true;
        throw new Error("the host's logger is down");
      },
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: async () => {
        throw new Error("provider failed");
      },
    });

    // A diagnostic that can turn one failure into two is a liability, so the
    // guarantee is that installing it is free.
    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "failed",
      error: { code: "tool_execution_failed" },
    });
    // Asserted, because without it this test passes with the hook entirely
    // dead -- it would be restating the plain tool-failure case under a name
    // that claims to be about the guard.
    expect(called).toBe(true);
  });

  it("reports the synchronous tool callbacks that run before execution", async () => {
    const parseThrow = new Error("argument parser blew up");
    const requirementThrow = new Error("requirement resolver blew up");
    const { onProviderError, seen } = reporter();
    const kernel = kernelWith(
      [
        SEARCH_GRANT,
        grant("grant-calendar", { namespace: "calendar", path: ["primary"] }, ["create"]),
      ],
      { onProviderError },
    );
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: () => {
        throw parseThrow;
      },
      invoke: successfulTool().invoke,
    });
    kernel.registerTool({
      definition: CALENDAR_TOOL,
      parseArguments: (arguments_) => arguments_,
      resolveRequirement: () => {
        throw requirementThrow;
      },
      invoke: successfulTool(CALENDAR_TOOL).invoke,
    });

    const parsed = await kernel.invokeTool(context(), toolCall());
    const resolved = await kernel.invokeTool(
      context(),
      toolCall({ id: "call-2", tool: CALENDAR_TOOL.name }),
    );

    // Both are the tool's own code, so both are `kind: "tool"`. Neither has a
    // requirement to name yet -- the parser runs before one is resolved, and
    // the resolver is what failed to produce one.
    expect(seen[0]).toEqual({
      error: parseThrow,
      operation: {
        kind: "tool",
        reasonCode: "invalid_tool_arguments",
        traceId: "trace-1",
        namespaceId: "world-alpha",
        operationId: "call-1",
        tool: FILE_TOOL.name,
      },
    });
    expect(seen[1]).toEqual({
      error: requirementThrow,
      operation: {
        kind: "tool",
        reasonCode: "tool_requirement_resolution_failed",
        traceId: "trace-1",
        namespaceId: "world-alpha",
        operationId: "call-2",
        tool: CALENDAR_TOOL.name,
      },
    });
    // Traced to the consumer, not just to the context object: each reported
    // code is the one the caller was actually answered with.
    expect(parsed.status === "failed" ? parsed.error.code : undefined).toBe(
      seen[0]?.operation.reasonCode,
    );
    expect(resolved.status === "failed" ? resolved.error.code : undefined).toBe(
      seen[1]?.operation.reasonCode,
    );
  });

  it("reports a message capability resolver that cannot decide, naming no call", async () => {
    const thrown = new Error("recipient directory unreachable");
    const { onProviderError, seen } = reporter();
    const kernel = kernelWith([], {
      onProviderError,
      messageCapabilityResolver: {
        resolve() {
          throw thrown;
        },
      },
    });

    const result = await kernel.sendMessage(context(), {
      version: "1",
      id: "message-1",
      sender: ACTOR,
      receiver: RECEIVER,
      purpose: "prepare-update",
      payload: { request: "Summarize the architecture" },
      traceId: "trace-1",
      createdAt: NOW,
    });

    // A send outside a tool call has no call id and no tool, so the context
    // carries only what the kernel actually knew.
    expect(seen).toEqual([
      {
        error: thrown,
        operation: {
          kind: "message",
          reasonCode: "message_requirement_resolution_failed",
          traceId: "trace-1",
          namespaceId: "world-alpha",
        },
      },
    ]);
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "message_requirement_resolution_failed",
    );
  });

  it("reports a router that cannot resolve the reply it was asked for", async () => {
    const thrown = new Error("reply queue unreachable");
    const { onProviderError, seen } = reporter();
    const kernel = kernelWith(
      [
        grant(
          "grant-send",
          { namespace: "sharedos.messaging", path: addressPath(RECEIVER), owner: OWNER },
          ["send"],
        ),
      ],
      {
        onProviderError,
        messageTransport: {
          async deliver(_context, envelope) {
            return { messageId: envelope.id, status: "accepted" as const, timestamp: NOW };
          },
        },
        messageRequestRouter: {
          async resolveReply() {
            throw thrown;
          },
        },
      },
    );

    const result = await kernel.invokeTool(context(["messages"]), {
      id: "call-1",
      tool: MESSAGE_REQUEST_TOOL_NAME,
      arguments: { recipient: RECEIVER, payload: { question: "status" } },
      traceId: "trace-1",
      requestedAt: NOW,
    });

    // The router is a host port, reached only through the request tool, so the
    // report names the tool call it arrived under.
    expect(seen).toEqual([
      {
        error: thrown,
        operation: {
          kind: "message",
          reasonCode: "message_reply_resolution_failed",
          traceId: "trace-1",
          namespaceId: "world-alpha",
          operationId: "call-1",
          tool: MESSAGE_REQUEST_TOOL_NAME,
        },
      },
    ]);
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "message_reply_resolution_failed",
    );
  });

  it("is not awaited, so a sink that never returns cannot stall the operation", async () => {
    const kernel = kernelWith([SEARCH_GRANT], {
      onProviderError: () => {
        // A host logger that hangs. If the kernel awaited this, the call below
        // would never settle and the test would time out rather than fail.
        void new Promise(() => undefined);
      },
    });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: async () => {
        throw new Error("provider failed");
      },
    });

    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("leaves the authority ports it does not cover alone", async () => {
    const { onProviderError, seen } = reporter();
    const kernel = new SharedOSKernel({
      onProviderError,
      grantSource: {
        async load() {
          throw new Error("grant store unreachable");
        },
      },
    });
    kernel.registerTool(successfulTool());

    // The negative half of the documented boundary. `GrantSource` and the other
    // authority ports still discard their cause, and the docs say so; a later
    // change that wired them without saying so would show up here.
    await expect(kernel.invokeTool(context(), toolCall())).resolves.toMatchObject({
      status: "denied",
      error: { code: "authority_unavailable" },
    });
    expect(seen).toEqual([]);
  });

  it("does not report an operation the caller aborted", async () => {
    const { onProviderError, seen } = reporter();
    const controller = new AbortController();
    const kernel = kernelWith([SEARCH_GRANT], { onProviderError });
    kernel.registerTool({
      definition: FILE_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: async () => {
        controller.abort(new Error("caller went away"));
        throw new Error("aborted mid-flight");
      },
    });

    // An abort is re-thrown ahead of the containment. A caller that stopped the
    // work is not a defect, and a hook that fired here would report every
    // cancelled call as a provider failure.
    await expect(
      kernel.invokeTool(context(), toolCall(), { signal: controller.signal }),
    ).rejects.toThrow(/caller went away/u);
    expect(seen).toEqual([]);
  });
});

describe("SharedOSKernel host ceiling", () => {
  const frozen: HostCeiling = {
    narrow: () => ({
      allowed: false,
      reasonCode: "host_policy_denied",
      metadata: { rule: "hr-freeze" },
    }),
  };

  it("audits a policy refusal as its own reason, on a grant that existed", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
      authorizer: new CapabilityAuthorizer({ hostCeiling: frozen }),
    });
    kernel.registerTool(successfulTool());

    const result = await kernel.invokeTool(context(), toolCall());

    // The wire stays coarse, deliberately: telling the model that policy
    // overrode a grant would confirm the grant exists.
    expect(result).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });

    // Audit is where the real reason lives, and it is not `no_matching_grant`.
    const decision = events.find(({ type }) => type === "authorization.checked");
    expect(decision).toMatchObject({
      outcome: "denied",
      reason: "host_policy_denied",
      grantId: "grant-files",
      metadata: { rule: "hr-freeze" },
    });
    // Not an infrastructure denial: a deliberate decision the deployment made.
    expect(decision?.metadata).not.toHaveProperty("failClosed");
  });

  it("says on every authority load whether a ceiling could refuse anything", async () => {
    const withCeiling: AuditEvent[] = [];
    const withoutCeiling: AuditEvent[] = [];

    await kernelWith([], {
      audit: { record: async (event) => void withCeiling.push(event) },
      authorizer: new CapabilityAuthorizer({ hostCeiling: frozen }),
    }).listTools(context());
    await kernelWith([], {
      audit: { record: async (event) => void withoutCeiling.push(event) },
    }).listTools(context());

    // Without this, an audit stream containing no policy denials cannot be told
    // apart from one produced by a deployment that has no policy port at all.
    expect(withCeiling.find(({ type }) => type === "authority.resolved")?.metadata).toMatchObject({
      hostCeiling: "installed",
    });
    expect(
      withoutCeiling.find(({ type }) => type === "authority.resolved")?.metadata,
    ).toMatchObject({ hostCeiling: "absent" });
  });

  it.each([false, true])(
    "keeps the kernel's flags where a ceiling's failClosed: %s cannot reach them",
    async (forged) => {
      const events: AuditEvent[] = [];
      const forging: HostCeiling = {
        narrow: () => ({
          allowed: false,
          reasonCode: "host_policy_denied",
          metadata: { failClosed: forged, consumed: true, rule: "hr-freeze" },
        }),
      };
      const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
        audit: { record: async (event) => void events.push(event) },
        authorizer: new CapabilityAuthorizer({ hostCeiling: forging }),
      });
      kernel.registerTool(successfulTool());

      await kernel.invokeTool(context(), toolCall());

      // `true` is the dangerous direction: the kernel only ever *sets*
      // `failClosed` on an infrastructure denial, so while the two shared one
      // bag a ceiling could relabel a deliberate refusal as an outage and move
      // it out of the policy counts. The kernel's flags are fields now, which a
      // port has no way to write; what the ceiling said stays in `metadata`,
      // as the ceiling's (ADR 0023).
      const checked = events.find(({ type }) => type === "authorization.checked");
      expect(checked?.failClosed).toBeUndefined();
      expect(checked?.consumed).toBe(false);
      expect(checked?.metadata).toMatchObject({
        rule: "hr-freeze",
        failClosed: forged,
        consumed: true,
      });
    },
  );

  it("fails an operation closed and audits it when the ceiling itself is broken", async () => {
    const events: AuditEvent[] = [];
    const broken: HostCeiling = {
      narrow: () => {
        throw new Error("policy table is malformed");
      },
    };
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
      authorizer: new CapabilityAuthorizer({ hostCeiling: broken }),
    });
    kernel.registerTool(successfulTool());

    const result = await kernel.invokeTool(context(), toolCall());

    // This is the path where one bad policy row denies every operation in the
    // deployment, so the record has to say it was an outage and not a decision.
    expect(result).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect(events.find(({ type }) => type === "authorization.checked")).toMatchObject({
      outcome: "denied",
      reason: "host_policy_unavailable",
      failClosed: true,
    });
  });

  it("says a ceiling is installed even on the turn where authority could not load", async () => {
    const events: AuditEvent[] = [];
    const kernel = new SharedOSKernel({
      grantSource: {
        load: async () => {
          throw new Error("grant store is unreachable");
        },
      },
      audit: { record: async (event) => void events.push(event) },
      authorizer: new CapabilityAuthorizer({ hostCeiling: frozen }),
    });

    await kernel.listTools(context());

    // "Every authority load" includes the failed ones. A reader excluding
    // fail-closed turns would otherwise lose the flag exactly when a deployment
    // is misbehaving.
    expect(events.find(({ type }) => type === "authority.resolved")).toMatchObject({
      outcome: "failed",
      failClosed: true,
      metadata: { hostCeiling: "installed" },
    });
  });

  it("withholds a tool from the catalogue that the ceiling would refuse", async () => {
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      authorizer: new CapabilityAuthorizer({ hostCeiling: frozen }),
    });
    kernel.registerTool(successfulTool());

    // Discovery and invocation agree, which is the property ADR 0016 requires
    // and this ADR extends to policy.
    await expect(kernel.listTools(context())).resolves.toEqual([]);
  });
});

describe("SharedOSKernel host policy", () => {
  /** Freezes whichever namespaces the turn's loaded policy names. */
  const fromPolicy: HostCeiling<{ readonly frozen: readonly string[] }> = {
    narrow: (decision, request, _context, policy) =>
      policy !== undefined && policy.frozen.includes(request.resource.namespace)
        ? { allowed: false, reasonCode: "host_policy_denied", metadata: { rule: "loaded-freeze" } }
        : decision,
  };

  it("loads policy once at the turn boundary and decides every operation in the turn against it", async () => {
    const events: AuditEvent[] = [];
    let loads = 0;
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
      policySource: {
        load: async () => {
          loads += 1;
          return { policy: { frozen: ["files"] }, version: "freeze-7" };
        },
      },
      authorizer: new CapabilityAuthorizer({ hostCeiling: fromPolicy }),
    });
    kernel.registerTool(successfulTool());

    const turn = await kernel.openTurnAuthority(context());
    const listed = await kernel.listTools(context());
    const result = await kernel.invokeTool(context(), toolCall());
    turn.close();

    // One load, however many decisions: the rule the grant set is held to.
    expect(loads).toBe(1);
    expect(turn.status).toBe("resolved");
    expect(listed).toEqual([]);
    expect(result).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    expect(events.find(({ type }) => type === "authority.resolved")?.metadata).toMatchObject({
      hostCeiling: "installed",
      hostPolicy: "loaded",
    });
    // The listing names the policy state it was decided against, beside the
    // authority it was decided against, and counts what that cost: one tool,
    // by a decision rather than an outage.
    const listing = events.find(({ type }) => type === "tool.catalog.listed");
    expect(listing).toMatchObject({
      outcome: "succeeded",
      metadata: { hostPolicyVersion: "freeze-7", withheldCount: 1 },
    });
    expect(listing?.metadata).not.toHaveProperty("failClosed");
    expect(events.filter(({ type }) => type === "authorization.checked").at(-1)).toMatchObject({
      outcome: "denied",
      reason: "host_policy_denied",
      grantId: "grant-files",
      metadata: { rule: "loaded-freeze" },
    });
  });

  it("hands the source its own copy of the context, and the turn's signal", async () => {
    const seenByCeiling: string[] = [];
    let seenSignal: unknown;
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      policySource: {
        load: async (access, signal) => {
          seenSignal = signal;
          // A source that edits the context it was handed edits a copy.
          (access as { purpose: string }).purpose = "tampered";
          return { policy: {}, version: "empty-1" };
        },
      },
      authorizer: new CapabilityAuthorizer({
        hostCeiling: {
          narrow: (decision, _request, ceilingContext) => {
            seenByCeiling.push(ceilingContext.purpose);
            return decision;
          },
        },
      }),
    });

    const turn = await kernel.openTurnAuthority(context());
    await kernel.authorize(context(), { resource: FILE_RESOURCE, action: "search" });
    turn.close();

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenByCeiling).toEqual(["prepare-update"]);
  });

  it("fails every policy decision in the turn closed when the policy could not be loaded, and says so once", async () => {
    const events: AuditEvent[] = [];
    const reports: ProviderErrorContext[] = [];
    let loads = 0;
    let consulted = 0;
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
      onProviderError: (_error, operation) => void reports.push(operation),
      policySource: {
        load: async () => {
          loads += 1;
          throw new Error("policy table is unreachable");
        },
      },
      authorizer: new CapabilityAuthorizer({
        hostCeiling: {
          narrow: (decision) => {
            consulted += 1;
            return decision;
          },
        },
      }),
    });
    kernel.registerTool(successfulTool());

    const turn = await kernel.openTurnAuthority(context());
    const first = await kernel.invokeTool(context(), toolCall());
    const second = await kernel.invokeTool(context(), toolCall());
    const listed = await kernel.listTools(context());
    turn.close();

    // Authority itself loaded. It is the policy the turn cannot decide against.
    expect(turn.status).toBe("resolved");
    for (const result of [first, second]) {
      expect(result).toMatchObject({ status: "denied", error: { code: "tool_unavailable" } });
    }
    // Held for the turn like an unavailable grant source: not retried per
    // decision, reported once, and the ceiling is never asked to decide
    // without it.
    expect(loads).toBe(1);
    expect(consulted).toBe(0);
    expect(reports).toEqual([
      {
        kind: "policy",
        reasonCode: "host_policy_unavailable",
        traceId: "trace-1",
        namespaceId: "world-alpha",
      },
    ]);
    expect(events.find(({ type }) => type === "authority.resolved")?.metadata).toMatchObject({
      hostCeiling: "installed",
      hostPolicy: "unavailable",
    });
    const decisions = events.filter(({ type }) => type === "authorization.checked");
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      // An outage, not a decision: the record says so, and the bucket is the
      // one a broken ceiling already uses.
      expect(decision).toMatchObject({
        outcome: "denied",
        reason: "host_policy_unavailable",
        failClosed: true,
      });
    }
    // The catalogue was computed, and empty, and the record says why the
    // difference matters: what it withheld, it withheld by an outage, and it
    // has no policy version to name.
    expect(listed).toEqual([]);
    const listing = events.find(({ type }) => type === "tool.catalog.listed");
    expect(listing).toMatchObject({
      outcome: "succeeded",
      failClosed: true,
      metadata: { withheldCount: 1 },
    });
    expect(listing?.metadata).not.toHaveProperty("hostPolicyVersion");
  });

  it("treats a source that answered without naming its version as an outage", async () => {
    const events: AuditEvent[] = [];
    const errors: unknown[] = [];
    const reports: ProviderErrorContext[] = [];
    const kernel = kernelWith([grant("grant-files", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
      onProviderError: (error, operation) => {
        errors.push(error);
        reports.push(operation);
      },
      // The pre-`LoadedPolicy` shape: a bare policy, nothing to record it by.
      policySource: { load: async () => ({ frozen: [] }) as unknown as LoadedPolicy },
      authorizer: new CapabilityAuthorizer({ hostCeiling: { narrow: (decision) => decision } }),
    });

    await expect(
      kernel.authorize(context(), { resource: FILE_RESOURCE, action: "search" }),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "host_policy_unavailable" });

    // Nothing could pin a decision to the policy it was made against, so
    // nothing was decided against it -- and the host is told, once, in the
    // shape a throw would have been.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(reports).toEqual([
      {
        kind: "policy",
        reasonCode: "host_policy_unavailable",
        traceId: "trace-1",
        namespaceId: "world-alpha",
      },
    ]);
    expect(events.find(({ type }) => type === "authority.resolved")?.metadata).toMatchObject({
      hostPolicy: "unavailable",
    });
  });

  it("records what the policy load came to even on a turn where authority could not load", async () => {
    const events: AuditEvent[] = [];
    const kernel = new SharedOSKernel({
      grantSource: {
        load: async () => {
          throw new Error("grant store is unreachable");
        },
      },
      policySource: { load: async () => ({ policy: { frozen: [] }, version: "freeze-0" }) },
      audit: { record: async (event) => void events.push(event) },
    });

    await kernel.listTools(context());

    // The two loads are independent, and the record says what each did.
    expect(events.find(({ type }) => type === "authority.resolved")).toMatchObject({
      outcome: "failed",
      failClosed: true,
      metadata: { hostCeiling: "absent", hostPolicy: "loaded" },
    });
  });

  it("says no policy was loaded when no source is installed", async () => {
    const events: AuditEvent[] = [];

    await kernelWith([], { audit: { record: async (event) => void events.push(event) } }).listTools(
      context(),
    );

    // `absent` is "no source", not "no policy": a ceiling may close over its
    // own, and the record beside it says whether one is installed.
    expect(events.find(({ type }) => type === "authority.resolved")?.metadata).toMatchObject({
      hostCeiling: "absent",
      hostPolicy: "absent",
    });
  });

  it("re-throws a cancelled load rather than reporting it as an outage", async () => {
    const reports: ProviderErrorContext[] = [];
    const controller = new AbortController();
    const kernel = kernelWith([], {
      onProviderError: (_error, operation) => void reports.push(operation),
      policySource: {
        load: async (_access, signal) => {
          controller.abort(new Error("caller went away"));
          throw signal.reason;
        },
      },
    });

    await expect(
      kernel.openTurnAuthority(context(), { signal: controller.signal }),
    ).rejects.toThrow(/caller went away/u);
    expect(reports).toEqual([]);
  });

  it("refuses a policy source that cannot load", () => {
    expect(
      () =>
        new SharedOSKernel({
          grantSource: new TestGrantSource(),
          policySource: {} as PolicySource,
        }),
    ).toThrow(TypeError);
  });
});

describe("SharedOSKernel audit routing", () => {
  it("names the boundary and the cause on every tool refusal it records", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (e) => void events.push(e) } });
    kernel.registerTool(successfulTool());

    // Not registered, and the wire code cannot say which of the three this is.
    await kernel.invokeTool(context(), { ...toolCall(), tool: "files.invented" });
    // Registered, granted, but its namespace is off for this context.
    await kernel.invokeTool({ ...context(), enabledToolNamespaces: [] }, toolCall());
    // Registered and enabled, but no grant makes it discoverable.
    await kernel.invokeTool(context(), toolCall());

    const invoked = events.filter(({ type }) => type === "tool.invoked");
    expect(invoked.map(({ reason }) => reason)).toEqual([
      "tool_unavailable",
      "tool_unavailable",
      "tool_unavailable",
    ]);
    // One code on the wire, three situations in the trail. `errors.md` has
    // promised this disambiguation all along and delivered it for one of them.
    expect(invoked.map(({ cause }) => cause)).toEqual([
      "not_registered",
      "namespace_disabled",
      "no_matching_grant",
    ]);
    expect(invoked.every(({ source }) => source === "kernel")).toBe(true);
  });

  it("marks an outage failClosed on every operation event, not only on a tool call", async () => {
    // `docs/errors.md` tells a host to exclude `failClosed` records before it
    // computes a denial rate. The resource and message records were built apart
    // from the tool one and never carried the flag, so a grant store that was
    // down read as two deliberate refusals and one outage.
    const events: AuditEvent[] = [];
    const kernel = new SharedOSKernel({
      grantSource: {
        load: async () => {
          throw new Error("grant store is unreachable");
        },
      },
      audit: { record: async (e) => void events.push(e) },
    });

    await kernel.invokeTool(context(), toolCall());
    await kernel.invokeResource(context(), {
      operationId: "operation-1",
      resource: FILE_RESOURCE,
      action: "search",
    });
    await kernel.sendMessage(context(), {
      version: "1",
      id: "message-1",
      sender: ACTOR,
      receiver: RECEIVER,
      purpose: "prepare-update",
      payload: {},
      traceId: "trace-1",
      createdAt: NOW,
    });

    const operations = events.filter(({ type }) =>
      ["tool.invoked", "resource.invoked", "message.sent"].includes(type),
    );
    expect(operations.map(({ type }) => type)).toEqual([
      "tool.invoked",
      "resource.invoked",
      "message.sent",
    ]);
    for (const operation of operations) {
      expect(operation).toMatchObject({
        outcome: "denied",
        reason: "authority_unavailable",
        source: "kernel",
        failClosed: true,
      });
    }
  });

  it("names the catalogue a guessed tool was never offered from", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: { record: async (e) => void events.push(e) },
    });
    kernel.registerTool(successfulTool());
    const access = context(["files"]);

    const scope = await kernel.openTurnAuthority(access);
    try {
      await kernel.listTools(access);
      await kernel.recordRefusedCall(access, {
        callId: "call-guessed",
        tool: "files.delete",
        reasonCode: "tool_unavailable",
        cause: "not_offered",
      });
    } finally {
      scope.close();
    }

    // The kernel's own `tool.invoked` has carried the turn's catalogue since
    // ADR 0026. The envelope's was built separately and did not, so the one
    // refusal that is *about* the catalogue could not be joined to it.
    const listed = events.find(({ type }) => type === "tool.catalog.listed");
    const refused = events.find(({ type }) => type === "tool.invoked");
    expect(refused?.source).toBe("envelope");
    expect(refused?.metadata).toEqual({ catalogHash: listed?.metadata?.["catalogHash"] });
  });

  it("records a listing by what it was computed from, not by the names it returned or withheld", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: { record: async (e) => void events.push(e) },
    });
    kernel.registerTool(successfulTool(CALENDAR_TOOL));
    kernel.registerTool(successfulTool());

    const visible = await kernel.listTools(context(["files"]));

    // The file tool shown; the calendar tool withheld by the caller's own
    // filter. The record carries the catalogue as an identifier, the filter,
    // and a count -- and, above metadata, the authority it was decided against.
    expect(visible).toEqual([FILE_TOOL]);
    const listed = events.filter(({ type }) => type === "tool.catalog.listed");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.authorityHash).toBe(
      events.find(({ type }) => type === "authority.resolved")?.authorityHash,
    );
    expect(listed[0]?.metadata).toEqual({
      catalogHash: await catalogHash(publishToolCatalog([FILE_TOOL])),
      enabledNamespaces: ["files"],
      withheldCount: 1,
    });
    expect(listed[0]?.source).toBe("kernel");
  });

  it("records the catalogue under the identifier a harness is handed for it", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith(
      [
        grant("grant-search", FILE_RESOURCE, ["search"]),
        grant("grant-calendar", CALENDAR_TOOL.requiredCapability.resource, ["create"]),
      ],
      { audit: { record: async (e) => void events.push(e) } },
    );
    kernel.registerTool(successfulTool(CALENDAR_TOOL));
    kernel.registerTool(successfulTool());

    const published = await kernel.listPublishedTools(context(), { executionId: "exec-1" });

    // One catalogue, one identifier, wherever it is read: the manifest a
    // harness reports and the audit record the kernel wrote match on it, and
    // registration order is not part of it.
    expect(published.tools.map(({ name }) => name)).toEqual([CALENDAR_TOOL.name, FILE_TOOL.name]);
    expect(events.find(({ type }) => type === "tool.catalog.listed")?.metadata).toMatchObject({
      catalogHash: published.catalogHash,
      enabledNamespaces: ["files", "calendar"],
      withheldCount: 0,
    });
  });

  it("records a refused listing with the same identifiers and an empty catalogue", async () => {
    const events: AuditEvent[] = [];
    const kernel = new SharedOSKernel({
      grantSource: {
        load: async () => {
          throw new Error("grant store is unreachable");
        },
      },
      audit: { record: async (e) => void events.push(e) },
    });

    await expect(kernel.listTools(context(["files"]))).resolves.toEqual([]);

    expect(events.find(({ type }) => type === "tool.catalog.listed")).toMatchObject({
      outcome: "denied",
      reason: "authority_unavailable",
      source: "kernel",
      failClosed: true,
      metadata: {
        catalogHash: await catalogHash([]),
        enabledNamespaces: ["files"],
        withheldCount: 0,
        authority: "grant_source_failed",
      },
    });
  });

  it("records how a turn ended, once, from the boundary that ended it", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (e) => void events.push(e) } });

    await kernel.recordTurnEnd(context(), {
      executionId: "exec-1",
      status: "failed",
      reasonCode: "runtime_failed",
      endedBy: "envelope",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "turn.ended",
        outcome: "failed",
        reason: "runtime_failed",
        operationId: "exec-1",
        endedBy: "envelope",
      }),
    ]);
    // Who recorded is always the envelope, so the record does not say it;
    // `source` is who refused, and is kept for the events where that varies.
    expect(events[0]?.source).toBeUndefined();
    expect(events[0]?.metadata).toBeUndefined();
  });

  it("records a cancelled turn as failed with its own reason, adding no outcome", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (e) => void events.push(e) } });

    await kernel.recordTurnEnd(context(), {
      executionId: "exec-2",
      status: "cancelled",
      reasonCode: "turn_cancelled",
    });

    // `AuditOutcome` is a compatibility surface every host persists against, so
    // a deadline is `failed` with a reason rather than a sixth value.
    expect(events[0]).toMatchObject({ type: "turn.ended", outcome: "failed" });
    expect(events[0]?.reason).toBe("turn_cancelled");
  });

  it("records a call the envelope refused as the attempted call it was", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([], { audit: { record: async (e) => void events.push(e) } });

    await kernel.recordRefusedCall(context(), {
      callId: "call-9",
      tool: "files.delete",
      reasonCode: "tool_unavailable",
      cause: "not_offered",
    });

    // An agent naming a tool it was never offered is the clearest attempted
    // violation the system produces, and it reached no audit sink at all.
    expect(events[0]).toMatchObject({
      type: "tool.invoked",
      outcome: "denied",
      reason: "tool_unavailable",
      operationId: "call-9",
      tool: "files.delete",
      source: "envelope",
      cause: "not_offered",
    });
  });
});

describe("SharedOSKernel.reach", () => {
  const CALENDAR_RESOURCE: ResourceRef = { namespace: "calendar", path: ["primary"] };

  async function computedReach(kernel: SharedOSKernel, access = context()) {
    const result = await kernel.reach(access);
    if (result.status !== "computed") {
      throw new Error(`reach was ${result.reasonCode}`);
    }
    return result.reach;
  }

  it("names only places the kernel would authorize, and nothing about who allowed them", async () => {
    const kernel = kernelWith([
      grant("grant-files", FILE_RESOURCE, ["read", "search"]),
      grant("grant-calendar", CALENDAR_RESOURCE, ["read"]),
    ]);

    const reach = await computedReach(kernel);
    expect(reach.length).toBeGreaterThan(0);

    // The property that keeps the projection honest: every place it names, with
    // every action it names, is one the kernel actually allows right now.
    for (const entry of reach) {
      expect(Object.keys(entry).sort()).toEqual(["actions", "namespace", "path", "scope"]);
      for (const action of entry.actions) {
        const decision = await kernel.authorize(context(), {
          resource: { namespace: entry.namespace, path: entry.path, owner: OWNER },
          action,
        });
        expect(decision.allowed, `${entry.namespace}/${entry.path.join("/")}·${action}`).toBe(true);
      }
    }
    expect(JSON.stringify(reach)).not.toContain("grant-");
    expect(JSON.stringify(reach)).not.toContain("user-alice");
  });

  it("is grant reach: a namespace whose tools are switched off still appears", async () => {
    const kernel = kernelWith([
      grant("grant-files", FILE_RESOURCE, ["search"]),
      grant("grant-calendar", CALENDAR_RESOURCE, ["read"]),
    ]);

    // The resource plane is not gated by tool namespaces, so the actor still
    // reaches the calendar through `invokeResource`. A caller acting only
    // through tools narrows to its catalogue with `reachThroughTools`.
    const reach = await computedReach(kernel, context(["files"]));
    expect(reach.map(({ namespace }) => namespace)).toEqual(["calendar", "files"]);
  });

  it("is unavailable rather than narrower when a bounded budget cannot be read", async () => {
    // The default authorizer installs no usage store.
    const kernel = kernelWith([
      grant("grant-files", FILE_RESOURCE, ["search"]),
      grant("grant-bounded", CALENDAR_RESOURCE, ["read"], { maxUses: 2 }),
    ]);

    await expect(kernel.reach(context())).resolves.toEqual({
      status: "unavailable",
      reasonCode: "usage_store_unavailable",
    });
  });

  it("is unavailable rather than empty when the authority cannot be loaded", async () => {
    const kernel = new SharedOSKernel({
      grantSource: {
        load: async () => {
          throw new Error("grant store is unreachable");
        },
      },
    });

    await expect(kernel.reach(context())).resolves.toEqual({
      status: "unavailable",
      reasonCode: "authority_unavailable",
    });
  });

  it("reads the authority the turn holds, so a grant revoked mid-turn is reach until the next turn", async () => {
    const source = new TestGrantSource([grant("grant-files", FILE_RESOURCE, ["search"])]);
    const kernel = new SharedOSKernel({ grantSource: source });

    const turn = await kernel.openTurnAuthority(context());
    source.serve([]);
    const held = await computedReach(kernel);
    turn.close();
    const next = await computedReach(kernel);

    expect(held).toHaveLength(1);
    expect(next).toEqual([]);
  });

  it("consumes nothing", async () => {
    const usageStore = new InMemoryGrantUsageStore();
    const kernel = kernelWith([grant("grant-bounded", FILE_RESOURCE, ["search"], { maxUses: 1 })], {
      authorizer: new CapabilityAuthorizer({ usageStore }),
    });

    expect(await computedReach(kernel)).toHaveLength(1);
    expect(await computedReach(kernel)).toHaveLength(1);
    expect(await usageStore.getUsage("world-alpha", "grant-bounded")).toBe(0);
  });
});

describe("SharedOSKernel audit identity", () => {
  it("records the same question asked twice in one turn as two records", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith([grant("grant-search", FILE_RESOURCE, ["search"])], {
      audit: { record: async (event) => void events.push(event) },
    });
    const requirement = { resource: FILE_RESOURCE, action: "search" };

    await kernel.authorize(context(), requirement);
    await kernel.authorize(context(), requirement);

    const checks = events.filter(({ type }) => type === "authorization.checked");
    expect(checks).toHaveLength(2);
    // A bare authorize names no operation and the turn has one instant, so the
    // two records agree on every field but the one that is theirs alone.
    const [first, second] = checks.map(({ id, ...content }) => ({ id, content }));
    expect(first?.content).toEqual(second?.content);
    expect(first?.id).not.toBe(second?.id);
    expect(new Set(events.map(({ id }) => id)).size).toBe(events.length);
  });

  it("mints ids through the factory the host installed", async () => {
    const events: AuditEvent[] = [];
    let sequence = 0;
    const kernel = kernelWith([], {
      audit: { record: async (event) => void events.push(event) },
      createAuditId: () => `audit-${(sequence += 1)}`,
    });

    await kernel.recordTurnEnd(context(), { executionId: "exec-1", status: "succeeded" });
    await kernel.recordEscalation(context(), "needs a wider grant");

    expect(events.map(({ id }) => id)).toEqual(["audit-1", "audit-2"]);
  });
});
