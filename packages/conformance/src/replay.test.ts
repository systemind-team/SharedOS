import { createFileTools } from "@aicoo/sharedos-os";
import { createKernelSharedOSApi, createSharedOSHandler } from "@aicoo/sharedos-http";
import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  SHAREDOS_ROUTES,
  type ExecutionRequest,
  type MessageEnvelope,
  type ResourceResult,
  type ToolCall,
  type ToolDefinition,
} from "@aicoo/sharedos-contracts";
import {
  CapabilityAuthorizer,
  InMemoryGrantUsageStore,
  ReplayProtection,
  ResourceProviderRegistry,
  SharedOSKernel,
  ToolRegistry,
  canonicalReplayJson,
  type ReplayStore,
} from "@aicoo/sharedos-core";
import { SharedOSExecutor, STANDARD_RUNTIME_MANIFEST } from "@aicoo/sharedos-runtime";
import {
  InMemoryGrantSource,
  InMemoryMessageTransport,
  InMemoryMessageRequestRouter,
  InMemoryReplayStore,
  createTestContext,
  createTestGrant,
} from "@aicoo/sharedos-testkit";

const context = createTestContext({ enabledToolNamespaces: ["files", "messages"] });
const request = {
  operationId: "op-1",
  resource: { namespace: "files", path: ["note"] },
  action: "write",
  input: { b: 2, a: 1 },
};
const definition: ToolDefinition = {
  name: "files.write",
  description: "Write",
  namespace: "files",
  source: "sharedos",
  readWrite: "write",
  inputSchema: { type: "object" },
  requiredCapability: { resource: { namespace: "files", path: [] }, action: "write" },
};
const call: ToolCall = {
  id: "call-1",
  tool: definition.name,
  arguments: { a: 1 },
  traceId: context.traceId,
  requestedAt: context.now,
};
const envelope: MessageEnvelope = {
  version: PROTOCOL_VERSION,
  id: "msg-1",
  sender: context.actor,
  receiver: { kind: "agent", agentId: "recipient" },
  purpose: context.purpose,
  traceId: context.traceId,
  payload: { a: 1 },
  createdAt: context.now,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  store: ReplayStore | undefined = new InMemoryReplayStore(),
  invoke?: (id: string, signal: AbortSignal) => Promise<ResourceResult>,
  maxUses?: number,
) {
  let effects = 0;
  const resources = new ResourceProviderRegistry();
  resources.register({
    namespace: "files",
    invoke: async (op, signal) => {
      effects++;
      if (invoke) return invoke(op.operationId, signal);
      return {
        operationId: op.operationId,
        completedAt: op.context.now,
        status: "succeeded",
        output: { effects },
      };
    },
  });
  const tools = new ToolRegistry();
  const toolInvoke = vi.fn(async (_context, checked) => ({
    callId: checked.id,
    tool: checked.tool,
    completedAt: context.now,
    status: "succeeded" as const,
    output: { a: 1 },
  }));
  tools.register({ definition, parseArguments: (args) => args, invoke: toolInvoke });
  const grants = new InMemoryGrantSource(
    ["namespace-1", "namespace-2"].map((namespaceId) =>
      createTestGrant({
        namespaceId,
        ...(maxUses === undefined ? {} : { maxUses }),
        capabilities: ["files", "sharedos.messaging", "sharedos.execution"].map((namespace) => ({
          resource: { namespace, path: [] },
          actions: ["write", "create", "send", "invoke"],
          scope: "descendants",
        })),
      }),
    ),
  );
  const transport = new InMemoryMessageTransport();
  const kernel = new SharedOSKernel({
    grantSource: grants,
    resources,
    tools,
    messageTransport: transport,
    messageRequestRouter: new InMemoryMessageRequestRouter(transport),
    authorizer: new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() }),
    ...(store === undefined ? {} : { replayStore: store }),
  });
  return { kernel, store, transport, toolInvoke, effects: () => effects, resources, grants };
}

function execution(): ExecutionRequest {
  return {
    version: PROTOCOL_VERSION,
    executionId: "execution-1",
    agent: { kind: "agent", agentId: "agent-1" },
    context,
    message: { ...envelope, receiver: context.actor },
    tools: [definition],
  };
}

function executor(
  kernel: SharedOSKernel,
  run = vi.fn(async () => ({ type: "complete" as const, output: { a: 1 } })),
) {
  return {
    turns: new SharedOSExecutor(
      kernel,
      { manifest: STANDARD_RUNTIME_MANIFEST, run },
      { clock: () => context.now },
    ),
    run,
  };
}

function expectCode(
  result: { status: string; error?: { code: string } | undefined },
  code: string,
) {
  expect(result.error?.code).toBe(code);
}

describe("durable replay gates", () => {
  it("reproduces the resource probe in the legacy unprotected path", async () => {
    const f = fixture();
    const legacy = new SharedOSKernel({ grantSource: f.grants, resources: f.resources });
    await legacy.invokeResource(context, request);
    await legacy.invokeResource(context, request);
    expect(f.effects()).toBe(2);
  });

  it("replays the exact resource result without consuming a bounded grant twice", async () => {
    const f = fixture(new InMemoryReplayStore(), undefined, 1);
    const first = await f.kernel.invokeResource(context, request);
    expect(first.status).toBe("succeeded");
    expect(
      await f.kernel.invokeResource(
        { ...context, now: "2026-01-01T00:00:01.000Z" },
        {
          ...request,
          input: { a: 1, b: 2 },
          resource: { ...request.resource, owner: context.owner },
        },
      ),
    ).toEqual(first);
    expect(f.effects()).toBe(1);
    expectCode(
      await f.kernel.invokeResource(context, { ...request, operationId: "op-2" }),
      "grant_exhausted",
    );
  });

  it("arbitrates concurrent duplicates across kernel instances", async () => {
    const started = deferred<void>();
    const release = deferred<ResourceResult>();
    const store = new InMemoryReplayStore();
    const invoke = async () => {
      started.resolve();
      return release.promise;
    };
    const a = fixture(store, invoke),
      b = fixture(store, invoke);
    const owner = a.kernel.invokeResource(context, request);
    await started.promise;
    const duplicates = await Promise.all(
      Array.from({ length: 8 }, () => b.kernel.invokeResource(context, request)),
    );
    duplicates.forEach((result) => expectCode(result, "replay_pending"));
    expect(a.effects() + b.effects()).toBe(1);
    release.resolve({
      operationId: request.operationId,
      status: "succeeded",
      completedAt: context.now,
      output: "receipt",
    });
    const result = await owner;
    expect(await b.kernel.invokeResource(context, request)).toEqual(result);
  });

  it("rejects changed input, target, actor, purpose and trace before any second effect", async () => {
    const f = fixture();
    await f.kernel.invokeResource(context, request);
    expectCode(
      await f.kernel.invokeResource(context, { ...request, input: { a: 2 } }),
      "replay_conflict",
    );
    expectCode(
      await f.kernel.invokeResource(context, {
        ...request,
        resource: { ...request.resource, path: ["other"] },
      }),
      "replay_conflict",
    );
    for (const change of [
      { actor: envelope.receiver },
      { purpose: "other" },
      { traceId: "other" },
    ]) {
      expectCode(
        await f.kernel.invokeResource({ ...context, ...change }, request),
        "replay_conflict",
      );
    }
    expect(f.effects()).toBe(1);
  });

  it("isolates identical IDs in different tenants", async () => {
    const f = fixture();
    await f.kernel.invokeResource(context, request);
    await f.kernel.invokeResource({ ...context, namespaceId: "namespace-2" }, request);
    expect(f.effects()).toBe(2);
  });

  it("fails closed on a claim outage", async () => {
    const f = fixture({
      claim: async () => {
        throw new Error("offline");
      },
      settle: async () => true,
    });
    expectCode(await f.kernel.invokeResource(context, request), "replay_unavailable");
    expect(f.effects()).toBe(0);
  });

  it("leaves a blocked claim after an outcome persistence outage", async () => {
    const durable = new InMemoryReplayStore();
    const f = fixture({
      claim: (key, fp) => durable.claim(key, fp),
      settle: async () => {
        throw new Error("offline");
      },
    });
    expectCode(await f.kernel.invokeResource(context, request), "replay_unavailable");
    expectCode(await f.kernel.invokeResource(context, request), "replay_pending");
    expect(f.effects()).toBe(1);
  });

  it("retains failed and denied results instead of trying providers again", async () => {
    const f = fixture(new InMemoryReplayStore(), async () => {
      throw new Error("effect may have committed");
    });
    const first = await f.kernel.invokeResource(context, request);
    expect(first.status).toBe("failed");
    expect(await f.kernel.invokeResource(context, request)).toEqual(first);
    expect(f.effects()).toBe(1);
    const denied = await f.kernel.invokeResource(context, {
      ...request,
      operationId: "denied",
      action: "delete",
    });
    expect(denied.status).toBe("denied");
    expect(
      await f.kernel.invokeResource(context, {
        ...request,
        operationId: "denied",
        action: "delete",
      }),
    ).toEqual(denied);
  });

  it("cancels an owned effect and fences its late result", async () => {
    const started = deferred<void>(),
      release = deferred<ResourceResult>();
    const f = fixture(new InMemoryReplayStore(), async () => {
      started.resolve();
      return release.promise;
    });
    const controller = new AbortController();
    const pending = f.kernel.invokeResource(context, request, { signal: controller.signal });
    const rejection = expect(pending).rejects.toThrow();
    await started.promise;
    controller.abort(new Error("cancelled"));
    await rejection;
    expectCode(await f.kernel.invokeResource(context, request), "replay_interrupted");
    release.resolve({
      operationId: request.operationId,
      completedAt: context.now,
      status: "succeeded",
      output: "late",
    });
    await Promise.resolve();
    expectCode(await f.kernel.invokeResource(context, request), "replay_interrupted");
    expect(f.effects()).toBe(1);
  });

  it("settles a claim that committed after its caller cancelled without dispatching", async () => {
    const durable = new InMemoryReplayStore(),
      committed = deferred<void>(),
      release = deferred<void>();
    let delay = true;
    const store: ReplayStore = {
      claim: async (key, fingerprint) => {
        const record = await durable.claim(key, fingerprint);
        if (delay) {
          committed.resolve();
          await release.promise;
          delay = false;
        }
        return record;
      },
      settle: (key, token, outcome) => durable.settle(key, token, outcome),
    };
    const f = fixture(store),
      controller = new AbortController();
    const pending = f.kernel.invokeResource(context, request, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await committed.promise;
    controller.abort(new Error("cancelled"));
    release.resolve();
    await rejected;
    expectCode(await f.kernel.invokeResource(context, request), "replay_interrupted");
    expect(f.effects()).toBe(0);
  });

  it("does not claim cancellation before dispatch", async () => {
    const f = fixture();
    await expect(
      f.kernel.invokeResource(context, request, { signal: AbortSignal.abort(new Error("stop")) }),
    ).rejects.toThrow("stop");
    expect((await f.kernel.invokeResource(context, request)).status).toBe("succeeded");
    expect(f.effects()).toBe(1);
  });

  it("never re-executes after result-body expiration", async () => {
    const store = new InMemoryReplayStore(),
      f = fixture(store);
    await f.kernel.invokeResource(context, request);
    expect(
      store.expire({
        namespaceId: context.namespaceId,
        kind: "resource",
        scope: "",
        id: request.operationId,
      }),
    ).toBe(true);
    expectCode(await f.kernel.invokeResource(context, request), "replay_expired");
    expect(f.effects()).toBe(1);
  });

  it("scopes tool calls to executions and rejects conflicting arguments", async () => {
    const f = fixture();
    const first = await f.kernel.invokeTool(context, call, { executionId: "turn-1" });
    expect(first.status).toBe("succeeded");
    expect(await f.kernel.invokeTool(context, call, { executionId: "turn-1" })).toEqual(first);
    expectCode(
      await f.kernel.invokeTool(
        context,
        { ...call, arguments: { a: 2 } },
        { executionId: "turn-1" },
      ),
      "replay_conflict",
    );
    expect((await f.kernel.invokeTool(context, call, { executionId: "turn-2" })).status).toBe(
      "succeeded",
    );
    expect(f.toolInvoke).toHaveBeenCalledTimes(2);
  });

  it("uses the trusted context execution identity for tool replay", async () => {
    const f = fixture();
    const one = { ...context, executionId: "one" },
      two = { ...context, executionId: "two" };
    const first = await f.kernel.invokeTool(one, call);
    expect(first.status).toBe("succeeded");
    expect(await f.kernel.invokeTool(one, call, { executionId: "ignored-option" })).toEqual(first);
    expect((await f.kernel.invokeTool(two, call)).status).toBe("succeeded");
    expect(f.toolInvoke).toHaveBeenCalledTimes(2);
  });

  it("arbitrates concurrent tool-call duplicates", async () => {
    const f = fixture(),
      start = deferred<void>(),
      release = deferred<void>();
    f.toolInvoke.mockImplementation(async (_context, checked) => {
      start.resolve();
      await release.promise;
      return {
        callId: checked.id,
        tool: checked.tool,
        completedAt: context.now,
        status: "succeeded",
        output: { a: 1 },
      };
    });
    const owner = f.kernel.invokeTool(context, call);
    await start.promise;
    expectCode(await f.kernel.invokeTool(context, call), "replay_pending");
    release.resolve();
    const first = await owner;
    expect(await f.kernel.invokeTool(context, call)).toEqual(first);
    expect(f.toolInvoke).toHaveBeenCalledTimes(1);
  });

  it("arbitrates concurrent message sends", async () => {
    const f = fixture(),
      start = deferred<void>(),
      release = deferred<void>();
    const deliver = vi
      .spyOn(f.transport, "deliver")
      .mockImplementation(async (_context, checked) => {
        start.resolve();
        await release.promise;
        return { messageId: checked.id, timestamp: context.now, status: "accepted" };
      });
    const owner = f.kernel.sendMessage(context, envelope);
    await start.promise;
    expectCode(await f.kernel.sendMessage(context, envelope), "replay_pending");
    release.resolve();
    const first = await owner;
    expect(await f.kernel.sendMessage(context, envelope)).toEqual(first);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("derives globally distinct provider operation IDs for nested resource effects", async () => {
    const seen: string[] = [],
      resources = new ResourceProviderRegistry(),
      tools = new ToolRegistry();
    const provider = {
      namespace: "files",
      invoke: async (op: import("@aicoo/sharedos-contracts").ResourceOperation) => {
        seen.push(op.operationId);
        return {
          operationId: op.operationId,
          completedAt: context.now,
          status: "succeeded" as const,
          output: "receipt",
        };
      },
    };
    resources.register(provider);
    createFileTools(provider).forEach((handler) => tools.register(handler));
    const f = fixture();
    const kernel = new SharedOSKernel({
      grantSource: f.grants,
      tools,
      resources,
      replayStore: new InMemoryReplayStore(),
    });
    const nested = {
      ...call,
      tool: "files.create",
      arguments: { path: ["note"], content: "value" },
    };
    const first = await kernel.invokeTool(context, nested, { executionId: "one" });
    expect(first.status).toBe("succeeded");
    expect(await kernel.invokeTool(context, nested, { executionId: "one" })).toEqual(first);
    expect((await kernel.invokeTool(context, nested, { executionId: "two" })).status).toBe(
      "succeeded",
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toMatch(/^resource-[a-f0-9]{64}$/u);
  });

  it("replays direct message receipts and rejects changed payloads", async () => {
    const f = fixture();
    const first = await f.kernel.sendMessage(context, envelope);
    expect(first.status).toBe("accepted");
    expect(await f.kernel.sendMessage(context, envelope)).toEqual(first);
    expectCode(
      await f.kernel.sendMessage(context, { ...envelope, payload: { a: 2 } }),
      "replay_conflict",
    );
    expect(f.transport.deliveries).toHaveLength(1);
  });

  it("replays the enclosing message tool reply without redelivery", async () => {
    const f = fixture();
    const messageCall = {
      ...call,
      tool: "messages.request",
      arguments: { recipient: envelope.receiver, payload: envelope.payload },
    };
    const first = await f.kernel.invokeTool(context, messageCall);
    expect(first.status).toBe("succeeded");
    expect(await f.kernel.invokeTool(context, messageCall)).toEqual(first);
    expect(f.transport.deliveries).toHaveLength(1);
    const delivered = f.transport.deliveries[0]!.envelope;
    expect(await f.kernel.sendMessage(context, delivered)).toMatchObject({ status: "accepted" });
    expect(f.transport.deliveries).toHaveLength(1);
  });

  it("replays execution results and events without running or streaming again", async () => {
    const f = fixture(),
      e = executor(f.kernel),
      observed = vi.fn();
    const first = await e.turns.execute(execution());
    expect(first.status).toBe("succeeded");
    expect(await e.turns.execute(execution(), { onEvent: observed })).toEqual(first);
    expect(e.run).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();
    expectCode(
      await e.turns.execute({ ...execution(), state: { changed: true } }),
      "replay_conflict",
    );
  });

  it("normalizes incoming context execution IDs before claiming a turn", async () => {
    const f = fixture(),
      e = executor(f.kernel);
    const first = await e.turns.execute({
      ...execution(),
      context: { ...context, executionId: "incoming-one" },
    });
    expect(first.status).toBe("succeeded");
    expect(
      await e.turns.execute({
        ...execution(),
        context: { ...context, executionId: "incoming-two" },
      }),
    ).toEqual(first);
    expect(e.run).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent execution IDs before opening a second runtime", async () => {
    const f = fixture(),
      start = deferred<void>(),
      release = deferred<void>();
    const e = executor(
      f.kernel,
      vi.fn(async () => {
        start.resolve();
        await release.promise;
        return { type: "complete", output: { a: 1 } };
      }),
    );
    const owner = e.turns.execute(execution());
    await start.promise;
    expectCode(await executor(f.kernel).turns.execute(execution()), "replay_pending");
    release.resolve();
    await owner;
    expect(e.run).toHaveBeenCalledTimes(1);
  });

  it("keeps crash leftovers blocked and permits fenced recovery to interrupted", async () => {
    const store = new InMemoryReplayStore();
    const gate = new ReplayProtection(store),
      key = { namespaceId: context.namespaceId, kind: "resource" as const, scope: "", id: "crash" };
    const { sha256Hex } = await import("@aicoo/sharedos-core");
    const fingerprint = await sha256Hex(canonicalReplayJson({ a: 1 }));
    const claim = await store.claim(key, fingerprint);
    await expect(
      gate.run(
        key,
        { a: 1 },
        async () => "effect",
        (value) => value,
      ),
    ).rejects.toMatchObject({ code: "replay_pending" });
    expect(await store.settle(key, "wrong", { state: "interrupted" })).toBe(false);
    expect(await store.settle(key, claim.record.token, { state: "interrupted" })).toBe(true);
    expect(
      await store.settle(key, claim.record.token, { state: "completed", result: "late" }),
    ).toBe(false);
    await expect(
      gate.run(
        key,
        { a: 1 },
        async () => "effect",
        (value) => value,
      ),
    ).rejects.toMatchObject({ code: "replay_interrupted" });
  });

  it("enforces replay through the authenticated HTTP resource route", async () => {
    const f = fixture(),
      e = executor(f.kernel);
    const handler = createSharedOSHandler({
      api: createKernelSharedOSApi({ kernel: f.kernel, turns: e.turns }),
      resolveContext: async () => context,
    });
    const submit = async (body: unknown) => {
      const response = await handler(
        new Request(`http://sharedos.test${SHAREDOS_ROUTES.invokeResource.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const first = await submit(request);
    expect(first.status).toBe("succeeded");
    expect(await submit(request)).toEqual(first);
    expectCode(await submit({ ...request, input: "changed" }), "replay_conflict");
    expect(f.effects()).toBe(1);
  });

  it("rejects malformed store records and mismatched stored results", async () => {
    const real = new InMemoryReplayStore();
    const broken: ReplayStore = {
      claim: async (key, fp) => {
        const claimed = await real.claim(key, fp);
        return { ...claimed, record: { ...claimed.record, key: { ...key, namespaceId: "wrong" } } };
      },
      settle: async () => true,
    };
    const f = fixture(broken);
    expectCode(await f.kernel.invokeResource(context, request), "replay_unavailable");
    expect(f.effects()).toBe(0);
    const wrongResult: ReplayStore = {
      claim: async (key, fp) => ({
        claimed: false,
        record: {
          key,
          fingerprint: fp,
          token: "token",
          state: "completed",
          result: {
            operationId: "wrong",
            status: "succeeded",
            output: "secret",
            completedAt: context.now,
          },
        },
      }),
      settle: async () => true,
    };
    expectCode(
      await fixture(wrongResult).kernel.invokeResource(context, request),
      "replay_unavailable",
    );
  });

  it("retains a cancelled execution and blocks reopening its runtime", async () => {
    const f = fixture(),
      start = deferred<void>(),
      controller = new AbortController();
    const run = vi.fn(async () => {
      start.resolve();
      await new Promise(() => undefined);
      return { type: "complete" as const, output: { a: 1 } };
    });
    const e = executor(f.kernel, run);
    const pending = e.turns.execute(execution(), { signal: controller.signal });
    await start.promise;
    controller.abort(new Error("stop"));
    const first = await pending;
    expect(first.status).toBe("cancelled");
    expect(await e.turns.execute(execution())).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("assigns distinct nested message identities to calls in separate executions", async () => {
    const f = fixture();
    const messageCall = {
      ...call,
      tool: "messages.request",
      arguments: { recipient: envelope.receiver, payload: envelope.payload },
    };
    expect((await f.kernel.invokeTool(context, messageCall, { executionId: "one" })).status).toBe(
      "succeeded",
    );
    expect((await f.kernel.invokeTool(context, messageCall, { executionId: "two" })).status).toBe(
      "succeeded",
    );
    expect(f.transport.deliveries).toHaveLength(2);
    expect(f.transport.deliveries[0]!.envelope.id).not.toBe(f.transport.deliveries[1]!.envelope.id);
  });

  it("has canonical JSON independent of key insertion order and rejects unsafe numbers", () => {
    expect(canonicalReplayJson({ z: 1, A: [null, true], a: "text" })).toBe(
      canonicalReplayJson({ a: "text", A: [null, true], z: 1 }),
    );
    expect(canonicalReplayJson({ z: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"z":1}');
    expect(() => canonicalReplayJson({ number: Infinity })).toThrow();
    expect(() => canonicalReplayJson([undefined])).toThrow();
    expect(() => canonicalReplayJson(new Array(1))).toThrow();
  });

  it("isolates test adapter instances and returned result mutation", async () => {
    const a = fixture(),
      b = fixture();
    const first = await a.kernel.invokeResource(context, request);
    if (first.status === "succeeded") first.output = "mutated";
    expect(await a.kernel.invokeResource(context, request)).toMatchObject({
      output: { effects: 1 },
    });
    expect((await b.kernel.invokeResource(context, request)).status).toBe("succeeded");
    expect(b.effects()).toBe(1);
  });
});
