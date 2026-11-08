import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AuditEventSchema,
  AccessContextSchema,
  AuthorizationDecisionSchema,
  CapabilityGrantSchema,
  EscalationSchema,
  ExecutionRequestSchema,
  JsonValueSchema,
  PROTOCOL_VERSION,
  ProtocolVersionSchema,
  SHAREDOS_API_ERROR_CODES,
  SHAREDOS_ROUTES,
  isJsonObject,
  MessageDeliveryResultSchema,
  MessageEnvelopeSchema,
  MessageRequestArgumentsSchema,
  RemoteExecutionRequestSchema,
  RemoteResourceOperationSchema,
  ResourceRefSchema,
  RuntimeEventSchema,
  RuntimeManifestSchema,
  RuntimeTurnOutcomeSchema,
  ResourceOperationSchema,
  ToolDefinitionSchema,
  ToolNamespaceCatalogSchema,
  ToolNamespaceUpdateSchema,
  ToolResultSchema,
  type AccessContext,
  type JsonValue,
  ReachResultSchema,
} from "./index.js";

const actor = { kind: "agent" as const, agentId: "agent-bob" };
const owner = { kind: "human" as const, userId: "alice" };
const now = "2026-08-03T10:00:00.000Z";

const grant = {
  id: "grant-1",
  namespaceId: "aicoo:alice",
  subject: actor,
  issuer: owner,
  capabilities: [
    {
      resource: {
        namespace: "files",
        path: ["Workspace", "project-x"],
        owner,
      },
      actions: ["search", "read"],
      scope: "descendants" as const,
    },
  ],
  constraints: {
    purposes: ["prepare-investor-update"],
    expiresAt: "2026-08-04T10:00:00.000Z",
  },
  issuedAt: now,
};

const context = {
  namespaceId: "aicoo:alice",
  enabledToolNamespaces: ["files"],
  actor,
  authority: owner,
  owner,
  purpose: "prepare-investor-update",
  traceId: "trace-1",
  now,
};

describe("JSON-safe protocol contracts", () => {
  it("carries a reach across the wire as the kernel answered it", () => {
    const computed = {
      status: "computed",
      reach: [{ namespace: "files", path: ["Work"], actions: ["read"], scope: "descendants" }],
    };
    const unavailable = { status: "unavailable", reasonCode: "usage_store_unavailable" };

    expect(ReachResultSchema.parse(computed)).toEqual(computed);
    expect(ReachResultSchema.parse(unavailable)).toEqual(unavailable);
    // An unavailable reach names one of the infrastructure codes and nothing else.
    expect(
      ReachResultSchema.safeParse({ status: "unavailable", reasonCode: "no_matching_grant" })
        .success,
    ).toBe(false);
    expect(ReachResultSchema.safeParse({ ...computed, grantId: "grant-1" }).success).toBe(false);
  });

  it("accepts nested JSON and rejects values JSON cannot preserve", () => {
    const value = { nested: ["hello", 42, true, null] };

    expect(JsonValueSchema.parse(value)).toEqual(value);
    expect(JsonValueSchema.safeParse({ bad: undefined }).success).toBe(false);
    expect(JsonValueSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(JsonValueSchema.safeParse(new Date()).success).toBe(false);
  });

  it("parses a complete access context and grant", () => {
    expect(CapabilityGrantSchema.parse(grant)).toEqual(grant);
    expect(AccessContextSchema.parse(context)).toEqual(context);
    expectTypeOf(AccessContextSchema.parse(context)).toEqualTypeOf<AccessContext>();
  });

  it("sets no size limit on a grant or a context", () => {
    const long = "x".repeat(10_000);
    const capability = {
      resource: {
        namespace: long,
        path: Array.from({ length: 500 }, (_value, index) => `${long}-${index}`),
        owner,
      },
      actions: Array.from({ length: 500 }, (_value, index) => `${long}-${index}`),
      scope: "descendants" as const,
    };
    const large = {
      ...grant,
      id: long,
      capabilities: Array.from({ length: 200 }, () => capability),
      constraints: {
        ...grant.constraints,
        purposes: Array.from({ length: 200 }, (_value, index) => `${long}-${index}`),
      },
    };

    expect(CapabilityGrantSchema.safeParse(large).success).toBe(true);
    expect(
      AccessContextSchema.safeParse({ ...context, purpose: long, traceId: long }).success,
    ).toBe(true);
  });

  it("round-trips an optional execution id without granting authority", () => {
    const turnContext = { ...context, executionId: "execution-1" };
    expect(AccessContextSchema.parse(JSON.parse(JSON.stringify(turnContext)))).toEqual(turnContext);
    expect(AccessContextSchema.safeParse({ ...context, executionId: "" }).success).toBe(false);
  });

  it("keeps authority out of an access context", () => {
    expect(AccessContextSchema.safeParse({ ...context, grants: [grant] }).success).toBe(false);
  });

  it("requires an explicit, internally consistent tool namespace policy", () => {
    const definition = {
      name: "calendar.search",
      description: "Search a calendar",
      namespace: "calendar",
      source: "native",
      readWrite: "read",
      inputSchema: { type: "object" },
      requiredCapability: {
        resource: { namespace: "calendar", path: ["primary"] },
        action: "read",
      },
      annotations: { readOnly: true },
    };

    expect(ToolDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(ToolDefinitionSchema.safeParse({ ...definition, namespace: undefined }).success).toBe(
      false,
    );
    expect(
      ToolDefinitionSchema.safeParse({
        ...definition,
        annotations: { destructive: true },
      }).success,
    ).toBe(false);
    expect(
      AccessContextSchema.safeParse({ ...context, enabledToolNamespaces: ["files", "files"] })
        .success,
    ).toBe(false);
    expect(
      ToolNamespaceCatalogSchema.safeParse({
        namespaces: [{ namespace: "calendar", sources: ["native"], toolCount: 5, enabled: true }],
        summary: { total: 1, enabled: 1, disabled: 0 },
      }).success,
    ).toBe(true);
    expect(
      ToolNamespaceCatalogSchema.safeParse({
        namespaces: [{ namespace: "calendar", sources: ["native"], toolCount: 5, enabled: true }],
        summary: { total: 1, enabled: 0, disabled: 1 },
      }).success,
    ).toBe(false);
    expect(ToolNamespaceUpdateSchema.parse({ enable: ["calendar"] })).toEqual({
      enable: ["calendar"],
    });
    expect(ToolNamespaceUpdateSchema.safeParse({ enable: [], disable: [] }).success).toBe(false);
    expect(
      ToolNamespaceUpdateSchema.safeParse({ enable: ["calendar"], disable: ["calendar"] }).success,
    ).toBe(false);
  });

  it("shares authorization decisions without leaking provider state", () => {
    expect(
      AuthorizationDecisionSchema.parse({
        allowed: true,
        reasonCode: "grant_matched",
        matchedGrantId: "grant-1",
      }),
    ).toEqual({
      allowed: true,
      reasonCode: "grant_matched",
      matchedGrantId: "grant-1",
    });
  });

  it("lets a decision and an escalation name the authority they are about", () => {
    const request = {
      id: "capreq-1",
      namespaceId: "aicoo:alice",
      requester: actor,
      owner,
      capabilities: [
        {
          resource: { namespace: "files", path: ["Memory", "project-x"], owner },
          actions: ["read"],
          scope: "exact" as const,
        },
      ],
      purpose: "prepare-update",
      requestedAt: now,
    };

    // A description on a denial: allowed stays false, and the field is the only
    // thing that changed about what a denial can say.
    expect(
      AuthorizationDecisionSchema.parse({
        allowed: false,
        reasonCode: "no_matching_grant",
        requiredAuthority: request,
      }),
    ).toMatchObject({ allowed: false, requiredAuthority: { id: "capreq-1" } });

    expect(
      EscalationSchema.parse({
        reason: "alice should decide this",
        reviewer: owner,
        requestedAt: now,
        status: "pending",
        requestedAuthority: request,
      }).requestedAuthority,
    ).toEqual(request);

    // Both are optional: the shapes that existed before this field still parse.
    expect(
      AuthorizationDecisionSchema.safeParse({ allowed: false, reasonCode: "no_matching_grant" })
        .success,
    ).toBe(true);
    expect(
      EscalationSchema.safeParse({
        reason: "this needs a person",
        reviewer: owner,
        requestedAt: now,
        status: "pending",
      }).success,
    ).toBe(true);

    // And neither accepts something that is not a capability request. The field
    // is a contract type, so a host cannot smuggle a bag of its own through it.
    expect(
      AuthorizationDecisionSchema.safeParse({
        allowed: false,
        reasonCode: "no_matching_grant",
        requiredAuthority: { id: "capreq-1", capabilities: [] },
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid capability time window", () => {
    const invalid = {
      ...grant,
      constraints: {
        notBefore: "2026-08-05T10:00:00.000Z",
        expiresAt: "2026-08-04T10:00:00.000Z",
      },
    };

    expect(CapabilityGrantSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([["."], [".."], ["project/secret"], ["project\\secret"], ["nul\u0000byte"]])(
    "rejects unsafe structured path segment %j",
    (path) => {
      expect(ResourceRefSchema.safeParse({ namespace: "files", path }).success).toBe(false);
    },
  );

  it("has one message purpose and rejects the removed intent field", () => {
    const message = {
      version: "1",
      id: "message-1",
      sender: actor,
      receiver: { kind: "agent" as const, agentId: "agent-alice" },
      purpose: "prepare-investor-update",
      payload: { query: "latest project status" },
      traceId: "trace-1",
      createdAt: now,
    };

    expect(MessageEnvelopeSchema.parse(message)).toEqual(message);
    expect(MessageEnvelopeSchema.safeParse({ ...message, intent: "summarize" }).success).toBe(
      false,
    );
  });

  it("accepts only recipient and JSON-safe payload as model-authored message request input", () => {
    expect(
      MessageRequestArgumentsSchema.safeParse({
        recipient: actor,
        payload: { taskId: "Q1" },
      }).success,
    ).toBe(true);

    for (const field of ["sender", "purpose", "traceId", "messageId", "intent", "replyTo"]) {
      expect(
        MessageRequestArgumentsSchema.safeParse({
          recipient: actor,
          payload: {},
          [field]: "forged",
        }).success,
      ).toBe(false);
    }

    expect(
      MessageRequestArgumentsSchema.safeParse({ recipient: actor, payload: { bad: undefined } })
        .success,
    ).toBe(false);
  });

  it("validates model-authored recipient IDs without normalization, at any length", () => {
    const recipient = (kind: string, idKey: string, id: string) => ({
      kind,
      [idKey]: id,
    });
    const variants = [
      ["human", "userId"],
      ["agent", "agentId"],
      ["group", "conversationId"],
      ["service", "serviceId"],
    ] as const;
    const invalidWhitespace = [
      "",
      " ",
      "\tidentifier",
      "identifier\n",
      "\uFEFFidentifier",
      "identifier\u00A0",
    ];
    const asciiLong = "a".repeat(10_000);
    const emojiLong = "😀".repeat(10_000);

    for (const [kind, idKey] of variants) {
      const parse = (id: string) =>
        MessageRequestArgumentsSchema.safeParse({
          recipient: recipient(kind, idKey, id),
          payload: {},
        });

      for (const id of invalidWhitespace) {
        expect(parse(id).success, `${kind} should reject ${JSON.stringify(id)}`).toBe(false);
      }
      expect(parse(asciiLong).success).toBe(true);
      expect(parse(emojiLong).success).toBe(true);
    }
  });

  it("requires an error when message delivery fails", () => {
    expect(
      MessageDeliveryResultSchema.safeParse({
        messageId: "message-1",
        status: "denied",
        timestamp: now,
        error: { code: "no_matching_grant", message: "Permission denied" },
      }).success,
    ).toBe(true);
    expect(
      MessageDeliveryResultSchema.safeParse({
        messageId: "message-1",
        status: "failed",
        timestamp: now,
      }).success,
    ).toBe(false);
    expect(
      MessageDeliveryResultSchema.safeParse({
        messageId: "message-1",
        status: "delivered",
        timestamp: now,
      }).success,
    ).toBe(true);
  });

  it("validates resource and execution requests at their wire boundaries", () => {
    const message = {
      version: "1" as const,
      id: "message-1",
      sender: owner,
      receiver: actor,
      purpose: context.purpose,
      payload: { query: "project status" },
      traceId: context.traceId,
      createdAt: now,
    };
    const tool = {
      name: "files.search",
      description: "Search an authorized file path",
      namespace: "files",
      source: "sharedos",
      readWrite: "read" as const,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
      requiredCapability: {
        resource: { namespace: "files", path: ["Workspace", "project-x"], owner },
        action: "search",
      },
      annotations: { readOnly: true },
    };

    expect(
      ResourceOperationSchema.safeParse({
        operationId: "operation-1",
        context,
        resource: tool.requiredCapability.resource,
        action: "search",
        input: { query: "project status" },
      }).success,
    ).toBe(true);

    expect(
      ExecutionRequestSchema.safeParse({
        version: "1",
        executionId: "execution-1",
        agent: actor,
        context,
        message,
        tools: [tool],
      }).success,
    ).toBe(true);
    // SharedOS sets no ceiling on a turn: any positive limit a host names is
    // admitted, and a non-positive one is still not a limit at all.
    expect(
      ExecutionRequestSchema.safeParse({
        version: "1",
        executionId: "execution-long-lived",
        agent: actor,
        context,
        message,
        tools: [tool],
        options: { maxSteps: 1_000_001, maxToolCalls: 10_000_001, timeoutMs: 30 * 86_400_000 },
      }).success,
    ).toBe(true);
    expect(
      ExecutionRequestSchema.safeParse({
        version: "1",
        executionId: "execution-no-time",
        agent: actor,
        context,
        message,
        tools: [tool],
        options: { timeoutMs: 0 },
      }).success,
    ).toBe(false);
    expect(
      ExecutionRequestSchema.safeParse({
        version: "1",
        executionId: "execution-1",
        agent: actor,
        context,
        message,
        tools: [tool],
        runtimeId: "message-selected-runtime",
      }).success,
    ).toBe(false);
  });

  it("uses discriminated results so failures cannot masquerade as output", () => {
    expect(
      ToolResultSchema.safeParse({
        callId: "call-1",
        tool: "files.search",
        status: "failed",
        output: [],
        completedAt: now,
      }).success,
    ).toBe(false);

    expect(
      ToolResultSchema.safeParse({
        callId: "call-1",
        tool: "files.search",
        status: "failed",
        error: { code: "provider_unavailable", message: "Try again" },
        completedAt: now,
      }).success,
    ).toBe(true);
  });

  it("keeps runtime manifests, events, and outcomes JSON-safe", () => {
    expect(
      RuntimeManifestSchema.parse({
        id: "sharedos.standard",
        version: "0.1.0-alpha.0",
        protocolVersion: "1",
        metadata: { executionModel: "bounded-driver-loop" },
      }),
    ).toMatchObject({ id: "sharedos.standard", protocolVersion: "1" });
    expect(
      RuntimeManifestSchema.safeParse({
        id: "broken",
        version: "1",
        protocolVersion: "1",
        load: () => undefined,
      }).success,
    ).toBe(false);
    expect(RuntimeEventSchema.safeParse({ type: "progress", data: { step: 1 } }).success).toBe(
      true,
    );
    expect(
      RuntimeTurnOutcomeSchema.safeParse({ type: "complete", output: { ok: true } }).success,
    ).toBe(true);
    expect(
      RuntimeTurnOutcomeSchema.safeParse({
        type: "fail",
        error: { code: "runtime_failed", message: "Failed" },
      }).success,
    ).toBe(true);
    expect(
      RuntimeTurnOutcomeSchema.safeParse({ type: "complete", output: undefined }).success,
    ).toBe(false);
  });

  it("keeps authority out of remote HTTP request contracts", () => {
    expect(
      RemoteResourceOperationSchema.safeParse({
        operationId: "operation-1",
        resource: { namespace: "files", path: ["Workspace", "project-x"] },
        action: "read",
      }).success,
    ).toBe(true);
    expect(
      RemoteResourceOperationSchema.safeParse({
        operationId: "operation-1",
        resource: { namespace: "files", path: ["Workspace", "project-x"] },
        action: "read",
        context,
      }).success,
    ).toBe(false);
    expect(
      RemoteExecutionRequestSchema.safeParse({
        version: "1",
        executionId: "execution-1",
        agent: actor,
        message: {
          version: "1",
          id: "message-1",
          sender: owner,
          receiver: actor,
          purpose: context.purpose,
          payload: null,
          traceId: context.traceId,
          createdAt: now,
        },
        context,
        tools: [],
      }).success,
    ).toBe(false);
  });

  it("exports JsonValue as the schema's recursive value type", () => {
    expectTypeOf(JsonValueSchema.parse({ ok: true })).toEqualTypeOf<JsonValue>();
  });
});

describe("the HTTP route table", () => {
  it("lists every verb a path answers, so the handler and the client cannot disagree", () => {
    const verbsByPath = new Map<string, string[]>();
    for (const route of Object.values(SHAREDOS_ROUTES)) {
      expect(route.path.startsWith("/")).toBe(true);
      verbsByPath.set(route.path, [...(verbsByPath.get(route.path) ?? []), route.method]);
    }

    expect(verbsByPath.size).toBe(9);
    expect(verbsByPath.get("/v1/tools/namespaces")).toEqual(["GET", "PUT"]);
    for (const route of Object.values(SHAREDOS_ROUTES)) {
      expect(route.method === "GET" ? "request" in route : route.request !== undefined).toBe(
        route.method !== "GET",
      );
    }
  });

  it("stamps the health answer with the one protocol version", () => {
    expect(ProtocolVersionSchema.parse(PROTOCOL_VERSION)).toBe("1");
    expect(
      SHAREDOS_ROUTES.health.response.safeParse({ status: "ok", protocolVersion: PROTOCOL_VERSION })
        .success,
    ).toBe(true);
    expect(new Set(SHAREDOS_API_ERROR_CODES).size).toBe(SHAREDOS_API_ERROR_CODES.length);
  });
});

describe("isJsonObject", () => {
  it("accepts a record and refuses null, arrays and primitives", () => {
    expect(isJsonObject({ ok: true })).toBe(true);
    expect(isJsonObject({})).toBe(true);
    for (const value of [null, [], [1], "x", 1, true, undefined]) {
      expect(isJsonObject(value)).toBe(false);
    }
  });
});

describe("AuditEventSchema", () => {
  const event = {
    version: "1",
    id: "audit-1",
    type: "tool.invoked",
    outcome: "denied",
    at: "2026-08-03T09:00:00.000Z",
    traceId: "trace-1",
    namespaceId: "world-alpha",
    actor: { kind: "agent", agentId: "agent-bob" },
    authority: { kind: "human", userId: "user-alice" },
    owner: { kind: "human", userId: "user-alice" },
    purpose: "prepare-update",
    operationId: "call-1",
    tool: "files.search",
    reason: "tool_unavailable",
    source: "kernel",
    cause: "not_registered",
  } as const;

  it("takes what the kernel states as fields and what a port supplied as metadata", () => {
    expect(AuditEventSchema.parse(event)).toEqual(event);
    expect(
      AuditEventSchema.parse({
        ...event,
        type: "authorization.checked",
        consumed: false,
        failClosed: true,
        metadata: { rule: "hr-freeze" },
      }),
    ).toMatchObject({ consumed: false, failClosed: true, metadata: { rule: "hr-freeze" } });
    expect(
      AuditEventSchema.parse({ ...event, type: "turn.ended", endedBy: "runtime" }).endedBy,
    ).toBe("runtime");
  });

  it("refuses a field it does not name, a source that is not a boundary, and an unknown type", () => {
    // Strict on purpose. The rule is that a kernel-stated fact is a field this
    // schema names (ADR 0023); an unknown key is either a fact that skipped the
    // schema or a port's key that belongs in `metadata`.
    expect(AuditEventSchema.safeParse({ ...event, recordedBy: "envelope" }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...event, source: "runtime" }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...event, type: "tool.guessed" }).success).toBe(false);
  });

  it("takes interrupted as an outcome of its own, beside failed", () => {
    // An operation whose port was entered and stopped before it answered. Not
    // `failed`, which also covers refusals where nothing ran.
    const stopped = { ...event, outcome: "interrupted", reason: "operation_aborted" };
    expect(AuditEventSchema.parse(stopped)).toEqual(stopped);
    expect(AuditEventSchema.safeParse({ ...event, outcome: "aborted" }).success).toBe(false);
  });
});
