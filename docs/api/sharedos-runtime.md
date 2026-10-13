[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-runtime

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
import {
  SharedOSExecutor,
  createStandardRuntime,
} from "@aicoo/sharedos-runtime";

const runtime = createStandardRuntime({ driver: agentDriver });
const turns = new SharedOSExecutor(kernel, runtime, {
  defaultMaxSteps: 16,
  defaultMaxToolCalls: 16,
  defaultTimeoutMs: 120_000,
});

const result = await turns.execute(executionRequest);
```

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

## Classes

### RuntimeNotFoundError

Defined in: [packages/runtime/src/runtime-plugin.ts:209](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L209)

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new RuntimeNotFoundError**(`runtimeId`): [`RuntimeNotFoundError`](#runtimenotfounderror)

Defined in: [packages/runtime/src/runtime-plugin.ts:210](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L210)

###### Parameters

| Parameter   | Type     |
| ----------- | -------- |
| `runtimeId` | `string` |

###### Returns

[`RuntimeNotFoundError`](#runtimenotfounderror)

###### Overrides

`Error.constructor`

#### Properties

| Property                                                | Modifier | Type      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       | Inherited from          | Defined in                                                                                 |
| ------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| <a id="property-cause"></a> `cause?`                    | `public` | `unknown` | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.cause`           | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es2022.error.d.ts:26 |
| <a id="property-message"></a> `message`                 | `public` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.message`         | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1077        |
| <a id="property-name"></a> `name`                       | `public` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.name`            | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1076        |
| <a id="property-stack"></a> `stack?`                    | `public` | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.stack`           | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1078        |
| <a id="property-stacktracelimit"></a> `stackTraceLimit` | `static` | `number`  | The `Error.stackTraceLimit` property specifies the number of stack frames collected by a stack trace (whether generated by `new Error().stack` or `Error.captureStackTrace(obj)`). The default value is `10` but may be set to any valid JavaScript number. Changes will affect any stack trace captured _after_ the value has been changed. If set to a non-number value, or set to a negative number, stack traces will not capture any frames. | `Error.stackTraceLimit` | node\_modules/.pnpm/@types+node@22.20.1/node\_modules/@types/node/globals.d.ts:68          |

#### Methods

##### captureStackTrace()

> `static` **captureStackTrace**(`targetObject`, `constructorOpt?`): `void`

Defined in: node\_modules/.pnpm/@types+node@22.20.1/node\_modules/@types/node/globals.d.ts:52

Creates a `.stack` property on `targetObject`, which when accessed returns
a string representing the location in the code at which
`Error.captureStackTrace()` was called.

```js
const myObject = {};
Error.captureStackTrace(myObject);
myObject.stack; // Similar to `new Error().stack`
```

The first line of the trace will be prefixed with
`${myObject.name}: ${myObject.message}`.

The optional `constructorOpt` argument accepts a function. If given, all frames
above `constructorOpt`, including `constructorOpt`, will be omitted from the
generated stack trace.

The `constructorOpt` argument is useful for hiding implementation
details of error generation from the user. For instance:

```js
function a() {
  b();
}

function b() {
  c();
}

function c() {
  // Create an error without stack trace to avoid calculating the stack trace twice.
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  const error = new Error();
  Error.stackTraceLimit = stackTraceLimit;

  // Capture the stack trace above function b
  Error.captureStackTrace(error, b); // Neither function c, nor b is included in the stack trace
  throw error;
}

a();
```

###### Parameters

| Parameter         | Type       |
| ----------------- | ---------- |
| `targetObject`    | `object`   |
| `constructorOpt?` | `Function` |

###### Returns

`void`

###### Inherited from

`Error.captureStackTrace`

##### prepareStackTrace()

> `static` **prepareStackTrace**(`err`, `stackTraces`): `any`

Defined in: node\_modules/.pnpm/@types+node@22.20.1/node\_modules/@types/node/globals.d.ts:56

###### Parameters

| Parameter     | Type         |
| ------------- | ------------ |
| `err`         | `Error`      |
| `stackTraces` | `CallSite`[] |

###### Returns

`any`

###### See

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

###### Inherited from

`Error.prepareStackTrace`

---

### RuntimeRegistry

Defined in: [packages/runtime/src/runtime-plugin.ts:220](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L220)

An instance-scoped registry populated by trusted host configuration. Runtime
selection is intentionally absent from model-visible execution requests.

#### Constructors

##### Constructor

> **new RuntimeRegistry**(`runtimes?`): [`RuntimeRegistry`](#runtimeregistry)

Defined in: [packages/runtime/src/runtime-plugin.ts:223](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L223)

###### Parameters

| Parameter  | Type                                         | Default value |
| ---------- | -------------------------------------------- | ------------- |
| `runtimes` | readonly [`RuntimePlugin`](#runtimeplugin)[] | `[]`          |

###### Returns

[`RuntimeRegistry`](#runtimeregistry)

#### Methods

##### has()

> **has**(`runtimeId`): `boolean`

Defined in: [packages/runtime/src/runtime-plugin.ts:250](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L250)

###### Parameters

| Parameter   | Type     |
| ----------- | -------- |
| `runtimeId` | `string` |

###### Returns

`boolean`

##### list()

> **list**(): readonly `object`[]

Defined in: [packages/runtime/src/runtime-plugin.ts:262](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L262)

###### Returns

readonly `object`[]

##### register()

> **register**(`runtime`): `void`

Defined in: [packages/runtime/src/runtime-plugin.ts:229](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L229)

###### Parameters

| Parameter | Type                              |
| --------- | --------------------------------- |
| `runtime` | [`RuntimePlugin`](#runtimeplugin) |

###### Returns

`void`

##### resolve()

> **resolve**(`runtimeId`): [`RuntimePlugin`](#runtimeplugin)

Defined in: [packages/runtime/src/runtime-plugin.ts:254](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L254)

###### Parameters

| Parameter   | Type     |
| ----------- | -------- |
| `runtimeId` | `string` |

###### Returns

[`RuntimePlugin`](#runtimeplugin)

---

### SharedOSExecutor

Defined in: [packages/runtime/src/executor.ts:148](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L148)

The non-replaceable security envelope around one replaceable RuntimePlugin.
Scheduling, retries, and network-level stopping remain host responsibilities.

#### Implements

- [`TurnExecutionPort`](#turnexecutionport)

#### Constructors

##### Constructor

> **new SharedOSExecutor**(`kernel`, `runtime`, `options?`): [`SharedOSExecutor`](#sharedosexecutor)

Defined in: [packages/runtime/src/executor.ts:161](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L161)

###### Parameters

| Parameter | Type                                                  |
| --------- | ----------------------------------------------------- |
| `kernel`  | [`TurnKernel`](#turnkernel)                           |
| `runtime` | [`RuntimePlugin`](#runtimeplugin)                     |
| `options` | [`SharedOSExecutorOptions`](#sharedosexecutoroptions) |

###### Returns

[`SharedOSExecutor`](#sharedosexecutor)

#### Accessors

##### runtimeManifest

###### Get Signature

> **get** **runtimeManifest**(): `object`

Defined in: [packages/runtime/src/executor.ts:212](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L212)

###### Returns

`object`

###### id

> **id**: `string`

###### metadata?

> `optional` **metadata?**: [`JsonObject`](sharedos-contracts.md#jsonobject)

###### protocolVersion

> **protocolVersion**: `"1"`

###### version

> **version**: `string`

#### Methods

##### execute()

> **execute**(`input`, `options?`): `Promise`\<\{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>

Defined in: [packages/runtime/src/executor.ts:216](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L216)

###### Parameters

| Parameter                             | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`                               | \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `tools`: `object`[]; `version`: `"1"`; \} |
| `input.agent`                         | \{ `agentId`: `string`; `kind`: `"agent"`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `input.agent.agentId`                 | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.agent.kind`                    | `"agent"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `input.context`                       | \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `input.context.actor`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.authority`             | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.enabledToolNamespaces` | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.executionId?`          | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.namespaceId`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.now`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.owner`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.purpose`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.traceId`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.executionId`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message`                       | \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `input.message.createdAt`             | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.id`                    | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.payload`               | [`JsonValue`](sharedos-contracts.md#jsonvalue)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `input.message.provenance?`           | \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `input.message.provenance.metadata?`  | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.message.provenance.parentIds`  | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.provenance.source`     | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.purpose`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.receiver`              | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.replyTo?`              | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.sender`                | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.traceId`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.version`               | `"1"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `input.metadata?`                     | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.options?`                      | \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `input.options.maxSteps?`             | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.options.maxToolCalls?`         | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.options.timeoutMs?`            | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.state?`                        | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.tools`                         | `object`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.version`                       | `"1"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `options`                             | [`ExecuteTurnOptions`](#executeturnoptions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

###### Returns

`Promise`\<\{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>

###### Implementation of

[`TurnExecutionPort`](#turnexecutionport).[`execute`](#execute-1)

## Interfaces

### AgentTurnDriver

Defined in: [packages/runtime/src/standard-runtime.ts:118](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L118)

What sits in the standard loop's driver slot.

Model- or provider-specific code implements this port. The loop asks it what
to do next; it never reaches the envelope itself.

#### Properties

| Property                                   | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                                         |
| ------------------------------------------ | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-manifest"></a> `manifest?` | `readonly` | `object`                                         | Who this driver is, for the record. The executor stamps the plugin's manifest on every execution record, and the loop is the same whichever driver is seated, so the loop reports the seated driver's manifest as its own: evidence is filed under what produced it. A driver that states none is reported as `sharedos.standard`. | [packages/runtime/src/standard-runtime.ts:127](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L127) |
| `manifest.id`                              | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:9                                                                                                             |
| `manifest.metadata?`                       | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject) | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:12                                                                                                            |
| `manifest.protocolVersion`                 | `public`   | `"1"`                                            | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:11                                                                                                            |
| `manifest.version`                         | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:10                                                                                                            |

#### Methods

##### open()

> **open**(`request`, `signal`): `Promise`\<[`AgentTurnSession`](#agentturnsession)>\>

Defined in: [packages/runtime/src/standard-runtime.ts:137](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L137)

Open the session one turn is driven through.

A turn cancelled while this is in flight stops waiting for it. A session
handed back after that is still closed, with the turn's ending, so `close`
may be called on a session that was never asked for a decision. A driver
whose `open` rejects releases whatever it had taken itself: there is no
session to close.

###### Parameters

| Parameter | Type                                        |
| --------- | ------------------------------------------- |
| `request` | [`RuntimeTurnRequest`](#runtimeturnrequest) |
| `signal`  | `AbortSignal`                               |

###### Returns

`Promise`\<[`AgentTurnSession`](#agentturnsession)\>

---

### AgentTurnSession

Defined in: [packages/runtime/src/standard-runtime.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L92)

#### Properties

| Property                                       | Modifier   | Type     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Defined in                                                                                                                                         |
| ---------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-prompthash"></a> `promptHash?` | `readonly` | `string` | What the session will tell the seat before its first decision, hashed. A driver that composes text for a model -- a system message, a prompt -- states the hash here, once, and nowhere else. The loop hands it to `RuntimeHost.annotate` as soon as `open` has resolved and before the first step, and the envelope writes it on the turn's result however the turn then ends, which is what a cancelled turn needs: a session that never returns a decision returns no metadata of its own, and the record would otherwise not say what that turn was asked. The loop cannot state it earlier than `open` returns, so a driver whose `open` itself sends the text should hash it before sending; a turn cancelled inside `open` has no hash to record. A driver that hands the seat no text leaves it absent. | [packages/runtime/src/standard-runtime.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L107) |

#### Methods

##### close()?

> `optional` **close**(`outcome`, `signal`): `void` \| `Promise`\<`void`>\>

Defined in: [packages/runtime/src/standard-runtime.ts:109](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L109)

###### Parameters

| Parameter | Type                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `outcome` | `"succeeded"` \| `"denied"` \| `"failed"` \| `"cancelled"` \| `"escalated"` |
| `signal`  | `AbortSignal`                                                               |

###### Returns

`void` \| `Promise`\<`void`\>

##### next()

> **next**(`input`, `signal`): `Promise`\<[`AgentTurnDecision`](#agentturndecision)>\>

Defined in: [packages/runtime/src/standard-runtime.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L108)

###### Parameters

| Parameter | Type                                |
| --------- | ----------------------------------- |
| `input`   | [`AgentTurnInput`](#agentturninput) |
| `signal`  | `AbortSignal`                       |

###### Returns

`Promise`\<[`AgentTurnDecision`](#agentturndecision)\>

---

### DescribeReachOptions

Defined in: [packages/runtime/src/reach.ts:3](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/reach.ts#L3)

#### Properties

| Property                             | Modifier   | Type     | Description                                                                                                                                                                                                                                                                                                                                                                                    | Defined in                                                                                                                 |
| ------------------------------------ | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-limit"></a> `limit?` | `readonly` | `number` | How many entries are written out before the rest are counted instead. A reach may carry thousands of entries, and a prompt that lists them all is a prompt the model reads instead of the task. Past the limit the text says how many were left out, so a truncated description never reads as a complete one. Defaults to [DEFAULT\_DESCRIBED\_REACH\_LIMIT](#default_described_reach_limit). | [packages/runtime/src/reach.ts:12](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/reach.ts#L12) |

---

### ExecuteTurnOptions

Defined in: [packages/runtime/src/executor.ts:106](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L106)

#### Properties

| Property                                 | Type                | Description                                                             | Defined in                                                                                                                         |
| ---------------------------------------- | ------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-onevent"></a> `onEvent?` | (`event`) => `void` | Synchronous observation hook for streaming an immutable event snapshot. | [packages/runtime/src/executor.ts:109](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L109) |
| <a id="property-signal"></a> `signal?`   | `AbortSignal`       | -                                                                       | [packages/runtime/src/executor.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L107) |

---

### RuntimeHost

Defined in: [packages/runtime/src/runtime-plugin.ts:146](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L146)

The only effectful surface supplied to a runtime plugin. Every tool call is
checked against the effective catalog and re-authorized by the kernel.

#### Properties

| Property                                   | Modifier   | Type                              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Defined in                                                                                                                                     |
| ------------------------------------------ | ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-draining"></a> `draining?` | `readonly` | `AbortSignal`                     | Aborted once the turn takes nothing new: `drainGraceMs` ahead of its deadline, or when the envelope is ending it on an audit outage. From then a new `invokeTool` comes back `denied` with `turn_draining`, and a call already with the kernel still answers with its real result. A plugin that reads this stops asking its model for decisions, which is what the standard loop does. One that does not read it is refused the same calls and stopped at the deadline. It is also aborted whenever the turn's own signal is. Optional so a narrow host double stays viable; the envelope always supplies it. | [packages/runtime/src/runtime-plugin.ts:160](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L160) |
| <a id="property-limits"></a> `limits`      | `readonly` | [`RuntimeLimits`](#runtimelimits) | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [packages/runtime/src/runtime-plugin.ts:147](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L147) |

#### Methods

##### annotate()

> **annotate**(`key`, `value`): `void`

Defined in: [packages/runtime/src/runtime-plugin.ts:192](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L192)

State one fact about the turn, for its record.

`emit` is for something that happened at a moment, and lands among the
turn's events in order. This is for something that is true of the turn:
what the seat was told, that a delegate asked for a human. The envelope
holds the value and writes it into `ExecutionResult.metadata` under `key`
on every way out of the turn -- completed, failed, escalated, and the
ones that return no outcome at all: cancelled, a plugin that threw, an
outcome that did not parse. A plugin's own outcome metadata cannot do that,
because a turn stopped at its deadline never returns one.

It throws a `TypeError` for a key that is empty, is `runtime`, which is the
envelope's own, or is `__proto__`, which no JSON object SharedOS reads
keeps; and for a value that is not JSON. All are plugin bugs.
It throws for nothing else, and in particular never for the state of the
host: a write made while the turn is aborted but still open is kept, and
one made after the turn has closed is dropped. So a call site needs no
guard, and stating a fact cannot become the turn's failure or a transport
fault in whatever was stating it.

The last write to a key wins, and an annotation outranks the same key on
the outcome's own metadata. A value that does not exist yet cannot be
carried: a turn cancelled before its plugin had anything to state records
nothing, here or anywhere.

Descriptive, never permissive. It is the plugin's own claim, read by
whoever reads the record; nothing SharedOS decides depends on it.

###### Parameters

| Parameter | Type                                           |
| --------- | ---------------------------------------------- |
| `key`     | `string`                                       |
| `value`   | [`JsonValue`](sharedos-contracts.md#jsonvalue) |

###### Returns

`void`

##### emit()

> **emit**(`event`): `void`

Defined in: [packages/runtime/src/runtime-plugin.ts:162](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L162)

###### Parameters

| Parameter    | Type                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| `event`      | \{ `data`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `string`; \} |
| `event.data` | [`JsonValue`](sharedos-contracts.md#jsonvalue)                                  |
| `event.type` | `string`                                                                        |

###### Returns

`void`

##### invokeTool()

> **invokeTool**(`call`, `options?`): `Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

Defined in: [packages/runtime/src/runtime-plugin.ts:161](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L161)

###### Parameters

| Parameter           | Type                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call`              | \{ `arguments`: [`JsonObject`](sharedos-contracts.md#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \} |
| `call.arguments`    | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                     |
| `call.id?`          | `string`                                                                                                                                             |
| `call.requestedAt?` | `string`                                                                                                                                             |
| `call.tool?`        | `string`                                                                                                                                             |
| `call.traceId?`     | `string`                                                                                                                                             |
| `options?`          | [`RuntimeToolInvocationOptions`](#runtimetoolinvocationoptions)                                                                                      |

###### Returns

`Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

---

### RuntimeLimits

Defined in: [packages/runtime/src/runtime-plugin.ts:124](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L124)

#### Properties

| Property                                          | Modifier   | Type     | Defined in                                                                                                                                     |
| ------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-maxsteps"></a> `maxSteps`         | `readonly` | `number` | [packages/runtime/src/runtime-plugin.ts:125](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L125) |
| <a id="property-maxtoolcalls"></a> `maxToolCalls` | `readonly` | `number` | [packages/runtime/src/runtime-plugin.ts:126](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L126) |
| <a id="property-timeoutms"></a> `timeoutMs`       | `readonly` | `number` | [packages/runtime/src/runtime-plugin.ts:127](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L127) |

---

### RuntimePlugin

Defined in: [packages/runtime/src/runtime-plugin.ts:200](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L200)

A replaceable one-turn harness running inside the SharedOS security envelope.
Implementations must keep per-turn state inside `run` and support concurrent
calls when one plugin instance is shared by a RuntimeRegistry.

#### Properties

| Property                                    | Modifier   | Type                                             | Defined in                                                                                                                                     |
| ------------------------------------------- | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-manifest-1"></a> `manifest` | `readonly` | `object`                                         | [packages/runtime/src/runtime-plugin.ts:201](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L201) |
| `manifest.id`                               | `public`   | `string`                                         | packages/contracts/dist/runtime.d.ts:9                                                                                                         |
| `manifest.metadata?`                        | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject) | packages/contracts/dist/runtime.d.ts:12                                                                                                        |
| `manifest.protocolVersion`                  | `public`   | `"1"`                                            | packages/contracts/dist/runtime.d.ts:11                                                                                                        |
| `manifest.version`                          | `public`   | `string`                                         | packages/contracts/dist/runtime.d.ts:10                                                                                                        |

#### Methods

##### run()

> **run**(`request`, `host`, `signal`): `Promise`\<\{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `"complete"`; \} \| \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `type`: `"fail"`; \} \| \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}\>

Defined in: [packages/runtime/src/runtime-plugin.ts:202](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L202)

###### Parameters

| Parameter | Type                                        |
| --------- | ------------------------------------------- |
| `request` | [`RuntimeTurnRequest`](#runtimeturnrequest) |
| `host`    | [`RuntimeHost`](#runtimehost)               |
| `signal`  | `AbortSignal`                               |

###### Returns

`Promise`\<\{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `"complete"`; \} \| \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `type`: `"fail"`; \} \| \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}\>

---

### RuntimeToolInvocationOptions

Defined in: [packages/runtime/src/runtime-plugin.ts:130](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L130)

#### Properties

| Property                           | Modifier   | Type     | Description                                                                                                                                                                                                                                                                                             | Defined in                                                                                                                                     |
| ---------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-step"></a> `step?` | `readonly` | `number` | Position within the runtime's own loop. Optional, and enforced when present: the execution envelope refuses a call declaring a step at or past `RuntimeLimits.maxSteps`, and refuses a new step once that many distinct ones have been seen. A plugin that omits it is bounded by `maxToolCalls` alone. | [packages/runtime/src/runtime-plugin.ts:139](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L139) |

---

### RuntimeVisibleContext

Defined in: [packages/runtime/src/runtime-plugin.ts:82](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L82)

#### Properties

| Property                                        | Modifier   | Type                                                                                                                                                                                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Defined in                                                                                                                                     |
| ----------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-actor"></a> `actor`             | `readonly` | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:83](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L83)   |
| <a id="property-namespaceid"></a> `namespaceId` | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:85](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L85)   |
| <a id="property-now"></a> `now`                 | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:88](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L88)   |
| <a id="property-owner"></a> `owner`             | `readonly` | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:84](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L84)   |
| <a id="property-purpose"></a> `purpose`         | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:86](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L86)   |
| <a id="property-reach"></a> `reach`             | `readonly` | \{ `reach`: `object`[]; `status`: `"computed"`; \} \| \{ `reasonCode`: `"usage_store_unavailable"` \| `"authority_unavailable"`; `status`: `"unavailable"`; \}                                             | Where this turn may operate, with the authority stripped out. The catalogue says which tools exist; this says which resources they are worth pointing at. Without it a runtime can only guess paths and collect denials, or the host reads raw grants to describe the boundary in a prompt -- at exactly the seam designed to keep grants away from the model. `computed` is derived by `SharedOSKernel.reach` from the grants the turn's decisions are made against, then narrowed to the namespaces this turn's catalogue operates on. It carries no grant id, issuer, expiry, or budget, and a bounded grant whose budget is spent does not appear. `unavailable` means the reach could not be established, and `reasonCode` says why: `usage_store_unavailable` when a bounded budget could not be read, or `authority_unavailable` when the authority could not be loaded again after admission. Either is handed over as such rather than as an empty list that would read as "nothing", which is a true answer for some turns and not for this one. The turn still runs: every call is decided on its own, and a call that depends on what could not be read fails closed under the same code. Descriptive, never permissive: every call is authorized independently, so an entry here is not a permission and a stale one cannot open anything. | [packages/runtime/src/runtime-plugin.ts:113](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L113) |
| <a id="property-traceid"></a> `traceId`         | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [packages/runtime/src/runtime-plugin.ts:87](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L87)   |

---

### SharedOSExecutorOptions

Defined in: [packages/runtime/src/executor.ts:60](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L60)

#### Properties

| Property                                                         | Type                                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Defined in                                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-clock"></a> `clock?`                             | () => `string`                            | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [packages/runtime/src/executor.ts:61](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L61)   |
| <a id="property-createid"></a> `createId?`                       | () => `string`                            | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [packages/runtime/src/executor.ts:62](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L62)   |
| <a id="property-defaultmaxsteps"></a> `defaultMaxSteps?`         | `number`                                  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [packages/runtime/src/executor.ts:63](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L63)   |
| <a id="property-defaultmaxtoolcalls"></a> `defaultMaxToolCalls?` | `number`                                  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [packages/runtime/src/executor.ts:64](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L64)   |
| <a id="property-defaulttimeoutms"></a> `defaultTimeoutMs?`       | `number`                                  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [packages/runtime/src/executor.ts:65](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L65)   |
| <a id="property-draingracems"></a> `drainGraceMs?`               | `number`                                  | How long before a turn's deadline it stops taking new tool calls, so the calls already inside a handler can answer before the deadline stops them. Inside the limit, never on top of it: with `timeoutMs` 120 000 and a grace of 5 000 a new call is refused from 115 s, a handler running then is left alone, and the abort reaches it at 120 s as it always did. A handler still running at the deadline is recorded `interrupted`. An audit outage drains the same way, for the grace or the time left, whichever is shorter. A host's own cancellation does not: it stops the turn at once, as before. Zero, the default, is the behaviour before this option. It is not capped against a request's `timeoutMs`; a grace no smaller than the limit leaves a turn no time in which a call is taken, and choosing it is the host's. | [packages/runtime/src/executor.ts:81](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L81)   |
| <a id="property-onturnerror"></a> `onTurnError?`                 | [`TurnErrorReporter`](#turnerrorreporter) | Notification for a throw the turn body did not convert into an outcome. The envelope contains such a throw and ends the turn `failed` with `runtime_failed`; the error itself comes here rather than being discarded. See [TurnErrorReporter](#turnerrorreporter) for what it may and may not be used for. Not only the plugin's. The turn body also calls `openTurnAuthority`, `admitTurn`, `reach`, and `listTools`, and a host port that throws arrives here too under the same terminal code. That conflation is in the wire vocabulary and is not fixed by this hook; the error's own stack is what separates them, which is the reason for handing it over rather than classifying it here.                                                                                                                                     | [packages/runtime/src/executor.ts:103](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L103) |
| <a id="property-spans"></a> `spans?`                             | [`SpanSink`](sharedos-core.md#spansink)   | Where the envelope reports what it cost, when a host is measuring. A second clock, and deliberately not the one `clock` supplies: that one names instants for a record and a conformance run freezes it. See [SpanSink](sharedos-core.md#spansink).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [packages/runtime/src/executor.ts:89](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L89)   |

---

### StandardRuntimeOptions

Defined in: [packages/runtime/src/standard-runtime.ts:140](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L140)

#### Properties

| Property                                               | Type                                      | Description                                                                                                                                                                                                                                                                                                                    | Defined in                                                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-closetimeoutms"></a> `closeTimeoutMs?` | `number`                                  | -                                                                                                                                                                                                                                                                                                                              | [packages/runtime/src/standard-runtime.ts:143](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L143) |
| <a id="property-driver"></a> `driver`                  | [`AgentTurnDriver`](#agentturndriver)     | The one driver this runtime seats.                                                                                                                                                                                                                                                                                             | [packages/runtime/src/standard-runtime.ts:142](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L142) |
| <a id="property-onturnerror-1"></a> `onTurnError?`     | [`TurnErrorReporter`](#turnerrorreporter) | Notification for a throw the loop contained rather than propagated. A driver that throws ends the turn `driver_failed`, which is a cooperative outcome the envelope never sees as an exception -- so the executor's own hook cannot report it and this one exists. Same contract; see [TurnErrorReporter](#turnerrorreporter). | [packages/runtime/src/standard-runtime.ts:152](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L152) |

---

### TurnErrorContext

Defined in: [packages/runtime/src/runtime-plugin.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L19)

Which turn a [TurnErrorReporter](#turnerrorreporter) notification is about.

#### Properties

| Property                                        | Modifier   | Type     | Defined in                                                                                                                                   |
| ----------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-executionid"></a> `executionId` | `readonly` | `string` | [packages/runtime/src/runtime-plugin.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L20) |
| <a id="property-traceid-1"></a> `traceId`       | `readonly` | `string` | [packages/runtime/src/runtime-plugin.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L21) |

---

### TurnExecutionPort

Defined in: [packages/runtime/src/executor.ts:112](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L112)

#### Methods

##### execute()

> **execute**(`input`, `options?`): `Promise`\<\{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>

Defined in: [packages/runtime/src/executor.ts:113](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L113)

###### Parameters

| Parameter                              | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`                                | \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `tools`: `object`[]; `version`: `"1"`; \} |
| `input.agent`                          | \{ `agentId`: `string`; `kind`: `"agent"`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `input.agent.agentId?`                 | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.agent.kind?`                    | `"agent"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `input.context?`                       | \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `input.context.actor?`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.authority?`             | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.enabledToolNamespaces?` | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.executionId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.namespaceId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.now?`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.owner?`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.context.purpose?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.context.traceId?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.executionId?`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message?`                       | \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `input.message.createdAt?`             | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.id?`                    | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.payload?`               | [`JsonValue`](sharedos-contracts.md#jsonvalue)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `input.message.provenance?`            | \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `input.message.provenance.metadata?`   | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.message.provenance.parentIds?`  | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.provenance.source?`     | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.purpose?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.receiver?`              | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.replyTo?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.sender?`                | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.message.traceId?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.message.version?`               | `"1"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `input.metadata?`                      | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.options?`                       | \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `input.options.maxSteps?`              | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.options.maxToolCalls?`          | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.options.timeoutMs?`             | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input.state?`                         | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `input.tools?`                         | `object`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `input.version?`                       | `"1"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `options?`                             | [`ExecuteTurnOptions`](#executeturnoptions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

###### Returns

`Promise`\<\{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \} \| \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>

## Type Aliases

### AgentTurnDecision

> **AgentTurnDecision** = \{ `call`: [`ToolCall`](sharedos-contracts.md#toolcall); `step?`: `number`; `type`: `"tool_call"`; \} \| \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `"complete"`; \} \| \{ `error`: [`ProtocolError`](sharedos-contracts.md#protocolerror); `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `type`: `"fail"`; \} \| \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}

Defined in: [packages/runtime/src/standard-runtime.ts:38](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L38)

#### Union Members

##### Type Literal

\{ `call`: [`ToolCall`](sharedos-contracts.md#toolcall); `step?`: `number`; `type`: `"tool_call"`; \}

###### call

> `readonly` **call**: [`ToolCall`](sharedos-contracts.md#toolcall)

###### step?

> `readonly` `optional` **step?**: `number`

The step this call is made at, when the driver wants to say.

The loop declares the position it is at, which is the right answer for
a driver that simply asks for one call per turn of the loop. It is the
wrong answer for a driver deliberately reaching past its budget: the
loop's own index can never exceed `maxSteps`, because the loop stops
there, so the envelope's step ceiling was unreachable from inside this
runtime and every driven column reported the row as unavailable.

Declaring it here makes the ceiling reachable and keeps it enforced:
the envelope refuses a call at or past `maxSteps` whoever named the
step, so a driver can claim a step it has no right to and be refused
for it. A driver that says nothing is bounded exactly as before.

It reaches forward only. The loop knows where it is, and a declared
step behind that position is not a reach past the budget but a claim
the loop can see is false; it is refused as a malformed decision rather
than written into the record as the position the call was made at.

###### type

> `readonly` **type**: `"tool_call"`

---

##### Type Literal

\{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `"complete"`; \}

---

##### Type Literal

\{ `error`: [`ProtocolError`](sharedos-contracts.md#protocolerror); `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `type`: `"fail"`; \}

`metadata` rides on a failure exactly as it does on a completion. A turn
that failed still ran: the model that answered, what it cost, and why it
stopped are facts about the turn rather than about its ending, and a record
that dropped them on failure would know least about the turns that most
need explaining.

---

##### Type Literal

\{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}

End the turn by asking a human to decide.

`RuntimeTurnOutcome` has carried an escalate variant from the start, but
nothing running inside this loop could produce one: a driver could complete
or fail and that was all. Escalation was therefore reachable only by a
plugin that replaced the loop entirely, which is why every driven column
reported the escalation row as structurally unavailable -- a limit of this
type, not of any vendor.

The reason is the driver's own words and is recorded verbatim, up to the
512 characters the outcome's contract carries; a driver reading it off a
model or a harness cuts it there rather than replacing it (see
`escalationRequest`), and one that hands the loop more than that has its
decision refused. Nothing here advances the escalation: SharedOS records
that a decision was asked for and grants nothing while it is pending.

---

### AgentTurnInput

> **AgentTurnInput** = \{ `type`: `"start"`; \} \| \{ `result`: [`ToolResult`](sharedos-contracts.md#toolresult); `type`: `"tool_result"`; \}

Defined in: [packages/runtime/src/standard-runtime.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L35)

---

### RuntimeTurnRequest

> **RuntimeTurnRequest** = `Omit`\<[`ExecutionRequest`](sharedos-contracts.md#executionrequest), `"context"`> \> & `object`

Defined in: [packages/runtime/src/runtime-plugin.ts:120](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L120)

A runtime sees task input and the effective tool catalog, but never grants,
issuing authority, or namespace-management state.

#### Type Declaration

##### context

> `readonly` **context**: [`RuntimeVisibleContext`](#runtimevisiblecontext)

---

### TurnErrorReporter

> **TurnErrorReporter** = (`error`, `turn`) => `void`

Defined in: [packages/runtime/src/runtime-plugin.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L49)

A host's sink for a throw the turn contained rather than propagated.

Both layers that contain one take it: `SharedOSExecutor`, whose catch ends
the turn `runtime_failed`, and the standard loop, whose catch ends it
`driver_failed`. A terminal code says a turn stopped and does not say why;
the thrown error is the only thing that does, so it is handed over whole and
unwrapped, because its stack is what names the origin.

It reaches nothing else. A `ProtocolError.message` is read by the model, and
an `ExecutionEvent` becomes part of an `ExecutionRecord`, which travels
further than an audit sink; a thrown message may carry anything the thrower
had in scope. This is a host-side sink for host-side logs, in the position
`SharedOSKernel.onAuditError` occupies for the same reason.

Observational. One that throws is ignored -- it cannot replace an outcome
already decided -- and a turn behaves identically with none installed.
Cancellation never reaches it: a turn stopped by the deadline or by the
caller's signal ends `cancelled`, which is a decision rather than a defect.

The kernel makes the same promise about a provider's throw, under
`SharedOSKernelOptions.onProviderError`. A host wanting both installs both;
they are separate because they are about different things failing, and the
turn's identifiers are not the ones a mediated call has.

#### Parameters

| Parameter | Type                                    |
| --------- | --------------------------------------- |
| `error`   | `unknown`                               |
| `turn`    | [`TurnErrorContext`](#turnerrorcontext) |

#### Returns

`void`

---

### TurnKernel

> **TurnKernel** = `Pick`\<[`SharedOSKernel`](sharedos-core.md#sharedoskernel), `"replayProtection"` \| `"admitTurn"` \| `"reach"` \| `"listTools"` \| `"invokeTool"` \| `"openTurnAuthority"` \| `"recordEscalation"` \| `"recordTurnEnd"` \| `"recordRefusedCall"`>\>

Defined in: [packages/runtime/src/executor.ts:131](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L131)

The minimal deny-by-default kernel surface required by a turn executor.

Hosts normally pass a [SharedOSKernel](sharedos-core.md#sharedoskernel). Keeping this port explicit also
permits narrow test doubles without granting a runtime direct access to
registries, namespace settings, or other host policy state.

Every member is required. The first four are what a turn asks of the kernel.
The other four are what makes it a turn: `openTurnAuthority` is the boundary
authority is resolved at and held from (ADR 0010), and the three recorders
are how an ask, an ending and a call the envelope refused reach the trail the
kernel owns (ADR 0023). A kernel without them would run a turn that re-reads
its authority on every call and records none of what the envelope decided,
which is not a narrower turn but a different one.

## Variables

### DEFAULT\_DESCRIBED\_REACH\_LIMIT

> `const` **DEFAULT\_DESCRIBED\_REACH\_LIMIT**: `128` = `128`

Defined in: [packages/runtime/src/reach.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/reach.ts#L15)

---

### ESCALATION\_ACTION

> `const` **ESCALATION\_ACTION**: `"request"` = `"request"`

Defined in: [packages/runtime/src/escalation.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L8)

---

### ESCALATION\_ASKED\_ANNOTATION

> `const` **ESCALATION\_ASKED\_ANNOTATION**: `"escalationAsked"` = `"escalationAsked"`

Defined in: [packages/runtime/src/escalation.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L36)

The key a delegate states the ask under, through `RuntimeHost.annotate`.

Every path that honours the affordance ends the turn without forwarding the
call -- a driver in the standard loop returns an `escalate` decision, the MCP
latch settles the harness's outcome -- so a working ask leaves no operation
in the record. Neither would an ask the envelope then failed to honour, and
the two would be indistinguishable from a delegate that never asked: a
conformance row graded on the ending could not tell "SharedOS was never
asked" from "SharedOS was asked and did the wrong thing". So the ask is
stated the moment it is recognised, before anything acts on it, and the
envelope writes it on the turn's result whatever the turn then does.

It is the delegate's own claim, which is the safe direction of trust. A
reader can only grade a turn _harder_ on it -- an ask stated and not
honoured is a failure -- and never credit one, because a pass still needs
the turn to have ended `escalated`. Distinct from the `escalation.requested`
audit event, which the kernel writes when the envelope records an escalation
it honoured.

---

### ESCALATION\_REASON\_MAX\_LENGTH

> `const` **ESCALATION\_REASON\_MAX\_LENGTH**: `512` = `512`

Defined in: [packages/runtime/src/escalation.ts:14](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L14)

The longest reason an escalation can carry, restating the contract's bound on
`RuntimeTurnOutcome.reason` and `Escalation.reason` rather than importing a
schema this package does not validate with.

---

### ESCALATION\_RESOURCE\_PATH

> `const` **ESCALATION\_RESOURCE\_PATH**: readonly `string`[]

Defined in: [packages/runtime/src/escalation.ts:7](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L7)

The resource an escalation grant is written over.

---

### ESCALATION\_TOOL\_DEFINITION

> `const` **ESCALATION\_TOOL\_DEFINITION**: [`ToolDefinition`](sharedos-contracts.md#tooldefinition)

Defined in: [packages/runtime/src/escalation.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L71)

The affordance a driver offers so escalation can be chosen rather than inferred.

A turn that ends by asking a human to decide is a claim about SharedOS -- the
request is recorded, audited, and grants nothing while it is pending -- and
until now no driver inside the standard loop could make it. Adding the
decision variant alone would not have been enough: the model still needs a way
to _say_ it, and reading intent out of prose ("I should ask a human") would
make the row measure a phrase rather than a choice.

So it is published as a tool. It is permission-filtered like every other tool,
which is the point -- escalation is an affordance a host grants, and an agent
with no grant over it does not see it in the catalogue at all.

It is nonetheless never invoked. A driver whose turn was offered the tool
recognises the name and returns an escalate decision instead of a tool call,
so nothing reaches the kernel; see [escalationRequest](#escalationrequest). The kernel-side
handler a host registers exists to put the tool in the catalogue and to fail
loudly if some driver forwards it anyway, because a call that quietly
succeeded would record an escalation the envelope never terminated on.

The filtering is what gates the affordance, and a driver has to honour it
itself: ending a turn on the name skips the envelope, and with it the
envelope's check that the tool was published to this agent. So every driver
that recognises the name reads its turn's catalogue first, and a name the
catalogue does not hold is passed through to be refused `tool_unavailable`
like any other unpublished tool.

---

### ESCALATION\_TOOL\_NAME

> `const` **ESCALATION\_TOOL\_NAME**: `"sharedos.escalate"` = `"sharedos.escalate"`

Defined in: [packages/runtime/src/escalation.ts:5](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L5)

---

### ESCALATION\_TOOL\_NAMESPACE

> `const` **ESCALATION\_TOOL\_NAMESPACE**: `"sharedos"` = `"sharedos"`

Defined in: [packages/runtime/src/escalation.ts:4](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L4)

---

### PROMPT\_HASH\_ANNOTATION

> `const` **PROMPT\_HASH\_ANNOTATION**: `"promptHash"` = `"promptHash"`

Defined in: [packages/runtime/src/runtime-plugin.ts:80](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L80)

The key a runtime states what it told the seat under: the content hash of the
instructions and prompt, stated through [RuntimeHost.annotate](#annotate) before
the model or harness is sent anything.

---

### STANDARD\_RUNTIME\_MANIFEST

> `const` **STANDARD\_RUNTIME\_MANIFEST**: [`RuntimeManifest`](sharedos-contracts.md#runtimemanifest)

Defined in: [packages/runtime/src/standard-runtime.ts:155](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L155)

---

### TURN\_DRAINING

> `const` **TURN\_DRAINING**: `"turn_draining"` = `"turn_draining"`

Defined in: [packages/runtime/src/executor.ts:1128](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L1128)

The code a new tool call is refused under once the turn takes nothing new.

## Functions

### createEscalationTool()

> **createEscalationTool**(): [`ToolHandler`](sharedos-core.md#toolhandler)

Defined in: [packages/runtime/src/escalation.ts:117](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L117)

The handler a host registers so the affordance is catalogued.

It exists to put [ESCALATION\_TOOL\_DEFINITION](#escalation_tool_definition) in the permission-filtered
catalogue, where an agent sees it only when its context enables the
`sharedos` tool namespace and it holds a grant over `sharedos` /
`["escalation"]` / `request`. It is never meant to run: a driver whose turn's
catalogue offers it recognises the name (see [escalationRequest](#escalationrequest)) and
ends the turn `escalated` instead of forwarding a call. If a driver forwards it anyway, the handler
fails with `escalation_not_terminated` rather than succeeding, because a call
that quietly succeeded would leave a record of an escalation tool that ran
and a turn that completed normally -- the confusion the affordance exists to
remove.

Arguments pass through unparsed on purpose. A malformed forwarded call is
still a forwarded call, and reporting it as `invalid_tool_arguments` would
record the wrong defect.

#### Returns

[`ToolHandler`](sharedos-core.md#toolhandler)

---

### createStandardRuntime()

> **createStandardRuntime**(`options`): [`RuntimePlugin`](#runtimeplugin)

Defined in: [packages/runtime/src/standard-runtime.ts:180](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/standard-runtime.ts#L180)

The SharedOS loop, with one driver seated.

"Standard" names the SharedOS-owned default at each layer: this is the
default runtime, and a host may install another `RuntimePlugin` in its place.
The loop asks the seated driver what to do next, forwards every tool call to
the envelope, stops at `maxSteps`, and asks nothing more of the driver once
the turn is draining. What differs between two uses of it is only the driver,
so the runtime reports the driver's manifest (see
[AgentTurnDriver.manifest](#property-manifest)) and a record names what sat in the seat.

The driver slot takes any [AgentTurnDriver](#agentturndriver): a host's own, or
`StandardTurnDriver` from `@aicoo/sharedos-adapters`, which puts a model API
in the seat.

#### Parameters

| Parameter | Type                                                |
| --------- | --------------------------------------------------- |
| `options` | [`StandardRuntimeOptions`](#standardruntimeoptions) |

#### Returns

[`RuntimePlugin`](#runtimeplugin)

---

### describeReach()

> **describeReach**(`reach`, `options?`): `string`

Defined in: [packages/runtime/src/reach.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/reach.ts#L49)

`RuntimeVisibleContext.reach`, as the words a model is shown.

The runtime is handed where the turn may operate so a model can be told
where to look rather than search `/` and collect denials. This is the telling.
It is the one rendering the shipped runtimes share -- the model driver puts
it in a system message, the MCP harness runtime hands it over as the
server's initialize instructions -- and it is exported so a host writing its
own driver says the same thing the same way.

Every branch of the result is spoken, because each is a different answer:

- `computed` with entries lists each as a place some grant covers, in the
  shape the tools take -- the namespace, the path as the JSON array a
  `path` argument is, and whether the entry covers what lies beneath it.
- `computed` with none says so. That is a true answer for a turn that
  reaches nothing, and saying nothing would leave the model to guess.
- `unavailable` says the reach could not be established and names the
  contract's reason code. It is deliberately not written as an empty list:
  the executor went to the trouble of handing over `unavailable` so that
  "nothing" and "unknown" stay distinguishable (ADR 0021), and a renderer
  that collapsed them would rebuild the silent case at the last hop. A call
  that depends on what could not be read fails closed under the same code,
  so the code is what lets the model correlate the two.

Every rendering says that the text is descriptive: each call is still
decided on its own, so an entry here is not a permission and a missing one
is not a refusal. Actions are listed as the grants state them, not as the
offered tools could exercise them -- `reachThroughTools` narrows by
namespace and leaves actions alone -- which is one more reason the model is
told the list decides nothing.

#### Parameters

| Parameter | Type                                                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reach`   | \{ `reach`: `object`[]; `status`: `"computed"`; \} \| \{ `reasonCode`: `"usage_store_unavailable"` \| `"authority_unavailable"`; `status`: `"unavailable"`; \} |
| `options` | [`DescribeReachOptions`](#describereachoptions)                                                                                                                |

#### Returns

`string`

---

### escalationArguments()

> **escalationArguments**(`reason`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/runtime/src/escalation.ts:192](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L192)

The arguments an escalation is requested with, for a driver writing the call.

#### Parameters

| Parameter | Type     |
| --------- | -------- |
| `reason`  | `string` |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### escalationAskedAnnotation()

> **escalationAskedAnnotation**(`reason`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/runtime/src/escalation.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L39)

The ask, in the one shape every delegate states it.

#### Parameters

| Parameter | Type     |
| --------- | -------- |
| `reason`  | `string` |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### escalationOffered()

> **escalationOffered**(`tools`): `boolean`

Defined in: [packages/runtime/src/escalation.ts:226](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L226)

Whether a turn's catalogue offers the affordance.

The gate on honouring the name (ADR 0017, "The catalogue gates the name"):
a driver reads it from the same `tools` it offered the seat's occupant, and
the executor from the catalogue the turn was actually served.

#### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `tools`   | readonly `object`[] |

#### Returns

`boolean`

---

### escalationReason()

> **escalationReason**(`value`): `string` \| `undefined`

Defined in: [packages/runtime/src/escalation.ts:209](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L209)

A reason string bounded exactly as `RuntimeTurnOutcome`'s is.

Checked here rather than with a schema because this package carries no
validator of its own; the bounds are the contract's and are restated, not
loosened, so a decision that parses here still parses as an outcome.

Strict where [escalationRequest](#escalationrequest) cuts, on purpose. That function reads
a model's or a harness's words, which are input; this one checks a driver's
decision, which is code. A driver that hands the loop an overlong reason has
a bug, and the loop refusing the decision is how the bug is found rather
than quietly trimmed away.

#### Parameters

| Parameter | Type      |
| --------- | --------- |
| `value`   | `unknown` |

#### Returns

`string` \| `undefined`

---

### escalationRequest()

> **escalationRequest**(`tool`, `arguments_`): `string` \| `undefined`

Defined in: [packages/runtime/src/escalation.ts:159](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/escalation.ts#L159)

Read an escalation out of a call a driver is about to make, if that is what it is.

Returns the reason when the call names the affordance and carries a usable
one, and `undefined` for anything else -- which a driver passes on unchanged,
so a tool that merely resembles this one is still re-authorized by the kernel
like any other.

This recognises the name and nothing else. Whether the turn was offered the
tool is the caller's check to make, from its own `RuntimeTurnRequest.tools`,
before asking; a caller that honours the name unconditionally has given
every agent the affordance regardless of grant.

A call that names the affordance with unreadable arguments still escalates,
under a reason saying so. The alternative is to forward it to a kernel that
will refuse it, which turns "the driver asked for a human" into "the agent
made a malformed call" -- the wrong record of what happened.

A reason longer than the outcome can carry is cut to
[ESCALATION\_REASON\_MAX\_LENGTH](#escalation_reason_max_length), not replaced. It is the occupant's own
words, and the first 512 characters of what was said are a truer record than
a sentence saying nothing was.

#### Parameters

| Parameter    | Type      |
| ------------ | --------- |
| `tool`       | `string`  |
| `arguments_` | `unknown` |

#### Returns

`string` \| `undefined`

---

### reportTurnError()

> **reportTurnError**(`reporter`, `error`, `turn`): `void`

Defined in: [packages/runtime/src/runtime-plugin.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/runtime-plugin.ts#L67)

Call one turn-error sink without letting it change what happened.

The turn-shaped name for `reportContainedError`, which is where the guard
itself lives: a sink that throws is swallowed, because a diagnostic that can
turn one failure into two is a liability rather than a diagnostic.

It delegates rather than repeating the rule. The kernel contains a provider's
throw and the runtime contains a plugin's, and the same promise is made to a
host about both; two implementations of one promise is how it stops being
true in one of them. Core owns it because the dependency runs runtime → core
and cannot run back.

Exported deliberately, for a host writing its own [RuntimePlugin](#runtimeplugin) that
offers the same hook.

#### Parameters

| Parameter  | Type                                                     |
| ---------- | -------------------------------------------------------- |
| `reporter` | [`TurnErrorReporter`](#turnerrorreporter) \| `undefined` |
| `error`    | `unknown`                                                |
| `turn`     | [`TurnErrorContext`](#turnerrorcontext)                  |

#### Returns

`void`

---

### terminalSource()

> **terminalSource**(`events`): `"envelope"` \| `"runtime"` \| `undefined`

Defined in: [packages/runtime/src/executor.ts:1191](https://github.com/systemind-team/SharedOS/blob/main/packages/runtime/src/executor.ts#L1191)

Whether the envelope refused the turn or the runtime reported its own failure.

Read back from the event the envelope already emits rather than threaded
through every return, and it is the distinction a record reader needs before
crediting enforcement: a plugin that reports its own error is not the envelope
stopping it.

Exported for that reader. Whoever assembles a record from a turn's events has
the same question, and a second loop over `turn.failed` would be a second
place to decide what the event means.

#### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `events`  | readonly `object`[] |

#### Returns

`"envelope"` \| `"runtime"` \| `undefined`
