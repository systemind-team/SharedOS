# @aicoo/sharedos-adapters

What sits in the SharedOS delegate seat: a model API behind the standard driver,
or a vendor CLI (Codex, Claude Code, DeepSeek Harness, Pi) connected over MCP.

An adapter is translation and nothing else. The permission-filtered tool
catalogue, per-call re-authorization, the turn's limits and audit all come from
the SharedOS execution envelope, so seating another model or another harness
changes no kernel code and adds no second permission path.

## A model in the seat

```ts
import { SharedOSExecutor, createStandardRuntime } from "@aicoo/sharedos-runtime";
import { OpenAiCompatibleModelClient, StandardTurnDriver } from "@aicoo/sharedos-adapters";

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
import { CLAUDE_CODE_MCP_HARNESS, createMcpHarnessRuntime } from "@aicoo/sharedos-adapters/node";

const turns = new SharedOSExecutor(kernel, createMcpHarnessRuntime(CLAUDE_CODE_MCP_HARNESS));
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
assembly. See [ADR 0027](../../docs/adr/0027-tool-policy-classification.md).
