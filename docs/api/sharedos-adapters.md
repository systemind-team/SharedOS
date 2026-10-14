[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-adapters

# @aicoo/sharedos-adapters

What sits in the SharedOS delegate seat: a model API behind the standard driver,
or a vendor CLI (Codex, Claude Code, DeepSeek Harness, Pi) connected over MCP.

An adapter is translation and nothing else. The permission-filtered tool
catalogue, per-call re-authorization, the turn's limits and audit all come from
the SharedOS execution envelope, so seating another model or another harness
changes no kernel code and adds no second permission path.

## A model in the seat

```ts
import {
  SharedOSExecutor,
  createStandardRuntime,
} from "@aicoo/sharedos-runtime";
import {
  OpenAiCompatibleModelClient,
  StandardTurnDriver,
} from "@aicoo/sharedos-adapters";

const runtime = createStandardRuntime({
  driver: new StandardTurnDriver({
    manifest: { id: "acme.assistant", version: "1.0.0", protocolVersion: "1" },
    client: new OpenAiCompatibleModelClient({ baseUrl, apiKey, model }),
  }),
});
const turns = new SharedOSExecutor(kernel, runtime);
```

`createStandardRuntime` is the SharedOS loop; `StandardTurnDriver` is the
SharedOS driver for it. The driver renders the catalogue into the model's
tool-call shape, reads each reply back into a decision, and recognises the
escalate affordance only when the turn's catalogue offers it. The runtime reports
the seated driver's manifest, so every record names what sat in the seat. A host
with a model path of its own seats its own `AgentTurnDriver` in the same slot.

## A vendor CLI in the seat

```ts
import {
  CLAUDE_CODE_MCP_HARNESS,
  createMcpHarnessRuntime,
} from "@aicoo/sharedos-adapters/node";

const turns = new SharedOSExecutor(
  kernel,
  createMcpHarnessRuntime(CLAUDE_CODE_MCP_HARNESS),
);
```

The CLI keeps its own loop and its own model, and the turn's catalogue is served
to it over the Model Context Protocol for the length of the turn. It is
documented in `docs/mcp-toolshare.md`. A turn served this way is bounded by
`maxToolCalls` and `timeoutMs`; a harness declares no step.

## What can occupy the seat

| Path                | What is in the delegate seat                                       | Entry points                                                                                                                    |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Model               | A model API, with no vendor between it and the kernel              | `StandardTurnDriver` in `createStandardRuntime`; `OpenAiCompatibleModelClient`, or `TranscriptModelClient` for scripted replies |
| Vendor CLI over MCP | A vendor CLI running its own loop, with the catalogue served to it | `createMcpHarnessRuntime` and the `*_MCP_HARNESS` specs, from `@aicoo/sharedos-adapters/node`                                   |
| Host's own driver   | Whatever the host's `AgentTurnDriver` speaks to                    | `createStandardRuntime({ driver })`                                                                                             |

Both converge on `RuntimeHost.invokeTool`, which is the only place a tool is
executed.

Evaluation only: `EvalHarnessDriver` seats a vendor's exact wire format in the
standard loop, over a `HarnessTransport` (`TranscriptTransport` for recorded
frames, `ChildProcessTransport` for a live CLI's stdio). The conformance columns
use it to grade a vendor's codec against the kernel, and it is the one driver
that can declare a step past its budget. It is not a way to run a vendor CLI in
a product: no coding-agent CLI accepts a host-supplied catalogue on its own
protocol, which is what the MCP path is for. Each vendor's codec, manifests and
requirements are stated once as its `*_VENDOR` descriptor.

## What the delegate is told

The catalogue says which tools exist; `RuntimeVisibleContext.reach` says where
they are worth pointing. The execution envelope computes it once per turn, from
the grants every decision in that turn is made against, narrowed to the
namespaces the offered tools operate on. The adapters are where it reaches a
model:

| Path                | Where the reach goes                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Model               | A system message ahead of the prompt                                                                        |
| Vendor CLI over MCP | The server's initialize `instructions`, which a harness that honours them puts where its model reads        |
| Evaluation driver   | `HarnessTurnRequest.instructions`, which the transport hands over; `harnessTurnText` is the two as one text |

Every path takes the same `instructions` option (`SeatTextOptions`): a string is
the host's standing guidance, placed before the turn's reach; a function says
exactly what the seat is told, and `undefined` from it hands over nothing. What
was handed over is hashed with the prompt as the turn's `promptHash`.

`describeReach`, from `@aicoo/sharedos-runtime`, says the same thing on every
path: each entry as its namespace, its path as the JSON array a `path` argument
takes, and whether it covers what lies beneath; an empty reach as "nowhere"; an
`unavailable` reach as exactly that, with its reason code, never as an empty
list. Every rendering says it is descriptive. The kernel decides each call the
model goes on to make, so an entry is not a permission and a missing one is not
a refusal.

## What a seat states about its turn

Every seat here writes its facts about a turn onto `ExecutionResult.metadata`
under one vocabulary, the exported `SeatMetadata` type, so the same fact is under
the same key whichever seat ran. A seat states the keys that apply to it and
leaves the rest absent.

| Key                                           | Stated by           | What it says                                                                                                                                                    |
| --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`, `modelProvider`                      | both                | The standard driver states the model the provider **served**; the MCP harness runtime states the one the run **declared**, because a vendor CLI selects its own |
| `requestedModel`, `modelSettings`             | standard driver     | What was asked for, when the served model may differ                                                                                                            |
| `finishReason`, `inputTokens`, `outputTokens` | standard driver     | Why the last reply ended, and the turn's summed spend; absent, never zero, when the provider reports none                                                       |
| `malformedToolCalls`                          | standard driver     | Calls refused in place for unreadable arguments; none reached the envelope                                                                                      |
| `harness`, `toolshare`, `mcpServer`           | MCP harness runtime | Which vendor CLI ran and how it reached the catalogue                                                                                                           |
| `catalogHash`, `toolAliases`                  | MCP harness runtime | The catalogue the harness was served, and the names it rewrote (diagnostic only)                                                                                |
| `harnessOutcome`, `harnessErrorCode`          | MCP harness runtime | On an escalated turn, how the CLI itself ended                                                                                                                  |
| `callsAfterEscalation`                        | MCP harness runtime | On an escalated turn, calls the CLI made after its ask; each was answered `escalation_pending` and reached no kernel                                            |

The conformance record lifts `model`, `modelProvider`, `catalogHash`, the token
counts and `callsAfterEscalation`; the rest are for the host that ran the turn.
The envelope adds its own keys beside these: `runtime`, `promptHash` and
`escalationAsked`.

## The three pieces of the evaluation driver

A vendor's codec is graded from parts that are replaceable independently, which
is what lets the translation be verified without the vendor's CLI present.

| Piece               | Responsibility                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| `HarnessProtocol`   | The vendor's wire shapes: tool declarations, tool calls, tool results, completion |
| `HarnessTransport`  | How the harness is reached: a subprocess, an HTTP session, a supplied transcript  |
| `EvalHarnessDriver` | An `AgentTurnDriver` that joins the two and hands every tool call to the envelope |

`StandardTurnDriver` is the same shape with the protocol folded in: the catalogue is
rendered straight into the model's tool-call format, and a `ModelClient` stands
where the transport does.

## What the adapter must not do

Tool calls are passed to the envelope as the harness emitted them, including
names that are not in the catalogue.

Filtering them in the adapter would be the adapter quietly enforcing policy, and
worse, it would erase the attempt: a guess at an unexposed tool has to reach the
envelope to be refused and recorded. An adapter that silently dropped it would
make a harness that tried look identical to one that did not.

The one call that does not reach the envelope is the escalation affordance. A
call naming `sharedos.escalate` on a turn whose catalogue offers it ends the
turn `escalated` with the reason the harness gave, because asking for a human is
an ending rather than a tool (ADR 0011, 0017). The catalogue gates the name: on
a turn that was never granted the affordance the call is passed through like any
other and refused `tool_unavailable`.

For the same reason a refusal is reported back to the harness as an ordinary
tool result carrying its reason code, not as a transport error. The harness needs
to know it was refused so it can choose differently. A model whose call
arguments are not a JSON object is answered the same way, `invalid_tool_arguments`,
and never sent `{}` in their place.

Tool calls arriving together in one frame are executed one at a time. SharedOS
re-authorizes every call separately, so serialising them is the conservative
order and the one whose audit trail matches what actually happened.

## Who executes the tools

The four harnesses do not agree on this, and the difference decides what a
driven column can claim.

| Harness     | Catalogue reaches the harness by                           | Tool executed by  |
| ----------- | ---------------------------------------------------------- | ----------------- |
| Codex       | `function` declarations, on the wire                       | The host          |
| Claude Code | `input_schema` tools, on the wire                          | The host          |
| DeepSeek    | Out of band — its `dsh-mcp-client` plugin, over MCP        | The host, via MCP |
| Pi          | Out of band — an MCP extension, or `defineTool` in the SDK | The host, via MCP |

Codex and Claude Code carry a tool catalogue in the protocol itself. DeepSeek
Harness and Pi run their own tools and have no wire frame that means "here is
your catalogue", so their driven adapters stamp `catalogueDelivery: "out-of-band"`
onto every execution record they produce: a column whose catalogue arrived out
of band is making a narrower claim than one whose catalogue was on the wire, and
that belongs in the evidence rather than in a footnote.

It is also why a native run over a CLI's own stdio — any of the four — leaves
the kernel rows `not exercised`: the driver can carry the transport, but a CLI
exposes neither its API layer nor a frame for the catalogue (ADR 0014), so the
harness reaches for its own tools. The MCP path is what closes that gap.
`createMcpHarnessRuntime` serves the permission-filtered catalogue over MCP to a
CLI running natively; `scripts/mcp-conformance.mjs` runs the case set against
each installed CLI that way, and ADR 0018 records what the escalation-case runs
on all four showed.

## Verification status

The translation code is exercised end to end against supplied transcripts, which
run the real protocol modules through a real kernel and a real execution
envelope. Nothing in this package captures a vendor session: a transcript is
whatever its caller hands it, and the conformance suite writes its own.
`TranscriptTransport` replays vendor frames in batches and releases the next
batch only once a result has been written, which is the shape of every
tool-using harness. `TranscriptModelClient` is its counterpart for the model
seat: it replays supplied replies through the real `StandardTurnDriver`, one reply per
model call, and treats a spent transcript as an error rather than a completion,
so a script that ends too early fails the turn instead of reading as a model
choosing to stop.

What a transcript cannot cover is the transport binding — the exact command-line
flags each CLI wants, and the outer envelope it wraps its frames in — and what a
model actually chooses. Two scripts cover exactly those gaps:

- `scripts/native-conformance.mjs` spawns each installed CLI as a driven
  harness, and runs the model column when a key is present;
- `scripts/mcp-conformance.mjs` runs each installed CLI natively against the
  catalogue over MCP.

Both report a harness that is absent, unauthenticated, or emitting shapes the
adapter does not parse as `not exercised`, never as a pass and never as a kernel
failure. The version each run drove is the harness's own to report, so it is
recorded in the artifact the script writes under `artifacts/conformance/` —
local to the machine that ran it, not committed — rather than pinned here; ADR
0014 and ADR 0018 pin the versions of the runs they record.

## Availability

`probeHarness` reports whether a harness can run here, and says why not when it
cannot. `probeCodex`, `probeClaudeCode`, `probeDeepseek`, and `probePi` are the
same call with each adapter's `*_REQUIREMENTS` supplied:

```ts
import { probeClaudeCode } from "@aicoo/sharedos-adapters/node";

const availability = await probeClaudeCode();
// { harness: "claude-code", available: false, reason: "The claude executable is not on PATH." }
// or { harness: "claude-code", available: true, version: "…" }
```

Every one of these harnesses can authenticate from a stored login as well as from
an environment variable, so a probe treats credentials as optional unless the
requirements say otherwise, and reports which one it found. Conformance runs use
this to mark a column as not exercised rather than as failing: an absent harness
is not evidence about SharedOS.

## Reason codes

The codes an adapter ends a turn with — `harness_*`, `model_*` — and the one it
answers in band on the MCP path, `escalation_pending`, are listed with the rest
in `docs/errors.md`.

## Host neutrality

The main entry point has no Node dependency. `ChildProcessTransport`, the
availability probes, and the MCP harness runtime are published from
`@aicoo/sharedos-adapters/node`, because spawning a CLI, reading `PATH`, and
opening a loopback server are host concerns rather than protocol ones.

## Declared tool scope

`createMcpHarnessRuntime(spec, { toolPolicy })` records a version 2 host
inventory before launching the harness. The default is `unknown`; launch flags
alone do not establish inventory completeness or process isolation. Local tools
and independently connected MCP endpoints classify a run as `mixed`.
`broker-only` requires a complete inventory with no outside tools and retained
host evidence. Runtime metadata carries this declaration into execution-record
assembly. See [ADR 0027](_media/0027-tool-policy-classification.md).

## Classes

### EvalHarnessDriver

Defined in: [packages/adapters/src/driver.ts:59](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L59)

One vendor's wire format, seated in the standard loop for evaluation.

It puts SharedOS in the model provider's seat and speaks the vendor's
API-layer tool-call shape exactly, which is how a vendor's codec is graded
against the kernel: over a recorded transcript in the committed conformance
columns, or over a live CLI's stdio in `scripts/native-conformance.mjs`. It is
not how a vendor CLI runs in a product. No coding-agent CLI accepts a
host-supplied catalogue on its own protocol; `createMcpHarnessRuntime` is the
path for that. It is also the one driver that can name a step past its budget
(`declareStep`), which only an evaluation has a reason to do.

A driver is only translation. The turn loop, the permission-filtered
catalogue, per-call re-authorization, and audit all belong to the SharedOS
execution envelope, which is why adding a harness requires no kernel change
and no second enforcement path.

Tool calls are passed through exactly as the harness emitted them, including
names that are not in the catalogue. Filtering those here would be the
adapter quietly enforcing policy, and worse, it would erase the attempt: a
guess at an unexposed tool has to reach the envelope to be refused and
recorded.

#### Implements

- [`AgentTurnDriver`](sharedos-runtime.md#agentturndriver)

#### Constructors

##### Constructor

> **new EvalHarnessDriver**(`options`): [`EvalHarnessDriver`](#evalharnessdriver)

Defined in: [packages/adapters/src/driver.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L67)

###### Parameters

| Parameter | Type                                                    |
| --------- | ------------------------------------------------------- |
| `options` | [`EvalHarnessDriverOptions`](#evalharnessdriveroptions) |

###### Returns

[`EvalHarnessDriver`](#evalharnessdriver)

#### Properties

| Property                                  | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                     |
| ----------------------------------------- | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-manifest"></a> `manifest` | `readonly` | `object`                                         | Who this driver is, for the record. The executor stamps the plugin's manifest on every execution record, and the loop is the same whichever driver is seated, so the loop reports the seated driver's manifest as its own: evidence is filed under what produced it. A driver that states none is reported as `sharedos.standard`. | [packages/adapters/src/driver.ts:60](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L60) |
| `manifest.id`                             | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:9                                                                                         |
| `manifest.metadata?`                      | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject) | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:12                                                                                        |
| `manifest.protocolVersion`                | `public`   | `"1"`                                            | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:11                                                                                        |
| `manifest.version`                        | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:10                                                                                        |

#### Methods

##### open()

> **open**(`request`, `signal`): `Promise`\<[`AgentTurnSession`](sharedos-runtime.md#agentturnsession)>\>

Defined in: [packages/adapters/src/driver.ts:82](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L82)

Open the session one turn is driven through.

A turn cancelled while this is in flight stops waiting for it. A session
handed back after that is still closed, with the turn's ending, so `close`
may be called on a session that was never asked for a decision. A driver
whose `open` rejects releases whatever it had taken itself: there is no
session to close.

###### Parameters

| Parameter | Type                                                           |
| --------- | -------------------------------------------------------------- |
| `request` | [`RuntimeTurnRequest`](sharedos-runtime.md#runtimeturnrequest) |
| `signal`  | `AbortSignal`                                                  |

###### Returns

`Promise`\<[`AgentTurnSession`](sharedos-runtime.md#agentturnsession)\>

###### Implementation of

[`AgentTurnDriver`](sharedos-runtime.md#agentturndriver).[`open`](sharedos-runtime.md#open)

---

### ModelRequestError

Defined in: [packages/adapters/src/model/client.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L107)

A model call that did not produce an answer. Carries no response body.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new ModelRequestError**(`message`, `status?`): [`ModelRequestError`](#modelrequesterror)

Defined in: [packages/adapters/src/model/client.ts:110](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L110)

###### Parameters

| Parameter | Type     |
| --------- | -------- |
| `message` | `string` |
| `status?` | `number` |

###### Returns

[`ModelRequestError`](#modelrequesterror)

###### Overrides

`Error.constructor`

#### Properties

| Property                                                | Modifier   | Type      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       | Inherited from          | Defined in                                                                                                                                   |
| ------------------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-cause"></a> `cause?`                    | `public`   | `unknown` | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.cause`           | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es2022.error.d.ts:26                                                   |
| <a id="property-message"></a> `message`                 | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.message`         | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1077                                                          |
| <a id="property-name"></a> `name`                       | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.name`            | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1076                                                          |
| <a id="property-stack"></a> `stack?`                    | `public`   | `string`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `Error.stack`           | node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1078                                                          |
| <a id="property-status"></a> `status?`                  | `readonly` | `number`  | -                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -                       | [packages/adapters/src/model/client.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L108) |
| <a id="property-stacktracelimit"></a> `stackTraceLimit` | `static`   | `number`  | The `Error.stackTraceLimit` property specifies the number of stack frames collected by a stack trace (whether generated by `new Error().stack` or `Error.captureStackTrace(obj)`). The default value is `10` but may be set to any valid JavaScript number. Changes will affect any stack trace captured _after_ the value has been changed. If set to a non-number value, or set to a negative number, stack traces will not capture any frames. | `Error.stackTraceLimit` | node\_modules/.pnpm/@types+node@22.20.1/node\_modules/@types/node/globals.d.ts:68                                                            |

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

### OpenAiCompatibleModelClient

Defined in: [packages/adapters/src/model/client.ts:213](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L213)

A chat-completions client for any provider speaking the OpenAI wire shape.

DeepSeek is the one this was built against, but nothing here is DeepSeek
specific: the endpoint, model, and provider label are all supplied, so
pointing the column at another compatible provider is configuration rather
than a second client.

#### Implements

- [`ModelClient`](#modelclient)

#### Constructors

##### Constructor

> **new OpenAiCompatibleModelClient**(`options`): [`OpenAiCompatibleModelClient`](#openaicompatiblemodelclient)

Defined in: [packages/adapters/src/model/client.ts:225](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L225)

###### Parameters

| Parameter | Type                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `options` | [`OpenAiCompatibleModelClientOptions`](#openaicompatiblemodelclientoptions) |

###### Returns

[`OpenAiCompatibleModelClient`](#openaicompatiblemodelclient)

#### Properties

| Property                                   | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                                   |
| ------------------------------------------ | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-model"></a> `model`        | `readonly` | `string`                                         | The model this client was configured to ask for.                                                                                                                                                                                                                                                                   | [packages/adapters/src/model/client.ts:214](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L214) |
| <a id="property-provider"></a> `provider`  | `readonly` | `string`                                         | The provider that serves it, recorded alongside the model on every turn.                                                                                                                                                                                                                                           | [packages/adapters/src/model/client.ts:215](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L215) |
| <a id="property-settings"></a> `settings?` | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | Settings this client sends that change what the model does, beyond naming it -- a reasoning mode, say. Recorded on every turn beside the model so two runs under one model name are not read as the same configuration when they were not. Absent when the client sends nothing the provider would not default to. | [packages/adapters/src/model/client.ts:216](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L216) |

#### Methods

##### complete()

> **complete**(`request`, `signal`): `Promise`\<[`ModelReply`](#modelreply)>\>

Defined in: [packages/adapters/src/model/client.ts:243](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L243)

###### Parameters

| Parameter | Type                                                |
| --------- | --------------------------------------------------- |
| `request` | [`ModelCompletionRequest`](#modelcompletionrequest) |
| `signal`  | `AbortSignal`                                       |

###### Returns

`Promise`\<[`ModelReply`](#modelreply)\>

###### Implementation of

[`ModelClient`](#modelclient).[`complete`](#complete-3)

---

### StandardTurnDriver

Defined in: [packages/adapters/src/model/driver.ts:135](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L135)

The SharedOS driver for the standard loop: a model API in the seat.

"Standard" names the SharedOS-owned default at each layer, and this is the
default driver: what `createStandardRuntime` seats when a host has no model
path of its own. The evaluation driver translates frames from a vendor's
wire format; this one puts the model itself in the seat, so the catalogue it sees is the
permission-filtered one the kernel built and nothing between the two can add
a tool, drop a tool, or answer a call on its own.

What that buys is an axis the other columns cannot separate. A scripted
column leaves out the transport; a live CLI column leaves out the catalogue;
an MCP column keeps both but hands the turn loop to the vendor's scaffolding.
This one keeps the loop with SharedOS and drops the vendor
entirely, which is what makes "the model behaved this way" distinguishable
from "the vendor's scaffolding made the model behave this way".

It is not a replacement for the scripted adversary and cannot be one. A model
chooses what to call, so an attempt it declines to issue leaves no operation
in the record and is graded as unexercised. That is the honest grading, and
the reason the deterministic column stays the reference.

#### Implements

- [`AgentTurnDriver`](sharedos-runtime.md#agentturndriver)

#### Constructors

##### Constructor

> **new StandardTurnDriver**(`options`): [`StandardTurnDriver`](#standardturndriver)

Defined in: [packages/adapters/src/model/driver.ts:142](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L142)

###### Parameters

| Parameter | Type                                                      |
| --------- | --------------------------------------------------------- |
| `options` | [`StandardTurnDriverOptions`](#standardturndriveroptions) |

###### Returns

[`StandardTurnDriver`](#standardturndriver)

#### Properties

| Property                                    | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                                   |
| ------------------------------------------- | ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-manifest-1"></a> `manifest` | `readonly` | `object`                                         | Who this driver is, for the record. The executor stamps the plugin's manifest on every execution record, and the loop is the same whichever driver is seated, so the loop reports the seated driver's manifest as its own: evidence is filed under what produced it. A driver that states none is reported as `sharedos.standard`. | [packages/adapters/src/model/driver.ts:136](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L136) |
| `manifest.id`                               | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:9                                                                                                       |
| `manifest.metadata?`                        | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject) | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:12                                                                                                      |
| `manifest.protocolVersion`                  | `public`   | `"1"`                                            | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:11                                                                                                      |
| `manifest.version`                          | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                  | packages/contracts/dist/runtime.d.ts:10                                                                                                      |

#### Methods

##### open()

> **open**(`request`, `_signal`): `Promise`\<[`AgentTurnSession`](sharedos-runtime.md#agentturnsession)>\>

Defined in: [packages/adapters/src/model/driver.ts:156](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L156)

Open the session one turn is driven through.

A turn cancelled while this is in flight stops waiting for it. A session
handed back after that is still closed, with the turn's ending, so `close`
may be called on a session that was never asked for a decision. A driver
whose `open` rejects releases whatever it had taken itself: there is no
session to close.

###### Parameters

| Parameter | Type                                                           |
| --------- | -------------------------------------------------------------- |
| `request` | [`RuntimeTurnRequest`](sharedos-runtime.md#runtimeturnrequest) |
| `_signal` | `AbortSignal`                                                  |

###### Returns

`Promise`\<[`AgentTurnSession`](sharedos-runtime.md#agentturnsession)\>

###### Implementation of

[`AgentTurnDriver`](sharedos-runtime.md#agentturndriver).[`open`](sharedos-runtime.md#open)

---

### ToolNameCodec

Defined in: [packages/adapters/src/model/driver.ts:54](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L54)

How a SharedOS tool name is spoken to a model, and read back.

Dots become underscores on the way out and the catalogue's own map decides
the way back, so a catalogued tool round-trips exactly rather than through a
guess. The map is built per turn from the permission-filtered catalogue,
which means it contains precisely the tools this actor was allowed to see.

A name the map does not contain is decoded by reversing the substitution and
then passed through unchanged. That path is best-effort and it exists for one
reason: a model that invents a tool outside its catalogue must still be able
to reach the envelope and be refused. Filtering it here, or failing to decode
it, would erase the attempt -- and an attempt that never arrives is graded as
a tool that was never tried, not as a tool that was refused.

#### Constructors

##### Constructor

> **new ToolNameCodec**(`tools`): [`ToolNameCodec`](#toolnamecodec)

Defined in: [packages/adapters/src/model/driver.ts:58](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L58)

###### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `tools`   | readonly `object`[] |

###### Returns

[`ToolNameCodec`](#toolnamecodec)

#### Methods

##### fromWire()

> **fromWire**(`name`): `string`

Defined in: [packages/adapters/src/model/driver.ts:84](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L84)

###### Parameters

| Parameter | Type     |
| --------- | -------- |
| `name`    | `string` |

###### Returns

`string`

##### toWire()

> **toWire**(`name`): `string`

Defined in: [packages/adapters/src/model/driver.ts:80](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L80)

###### Parameters

| Parameter | Type     |
| --------- | -------- |
| `name`    | `string` |

###### Returns

`string`

---

### TranscriptModelClient

Defined in: [packages/adapters/src/model/transcript.ts:38](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L38)

Replays a supplied conversation through the real model driver.

This is how the native harness is verified without a provider or a
credential present, and it is the exact counterpart of `TranscriptTransport`
for a vendor harness. The replies are the caller's, written in the model's
own tool-call shape; the name decoding, argument parsing, escalation
recognition, and step accounting are the driver's; and the only thing left
unexercised is the provider that would have produced the replies.

A spent transcript is an error rather than a completion. A live provider
always answers; a recording that has run out has nothing to say, and
answering "done" on its behalf would grade a script that ended too early as
a model choosing to stop. The driver fails the turn `model_call_failed`,
which is the visible result.

#### Implements

- [`ModelClient`](#modelclient)

#### Constructors

##### Constructor

> **new TranscriptModelClient**(`transcript`, `options?`): [`TranscriptModelClient`](#transcriptmodelclient)

Defined in: [packages/adapters/src/model/transcript.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L46)

###### Parameters

| Parameter    | Type                                                            |
| ------------ | --------------------------------------------------------------- |
| `transcript` | [`ModelTranscript`](#modeltranscript)                           |
| `options`    | [`TranscriptModelClientOptions`](#transcriptmodelclientoptions) |

###### Returns

[`TranscriptModelClient`](#transcriptmodelclient)

#### Properties

| Property                                    | Modifier   | Type                                                  | Default value | Description                                                              | Defined in                                                                                                                                         |
| ------------------------------------------- | ---------- | ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-model-1"></a> `model`       | `readonly` | `string`                                              | `undefined`   | The model this client was configured to ask for.                         | [packages/adapters/src/model/transcript.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L39) |
| <a id="property-provider-1"></a> `provider` | `readonly` | `string`                                              | `undefined`   | The provider that serves it, recorded alongside the model on every turn. | [packages/adapters/src/model/transcript.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L40) |
| <a id="property-seen"></a> `seen`           | `readonly` | [`ModelCompletionRequest`](#modelcompletionrequest)[] | `[]`          | Every request the driver made, in order, for a test to read back.        | [packages/adapters/src/model/transcript.ts:42](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L42) |

#### Methods

##### complete()

> **complete**(`request`, `signal`): `Promise`\<[`ModelReply`](#modelreply)>\>

Defined in: [packages/adapters/src/model/transcript.ts:55](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L55)

###### Parameters

| Parameter | Type                                                |
| --------- | --------------------------------------------------- |
| `request` | [`ModelCompletionRequest`](#modelcompletionrequest) |
| `signal`  | `AbortSignal`                                       |

###### Returns

`Promise`\<[`ModelReply`](#modelreply)\>

###### Implementation of

[`ModelClient`](#modelclient).[`complete`](#complete-3)

---

### TranscriptTransport

Defined in: [packages/adapters/src/transcript.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L27)

Replays a supplied conversation through the real protocol translation.

This is how an adapter is verified without the vendor's CLI or credentials
present. The frames are the vendor's, the parsing is the adapter's, and the
only thing left unexercised is the transport that would have carried them.

#### Implements

- [`HarnessTransport`](#harnesstransport)

#### Constructors

##### Constructor

> **new TranscriptTransport**(`transcript`): [`TranscriptTransport`](#transcripttransport)

Defined in: [packages/adapters/src/transcript.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L32)

###### Parameters

| Parameter    | Type                                      |
| ------------ | ----------------------------------------- |
| `transcript` | [`HarnessTranscript`](#harnesstranscript) |

###### Returns

[`TranscriptTransport`](#transcripttransport)

#### Properties

| Property                                | Modifier   | Type                                               | Default value | Defined in                                                                                                                             |
| --------------------------------------- | ---------- | -------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-opened"></a> `opened`   | `readonly` | [`HarnessTurnRequest`](#harnessturnrequest)[]      | `[]`          | [packages/adapters/src/transcript.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L28) |
| <a id="property-written"></a> `written` | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject)[] | `[]`          | [packages/adapters/src/transcript.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L29) |

#### Methods

##### open()

> **open**(`request`): `Promise`\<[`HarnessChannel`](#harnesschannel)>\>

Defined in: [packages/adapters/src/transcript.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L39)

###### Parameters

| Parameter | Type                                        |
| --------- | ------------------------------------------- |
| `request` | [`HarnessTurnRequest`](#harnessturnrequest) |

###### Returns

`Promise`\<[`HarnessChannel`](#harnesschannel)\>

###### Implementation of

[`HarnessTransport`](#harnesstransport).[`open`](#open-3)

## Interfaces

### EvalHarnessDriverOptions

Defined in: [packages/adapters/src/driver.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L24)

`instructions` reaches the harness on `HarnessTurnRequest.instructions`, for
its transport to hand over with the prompt.

#### Extends

- [`SeatTextOptions`](#seattextoptions)

#### Properties

| Property                                                   | Modifier   | Type                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Inherited from                                                                   | Defined in                                                                                                                     |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-declarestep"></a> `declareStep?`           | `readonly` | [`DeclareStep`](#declarestep)                        | See [DeclareStep](#declarestep).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -                                                                                | [packages/adapters/src/driver.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L31) |
| <a id="property-instructions"></a> `instructions?`         | `readonly` | `string` \| ((`request`) => `string` \| `undefined`) | What the seat is told before the prompt: a model's system message, an MCP server's initialize instructions, a harness's preamble. By default it is `request.context.reach` rendered by `describeReach`: where this turn's tools may operate, with the authority left out. The prompt carries the task and this carries the environment the task runs in. A string is the host's standing guidance, placed before the turn's reach so a seat that shows its model one block reads the guidance before the map. A function replaces the composition and says exactly what the seat is told; returning `undefined` hands over no instructions at all. | [`SeatTextOptions`](#seattextoptions).[`instructions`](#property-instructions-2) | [packages/adapters/src/seat.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L40)     |
| <a id="property-manifest-2"></a> `manifest`                | `readonly` | `object`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | [packages/adapters/src/driver.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L25) |
| `manifest.id`                                              | `public`   | `string`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:9                                                                                         |
| `manifest.metadata?`                                       | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject)     | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:12                                                                                        |
| `manifest.protocolVersion`                                 | `public`   | `"1"`                                                | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:11                                                                                        |
| `manifest.version`                                         | `public`   | `string`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:10                                                                                        |
| <a id="property-maxignoredframes"></a> `maxIgnoredFrames?` | `readonly` | `number`                                             | Guard against a harness that streams unrelated frames without end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -                                                                                | [packages/adapters/src/driver.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L29) |
| <a id="property-prompt"></a> `prompt?`                     | `readonly` | (`request`) => `string`                              | Overrides how the turn message becomes the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`SeatTextOptions`](#seattextoptions).[`prompt`](#property-prompt-2)             | [packages/adapters/src/seat.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L27)     |
| <a id="property-protocol"></a> `protocol`                  | `readonly` | [`HarnessProtocol`](#harnessprotocol)                | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | [packages/adapters/src/driver.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L26) |
| <a id="property-transport"></a> `transport`                | `readonly` | [`HarnessTransport`](#harnesstransport)              | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | [packages/adapters/src/driver.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/driver.ts#L27) |

---

### HarnessAvailability

Defined in: [packages/adapters/src/harness.ts:100](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L100)

Whether a harness can actually be run here, and if not, why not.

#### Properties

| Property                                    | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Defined in                                                                                                                         |
| ------------------------------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-available"></a> `available` | `readonly` | `boolean`                                        | -                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [packages/adapters/src/harness.ts:102](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L102) |
| <a id="property-detail"></a> `detail?`      | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | Includes `versionOutput`, the line `version` was read from, verbatim.                                                                                                                                                                                                                                                                                                                                                                                       | [packages/adapters/src/harness.ts:115](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L115) |
| <a id="property-harness"></a> `harness`     | `readonly` | `string`                                         | -                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [packages/adapters/src/harness.ts:101](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L101) |
| <a id="property-reason"></a> `reason?`      | `readonly` | `string`                                         | -                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [packages/adapters/src/harness.ts:103](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L103) |
| <a id="property-version"></a> `version?`    | `readonly` | `string`                                         | The build that answered, as the harness itself reports it. A result about a vendor CLI is a result about one version of it, and the version is the harness's to state: nothing in this repository pins the installed binary, and a number carried in a runbook is a claim about what someone typed rather than about what ran. Absent when the executable declined to report one -- see [HarnessRequirements.versionArguments](#property-versionarguments). | [packages/adapters/src/harness.ts:113](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L113) |

---

### HarnessChannel

Defined in: [packages/adapters/src/harness.ts:62](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L62)

One open harness turn. Reads and writes are frames, never SharedOS types.

#### Methods

##### close()

> **close**(): `Promise`\<`void`>\>

Defined in: [packages/adapters/src/harness.ts:66](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L66)

###### Returns

`Promise`\<`void`\>

##### read()

> **read**(`signal`): `Promise`\<[`JsonObject`](sharedos-contracts.md#jsonobject) \| `undefined`>\>

Defined in: [packages/adapters/src/harness.ts:64](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L64)

The next frame, or `undefined` once the harness has finished speaking.

###### Parameters

| Parameter | Type          |
| --------- | ------------- |
| `signal`  | `AbortSignal` |

###### Returns

`Promise`\<[`JsonObject`](sharedos-contracts.md#jsonobject) \| `undefined`\>

##### write()

> **write**(`frame`, `signal`): `Promise`\<`void`>\>

Defined in: [packages/adapters/src/harness.ts:65](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L65)

###### Parameters

| Parameter | Type                                             |
| --------- | ------------------------------------------------ |
| `frame`   | [`JsonObject`](sharedos-contracts.md#jsonobject) |
| `signal`  | `AbortSignal`                                    |

###### Returns

`Promise`\<`void`\>

---

### HarnessFrameWriter

Defined in: [packages/adapters/src/writer.ts:22](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L22)

The inverse of [HarnessProtocol.interpret](#interpret): frames a harness would send.

A `HarnessProtocol` only ever reads. That is correct for production, where
the frames come from the vendor, and it leaves no way to _build_ a recorded
conversation for a harness to be replayed against. Writing those frames by
hand per test is how a fixture drifts from the shape the parser expects, so
the two live side by side and are exercised against each other.

A writer is deliberately not part of `HarnessProtocol`. Requiring every
adapter to implement an encoder that production never calls would put dead
code in the security-relevant path.

#### Properties

| Property                                      | Modifier   | Type     | Description                                                                | Defined in                                                                                                                     |
| --------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-protocolid"></a> `protocolId` | `readonly` | `string` | The protocol these frames belong to; must match the reading protocol's id. | [packages/adapters/src/writer.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L24) |

#### Methods

##### complete()

> **complete**(`output?`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/writer.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L27)

###### Parameters

| Parameter | Type                                           |
| --------- | ---------------------------------------------- |
| `output?` | [`JsonValue`](sharedos-contracts.md#jsonvalue) |

###### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

##### message()

> **message**(`text`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/writer.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L26)

###### Parameters

| Parameter | Type     |
| --------- | -------- |
| `text`    | `string` |

###### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

##### toolCall()

> **toolCall**(`callId`, `tool`, `arguments_`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/writer.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L25)

###### Parameters

| Parameter    | Type                                             |
| ------------ | ------------------------------------------------ |
| `callId`     | `string`                                         |
| `tool`       | `string`                                         |
| `arguments_` | [`JsonObject`](sharedos-contracts.md#jsonobject) |

###### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### HarnessProtocol

Defined in: [packages/adapters/src/harness.ts:86](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L86)

The translation between SharedOS and one vendor's wire shapes.

This is the whole adapter. Everything else -- the turn loop, per-call
re-authorization, the permission-filtered catalogue, audit -- is supplied by
the SharedOS execution envelope and is not reimplemented per vendor.

#### Properties

| Property                      | Modifier   | Type     | Defined in                                                                                                                       |
| ----------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-id"></a> `id` | `readonly` | `string` | [packages/adapters/src/harness.ts:87](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L87) |

#### Methods

##### describeTools()

> **describeTools**(`tools`): [`JsonValue`](sharedos-contracts.md#jsonvalue)

Defined in: [packages/adapters/src/harness.ts:89](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L89)

Render the permission-filtered catalogue in the harness's own tool shape.

###### Parameters

| Parameter | Type                |
| --------- | ------------------- |
| `tools`   | readonly `object`[] |

###### Returns

[`JsonValue`](sharedos-contracts.md#jsonvalue)

##### encodeToolResult()

> **encodeToolResult**(`result`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/harness.ts:96](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L96)

###### Parameters

| Parameter | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`  | \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \} |

###### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

##### interpret()

> **interpret**(`frame`): readonly [`HarnessStep`](#harnessstep)[]

Defined in: [packages/adapters/src/harness.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L95)

Everything one frame means, in order. Frames carrying nothing relevant --
progress notices, token counts, thinking blocks -- yield an empty array,
and a frame carrying several tool calls yields one step each.

###### Parameters

| Parameter | Type                                             |
| --------- | ------------------------------------------------ |
| `frame`   | [`JsonObject`](sharedos-contracts.md#jsonobject) |

###### Returns

readonly [`HarnessStep`](#harnessstep)[]

---

### HarnessRequirements

Defined in: [packages/adapters/src/harness.ts:119](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L119)

What a harness needs before it can run: an executable, credentials, or both.

#### Properties

| Property                                                        | Modifier   | Type                | Description                                                                                                                                     | Defined in                                                                                                                         |
| --------------------------------------------------------------- | ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-credentialsoptional"></a> `credentialsOptional` | `readonly` | `boolean`           | True when the harness can authenticate from a stored session instead.                                                                           | [packages/adapters/src/harness.ts:126](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L126) |
| <a id="property-credentialvariables"></a> `credentialVariables` | `readonly` | readonly `string`[] | Environment variables, any one of which satisfies the credential need.                                                                          | [packages/adapters/src/harness.ts:124](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L124) |
| <a id="property-executable"></a> `executable`                   | `readonly` | `string`            | Executable expected on PATH.                                                                                                                    | [packages/adapters/src/harness.ts:122](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L122) |
| <a id="property-harness-1"></a> `harness`                       | `readonly` | `string`            | -                                                                                                                                               | [packages/adapters/src/harness.ts:120](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L120) |
| <a id="property-versionarguments"></a> `versionArguments?`      | `readonly` | readonly `string`[] | How to ask this executable what it is. Defaults to `--version`, which all four harnesses here answer; declared so one that does not can say so. | [packages/adapters/src/harness.ts:131](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L131) |

---

### HarnessTranscript

Defined in: [packages/adapters/src/transcript.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L16)

A harness conversation, supplied by its caller.

Batches are released one tool result at a time: the first batch is emitted
when the turn opens, and each later batch is unlocked by the adapter writing
a result back. That is the shape of every tool-using harness, so a transcript
exercises the same code path a live session does.

#### Properties

| Property                                | Modifier   | Type                                                                   | Defined in                                                                                                                             |
| --------------------------------------- | ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-batches"></a> `batches` | `readonly` | readonly readonly [`JsonObject`](sharedos-contracts.md#jsonobject)[][] | [packages/adapters/src/transcript.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/transcript.ts#L17) |

---

### HarnessTransport

Defined in: [packages/adapters/src/harness.ts:75](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L75)

How a harness is reached: a subprocess, an HTTP session, or a recorded
transcript. Keeping this separate from the protocol is what lets one adapter
be exercised deterministically and then run live without changing the
translation code under test.

#### Methods

##### open()

> **open**(`request`, `signal`): `Promise`\<[`HarnessChannel`](#harnesschannel)>\>

Defined in: [packages/adapters/src/harness.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L76)

###### Parameters

| Parameter | Type                                        |
| --------- | ------------------------------------------- |
| `request` | [`HarnessTurnRequest`](#harnessturnrequest) |
| `signal`  | `AbortSignal`                               |

###### Returns

`Promise`\<[`HarnessChannel`](#harnesschannel)\>

---

### HarnessTurnRequest

Defined in: [packages/adapters/src/harness.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L31)

Everything a harness needs to start one turn.

#### Properties

| Property                                             | Modifier   | Type                                                                 | Description                                                                                                                                                                                                                                                                            | Defined in                                                                                                                       |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-context"></a> `context`              | `readonly` | [`RuntimeVisibleContext`](sharedos-runtime.md#runtimevisiblecontext) | The sanitised context. It carries no grants and no issuing authority.                                                                                                                                                                                                                  | [packages/adapters/src/harness.ts:44](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L44) |
| <a id="property-executionid"></a> `executionId`      | `readonly` | `string`                                                             | -                                                                                                                                                                                                                                                                                      | [packages/adapters/src/harness.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L32) |
| <a id="property-instructions-1"></a> `instructions?` | `readonly` | `string`                                                             | What the harness is told before the prompt: by default where this turn's tools may operate. It is part of the turn's prompt hash, so a transport that opens the harness hands it over; [harnessTurnText](#harnessturntext) is the text for a harness whose opening frame has one slot. | [packages/adapters/src/harness.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L40) |
| <a id="property-metadata"></a> `metadata?`           | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject)                     | -                                                                                                                                                                                                                                                                                      | [packages/adapters/src/harness.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L45) |
| <a id="property-prompt-1"></a> `prompt`              | `readonly` | `string`                                                             | -                                                                                                                                                                                                                                                                                      | [packages/adapters/src/harness.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L33) |
| <a id="property-tools"></a> `tools`                  | `readonly` | [`JsonValue`](sharedos-contracts.md#jsonvalue)                       | The permission-filtered catalogue, already in the harness's own shape.                                                                                                                                                                                                                 | [packages/adapters/src/harness.ts:42](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L42) |

---

### HarnessVendor

Defined in: [packages/adapters/src/vendors.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L16)

What one vendor harness is, stated once: its id, its codec, what it needs, how its records are named.

#### Properties

| Property                                          | Modifier   | Type                                                   | Description                                                                          | Defined in                                                                                                                       |
| ------------------------------------------------- | ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-id-1"></a> `id`                   | `readonly` | `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` | The id this harness goes by everywhere: manifests, requirements, MCP specs, scripts. | [packages/adapters/src/vendors.ts:18](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L18) |
| <a id="property-manifest-3"></a> `manifest`       | `readonly` | `object`                                               | The manifest of a turn the SharedOS loop drives, speaking the vendor's wire format.  | [packages/adapters/src/vendors.ts:23](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L23) |
| `manifest.id`                                     | `public`   | `string`                                               | -                                                                                    | packages/contracts/dist/runtime.d.ts:9                                                                                           |
| `manifest.metadata?`                              | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject)       | -                                                                                    | packages/contracts/dist/runtime.d.ts:12                                                                                          |
| `manifest.protocolVersion`                        | `public`   | `"1"`                                                  | -                                                                                    | packages/contracts/dist/runtime.d.ts:11                                                                                          |
| `manifest.version`                                | `public`   | `string`                                               | -                                                                                    | packages/contracts/dist/runtime.d.ts:10                                                                                          |
| <a id="property-mcpmanifest"></a> `mcpManifest`   | `readonly` | `object`                                               | The manifest of a turn the vendor CLI runs itself, connected over MCP.               | [packages/adapters/src/vendors.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L25) |
| `mcpManifest.id`                                  | `public`   | `string`                                               | -                                                                                    | packages/contracts/dist/runtime.d.ts:9                                                                                           |
| `mcpManifest.metadata?`                           | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject)       | -                                                                                    | packages/contracts/dist/runtime.d.ts:12                                                                                          |
| `mcpManifest.protocolVersion`                     | `public`   | `"1"`                                                  | -                                                                                    | packages/contracts/dist/runtime.d.ts:11                                                                                          |
| `mcpManifest.version`                             | `public`   | `string`                                               | -                                                                                    | packages/contracts/dist/runtime.d.ts:10                                                                                          |
| <a id="property-protocol-1"></a> `protocol`       | `readonly` | [`HarnessProtocol`](#harnessprotocol)                  | -                                                                                    | [packages/adapters/src/vendors.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L19) |
| <a id="property-requirements"></a> `requirements` | `readonly` | [`HarnessRequirements`](#harnessrequirements)          | What a live session needs before it can run.                                         | [packages/adapters/src/vendors.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L21) |

---

### HarnessVendorDefinition

Defined in: [packages/adapters/src/vendors.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L28)

#### Properties

| Property                                                          | Modifier   | Type                                                   | Description                                                                                                                                                                                                                                                                         | Defined in                                                                                                                       |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-catalogueoutofband"></a> `catalogueOutOfBand?`    | `readonly` | `boolean`                                              | The harness runs its own tools, so the permission-filtered catalogue cannot be declared in a frame. Stamped on every record its driven manifest produces, because a column whose catalogue arrived out of band is making a narrower claim than one whose catalogue was on the wire. | [packages/adapters/src/vendors.ts:41](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L41) |
| <a id="property-credentialvariables-1"></a> `credentialVariables` | `readonly` | readonly `string`[]                                    | Environment variables, any one of which satisfies the credential need.                                                                                                                                                                                                              | [packages/adapters/src/vendors.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L34) |
| <a id="property-executable-1"></a> `executable`                   | `readonly` | `string`                                               | Executable expected on PATH.                                                                                                                                                                                                                                                        | [packages/adapters/src/vendors.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L32) |
| <a id="property-id-2"></a> `id`                                   | `readonly` | `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` | -                                                                                                                                                                                                                                                                                   | [packages/adapters/src/vendors.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L29) |
| <a id="property-mcpmetadata"></a> `mcpMetadata?`                  | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject)       | What else the MCP manifest says about how this harness reaches MCP.                                                                                                                                                                                                                 | [packages/adapters/src/vendors.ts:43](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L43) |
| <a id="property-protocol-2"></a> `protocol`                       | `readonly` | [`HarnessProtocol`](#harnessprotocol)                  | -                                                                                                                                                                                                                                                                                   | [packages/adapters/src/vendors.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L30) |

---

### ModelClient

Defined in: [packages/adapters/src/model/client.ts:90](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L90)

A model API in the SharedOS driver seat.

Deliberately narrower than any provider SDK: one call, tools in, tool calls
out. Everything that decides whether a call is allowed to happen -- the
catalogue, the turn loop, per-call re-authorization, audit -- stays in the
execution envelope, so a second provider is a second implementation of this
interface and no new enforcement path.

#### Properties

| Property                                     | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                                   |
| -------------------------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-model-2"></a> `model`        | `readonly` | `string`                                         | The model this client was configured to ask for.                                                                                                                                                                                                                                                                   | [packages/adapters/src/model/client.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L92)   |
| <a id="property-provider-2"></a> `provider`  | `readonly` | `string`                                         | The provider that serves it, recorded alongside the model on every turn.                                                                                                                                                                                                                                           | [packages/adapters/src/model/client.ts:94](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L94)   |
| <a id="property-settings-1"></a> `settings?` | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | Settings this client sends that change what the model does, beyond naming it -- a reasoning mode, say. Recorded on every turn beside the model so two runs under one model name are not read as the same configuration when they were not. Absent when the client sends nothing the provider would not default to. | [packages/adapters/src/model/client.ts:102](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L102) |

#### Methods

##### complete()

> **complete**(`request`, `signal`): `Promise`\<[`ModelReply`](#modelreply)>\>

Defined in: [packages/adapters/src/model/client.ts:103](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L103)

###### Parameters

| Parameter | Type                                                |
| --------- | --------------------------------------------------- |
| `request` | [`ModelCompletionRequest`](#modelcompletionrequest) |
| `signal`  | `AbortSignal`                                       |

###### Returns

`Promise`\<[`ModelReply`](#modelreply)\>

---

### ModelCompletionRequest

Defined in: [packages/adapters/src/model/client.ts:43](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L43)

#### Properties

| Property                                  | Modifier   | Type                                       | Defined in                                                                                                                                 |
| ----------------------------------------- | ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-messages"></a> `messages` | `readonly` | readonly [`ModelMessage`](#modelmessage)[] | [packages/adapters/src/model/client.ts:44](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L44) |
| <a id="property-tools-1"></a> `tools`     | `readonly` | readonly [`ModelTool`](#modeltool)[]       | [packages/adapters/src/model/client.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L45) |

---

### ModelReply

Defined in: [packages/adapters/src/model/client.ts:55](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L55)

What the model answered with.

#### Properties

| Property                                           | Modifier   | Type                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                               | Defined in                                                                                                                                 |
| -------------------------------------------------- | ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-finishreason"></a> `finishReason?` | `readonly` | `string`                                     | Why generation stopped, in the provider's own vocabulary. `stop` and `tool_calls` are the model ending its reply; `length` is the provider ending it at the output-token ceiling. Carried because the two are different facts about the same reply: a completion that was cut off mid-way looks, without this, exactly like a completion the model chose to end, and a record whose purpose is honest attribution has to tell them apart. | [packages/adapters/src/model/client.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L67) |
| <a id="property-model-3"></a> `model?`             | `readonly` | `string`                                     | The model the provider says actually answered. Recorded separately from the one that was asked for because they differ: DeepSeek maps an unrecognised name onto a default rather than rejecting it, so a run configured for one model can be served by another. The record should say what answered, which is the weaker claim and the honest one.                                                                                        | [packages/adapters/src/model/client.ts:78](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L78) |
| <a id="property-text"></a> `text`                  | `readonly` | `string`                                     | -                                                                                                                                                                                                                                                                                                                                                                                                                                         | [packages/adapters/src/model/client.ts:56](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L56) |
| <a id="property-toolcalls"></a> `toolCalls`        | `readonly` | readonly [`ModelToolCall`](#modeltoolcall)[] | -                                                                                                                                                                                                                                                                                                                                                                                                                                         | [packages/adapters/src/model/client.ts:57](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L57) |
| <a id="property-usage"></a> `usage?`               | `readonly` | [`ModelUsage`](#modelusage)                  | Absent when the provider reported no usage; never estimated.                                                                                                                                                                                                                                                                                                                                                                              | [packages/adapters/src/model/client.ts:69](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L69) |

---

### ModelTool

Defined in: [packages/adapters/src/model/client.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L20)

A tool offered to the model, already rendered into the provider's alphabet.

#### Properties

| Property                                        | Modifier   | Type                                             | Defined in                                                                                                                                 |
| ----------------------------------------------- | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-description"></a> `description` | `readonly` | `string`                                         | [packages/adapters/src/model/client.ts:22](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L22) |
| <a id="property-name-1"></a> `name`             | `readonly` | `string`                                         | [packages/adapters/src/model/client.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L21) |
| <a id="property-parameters"></a> `parameters`   | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | [packages/adapters/src/model/client.ts:23](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L23) |

---

### ModelToolCall

Defined in: [packages/adapters/src/model/client.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L13)

One tool call a model asked for, exactly as it came off the wire.

The name is the provider's alphabet, not SharedOS's, and the arguments are
still an unparsed string. Neither is normalised here: a client's job is to
carry what the model said, and deciding what an unparseable argument blob or
an unrecognised name means is a policy question that belongs to the driver.

#### Properties

| Property                                    | Modifier   | Type     | Defined in                                                                                                                                 |
| ------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-arguments"></a> `arguments` | `readonly` | `string` | [packages/adapters/src/model/client.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L16) |
| <a id="property-id-3"></a> `id`             | `readonly` | `string` | [packages/adapters/src/model/client.ts:14](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L14) |
| <a id="property-name-2"></a> `name`         | `readonly` | `string` | [packages/adapters/src/model/client.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L15) |

---

### ModelTranscript

Defined in: [packages/adapters/src/model/transcript.ts:11](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L11)

A model conversation, supplied by its caller.

One reply per model call. The first reply answers the opening prompt, and
each later reply is released only once every tool call in the reply before
it has been answered -- which is what the driver already requires of a live
provider, so a transcript exercises the same code path a live model does.

#### Properties

| Property                                | Modifier   | Type                                   | Defined in                                                                                                                                         |
| --------------------------------------- | ---------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-replies"></a> `replies` | `readonly` | readonly [`ModelReply`](#modelreply)[] | [packages/adapters/src/model/transcript.ts:12](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L12) |

---

### ModelUsage

Defined in: [packages/adapters/src/model/client.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L49)

What a provider billed for one reply, when it said.

#### Properties

| Property                                           | Modifier   | Type     | Defined in                                                                                                                                 |
| -------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="property-inputtokens"></a> `inputTokens?`   | `readonly` | `number` | [packages/adapters/src/model/client.ts:50](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L50) |
| <a id="property-outputtokens"></a> `outputTokens?` | `readonly` | `number` | [packages/adapters/src/model/client.ts:51](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L51) |

---

### OpenAiCompatibleModelClientOptions

Defined in: [packages/adapters/src/model/client.ts:157](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L157)

#### Properties

| Property                                                   | Modifier   | Type                                                                                           | Description                                                                                                                                                                                                                                                                                                                                                                           | Defined in                                                                                                                                   |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-apikey"></a> `apiKey`                      | `readonly` | `string`                                                                                       | -                                                                                                                                                                                                                                                                                                                                                                                     | [packages/adapters/src/model/client.ts:158](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L158) |
| <a id="property-baseurl"></a> `baseUrl`                    | `readonly` | `string`                                                                                       | The chat-completions root, without a trailing slash.                                                                                                                                                                                                                                                                                                                                  | [packages/adapters/src/model/client.ts:163](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L163) |
| <a id="property-fetch"></a> `fetch?`                       | `readonly` | \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \} | Injected for tests, which must never reach a network.                                                                                                                                                                                                                                                                                                                                 | [packages/adapters/src/model/client.ts:183](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L183) |
| <a id="property-maxoutputtokens"></a> `maxOutputTokens?`   | `readonly` | `number`                                                                                       | -                                                                                                                                                                                                                                                                                                                                                                                     | [packages/adapters/src/model/client.ts:164](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L164) |
| <a id="property-model-4"></a> `model`                      | `readonly` | `string`                                                                                       | -                                                                                                                                                                                                                                                                                                                                                                                     | [packages/adapters/src/model/client.ts:159](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L159) |
| <a id="property-provider-3"></a> `provider`                | `readonly` | `string`                                                                                       | Names the provider on every record this client's turns produce.                                                                                                                                                                                                                                                                                                                       | [packages/adapters/src/model/client.ts:161](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L161) |
| <a id="property-requesttimeoutms"></a> `requestTimeoutMs?` | `readonly` | `number`                                                                                       | How long one model call may take, independently of the turn's own budget.                                                                                                                                                                                                                                                                                                             | [packages/adapters/src/model/client.ts:173](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L173) |
| <a id="property-temperature"></a> `temperature?`           | `readonly` | `number`                                                                                       | Left at zero by default, which reduces variation between runs but does not remove it. This column is not deterministic and must not be described as if it were: a temperature of zero is not a seed, and the same prompt can still produce a different call sequence on a different day.                                                                                              | [packages/adapters/src/model/client.ts:171](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L171) |
| <a id="property-thinking"></a> `thinking?`                 | `readonly` | `"enabled"` \| `"disabled"`                                                                    | Whether the model reasons before it answers, sent as DeepSeek's `thinking` request field. Opt-in: the field is not part of the OpenAI wire shape, and a provider that does not know it rejects the request, so nothing is sent until a host asks. When set it is reported through [ModelClient.settings](#property-settings-1) so the turn's record says which mode the model ran in. | [packages/adapters/src/model/client.ts:181](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L181) |

---

### SeatTextOptions

Defined in: [packages/adapters/src/seat.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L25)

How a turn's message and reach become the two texts a seat is handed.

#### Extended by

- [`EvalHarnessDriverOptions`](#evalharnessdriveroptions)
- [`StandardTurnDriverOptions`](#standardturndriveroptions)

#### Properties

| Property                                             | Modifier   | Type                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Defined in                                                                                                                 |
| ---------------------------------------------------- | ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-instructions-2"></a> `instructions?` | `readonly` | `string` \| ((`request`) => `string` \| `undefined`) | What the seat is told before the prompt: a model's system message, an MCP server's initialize instructions, a harness's preamble. By default it is `request.context.reach` rendered by `describeReach`: where this turn's tools may operate, with the authority left out. The prompt carries the task and this carries the environment the task runs in. A string is the host's standing guidance, placed before the turn's reach so a seat that shows its model one block reads the guidance before the map. A function replaces the composition and says exactly what the seat is told; returning `undefined` hands over no instructions at all. | [packages/adapters/src/seat.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L40) |
| <a id="property-prompt-2"></a> `prompt?`             | `readonly` | (`request`) => `string`                              | Overrides how the turn message becomes the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [packages/adapters/src/seat.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L27) |

---

### StandardTurnDriverOptions

Defined in: [packages/adapters/src/model/driver.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L95)

`instructions` reaches the model as a system message, which is what a
chat-completions provider's system role is for, and it is the same layer a
harness maps MCP initialize instructions into. With none, no system message
is sent.

#### Extends

- [`SeatTextOptions`](#seattextoptions)

#### Properties

| Property                                                     | Modifier   | Type                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Inherited from                                                                   | Defined in                                                                                                                                   |
| ------------------------------------------------------------ | ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-client"></a> `client`                        | `readonly` | [`ModelClient`](#modelclient)                        | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | [packages/adapters/src/model/driver.ts:97](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L97)   |
| <a id="property-declarestep-1"></a> `declareStep?`           | `readonly` | [`DeclareStep`](#declarestep)                        | See [DeclareStep](#declarestep).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -                                                                                | [packages/adapters/src/model/driver.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L108) |
| <a id="property-instructions-3"></a> `instructions?`         | `readonly` | `string` \| ((`request`) => `string` \| `undefined`) | What the seat is told before the prompt: a model's system message, an MCP server's initialize instructions, a harness's preamble. By default it is `request.context.reach` rendered by `describeReach`: where this turn's tools may operate, with the authority left out. The prompt carries the task and this carries the environment the task runs in. A string is the host's standing guidance, placed before the turn's reach so a seat that shows its model one block reads the guidance before the map. A function replaces the composition and says exactly what the seat is told; returning `undefined` hands over no instructions at all. | [`SeatTextOptions`](#seattextoptions).[`instructions`](#property-instructions-2) | [packages/adapters/src/seat.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L40)                   |
| <a id="property-manifest-4"></a> `manifest`                  | `readonly` | `object`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | [packages/adapters/src/model/driver.ts:96](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L96)   |
| `manifest.id`                                                | `public`   | `string`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:9                                                                                                       |
| `manifest.metadata?`                                         | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject)     | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:12                                                                                                      |
| `manifest.protocolVersion`                                   | `public`   | `"1"`                                                | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:11                                                                                                      |
| `manifest.version`                                           | `public`   | `string`                                             | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -                                                                                | packages/contracts/dist/runtime.d.ts:10                                                                                                      |
| <a id="property-maxmalformedcalls"></a> `maxMalformedCalls?` | `readonly` | `number`                                             | Guard against a model that never forms a readable call. A call whose arguments do not parse is refused by the driver and answered back to the model, which costs the turn no step; a model that kept producing them would otherwise be spoken to until the turn timed out. Past this many in one turn, the turn fails instead.                                                                                                                                                                                                                                                                                                                     | -                                                                                | [packages/adapters/src/model/driver.ts:106](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L106) |
| <a id="property-prompt-3"></a> `prompt?`                     | `readonly` | (`request`) => `string`                              | Overrides how the turn message becomes the prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`SeatTextOptions`](#seattextoptions).[`prompt`](#property-prompt-2)             | [packages/adapters/src/seat.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L27)                   |

---

### TranscriptModelClientOptions

Defined in: [packages/adapters/src/model/transcript.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L15)

#### Properties

| Property                                     | Modifier   | Type     | Description                                                      | Defined in                                                                                                                                         |
| -------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-model-5"></a> `model?`       | `readonly` | `string` | What the record names as the model; defaults to `transcript`.    | [packages/adapters/src/model/transcript.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L17) |
| <a id="property-provider-4"></a> `provider?` | `readonly` | `string` | What the record names as the provider; defaults to `transcript`. | [packages/adapters/src/model/transcript.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/transcript.ts#L19) |

## Type Aliases

### DeclareStep

> **DeclareStep** = (`index`, `request`) => `number` \| `undefined`

Defined in: [packages/adapters/src/seat.ts:111](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L111)

The step to declare for the nth call a driver releases this turn, if any.

`undefined`, the default for every call, leaves the step to the loop, which
is what a driver asking for one call at a time should do. It exists for the
one thing a driver cannot otherwise express: reaching past its own budget.
The loop's index stops at `maxSteps`, so a call at or past the ceiling can
only be made by a driver that names the step itself. Supplying this makes the
driver the attacker for that call, which is a different claim from the seat
choosing it, and a column that uses it should say so.

#### Parameters

| Parameter | Type                                                           |
| --------- | -------------------------------------------------------------- |
| `index`   | `number`                                                       |
| `request` | [`RuntimeTurnRequest`](sharedos-runtime.md#runtimeturnrequest) |

#### Returns

`number` \| `undefined`

---

### HarnessFrame

> **HarnessFrame** = [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/harness.ts:11](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L11)

One raw protocol frame, in whatever shape the harness speaks.

---

### HarnessStep

> **HarnessStep** = \{ `arguments`: [`JsonObject`](sharedos-contracts.md#jsonobject); `callId`: `string`; `tool`: `string`; `type`: `"tool_call"`; \} \| \{ `text`: `string`; `type`: `"message"`; \} \| \{ `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output?`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `type`: `"complete"`; \} \| \{ `error`: [`ProtocolError`](sharedos-contracts.md#protocolerror); `type`: `"failed"`; \}

Defined in: [packages/adapters/src/harness.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L19)

What one frame means once the vendor protocol has interpreted it.

`message` is assistant prose. It is kept rather than discarded so a harness
whose terminal frame carries no text still produces a turn output.

---

### ModelMessage

> **ModelMessage** = \{ `content`: `string`; `role`: `"system"` \| `"user"`; \} \| \{ `content`: `string`; `role`: `"assistant"`; `toolCalls`: readonly [`ModelToolCall`](#modeltoolcall)[]; \} \| \{ `content`: `string`; `role`: `"tool"`; `toolCallId`: `string`; \}

Defined in: [packages/adapters/src/model/client.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L34)

One turn of conversation.

`assistant` carries the tool calls the model asked for and `tool` carries one
result back, because a chat-completions provider requires the pair to appear
in that order and requires every call in an assistant message to be answered
before the next one is sent.

---

### ModelToolCallReading

> **ModelToolCallReading** = \{ `reason`: `string`; `type`: `"escalate"`; \} \| \{ `call`: [`ToolCall`](sharedos-contracts.md#toolcall); `type`: `"tool_call"`; \} \| \{ `refusal`: [`ToolResult`](sharedos-contracts.md#toolresult); `type`: `"malformed"`; \}

Defined in: [packages/adapters/src/model/driver.ts:413](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L413)

Where one call the model asked for goes once it has been read.

#### Union Members

##### Type Literal

\{ `reason`: `string`; `type`: `"escalate"`; \}

---

##### Type Literal

\{ `call`: [`ToolCall`](sharedos-contracts.md#toolcall); `type`: `"tool_call"`; \}

---

##### Type Literal

\{ `refusal`: [`ToolResult`](sharedos-contracts.md#toolresult); `type`: `"malformed"`; \}

###### refusal

> `readonly` **refusal**: [`ToolResult`](sharedos-contracts.md#toolresult)

The refusal the model is shown for a call made with unreadable arguments.

###### type

> `readonly` **type**: `"malformed"`

---

### SeatMetadata

> **SeatMetadata** = `object`

Defined in: [packages/adapters/src/seat.ts:202](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L202)

What a seat states about its turn, on the turn's result metadata.

One vocabulary for every seat here, so a reader of `ExecutionResult.metadata`
finds the same fact under the same key whichever seat ran. A seat states the
keys that apply to it and leaves the rest absent; an absent key is "not
stated", never zero. The envelope adds its own beside these (`runtime`,
`promptHash`, `escalationAsked`).

The conformance record lifts `model`, `modelProvider`, `catalogHash`, the
token counts and `callsAfterEscalation`. The rest are for the host that ran
the turn.

#### Properties

##### callsAfterEscalation?

> `readonly` `optional` **callsAfterEscalation?**: `number`

Defined in: [packages/adapters/src/seat.ts:249](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L249)

On a turn that ended `escalated` over MCP: calls the harness made after its
ask. Each was answered `escalation_pending` and reached neither the
envelope nor the kernel, so this is the only place they can be read.

##### catalogHash?

> `readonly` `optional` **catalogHash?**: `string`

Defined in: [packages/adapters/src/seat.ts:233](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L233)

The catalogue the harness was served, so a run can prove which tool set it received.

##### finishReason?

> `readonly` `optional` **finishReason?**: `string`

Defined in: [packages/adapters/src/seat.ts:217](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L217)

Why the last reply ended, in the provider's words.

##### harness?

> `readonly` `optional` **harness?**: `string`

Defined in: [packages/adapters/src/seat.ts:227](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L227)

The vendor harness that ran, by its id.

##### harnessErrorCode?

> `readonly` `optional` **harnessErrorCode?**: `string`

Defined in: [packages/adapters/src/seat.ts:243](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L243)

With `harnessOutcome: "fail"`, the code the harness failed under.

##### harnessOutcome?

> `readonly` `optional` **harnessOutcome?**: `"complete"` \| `"fail"` \| `"escalate"`

Defined in: [packages/adapters/src/seat.ts:241](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L241)

On a turn that ended `escalated` over MCP: how the harness itself ended.
"The CLI reported success after asking" and "the CLI crashed after asking"
are different runs.

##### inputTokens?

> `readonly` `optional` **inputTokens?**: `number`

Defined in: [packages/adapters/src/seat.ts:219](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L219)

Summed over every model call this turn; absent until a reply reports one.

##### malformedToolCalls?

> `readonly` `optional` **malformedToolCalls?**: `number`

Defined in: [packages/adapters/src/seat.ts:225](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L225)

Calls the standard driver refused in place because their arguments were not
a JSON object. None of them reached the envelope, so no operation shows them.

##### mcpServer?

> `readonly` `optional` **mcpServer?**: `string`

Defined in: [packages/adapters/src/seat.ts:231](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L231)

The MCP server name the harness namespaced its aliases under.

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: [packages/adapters/src/seat.ts:209](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L209)

The model behind the seat. The standard driver states the one the provider
served, because a provider may substitute; the MCP harness runtime states
the one the run declared, because a vendor CLI selects its own model and
SharedOS cannot confirm which answered.

##### modelProvider?

> `readonly` `optional` **modelProvider?**: `string`

Defined in: [packages/adapters/src/seat.ts:211](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L211)

Who served it (standard driver), or who the run declared (MCP harness runtime).

##### modelSettings?

> `readonly` `optional` **modelSettings?**: [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/seat.ts:215](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L215)

The sampling settings the model client was configured with.

##### outputTokens?

> `readonly` `optional` **outputTokens?**: `number`

Defined in: [packages/adapters/src/seat.ts:220](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L220)

##### requestedModel?

> `readonly` `optional` **requestedModel?**: `string`

Defined in: [packages/adapters/src/seat.ts:213](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L213)

The model the standard driver asked for, when the served one may differ.

##### toolAliases?

> `readonly` `optional` **toolAliases?**: `object`[]

Defined in: [packages/adapters/src/seat.ts:235](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L235)

Names the harness rewrote, for reading its transcript back; never an authorization input.

###### alias

> `readonly` **alias**: `string`

###### tool

> `readonly` **tool**: `string`

##### toolshare?

> `readonly` `optional` **toolshare?**: `"mcp"`

Defined in: [packages/adapters/src/seat.ts:229](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/seat.ts#L229)

How the harness reached the catalogue.

## Variables

### CLAUDE\_CODE\_HARNESS\_ID

> `const` **CLAUDE\_CODE\_HARNESS\_ID**: `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` = `CLAUDE_CODE_VENDOR.id`

Defined in: [packages/adapters/src/vendors.ts:140](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L140)

---

### CLAUDE\_CODE\_PROTOCOL\_ID

> `const` **CLAUDE\_CODE\_PROTOCOL\_ID**: `"anthropic.messages.stream-json"` = `"anthropic.messages.stream-json"`

Defined in: [packages/adapters/src/claude-code/protocol.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/claude-code/protocol.ts#L16)

Claude Code speaks Anthropic message content blocks inside a stream-json
envelope.

The content blocks -- `tool_use`, `tool_result`, `text` -- are the stable
part and are what this module translates. The `{type:"assistant"|"user"|
"result"}` envelope is the CLI's `--output-format stream-json` framing.

---

### CLAUDE\_CODE\_REQUIREMENTS

> `const` **CLAUDE\_CODE\_REQUIREMENTS**: [`HarnessRequirements`](#harnessrequirements) = `CLAUDE_CODE_VENDOR.requirements`

Defined in: [packages/adapters/src/vendors.ts:142](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L142)

---

### CLAUDE\_CODE\_RUNTIME\_MANIFEST

> `const` **CLAUDE\_CODE\_RUNTIME\_MANIFEST**: [`RuntimeManifest`](sharedos-contracts.md#runtimemanifest) = `CLAUDE_CODE_VENDOR.manifest`

Defined in: [packages/adapters/src/vendors.ts:141](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L141)

---

### CLAUDE\_CODE\_VENDOR

> `const` **CLAUDE\_CODE\_VENDOR**: [`HarnessVendor`](#harnessvendor)

Defined in: [packages/adapters/src/vendors.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L107)

---

### claudeCodeFrameWriter

> `const` **claudeCodeFrameWriter**: [`HarnessFrameWriter`](#harnessframewriter)

Defined in: [packages/adapters/src/writer.ts:58](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L58)

Frames in the Anthropic content-block shape Claude Code speaks.

---

### claudeCodeProtocol

> `const` **claudeCodeProtocol**: [`HarnessProtocol`](#harnessprotocol)

Defined in: [packages/adapters/src/claude-code/protocol.ts:57](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/claude-code/protocol.ts#L57)

---

### CODEX\_HARNESS\_ID

> `const` **CODEX\_HARNESS\_ID**: `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` = `CODEX_VENDOR.id`

Defined in: [packages/adapters/src/vendors.ts:136](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L136)

---

### CODEX\_PROTOCOL\_ID

> `const` **CODEX\_PROTOCOL\_ID**: `"openai.responses.function-calling"` = `"openai.responses.function-calling"`

Defined in: [packages/adapters/src/codex/protocol.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/codex/protocol.ts#L26)

Codex is read in two shapes, for the two ways it is reached.

The OpenAI Responses function-calling shape serves a transport that speaks
the API directly, and the scripted conformance column: function tool
declarations, `function_call` items, `function_call_output` results. The CLI
in JSON mode (`codex exec --json`), which `CODEX_MCP_HARNESS` (mcp-runtime)
launches, prints none of that on stdout: a turn there is `thread.started`,
`turn.started`, a series of `item.*` events and a `turn.completed` or
`turn.failed`, the model's prose is an `agent_message` item, and its tool
calls travel over MCP. A protocol that read only the Responses shape
completed a turn Codex answered in prose with nothing to show, and the host
heard silence.

The CLI's envelope is the vendor's to change, so only the events a turn's
outcome turns on are read; the rest are progress and yield nothing. A frame
of neither shape yields nothing as well.

---

### CODEX\_REQUIREMENTS

> `const` **CODEX\_REQUIREMENTS**: [`HarnessRequirements`](#harnessrequirements) = `CODEX_VENDOR.requirements`

Defined in: [packages/adapters/src/vendors.ts:138](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L138)

---

### CODEX\_RUNTIME\_MANIFEST

> `const` **CODEX\_RUNTIME\_MANIFEST**: [`RuntimeManifest`](sharedos-contracts.md#runtimemanifest) = `CODEX_VENDOR.manifest`

Defined in: [packages/adapters/src/vendors.ts:137](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L137)

---

### CODEX\_VENDOR

> `const` **CODEX\_VENDOR**: [`HarnessVendor`](#harnessvendor)

Defined in: [packages/adapters/src/vendors.ts:100](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L100)

The four vendor harnesses SharedOS ships a codec for.

A vendor CLI is seated in a product through `createMcpHarnessRuntime`, which
reads its MCP manifest here. Its wire codec is seated only by evaluation,
behind `EvalHarnessDriver`, and that turn is filed under `manifest`.

---

### codexFrameWriter

> `const` **codexFrameWriter**: [`HarnessFrameWriter`](#harnessframewriter)

Defined in: [packages/adapters/src/writer.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L31)

Frames in the OpenAI Responses function-calling shape Codex speaks.

---

### codexProtocol

> `const` **codexProtocol**: [`HarnessProtocol`](#harnessprotocol)

Defined in: [packages/adapters/src/codex/protocol.ts:97](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/codex/protocol.ts#L97)

---

### DEEPSEEK\_HARNESS\_ID

> `const` **DEEPSEEK\_HARNESS\_ID**: `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` = `DEEPSEEK_VENDOR.id`

Defined in: [packages/adapters/src/vendors.ts:144](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L144)

---

### DEEPSEEK\_PROTOCOL\_ID

> `const` **DEEPSEEK\_PROTOCOL\_ID**: `"deepseek.harness.session-events"` = `"deepseek.harness.session-events"`

Defined in: [packages/adapters/src/deepseek/protocol.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/deepseek/protocol.ts#L27)

DeepSeek Harness speaks its own session-log vocabulary over a
newline-delimited JSON-RPC 2.0 stdio transport.

That vocabulary is the layer this module targets: `tool/call` carrying the
model's raw argument string, `assistant/message` carrying assembled content
blocks, and `turn/end` carrying a structured reason. It is deliberately not
the `dsh` CLI's command-line surface, which is a plugin composition that
varies per deployment. What carries these frames -- the SDK runtime server,
the ACP bridge, or a recorded log -- is the transport's problem.

One asymmetry is worth stating plainly, because it is a property of the
harness rather than of this adapter. DeepSeek Harness executes its own tools:
its wire has no frame meaning "here is your catalogue". A host that wants the
catalogue to be the permission-filtered one must deliver it out of band, and
the harness's own path for that is an MCP server (`dsh-mcp-client`). So
[HarnessProtocol.describeTools](#describetools) renders the harness's `ToolSchema` shape, which is what
that out-of-band channel carries, and no frame is emitted for it.

---

### DEEPSEEK\_REQUIREMENTS

> `const` **DEEPSEEK\_REQUIREMENTS**: [`HarnessRequirements`](#harnessrequirements) = `DEEPSEEK_VENDOR.requirements`

Defined in: [packages/adapters/src/vendors.ts:146](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L146)

---

### DEEPSEEK\_RUNTIME\_MANIFEST

> `const` **DEEPSEEK\_RUNTIME\_MANIFEST**: [`RuntimeManifest`](sharedos-contracts.md#runtimemanifest) = `DEEPSEEK_VENDOR.manifest`

Defined in: [packages/adapters/src/vendors.ts:145](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L145)

---

### DEEPSEEK\_VENDOR

> `const` **DEEPSEEK\_VENDOR**: [`HarnessVendor`](#harnessvendor)

Defined in: [packages/adapters/src/vendors.ts:114](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L114)

---

### deepseekFrameWriter

> `const` **deepseekFrameWriter**: [`HarnessFrameWriter`](#harnessframewriter)

Defined in: [packages/adapters/src/writer.ts:92](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L92)

Frames in the session-log shape DeepSeek Harness streams.

Wrapped in their `session.event` notification rather than left bare, because
that is the shape a live SDK runtime emits and a fixture that skipped the
envelope would exercise only half of what the parser has to accept.

---

### deepseekProtocol

> `const` **deepseekProtocol**: [`HarnessProtocol`](#harnessprotocol)

Defined in: [packages/adapters/src/deepseek/protocol.ts:102](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/deepseek/protocol.ts#L102)

---

### PI\_HARNESS\_ID

> `const` **PI\_HARNESS\_ID**: `"codex"` \| `"claude-code"` \| `"deepseek"` \| `"pi"` = `PI_VENDOR.id`

Defined in: [packages/adapters/src/vendors.ts:148](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L148)

---

### PI\_PROTOCOL\_ID

> `const` **PI\_PROTOCOL\_ID**: `"pi.rpc.jsonl"` = `"pi.rpc.jsonl"`

Defined in: [packages/adapters/src/pi/protocol.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/pi/protocol.ts#L31)

Pi speaks newline-delimited JSON events in its RPC mode (`pi --mode rpc`).

The message vocabulary is the layer this module targets: an `AssistantMessage`
whose content carries `toolCall` blocks, a `ToolResultMessage` carrying the
result back, and the `agent_end` / `response` frames that end a turn. It is
deliberately not Pi's streaming delta events, which restate the same content
token by token; Pi's own guidance is to treat the assembled message as
authoritative, and reading both would issue every call twice.

Two asymmetries are worth stating plainly, because both are properties of the
harness rather than of this adapter:

- Pi does not declare tools on the RPC wire, and ships no MCP client of its
  own. Its path for a host-supplied tool is `defineTool` through the SDK, or
  an extension such as `pi-mcp-adapter`, which is how the MCP column reaches
  it; [HarnessProtocol.describeTools](#describetools) renders the `defineTool` shape and
  no frame is emitted for it.
- Pi executes its own tools. `tool_execution_start` announces a call Pi is
  already running, not a request for the host to run one, so it is not read
  as a tool call. The `toolCall` content block -- the model's actual request
  -- is.

---

### PI\_REQUIREMENTS

> `const` **PI\_REQUIREMENTS**: [`HarnessRequirements`](#harnessrequirements) = `PI_VENDOR.requirements`

Defined in: [packages/adapters/src/vendors.ts:150](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L150)

---

### PI\_RUNTIME\_MANIFEST

> `const` **PI\_RUNTIME\_MANIFEST**: [`RuntimeManifest`](sharedos-contracts.md#runtimemanifest) = `PI_VENDOR.manifest`

Defined in: [packages/adapters/src/vendors.ts:149](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L149)

---

### PI\_VENDOR

> `const` **PI\_VENDOR**: [`HarnessVendor`](#harnessvendor)

Defined in: [packages/adapters/src/vendors.ts:122](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L122)

---

### piFrameWriter

> `const` **piFrameWriter**: [`HarnessFrameWriter`](#harnessframewriter)

Defined in: [packages/adapters/src/writer.ts:135](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/writer.ts#L135)

Frames in the RPC message shape Pi speaks.

---

### piProtocol

> `const` **piProtocol**: [`HarnessProtocol`](#harnessprotocol)

Defined in: [packages/adapters/src/pi/protocol.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/pi/protocol.ts#L95)

## Functions

### decodeChatCompletion()

> **decodeChatCompletion**(`payload`): [`ModelReply`](#modelreply) \| `undefined`

Defined in: [packages/adapters/src/model/client.ts:331](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L331)

One chat-completions response body, read into what the driver needs of it.

`undefined` is a body the schema refused, and the caller decides what that
means -- the client turns it into a request error. It is a function rather
than a method so the read can be measured on its own: this is the native
harness's frame parse, the counterpart of a vendor adapter's `interpret`, and
the bench charges it per call the way it charges the others.

#### Parameters

| Parameter | Type      |
| --------- | --------- |
| `payload` | `unknown` |

#### Returns

[`ModelReply`](#modelreply) \| `undefined`

---

### defineHarnessVendor()

> **defineHarnessVendor**(`definition`): [`HarnessVendor`](#harnessvendor)

Defined in: [packages/adapters/src/vendors.ts:55](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/vendors.ts#L55)

One vendor's manifests and requirements from its few facts.

Every harness here can also authenticate from a session it stored itself
(`codex login`, a Claude subscription, `dsh`'s credentials file, Pi's
`auth.json`), so credentials are optional for all of them.

#### Parameters

| Parameter    | Type                                                  |
| ------------ | ----------------------------------------------------- |
| `definition` | [`HarnessVendorDefinition`](#harnessvendordefinition) |

#### Returns

[`HarnessVendor`](#harnessvendor)

---

### encodeModelMessage()

> **encodeModelMessage**(`message`): [`JsonObject`](sharedos-contracts.md#jsonobject)

Defined in: [packages/adapters/src/model/client.ts:363](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/client.ts#L363)

One message in the shape the provider's wire carries it.

#### Parameters

| Parameter | Type                            |
| --------- | ------------------------------- |
| `message` | [`ModelMessage`](#modelmessage) |

#### Returns

[`JsonObject`](sharedos-contracts.md#jsonobject)

---

### harnessTurnText()

> **harnessTurnText**(`request`): `string`

Defined in: [packages/adapters/src/harness.ts:52](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/harness.ts#L52)

The instructions and the prompt as one text, instructions first, for a
harness whose opening frame carries a single message.

#### Parameters

| Parameter               | Type                                                 |
| ----------------------- | ---------------------------------------------------- |
| `request`               | \{ `instructions?`: `string`; `prompt`: `string`; \} |
| `request.instructions?` | `string`                                             |
| `request.prompt`        | `string`                                             |

#### Returns

`string`

---

### modelToolResultMessage()

> **modelToolResultMessage**(`result`): [`ModelMessage`](#modelmessage)

Defined in: [packages/adapters/src/model/driver.ts:465](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L465)

The message that answers one call, in the shape the model reads it back.

#### Parameters

| Parameter | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`  | \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `output`: [`JsonValue`](sharedos-contracts.md#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"denied"`; `tool`: `string`; \} \| \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `status`: `"failed"`; `tool`: `string`; \} |

#### Returns

[`ModelMessage`](#modelmessage)

---

### readModelToolCall()

> **readModelToolCall**(`call`, `codec`, `offered`, `context`): [`ModelToolCallReading`](#modeltoolcallreading)

Defined in: [packages/adapters/src/model/driver.ts:434](https://github.com/systemind-team/SharedOS/blob/main/packages/adapters/src/model/driver.ts#L434)

Read one call off a reply: the provider's alphabet back to the catalogue's,
the argument blob parsed, and the escalate affordance recognised by name when
the turn was offered it. `#release` on the session says what each answer
means and why; this is only the reading.

A function rather than a method because the native harness has a
translation layer like any vendor adapter -- this, and the reply decode in
the client -- and the bench charges it per call the way it charges the
others. Measuring a copy of the driver's logic would not be measuring the
driver, so the session calls exactly this.

#### Parameters

| Parameter         | Type                                        |
| ----------------- | ------------------------------------------- |
| `call`            | [`ModelToolCall`](#modeltoolcall)           |
| `codec`           | [`ToolNameCodec`](#toolnamecodec)           |
| `offered`         | `boolean`                                   |
| `context`         | \{ `now`: `string`; `traceId`: `string`; \} |
| `context.now`     | `string`                                    |
| `context.traceId` | `string`                                    |

#### Returns

[`ModelToolCallReading`](#modeltoolcallreading)
