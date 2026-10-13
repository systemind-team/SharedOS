import { ReplayProtection } from "@aicoo/sharedos-core";
import { describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  ExecutionRequest,
  RuntimeManifest,
  ToolDefinition,
  ToolResult,
} from "@aicoo/sharedos-contracts";

import {
  ESCALATION_TOOL_DEFINITION,
  ESCALATION_TOOL_NAMESPACE,
  RuntimeNotFoundError,
  RuntimeRegistry,
  SharedOSExecutor,
  type RuntimeHost,
  type RuntimePlugin,
  type RuntimeTurnRequest,
  type TurnErrorContext,
  type TurnKernel,
} from "./index.js";

const now = "2026-08-14T00:00:00.000Z";
const sender = { kind: "agent", agentId: "agent-bob" } as const;
const receiver = { kind: "agent", agentId: "agent-alice" } as const;
const owner = { kind: "human", userId: "user-alice" } as const;

const tool: ToolDefinition = {
  name: "files.search",
  description: "Search authorized files",
  namespace: "files",
  source: "sharedos",
  readWrite: "read",
  inputSchema: { type: "object" },
  requiredCapability: {
    resource: { namespace: "files", path: [] },
    action: "search",
  },
};

const context: AccessContext = {
  actor: receiver,
  authority: owner,
  owner,
  namespaceId: "namespace-1",
  enabledToolNamespaces: ["files"],
  purpose: "prepare-report",
  traceId: "trace-1",
  now,
};

const manifest: RuntimeManifest = {
  id: "test.custom-runtime",
  version: "1.2.3",
  protocolVersion: "1",
  metadata: { harness: "test" },
};

/** The turn's request; with `escalation`, the affordance is among the tools it asks for. */
function request(options: { readonly escalation?: boolean } = {}): ExecutionRequest {
  const escalation = options.escalation === true;
  return {
    version: "1",
    executionId: "execution-1",
    agent: receiver,
    context: escalation
      ? { ...context, enabledToolNamespaces: ["files", ESCALATION_TOOL_NAMESPACE] }
      : context,
    message: {
      version: "1",
      id: "message-1",
      sender,
      receiver,
      purpose: context.purpose,
      payload: { topic: "status" },
      traceId: context.traceId,
      createdAt: now,
    },
    tools: escalation ? [tool, ESCALATION_TOOL_DEFINITION] : [tool],
  };
}

/**
 * A kernel that lists what the turn may see; with `escalation`, the
 * permission-filtered catalogue holds the affordance, which is what a turn
 * granted it looks like from the envelope.
 */
function kernel(result?: ToolResult, options: { readonly escalation?: boolean } = {}): TurnKernel {
  const catalogue = options.escalation === true ? [tool, ESCALATION_TOOL_DEFINITION] : [tool];
  return {
    replayProtection: new ReplayProtection(),
    admitTurn: vi.fn(async () => ({
      allowed: true as const,
      reasonCode: "allowed" as const,
      matchedGrantId: "grant-turn",
    })),
    listTools: vi.fn(async () => catalogue),
    reach: vi.fn(async () => ({ status: "computed" as const, reach: [] })),
    invokeTool: vi.fn(async (_context, call): Promise<ToolResult> => {
      return (
        result ?? {
          callId: call.id,
          tool: call.tool,
          status: "succeeded" as const,
          output: { hits: [] },
          completedAt: now,
        }
      );
    }),
    // What makes it a turn: the lease, and the three recorders. Inert here, so
    // a test that cares about one replaces it.
    openTurnAuthority: vi.fn(async () => ({ status: "resolved" as const, close: () => undefined })),
    recordEscalation: vi.fn(async (access: AccessContext, reason: string) => ({
      reason,
      reviewer: access.owner,
      requestedAt: access.now,
      status: "pending" as const,
    })),
    recordTurnEnd: vi.fn(async () => undefined),
    recordRefusedCall: vi.fn(async () => undefined),
  };
}

function runtime(
  run: RuntimePlugin["run"] = async () => ({ type: "complete", output: { ok: true } }),
): RuntimePlugin {
  return { manifest, run };
}

describe("RuntimePlugin security envelope", () => {
  it("runs a custom harness with sanitized input and authoritative provenance", async () => {
    let visibleRequest: RuntimeTurnRequest | undefined;
    const observedEvents: string[] = [];
    const plugin = runtime(async (input, host) => {
      visibleRequest = input;
      host.emit({ type: "turn.completed", data: { providerEvent: true } });
      return {
        type: "complete",
        output: { ok: true },
        metadata: { model: "test-model", runtime: "forged" },
      };
    });

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request(), {
      onEvent: (event) => {
        observedEvents.push(event.type);
        expect(Object.isFrozen(event)).toBe(true);
      },
    });

    expect(result.status).toBe("succeeded");
    expect(visibleRequest?.tools).toEqual([tool]);
    expect(visibleRequest?.context).not.toHaveProperty("grants");
    expect(visibleRequest?.context).not.toHaveProperty("authority");
    expect(visibleRequest?.context).not.toHaveProperty("enabledToolNamespaces");
    expect(Object.isFrozen(visibleRequest)).toBe(true);
    expect(Object.isFrozen(visibleRequest?.context)).toBe(true);
    expect(result.metadata).toMatchObject({
      model: "test-model",
      runtime: {
        id: manifest.id,
        version: manifest.version,
        protocolVersion: "1",
        metadata: manifest.metadata,
      },
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "runtime.event",
        data: expect.objectContaining({ type: "turn.completed" }),
      }),
    );
    expect(result.events.filter(({ type }) => type === "turn.completed")).toHaveLength(1);
    expect(observedEvents).toEqual(result.events.map(({ type }) => type));
  });

  it("denies a plugin call outside the effective catalog without touching the kernel", async () => {
    const runtimeKernel = kernel();
    const plugin = runtime(async (_input, host) => {
      const result = await host.invokeTool({
        id: "call-hidden",
        tool: "files.delete",
        arguments: { path: ["secret"] },
        traceId: context.traceId,
        requestedAt: now,
      });
      return {
        type: "complete",
        output:
          result.status === "succeeded"
            ? { tool: result.tool, status: result.status, output: result.output }
            : {
                tool: result.tool,
                status: result.status,
                error: { code: result.error.code, message: result.error.message },
              },
      };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.output).toMatchObject({
        tool: "files.delete",
        status: "denied",
        error: { code: "tool_unavailable" },
      });
    }
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("re-authorizes an allowed custom-runtime call with the trusted context", async () => {
    const denied: ToolResult = {
      callId: "call-allowed",
      tool: tool.name,
      status: "denied",
      completedAt: now,
      error: { code: "no_matching_grant", message: "Denied at point of use" },
    };
    const runtimeKernel = kernel(denied);
    const plugin = runtime(async (_input, host) => {
      const result = await host.invokeTool({
        id: "call-allowed",
        tool: tool.name,
        arguments: { query: "status" },
        traceId: context.traceId,
        requestedAt: now,
      });
      return {
        type: "complete",
        output: {
          status: result.status,
          code: result.status === "succeeded" ? null : result.error.code,
        },
      };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("succeeded");
    expect(runtimeKernel.invokeTool).toHaveBeenCalledOnce();
    expect(runtimeKernel.invokeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: receiver,
        authority: owner,
        namespaceId: context.namespaceId,
      }),
      expect.objectContaining({ id: "call-allowed", tool: tool.name }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(vi.mocked(runtimeKernel.invokeTool).mock.calls[0]?.[0]).not.toHaveProperty("grants");
    if (result.status === "succeeded") {
      expect(result.output).toEqual({ status: "denied", code: "no_matching_grant" });
    }
  });

  it("does not open a custom runtime before target-agent admission", async () => {
    const runtimeKernel = kernel();
    runtimeKernel.admitTurn = vi.fn(async () => ({
      allowed: false,
      reasonCode: "no_matching_grant",
    }));
    const run = vi.fn<RuntimePlugin["run"]>();

    const result = await new SharedOSExecutor(runtimeKernel, runtime(run), {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("denied");
    expect(run).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
  });

  it("fails closed when a custom runtime returns a malformed outcome", async () => {
    const plugin = runtime(async () => ({ type: "complete", output: undefined }) as never);

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("invalid_runtime_outcome");
    }
  });

  it("cancels a custom runtime at the SharedOS deadline", async () => {
    let runtimeSignal: AbortSignal | undefined;
    const plugin = runtime(async (_input, _host, signal) => {
      runtimeSignal = signal;
      return new Promise(() => undefined);
    });
    const input = request();
    input.options = { timeoutMs: 5 };

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("cancelled");
    expect(runtimeSignal?.aborted).toBe(true);
  });

  it("closes the capability broker when a runtime returns", async () => {
    let capturedHost: RuntimeHost | undefined;
    const runtimeKernel = kernel();
    const plugin = runtime(async (_input, host) => {
      capturedHost = host;
      return { type: "complete", output: null };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());
    expect(result.status).toBe("succeeded");

    await expect(
      capturedHost?.invokeTool({
        id: "call-late",
        tool: tool.name,
        arguments: { query: "late" },
        traceId: context.traceId,
        requestedAt: now,
      }),
    ).rejects.toThrow("Runtime host is closed");
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("enforces a tool-call ceiling independently of a custom harness loop", async () => {
    const runtimeKernel = kernel();
    const plugin = runtime(async (_input, host) => {
      const call = (id: string) =>
        host.invokeTool({
          id,
          tool: tool.name,
          arguments: { query: id },
          traceId: context.traceId,
          requestedAt: now,
        });
      const first = await call("call-1");
      const second = await call("call-2");
      return {
        type: "complete",
        output: {
          first: first.status,
          second: second.status,
          secondCode: second.status === "succeeded" ? null : second.error.code,
        },
      };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
      defaultMaxToolCalls: 1,
    }).execute(request());

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.output).toEqual({
        first: "succeeded",
        second: "denied",
        secondCode: "tool_call_limit_exceeded",
      });
    }
    expect(runtimeKernel.invokeTool).toHaveBeenCalledOnce();
  });

  it("enforces a step ceiling on a plugin that declares its own steps", async () => {
    const runtimeKernel = kernel();
    const call = (host: RuntimeHost, id: string, step: number) =>
      host.invokeTool(
        { id, tool: tool.name, arguments: {}, traceId: context.traceId, requestedAt: now },
        { step },
      );
    const plugin = runtime(async (_input, host) => {
      const first = await call(host, "call-1", 0);
      // Past the ceiling, honestly labelled.
      const second = await call(host, "call-2", 1);
      // Under the ceiling by relabelling: a third distinct step where two were
      // allowed. Refusing only the first form would leave the ceiling to the
      // plugin's own bookkeeping, which is exactly what a replacement plugin
      // replaces.
      const third = await call(host, "call-3", 0);
      return {
        type: "complete",
        output: {
          first: first.status,
          second: second.status === "succeeded" ? null : second.error.code,
          third: third.status,
        },
      };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
      defaultMaxSteps: 1,
      defaultMaxToolCalls: 8,
    }).execute(request());

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.output).toEqual({
        first: "succeeded",
        second: "step_limit_exceeded",
        third: "succeeded",
      });
    }
    expect(runtimeKernel.invokeTool).toHaveBeenCalledTimes(2);
  });

  it("leaves a plugin that declares no step bounded by its call ceiling alone", async () => {
    const runtimeKernel = kernel();
    const plugin = runtime(async (_input, host) => {
      // No step is declared, so the envelope cannot infer model turns from tool
      // calls and does not pretend to. The call ceiling still applies.
      const results = [];
      for (const id of ["call-1", "call-2", "call-3"]) {
        const result = await host.invokeTool({
          id,
          tool: tool.name,
          arguments: {},
          traceId: context.traceId,
          requestedAt: now,
        });
        results.push(result.status === "succeeded" ? "succeeded" : result.error.code);
      }
      return { type: "complete", output: { results } };
    });

    const result = await new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
      defaultMaxSteps: 1,
      defaultMaxToolCalls: 2,
    }).execute(request());

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.output).toEqual({
        results: ["succeeded", "succeeded", "tool_call_limit_exceeded"],
      });
    }
  });

  it("records an envelope refusal code on the event that carries it", async () => {
    const plugin = runtime(async (_input, host) => {
      const result = await host.invokeTool({
        id: "call-hidden",
        tool: "files.delete",
        arguments: {},
        traceId: context.traceId,
        requestedAt: now,
      });
      return { type: "complete", output: { status: result.status } };
    });

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    // A call the envelope terminated never reaches the kernel and so never
    // reaches audit. The event stream is the only record of it, and without the
    // code an execution record could say a refusal happened but not which one.
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.completed",
          data: expect.objectContaining({
            callId: "call-hidden",
            status: "denied",
            code: "tool_unavailable",
          }),
        }),
      ]),
    );
  });

  it("ends a turn that asked a human to decide as escalated, and records it", async () => {
    const recordEscalation = vi.fn(
      async (access: AccessContext, reason: string, _options?: { executionId?: string }) => ({
        reason,
        reviewer: access.owner,
        requestedAt: access.now,
        status: "pending" as const,
      }),
    );
    const plugin = runtime(async () => ({
      type: "escalate",
      reason: "issuing a grant is outside this agent's authority",
    }));

    const result = await new SharedOSExecutor(
      { ...kernel(undefined, { escalation: true }), recordEscalation },
      plugin,
      { clock: () => now, createId: () => "event-1" },
    ).execute(request({ escalation: true }));

    // Not a failure and not a denial: a third terminal state, so "the agent
    // asked for help" stays recoverable from the result.
    expect(result.status).toBe("escalated");
    if (result.status === "escalated") {
      expect(result.escalation).toEqual({
        reason: "issuing a grant is outside this agent's authority",
        reviewer: owner,
        requestedAt: now,
        status: "pending",
      });
    }
    expect(recordEscalation).toHaveBeenCalledOnce();
    // The envelope says which execution the escalation ended, so the kernel's
    // record of it joins to the turn's own terminal record on an id.
    expect(recordEscalation.mock.calls[0]?.[2]).toMatchObject({ executionId: "execution-1" });
    expect(result.events.map(({ type }) => type)).toContain("turn.escalated");
  });

  it("refuses an escalate outcome from a plugin whose turn was never granted the affordance", async () => {
    // A hostile replacement plugin: it ends every turn by asking for a human,
    // whatever its catalogue holds. The standard loop's drivers and the MCP
    // latch read the catalogue first, but a plugin replaces exactly that
    // check, so the envelope repeats it from outside -- otherwise the plugin
    // has a channel to the owner no host granted, on the strength of an
    // outcome it was never allowed to return.
    const recordEscalation = vi.fn(async (access: AccessContext, reason: string) => ({
      reason,
      reviewer: access.owner,
      requestedAt: access.now,
      status: "pending" as const,
    }));
    const hostile = runtime(async () => ({
      type: "escalate",
      reason: "let me out",
      metadata: { harness: "hostile" },
    }));

    const result = await new SharedOSExecutor({ ...kernel(), recordEscalation }, hostile, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    // Refused as any call outside the catalogue is, under the same code from
    // the same boundary; the turn fails because the runtime returned an
    // outcome it was not allowed to. Nothing reached the kernel: no
    // escalation is recorded, and no `turn.escalated` event is emitted.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("tool_unavailable");
    expect(recordEscalation).not.toHaveBeenCalled();
    const types = result.events.map(({ type }) => type);
    expect(types).toContain("turn.failed");
    expect(types).not.toContain("turn.escalated");
    // The event says who ended the turn, so a record reader can credit the
    // envelope with the refusal rather than the runtime with a failure.
    expect(result.events.find(({ type }) => type === "turn.failed")?.data).toEqual({
      code: "tool_unavailable",
      source: "envelope",
    });
    // The plugin's own metadata still rides on the result: the refusal is a
    // fact about the ending, not a reason to lose what the turn reported.
    expect(result.metadata).toMatchObject({ harness: "hostile" });
  });

  it("hands a thrown plugin error to the host and puts none of it on the wire", async () => {
    const thrown = new Error("connection pool exhausted at /srv/pulse/db.ts:88");
    const plugin = runtime(async () => {
      throw thrown;
    });
    const seen: { error: unknown; turn: TurnErrorContext }[] = [];

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
      onTurnError: (error, turn) => void seen.push({ error, turn }),
    }).execute(request());

    // The error arrives whole. A host logging it gets the stack, which is the
    // only thing that says where the throw came from -- the terminal code says
    // a turn stopped and nothing more.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.error).toBe(thrown);
    expect(seen[0]?.turn).toEqual({ executionId: "execution-1", traceId: "trace-1" });

    // And it arrives only there. The outcome is what it was before the hook
    // existed, and nothing a thrower had in scope reaches the model or the
    // event stream that becomes an execution record.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("runtime_failed");
    expect(result.status === "failed" ? result.error.message : undefined).toBe(
      "The runtime plugin failed.",
    );
    expect(JSON.stringify(result)).not.toContain("connection pool exhausted");
    expect(JSON.stringify(result)).not.toContain("/srv/pulse/db.ts");
  });

  it("does not report a cancelled turn as a turn error", async () => {
    const plugin = runtime(async () => new Promise(() => undefined));
    const input = request();
    input.options = { timeoutMs: 5 };
    const seen: unknown[] = [];

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
      onTurnError: (error) => void seen.push(error),
    }).execute(input);

    // A deadline is the envelope's own decision, not a defect to diagnose. A
    // hook that fired here would report every timed-out turn as a crash.
    expect(result.status).toBe("cancelled");
    expect(seen).toEqual([]);
  });

  it("does not let a turn-error sink replace the turn outcome", async () => {
    const plugin = runtime(async () => {
      throw new Error("the plugin failed");
    });

    const result = await new SharedOSExecutor(kernel(), plugin, {
      clock: () => now,
      createId: () => "event-1",
      onTurnError: () => {
        throw new Error("the host's logger is down");
      },
    }).execute(request());

    // Same rule as the event sink: a diagnostic that could turn one failure
    // into a second one is a risk to install rather than a diagnostic.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("runtime_failed");
  });

  it("does not let an observational event sink replace the turn outcome", async () => {
    const result = await new SharedOSExecutor(kernel(), runtime(), {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request(), {
      onEvent: () => {
        throw new Error("stream consumer closed");
      },
    });

    expect(result.status).toBe("succeeded");
  });
});

describe("what a plugin states for the record", () => {
  const stated = {
    promptHash: "a".repeat(64),
    asked: { tool: "sharedos.escalate", reason: "why" },
  };
  const state = (host: RuntimeHost): void => {
    host.annotate("promptHash", stated.promptHash);
    host.annotate("asked", stated.asked);
  };
  const execute = (
    plugin: RuntimePlugin,
    input: ExecutionRequest = request(),
    runtimeKernel = kernel(),
  ) =>
    new SharedOSExecutor(runtimeKernel, plugin, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

  it("is on the result of a turn that completed, beside the envelope's provenance", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        return { type: "complete", output: null, metadata: { model: "m" } };
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.metadata).toMatchObject({ ...stated, model: "m", runtime: { id: manifest.id } });
  });

  it("is on the result of a turn the runtime failed", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        return { type: "fail", error: { code: "driver_failed", message: "x", retryable: true } };
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.metadata).toMatchObject(stated);
  });

  it("is on the result of a turn that escalated", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        return { type: "escalate", reason: "needs a human" };
      }),
      request({ escalation: true }),
      kernel(undefined, { escalation: true }),
    );

    expect(result.status).toBe("escalated");
    expect(result.metadata).toMatchObject(stated);
  });

  it("is on the result of a turn cancelled at its deadline, which returns no outcome", async () => {
    const input = request();
    input.options = { timeoutMs: 5 };

    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        return new Promise(() => undefined);
      }),
      input,
    );

    expect(result.status).toBe("cancelled");
    expect(result.metadata).toMatchObject(stated);
  });

  it("is on the result of a turn whose plugin threw", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        throw new Error("plugin broke");
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.metadata).toMatchObject(stated);
  });

  it("is on the result of a turn whose outcome did not parse", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        state(host);
        return { type: "complete", output: undefined } as never;
      }),
    );

    expect(result.status === "failed" && result.error.code).toBe("invalid_runtime_outcome");
    expect(result.metadata).toMatchObject(stated);
  });

  it("is taken while the turn is aborted but still open", async () => {
    const input = request();
    input.options = { timeoutMs: 5 };

    const result = await execute(
      runtime(async (_input, host, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            // `emit` refuses here; a statement for the record does not.
            expect(() => host.emit({ type: "late", data: {} })).toThrow("Runtime host is closed");
            host.annotate("promptHash", stated.promptHash);
            resolve();
          });
        });
        return new Promise(() => undefined);
      }),
      input,
    );

    expect(result.status).toBe("cancelled");
    expect(result.metadata).toMatchObject({ promptHash: stated.promptHash });
  });

  it("outranks the same key on the outcome's own metadata, and the last write wins", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        host.annotate("promptHash", "first");
        host.annotate("promptHash", "second");
        return { type: "complete", output: null, metadata: { promptHash: "the outcome's copy" } };
      }),
    );

    expect(result.metadata?.["promptHash"]).toBe("second");
  });

  it("refuses the envelope's own key, an empty key, `__proto__`, and a value that is not JSON", async () => {
    const refused: unknown[] = [];
    const attempt = (write: () => void): void => {
      try {
        write();
      } catch (error) {
        refused.push(error);
      }
    };

    const result = await execute(
      runtime(async (_input, host) => {
        attempt(() => host.annotate("runtime", { id: "forged" }));
        attempt(() => host.annotate("", 1));
        attempt(() => host.annotate("__proto__", { polluted: true }));
        attempt(() => host.annotate("fn", (() => undefined) as never));
        attempt(() => host.annotate("nan", Number.NaN));
        attempt(() => host.annotate("date", new Date(0) as never));
        return { type: "complete", output: null };
      }),
    );

    expect(refused).toHaveLength(6);
    expect(refused.every((error) => error instanceof TypeError)).toBe(true);
    expect(Object.keys(result.metadata ?? {})).toEqual(["runtime"]);
    expect(result.metadata?.["runtime"]).toMatchObject({ id: manifest.id });
  });

  it("holds a copy, so a value changed after it was stated is recorded as stated", async () => {
    const result = await execute(
      runtime(async (_input, host) => {
        const value = { reason: "as stated" };
        host.annotate("asked", value);
        value.reason = "changed afterwards";
        return { type: "complete", output: null };
      }),
    );

    expect(result.metadata?.["asked"]).toEqual({ reason: "as stated" });
  });

  it("drops a write made after the turn has closed, without throwing", async () => {
    let capturedHost: RuntimeHost | undefined;
    const result = await execute(
      runtime(async (_input, host) => {
        capturedHost = host;
        return { type: "complete", output: null };
      }),
    );

    expect(() => capturedHost?.annotate("promptHash", stated.promptHash)).not.toThrow();
    expect(result.metadata?.["promptHash"]).toBeUndefined();
  });
});

describe("RuntimeRegistry", () => {
  it("validates, snapshots, and resolves trusted runtime registrations", () => {
    const plugin = runtime();
    const registry = new RuntimeRegistry([plugin]);

    expect(registry.has(manifest.id)).toBe(true);
    expect(registry.resolve(manifest.id).manifest).toEqual(manifest);
    expect(registry.list()).toEqual([manifest]);
    expect(() => registry.register(plugin)).toThrow("already registered");
    expect(() => registry.resolve("missing.runtime")).toThrow(RuntimeNotFoundError);

    const listed = registry.list()[0];
    if (listed !== undefined) {
      listed.version = "mutated";
    }
    expect(registry.resolve(manifest.id).manifest.version).toBe(manifest.version);
  });

  it("rejects malformed runtime manifests at registration and execution", () => {
    const malformed = {
      manifest: { id: "broken", version: "1" },
      run: async () => ({ type: "complete", output: null }) as const,
    } as unknown as RuntimePlugin;

    expect(() => new RuntimeRegistry([malformed])).toThrow("Runtime manifest");
    expect(() => new SharedOSExecutor(kernel(), malformed)).toThrow("Runtime manifest");
  });
});

describe("what the envelope writes into audit", () => {
  /** The stub kernel, plus the two optional recorders ADR 0023 added. */
  function recordingKernel(options: { readonly throws?: boolean } = {}) {
    const turnEnds: unknown[] = [];
    const refusals: unknown[] = [];
    return {
      ...kernel(),
      turnEnds,
      refusals,
      recordTurnEnd: vi.fn(async (_context: unknown, turn: unknown) => {
        if (options.throws === true) {
          throw new Error("audit store is unreachable");
        }
        turnEnds.push(turn);
      }),
      recordRefusedCall: vi.fn(async (_context: unknown, call: unknown) => {
        if (options.throws === true) {
          throw new Error("audit store is unreachable");
        }
        refusals.push(call);
      }),
    };
  }

  it("records a tool name the catalogue never offered, which reached no sink before", async () => {
    const host = recordingKernel();
    const plugin = runtime(async (_input, runtimeHost) => {
      await runtimeHost.invokeTool({
        id: "call-guessed",
        tool: "files.delete",
        arguments: {},
        traceId: context.traceId,
        requestedAt: now,
      });
      return { type: "complete", output: { ok: true } };
    });

    const result = await new SharedOSExecutor(host as never, plugin).execute(request());

    expect(result.status).toBe("succeeded");
    // Nothing reached the kernel, so nothing was audited: the clearest
    // attempted violation the system produces was invisible to a host with an
    // audit sink and no conformance record.
    expect(host.refusals).toEqual([
      {
        callId: "call-guessed",
        tool: "files.delete",
        reasonCode: "tool_unavailable",
        cause: "not_offered",
      },
    ]);
  });

  it("records the terminal once, whatever the ending", async () => {
    const host = recordingKernel();

    await new SharedOSExecutor(host as never, runtime()).execute(request());

    expect(host.turnEnds).toEqual([{ executionId: "execution-1", status: "succeeded" }]);
  });

  it("says whether the envelope refused the turn or the runtime reported its own failure", async () => {
    const host = recordingKernel();
    const thrown = runtime(async () => {
      throw new Error("the plugin stopped obeying the protocol");
    });

    await new SharedOSExecutor(host as never, thrown).execute(request());

    // A record reader crediting enforcement must not credit a plugin's
    // self-reported error, so the two endings are distinguishable.
    expect(host.turnEnds).toEqual([
      {
        executionId: "execution-1",
        status: "failed",
        reasonCode: "runtime_failed",
        endedBy: "envelope",
      },
    ]);
  });

  it("does not let a failing audit write change the turn it was recording", async () => {
    const host = recordingKernel({ throws: true });

    const result = await new SharedOSExecutor(host as never, runtime()).execute(request());

    // A dropped audit write matters -- that is what `onAuditError` is for -- but
    // it must not turn a turn that completed into one that threw.
    expect(result.status).toBe("succeeded");
    expect(host.recordTurnEnd).toHaveBeenCalledTimes(1);
  });
});
