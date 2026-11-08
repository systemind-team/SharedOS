import { describe, expect, it, vi } from "vitest";

import type {
  ExecutionRequest,
  ExecutionResult,
  ReachResult,
  ToolDefinition,
} from "@aicoo/sharedos-contracts";
import { agentExecutionCapability, hashJson } from "@aicoo/sharedos-core";
import {
  ESCALATION_ACTION,
  ESCALATION_RESOURCE_PATH,
  ESCALATION_TOOL_DEFINITION,
  ESCALATION_TOOL_NAMESPACE,
  SharedOSExecutor,
  createStandardRuntime,
  describeLimits,
  describeReach,
  type AgentTurnDriver,
  type RuntimeTurnRequest,
  type SharedOSExecutorOptions,
  createEscalationTool,
} from "@aicoo/sharedos-runtime";
import { createTestGrant, createTestKernel } from "@aicoo/sharedos-testkit";

import {
  StandardTurnDriver,
  ToolNameCodec,
  decodeChatCompletion,
  encodeModelMessage,
  modelToolResultMessage,
  readModelToolCall,
  type ModelClient,
  type ModelCompletionRequest,
  type StandardTurnDriverOptions,
  type ModelReply,
} from "./index.js";

const NOW = "2026-08-18T09:00:00.000Z";
const AGENT = { kind: "agent", agentId: "agent-1" } as const;
const OWNER = { kind: "human", userId: "owner-1" } as const;

const READ_TOOL: ToolDefinition = {
  name: "files.read",
  description: "Read one authorized file",
  namespace: "files",
  source: "sharedos",
  readWrite: "read",
  inputSchema: { type: "object", properties: { path: { type: "array" } } },
  requiredCapability: { resource: { namespace: "files", path: ["Workspace"] }, action: "read" },
  annotations: { readOnly: true },
};

const SNAPSHOT_TOOL: ToolDefinition = {
  ...READ_TOOL,
  name: "files.snapshot.list",
  description: "List snapshots",
};

const MANIFEST = {
  id: "sharedos.test.model",
  version: "1.0.0",
  protocolVersion: "1",
} as const;

function request(): ExecutionRequest {
  return {
    version: "1",
    executionId: "execution-1",
    agent: AGENT,
    context: {
      namespaceId: "namespace-1",
      enabledToolNamespaces: ["files", ESCALATION_TOOL_NAMESPACE],
      actor: AGENT,
      authority: OWNER,
      owner: OWNER,
      purpose: "test",
      traceId: "trace-1",
      now: NOW,
    },
    message: {
      version: "1",
      id: "message-1",
      sender: AGENT,
      receiver: AGENT,
      purpose: "test",
      payload: { text: "read the workspace" },
      traceId: "trace-1",
      createdAt: NOW,
    },
    tools: [READ_TOOL, ESCALATION_TOOL_DEFINITION],
  };
}

/** The same turn as the runtime sees it: the context sanitised, with the reach the envelope computed. */
function turnRequest(reach: ReachResult = { status: "computed", reach: [] }): RuntimeTurnRequest {
  const { context, ...rest } = request();
  return {
    ...rest,
    context: {
      actor: context.actor,
      owner: context.owner,
      namespaceId: context.namespaceId,
      purpose: context.purpose,
      traceId: context.traceId,
      now: context.now,
      reach,
    },
  };
}

/** A model that answers with a scripted sequence, recording what it was asked. */
function scriptedClient(replies: readonly ModelReply[]): ModelClient & {
  readonly seen: ModelCompletionRequest[];
} {
  const seen: ModelCompletionRequest[] = [];
  let index = 0;
  return {
    model: "test-model",
    provider: "test-provider",
    seen,
    complete: async (completion: ModelCompletionRequest): Promise<ModelReply> => {
      seen.push(structuredClone(completion) as ModelCompletionRequest);
      const reply = replies[index] ?? { text: "done", toolCalls: [] };
      index += 1;
      return reply;
    },
  };
}

/**
 * A kernel with the escalation affordance registered, and granted unless the
 * test says otherwise. The tool exists in the world either way; what an
 * ungranted turn lacks is the grant that puts it in the catalogue.
 */
function testKernel(options: { readonly escalation?: boolean } = {}) {
  const granted = options.escalation !== false;
  const { kernel, audit } = createTestKernel({
    grants: [
      createTestGrant({
        id: "grant-turn",
        capabilities: [agentExecutionCapability(AGENT, OWNER)],
        purposes: ["test"],
      }),
      ...(granted
        ? [
            createTestGrant({
              id: "grant-escalation",
              capabilities: [
                {
                  resource: {
                    namespace: ESCALATION_TOOL_NAMESPACE,
                    path: [...ESCALATION_RESOURCE_PATH],
                    owner: OWNER,
                  },
                  actions: [ESCALATION_ACTION],
                  scope: "descendants",
                },
              ],
              purposes: ["test"],
            }),
          ]
        : []),
      createTestGrant({
        id: "grant-files",
        capabilities: [
          {
            resource: { namespace: "files", path: ["Workspace"], owner: OWNER },
            actions: ["read"],
            scope: "descendants",
          },
        ],
        purposes: ["test"],
      }),
    ],
  });
  kernel.registerTool(createEscalationTool());
  kernel.registerTool({
    definition: READ_TOOL,
    parseArguments: (arguments_) => arguments_,
    invoke: async (context, call) => ({
      callId: call.id,
      tool: call.tool,
      status: "succeeded",
      output: { text: "file body" },
      completedAt: context.now,
    }),
  });
  return { kernel, audit };
}

async function runWith(
  client: ModelClient,
  options: {
    maxSteps?: number;
    maxMalformedCalls?: number;
    escalation?: boolean;
    instructions?: StandardTurnDriverOptions["instructions"];
  } = {},
) {
  const { kernel, audit } = testKernel(options);
  const runtime = createStandardRuntime({
    driver: new StandardTurnDriver({
      manifest: MANIFEST,
      client,
      ...(options.maxMalformedCalls === undefined
        ? {}
        : { maxMalformedCalls: options.maxMalformedCalls }),
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    }),
  });
  const result = await new SharedOSExecutor(kernel, runtime, { clock: () => NOW }).execute(
    // Lowered per test rather than by arming a world, so a ceiling this narrow
    // truncates exactly the turn that wants it and no other.
    options.maxSteps === undefined
      ? request()
      : { ...request(), options: { maxSteps: options.maxSteps } },
  );
  return { result, audit, calls: completedCalls(result) };
}

/** The tool messages the model was shown on its nth call, by the call they answer. */
function toolMessagesShown(
  client: { readonly seen: ModelCompletionRequest[] },
  index: number,
): { toolCallId: string; content: Record<string, unknown> }[] {
  return (client.seen[index]?.messages ?? []).flatMap((message) =>
    message.role === "tool"
      ? [
          {
            toolCallId: message.toolCallId,
            content: JSON.parse(message.content) as Record<string, unknown>,
          },
        ]
      : [],
  );
}

/** What the envelope recorded about each call, which is the stricter source. */
function completedCalls(
  result: ExecutionResult,
): { callId: string; tool: string; status: string; step?: number }[] {
  return result.events
    .filter((event) => event.type === "tool.completed")
    .map(
      (event) =>
        event.data as unknown as { callId: string; tool: string; status: string; step?: number },
    );
}

describe("the model tool-name codec", () => {
  it("round-trips a catalogued dotted name through the provider alphabet", () => {
    const codec = new ToolNameCodec([READ_TOOL, SNAPSHOT_TOOL]);
    expect(codec.toWire("files.read")).toBe("files_read");
    expect(codec.toWire("files.snapshot.list")).toBe("files_snapshot_list");
    expect(codec.fromWire("files_read")).toBe("files.read");
    expect(codec.fromWire("files_snapshot_list")).toBe("files.snapshot.list");
  });

  it("decodes a name outside the catalogue rather than dropping it", () => {
    // The uncatalogued attempt has to reach the envelope to be refused. A codec
    // that returned undefined here would erase the attempt instead.
    const codec = new ToolNameCodec([READ_TOOL]);
    expect(codec.fromWire("admin_grant_issue")).toBe("admin.grant.issue");
  });

  it("refuses a catalogue two of whose names collapse onto one wire name", () => {
    const underscored: ToolDefinition = { ...READ_TOOL, name: "files_read" };
    expect(() => new ToolNameCodec([READ_TOOL, underscored])).toThrow(/ambiguous/u);
  });
});

describe("the model driver's translation layer, read on its own", () => {
  const codec = new ToolNameCodec([READ_TOOL, ESCALATION_TOOL_DEFINITION]);
  const context = { traceId: "trace-1", now: NOW };

  it("reads a call the way the session does: name decoded, arguments parsed", () => {
    const reading = readModelToolCall(
      { id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a.txt"]}' },
      codec,
      false,
      context,
    );
    expect(reading).toEqual({
      type: "tool_call",
      call: {
        id: "call-1",
        tool: "files.read",
        arguments: { path: ["Workspace", "a.txt"] },
        traceId: "trace-1",
        requestedAt: NOW,
      },
    });
  });

  it("refuses unreadable arguments in place, and honours the affordance only when offered", () => {
    const malformed = readModelToolCall(
      { id: "call-2", name: "files_read", arguments: "not json" },
      codec,
      false,
      context,
    );
    expect(malformed.type).toBe("malformed");
    expect(malformed.type === "malformed" && malformed.refusal.status).toBe("failed");

    const ask = {
      id: "call-3",
      name: codec.toWire(ESCALATION_TOOL_DEFINITION.name),
      arguments: JSON.stringify({ reason: "a human has to decide" }),
    };
    expect(readModelToolCall(ask, codec, true, context)).toEqual({
      type: "escalate",
      reason: "a human has to decide",
    });
    expect(readModelToolCall(ask, codec, false, context).type).toBe("tool_call");
  });

  it("decodes one reply and encodes one answer in the provider's wire shape", () => {
    const reply = decodeChatCompletion({
      model: "served-model",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{ id: "call-4", function: { name: "files_read", arguments: "{}" } }],
          },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });
    expect(reply).toEqual({
      text: "",
      toolCalls: [{ id: "call-4", name: "files_read", arguments: "{}" }],
      model: "served-model",
      finishReason: "tool_calls",
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    expect(decodeChatCompletion({ choices: [] })).toBeUndefined();

    const answer = modelToolResultMessage({
      callId: "call-4",
      tool: "files.read",
      status: "denied",
      error: { code: "no_matching_grant", message: "Not granted." },
      completedAt: NOW,
    });
    expect(encodeModelMessage(answer)).toEqual({
      role: "tool",
      tool_call_id: "call-4",
      content: JSON.stringify({
        status: "denied",
        error: { code: "no_matching_grant", message: "Not granted." },
      }),
    });
  });
});

describe("a model driving a SharedOS turn", () => {
  it("offers the permission-filtered catalogue in the model's own tool shape", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    await runWith(client);

    expect(client.seen[0]?.tools).toEqual([
      {
        name: "files_read",
        description: READ_TOOL.description,
        parameters: READ_TOOL.inputSchema,
      },
      {
        name: "sharedos_escalate",
        description: ESCALATION_TOOL_DEFINITION.description,
        parameters: ESCALATION_TOOL_DEFINITION.inputSchema,
      },
    ]);
  });

  it("records the model the provider served, not the one that was asked for", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [], model: "substituted-model" }]);
    const { result } = await runWith(client);

    expect(result.metadata?.["model"]).toBe("substituted-model");
    expect(result.metadata?.["modelProvider"]).toBe("test-provider");
    expect(result.metadata?.["requestedModel"]).toBe("test-model");
  });

  it("records the settings the client sent, so one model name is not two configurations", async () => {
    const client = {
      ...scriptedClient([{ text: "done", toolCalls: [] }]),
      settings: { thinking: "disabled" },
    };
    const { result } = await runWith(client);

    expect(result.metadata?.["modelSettings"]).toEqual({ thinking: "disabled" });
  });

  it("re-authorizes each call and mediates it through the kernel", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { result, calls } = await runWith(client);

    expect(result.status).toBe("succeeded");
    expect(calls).toEqual([{ callId: "call-1", tool: "files.read", status: "succeeded", step: 0 }]);
  });

  it("declares the step each call was made at, because it owns the loop", async () => {
    // The property that separates this column from one where a vendor CLI owns
    // the loop: SharedOS can still bound the turn by steps it declared itself.
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      {
        text: "",
        toolCalls: [{ id: "call-2", name: "files_read", arguments: '{"path":["Workspace","b"]}' }],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { calls } = await runWith(client);

    expect(calls.map(({ step }) => step)).toEqual([0, 1]);
  });

  it("releases several calls from one reply one at a time, then speaks again", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          { id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' },
          { id: "call-2", name: "files_read", arguments: '{"path":["Workspace","b"]}' },
        ],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { calls } = await runWith(client);

    expect(calls).toHaveLength(2);
    // Two calls, two results, and only then a second model call: the wire format
    // requires every call in an assistant message to be answered first.
    expect(client.seen).toHaveLength(2);
    expect(client.seen[1]?.messages.filter(({ role }) => role === "tool")).toHaveLength(2);
  });

  it("passes an uncatalogued name through so the envelope can refuse it", async () => {
    const client = scriptedClient([
      { text: "", toolCalls: [{ id: "call-1", name: "admin_grant_issue", arguments: "{}" }] },
      { text: "done", toolCalls: [] },
    ]);
    const { calls } = await runWith(client);

    const [call] = calls;
    expect(call?.tool).toBe("admin.grant.issue");
    expect(call?.status).not.toBe("succeeded");
  });

  it("refuses a call whose arguments did not parse, and tells the model so", async () => {
    const client = scriptedClient([
      { text: "", toolCalls: [{ id: "call-1", name: "files_read", arguments: "not json" }] },
      {
        text: "",
        toolCalls: [{ id: "call-2", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { result, calls } = await runWith(client);

    // Never sent as `{}`: an empty object is a call the model did not make, and
    // a tool with every parameter optional would have run it. The refusal goes
    // straight back to the model, under the kernel's code for the same defect,
    // and the corrected retry is the only call the envelope ever sees.
    expect(result.status).toBe("succeeded");
    expect(calls).toEqual([{ callId: "call-2", tool: "files.read", status: "succeeded", step: 0 }]);
    expect(toolMessagesShown(client, 1)).toEqual([
      {
        toolCallId: "call-1",
        content: {
          status: "failed",
          error: { code: "invalid_tool_arguments", message: expect.stringContaining("not made") },
        },
      },
    ]);
    expect(result.metadata?.["malformedToolCalls"]).toBe(1);
  });

  it("charges no step for a call it refused", async () => {
    // Two steps in the budget -- one for a call, one for the completion -- and
    // the model fumbles before using either. Sent as `{}`, the fumble would
    // have spent the first step and the turn would have ended at the ceiling;
    // refused outside the loop, the corrected call and the completion both fit.
    const client = scriptedClient([
      { text: "", toolCalls: [{ id: "call-1", name: "files_read", arguments: "[1, 2]" }] },
      {
        text: "",
        toolCalls: [{ id: "call-2", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { result, calls } = await runWith(client, { maxSteps: 2 });

    expect(result.status).toBe("succeeded");
    expect(calls).toEqual([{ callId: "call-2", tool: "files.read", status: "succeeded", step: 0 }]);
  });

  it("answers every call in a reply before speaking again, refusals included", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          { id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' },
          { id: "call-2", name: "files_read", arguments: "not json" },
          { id: "call-3", name: "files_read", arguments: '{"path":["Workspace","b"]}' },
        ],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { calls } = await runWith(client);

    // Two calls reached the envelope; the fumble between them was answered in
    // its place, so the model saw one answer per call it made, in order.
    expect(calls.map(({ callId }) => callId)).toEqual(["call-1", "call-3"]);
    expect(toolMessagesShown(client, 1).map(({ toolCallId }) => toolCallId)).toEqual([
      "call-1",
      "call-2",
      "call-3",
    ]);
    expect(client.seen).toHaveLength(2);
  });

  it("fails the turn when the model never forms a readable call", async () => {
    const fumble = (id: string) => ({
      text: "",
      toolCalls: [{ id, name: "files_read", arguments: "still not json" }],
    });
    const client = scriptedClient([fumble("c1"), fumble("c2"), fumble("c3"), fumble("c4")]);
    const { result, calls } = await runWith(client, { maxMalformedCalls: 3 });

    // Refusing costs the turn no step, so this is bounded on its own: three
    // fumbles are answered, the fourth ends the turn under a code that says
    // what happened, rather than the model being asked until the turn times out.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "model_malformed_call_limit_exceeded",
    );
    expect(result.metadata?.["malformedToolCalls"]).toBe(4);
    expect(calls).toEqual([]);
    expect(client.seen).toHaveLength(4);
  });

  it("counts zero refused calls on a turn that made none", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const { result } = await runWith(client);

    expect(result.metadata?.["malformedToolCalls"]).toBe(0);
  });

  it("refuses to be built with a guard that is not a positive integer", () => {
    const client = scriptedClient([]);
    expect(
      () => new StandardTurnDriver({ manifest: MANIFEST, client, maxMalformedCalls: 0 }),
    ).toThrow(/positive integer/u);
  });

  it("ends the turn when the model chooses the escalate affordance", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          {
            id: "call-1",
            name: "sharedos_escalate",
            arguments: '{"reason":"this needs authority I do not hold"}',
          },
        ],
      },
    ]);
    const { result, calls } = await runWith(client);

    expect(result.status).toBe("escalated");
    expect(result.status === "escalated" ? result.escalation.reason : undefined).toBe(
      "this needs authority I do not hold",
    );
    // Intercepted before it became a ToolCall: the kernel is never asked, and
    // the registered handler -- which fails on purpose -- is never reached.
    expect(calls).toEqual([]);
  });

  it("offers the escalate affordance as a tool rather than inferring it from prose", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    await runWith(client);

    // Escalation is something the model picks off the catalogue. Reading intent
    // out of an assistant message would make the row measure a phrase.
    expect(client.seen[0]?.tools.map(({ name }) => name)).toContain("sharedos_escalate");
  });

  it("drops calls queued behind an escalation instead of running them after it", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          { id: "call-1", name: "sharedos_escalate", arguments: '{"reason":"ask a human"}' },
          { id: "call-2", name: "files_read", arguments: '{"path":["Workspace","a"]}' },
        ],
      },
    ]);
    const { result, calls } = await runWith(client);

    // The turn ends at the escalation. Running what followed would do work on
    // the far side of a decision nobody has made yet.
    expect(result.status).toBe("escalated");
    expect(calls).toEqual([]);
  });

  it("records a long reason whole, not cut or replaced by one of its own", async () => {
    const given = "this needs an owner because " + "detail ".repeat(120);
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          { id: "call-1", name: "sharedos_escalate", arguments: JSON.stringify({ reason: given }) },
        ],
      },
    ]);
    const { result } = await runWith(client);

    expect(given.length).toBeGreaterThan(512);
    expect(result.status).toBe("escalated");
    expect(result.status === "escalated" ? result.escalation.reason : undefined).toBe(given.trim());
  });

  it("does not honour the affordance for a turn that was never granted it", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [
          { id: "call-1", name: "sharedos_escalate", arguments: '{"reason":"let me out"}' },
        ],
      },
      { text: "done", toolCalls: [] },
    ]);
    const { result, calls, audit } = await runWith(client, { escalation: false });

    // The name alone is not the affordance. Ending the turn here would skip the
    // envelope's catalogue check, so the driver reads the catalogue first and
    // passes an unoffered name through to be refused like any other invented
    // one -- and the turn carries on, ending the way the model ended it.
    expect(client.seen[0]?.tools.map(({ name }) => name)).not.toContain("sharedos_escalate");
    expect(result.status).toBe("succeeded");
    expect(calls).toEqual([
      {
        callId: "call-1",
        tool: "sharedos.escalate",
        status: "denied",
        code: "tool_unavailable",
        step: 0,
      },
    ]);
    expect(audit.events.some(({ type }) => type === "escalation.requested")).toBe(false);
  });

  it("escalates on a malformed reason rather than forwarding the call to the kernel", async () => {
    const client = scriptedClient([
      { text: "", toolCalls: [{ id: "call-1", name: "sharedos_escalate", arguments: "not json" }] },
    ]);
    const { result, calls } = await runWith(client);

    // Forwarding it would turn "the driver asked for a human" into "the agent
    // made a malformed call", which is the wrong record of what happened.
    expect(result.status).toBe("escalated");
    expect(calls).toEqual([]);
  });

  it("reaches a handler that fails when a driver forwards the affordance as a call", async () => {
    // Not this driver: a driver that does not recognise the name. The
    // registered handler is what stands between that driver and a record
    // showing an escalation tool that ran inside a turn that then completed.
    const forwarding: AgentTurnDriver = {
      open: async (turn) => {
        let asked = false;
        return {
          next: async () => {
            if (asked) {
              return { type: "complete", output: { text: "done" } };
            }
            asked = true;
            return {
              type: "tool_call",
              call: {
                id: "call-1",
                tool: ESCALATION_TOOL_DEFINITION.name,
                arguments: { reason: "forwarded rather than terminated on" },
                traceId: turn.context.traceId,
                requestedAt: turn.context.now,
              },
            };
          },
        };
      },
    };
    const { kernel, audit } = testKernel();
    const result = await new SharedOSExecutor(
      kernel,
      createStandardRuntime({ driver: forwarding }),
      {
        clock: () => NOW,
      },
    ).execute(request());

    expect(result.status).toBe("succeeded");
    expect(completedCalls(result)).toEqual([
      {
        callId: "call-1",
        tool: "sharedos.escalate",
        status: "failed",
        code: "escalation_not_terminated",
        step: 0,
      },
    ]);
    expect(audit.events.some(({ reason }) => reason === "escalation_not_terminated")).toBe(true);
    expect(audit.events.some(({ type }) => type === "escalation.requested")).toBe(false);
  });

  it("survives a turn truncated at the step ceiling, with no close handler to run", async () => {
    // The abrupt-termination path: the loop exhausts its steps and returns
    // through the `finally` that closes the session. `ModelSession` has no
    // `close` -- there is no socket to release -- and `closeSession` guards
    // `session?.close === undefined`, so this asserts the guard rather than
    // assuming it.
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      {
        text: "",
        toolCalls: [{ id: "call-2", name: "files_read", arguments: '{"path":["Workspace","b"]}' }],
      },
    ]);
    const session = await new StandardTurnDriver({ manifest: MANIFEST, client }).open(
      turnRequest(),
      new AbortController().signal,
    );
    expect(session.close).toBeUndefined();

    const { result, calls } = await runWith(client, { maxSteps: 1 });

    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("step_limit_exceeded");
    // The work done before the ceiling is still recorded. A truncated turn that
    // lost its operations would be indistinguishable from one that made none.
    expect(calls).toEqual([{ callId: "call-1", tool: "files.read", status: "succeeded", step: 0 }]);
  });

  it("is refused by the envelope when it declares a step past the ceiling", async () => {
    // The loop's own index stops at the ceiling, so this is the only way a
    // driver inside it can reach the envelope's step bound. Declaring a step is
    // a claim, not a permission: the envelope still decides.
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      { text: "done", toolCalls: [] },
    ]);
    const runtime = createStandardRuntime({
      driver: new StandardTurnDriver({ manifest: MANIFEST, client, declareStep: () => 4 }),
    });
    const { kernel } = testKernel();
    const result = await new SharedOSExecutor(kernel, runtime, { clock: () => NOW }).execute({
      ...request(),
      options: { maxSteps: 2 },
    });

    expect(completedCalls(result)).toEqual([
      {
        callId: "call-1",
        tool: "files.read",
        status: "denied",
        code: "step_limit_exceeded",
        step: 4,
      },
    ]);
  });

  it("fails the turn when the provider cannot be reached", async () => {
    const client: ModelClient = {
      model: "test-model",
      provider: "test-provider",
      complete: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    };
    const { result } = await runWith(client);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("model_call_failed");
  });

  it("fails the turn when the provider cut the reply off, rather than grading the cut", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspa' }],
        finishReason: "length",
      },
      { text: "done", toolCalls: [] },
    ]);
    const { result, calls } = await runWith(client);

    // The provider ended the reply, not the model. Its half-written call is
    // not released -- issuing it would grade the cut as the model's doing --
    // and the turn does not complete as if the model had chosen to stop.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "model_output_truncated",
    );
    expect(result.metadata?.["finishReason"]).toBe("length");
    expect(calls).toEqual([]);
    expect(client.seen).toHaveLength(1);
  });

  it("records why the model stopped and what the provider billed for the turn", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
        finishReason: "tool_calls",
        usage: { inputTokens: 40, outputTokens: 12 },
      },
      {
        text: "done",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 70, outputTokens: 5 },
      },
    ]);
    const { result } = await runWith(client);

    expect(result.status).toBe("succeeded");
    // Summed over both model calls: the cost on the record is the turn's, not
    // the last reply's. The finish reason is the last reply's, because that is
    // the one that ended the turn.
    expect(result.metadata).toMatchObject({
      finishReason: "stop",
      inputTokens: 110,
      outputTokens: 17,
    });
  });

  it("leaves token cost absent when the provider reported none", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const { result } = await runWith(client);

    // Absent rather than zero. A zero is a claim about what was billed; an
    // absence is the truth about what was reported, and the record's
    // completeness check names it as a gap instead of reading it as free.
    expect(result.metadata).not.toHaveProperty("inputTokens");
    expect(result.metadata).not.toHaveProperty("outputTokens");
    expect(result.metadata).not.toHaveProperty("finishReason");
  });

  it("keeps what the turn cost on a turn that failed", async () => {
    let index = 0;
    const client: ModelClient = {
      model: "test-model",
      provider: "test-provider",
      complete: async () => {
        index += 1;
        if (index === 1) {
          return {
            text: "",
            toolCalls: [
              { id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' },
            ],
            usage: { inputTokens: 40, outputTokens: 12 },
          };
        }
        throw new Error("connection reset");
      },
    };
    const { result } = await runWith(client);

    // The second model call failed; the first still happened and was billed.
    // A record that dropped the spend on failure would know least about the
    // turns that most need explaining.
    expect(result.status).toBe("failed");
    expect(result.metadata).toMatchObject({
      model: "test-model",
      inputTokens: 40,
      outputTokens: 12,
    });
  });
});

/**
 * What the model is told about its budget.
 *
 * The limits the host set reach the driver on the request, the executor's
 * defaults included, and go into the system message after the reach, so the
 * model knows its budget before it spends it. A call past the budget is
 * answered in words that say no later call will run either. The turn still
 * ends when the model says so, or at `maxSteps` or the deadline.
 */
describe("what the model is told about its limits", () => {
  async function systemMessage(limits: SharedOSExecutorOptions): Promise<string | undefined> {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const { kernel } = testKernel();
    await new SharedOSExecutor(
      kernel,
      createStandardRuntime({ driver: new StandardTurnDriver({ manifest: MANIFEST, client }) }),
      { clock: () => NOW, ...limits },
    ).execute(request());
    const [system] = client.seen[0]?.messages ?? [];
    return system?.role === "system" ? system.content : undefined;
  }

  it("is told the limits the host set as executor defaults, after its reach", async () => {
    const plain = await systemMessage({});
    const limited = await systemMessage({
      defaultMaxSteps: 6,
      defaultMaxToolCalls: 4,
      defaultTimeoutMs: 120_000,
    });

    expect(plain).not.toContain("Limits the host set");
    // The turn offers the escalate affordance, so the call budget names it as
    // the one call that still works once the budget is spent.
    expect(limited).toBe(
      `${String(plain)}\n\n${String(
        describeLimits({ maxSteps: 6, maxToolCalls: 4, timeoutMs: 120_000 }, { escalation: true }),
      )}`,
    );
    expect(limited).toContain("except asking for a human with sharedos.escalate");
  });

  it("is told its reach and nothing more when the host set no limit", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const turn = turnRequest();
    const signal = new AbortController().signal;

    const session = await new StandardTurnDriver({ manifest: MANIFEST, client }).open(turn, signal);
    await session.next({ type: "start" }, signal);

    expect(client.seen[0]?.messages[0]).toEqual({
      role: "system",
      content: describeReach(turn.context.reach),
    });
  });

  it("hears a spent call budget in the envelope's words, and decides itself when to end", async () => {
    const client = scriptedClient([
      {
        text: "",
        toolCalls: [{ id: "call-1", name: "files_read", arguments: '{"path":["Workspace","a"]}' }],
      },
      {
        text: "",
        toolCalls: [{ id: "call-2", name: "files_read", arguments: '{"path":["Workspace","b"]}' }],
      },
      { text: "done with what I have", toolCalls: [] },
    ]);
    const { kernel } = testKernel();
    const result = await new SharedOSExecutor(
      kernel,
      createStandardRuntime({ driver: new StandardTurnDriver({ manifest: MANIFEST, client }) }),
      { clock: () => NOW, defaultMaxToolCalls: 1 },
    ).execute(request());

    expect(toolMessagesShown(client, 2).at(-1)).toEqual({
      toolCallId: "call-2",
      content: {
        status: "denied",
        error: {
          code: "tool_call_limit_exceeded",
          message:
            "This turn's budget of 1 tool call is used up. No further tool call will run this turn, except asking for a human with sharedos.escalate; finish with what you have.",
        },
      },
    });
    // Told, and asked again: the refusal does not end the turn, the model does.
    expect(client.seen).toHaveLength(3);
    expect(result).toMatchObject({
      status: "succeeded",
      output: { text: "done with what I have" },
    });
  });
});

/**
 * What the model is told before its prompt.
 *
 * The executor hands the runtime where the turn may operate; the driver is
 * where that reaches a model. It goes in as a system message ahead of the
 * task, rendered by `describeReach`, so the model can point at a granted path
 * rather than search from the root and collect denials. Nothing here is a
 * permission -- every call the model then makes is decided by the kernel --
 * which the text itself says.
 */
describe("what the model is told about where it may operate", () => {
  it("is shown its reach as a system message, ahead of the prompt", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);

    await runWith(client);

    const [system, user] = client.seen[0]?.messages ?? [];
    expect(system?.role).toBe("system");
    // The one path the test grant covers, in the shape a `path` argument takes,
    // and the caveat that makes it safe to say at all.
    expect(system?.content).toContain('- files ["Workspace"] and everything beneath it: read');
    expect(system?.content).toContain("every call is still decided on its own");
    expect(user).toEqual({ role: "user", content: "read the workspace" });
  });

  it("is told the reach could not be established rather than shown an empty list", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const turn = turnRequest({ status: "unavailable", reasonCode: "usage_store_unavailable" });
    const signal = new AbortController().signal;

    const session = await new StandardTurnDriver({ manifest: MANIFEST, client }).open(turn, signal);
    await session.next({ type: "start" }, signal);

    const system = client.seen[0]?.messages[0];
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("usage_store_unavailable");
    expect(system?.content).toContain("This is not an empty list");
    expect(system?.content).not.toContain("nowhere");
  });

  it("sends no system message when the host's instructions say so", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);

    await runWith(client, { instructions: () => undefined });

    expect(client.seen[0]?.messages).toEqual([{ role: "user", content: "read the workspace" }]);
  });

  it("lets the host say what the model is told, from the request it is given", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const instructions = vi.fn(
      (turn: RuntimeTurnRequest) => `reach status: ${turn.context.reach.status}`,
    );

    await runWith(client, { instructions });

    expect(instructions).toHaveBeenCalledTimes(1);
    expect(client.seen[0]?.messages[0]).toEqual({
      role: "system",
      content: "reach status: computed",
    });
  });

  it("records what it was told, so a reworded prompt is not read as a changed mind", async () => {
    const client = scriptedClient([{ text: "done", toolCalls: [] }]);
    const { result } = await runWith(client);

    // Over the two texts the first request was built from, in the one shape
    // the MCP harness runtime hashes too, so a model turn and an MCP turn told
    // the same thing carry the same identity on their records.
    const [system, user] = client.seen[0]?.messages ?? [];
    expect(result.metadata?.["promptHash"]).toBe(
      await hashJson({ instructions: system?.content, prompt: user?.content }),
    );

    const silent = await runWith(scriptedClient([{ text: "done", toolCalls: [] }]), {
      instructions: () => undefined,
    });
    expect(silent.result.metadata?.["promptHash"]).toBe(
      await hashJson({ instructions: null, prompt: "read the workspace" }),
    );
    expect(silent.result.metadata?.["promptHash"]).not.toBe(result.metadata?.["promptHash"]);
  });

  it("states it before the first request, so a turn cancelled mid-call still records it", async () => {
    // A model call that never returns: the turn is cancelled from outside the
    // moment the request is on the wire, which is where a live stall lands.
    const cancel = new AbortController();
    const seen: ModelCompletionRequest[] = [];
    const hanging: ModelClient = {
      model: "test-model",
      provider: "test-provider",
      complete: (completion, signal) => {
        seen.push(structuredClone(completion) as ModelCompletionRequest);
        cancel.abort(new Error("deadline"));
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const { kernel } = testKernel();
    const result = await new SharedOSExecutor(
      kernel,
      createStandardRuntime({
        driver: new StandardTurnDriver({ manifest: MANIFEST, client: hanging }),
      }),
      { clock: () => NOW },
    ).execute(request(), { signal: cancel.signal });

    expect(result.status).toBe("cancelled");
    // No outcome came back, so none of the driver's own metadata did.
    expect(result.metadata?.["model"]).toBeUndefined();
    const [system, user] = seen[0]?.messages ?? [];
    expect(result.metadata?.["promptHash"]).toBe(
      await hashJson({ instructions: system?.content, prompt: user?.content }),
    );
  });
});
