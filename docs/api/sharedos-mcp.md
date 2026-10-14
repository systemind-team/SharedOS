[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-mcp

# @aicoo/sharedos-mcp

The SharedOS permission-filtered tool catalogue, served to external harnesses as
a Model Context Protocol server.

```bash
npm install @aicoo/sharedos-mcp
```

```
Harness configuration declares a CONNECTION.
SharedOS declares the TOOLS.
SharedOS capabilities declare the AUTHORITY.
RuntimeHost is the only EXECUTION path.
```

This is the other half of the harness story. `@aicoo/sharedos-adapters` puts
SharedOS in the model provider's seat and owns the turn loop; this package lets a
vendor CLI keep its own loop and whatever model it is configured with, and
connect to SharedOS as a tool server. Both converge on `RuntimeHost.invokeTool`, so neither adds a second
permission path.

```ts
import { McpToolServer, openToolBridge } from "@aicoo/sharedos-mcp";
import { createStreamableHttpMcpServer } from "@aicoo/sharedos-mcp/node";

// Inside RuntimePlugin.run(request, host, signal):
const bridge = openToolBridge({
  executionId: request.executionId,
  context: { traceId: request.context.traceId, now: request.context.now },
  tools: request.tools, // already permission-filtered by the envelope
  host, // RuntimeHost: every call is re-authorized
});
const http = await createStreamableHttpMcpServer({
  server: new McpToolServer({ invoker: bridge }),
});
try {
  // ... point the harness at http.url ...
} finally {
  bridge.close();
  await http.close();
}
```

A harness declares no step, so a turn served this way is bounded by the
envelope's `maxToolCalls` and `timeoutMs`, not by `maxSteps`.

## One name

```
ToolDefinition.name  =  SharedOS canonical tool ID  =  raw MCP Tool.name
```

There is no second identity in the published catalogue. A harness alias
(`mcp__sharedos__files_read`) is presentation: it is recorded on the bridge for
diagnosis, never on the `ToolCall`, so it cannot reach an authorization decision.

## What crosses the boundary

`PublishedToolDefinition` carries `name`, `description`, `inputSchema`,
`outputSchema`, MCP annotation hints, and catalogue provenance. It carries no
`requiredCapability`, no `resolveRequirement`, no grants, no issuing authority,
no namespace settings, no credentials, and no handler references.

The omission is load-bearing. Authorization is `resource + action + context`
resolved from the **arguments** at call time, so two calls to one published tool
routinely need different authority.

## Refusals are results

A SharedOS denial comes back as an MCP tool error (`isError: true`), never as a
transport error. A JSON-RPC error means the request could not be processed; a
denial is a processed request whose answer is "no", and a harness needs to be
able to report it and carry on. `denied` and `failed` stay distinguishable in the
payload and in `_meta["sharedos/status"]`.

## Per turn, never global

The bridge is opened for one `AccessContext`, exposed for one turn, and torn down
with it. A harness process that outlives its turn finds a shut door rather than a
catalogue resolved for a turn that has ended.

## Catalogue hashes

```
catalogHash = SHA-256(canonical JSON(tools sorted by canonical name))
```

Field participation is fixed by `CATALOG_HASH_FIELDS`, so two implementations
cannot both claim to compute it and disagree. Two harnesses whose hashes match
were served the same semantic tool set; two whose hashes differ cannot be
compared until that is explained.

Full design: [MCP toolshare](https://github.com/systemind-team/SharedOS/blob/main/docs/mcp-toolshare.md)
and [ADR 0014](https://github.com/systemind-team/SharedOS/blob/main/docs/adr/0014-mcp-toolshare.md).

SharedOS is currently a `1.0.0` preview.

## Classes

### McpToolServer

Defined in: [mcp/src/server.ts:111](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L111)

SharedOS's catalogue and authorization broker, spoken as MCP.

The server is transport-agnostic on purpose: it turns one JSON-RPC message
into one JSON-RPC response, and knows nothing about stdio, HTTP, sessions, or
processes. That is what lets the same translation be exercised deterministically
in a unit test and then serve a live CLI without changing the code under test.

It holds no policy. Every `tools/call` is handed to the invoker, which puts it
through `RuntimeHost.invokeTool` and the kernel; the server never decides that
a call should be refused, and never decides that one should be allowed. Its
one substantive job is translation, and the translation rule that matters is
that a SharedOS refusal is a _tool result_, never a transport error --
see [toCallToolResult](#tocalltoolresult).

#### Constructors

##### Constructor

> **new McpToolServer**(`options`): [`McpToolServer`](#mcptoolserver)

Defined in: [mcp/src/server.ts:120](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L120)

###### Parameters

| Parameter | Type                                            |
| --------- | ----------------------------------------------- |
| `options` | [`McpToolServerOptions`](#mcptoolserveroptions) |

###### Returns

[`McpToolServer`](#mcptoolserver)

#### Accessors

##### initialized

###### Get Signature

> **get** **initialized**(): `boolean`

Defined in: [mcp/src/server.ts:133](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L133)

###### Returns

`boolean`

##### protocolVersion

###### Get Signature

> **get** **protocolVersion**(): `string` \| `undefined`

Defined in: [mcp/src/server.ts:129](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L129)

The revision agreed with this client, once `initialize` has been answered.

###### Returns

`string` \| `undefined`

#### Methods

##### handle()

> **handle**(`message`, `signal`): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `undefined`>\>

Defined in: [mcp/src/server.ts:144](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L144)

Handle one JSON-RPC message.

Returns `undefined` for a notification, which is what JSON-RPC requires: a
notification has no id and therefore no addressable reply, including when it
is malformed.

###### Parameters

| Parameter | Type          |
| --------- | ------------- |
| `message` | `unknown`     |
| `signal`  | `AbortSignal` |

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `undefined`\>

---

### SharedOSToolBridge

Defined in: [mcp/src/bridge.ts:68](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L68)

A turn-scoped MCP tool broker.

The lifecycle is the whole design. `ContextToolProvider` exists so one user's
MCP catalogue never mutates a registry shared with concurrent users, and this
carries that invariant across the harness boundary: the catalogue is computed
for one `AccessContext`, exposed for the length of one turn, and torn down
with it. There is no long-lived SharedOS MCP server holding a union of every
user's tools, because such a server would have to re-derive who is asking on
every call, and would be wrong once.

After [close](#close), the bridge answers nothing. A harness process that
outlives its turn -- and they do, on cancellation and on timeout -- finds a
door that is shut rather than one that still opens onto a turn that has ended.

#### Implements

- [`McpToolInvoker`](#mcptoolinvoker)

#### Constructors

##### Constructor

> **new SharedOSToolBridge**(`options`): [`SharedOSToolBridge`](#sharedostoolbridge)

Defined in: [mcp/src/bridge.ts:77](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L77)

###### Parameters

| Parameter | Type                                              |
| --------- | ------------------------------------------------- |
| `options` | [`OpenToolBridgeOptions`](#opentoolbridgeoptions) |

###### Returns

[`SharedOSToolBridge`](#sharedostoolbridge)

#### Accessors

##### aliases

###### Get Signature

> **get** **aliases**(): readonly [`ToolAliasRecord`](#toolaliasrecord)[]

Defined in: [mcp/src/bridge.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L92)

Names the harness rewrote, in the order they were seen.

Carried here rather than on the `ToolCall` so it is structurally impossible
for an alias to reach the kernel. A host that wants the diagnostic detail in
its execution record reads it from the bridge afterwards; nothing on the
authorization path can read it at all.

###### Returns

readonly [`ToolAliasRecord`](#toolaliasrecord)[]

##### closed

###### Get Signature

> **get** **closed**(): `boolean`

Defined in: [mcp/src/bridge.ts:96](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L96)

###### Returns

`boolean`

#### Methods

##### catalog()

> **catalog**(`signal`): `Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

Defined in: [mcp/src/bridge.ts:100](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L100)

The permission-filtered catalogue for this session.

###### Parameters

| Parameter | Type          |
| --------- | ------------- |
| `signal`  | `AbortSignal` |

###### Returns

`Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

###### Implementation of

[`McpToolInvoker`](#mcptoolinvoker).[`catalog`](#catalog-1)

##### close()

> **close**(): `void`

Defined in: [mcp/src/bridge.ts:129](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L129)

###### Returns

`void`

##### invoke()

> **invoke**(`invocation`, `signal`): `Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

Defined in: [mcp/src/bridge.ts:109](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L109)

One call, re-authorized against the arguments actually presented.

###### Parameters

| Parameter    | Type                                      |
| ------------ | ----------------------------------------- |
| `invocation` | [`McpToolInvocation`](#mcptoolinvocation) |
| `signal`     | `AbortSignal`                             |

###### Returns

`Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

###### Implementation of

[`McpToolInvoker`](#mcptoolinvoker).[`invoke`](#invoke-1)

## Interfaces

### BridgeKernel

Defined in: [mcp/src/bridge.ts:149](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L149)

The kernel surface a bridge needs when it is not running inside a turn.

#### Methods

##### invokeTool()

> **invokeTool**(`context`, `call`, `options?`): `Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

Defined in: [mcp/src/bridge.ts:154](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L154)

###### Parameters

| Parameter                        | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context`                        | \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \} |
| `context.actor`                  | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.authority`              | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.enabledToolNamespaces?` | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.executionId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.namespaceId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.now?`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.owner?`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.purpose?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.traceId?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `call?`                          | \{ `arguments`: [`JsonObject`](sharedos-contracts.md#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `call.arguments?`                | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `call.id?`                       | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `call.requestedAt?`              | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `call.tool?`                     | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `call.traceId?`                  | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `options?`                       | \{ `signal?`: `AbortSignal`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `options.signal?`                | `AbortSignal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

###### Returns

`Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

##### listPublishedTools()

> **listPublishedTools**(`context`, `options`): `Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

Defined in: [mcp/src/bridge.ts:150](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L150)

###### Parameters

| Parameter                       | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context`                       | \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \} |
| `context.actor`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.authority`             | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.enabledToolNamespaces` | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.executionId?`          | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.namespaceId`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.now`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.owner`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.purpose`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.traceId`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `options`                       | \{ `executionId`: `string`; `signal?`: `AbortSignal`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `options.executionId`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `options.signal?`               | `AbortSignal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

###### Returns

`Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

---

### BridgeToolInvoker

Defined in: [mcp/src/bridge.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L28)

The effectful surface a bridge is allowed to reach.

Structurally satisfied by `RuntimeHost`, which is the intended binding: a
bridge opened inside a turn puts every `tools/call` through the execution
envelope, so the call is counted against the turn's `maxToolCalls`, checked
against the effective catalogue, and re-authorized by the kernel -- the same
path a native runtime's calls take, with no second enforcement path added for
MCP. A harness keeps its own loop and declares no step, so `maxSteps` does not
apply on this path: it is bounded by calls.

Declared structurally rather than imported so this package does not depend on
the runtime package. The dependency would be harmless; the absence is the
point, because it makes it impossible for a bridge to reach any part of the
turn machinery other than the one method that re-authorizes.

#### Methods

##### invokeTool()

> **invokeTool**(`call`): `Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

Defined in: [mcp/src/bridge.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L29)

###### Parameters

| Parameter          | Type                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call`             | \{ `arguments`: [`JsonObject`](sharedos-contracts.md#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \} |
| `call.arguments`   | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                     |
| `call.id`          | `string`                                                                                                                                             |
| `call.requestedAt` | `string`                                                                                                                                             |
| `call.tool`        | `string`                                                                                                                                             |
| `call.traceId`     | `string`                                                                                                                                             |

###### Returns

`Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

---

### BridgeTurnContext

Defined in: [mcp/src/bridge.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L33)

What the bridge needs of the turn's sanitised context: identity, not authority.

#### Properties

| Property                                | Modifier   | Type     | Defined in                                                                                                  |
| --------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-now"></a> `now`         | `readonly` | `string` | [mcp/src/bridge.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L35) |
| <a id="property-traceid"></a> `traceId` | `readonly` | `string` | [mcp/src/bridge.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L34) |

---

### DeclareToolPolicyOptions

Defined in: [mcp/src/policy.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L8)

A host declaration of the tool surface, never proof of process isolation.

#### Properties

| Property                                               | Modifier   | Type                                        | Description                                                                    | Defined in                                                                                                  |
| ------------------------------------------------------ | ---------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-evidence"></a> `evidence?`             | `readonly` | readonly `string`[]                         | References supporting this declaration; these are not isolation attestations.  | [mcp/src/policy.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L19) |
| <a id="property-externaldirect"></a> `externalDirect?` | `readonly` | readonly `string`[]                         | MCP servers the harness was configured with independently.                     | [mcp/src/policy.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L17) |
| <a id="property-harnesslocal"></a> `harnessLocal?`     | `readonly` | readonly `string`[]                         | All local tools outside the broker, including shell, writes, and reads.        | [mcp/src/policy.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L15) |
| <a id="property-inventory"></a> `inventory?`           | `readonly` | `"unknown"` \| `"complete"`                 | Unknown unless the host explicitly attests a complete inventory with evidence. | [mcp/src/policy.ts:11](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L11) |
| <a id="property-managedmcp"></a> `managedMcp?`         | `readonly` | readonly `string`[]                         | SharedOS MCP endpoints. Defaults to the one this package serves.               | [mcp/src/policy.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L13) |
| <a id="property-mode"></a> `mode?`                     | `readonly` | `"unknown"` \| `"broker-only"` \| `"mixed"` | -                                                                              | [mcp/src/policy.ts:9](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L9)   |

---

### HarnessMcpConfigFile

Defined in: [mcp/src/harness-config.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L45)

One generated file: what to write, and what a harness expects it to be called.

#### Properties

| Property                                  | Modifier   | Type     | Defined in                                                                                                                  |
| ----------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-contents"></a> `contents` | `readonly` | `string` | [mcp/src/harness-config.ts:48](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L48) |
| <a id="property-filename"></a> `filename` | `readonly` | `string` | [mcp/src/harness-config.ts:47](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L47) |
| <a id="property-harness"></a> `harness`   | `readonly` | `string` | [mcp/src/harness-config.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L46) |

---

### HarnessMcpConnection

Defined in: [mcp/src/harness-config.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L24)

Harness configuration, which declares a CONNECTION and nothing else.

This is the architectural rule the whole boundary rests on, and it is worth
stating where the files are generated:

    Harness configuration declares a CONNECTION.
    SharedOS declares the TOOLS.
    SharedOS capabilities declare the AUTHORITY.
    RuntimeHost is the only EXECUTION path.

So every emitter here produces a few lines naming a URL. None of them enumerate
tools, and none of them can: the catalogue is resolved per turn from the access
context, and a file on disk cannot know who is asking. A harness setting that
looks like authorization -- Codex's `enabled_tools`, Claude's `allowedTools` --
is defense in depth and UX policy over a catalogue SharedOS already filtered,
never the thing that decides.

#### Properties

| Property                                       | Modifier   | Type     | Description                                                                             | Defined in                                                                                                                  |
| ---------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-name"></a> `name?`             | `readonly` | `string` | The server name the harness will namespace its aliases under.                           | [mcp/src/harness-config.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L28) |
| <a id="property-timeoutsec"></a> `timeoutSec?` | `readonly` | `number` | Per-call timeout in the emitted config. Set by nothing today; see `docs/open-items.md`. | [mcp/src/harness-config.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L30) |
| <a id="property-token"></a> `token?`           | `readonly` | `string` | Bearer token for a sandboxed or remote harness.                                         | [mcp/src/harness-config.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L32) |
| <a id="property-url"></a> `url`                | `readonly` | `string` | The Streamable HTTP endpoint the turn-scoped bridge is serving.                         | [mcp/src/harness-config.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L26) |

---

### JsonRpcErrorBody

Defined in: [mcp/src/protocol.ts:61](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L61)

#### Properties

| Property                                | Modifier   | Type      | Defined in                                                                                                      |
| --------------------------------------- | ---------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| <a id="property-code"></a> `code`       | `readonly` | `number`  | [mcp/src/protocol.ts:62](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L62) |
| <a id="property-data"></a> `data?`      | `readonly` | `unknown` | [mcp/src/protocol.ts:64](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L64) |
| <a id="property-message"></a> `message` | `readonly` | `string`  | [mcp/src/protocol.ts:63](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L63) |

---

### JsonRpcFailure

Defined in: [mcp/src/protocol.ts:73](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L73)

#### Properties

| Property                                | Modifier   | Type                                    | Defined in                                                                                                      |
| --------------------------------------- | ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| <a id="property-error"></a> `error`     | `readonly` | [`JsonRpcErrorBody`](#jsonrpcerrorbody) | [mcp/src/protocol.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L76) |
| <a id="property-id"></a> `id`           | `readonly` | `string` \| `number` \| `null`          | [mcp/src/protocol.ts:75](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L75) |
| <a id="property-jsonrpc"></a> `jsonrpc` | `readonly` | `"2.0"`                                 | [mcp/src/protocol.ts:74](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L74) |

---

### JsonRpcSuccess

Defined in: [mcp/src/protocol.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L67)

#### Properties

| Property                                  | Modifier   | Type                 | Defined in                                                                                                      |
| ----------------------------------------- | ---------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| <a id="property-id-1"></a> `id`           | `readonly` | `string` \| `number` | [mcp/src/protocol.ts:69](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L69) |
| <a id="property-jsonrpc-1"></a> `jsonrpc` | `readonly` | `"2.0"`              | [mcp/src/protocol.ts:68](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L68) |
| <a id="property-result"></a> `result`     | `readonly` | `unknown`            | [mcp/src/protocol.ts:70](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L70) |

---

### KernelToolBridgeOptions

Defined in: [mcp/src/bridge.ts:161](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L161)

#### Properties

| Property                                        | Modifier   | Type                                                                                                                                                                                                       | Description                                                      | Defined in                                                                                                    |
| ----------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| <a id="property-context"></a> `context`         | `readonly` | `object`                                                                                                                                                                                                   | The trusted context. Never built from anything the harness sent. | [mcp/src/bridge.ts:164](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L164) |
| `context.actor`                                 | `public`   | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                | contracts/dist/access.d.ts:151                                                                                |
| `context.authority`                             | `public`   | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                | contracts/dist/access.d.ts:164                                                                                |
| `context.enabledToolNamespaces`                 | `public`   | `string`[]                                                                                                                                                                                                 | -                                                                | contracts/dist/access.d.ts:177                                                                                |
| `context.executionId?`                          | `public`   | `string`                                                                                                                                                                                                   | -                                                                | contracts/dist/access.d.ts:179                                                                                |
| `context.namespaceId`                           | `public`   | `string`                                                                                                                                                                                                   | -                                                                | contracts/dist/access.d.ts:148                                                                                |
| `context.now`                                   | `public`   | `string`                                                                                                                                                                                                   | -                                                                | contracts/dist/access.d.ts:178                                                                                |
| `context.owner`                                 | `public`   | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                | contracts/dist/access.d.ts:135                                                                                |
| `context.purpose`                               | `public`   | `string`                                                                                                                                                                                                   | -                                                                | contracts/dist/access.d.ts:149                                                                                |
| `context.traceId`                               | `public`   | `string`                                                                                                                                                                                                   | -                                                                | contracts/dist/access.d.ts:150                                                                                |
| <a id="property-executionid"></a> `executionId` | `readonly` | `string`                                                                                                                                                                                                   | -                                                                | [mcp/src/bridge.ts:165](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L165) |
| <a id="property-kernel"></a> `kernel`           | `readonly` | [`BridgeKernel`](#bridgekernel)                                                                                                                                                                            | -                                                                | [mcp/src/bridge.ts:162](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L162) |

---

### McpServerInfo

Defined in: [mcp/src/server.ts:60](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L60)

#### Properties

| Property                                | Modifier   | Type     | Defined in                                                                                                  |
| --------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-name-1"></a> `name`     | `readonly` | `string` | [mcp/src/server.ts:61](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L61) |
| <a id="property-version"></a> `version` | `readonly` | `string` | [mcp/src/server.ts:62](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L62) |

---

### McpToolInvocation

Defined in: [mcp/src/server.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L36)

One `tools/call`, after the exposed name has been mapped back to canonical.

#### Properties

| Property                                    | Modifier   | Type                                             | Description                                                               | Defined in                                                                                                  |
| ------------------------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-alias"></a> `alias?`        | `readonly` | `string`                                         | The name the harness actually sent, when it was not the canonical one.    | [mcp/src/server.ts:42](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L42) |
| <a id="property-arguments"></a> `arguments` | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | -                                                                         | [mcp/src/server.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L40) |
| <a id="property-callid"></a> `callId`       | `readonly` | `string`                                         | -                                                                         | [mcp/src/server.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L37) |
| <a id="property-tool"></a> `tool`           | `readonly` | `string`                                         | The canonical SharedOS tool name, or the raw one when it matched nothing. | [mcp/src/server.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L39) |

---

### McpToolInvoker

Defined in: [mcp/src/server.ts:53](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L53)

What the MCP surface is allowed to do, and the only thing it is allowed to do.

Discovery and invocation, nothing else. There is no method here for reading
grants, resolving authority, or listing what a call _would_ need: the server
is a projection and a doorway, and every question about authority is answered
on the other side of it.

#### Methods

##### catalog()

> **catalog**(`signal`): `Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

Defined in: [mcp/src/server.ts:55](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L55)

The permission-filtered catalogue for this session.

###### Parameters

| Parameter | Type          |
| --------- | ------------- |
| `signal`  | `AbortSignal` |

###### Returns

`Promise`\<\{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

##### invoke()

> **invoke**(`invocation`, `signal`): `Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

Defined in: [mcp/src/server.ts:57](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L57)

One call, re-authorized against the arguments actually presented.

###### Parameters

| Parameter    | Type                                      |
| ------------ | ----------------------------------------- |
| `invocation` | [`McpToolInvocation`](#mcptoolinvocation) |
| `signal`     | `AbortSignal`                             |

###### Returns

`Promise`\<\{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>

---

### McpToolServerOptions

Defined in: [mcp/src/server.ts:65](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L65)

#### Properties

| Property                                           | Modifier   | Type                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Defined in                                                                                                  |
| -------------------------------------------------- | ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-createid"></a> `createId?`         | `readonly` | () => `string`                          | Mints the SharedOS call id for one `tools/call`.                                                                                                                                                                                                                                                                                                                                                                                                                | [mcp/src/server.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L71) |
| <a id="property-instructions"></a> `instructions?` | `readonly` | `string`                                | Guidance handed to the client at initialize time.                                                                                                                                                                                                                                                                                                                                                                                                               | [mcp/src/server.ts:69](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L69) |
| <a id="property-invoker"></a> `invoker`            | `readonly` | [`McpToolInvoker`](#mcptoolinvoker)     | -                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [mcp/src/server.ts:66](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L66) |
| <a id="property-serverinfo"></a> `serverInfo?`     | `readonly` | [`McpServerInfo`](#mcpserverinfo)       | -                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [mcp/src/server.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L67) |
| <a id="property-spans"></a> `spans?`               | `readonly` | [`SpanSink`](sharedos-core.md#spansink) | Where the cost of answering one frame is reported. This is the span that bounds enforcement over the toolshare path: it opens when a frame arrives here and closes when the response leaves, so the model's own thinking time is outside it by construction rather than by subtraction. What is also outside it, and cannot be brought in, is the vendor CLI's own tool router -- that code runs before a frame reaches this server and SharedOS never sees it. | [mcp/src/server.ts:82](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L82) |

---

### OpenToolBridgeOptions

Defined in: [mcp/src/bridge.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L45)

#### Properties

| Property                                          | Modifier   | Type                                      | Description                                           | Defined in                                                                                                  |
| ------------------------------------------------- | ---------- | ----------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-context-1"></a> `context`         | `readonly` | [`BridgeTurnContext`](#bridgeturncontext) | -                                                     | [mcp/src/bridge.ts:47](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L47) |
| <a id="property-executionid-1"></a> `executionId` | `readonly` | `string`                                  | -                                                     | [mcp/src/bridge.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L46) |
| <a id="property-host"></a> `host`                 | `readonly` | [`BridgeToolInvoker`](#bridgetoolinvoker) | -                                                     | [mcp/src/bridge.ts:50](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L50) |
| <a id="property-tools"></a> `tools`               | `readonly` | readonly `object`[]                       | The permission-filtered catalogue this turn resolved. | [mcp/src/bridge.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L49) |

---

### ToolAliasRecord

Defined in: [mcp/src/bridge.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L39)

One harness-side rewrite, kept for diagnosis and never for authorization.

#### Properties

| Property                              | Modifier   | Type     | Defined in                                                                                                  |
| ------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| <a id="property-alias-1"></a> `alias` | `readonly` | `string` | [mcp/src/bridge.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L40) |
| <a id="property-at"></a> `at`         | `readonly` | `string` | [mcp/src/bridge.ts:42](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L42) |
| <a id="property-tool-1"></a> `tool`   | `readonly` | `string` | [mcp/src/bridge.ts:41](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L41) |

---

### VerifyExecutionTokenOptions

Defined in: [mcp/src/token.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L76)

#### Properties

| Property                               | Modifier   | Type                                                                                                                                    | Description                                                         | Defined in                                                                                                |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| <a id="property-expect"></a> `expect?` | `readonly` | `Partial`\<\{ `actor`: `string`; `catalogHash`: `string`; `executionId`: `string`; `expiresAt`: `string`; `namespaceId`: `string`; \}\> | Claims the session already knows, each of which must match exactly. | [mcp/src/token.ts:80](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L80) |
| <a id="property-now-1"></a> `now`      | `readonly` | `string`                                                                                                                                | The instant to judge expiry against. RFC 3339.                      | [mcp/src/token.ts:78](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L78) |

## Type Aliases

### CallToolParams

> **CallToolParams** = `z.infer`\<_typeof_ [`CallToolParamsSchema`](#calltoolparamsschema)>\>

Defined in: [mcp/src/protocol.ts:117](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L117)

---

### ExecutionTokenClaims

> **ExecutionTokenClaims** = `z.infer`\<_typeof_ [`ExecutionTokenClaimsSchema`](#executiontokenclaimsschema)>\>

Defined in: [mcp/src/token.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L34)

---

### ExecutionTokenRejection

> **ExecutionTokenRejection** = `"malformed"` \| `"signature_mismatch"` \| `"expired"` \| `"claims_mismatch"`

Defined in: [mcp/src/token.ts:48](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L48)

---

### ExecutionTokenVerification

> **ExecutionTokenVerification** = \{ `claims`: [`ExecutionTokenClaims`](#executiontokenclaims); `valid`: `true`; \} \| \{ `reason`: [`ExecutionTokenRejection`](#executiontokenrejection); `valid`: `false`; \}

Defined in: [mcp/src/token.ts:51](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L51)

---

### InitializeParams

> **InitializeParams** = `z.infer`\<_typeof_ [`InitializeParamsSchema`](#initializeparamsschema)>\>

Defined in: [mcp/src/protocol.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L108)

---

### JsonRpcId

> **JsonRpcId** = `z.infer`\<_typeof_ [`JsonRpcIdSchema`](#jsonrpcidschema)>\>

Defined in: [mcp/src/protocol.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L37)

---

### JsonRpcNotification

> **JsonRpcNotification** = `z.infer`\<_typeof_ [`JsonRpcNotificationSchema`](#jsonrpcnotificationschema)>\>

Defined in: [mcp/src/protocol.ts:59](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L59)

---

### JsonRpcRequest

> **JsonRpcRequest** = `z.infer`\<_typeof_ [`JsonRpcRequestSchema`](#jsonrpcrequestschema)>\>

Defined in: [mcp/src/protocol.ts:47](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L47)

---

### JsonRpcResponse

> **JsonRpcResponse** = [`JsonRpcSuccess`](#jsonrpcsuccess) \| [`JsonRpcFailure`](#jsonrpcfailure)

Defined in: [mcp/src/protocol.ts:79](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L79)

---

### McpHarnessId

> **McpHarnessId** = _typeof_ [`MCP_HARNESS_IDS`](#mcp_harness_ids)\[`number`\]

Defined in: [mcp/src/harness-config.ts:222](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L222)

## Variables

### CallToolParamsSchema

> `const` **CallToolParamsSchema**: `ZodObject`\<\{ `_meta`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `arguments`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `name`: `ZodString`; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `_meta`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `arguments`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `name`: `ZodString`; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `_meta`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `arguments`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `name`: `ZodString`; \}, `ZodTypeAny`, `"passthrough"`>>\>\>

Defined in: [mcp/src/protocol.ts:110](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L110)

---

### ExecutionTokenClaimsSchema

> `const` **ExecutionTokenClaimsSchema**: `ZodObject`\<\{ `actor`: `ZodString`; `catalogHash`: `ZodString`; `executionId`: `ZodString`; `expiresAt`: `ZodString`; `namespaceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: `string`; `catalogHash`: `string`; `executionId`: `string`; `expiresAt`: `string`; `namespaceId`: `string`; \}, \{ `actor`: `string`; `catalogHash`: `string`; `executionId`: `string`; `expiresAt`: `string`; `namespaceId`: `string`; \}\>

Defined in: [mcp/src/token.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L20)

What a short-lived execution token asserts.

It identifies a broker session and nothing more. There are deliberately no
grants, no capabilities, and no authority in these claims: a token is a way to
find the right turn-scoped bridge, not a bearer of permission. Whoever
presents it still gets exactly the catalogue that turn's `AccessContext`
resolved, and every call it makes is still authorized from the trusted grant
source at the moment of the call.

`catalogHash` is bound in so a token cannot be replayed against a session that
is serving a different tool set -- the case where a stale sandbox reconnects
after the catalogue changed, and would otherwise call tools it was never
shown.

---

### InitializeParamsSchema

> `const` **InitializeParamsSchema**: `ZodObject`\<\{ `capabilities`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `clientInfo`: `ZodOptional`\<`ZodObject`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>>>\>\>\>; `protocolVersion`: `ZodOptional`\<`ZodString`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `capabilities`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `clientInfo`: `ZodOptional`\<`ZodObject`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>>>\>\>\>; `protocolVersion`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `capabilities`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`>>\>\>; `clientInfo`: `ZodOptional`\<`ZodObject`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `name`: `ZodOptional`\<`ZodString`>\>; `version`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>>>\>\>\>; `protocolVersion`: `ZodOptional`\<`ZodString`>\>; \}, `ZodTypeAny`, `"passthrough"`>>\>\>

Defined in: [mcp/src/protocol.ts:98](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L98)

---

### JSON\_RPC\_INTERNAL\_ERROR

> `const` **JSON\_RPC\_INTERNAL\_ERROR**: `-32603` = `-32_603`

Defined in: [mcp/src/protocol.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L34)

---

### JSON\_RPC\_INVALID\_PARAMS

> `const` **JSON\_RPC\_INVALID\_PARAMS**: `-32602` = `-32_602`

Defined in: [mcp/src/protocol.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L33)

---

### JSON\_RPC\_INVALID\_REQUEST

> `const` **JSON\_RPC\_INVALID\_REQUEST**: `-32600` = `-32_600`

Defined in: [mcp/src/protocol.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L31)

---

### JSON\_RPC\_METHOD\_NOT\_FOUND

> `const` **JSON\_RPC\_METHOD\_NOT\_FOUND**: `-32601` = `-32_601`

Defined in: [mcp/src/protocol.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L32)

---

### JSON\_RPC\_PARSE\_ERROR

> `const` **JSON\_RPC\_PARSE\_ERROR**: `-32700` = `-32_700`

Defined in: [mcp/src/protocol.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L30)

JSON-RPC 2.0 error codes.

These are for messages that could not be processed at all. A SharedOS refusal
is never one of them: a denial is a processed request whose answer is `no`, and
it returns as a tool result. See `toCallToolResult`.

---

### JsonRpcIdSchema

> `const` **JsonRpcIdSchema**: `ZodUnion`\<\[`ZodString`, `ZodNumber`\]\>

Defined in: [mcp/src/protocol.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L36)

---

### JsonRpcNotificationSchema

> `const` **JsonRpcNotificationSchema**: `ZodEffects`\<`ZodObject`\<\{ `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>>\>\>, `objectOutputType`\<\{ `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>>\>\>

Defined in: [mcp/src/protocol.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L49)

---

### JsonRpcRequestSchema

> `const` **JsonRpcRequestSchema**: `ZodObject`\<\{ `id`: `ZodUnion`\<\[`ZodString`, `ZodNumber`\]\>; `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `"passthrough"`, `ZodTypeAny`, `objectOutputType`\<\{ `id`: `ZodUnion`\<\[`ZodString`, `ZodNumber`\]\>; `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>\>, `objectInputType`\<\{ `id`: `ZodUnion`\<\[`ZodString`, `ZodNumber`\]\>; `jsonrpc`: `ZodLiteral`\<`"2.0"`>\>; `method`: `ZodString`; `params`: `ZodOptional`\<`ZodUnknown`>\>; \}, `ZodTypeAny`, `"passthrough"`>>\>\>

Defined in: [mcp/src/protocol.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L39)

---

### LATEST\_MCP\_PROTOCOL\_VERSION

> `const` **LATEST\_MCP\_PROTOCOL\_VERSION**: `"2025-06-18"` = `"2025-06-18"`

Defined in: [mcp/src/protocol.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L21)

---

### MCP\_HARNESS\_IDS

> `const` **MCP\_HARNESS\_IDS**: readonly \[`"codex"`, `"claude-code"`, `"deepseek"`, `"pi"`\]

Defined in: [mcp/src/harness-config.ts:221](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L221)

The harnesses this package emits a connection for, by id.

---

### SHAREDOS\_MCP\_SERVER\_NAME

> `const` **SHAREDOS\_MCP\_SERVER\_NAME**: `"sharedos"` = `"sharedos"`

Defined in: [mcp/src/server.ts:85](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L85)

---

### SUPPORTED\_MCP\_PROTOCOL\_VERSIONS

> `const` **SUPPORTED\_MCP\_PROTOCOL\_VERSIONS**: readonly `string`[]

Defined in: [mcp/src/protocol.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L15)

Protocol revisions this server speaks, newest first.

## Functions

### canonicalActor()

> **canonicalActor**(`address`): `string`

Defined in: [mcp/src/token.ts:44](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L44)

The one string form of an address a token carries as its `actor`.

`<kind>:<id>`, from the same `[kind, id]` pair `addressPath` derives for a
recipient-scoped grant, so the two never spell an address differently. It is
a label for equality, not an encoding: nothing parses it back into an
`Address`, and a token is matched on the exact string it was minted with.

#### Parameters

| Parameter | Type                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address` | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} |

#### Returns

`string`

---

### claudeAgentSdkMcpOptions()

> **claudeAgentSdkMcpOptions**(`connection`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [mcp/src/harness-config.ts:126](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L126)

Claude Agent SDK options for a non-interactive evaluation.

`allowedTools` auto-approves the SharedOS server, which is the correct setting
precisely because it is not an authorization decision: Claude separates tool
availability from permission prompting, and prompting a human for a run with no
human in it would stall the eval rather than secure it. What secures it is that
every one of those calls is re-authorized by the kernel.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### claudeCodeMcpConfig()

> **claudeCodeMcpConfig**(`connection`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [mcp/src/harness-config.ts:102](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L102)

Claude Code's `.mcp.json`.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### codexMcpConfig()

> **codexMcpConfig**(`connection`): `string`

Defined in: [mcp/src/harness-config.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L92)

Codex's `config.toml` fragment: [codexMcpServerSettings](#codexmcpserversettings) as a table.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

`string`

---

### codexMcpServerSettings()

> **codexMcpServerSettings**(`connection`): readonly readonly \[`string`, `string`\][]

Defined in: [mcp/src/harness-config.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L76)

The settings a Codex MCP server entry carries, as key and TOML value.

One list serves both forms Codex accepts -- the `[mcp_servers.<name>]` table
[codexMcpConfig](#codexmcpconfig) emits, and the `-c mcp_servers.<name>.<key>=<value>`
overrides a launch passes -- so the two cannot disagree. `bearer_token`,
present only when the connection carries one, belongs to the file alone: a
launch keeps it off the command line.

`required = true` is deliberate. A Codex run whose SharedOS server failed to
start should not quietly continue with only its own tools -- that run would
look like a harness that declined to use the catalogue, which is a different
finding entirely.

`default_tools_approval_mode = "approve"` is the same decision as Claude
Code's `--allowedTools`, and not an authorization one. Codex gates MCP calls
itself, and its default mode, `auto`, decides from the tool's `readOnlyHint`:
read-only tools run, everything else asks a human. A run with no human then
refuses every write inside Codex, with the kernel never consulted. `approve`
is scoped to this one server, leaves Codex's shell sandbox alone, and hands
the decision to the only thing that should be making it:
`RuntimeHost.invokeTool`, which re-authorizes every call.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

readonly readonly \[`string`, `string`\][]

---

### declareToolPolicy()

> **declareToolPolicy**(`options?`): `object`

Defined in: [mcp/src/policy.ts:22](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L22)

#### Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `options` | [`DeclareToolPolicyOptions`](#declaretoolpolicyoptions) |

#### Returns

`object`

##### evidence

> **evidence**: `string`[]

##### externalDirect

> **externalDirect**: `string`[]

##### harnessLocal

> **harnessLocal**: `string`[]

##### inventory

> **inventory**: `"unknown"` \| `"complete"`

##### managedMcp

> **managedMcp**: `string`[]

##### mode

> **mode**: `"unknown"` \| `"broker-only"` \| `"mixed"`

##### version

> **version**: `"2"`

---

### deepseekMcpConfig()

> **deepseekMcpConfig**(`connection`): `string`

Defined in: [mcp/src/harness-config.ts:158](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L158)

DeepSeek Harness's plugin patch overlay.

A dsh profile composes an ordered stack of plugin-bundle patch layers, and a
`--patch` overlay is the last one. Its entries are id-targeted: a bare `id:`
entry _overrides_ a plugin already in the tree, and only an `insert:` entry
_adds_ one. Getting that backwards fails quietly -- dsh warns `patch: entry
"..." not found` on stderr and boots without the plugin, which downstream
reads as a harness that declined to use the catalogue rather than as a
misconfigured one.

The plugin itself must already be installed into the profile
(`dsh plugin --profile <name> add @deepseek-ai/dsh-mcp-client`). A patch
activates a plugin; it does not fetch one.

`@deepseek-ai/dsh-mcp-client` then performs `tools/list`, converts the
schemas, and registers each result through `ctx.tools.register()`. Nothing in
this file describes a tool, for the same reason as the others.

`failOnStartupError` is set for the same reason Codex's server is `required`:
a run that quietly continued with only the harness's own tools would look like
a harness that declined to use the catalogue, which is a different finding.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

`string`

---

### harnessMcpConfigFile()

> **harnessMcpConfigFile**(`harness`, `connection`): [`HarnessMcpConfigFile`](#harnessmcpconfigfile)

Defined in: [mcp/src/harness-config.ts:225](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L225)

Every emitter above, addressed by harness id.

#### Parameters

| Parameter    | Type                                                   |
| ------------ | ------------------------------------------------------ |
| `harness`    | `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection)        |

#### Returns

[`HarnessMcpConfigFile`](#harnessmcpconfigfile)

---

### harnessToolAlias()

> **harnessToolAlias**(`serverName`, `tool`): `string`

Defined in: [mcp/src/harness-config.ts:264](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L264)

The harness-facing alias a tool is likely to appear under.

`mcp__<serverName>__<rawName>` is the shape Claude Code, Codex, and DeepSeek
Harness all use, so it is the one assumed here. It is still only an
approximation: DeepSeek normalises the raw name to `[A-Za-z0-9_-]` and, when
that changes the name -- which it does for every dotted SharedOS name --
appends a deterministic hash so two tools can never collapse into one alias.

Which is exactly why nothing may authorize against this. The alias is recorded
so a vendor transcript can be read back to a canonical name, and SharedOS maps
a name it receives back to the catalogue rather than trusting a reconstruction.

#### Parameters

| Parameter    | Type     |
| ------------ | -------- |
| `serverName` | `string` |
| `tool`       | `string` |

#### Returns

`string`

---

### jsonRpcError()

> **jsonRpcError**(`id`, `code`, `message`, `data?`): [`JsonRpcFailure`](#jsonrpcfailure)

Defined in: [mcp/src/protocol.ts:85](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L85)

#### Parameters

| Parameter | Type                           |
| --------- | ------------------------------ |
| `id`      | `string` \| `number` \| `null` |
| `code`    | `number`                       |
| `message` | `string`                       |
| `data?`   | `unknown`                      |

#### Returns

[`JsonRpcFailure`](#jsonrpcfailure)

---

### jsonRpcResult()

> **jsonRpcResult**(`id`, `result`): [`JsonRpcSuccess`](#jsonrpcsuccess)

Defined in: [mcp/src/protocol.ts:81](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L81)

#### Parameters

| Parameter | Type                 |
| --------- | -------------------- |
| `id`      | `string` \| `number` |
| `result`  | `unknown`            |

#### Returns

[`JsonRpcSuccess`](#jsonrpcsuccess)

---

### kernelToolBridge()

> **kernelToolBridge**(`options`): [`McpToolInvoker`](#mcptoolinvoker)

Defined in: [mcp/src/bridge.ts:179](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L179)

A bridge that goes straight to the kernel, for a host serving MCP outside a
turn.

Every kernel guarantee still holds: discovery is filtered, and each call is
re-authorized against the arguments presented. What is absent is the
envelope -- no step or tool-call budget, and no execution event stream -- so a
turn's evidence cannot be assembled from a session served this way. Use
[openToolBridge](#opentoolbridge) inside a turn; use this to expose a catalogue to a
long-running harness the host is supervising by other means.

#### Parameters

| Parameter | Type                                                  |
| --------- | ----------------------------------------------------- |
| `options` | [`KernelToolBridgeOptions`](#kerneltoolbridgeoptions) |

#### Returns

[`McpToolInvoker`](#mcptoolinvoker)

---

### mcpServerName()

> **mcpServerName**(`connection`): `string`

Defined in: [mcp/src/harness-config.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L40)

The server name a harness namespaces its aliases under: the connection's own,
or `sharedos`. The one place the default is applied, so an emitted config, a
launch argument and a turn's metadata cannot name different servers.

#### Parameters

| Parameter    | Type                                                                |
| ------------ | ------------------------------------------------------------------- |
| `connection` | `Pick`\<[`HarnessMcpConnection`](#harnessmcpconnection), `"name"`\> |

#### Returns

`string`

---

### mintExecutionToken()

> **mintExecutionToken**(`claims`, `secret`): `Promise`\<`string`>\>

Defined in: [mcp/src/token.ts:63](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L63)

Sign one execution token.

HMAC-SHA256 over the canonical JSON of the claims, through Web Crypto so this
stays host-neutral. The secret is the host's; SharedOS neither generates nor
stores it, because a broker that mints its own signing key has no way to be
revoked by the host that deployed it.

#### Parameters

| Parameter            | Type                                                                                                                       | Description                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claims`             | \{ `actor`: `string`; `catalogHash`: `string`; `executionId`: `string`; `expiresAt`: `string`; `namespaceId`: `string`; \} | -                                                                                                                                                      |
| `claims.actor`       | `string`                                                                                                                   | The acting principal as [canonicalActor](#canonicalactor) renders it: `<kind>:<id>`, for example `agent:a-1`. Compared by equality, never parsed back. |
| `claims.catalogHash` | `string`                                                                                                                   | -                                                                                                                                                      |
| `claims.executionId` | `string`                                                                                                                   | -                                                                                                                                                      |
| `claims.expiresAt`   | `string`                                                                                                                   | RFC 3339. A token with no expiry is not issued.                                                                                                        |
| `claims.namespaceId` | `string`                                                                                                                   | -                                                                                                                                                      |
| `secret`             | `string`                                                                                                                   | -                                                                                                                                                      |

#### Returns

`Promise`\<`string`\>

---

### negotiateProtocolVersion()

> **negotiateProtocolVersion**(`requested`): `string`

Defined in: [mcp/src/protocol.ts:127](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/protocol.ts#L127)

Negotiate a protocol revision.

A client asking for a revision this server knows gets that revision back,
which is what keeps an older harness working. A client asking for one it does
not know is answered with the newest supported revision rather than an error,
per the MCP negotiation rule: the client then decides whether it can proceed.

#### Parameters

| Parameter   | Type                    |
| ----------- | ----------------------- |
| `requested` | `string` \| `undefined` |

#### Returns

`string`

---

### openToolBridge()

> **openToolBridge**(`options`): [`SharedOSToolBridge`](#sharedostoolbridge)

Defined in: [mcp/src/bridge.ts:144](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/bridge.ts#L144)

Open a turn-scoped bridge over the execution envelope.

#### Parameters

| Parameter | Type                                              |
| --------- | ------------------------------------------------- |
| `options` | [`OpenToolBridgeOptions`](#opentoolbridgeoptions) |

#### Returns

[`SharedOSToolBridge`](#sharedostoolbridge)

---

### parseToolPolicy()

> **parseToolPolicy**(`value`): `object`

Defined in: [mcp/src/policy.ts:51](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L51)

#### Parameters

| Parameter | Type      |
| --------- | --------- |
| `value`   | `unknown` |

#### Returns

`object`

##### evidence

> **evidence**: `string`[]

##### externalDirect

> **externalDirect**: `string`[]

##### harnessLocal

> **harnessLocal**: `string`[]

##### inventory

> **inventory**: `"unknown"` \| `"complete"`

##### managedMcp

> **managedMcp**: `string`[]

##### mode

> **mode**: `"unknown"` \| `"broker-only"` \| `"mixed"`

##### version

> **version**: `"2"`

---

### piMcpConfig()

> **piMcpConfig**(`connection`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [mcp/src/harness-config.ts:204](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/harness-config.ts#L204)

Pi's `.mcp.json`, read by an MCP extension.

Pi ships no MCP client. Reaching an MCP server therefore requires an
extension, and _which_ extension is a host choice rather than something
SharedOS mandates -- `pi-mcp-adapter` is the one this repository is exercised
against, and anything with the same job would serve. The file shape below is
that adapter's, which happens to be Claude Code's shape with its own
lifecycle and timeout keys.

The effect is not identical to a native client, and the difference is worth
knowing when reading a Pi column. The adapter registers a single `mcp` proxy
tool and discovers the catalogue behind it on demand, so Pi's model calls
`mcp({tool: "files.read", ...})` rather than `files.read`, and the
harness-facing surface is one tool wide.

None of that reaches SharedOS: what arrives at the bridge is an ordinary
`tools/call` naming the canonical tool, authorized exactly like any other.
Which is the point of keeping the harness-facing alias out of authorization.

`lifecycle: "eager"` connects at startup rather than on first use, so the
catalogue is fetched inside the turn that opened the bridge rather than at
some later moment the turn may already have closed.

#### Parameters

| Parameter    | Type                                            |
| ------------ | ----------------------------------------------- |
| `connection` | [`HarnessMcpConnection`](#harnessmcpconnection) |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### resolveCanonicalName()

> **resolveCanonicalName**(`tools`, `exposed`): `string`

Defined in: [mcp/src/server.ts:304](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L304)

Map an exposed name back to the canonical SharedOS tool ID.

The canonical name is what SharedOS published, so an exact match is the
ordinary case. The portable form is accepted too, because a transport that
cannot carry a dot will have rewritten it, and refusing the rewrite would turn
a transport limitation into a permission failure.

Anything else is returned unchanged rather than rejected here. A guess at a
tool that was never published has to reach the kernel to be refused and
recorded: resolving it to `undefined` in the adapter would erase the attempt,
and an attempted violation that leaves no trace is the one outcome this
boundary must not produce. Resolution can only ever select a tool already in
the permission-filtered catalogue, so it can never widen authority.

#### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `tools`   | readonly `object`[] |
| `exposed` | `string`            |

#### Returns

`string`

---

### toCallToolResult()

> **toCallToolResult**(`result`, `published?`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [mcp/src/server.ts:331](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L331)

A SharedOS `ToolResult` as an MCP `CallToolResult`.

The rule that matters: a refusal is a _tool_ error, never a transport error.
A JSON-RPC error means the request could not be processed, and a harness that
receives one has no reason to believe anything about its authority -- most
retry, some abandon the turn. A denial is a processed request with an answer,
and the answer is "no". Reporting it as `isError: true` is what lets a harness
learn it was refused, tell the user, and carry on to its next call.

`denied` and `failed` stay distinguishable in the payload. They mean different
things -- policy refused this, versus the tool broke -- and collapsing them
would make a denial rate uncountable from the evidence.

#### Parameters

| Parameter                                | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`                                 | \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \} |
| `published?`                             | \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](sharedos-contracts.md#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](sharedos-contracts.md#jsonobject); \}                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `published.annotations?`                 | \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `published.annotations.destructiveHint?` | `boolean`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `published.annotations.idempotentHint?`  | `boolean`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `published.annotations.openWorldHint?`   | `boolean`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `published.annotations.readOnlyHint?`    | `boolean`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `published.description?`                 | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `published.inputSchema?`                 | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `published.metadata?`                    | \{ `namespace?`: `string`; `source?`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `published.metadata.namespace?`          | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `published.metadata.source?`             | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `published.name?`                        | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `published.outputSchema?`                | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### toMcpTool()

> **toMcpTool**(`tool`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [mcp/src/server.ts:271](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/server.ts#L271)

One published tool in MCP's own shape.

#### Parameters

| Parameter                           | Type                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool`                              | \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](sharedos-contracts.md#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](sharedos-contracts.md#jsonobject); \} |
| `tool.annotations?`                 | \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}                                                                                                                                                                                                                                                                        |
| `tool.annotations.destructiveHint?` | `boolean`                                                                                                                                                                                                                                                                                                                                                                                          |
| `tool.annotations.idempotentHint?`  | `boolean`                                                                                                                                                                                                                                                                                                                                                                                          |
| `tool.annotations.openWorldHint?`   | `boolean`                                                                                                                                                                                                                                                                                                                                                                                          |
| `tool.annotations.readOnlyHint?`    | `boolean`                                                                                                                                                                                                                                                                                                                                                                                          |
| `tool.description`                  | `string`                                                                                                                                                                                                                                                                                                                                                                                           |
| `tool.inputSchema`                  | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                   |
| `tool.metadata?`                    | \{ `namespace?`: `string`; `source?`: `string`; \}                                                                                                                                                                                                                                                                                                                                                 |
| `tool.metadata.namespace?`          | `string`                                                                                                                                                                                                                                                                                                                                                                                           |
| `tool.metadata.source?`             | `string`                                                                                                                                                                                                                                                                                                                                                                                           |
| `tool.name`                         | `string`                                                                                                                                                                                                                                                                                                                                                                                           |
| `tool.outputSchema?`                | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                   |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### toolPolicyHash()

> **toolPolicyHash**(`policy`): `Promise`\<`string`>\>

Defined in: [mcp/src/policy.ts:68](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/policy.ts#L68)

A content identifier for the declared policy, including its evidence references.

#### Parameters

| Parameter               | Type                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy`                | \{ `evidence`: `string`[]; `externalDirect`: `string`[]; `harnessLocal`: `string`[]; `inventory`: `"unknown"` \| `"complete"`; `managedMcp`: `string`[]; `mode`: `"unknown"` \| `"broker-only"` \| `"mixed"`; `version`: `"2"`; \} |
| `policy.evidence`       | `string`[]                                                                                                                                                                                                                         |
| `policy.externalDirect` | `string`[]                                                                                                                                                                                                                         |
| `policy.harnessLocal`   | `string`[]                                                                                                                                                                                                                         |
| `policy.inventory`      | `"unknown"` \| `"complete"`                                                                                                                                                                                                        |
| `policy.managedMcp`     | `string`[]                                                                                                                                                                                                                         |
| `policy.mode`           | `"unknown"` \| `"broker-only"` \| `"mixed"`                                                                                                                                                                                        |
| `policy.version`        | `"2"`                                                                                                                                                                                                                              |

#### Returns

`Promise`\<`string`\>

---

### verifyExecutionToken()

> **verifyExecutionToken**(`token`, `secret`, `options`): `Promise`\<[`ExecutionTokenVerification`](#executiontokenverification)>\>

Defined in: [mcp/src/token.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/mcp/src/token.ts#L92)

Verify a token, then check it against what the session already knows.

Order matters: the signature is checked before the claims are trusted for
anything, including for deciding whether they are worth checking. The
comparison is constant-time, and a mismatch of any kind is reported as a
refusal rather than thrown, so a bad token produces a clean 401 instead of an
exception path that a caller might handle differently from a denial.

#### Parameters

| Parameter | Type                                                          |
| --------- | ------------------------------------------------------------- |
| `token`   | `string`                                                      |
| `secret`  | `string`                                                      |
| `options` | [`VerifyExecutionTokenOptions`](#verifyexecutiontokenoptions) |

#### Returns

`Promise`\<[`ExecutionTokenVerification`](#executiontokenverification)\>
