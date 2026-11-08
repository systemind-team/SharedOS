# @aicoo/sharedos-runtime

A fixed permission envelope with standard and replaceable one-turn agent
runtimes.

```bash
npm install @aicoo/sharedos-runtime
```

SharedOS is runtime-agnostic, not runtime-less. The package exports two layers:

- `SharedOSExecutor` validates and admits a turn, exposes only authorized tools,
  rechecks every exact call, applies cancellation, and records runtime
  provenance. Runtime plugins cannot replace this layer.
- `RuntimePlugin` owns the agent loop inside that envelope. `createStandardRuntime` is
  the included one: the standard loop, with one `AgentTurnDriver` seated.

## Standard runtime

```ts
import { SharedOSExecutor, createStandardRuntime } from "@aicoo/sharedos-runtime";

const runtime = createStandardRuntime({ driver: agentDriver });
const turns = new SharedOSExecutor(kernel, runtime, {
  defaultMaxSteps: 16,
  defaultMaxToolCalls: 16,
  defaultTimeoutMs: 120_000,
});

const result = await turns.execute(executionRequest);
```

The limits above are the host's choice. Each is unset unless the host sets it,
and an unset limit is no limit: SharedOS sets no step, tool-call or time limit
of its own.

## Escalation

A turn may end by asking a human to decide (ADR 0011, ADR 0017). The ask is a
catalogued tool, `sharedos.escalate`, so that it is chosen rather than inferred
from prose, and so that it is permission-filtered like every other tool:

```ts
import { createEscalationTool } from "@aicoo/sharedos-runtime";

kernel.registerTool(createEscalationTool());
```

An agent sees it only when its context enables the `sharedos` tool namespace
and it holds a grant over resource `sharedos` / `["escalation"]`, action
`request` — exported as `ESCALATION_TOOL_NAMESPACE`, `ESCALATION_RESOURCE_PATH`,
and `ESCALATION_ACTION`. A host that issues no such grant has agents that cannot
escalate, which is the intended arrangement.

The tool is never executed. A driver whose turn's catalogue offers it
recognises the name with `escalationRequest(tool, arguments)` and returns
`{ type: "escalate", reason }` instead of a tool call; the standard loop settles
the turn as `escalated`, the envelope records `escalation.requested`, and
nothing is granted while the ask is pending. Without the grant the name is
passed through and refused `tool_unavailable`, and `SharedOSExecutor` refuses an
`escalate` outcome from any plugin on such a turn — the catalogue gates the
name, not the driver's goodwill. The registered handler exists to put the tool in the catalogue and to
fail — `escalation_not_terminated` — if a driver forwards the call anyway. Over
MCP the bridge answers the ask itself and refuses later calls on that turn with
`escalation_pending` (ADR 0018).

## Custom runtime

```ts
import type { RuntimePlugin } from "@aicoo/sharedos-runtime";

const codexRuntime: RuntimePlugin = {
  manifest: {
    id: "acme.codex",
    version: "1.0.0",
    protocolVersion: "1",
    metadata: { harness: "codex", backend: "vercel-sandbox" },
  },
  async run(request, host, signal) {
    // Translate the harness's native tool definitions to request.tools.
    // Every implementation must route actual effects through this broker.
    const result = await host.invokeTool({
      id: crypto.randomUUID(),
      tool: "files.search",
      arguments: { path: ["Projects"], query: "status" },
      traceId: request.context.traceId,
      requestedAt: request.context.now,
    });

    signal.throwIfAborted();
    return { type: "complete", output: { toolStatus: result.status } };
  },
};

const turns = new SharedOSExecutor(kernel, codexRuntime);
```

Embedded hosts can observe events as they are emitted without giving the plugin
an authoritative event channel:

```ts
await turns.execute(executionRequest, {
  signal,
  onEvent: (event) => streamController.enqueue(event),
});
```

The callback receives a frozen snapshot. Callback failure does not replace the
turn's protocol outcome; cancel the supplied signal when the consumer closes.

A plugin receives a frozen `RuntimeTurnRequest` without grants, issuing
authority, or namespace-management state. Its `RuntimeHost` contains only:

- effective step, tool-call, and deadline limits;
- `invokeTool`, which checks the visible catalog and then re-authorizes through
  the kernel;
- `emit`, which records plugin observations as wrapped `runtime.event` events.
- `annotate`, which states one fact about the turn for its record. The envelope
  writes it into the result's metadata on every ending, a cancelled turn
  included, and it never refuses on the state of the host (ADR 0007).

The broker closes when `run` returns. A plugin cannot use a retained host handle
for later tool calls or emit authoritative `turn.*` and `tool.*` events.

## Trusted selection

`RuntimeRegistry` is an instance-scoped registry for trusted boot
configuration:

```ts
const runtimes = new RuntimeRegistry([
  createStandardRuntime({ driver: agentDriver }),
  codexRuntime,
]);
const runtime = runtimes.resolve(serverPolicy.runtimeId);
const turns = new SharedOSExecutor(kernel, runtime);
```

Do not resolve a runtime id directly from a message, model output, or unverified
request metadata. In-process plugins have the ambient privileges of the host;
isolate third-party runtimes behind a process, container, microVM, or remote
adapter.

Product heartbeats, multi-turn retries, adaptive routing, benchmark scheduling,
and network-level stopping remain host responsibilities.

SharedOS is currently a `1.0.0` preview.
