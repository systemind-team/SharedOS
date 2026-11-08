import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  AuditEvent,
  CapabilityGrant,
  ExecutionRequest,
  ToolCall,
  ToolDefinition,
} from "@aicoo/sharedos-contracts";
import { SharedOSKernel } from "@aicoo/sharedos-core";

import {
  SharedOSExecutor,
  createStandardRuntime,
  type AgentTurnDecision,
  type AgentTurnInput,
  type AgentTurnSession,
  type RuntimePlugin,
} from "./index.js";

const now = "2026-09-18T00:00:00.000Z";
const owner = { kind: "human", userId: "user-alice" } as const;
const agent = { kind: "agent", agentId: "agent-alice" } as const;

const context: AccessContext = {
  actor: agent,
  authority: owner,
  owner,
  namespaceId: "world-1",
  enabledToolNamespaces: ["payments"],
  purpose: "settle-invoice",
  traceId: "trace-1",
  now,
};

function tool(
  name: string,
  action: string,
  readWrite: "read" | "write",
  annotations?: ToolDefinition["annotations"],
): ToolDefinition {
  return {
    name,
    description: name,
    namespace: "payments",
    source: "sharedos",
    readWrite,
    inputSchema: { type: "object" },
    requiredCapability: { resource: { namespace: "payments", path: [], owner }, action },
    ...(annotations === undefined ? {} : { annotations }),
  };
}

const transferFunds = tool("payments.transfer_funds", "transfer", "write");
const lookup = tool("payments.lookup", "read", "read");
const setMemo = tool("payments.set_memo", "memo", "write", { idempotent: true });
const tools = [transferFunds, lookup, setMemo];

function grant(id: string, namespace: string, path: string[], action: string): CapabilityGrant {
  return {
    id,
    namespaceId: "world-1",
    subject: agent,
    issuer: owner,
    capabilities: [{ resource: { namespace, path, owner }, actions: [action], scope: "exact" }],
    constraints: {},
    issuedAt: "2026-09-17T00:00:00.000Z",
  };
}

const grants = [
  grant("grant-turn", "sharedos.execution", ["agent", "agent-alice"], "invoke"),
  grant("grant-transfer", "payments", [], "transfer"),
  grant("grant-read", "payments", [], "read"),
  grant("grant-memo", "payments", [], "memo"),
];

function request(): ExecutionRequest {
  return {
    version: "1",
    executionId: "execution-1",
    agent,
    context,
    message: {
      version: "1",
      id: "message-1",
      sender: owner,
      receiver: agent,
      purpose: context.purpose,
      payload: { invoice: "inv-7" },
      traceId: context.traceId,
      createdAt: now,
    },
    tools,
    options: { timeoutMs: 120_000 },
  };
}

function call(id: string, definition: ToolDefinition = transferFunds): ToolCall {
  return { id, tool: definition.name, arguments: {}, traceId: context.traceId, requestedAt: now };
}

const sleep = (ms: number): Promise<void> =>
  ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

// The kernel hashes a catalogue through `crypto.subtle`, which is real work no
// fake clock moves. A test therefore waits, in real time, for the turn to get
// where it is going before it moves the fake clock past it; moving first arms
// the turn's timers late and the test then waits on a deadline nobody reaches.
const realSetTimeout = setTimeout;
/** Real time for a rejection to travel from the sink to the envelope. */
const realPause = (): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, 25));

async function until(reached: () => boolean): Promise<void> {
  for (let waited = 0; !reached(); waited += 5) {
    if (waited > 3_000) {
      throw new Error("the turn did not get there");
    }
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
}

/**
 * A real kernel and a ledger. Every tool takes `workMs` between its two halves,
 * debits before and credits after, and stops between them if it is aborted, the
 * way a handler that passes its signal to its I/O does.
 */
function world(
  workMs: number,
  down: (event: AuditEvent) => boolean = () => false,
  /** A call whose decision the sink neither writes nor refuses until `failHeld`. */
  holdDecisionOf?: string,
) {
  const trail: AuditEvent[] = [];
  const ledger: string[] = [];
  const state = { entered: 0, held: false };
  let failHeld: () => void = () => undefined;
  const kernel = new SharedOSKernel({
    grantSource: { load: async () => grants },
    audit: {
      record: async (event) => {
        if (down(event)) {
          throw new Error(`audit store unavailable for ${event.type}`);
        }
        if (
          holdDecisionOf !== undefined &&
          event.type === "authorization.checked" &&
          event.operationId === holdDecisionOf
        ) {
          state.held = true;
          await new Promise<void>((_resolve, reject) => {
            failHeld = () => reject(new Error("audit store went away"));
          });
        }
        trail.push(event);
      },
    },
  });
  for (const definition of tools) {
    kernel.registerTool({
      definition,
      parseArguments: (arguments_) => arguments_,
      invoke: async (_context, toolCall, signal) => {
        ledger.push(`${toolCall.id}: debit A`);
        state.entered += 1;
        await sleep(workMs);
        signal.throwIfAborted();
        ledger.push(`${toolCall.id}: credit B`);
        return {
          callId: toolCall.id,
          tool: toolCall.tool,
          status: "succeeded",
          output: { moved: true },
          completedAt: now,
        };
      },
    });
  }
  return { kernel, trail, ledger, state, failHeld: () => failHeld() };
}

/** A driver that asks for the given calls in turn, then completes. */
function scripted(calls: readonly ToolCall[]): {
  driver: { open: () => Promise<AgentTurnSession> };
  inputs: AgentTurnInput[];
} {
  const inputs: AgentTurnInput[] = [];
  let asked = 0;
  return {
    inputs,
    driver: {
      open: async () => ({
        next: async (input): Promise<AgentTurnDecision> => {
          inputs.push(input);
          const next = calls[asked];
          asked += 1;
          return next === undefined
            ? { type: "complete", output: { done: true } }
            : { type: "tool_call", call: next };
        },
      }),
    },
  };
}

/** The standard loop over `driver`, whose session opens `afterMs` into the turn. */
function opening(afterMs: number, driver: { open: () => Promise<AgentTurnSession> }) {
  const progress = { opening: false };
  const runtime: RuntimePlugin = createStandardRuntime({
    driver: {
      open: async () => {
        progress.opening = true;
        await sleep(afterMs);
        return driver.open();
      },
    },
  });
  return { runtime, progress };
}

function executor(kernel: SharedOSKernel, runtime: RuntimePlugin, drainGraceMs?: number) {
  return new SharedOSExecutor(kernel, runtime, {
    clock: () => now,
    ...(drainGraceMs === undefined ? {} : { drainGraceMs }),
  });
}

function operation(trail: readonly AuditEvent[], callId: string) {
  return trail.find((event) => event.type === "tool.invoked" && event.operationId === callId);
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("a turn that drains before its deadline", () => {
  it("lets a transfer caught between its debit and its credit finish, and ends the turn then", async () => {
    // Entered at 114 s, so the soft deadline at 115 s falls between the halves.
    const { kernel, trail, ledger, state } = world(3_000);
    const { driver, inputs } = scripted([call("call-1")]);
    const { runtime, progress } = opening(114_000, driver);
    const result = executor(kernel, runtime, 5_000).execute(request());
    const settled = vi.fn();
    void result.then(settled);

    await until(() => progress.opening);
    await vi.advanceTimersByTimeAsync(114_000);
    await until(() => state.entered === 1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(ledger).toEqual(["call-1: debit A"]);
    await vi.advanceTimersByTimeAsync(1_500);

    // 117 s. The handler was never signalled, so B is credited.
    expect(ledger).toEqual(["call-1: debit A", "call-1: credit B"]);
    // The turn is over without the clock ever reaching 120 s.
    await until(() => settled.mock.calls.length === 1);
    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      // The money moved. A host that ran the turn again would move it twice.
      error: { code: "turn_cancelled", retryable: false },
    });
    // The result is in the turn's events, and the seat was not asked about it.
    expect((await result).events.map(({ type }) => type)).toContain("tool.completed");
    expect(inputs).toEqual([{ type: "start" }]);
    // The operation's real outcome is in the trail, ahead of the turn's ending.
    expect(operation(trail, "call-1")).toMatchObject({ outcome: "succeeded" });
    expect(trail.at(-1)).toMatchObject({ type: "turn.ended", reason: "turn_cancelled" });
  });

  it("stops the same transfer half-way when no grace is set, as before", async () => {
    const { kernel, trail, ledger, state } = world(3_000);
    const { driver } = scripted([call("call-1")]);
    const { runtime, progress } = opening(118_000, driver);
    const result = executor(kernel, runtime).execute(request());

    await until(() => progress.opening);
    await vi.advanceTimersByTimeAsync(118_000);
    await until(() => state.entered === 1);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "turn_cancelled", retryable: false },
    });
    expect(ledger).toEqual(["call-1: debit A"]);
    await until(() => operation(trail, "call-1") !== undefined);
    expect(operation(trail, "call-1")).toMatchObject({
      outcome: "interrupted",
      reason: "operation_aborted",
    });
  });

  it("stops a handler that is still running at the deadline, and records it interrupted", async () => {
    // Entered at 100 s with 60 s of work, so it cannot finish inside the limit.
    const { kernel, trail, ledger, state } = world(60_000);
    const { driver } = scripted([call("call-1")]);
    const { runtime, progress } = opening(100_000, driver);
    const result = executor(kernel, runtime, 5_000).execute(request());

    await until(() => progress.opening);
    await vi.advanceTimersByTimeAsync(100_000);
    await until(() => state.entered === 1);
    await vi.advanceTimersByTimeAsync(19_999);
    // 119.999 s, well into the grace, and the handler has not been signalled.
    expect(operation(trail, "call-1")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "turn_cancelled", retryable: false },
    });
    // The grace is inside the limit: the turn ended at 120 s, and the handler
    // is recorded as stopped part-way when it sees the abort.
    await vi.advanceTimersByTimeAsync(60_000);
    await until(() => operation(trail, "call-1") !== undefined);
    expect(ledger).toEqual(["call-1: debit A"]);
    expect(operation(trail, "call-1")).toMatchObject({ outcome: "interrupted" });
  });

  it("refuses a call asked for once the turn is draining, records it, and asks the seat nothing more", async () => {
    const { kernel, trail, ledger } = world(10);
    let asked = 0;
    const runtime = createStandardRuntime({
      driver: {
        open: async () => ({
          // A decision already being made when the turn starts to drain.
          next: async () => {
            asked += 1;
            await sleep(116_000);
            return { type: "tool_call", call: call("call-late") };
          },
        }),
      },
    });
    const result = executor(kernel, runtime, 5_000).execute(request());

    await until(() => asked === 1);
    await vi.advanceTimersByTimeAsync(116_000);

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      // Nothing ran, so the turn may be tried again.
      error: { code: "turn_cancelled", retryable: true },
    });
    expect(ledger).toEqual([]);
    expect(asked).toBe(1);
    expect(operation(trail, "call-late")).toMatchObject({
      outcome: "denied",
      reason: "turn_draining",
      source: "envelope",
    });
  });

  it("ends cancelled, not on the step limit, when the late result was the last step", async () => {
    const { kernel, state } = world(3_000);
    const { driver, inputs } = scripted([call("call-1")]);
    const { runtime, progress } = opening(114_000, driver);
    const result = executor(kernel, runtime, 5_000).execute({
      ...request(),
      options: { timeoutMs: 120_000, maxSteps: 1 },
    });

    await until(() => progress.opening);
    await vi.advanceTimersByTimeAsync(114_000);
    await until(() => state.entered === 1);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "turn_cancelled", retryable: false },
    });
    expect(inputs).toEqual([{ type: "start" }]);
  });

  it("does not ask the seat for a first decision once the turn is draining", async () => {
    const { kernel } = world(10);
    const { driver, inputs } = scripted([call("call-1")]);
    // The session opens at 116 s, a second into the grace.
    const { runtime, progress } = opening(116_000, driver);
    const result = executor(kernel, runtime, 5_000).execute(request());

    await until(() => progress.opening);
    await vi.advanceTimersByTimeAsync(116_000);

    await expect(result).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "turn_cancelled", retryable: true },
    });
    expect(inputs).toEqual([]);
  });

  it("honours a decision already being made when it ends the turn", async () => {
    const { kernel } = world(10);
    let asked = 0;
    const runtime = createStandardRuntime({
      driver: {
        open: async () => ({
          next: async () => {
            asked += 1;
            await sleep(116_000);
            return { type: "complete", output: { answer: 42 } };
          },
        }),
      },
    });
    const result = executor(kernel, runtime, 5_000).execute(request());

    await until(() => asked === 1);
    await vi.advanceTimersByTimeAsync(116_000);

    await expect(result).resolves.toMatchObject({ status: "succeeded", output: { answer: 42 } });
  });

  it("stops at once on the host's own cancellation, grace or not", async () => {
    const { kernel, trail, ledger, state } = world(3_000);
    const { driver } = scripted([call("call-1")]);
    const controller = new AbortController();
    const result = executor(kernel, createStandardRuntime({ driver }), 5_000).execute(request(), {
      signal: controller.signal,
    });
    const settled = vi.fn();
    void result.then(settled);

    await until(() => state.entered === 1);
    controller.abort(new Error("the user pressed stop"));

    // No clock is moved: the turn is over without any of the grace passing.
    await until(() => settled.mock.calls.length === 1);
    await expect(result).resolves.toMatchObject({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(3_000);
    await until(() => operation(trail, "call-1") !== undefined);
    expect(ledger).toEqual(["call-1: debit A"]);
    expect(operation(trail, "call-1")).toMatchObject({ outcome: "interrupted" });
  });

  it("drains an audit outage too, so a sibling inside its handler answers", async () => {
    const { kernel, trail, ledger, state } = world(
      3_000,
      (event) => event.type === "authorization.checked" && event.operationId === "call-2",
    );
    let refused = false;
    const plugin: RuntimePlugin = {
      manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
      run: async (_input, host) => {
        const first = host.invokeTool(call("call-1"));
        void first.catch(() => undefined);
        await until(() => state.entered === 1);
        await host.invokeTool(call("call-2")).catch(() => {
          refused = true;
        });
        return { type: "complete", output: {} };
      },
    };
    const result = executor(kernel, plugin, 5_000).execute(request());

    await until(() => refused);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toMatchObject({
      status: "failed",
      error: { code: "audit_unavailable", retryable: false },
    });
    expect(ledger).toEqual(["call-1: debit A", "call-1: credit B"]);
    expect(operation(trail, "call-1")).toMatchObject({ outcome: "succeeded" });
    expect((await result).events.filter(({ type }) => type === "tool.completed")).toHaveLength(1);
  });

  describe("a sibling call that meets the outage after its turn has closed", () => {
    // The call is with the kernel, waiting on a sink that has not answered its
    // decision, when the turn ends. The sink then fails. That is the first
    // outage the envelope hears of, so it asks the turn to drain, and the turn
    // it asks has already closed and disposed of its timers.
    it("changes nothing on a turn that had completed, and arms nothing", async () => {
      const { kernel, ledger, state, failHeld } = world(0, () => false, "call-1");
      const late = vi.fn();
      const plugin: RuntimePlugin = {
        manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
        run: async (_input, host) => {
          // Left behind by a plugin that answers without waiting for it.
          host.invokeTool(call("call-1")).catch(late);
          await until(() => state.held);
          return { type: "complete", output: { done: true } };
        },
      };

      const result = await executor(kernel, plugin, 5_000).execute(request());
      expect(result).toMatchObject({ status: "succeeded", output: { done: true } });
      expect(vi.getTimerCount()).toBe(0);
      const before = structuredClone(result);

      // The plugin's own promise was let go when the turn closed. The kernel's
      // is still out there, and this is what it now rejects with.
      expect(late).toHaveBeenCalledOnce();
      failHeld();
      await realPause();
      // Counted before the clock moves: a timer armed by the late drain would
      // fire and be gone once it did.
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(600_000);

      expect(vi.getTimerCount()).toBe(0);
      expect(result).toEqual(before);
      // The decision was never recorded, so nothing ran, then or afterwards.
      expect(ledger).toEqual([]);
    });

    it("changes nothing on a turn that ended on its deadline, and arms nothing", async () => {
      const { kernel, ledger, state, failHeld } = world(0, () => false, "call-1");
      const late = vi.fn();
      const plugin: RuntimePlugin = {
        manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
        run: async (_input, host) => {
          await host.invokeTool(call("call-1")).catch((error: unknown) => {
            late(error);
            throw error;
          });
          return { type: "complete", output: {} };
        },
      };
      const turn = executor(kernel, plugin, 5_000).execute(request());

      await until(() => state.held);
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await turn;

      expect(result).toMatchObject({
        status: "cancelled",
        // Still with the kernel when the turn ended, so nobody can say it did
        // nothing, and the ending is the deadline's, not an outage's.
        error: { code: "turn_cancelled", retryable: false },
      });
      expect(vi.getTimerCount()).toBe(0);
      const before = structuredClone(result);

      failHeld();
      await realPause();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(600_000);

      expect(vi.getTimerCount()).toBe(0);
      expect(result).toEqual(before);
      expect(ledger).toEqual([]);
    });
  });

  it("leaves no timer running once the turn is over, however it ended", async () => {
    // Completed well inside the limit: the soft and hard deadlines are both
    // still armed when the turn closes.
    const completed = world(0);
    await executor(
      completed.kernel,
      createStandardRuntime({ driver: scripted([call("call-1")]).driver }),
      5_000,
    ).execute(request());
    expect(vi.getTimerCount()).toBe(0);

    // Ended on an audit outage, which arms the stop that follows the grace.
    const outage = world(
      0,
      (event) => event.type === "authorization.checked" && event.operationId === "call-1",
    );
    const result = await executor(
      outage.kernel,
      createStandardRuntime({ driver: scripted([call("call-1")]).driver }),
      5_000,
    ).execute(request());
    expect(result).toMatchObject({ status: "failed", error: { code: "audit_unavailable" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])("rejects a grace of %s", (drainGraceMs) => {
    const { kernel } = world(0);
    expect(() =>
      executor(kernel, createStandardRuntime({ driver: scripted([]).driver }), drainGraceMs),
    ).toThrow("drainGraceMs must be a non-negative integer");
  });
});

describe("retryable says whether running the turn again repeats anything", () => {
  /** A turn that makes one call, then stalls past its deadline. */
  async function timedOutAfter(definition: ToolDefinition) {
    const { kernel } = world(0);
    let stalled = false;
    const plugin: RuntimePlugin = {
      manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
      run: async (_input, host) => {
        await host.invokeTool(call("call-1", definition));
        stalled = true;
        await sleep(600_000);
        return { type: "complete", output: {} };
      },
    };
    const result = executor(kernel, plugin).execute(request());
    await until(() => stalled);
    await vi.advanceTimersByTimeAsync(120_000);
    return result;
  }

  it("keeps a timed-out turn retryable when all it did was read", async () => {
    await expect(timedOutAfter(lookup)).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "turn_cancelled", retryable: true },
    });
  });

  it("keeps it retryable after a write its definition declares idempotent", async () => {
    await expect(timedOutAfter(setMemo)).resolves.toMatchObject({
      error: { code: "turn_cancelled", retryable: true },
    });
  });

  it("refuses the retry after a write that is not", async () => {
    await expect(timedOutAfter(transferFunds)).resolves.toMatchObject({
      error: { code: "turn_cancelled", retryable: false },
    });
  });

  it("refuses it while a read is fine and a write is still with the kernel", async () => {
    const { kernel, state } = world(600_000);
    const plugin: RuntimePlugin = {
      manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
      run: async (_input, host) => {
        await host.invokeTool(call("call-1"));
        return { type: "complete", output: {} };
      },
    };
    const result = executor(kernel, plugin).execute(request());
    await until(() => state.entered === 1);
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(result).resolves.toMatchObject({
      error: { code: "turn_cancelled", retryable: false },
    });
  });

  it.each([
    [transferFunds, false],
    [lookup, true],
  ] as const)(
    "applies the same rule when the plugin throws after %o",
    async (definition, retryable) => {
      const { kernel } = world(0);
      const plugin: RuntimePlugin = {
        manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
        run: async (_input, host) => {
          await host.invokeTool(call("call-1", definition));
          throw new Error("the plugin broke on something unrelated");
        },
      };

      await expect(executor(kernel, plugin).execute(request())).resolves.toMatchObject({
        status: "failed",
        error: { code: "runtime_failed", retryable },
      });
    },
  );

  it.each([
    [transferFunds, false],
    [lookup, true],
  ] as const)(
    "lets a plugin's own retryable stand only where nothing would repeat, after %o",
    async (definition, retryable) => {
      const { kernel } = world(0);
      const plugin: RuntimePlugin = {
        manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
        run: async (_input, host) => {
          await host.invokeTool(call("call-1", definition));
          // What the harness adapters state on any harness failure.
          return {
            type: "fail",
            error: { code: "harness_failed", message: "The harness crashed.", retryable: true },
          };
        },
      };

      await expect(executor(kernel, plugin).execute(request())).resolves.toMatchObject({
        status: "failed",
        error: { code: "harness_failed", retryable },
      });
    },
  );

  it("never turns a plugin's false into true", async () => {
    const { kernel } = world(10);
    const plugin: RuntimePlugin = {
      manifest: { id: "test.runtime", version: "1.0.0", protocolVersion: "1" },
      run: async () => ({
        type: "fail",
        error: { code: "harness_failed", message: "The harness crashed.", retryable: false },
      }),
    };

    await expect(executor(kernel, plugin).execute(request())).resolves.toMatchObject({
      error: { code: "harness_failed", retryable: false },
    });
  });
});
