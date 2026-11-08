import { describe, expect, it } from "vitest";

import type { ExecutionRequest, ExecutionResult, JsonObject } from "@aicoo/sharedos-contracts";
import { declareToolPolicy } from "@aicoo/sharedos-mcp";
import type { AuditEvent } from "@aicoo/sharedos-core";

import { assembleExecutionRecord } from "./assemble.js";
import { checkRecordCompleteness, checkRecordRedaction } from "./completeness.js";
import { compareReproducibility, hashExperimentInputs } from "./hashing.js";
import type { ExperimentIdentity, SystemIdentity } from "./record.js";

const NOW = "2026-08-03T09:00:00.000Z";
const LATER = "2026-08-03T09:00:02.500Z";
const ACTOR = { kind: "agent", agentId: "agent-bob" } as const;
const AGENT = { kind: "agent", agentId: "agent-alice" } as const;
const OWNER = { kind: "human", userId: "user-alice" } as const;
const AUTHORITY_HASH = "a".repeat(64);
const SECOND_AUTHORITY_HASH = "b".repeat(64);
const HASH = "c".repeat(64);

function request(): ExecutionRequest {
  return {
    version: "1",
    executionId: "execution-1",
    agent: AGENT,
    context: {
      namespaceId: "world-alpha",
      enabledToolNamespaces: ["files"],
      actor: ACTOR,
      authority: OWNER,
      owner: OWNER,
      purpose: "prepare-update",
      traceId: "trace-1",
      now: NOW,
    },
    message: {
      version: "1",
      id: "message-1",
      sender: ACTOR,
      receiver: AGENT,
      purpose: "prepare-update",
      payload: { topic: "status" },
      traceId: "trace-1",
      createdAt: NOW,
    },
    tools: [
      {
        name: "files.read",
        description: "Read one authorized file",
        namespace: "files",
        source: "sharedos",
        readWrite: "read",
        inputSchema: { type: "object" },
        requiredCapability: {
          resource: { namespace: "files", path: ["Workspace"] },
          action: "read",
        },
        annotations: { readOnly: true },
      },
    ],
  };
}

function result(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    version: "1",
    executionId: "execution-1",
    traceId: "trace-1",
    status: "succeeded",
    output: { answer: "done" },
    startedAt: NOW,
    completedAt: LATER,
    metadata: {
      runtime: { id: "sharedos.standard", version: "0.1.0-alpha.0", protocolVersion: "1" },
    },
    events: [
      {
        version: "1",
        eventId: "event-1",
        executionId: "execution-1",
        traceId: "trace-1",
        sequence: 0,
        type: "turn.started",
        data: { agent: AGENT, visibleTools: ["files.read"] },
        occurredAt: NOW,
      },
      {
        version: "1",
        eventId: "event-2",
        executionId: "execution-1",
        traceId: "trace-1",
        sequence: 1,
        type: "tool.requested",
        data: { callId: "call-1", tool: "files.read" },
        occurredAt: NOW,
      },
    ],
    ...overrides,
  } as ExecutionResult;
}

function auditEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    version: "1",
    type: "authorization.checked",
    outcome: "allowed",
    at: NOW,
    traceId: "trace-1",
    namespaceId: "world-alpha",
    actor: ACTOR,
    authority: OWNER,
    owner: OWNER,
    purpose: "prepare-update",
    ...overrides,
  } as AuditEvent;
}

function auditTrail(): AuditEvent[] {
  return [
    auditEvent({
      type: "authority.resolved",
      outcome: "succeeded",
      authorityHash: AUTHORITY_HASH,
      metadata: { grantIds: ["grant-read"], grantCount: 1 },
    }),
    auditEvent({
      type: "authorization.checked",
      outcome: "allowed",
      authorityHash: AUTHORITY_HASH,
      resource: { namespace: "files", path: ["Workspace", "notes.md"] },
      action: "read",
      grantId: "grant-read",
    }),
    auditEvent({
      type: "tool.invoked",
      outcome: "succeeded",
      operationId: "call-1",
      tool: "files.read",
      grantId: "grant-read",
    }),
  ];
}

const experiment: ExperimentIdentity = {
  experimentId: "pact-pair",
  taskId: "files-qa-017",
  runId: "run-1",
  specHash: HASH,
  worldHash: HASH,
  evaluatorHash: HASH,
};

const system: Omit<SystemIdentity, "runtime"> = {
  protocolVersion: "1",
  sharedOsVersion: "0.1.0-alpha.0",
  adapterId: "sharedos-embedded",
  policyHash: HASH,
};

describe("execution record assembly", () => {
  it("records declared tool policy from runtime metadata, including a cancelled turn", () => {
    const policies = [
      declareToolPolicy(),
      declareToolPolicy({ harnessLocal: ["shell", "apply_patch"] }),
      declareToolPolicy({ externalDirect: ["github"] }),
      declareToolPolicy({
        inventory: "complete",
        harnessLocal: [],
        externalDirect: [],
        evidence: ["fixture://complete-inventory"],
      }),
    ];
    const cancelled = { status: "cancelled", output: undefined } as const;
    for (const toolPolicy of policies) {
      const record = assembleExecutionRecord({
        request: request(),
        experiment,
        system,
        result: result({
          ...cancelled,
          metadata: { ...result().metadata, toolPolicy },
        }),
      });
      expect(record.system.toolPolicy).toEqual(toolPolicy);
    }
    expect(
      assembleExecutionRecord({ request: request(), result: result(), experiment, system }).system
        .toolPolicy?.mode,
    ).toBe("unknown");
  });

  it("rejects an invalid runtime declaration or a conflicting column claim", () => {
    const reported = declareToolPolicy({ harnessLocal: ["shell"] });
    const brokerOnly = declareToolPolicy({
      inventory: "complete",
      harnessLocal: [],
      externalDirect: [],
      evidence: ["fixture://config"],
    });
    const assemble = (toolPolicy: JsonObject, supplied = reported) =>
      assembleExecutionRecord({
        request: request(),
        result: result({ metadata: { ...result().metadata, toolPolicy } }),
        experiment,
        system: { ...system, toolPolicy: supplied },
      });
    expect(() => assemble({ mode: "strict" })).toThrow("invalid tool policy");
    expect(() => assemble(reported, brokerOnly)).toThrow("declarations disagree");
    expect(assemble(reported).system.toolPolicy).toEqual(reported);
  });

  it("carries what the runtime told the seat, and only when the runtime said so", () => {
    const hash = "ab".repeat(32);
    const assemble = (metadata: JsonObject) =>
      assembleExecutionRecord({
        request: request(),
        result: result({ metadata: { ...result().metadata, ...metadata } }),
        auditEvents: auditTrail(),
        experiment,
        system,
      });

    // Read off the turn's own result, like the catalogue: the runtime composed
    // the text, so the runtime's hash is the one that says what was sent.
    expect(assemble({ promptHash: hash }).system.promptHash).toBe(hash);
    // A runtime that told the seat nothing leaves the field absent, and one
    // that reports something other than a content hash is not believed.
    expect(assemble({}).system.promptHash).toBeUndefined();
    expect(assemble({ promptHash: "reworded" }).system.promptHash).toBeUndefined();
  });

  it("reads what the seat was told off a cancelled turn, which the envelope wrote it on", () => {
    const hash = "ab".repeat(32);
    const cancelled = { status: "cancelled", output: undefined } as const;
    const provenance = {
      runtime: { id: "sharedos.standard", version: "0.1.0-alpha.0", protocolVersion: "1" },
    };
    const assemble = (metadata: JsonObject) =>
      assembleExecutionRecord({
        request: request(),
        result: result({ ...cancelled, metadata }),
        auditEvents: auditTrail(),
        experiment,
        system,
      });

    // A cancelled turn has no outcome to carry metadata of its own; the runtime
    // stated the hash to the envelope before it launched anything, and the
    // envelope wrote it on the result. Without it the turn dropped out of its
    // column's prompt set and a stall read as a reworded prompt.
    expect(assemble({ ...provenance, promptHash: hash }).system.promptHash).toBe(hash);
    // A turn cancelled before its runtime had anything to state carries none.
    expect(assemble(provenance).system.promptHash).toBeUndefined();
  });

  it("lifts the delegate's stated ask into the record, and only a well-formed one", () => {
    const asked = { tool: "sharedos.escalate", reason: "needs a human" };
    const assemble = (metadata: JsonObject) =>
      assembleExecutionRecord({
        request: request(),
        result: result({ metadata: { ...result().metadata, ...metadata } }),
        auditEvents: auditTrail(),
        experiment,
        system,
      });

    // The grading rules read a record, and a record carries none of the
    // result's metadata, so the ask reaches them only by being lifted.
    expect(assemble({ escalationAsked: asked }).execution.escalationAsked).toEqual(asked);
    expect(assemble({}).execution.escalationAsked).toBeUndefined();
    // The delegate's own statement, so validated rather than trusted on shape.
    expect(assemble({ escalationAsked: "yes" }).execution.escalationAsked).toBeUndefined();
    expect(
      assemble({ escalationAsked: { ...asked, extra: true } }).execution.escalationAsked,
    ).toBeUndefined();
  });

  it("lifts the calls a harness made after its ask, and only a count", () => {
    const assemble = (metadata: JsonObject) =>
      assembleExecutionRecord({
        request: request(),
        result: result({ metadata: { ...result().metadata, ...metadata } }),
        auditEvents: auditTrail(),
        experiment,
        system,
      });

    // None of those calls reached the envelope, so no operation shows them.
    expect(assemble({ callsAfterEscalation: 2 }).execution.callsAfterEscalation).toBe(2);
    expect(assemble({ callsAfterEscalation: 0 }).execution.callsAfterEscalation).toBe(0);
    expect(assemble({}).execution.callsAfterEscalation).toBeUndefined();
    expect(assemble({ callsAfterEscalation: -1 }).execution.callsAfterEscalation).toBeUndefined();
    expect(assemble({ callsAfterEscalation: 1.5 }).execution.callsAfterEscalation).toBeUndefined();
    expect(assemble({ callsAfterEscalation: "2" }).execution.callsAfterEscalation).toBeUndefined();
  });

  it("binds identity, authority, execution, and cost into one comparable record", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: auditTrail(),
      experiment,
      system,
    });

    expect(record.system.runtime.id).toBe("sharedos.standard");
    expect(record.authority).toMatchObject({
      actor: ACTOR,
      namespaceId: "world-alpha",
      purpose: "prepare-update",
      stableAuthorityHash: AUTHORITY_HASH,
    });
    expect(record.authority.snapshots).toEqual([
      {
        hash: AUTHORITY_HASH,
        grantIds: ["grant-read"],
        grantCount: 1,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        observations: 1,
      },
    ]);
    expect(record.execution).toMatchObject({
      status: "succeeded",
      exposedTools: ["files.read"],
      requestedTools: ["files.read"],
    });
    expect(record.execution.decisions).toEqual([
      {
        at: NOW,
        outcome: "allowed",
        reasonCode: "allowed",
        resource: { namespace: "files", path: ["Workspace", "notes.md"] },
        action: "read",
        grantId: "grant-read",
        authorityHash: AUTHORITY_HASH,
        failClosed: false,
      },
    ]);
    expect(record.execution.operations).toEqual([
      {
        at: NOW,
        kind: "tool",
        source: "kernel",
        outcome: "succeeded",
        operationId: "call-1",
        tool: "files.read",
        grantId: "grant-read",
        failClosed: false,
      },
    ]);
    expect(record.cost).toMatchObject({
      elapsedMs: 2_500,
      toolCalls: 1,
      authorityLoads: 1,
      auditEvents: 3,
    });
  });

  it("keeps one snapshot per authority state when a turn observes more than one", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: [
        ...auditTrail(),
        auditEvent({
          type: "authority.resolved",
          outcome: "succeeded",
          at: LATER,
          authorityHash: SECOND_AUTHORITY_HASH,
          metadata: { grantIds: [], grantCount: 0 },
        }),
        auditEvent({
          type: "authorization.checked",
          outcome: "denied",
          at: LATER,
          reason: "no_matching_grant",
          authorityHash: SECOND_AUTHORITY_HASH,
          resource: { namespace: "files", path: ["Workspace", "notes.md"] },
          action: "read",
        }),
      ],
      experiment,
      system,
    });

    expect(record.authority.snapshots.map(({ hash }) => hash)).toEqual([
      AUTHORITY_HASH,
      SECOND_AUTHORITY_HASH,
    ]);
    expect(record.authority.stableAuthorityHash).toBeUndefined();
    expect(record.execution.decisions.map(({ authorityHash }) => authorityHash)).toEqual([
      AUTHORITY_HASH,
      SECOND_AUTHORITY_HASH,
    ]);
  });

  it("separates denials SharedOS caused from denials it decided", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result({ status: "denied", error: { code: "authority_unavailable", message: "x" } }),
      auditEvents: [
        auditEvent({
          type: "authority.resolved",
          outcome: "succeeded",
          authorityHash: AUTHORITY_HASH,
          metadata: { grantIds: [], grantCount: 0 },
        }),
        auditEvent({
          type: "authorization.checked",
          outcome: "denied",
          reason: "no_matching_grant",
          authorityHash: AUTHORITY_HASH,
        }),
        auditEvent({
          type: "authorization.checked",
          outcome: "denied",
          reason: "authority_unavailable",
          authorityHash: AUTHORITY_HASH,
          // Read from the event, not re-derived from the code: the kernel is
          // the one that knows whether it failed closed, and says so.
          failClosed: true,
        }),
      ],
      experiment,
      system,
    });

    expect(record.execution.decisions.map(({ failClosed }) => failClosed)).toEqual([false, true]);
    expect(record.execution.terminalReasonCode).toBe("authority_unavailable");
  });

  it("never reads an interrupted operation as a refusal a boundary made", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result({ status: "cancelled", error: { code: "turn_cancelled", message: "x" } }),
      auditEvents: [
        auditEvent({
          type: "tool.invoked",
          outcome: "interrupted",
          reason: "operation_aborted",
          operationId: "call-1",
          tool: "files.search",
          source: "kernel",
        }),
      ],
      experiment,
      system,
    });

    // Carried as itself. `denied` would credit enforcement with stopping a call
    // that may have taken effect, and `failed` would say it is known not to have.
    expect(record.execution.operations.map(({ outcome }) => outcome)).toEqual(["interrupted"]);
  });

  it("ignores audit events from another trace", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: [...auditTrail(), auditEvent({ traceId: "trace-other", tool: "files.read" })],
      experiment,
      system,
    });

    expect(record.execution.decisions).toHaveLength(1);
  });

  it("refuses to invent runtime provenance", () => {
    expect(() =>
      assembleExecutionRecord({
        request: request(),
        result: result({ metadata: {} }),
        experiment,
        system,
      }),
    ).toThrow("carries no runtime provenance");
  });

  it("takes the token cost the runtime reported, unless the caller knows better", () => {
    // A model driver sums what the provider billed onto the outcome; nothing
    // else in the record can know it. It is read like the served model is: a
    // fact the turn left behind, taken unless the caller's own `cost` says
    // otherwise.
    const reported = result({
      metadata: {
        runtime: { id: "sharedos.standard", version: "0.1.0-alpha.0", protocolVersion: "1" },
        inputTokens: 110,
        outputTokens: 17,
      },
    });

    expect(
      assembleExecutionRecord({ request: request(), result: reported, experiment, system }).cost,
    ).toMatchObject({ inputTokens: 110, outputTokens: 17 });
    expect(
      assembleExecutionRecord({
        request: request(),
        result: reported,
        experiment,
        system,
        cost: { inputTokens: 120 },
      }).cost,
    ).toMatchObject({ inputTokens: 120, outputTokens: 17 });
  });

  it("ignores a reported token count that is not a count", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result({
        metadata: {
          runtime: { id: "sharedos.standard", version: "0.1.0-alpha.0", protocolVersion: "1" },
          inputTokens: "lots",
          outputTokens: -1,
        },
      }),
      experiment,
      system,
    });

    expect(record.cost).not.toHaveProperty("inputTokens");
    expect(record.cost).not.toHaveProperty("outputTokens");
  });
});

describe("record completeness", () => {
  const complete = (): ReturnType<typeof assembleExecutionRecord> =>
    assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: auditTrail(),
      experiment,
      system,
      state: {
        before: { snapshotId: "snapshot-before", hash: HASH },
        after: { snapshotId: "snapshot-after", hash: HASH },
      },
      cost: { inputTokens: 120, outputTokens: 45, infrastructureMs: 12 },
    });

  it("accepts a record carrying every piece of expected evidence", () => {
    expect(checkRecordCompleteness(complete())).toEqual({
      complete: true,
      usable: true,
      gaps: [],
    });
  });

  it("names each missing field instead of returning one verdict", () => {
    const report = checkRecordCompleteness(
      assembleExecutionRecord({
        request: request(),
        result: result(),
        auditEvents: auditTrail(),
        experiment,
        system,
      }),
    );

    expect(report.complete).toBe(false);
    expect(report.usable).toBe(true);
    expect(report.gaps.map(({ field }) => field)).toEqual([
      "state",
      "cost.tokens",
      "cost.infrastructureMs",
    ]);
    expect(report.gaps.every(({ severity }) => severity === "expected")).toBe(true);
  });

  it("treats a decision with no authority state as unusable", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: [auditEvent({ type: "authorization.checked", outcome: "allowed" })],
      experiment,
      system,
    });
    const report = checkRecordCompleteness(record);

    expect(report.usable).toBe(false);
    expect(report.gaps.map(({ field }) => field)).toContain("authority.snapshots");
    expect(report.gaps.map(({ field }) => field)).toContain("execution.decisions.0.authorityHash");
  });

  it("does not demand an authority state from a turn that never established one", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: [
        auditEvent({
          type: "authorization.checked",
          outcome: "denied",
          reason: "authority_unavailable",
          failClosed: true,
        }),
      ],
      experiment,
      system,
    });
    const report = checkRecordCompleteness(record);

    // The turn could not reach its grant store, so there is no authority state
    // for it to name. Requiring one would report every correct fail-closed turn
    // as unusable evidence -- which is the opposite of what the row is for.
    expect(report.usable).toBe(true);
    expect(report.gaps).toContainEqual(
      expect.objectContaining({ field: "authority.snapshots", severity: "expected" }),
    );
    expect(report.gaps.map(({ field }) => field)).not.toContain(
      "execution.decisions.0.authorityHash",
    );
  });

  it("rejects a decision naming an authority state with no snapshot", () => {
    const record = assembleExecutionRecord({
      request: request(),
      result: result(),
      auditEvents: [
        auditEvent({
          type: "authority.resolved",
          outcome: "succeeded",
          authorityHash: AUTHORITY_HASH,
          metadata: { grantIds: [], grantCount: 0 },
        }),
        auditEvent({
          type: "authorization.checked",
          outcome: "allowed",
          authorityHash: SECOND_AUTHORITY_HASH,
        }),
      ],
      experiment,
      system,
    });

    expect(checkRecordCompleteness(record).usable).toBe(false);
  });

  it("keeps private call data out of the record", () => {
    const record = complete();

    expect(checkRecordRedaction(record)).toEqual({ clean: true, violations: [] });
    expect(JSON.stringify(record)).not.toContain("topic");
  });
});

describe("reproducibility hashes", () => {
  it("hashes spec, world, and evaluator independently", async () => {
    const hashes = await hashExperimentInputs({
      spec: { seed: 7, agents: 2 },
      world: { files: ["a", "b"] },
      evaluator: { version: "2.1.0" },
    });

    expect(new Set(Object.values(hashes)).size).toBe(4);
    expect(hashes.specHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order so two hosts agree on one world hash", async () => {
    const inputs = { spec: "spec", evaluator: "evaluator" };
    const one = await hashExperimentInputs({ ...inputs, world: { a: 1, b: [2, { c: 3, d: 4 }] } });
    const other = await hashExperimentInputs({
      ...inputs,
      world: { b: [2, { d: 4, c: 3 }], a: 1 },
    });

    expect(other.worldHash).toBe(one.worldHash);
  });

  it("refuses to compare runs whose worlds differ", () => {
    expect(
      compareReproducibility(
        { specHash: HASH, worldHash: HASH },
        { specHash: HASH, worldHash: AUTHORITY_HASH },
      ),
    ).toMatchObject({
      status: "world_differs",
      comparable: false,
    });
    expect(
      compareReproducibility(
        { specHash: HASH, worldHash: HASH },
        { specHash: AUTHORITY_HASH, worldHash: HASH },
      ),
    ).toMatchObject({ status: "spec_differs", comparable: false });
    expect(
      compareReproducibility(
        { specHash: HASH, worldHash: HASH },
        { specHash: HASH, worldHash: HASH },
      ),
    ).toMatchObject({ status: "identical", comparable: true });
  });
});
