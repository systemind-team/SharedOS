import { ReplayProtection } from "@aicoo/sharedos-core";
import { describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  ExecutionRequest,
  ToolDefinition,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { SPAN, SharedOSKernel, type Span, type SpanSink } from "@aicoo/sharedos-core";
import type { CapabilityGrant } from "@aicoo/sharedos-contracts";

import {
  ESCALATION_REASON_MAX_LENGTH,
  ESCALATION_TOOL_DEFINITION,
  ESCALATION_TOOL_NAME,
  ESCALATION_TOOL_NAMESPACE,
  SharedOSExecutor,
  STANDARD_RUNTIME_MANIFEST,
  createStandardRuntime,
  escalationReason,
  escalationRequest,
  type AgentTurnDriver,
  type AgentTurnSession,
  type RuntimeTurnRequest,
  type SharedOSExecutorOptions,
  type StandardRuntimeOptions,
  type TurnKernel,
} from "./index.js";

const now = "2026-08-03T00:00:00.000Z";
const sender = { kind: "agent", agentId: "agent-bob" } as const;
const receiver = { kind: "agent", agentId: "agent-alice" } as const;
const owner = { kind: "human", userId: "user-alice" } as const;

const tool: ToolDefinition = {
  name: "files.search",
  description: "Authoritative registry definition",
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
    tools: [
      { ...tool, description: "Caller-supplied description" },
      ...(escalation ? [ESCALATION_TOOL_DEFINITION] : []),
    ],
  };
}

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

/** The standard composition: the loop with one driver seated, inside the envelope. */
function turnExecutor(
  turnKernel: ConstructorParameters<typeof SharedOSExecutor>[0],
  driver: AgentTurnDriver,
  options: SharedOSExecutorOptions & Omit<StandardRuntimeOptions, "driver"> = {},
): SharedOSExecutor {
  const { closeTimeoutMs, onTurnError, ...executorOptions } = options;
  return new SharedOSExecutor(
    turnKernel,
    createStandardRuntime({
      driver,
      ...(closeTimeoutMs === undefined ? {} : { closeTimeoutMs }),
      ...(onTurnError === undefined ? {} : { onTurnError }),
    }),
    { ...executorOptions, ...(onTurnError === undefined ? {} : { onTurnError }) },
  );
}

describe("the standard composition", () => {
  it("files the turn under the driver that sat in the seat", async () => {
    const next = async () => ({ type: "complete" as const, output: null });
    const manifest = { id: "acme.assistant", version: "2.0.0", protocolVersion: "1" as const };
    const named: AgentTurnDriver = { manifest, open: async () => ({ next }) };
    const unnamed: AgentTurnDriver = { open: async () => ({ next }) };

    // The loop is the same whichever driver is seated, so the runtime reports
    // the driver's manifest, and the envelope stamps that on the result.
    expect(createStandardRuntime({ driver: named }).manifest).toEqual(manifest);
    expect(createStandardRuntime({ driver: unnamed }).manifest).toBe(STANDARD_RUNTIME_MANIFEST);
    const result = await turnExecutor(kernel(), named).execute(request());
    expect(result.metadata?.["runtime"]).toMatchObject({ id: "acme.assistant", version: "2.0.0" });
    const standard = await turnExecutor(kernel(), unnamed).execute(request());
    expect(standard.metadata?.["runtime"]).toMatchObject({ id: "sharedos.standard" });
  });

  it("tells the driver where it may operate, narrowed to what its catalogue can act on", async () => {
    const seen: unknown[] = [];
    const driver: AgentTurnDriver = {
      open: async (request) => {
        seen.push(request.context.reach);
        return { next: async () => ({ type: "complete" as const, output: null }) };
      },
    };
    const turnKernel = kernel();
    const files = {
      namespace: "files",
      path: ["Work", "atlas"],
      actions: ["read", "search"],
      scope: "descendants" as const,
    };
    turnKernel.reach = vi.fn(async () => ({
      status: "computed" as const,
      reach: [
        files,
        // Authorized, but no offered tool acts on it: not somewhere this turn
        // can work, so the driver is not sent there.
        {
          namespace: "sharedos.execution",
          path: ["agent", "agent-alice"],
          actions: ["invoke"],
          scope: "exact" as const,
        },
      ],
    }));

    await turnExecutor(turnKernel, driver).execute(request());

    expect(seen[0]).toEqual({ status: "computed", reach: [files] });
    // The point of the shape: nothing about who allowed it, for how long, or
    // how much budget is left.
    expect(JSON.stringify(seen[0])).not.toContain("grant");
  });

  it("hands the driver a reach it could not establish as such, and still runs the turn", async () => {
    const seen: unknown[] = [];
    const driver: AgentTurnDriver = {
      open: async (request) => {
        seen.push(request.context.reach);
        return { next: async () => ({ type: "complete" as const, output: null }) };
      },
    };
    const turnKernel = kernel();
    turnKernel.reach = vi.fn(async () => ({
      status: "unavailable" as const,
      reasonCode: "usage_store_unavailable" as const,
    }));

    const result = await turnExecutor(turnKernel, driver).execute(request());

    // Not an empty list, which would read as "nothing" and be false here.
    expect(seen[0]).toEqual({ status: "unavailable", reasonCode: "usage_store_unavailable" });
    expect(result.status).toBe("succeeded");
  });

  it("executes an inbound message as its recipient", async () => {
    const input = request();
    const runtimeKernel = kernel();
    const next = vi
      .fn<AgentTurnSession["next"]>()
      .mockResolvedValueOnce({
        type: "tool_call",
        call: {
          id: "call-1",
          tool: tool.name,
          arguments: { query: "status" },
          traceId: context.traceId,
          requestedAt: now,
        },
      })
      .mockResolvedValueOnce({ type: "complete", output: { ok: true } });

    const result = await turnExecutor(
      runtimeKernel,
      {
        open: async () => ({ next }),
      },
      {
        clock: () => now,
        createId: () => "event-1",
      },
    ).execute(input);

    expect(result.status).toBe("succeeded");
    expect(runtimeKernel.admitTurn).toHaveBeenCalledWith(
      expect.objectContaining({ actor: receiver }),
      receiver,
      expect.anything(),
    );
    expect(runtimeKernel.listTools).toHaveBeenCalledWith(
      expect.objectContaining({ actor: receiver }),
      expect.anything(),
    );
    expect(runtimeKernel.invokeTool).toHaveBeenCalledWith(
      expect.objectContaining({ actor: receiver }),
      expect.objectContaining({ id: "call-1", tool: tool.name }),
      expect.anything(),
    );
  });

  it("ends the turn as escalated when the driver asks for a human", async () => {
    // The variant exists so a driver inside this loop can reach the terminal
    // outcome `RuntimeTurnOutcome` has always declared. Without it a driver
    // could only complete or fail, and every driven column reported the
    // escalation row as structurally unavailable -- a limit of this type rather
    // than of any vendor.
    const session: AgentTurnSession = {
      next: vi.fn<AgentTurnSession["next"]>(async () => ({
        type: "escalate",
        reason: "issuing a control-plane grant is outside this agent's authority",
      })),
    };
    const driver: AgentTurnDriver = { open: async () => session };

    const result = await turnExecutor(kernel(undefined, { escalation: true }), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request({ escalation: true }));

    expect(result.status).toBe("escalated");
    expect(result.status === "escalated" ? result.escalation.reason : undefined).toBe(
      "issuing a control-plane grant is outside this agent's authority",
    );
    // Escalation is not failure. A turn that asked and a turn that broke are
    // different events, and collapsing them would lose the distinction the row
    // exists to record.
    expect(result.status).not.toBe("failed");
    // And the ask is on the result on its own, stated before the loop ended on
    // it: a reader can tell a turn that asked from one that never did even
    // when the ending is not the one the ask should have had.
    expect(result.metadata?.["escalationAsked"]).toEqual({
      tool: ESCALATION_TOOL_NAME,
      reason: "issuing a control-plane grant is outside this agent's authority",
    });
  });

  it("refuses an escalate decision whose reason is not a usable string", async () => {
    const session: AgentTurnSession = {
      next: vi.fn<AgentTurnSession["next"]>(
        async () => ({ type: "escalate", reason: "  " }) as never,
      ),
    };
    const driver: AgentTurnDriver = { open: async () => session };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    // Bounded exactly as the outcome is. A decision that parsed here but not as
    // an outcome would fail further in, where the cause is no longer visible.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "invalid_driver_decision",
    );
  });

  it("refuses an escalate decision whose metadata is not an object", async () => {
    const session: AgentTurnSession = {
      next: vi.fn<AgentTurnSession["next"]>(
        async () =>
          ({ type: "escalate", reason: "needs an owner", metadata: "not an object" }) as never,
      ),
    };
    const driver: AgentTurnDriver = { open: async () => session };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    // Parsed exactly as `complete`'s metadata is. An escalation whose metadata
    // failed further in would surface as a runtime failure with the cause gone.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "invalid_driver_decision",
    );
  });

  it("refuses an escalate decision whose reason runs past the outcome's bound", async () => {
    const session: AgentTurnSession = {
      next: vi.fn<AgentTurnSession["next"]>(async () => ({
        type: "escalate",
        reason: "x".repeat(ESCALATION_REASON_MAX_LENGTH + 1),
      })),
    };
    const driver: AgentTurnDriver = { open: async () => session };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    // A decision is code, not input. A driver handing the loop more than the
    // outcome carries has a bug, and refusing the decision is how it is found;
    // the recogniser a driver reads model output through is what cuts.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "invalid_driver_decision",
    );
  });

  it("refuses a declared step behind the loop's own position", async () => {
    // The declaration exists to reach past the budget. A driver naming a step
    // the loop has already passed is making a claim the loop can see is false,
    // and the record would otherwise carry it as the position of the call.
    const call = (id: string) => ({
      id,
      tool: tool.name,
      arguments: { query: "status" },
      traceId: context.traceId,
      requestedAt: now,
    });
    const next = vi
      .fn<AgentTurnSession["next"]>()
      .mockResolvedValueOnce({ type: "tool_call", call: call("call-1"), step: 1 })
      .mockResolvedValueOnce({ type: "tool_call", call: call("call-2"), step: 0 })
      .mockResolvedValue({ type: "complete", output: { ok: true } });
    const runtimeKernel = kernel();

    const result = await turnExecutor(
      runtimeKernel,
      { open: async () => ({ next }) },
      { clock: () => now, createId: () => "event-1" },
    ).execute(request());

    // The first call reached forward (1 at position 0) and went through; the
    // second reached back (0 at position 1) and ended the turn.
    expect(runtimeKernel.invokeTool).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe(
      "invalid_driver_decision",
    );
  });

  it("uses the registry's permission-filtered tool definition", async () => {
    let openedRequest: RuntimeTurnRequest | undefined;
    const session: AgentTurnSession = {
      next: vi.fn<AgentTurnSession["next"]>(async () => ({
        type: "complete",
        output: { ok: true },
      })),
    };
    const driver: AgentTurnDriver = {
      open: vi.fn(async (input) => {
        openedRequest = input;
        return session;
      }),
    };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("succeeded");
    expect(openedRequest?.tools).toEqual([tool]);
    expect(openedRequest?.context).not.toHaveProperty("grants");
    expect(openedRequest?.context).not.toHaveProperty("authority");
    expect(openedRequest?.context).not.toHaveProperty("enabledToolNamespaces");
  });

  it("feeds permission-checked tool results back into the driver", async () => {
    const denied: ToolResult = {
      callId: "call-1",
      tool: tool.name,
      status: "denied",
      completedAt: now,
      error: { code: "no_matching_grant", message: "Denied" },
    };
    const next = vi
      .fn<AgentTurnSession["next"]>()
      .mockResolvedValueOnce({
        type: "tool_call",
        call: {
          id: "call-1",
          tool: tool.name,
          arguments: { query: "status" },
          traceId: context.traceId,
          requestedAt: now,
        },
      })
      .mockResolvedValueOnce({ type: "complete", output: { handled: true } });
    const driver: AgentTurnDriver = { open: async () => ({ next }) };
    const runtimeKernel = kernel(denied);

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("succeeded");
    expect(runtimeKernel.invokeTool).toHaveBeenCalledOnce();
    expect(next).toHaveBeenNthCalledWith(
      2,
      { type: "tool_result", result: denied },
      expect.anything(),
    );
  });

  it("denies a turn when the access actor differs from the executing agent", async () => {
    const input = request();
    input.context = { ...input.context, actor: sender };
    const runtimeKernel = kernel();
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.error.code).toBe("actor_mismatch");
    }
    expect(driver.open).not.toHaveBeenCalled();
    expect(runtimeKernel.admitTurn).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("denies a turn when the message receiver differs from the executing agent", async () => {
    const input = request();
    input.message.receiver = sender;
    const runtimeKernel = kernel();
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.error.code).toBe("receiver_mismatch");
    }
    expect(driver.open).not.toHaveBeenCalled();
    expect(runtimeKernel.admitTurn).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("denies a turn when the message purpose differs from the access context", async () => {
    const input = request();
    input.message.purpose = "different-purpose";
    const runtimeKernel = kernel();
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.error.code).toBe("message_context_mismatch");
    }
    expect(driver.open).not.toHaveBeenCalled();
    expect(runtimeKernel.admitTurn).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("denies a turn when the message trace differs from the access context", async () => {
    const input = request();
    input.message.traceId = "different-trace";
    const runtimeKernel = kernel();
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.error.code).toBe("message_context_mismatch");
    }
    expect(driver.open).not.toHaveBeenCalled();
    expect(runtimeKernel.admitTurn).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
  });

  it("denies a turn before opening the driver without an execution grant", async () => {
    const runtimeKernel = kernel();
    runtimeKernel.admitTurn = vi.fn(async () => ({
      allowed: false,
      reasonCode: "no_matching_grant",
    }));
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("denied");
    expect(driver.open).not.toHaveBeenCalled();
    expect(runtimeKernel.listTools).not.toHaveBeenCalled();
  });

  it("does not dispatch a tool outside the effective catalog", async () => {
    const next = vi
      .fn<AgentTurnSession["next"]>()
      .mockResolvedValueOnce({
        type: "tool_call",
        call: {
          id: "call-hidden",
          tool: "files.delete",
          arguments: { path: ["secret"], content: "changed" },
          traceId: context.traceId,
          requestedAt: now,
        },
      })
      .mockResolvedValueOnce({ type: "complete", output: { handled: true } });
    const runtimeKernel = kernel();

    const result = await turnExecutor(
      runtimeKernel,
      { open: async () => ({ next }) },
      { clock: () => now, createId: () => "event-1" },
    ).execute(request());

    expect(result.status).toBe("succeeded");
    expect(runtimeKernel.invokeTool).not.toHaveBeenCalled();
    expect(next).toHaveBeenNthCalledWith(
      2,
      {
        type: "tool_result",
        result: expect.objectContaining({
          tool: "files.delete",
          status: "denied",
          error: expect.objectContaining({ code: "tool_unavailable" }),
        }),
      },
      expect.anything(),
    );
  });

  it("fails closed on a malformed driver decision", async () => {
    const driver: AgentTurnDriver = {
      open: async () => ({
        next: async () => ({ type: "complete", output: undefined }) as never,
      }),
    };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("invalid_driver_decision");
    }
  });

  it("applies timeout while loading the visible tool catalog", async () => {
    const runtimeKernel: TurnKernel = {
      ...kernel(),
      listTools: async () => new Promise(() => undefined),
      invokeTool: vi.fn(),
    };
    const input = request();
    input.options = { timeoutMs: 5 };
    const driver: AgentTurnDriver = { open: vi.fn() };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);

    expect(result.status).toBe("cancelled");
    expect(driver.open).not.toHaveBeenCalled();
  });

  it("propagates timeout cancellation to a running tool", async () => {
    let sideEffect = false;
    const runtimeKernel = kernel();
    runtimeKernel.invokeTool = vi.fn(async (_access, call, options) => {
      return new Promise<ToolResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          sideEffect = true;
          resolve({
            callId: call.id,
            tool: call.tool,
            status: "succeeded",
            output: null,
            completedAt: now,
          });
        }, 50);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      });
    });
    const input = request();
    input.options = { timeoutMs: 5 };
    const driver: AgentTurnDriver = {
      open: async () => ({
        next: async () => ({
          type: "tool_call",
          call: {
            id: "call-1",
            tool: tool.name,
            arguments: { query: "status" },
            traceId: context.traceId,
            requestedAt: now,
          },
        }),
      }),
    };

    const result = await turnExecutor(runtimeKernel, driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(input);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(result.status).toBe("cancelled");
    expect(sideEffect).toBe(false);
  });

  it("bounds a provider session that hangs while closing", async () => {
    const driver: AgentTurnDriver = {
      open: async () => ({
        next: async () => ({ type: "complete", output: null }),
        close: async () => new Promise(() => undefined),
      }),
    };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
      closeTimeoutMs: 5,
    }).execute(request());

    expect(result.status).toBe("succeeded");
  });

  it("closes a session that opens after its turn was cancelled", async () => {
    // A driver that does not honour its signal, as a provider SDK part-way
    // through a handshake does not. The turn stops waiting for it; whatever it
    // then hands back still holds a connection that only `close` lets go of.
    const close = vi.fn<NonNullable<AgentTurnSession["close"]>>();
    let answer!: () => void;
    const opened = new Promise<void>((resolve) => (answer = resolve));
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const driver: AgentTurnDriver = {
      open: async () => {
        enter();
        await opened;
        return { next: async () => ({ type: "complete", output: null }), close };
      },
    };
    const cancel = new AbortController();

    const turn = turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request(), { signal: cancel.signal });
    await entered;
    cancel.abort(new Error("the host cancelled"));
    const result = await turn;

    // The turn ended without the session, so nothing has been closed yet.
    expect(result.status).toBe("cancelled");
    expect(close).not.toHaveBeenCalled();

    answer();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(close.mock.calls[0]?.[0]).toBe("cancelled");
    expect(close.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("leaves nothing unhandled when a late session fails to open or to close", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const late of ["rejects", "close throws"] as const) {
        let answer!: () => void;
        const opened = new Promise<void>((resolve) => (answer = resolve));
        let enter!: () => void;
        const entered = new Promise<void>((resolve) => (enter = resolve));
        const driver: AgentTurnDriver = {
          open: async () => {
            enter();
            await opened;
            if (late === "rejects") {
              throw new Error("the handshake failed");
            }
            return {
              next: async () => ({ type: "complete", output: null }),
              close: () => {
                throw new Error("the connection was already gone");
              },
            };
          },
        };
        const cancel = new AbortController();
        const turn = turnExecutor(kernel(), driver, {
          clock: () => now,
          createId: () => "event-1",
        }).execute(request(), { signal: cancel.signal });
        await entered;
        cancel.abort(new Error("the host cancelled"));

        expect((await turn).status).toBe("cancelled");
        answer();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("closes a session that opened in time once", async () => {
    const close = vi.fn<NonNullable<AgentTurnSession["close"]>>();
    const driver: AgentTurnDriver = {
      open: async () => ({ next: async () => ({ type: "complete", output: null }), close }),
    };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
    }).execute(request());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.status).toBe("succeeded");
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.calls[0]?.[0]).toBe("succeeded");
  });

  it("forwards a span sink to the executor it fronts", async () => {
    const spans: Span[] = [];
    const sink: SpanSink = { record: (span) => void spans.push(span) };
    const next = vi
      .fn<AgentTurnSession["next"]>()
      .mockResolvedValueOnce({ type: "complete", output: { ok: true } });

    const result = await turnExecutor(
      kernel(),
      { open: async () => ({ next }) },
      { clock: () => now, createId: () => "event-1", spans: sink },
    ).execute(request());

    expect(result.status).toBe("succeeded");
    expect(spans.map((span) => span.name)).toContain(SPAN.TURN);
  });

  it("forwards a turn-error sink to the executor it fronts", async () => {
    // The same defect the span sink had: the facade forwards its options one by
    // one, so a new one is dropped silently unless it is added here too, and a
    // host installing a diagnostic on the facade would be told nothing by a
    // hook that never fires.
    const thrown = new Error("the driver's session store is down");
    const seen: unknown[] = [];
    const driver: AgentTurnDriver = {
      open: async () => {
        throw thrown;
      },
    };

    const result = await turnExecutor(kernel(), driver, {
      clock: () => now,
      createId: () => "event-1",
      onTurnError: (error) => void seen.push(error),
    }).execute(request());

    // The loop caught this one, not the envelope: a driver's throw becomes the
    // cooperative `driver_failed` outcome and never reaches the executor's
    // catch. So the facade has to forward the sink to both, and one hook covers
    // both containment sites.
    expect(result.status).toBe("failed");
    expect(result.status === "failed" ? result.error.code : undefined).toBe("driver_failed");
    expect(seen).toEqual([thrown]);
  });
});

describe("turn-scoped authority", () => {
  const agentGrant: CapabilityGrant = {
    id: "grant-turn",
    namespaceId: "world-1",
    subject: receiver,
    issuer: owner,
    capabilities: [
      {
        resource: { namespace: "sharedos.execution", path: ["agent", "agent-alice"], owner },
        actions: ["invoke"],
        scope: "exact",
      },
    ],
    constraints: {},
    issuedAt: "2026-08-02T00:00:00.000Z",
  };

  const completingDriver: AgentTurnDriver = {
    open: async () => ({ next: async () => ({ type: "complete", output: { ok: true } }) }),
  };

  // Two runs that agree on actor, authority, owner, purpose and trace, the
  // second started while the first is still open and after its grant is gone.
  it.each([
    [
      "decides a run under another execution id against authority of its own",
      "execution-2",
      { status: "denied", error: { code: "no_matching_grant" } },
      2,
    ],
    [
      "refuses a run under the execution id that is still running, and loads nothing",
      "execution-1",
      { status: "denied", error: { code: "execution_in_progress" } },
      1,
    ],
  ] as const)("%s", async (_name, executionId, expected, loads) => {
    let revoked = false;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () =>
      revoked ? [] : [{ ...agentGrant, namespaceId: context.namespaceId }],
    );
    const kernel = new SharedOSKernel({ grantSource: { load } });
    // Only the first run is held open, so a second run that shared its lease
    // would finish `succeeded` and fail the assertion instead of hanging.
    let opened = 0;
    const driver: AgentTurnDriver = {
      open: async () => {
        const held = (opened += 1) === 1;
        started();
        return {
          next: async () => {
            if (held) {
              await waiting;
            }
            return { type: "complete", output: null };
          },
        };
      },
    };
    const executor = turnExecutor(kernel, driver, { clock: () => now });
    // What the host put on the context is not what the lease is keyed on.
    const sharedRequest = {
      ...request(),
      context: { ...context, executionId: "host-supplied" },
    };
    const first = executor.execute(sharedRequest);
    await entered;
    revoked = true;
    try {
      await expect(executor.execute({ ...sharedRequest, executionId })).resolves.toMatchObject(
        expected,
      );
      expect(load).toHaveBeenCalledTimes(loads);
    } finally {
      release();
    }
    await expect(first).resolves.toMatchObject({ status: "succeeded" });
  });

  it("releases the turn's authority when the turn is cancelled while it is being resolved", async () => {
    let loads = 0;
    let revoked = false;
    let releaseLoad: (() => void) | undefined;

    const kernel = new SharedOSKernel({
      grantSource: {
        async load() {
          loads += 1;
          if (loads === 1) {
            await new Promise<void>((resolve) => {
              releaseLoad = resolve;
            });
          }
          return revoked ? [] : [agentGrant];
        },
      },
    });
    const executor = turnExecutor(kernel, completingDriver, { clock: () => now });

    const controller = new AbortController();
    const cancelled = executor.execute(request(), { signal: controller.signal });
    // Abort while the very first authority load is still in flight.
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ status: "cancelled" });

    // Let the abandoned load finish, and revoke before the next turn opens.
    releaseLoad?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    revoked = true;

    // The abandoned lease must not answer this turn.
    await expect(executor.execute(request())).resolves.toMatchObject({
      status: "denied",
      error: { code: "no_matching_grant" },
    });
    expect(loads).toBe(2);
  });
});

describe("recognising an escalation in a call", () => {
  it("keeps the reason as given, cut to the bound rather than replaced", () => {
    const given = "needs an owner: " + "y".repeat(ESCALATION_REASON_MAX_LENGTH * 2);
    const recognised = escalationRequest(ESCALATION_TOOL_NAME, { reason: given });

    // The occupant's own words, and the first 512 of them: replacing the whole
    // reason with the canned fallback would record that nothing was said.
    expect(recognised).toBe(given.slice(0, ESCALATION_REASON_MAX_LENGTH));
    expect(recognised).toHaveLength(ESCALATION_REASON_MAX_LENGTH);
    expect(escalationRequest(ESCALATION_TOOL_NAME, { reason: "  short  " })).toBe("short");
  });

  it("does not cut through a surrogate pair at the bound", () => {
    const reason = "z".repeat(ESCALATION_REASON_MAX_LENGTH - 1) + "\u{1F600}" + "tail";
    const recognised = escalationRequest(ESCALATION_TOOL_NAME, { reason });

    expect(recognised).toBe("z".repeat(ESCALATION_REASON_MAX_LENGTH - 1));
    expect(recognised).not.toMatch(/[\uD800-\uDBFF]$/u);
  });

  it("escalates under a reason of its own when the call carries none it can read", () => {
    const fallback = "the turn asked for a human decision without saying what needs deciding";

    expect(escalationRequest(ESCALATION_TOOL_NAME, {})).toBe(fallback);
    expect(escalationRequest(ESCALATION_TOOL_NAME, { reason: "   " })).toBe(fallback);
    expect(escalationRequest(ESCALATION_TOOL_NAME, { reason: 42 })).toBe(fallback);
    expect(escalationRequest(ESCALATION_TOOL_NAME, "not an object")).toBe(fallback);
    expect(escalationRequest(ESCALATION_TOOL_NAME, undefined)).toBe(fallback);
  });

  it("recognises nothing but the affordance's own name", () => {
    expect(escalationRequest("files.read", { reason: "please" })).toBeUndefined();
    expect(escalationRequest("sharedos.escalate.now", { reason: "please" })).toBeUndefined();
  });

  it("bounds a decision's reason strictly, as the outcome does", () => {
    expect(escalationReason("x".repeat(ESCALATION_REASON_MAX_LENGTH))).toHaveLength(
      ESCALATION_REASON_MAX_LENGTH,
    );
    expect(escalationReason("x".repeat(ESCALATION_REASON_MAX_LENGTH + 1))).toBeUndefined();
    expect(escalationReason("   ")).toBeUndefined();
    expect(escalationReason(7)).toBeUndefined();
  });
});

/**
 * A driver that hands the seat text states its hash on the session, and the
 * loop states it to the envelope before the first step. The point is the turn
 * that never returns: the outcome its own metadata would have ridden on is
 * lost, and the record would otherwise not say what it was asked.
 */
describe("what the seat was told, stated before the first step", () => {
  const hash = "d".repeat(64);

  it("survives a turn cancelled while the driver is still deciding", async () => {
    const cancel = new AbortController();
    const driver: AgentTurnDriver = {
      open: async () => ({
        promptHash: hash,
        // Abort, then hang: the turn is cancelled from outside the moment the
        // driver is asked for its first decision, and the loop's own race
        // against the signal is what ends the wait.
        next: () => {
          cancel.abort(new Error("deadline"));
          return new Promise(() => undefined);
        },
      }),
    };

    const result = await turnExecutor(kernel(), driver).execute(request(), {
      signal: cancel.signal,
    });

    expect(result.status).toBe("cancelled");
    // No outcome came back, so nothing the driver would have put on one did.
    // What the loop stated to the envelope is on the result all the same.
    expect(result.metadata?.["promptHash"]).toBe(hash);
  });

  it("is on the result of a turn that ran, stated once by the session and by nothing else", async () => {
    const driver: AgentTurnDriver = {
      open: async () => ({
        promptHash: hash,
        next: async (input) =>
          input.type === "start"
            ? {
                type: "tool_call",
                call: {
                  id: "call-1",
                  tool: tool.name,
                  arguments: { query: "status" },
                  traceId: context.traceId,
                  requestedAt: now,
                },
              }
            : { type: "complete", output: { done: true } },
      }),
    };

    const result = await turnExecutor(kernel(), driver).execute(request());

    expect(result.status).toBe("succeeded");
    expect(result.metadata?.["promptHash"]).toBe(hash);
    // A fact about the turn, not something that happened in it: no event.
    expect(result.events.some(({ type }) => type === "runtime.event")).toBe(false);
  });

  it("is not stated for a driver that hands the seat no text", async () => {
    const driver: AgentTurnDriver = {
      open: async () => ({
        next: async () => ({ type: "complete", output: { done: true } }),
      }),
    };

    const result = await turnExecutor(kernel(), driver).execute(request());

    expect(result.status).toBe("succeeded");
    expect(result.metadata?.["promptHash"]).toBeUndefined();
  });
});
