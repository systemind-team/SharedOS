# MCP toolshare

SharedOS is the canonical tool catalogue and authorization broker. MCP is the
default interoperability boundary presented to external harnesses.

```
Harness configuration declares a CONNECTION.
SharedOS declares the TOOLS.
SharedOS capabilities declare the AUTHORITY.
RuntimeHost is the only EXECUTION path.
```

Everything below follows from those four lines. The design decisions and the
alternatives rejected along the way are in
[ADR 0014](adr/0014-mcp-toolshare.md).

## Why this exists

SharedOS could already drive a vendor harness through `@aicoo/sharedos-adapters`:
the adapter speaks the vendor's API-layer tool-call shape and SharedOS owns the
turn loop. That path is exact, and it cannot be pointed at an installed CLI. No
coding-agent CLI exposes its API layer, and none has a wire frame meaning _here
is your tool catalogue_ — so a live CLI told to call `files.read` reaches for its
own `Read` instead, and every kernel row goes unexercised.

MCP is the one interface Codex, Claude Code, and DeepSeek Harness all accept a
host-supplied tool set on. Over it, the CLI runs natively — its own loop, on
whatever model it is configured with — and still cannot take an action SharedOS
did not authorize.

## One name, three places

```
ToolDefinition.name  =  SharedOS canonical tool ID  =  raw MCP Tool.name
```

`ToolNameSchema` enforces it at registration: 1–128 characters of
`[A-Za-z0-9_.-]`, deliberately narrower than `IdentifierSchema`. A tool name goes
on a wire, so the character set has to be one every harness carries unchanged.

Names are globally unique across namespaces. Two brokered providers exposing the
same underlying operation publish two names:

```
files.search        github.search        notion.search
```

never `search` three times.

A harness may rewrite the name for its own display — Claude Code, Codex, and
DeepSeek all use `mcp__<server>__<tool>`, and DeepSeek appends a hash when
normalisation would collide. That alias is presentation. It is recorded on the
bridge for diagnosis, never on the `ToolCall`, so it cannot reach an
authorization decision even by mistake.

## What crosses the boundary

`PublishedToolDefinition` is defined by what it omits:

| Published                               | Never published                                     |
| --------------------------------------- | --------------------------------------------------- |
| `name`, `description`                   | `requiredCapability`, `resolveRequirement`          |
| `inputSchema`, `outputSchema`           | grants, issuing authority, `AccessContext`          |
| `annotations` (MCP hints)               | namespace settings, credentials, handler references |
| `metadata.namespace`, `metadata.source` |                                                     |

The omission is load-bearing rather than tidy. Authorization is
`resource + action + context`, resolved from the **arguments** at call time — not
`grant → files.read` — so two calls to one published tool routinely need
different authority:

```
files.read(path="/public/a.txt")   → allowed
files.read(path="/private/a.txt")  → denied
```

The canonical tool ID identifies the operation implementation, not the authority.
Publishing a capability requirement would therefore be both a leak and a lie.

The same projection applies wherever a model is shown a catalogue, not only over
MCP. `GET /v1/tools` and `RuntimeTurnRequest.tools` carry full `ToolDefinition`s
for the host's benefit; a client or driver that feeds a model from either
applies `publishToolCatalog` first. `StandardTurnDriver` projects further, to a
name, a description and the input schema. See the
[HTTP reference](http-api.md#get-v1tools).

## Per turn, never global

```
1. SharedOS resolves a trusted AccessContext.
2. kernel.listTools(context) computes the effective catalogue.
3. A turn-scoped MCP bridge exposes only those tools.
4. The harness runs.
5. Every tools/call becomes a SharedOS ToolCall.
6. RuntimeHost.invokeTool() re-authorizes the exact call.
7. The bridge closes when the turn closes.
```

`ContextToolProvider` exists so one user's MCP catalogue never mutates a registry
shared with concurrent users, and that invariant now runs all the way through the
harness. There is no long-lived SharedOS MCP server holding a union of every
user's tools: it would have to re-derive who is asking on every call, and would
be wrong once.

Step 7 is not housekeeping. Harness processes outlive their turns — on
cancellation, on timeout — and after the bridge closes such a process finds a
shut door and a released port rather than a catalogue resolved for a turn that
has ended.

## Refusals are results

```
SharedOS succeeded → MCP successful content/result
SharedOS denied    → MCP tool error/result, never transport error
SharedOS failed    → MCP tool error/result
cancellation       → aborted MCP request/session
```

A JSON-RPC error means the request could not be processed. A harness receiving
one learns nothing about its authority; most retry, some abandon the turn. A
denial is a processed request whose answer is "no", and returning it as
`isError: true` is what lets a harness report the refusal and carry on.

`denied` and `failed` stay distinguishable in the payload and in
`_meta["sharedos/status"]`. They mean different things — policy refused this,
versus the tool broke — and collapsing them makes a denial rate uncountable.

## Catalogue hashes

```
catalogHash = SHA-256(canonical JSON(tools sorted by canonical name))
```

Field participation is the contract, not an implementation detail. It is fixed by
`CATALOG_HASH_FIELDS` and asserted by the projection, which cannot emit a key
outside it:

| Participates                   | Does not      |
| ------------------------------ | ------------- |
| `name`, `description`          | `executionId` |
| `inputSchema`, `outputSchema`  | harness alias |
| `annotations`                  | runtime name  |
| `metadata` (namespace, source) | transport     |

Without fixed participation, two implementations can both claim to compute
`catalogHash` and agree on nothing.

The hash lands in `SystemIdentity` on every execution record. That turns
cross-harness comparison into a check: two columns whose hashes differ were not
given the same tool set, and their refusal behaviour cannot be compared until
that is explained. It also catches schema drift, a missing tool, a renamed tool,
and a stale discovery cache — failures that otherwise look like a harness
behaving differently.

## Prompt hash

```
promptHash = SHA-256(canonical JSON({ instructions, prompt }))
```

The catalogue is one of two things the model reads; the other is what it is
told. `instructions` is the seat's environment — the turn's reach rendered by
`describeReach`, sent as the MCP server's initialize instructions here and as a
system message by the model driver — and `prompt` is the task the harness was
launched with. `instructions` is `null` when the host sent none.

Both shipped runtimes compute it, in this one shape, before the seat is sent
anything, and it lands in `SystemIdentity` beside `catalogHash`. The evaluation
harness driver does too: it hands both texts to its transport on
`HarnessTurnRequest`, and `harnessTurnText` is the two as one message for a
harness whose opening frame has one slot. The same words
carry the same hash whichever runtime said them. It covers what SharedOS said:
a CLI's own system prompt is added on the far side of the wire and is not
claimed.

It exists for the comparison `catalogHash` does not cover. Two runs of one
column that differ only in wording are asking the model different questions,
and a cell that moved between them is not the model choosing differently. The
conformance manifest folds each column's per-turn hashes into a prompt-set hash
so that check is one field per column rather than one per record.

## Tool classes and evidence

`ToolPolicy` version `"2"` describes a host-declared tool surface. It does not
prove process isolation or certify that every actual effect was mediated.

| Class           | Field            | Examples                                                   | SharedOS authorized?                       |
| --------------- | ---------------- | ---------------------------------------------------------- | ------------------------------------------ |
| Managed         | `managedMcp`     | SharedOS endpoints serving `files.read` or brokered GitHub | Calls through the broker are re-authorized |
| Harness-local   | `harnessLocal`   | `shell`, `apply_patch`, local reads, planning tools        | No                                         |
| External direct | `externalDirect` | Independently connected GitHub or browser MCP servers      | No                                         |

| Mode          | Required declaration                                                           | What a reader may conclude                                                          |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `broker-only` | `inventory: "complete"`, empty local and external lists, supporting `evidence` | The host declares that every available tool effect uses the broker                  |
| `mixed`       | At least one local or external entry                                           | Named paths exist outside SharedOS mediation; the inventory may still be incomplete |
| `unknown`     | No named outside path and `inventory: "unknown"`                               | Available harness capabilities have not been established                            |

There is no harmless-local exemption in this version. Local reads can expose
resources outside the capability scope; a planner or calculator also remains
outside SharedOS's observation. All are conservatively classified as `mixed`.
A proxy whose only operation forwards calls to this turn's SharedOS endpoint
may be treated as part of the managed connection, provided the host's inventory
review covers that forwarding implementation and its effective configuration.
Extensions that can call other servers or execute local operations are outside
paths. A tool name, read-only hint, allowlist, or prompt cannot establish this
property.

A declared broker-only configuration looks like:

```ts
const policy = declareToolPolicy({
  inventory: "complete",
  harnessLocal: [],
  externalDirect: [],
  evidence: ["host-review://run-42/effective-config-and-tool-inventory"],
});
```

The completeness declaration requires both lists explicitly, even when empty.
`evidence` contains references to host-owned artifacts, such as the exact CLI
version and arguments, effective inherited configuration, extension inventory,
and reviewed tool implementations. The schema checks references are present;
it does not fetch or verify them. Hosts must retain those artifacts and review
all applicable paths before claiming a complete inventory. Neither the
references nor `toolPolicyHash` prove OS or process isolation.

`declareToolPolicy({ harnessLocal: ["shell", "apply_patch"] })` produces
`mixed`, with an unknown inventory. Independently connected MCP tools also
produce `mixed`. Omitting the declaration, or supplying empty lists without an
explicit complete inventory and evidence, produces `unknown`. Disabling named
built-ins does not establish that extensions, profiles, inherited servers, or
operator-supplied arguments introduced no other paths.

`createMcpHarnessRuntime` accepts `toolPolicy`, validates and snapshots it, and
annotates the turn before launching the process, so the declaration also
survives cancellation. Its default is unknown. `mcpColumn` accepts a column
declaration, and execution-record assembly writes the runtime or column policy
to `system.toolPolicy`. Conflicting declarations and invalid runtime policies
are rejected. When neither exists, assembly writes an unknown policy; absence
in older records also means unknown.

Authorization and audit receipts substantiate only operations that reached
SharedOS. A denied broker call does not show whether a shell, local write, or
independent server caused a similar effect. The current conformance suite does
not observe those paths; it must not turn broker refusal evidence into a claim
about all process effects. This change adds classification and evidence, not a
sandbox or bypass detector. See [ADR 0027](adr/0027-tool-policy-classification.md)
for protocol migration and release coordination.

## Using it

### Inside a turn

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
  // ... point the harness at http.url and run it ...
} finally {
  bridge.close();
  await http.close();
}
```

A turn served this way is bounded by calls. The harness keeps its own loop and
declares no step, so the envelope's `maxSteps` does not apply and
`step_limit_exceeded` cannot arise; `maxToolCalls` and `timeoutMs` are the
limits, and a call past the budget comes back `denied` /
`tool_call_limit_exceeded` as a result the harness reads.

### Outside a turn

```ts
import { kernelToolBridge } from "@aicoo/sharedos-mcp";

const invoker = kernelToolBridge({ kernel, context, executionId });
```

Every kernel guarantee still holds — filtered discovery, per-call
re-authorization. What is absent is the envelope: no step or tool-call budget and
no execution event stream, so a turn's evidence cannot be assembled from a
session served this way.

### The installed CLIs

```ts
import { CLAUDE_CODE_MCP_HARNESS, createMcpHarnessRuntime } from "@aicoo/sharedos-adapters/node";

const runtime = createMcpHarnessRuntime(CLAUDE_CODE_MCP_HARNESS);
```

`CODEX_MCP_HARNESS`, `DEEPSEEK_MCP_HARNESS`, and `PI_MCP_HARNESS` are the others.

Per turn, the server's initialize `instructions` carry where the turn may
operate — `RuntimeVisibleContext.reach`, rendered by `describeReach` — so a
harness that surfaces server instructions shows its model the granted paths
rather than leaving it to search from the root. An `instructions` string on the
options is the host's standing guidance and is placed before it; a function of
the turn request replaces the composition, and returning `undefined` sends none.
Whether the model sees the text is the harness's doing: Claude Code surfaces
server instructions, and a harness that does not shows its model the catalogue
alone, which is what it saw before.

The CLI runs in a scratch workspace made for the turn and removed with it. A
host that wants the CLI's own instruction loader to carry its standing guidance
writes a file there with `turnFiles`, a function of the turn request returning
`{ filename, contents }` pairs: Codex, Claude Code and Pi each read an
`AGENTS.md` from the directory they are run in, so a brief rendered into that
file reaches the model the way a project's instructions do, and the prompt
carries only the turn. The files are written before the CLI starts and are
named in `configPaths`; a filename that would leave the workspace, or that is
the name of the configuration the adapter generated for the CLI, fails the turn
before launch, since a file under that name would point the CLI away from the
bridge. Codex is launched with `project_root_markers=[]`, so the
workspace is its project root and no checkout above it is read.

Each spec hands its CLI the connection in the one form that CLI takes, and
nothing else:

| Harness     | Form               | Shape                                          |
| ----------- | ------------------ | ---------------------------------------------- |
| Codex       | `-c` overrides     | `mcp_servers.sharedos.url`, `required=true`    |
| Claude Code | `.mcp.json`        | `{"type":"http","url":…}`                      |
| DeepSeek    | `cordis.patch.yml` | one `@deepseek-ai/dsh-mcp-client` plugin entry |
| Pi          | `.mcp.json`        | `{"url":…,"lifecycle":"eager"}`                |

The DeepSeek overlay must use dsh's `insert:` form. A bare `id:` entry _overrides_
a plugin already in the tree and does not add one; dsh warns `patch: entry "..."
not found` on stderr and boots without the client, which downstream reads as a
harness that declined the catalogue rather than as a misconfigured one. The
plugin also has to be installed into the profile first — a patch activates a
plugin, it does not fetch one:

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-mcp-client
```

### What each launch turns off

These flags configure tool availability and permission prompts. SharedOS
re-authorizes calls through its broker; local tools and independent connections
remain outside that mediation.

- **Claude Code.** `--strict-mcp-config` requests use of only the supplied MCP
  configuration; the disallowed-tools list requests removal of named built-ins.
  These flags support configuration review but do not prove process isolation
  or completeness across CLI versions. Named remaining local tools make the
  conformance declaration mixed. `--allowedTools mcp__sharedos` auto-approves the server:
  Claude separates prompting from authorization, and print mode has no human to
  prompt.
- **Codex.** `mcp_servers.sharedos.required=true` stops a run whose bridge
  failed to start rather than continuing with Codex's own tools, which would
  look like a harness that declined the catalogue.
  `default_tools_approval_mode="approve"`, scoped to this one server, is the
  same decision as Claude's `--allowedTools`: Codex's default `auto` mode asks a
  human before any tool that is not read-only, `codex exec` has no human, and
  the refusal would happen inside Codex with the kernel never consulted.
- **DeepSeek Harness.** The plugin overlay sets `failOnStartupError: true` for
  the reason Codex's server is `required`: a run that quietly continued with
  only the harness's own tools would be a different finding.
- **Pi.** `--mode rpc --no-session --no-builtin-tools` requests a session-less
  RPC run with built-in tools disabled. Extensions remain enabled and require
  review; the conformance declaration remains unknown.

### Pi needs an extension, and which one is your choice

Pi is the one harness here that ships **no MCP client**. Some extension is
therefore **required** before Pi can reach an MCP server at all — but _which_
extension is a **choice the host makes**, not something SharedOS mandates.
`pi-mcp-adapter` is what this repository is exercised against:

```sh
pi install npm:pi-mcp-adapter
```

Anything with the same job would serve, and `piMcpConfig` emits that adapter's
file shape. A different extension may want a different one.

The effect is not identical to a native client, and it is worth knowing when
reading a Pi column. The adapter registers a single `mcp` proxy tool and
discovers the catalogue behind it on demand, so Pi's model calls
`mcp({tool: "files.read", …})` rather than `files.read`, and the harness-facing
surface is one tool wide. None of that reaches SharedOS: what arrives at the
bridge is an ordinary `tools/call` naming the canonical tool, authorized like any
other. The manifest stamps `mcpSupport: "extension"` and names the extension, so
a record says how the catalogue reached the harness rather than implying Pi did
it itself.

### Sandboxed or remote harnesses

Loopback plus an ephemeral port is enough when the port is known only to the
subprocess it was opened for. Otherwise mint a short-lived execution token:

```ts
const token = await mintExecutionToken(
  { executionId, namespaceId, actor: canonicalActor(agent), catalogHash, expiresAt },
  hostSecret,
);
const http = await createStreamableHttpMcpServer({
  server,
  authorize: async (presented) =>
    presented !== undefined &&
    (await verifyExecutionToken(presented, hostSecret, { now, expect: { executionId } })).valid,
});
```

`canonicalActor` renders an `Address` as `<kind>:<id>` — `agent:agent-bob` —
which is the one string form a token's `actor` takes; it is compared by
equality, never parsed back. The token identifies the broker session. It
carries no grants and no
capabilities: whoever presents it still receives exactly the catalogue that
turn's `AccessContext` resolved, and every call is still authorized from the
trusted grant source at the moment of the call. `catalogHash` is bound in so a
stale sandbox cannot reconnect and call tools it was never shown.

## Running the conformance column

```sh
pnpm build
pnpm conformance:mcp                                    # one case, every installed harness
pnpm conformance:mcp -- --config ./run.json --full      # every case, one pinned model
pnpm conformance:mcp -- --harness codex --case broker-ungranted,broker-out-of-scope
```

Live runs cost model tokens, so the default is one case; `--full` runs the whole
set and is what a published result should come from. Output lands in
`artifacts/conformance/mcp-conformance.json`.

| Flag or variable | Meaning                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--full`         | Every case                                                                                                                                                                |
| `--limit N`      | The first N cases (default 1): a smoke test, not a way to reach a row added at position eighteen; `0` probes the harnesses and runs none                                  |
| `--case a,b`     | Named cases; one that names no case stops the run                                                                                                                         |
| `--harness id`   | One column — `claude-code`, `codex`, `deepseek`, or `pi`; an id that names no column stops the run, and a named harness that is not installed is reported `not available` |
| `--config path`  | The operator's model and per-harness configuration (below); `SHAREDOS_MCP_CONFIG` is its default                                                                          |

`pnpm conformance:native` (`scripts/native-conformance.mjs`) is the other live
script: it drives each installed CLI as a harness over its own stdio, and runs
the model column when a key is present. It shares `--case`, `--harness` (which
also takes `model`, for the model column alone), and `--config` (default
`SHAREDOS_NATIVE_CONFIG`), has no `--limit` — it runs every case — and reads:

| Variable                                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHAREDOS_MODEL_API_KEY`, else `DEEPSEEK_API_KEY` or `DSH_API_KEY`     | The model column's key; without one the column does not run                                                                                                                                                                                                                                                                                                                               |
| `SHAREDOS_MODEL`, `SHAREDOS_MODEL_BASE_URL`, `SHAREDOS_MODEL_PROVIDER` | The model column's model (default `DSH_MODEL`, else the config's `model.id`, else `deepseek-v4-flash`), chat-completions root (default `https://api.deepseek.com`), and provider label (default the config's `model.provider`, else `deepseek`)                                                                                                                                           |
| `SHAREDOS_MODEL_THINKING`                                              | Whether the model reasons before it answers: `disabled` (default), `enabled`, or `provider` to send no such field. Off by default because the column measures what reaches the kernel, not how the model deliberates, and a reasoning model can spend its whole reply budget before its first call. The mode is named in the column's label and recorded on every turn as `modelSettings` |
| `DSH_RUNTIME_COMMAND`, `DSH_RUNTIME_CONFIG`, `DSH_RUNTIME_CWD`         | DeepSeek Harness's JSON-RPC runtime (default `dsh-jsonrpc-agent`), its plugin composition, and its working directory                                                                                                                                                                                                                                                                      |
| `DSH_PROVIDER`, `DSH_MODEL`                                            | What that runtime is told at `initialize` (default `deepseek-official`, `deepseek-v4-flash`)                                                                                                                                                                                                                                                                                              |

The scripted suite, `pnpm conformance` (`scripts/conformance.mjs`), takes
`--check` and `--strict` — what `conformance:check` passes — and `--no-build`,
which skips the package build when `dist` is already current.

### Holding the model constant

Comparing harnesses only means something if the model is the same on both sides;
otherwise a column that refused fewer violations may simply have had a weaker
model. `--config` takes a file the **operator** supplies — provider names, base
URLs, credentials, and per-vendor flags are not SharedOS's to know:

```json
{
  "model": { "id": "deepseek-v4-flash", "provider": "deepseek" },
  "harnesses": {
    "claude-code": {
      "credentialVariables": ["DEEPSEEK_API_KEY"],
      "env": { "ANTHROPIC_BASE_URL": "…", "ANTHROPIC_AUTH_TOKEN": "${DEEPSEEK_API_KEY}" },
      "args": ["--model", "deepseek-v4-flash"]
    }
  }
}
```

`env` and `args` are passed to the harness process untouched; `${VAR}` is read
from the ambient environment so a shared file can name a credential without
containing one. Declaring `credentialVariables` also makes the credential
_required_ for that column — every harness here can otherwise fall back to a
stored session login, and a stored session authenticates to the provider the
harness normally uses, not the one the run pinned.

SharedOS's only interest in the model is the `model` string, recorded on every
execution record. It does not select the model and cannot confirm the provider
served it — DeepSeek, for instance, silently maps an unrecognised model name to
`deepseek-v4-flash` rather than rejecting it. Two columns whose recorded models
differ are not comparable, and the run says so.

The column is reported separately from the committed manifest. Its correlation is
weaker than a scripted column's — a live harness mints its own call ids, so
attempts are matched on tool and resource — and its result depends on a model's
choices. A harness that is absent, unauthenticated, or that declines a declared
call leaves no operation in the record and is graded `not exercised`: never a
pass, and never a kernel failure.
