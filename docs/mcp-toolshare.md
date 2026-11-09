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

`ToolNameSchema` enforces it at registration: one or more characters of
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
told. `instructions` is the seat's environment: the turn's reach rendered by
`describeReach`, then the limits the host set rendered by `describeLimits`,
sent as the MCP server's initialize instructions here and as a system message
by the model driver. `prompt` is the task the harness was launched with.
`instructions` is `null` when the host sent none. A turn told its limits is told
something different from one that was not, so it carries a different hash.

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

## Tool classes

| Class           | `ToolPolicy` field | Example                         | SharedOS authorized? | Recommendation                                   |
| --------------- | ------------------ | ------------------------------- | -------------------- | ------------------------------------------------ |
| Managed         | `managedMcp`       | `files.search`, brokered GitHub | Yes                  | The normal SharedOS path                         |
| Harness-local   | `harnessLocal`     | patch tool, bounded shell       | No                   | Allow only if the sandbox cannot bypass SharedOS |
| External direct | `externalDirect`   | independently configured Jira   | No                   | Explicit opt-in hybrid mode                      |

`ToolPolicy` declares which a run had:

```json
{
  "mode": "strict",
  "managedMcp": ["sharedos"],
  "harnessLocal": ["apply_patch"],
  "externalDirect": []
}
```

versus

```json
{
  "mode": "hybrid",
  "managedMcp": ["sharedos"],
  "harnessLocal": ["shell", "apply_patch"],
  "externalDirect": ["github", "browser"]
}
```

A `strict` policy that also lists `externalDirect` entries is rejected by the
schema, rather than producing a run whose headline claim its own manifest
contradicts. `harnessLocal` stays permitted under `strict`, since most CLIs keep
tools of their own, but the entries must be named, and a launch that leaves the
harness none of its own, as a host's `--tools 'mcp__sharedos__*'` does for Pi,
declares `[]`: the catalogue Pi's MCP client declares is not a local tool.
No spec drops the other MCP servers a CLI loads, so a column run on a machine
that configures servers of its own for the CLI declares them as
`externalDirect`, and is `hybrid`.

A conformance column that declares a policy has it written to every execution
record it produces, as `system.toolPolicy`, beside `catalogHash`. The policy is
what the host declares, not what the launch enforces: SharedOS's launches no
longer drop a CLI's own MCP servers, so `strict` means the host named no
`externalDirect` server, and is only as true as that declaration
([ADR 0014](adr/0014-mcp-toolshare.md), amended 2026-11-08). `mcpColumn`
takes it as `toolPolicy`, and `scripts/mcp-conformance.mjs` passes each CLI's.
A column that declares none, the scripted ones among them, leaves the field
absent: the managed catalogue was all it had.

This is what makes a result readable. "The kernel refused every violation" means
one thing when the managed catalogue was the only way to have an effect, and
almost nothing when the harness also had a shell.

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

The harness keeps its own loop and declares no step, so the envelope's
`maxSteps` does not apply and `step_limit_exceeded` cannot arise.
`maxToolCalls` and `timeoutMs` are the limits when the host sets them; neither
has a default. A call past the budget comes back `denied` /
`tool_call_limit_exceeded` as a result the harness reads, and its message names
the budget and says no further call to these tools will run this turn, except
asking for a human where the turn offers `sharedos.escalate`. The budget counts
calls to this server's tools and nothing else: the harness's own tools, which
never reach SharedOS, are neither counted nor refused, and the message speaks of
"these tools" so it stays true for a harness that has them. `createMcpHarnessRuntime` tells the
harness those two limits up front, in its initialize instructions, naming the
budget as calls to the server's tools, and does not tell it a step budget,
since none binds it.

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
rather than leaving it to search from the root. After the reach come the call
budget and deadline the host set, rendered by `describeLimits`, and nothing
when it set neither. An `instructions` string on the options is the host's
standing guidance and is placed before it; a function of the turn request
replaces the composition, and returning `undefined` sends none.
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
bridge. Codex finds its project root and its AGENTS.md files itself, walking up
from the workspace to the nearest repository marker; a host whose
`workspaceRoot` sits inside a repository may append
`-c project_root_markers=[]` through `args`, so the workspace is the project
root and no checkout above it is read.

Each spec writes the turn's prompt to its CLI's stdin and closes it: `claude -p`
with no prompt argument, `codex exec -` and dsh's headless `-` each read the
prompt from there, and Pi takes it as an RPC frame on the same channel. A prompt
passed as an argument fails the launch with `E2BIG` once it is past the 128 KiB
the kernel allows one argument, and one that starts with `-` is read as an
option; on stdin neither happens. How much a CLI reads there is its own limit:
Claude Code takes up to 10 MB.

Each spec hands its CLI the connection in the one form that CLI takes, and
nothing else:

| Harness     | Form               | Shape                                                                                                 |
| ----------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Codex       | `-c` overrides     | `mcp_servers.sharedos.url`, `required=true`, and `bearer_token_env_var` when the bridge takes a token |
| Claude Code | `.mcp.json`        | `{"type":"http","url":…}`                                                                             |
| DeepSeek    | `cordis.patch.yml` | one `@deepseek-ai/dsh-mcp-client` plugin entry                                                        |
| Pi          | `.pi/mcp.json`     | `{"url":…,"exposure":"direct"}`                                                                       |

The DeepSeek overlay must use dsh's `insert:` form. A bare `id:` entry _overrides_
a plugin already in the tree and does not add one; dsh warns `patch: entry "..."
not found` on stderr and boots without the client, which downstream reads as a
harness that declined the catalogue rather than as a misconfigured one. The
plugin also has to be installed into the profile first — a patch activates a
plugin, it does not fetch one:

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-mcp-client
```

### What each launch sets, and what it leaves alone

SharedOS allows, denies or escalates the calls that reach it through MCP, and
nothing else. It imposes no restriction on a harness's own tools or on which
other MCP servers the harness loads: Claude Code keeps its file and shell tools
and the MCP servers configured on the machine, and Codex and DeepSeek Harness
keep theirs, as they always did. Pi's launch is the one exception, below: it
still turns Pi's built-in tools off. A host that wants a restriction appends it
through `args`, for example `--disallowedTools Bash,Edit,Write` or
`--strict-mcp-config` for Claude Code.

A harness that reaches for its own tool instead of the catalogue's leaves no
operation in the record. That is a finding about the harness, recorded as
such: the row is `not exercised`, never a pass and never a kernel failure.

What each launch does set is a permission-_prompt_ or connection decision
rather than an authorization one: what secures the run is that every call is
re-authorized by the kernel.

- **Claude Code.** `--allowedTools mcp__sharedos` auto-approves the SharedOS
  server and nothing else: Claude separates prompting from authorization, and
  print mode has no human to prompt. No `--max-turns` is set: like every other
  spec's, a Claude turn ends at the host's tool-call and time limits, if it set
  any, and a host that wants Claude's own cap passes it through `args`.
- **Codex.** `mcp_servers.sharedos.required=true` stops a run whose bridge
  failed to start rather than continuing with Codex's own tools, which would
  look like a harness that declined the catalogue. Codex says why only on
  stderr (`required MCP servers failed to initialize: sharedos: ...`), so the
  spec reads that line, fails the turn `harness_not_connected` with Codex's
  reason and ends Codex. It is only as good as `required`, which Codex
  honours from 0.99 and ignores before: an older Codex whose bridge failed
  runs the turn alone with its own tools.
  `default_tools_approval_mode="approve"`, scoped to this one server, is the
  same decision as Claude's `--allowedTools`: Codex's default `auto` mode asks a
  human before any tool that is not read-only, `codex exec` has no human, and
  the refusal would happen inside Codex with the kernel never consulted.
- **DeepSeek Harness.** `--profile headless --patch <overlay> --json -`: the
  overlay adds the MCP client entry on top of the profile and the owner's own
  dsh configuration and removes nothing from either, and `--json` has the run
  printed as events, of which the turn's outcome is read from `final`. The
  overlay names the connection and sets no `failOnStartupError`; a host that
  wants it adds it to the overlay it writes itself, though from dsh 0.1.6 it
  stops nothing. A run whose client could not reach the bridge goes on with
  only dsh's own tools, which would read as a harness that declined the
  catalogue, so the spec reads dsh's stderr for the line naming the SharedOS
  entry (`mcp-sharedos (@deepseek-ai/dsh-mcp-client): Error: ...`), which
  dsh prints regardless of that key, fails the turn `harness_not_connected`
  and ends dsh. An MCP server of the owner's own that fails to start is left
  alone.
- **Pi.** `--mode rpc --no-session --approve`: a session-less RPC run. Pi
  keeps its own tools, `read`, `bash`, `edit` and `write`, and a host may
  narrow them through `args` with `--tools`. `--approve` is what lets Pi read
  the `.pi/mcp.json` written for the turn, and it trusts more than that file;
  see [what `--approve` trusts](#what---approve-trusts).

### Versions

SharedOS enforces no version floor on any CLI. It launches whatever is
installed and records the version the CLI reports: `probeHarness` returns it
with the line it was read from, and the conformance scripts write it beside
each column. The floors below are what probes of each CLI found, recorded as
information about where a launch starts to work as described, not as a check
anything runs:

| CLI            | From    | What                                                                  |
| -------------- | ------- | --------------------------------------------------------------------- |
| Codex          | 0.44    | The `codex exec --json` event shape the protocol reads                |
| Codex          | 0.46    | `bearer_token_env_var`; an inline `bearer_token` is refused from here |
| Codex          | 0.99    | `required` on an MCP server                                           |
| Claude Code    | 2.1.221 | MCP servers connected before the first turn in `-p` mode              |
| DeepSeek (dsh) | 0.1.6   | `-` reads the headless task from stdin, and `--json`                  |

Where a CLI changed a shape the adapters read, both are read: a Claude Code
`result` is a failure by its `subtype` on every version, though before 2.1.89
`is_error` was `false` on a run Claude stopped, and dsh's headless `final`
carries the run's last turn reason from 0.2.2, with the exit code deciding
before it.

### Pi's own MCP client

Pi has shipped a native MCP client since 0.99, so Pi 0.99 or later needs no
extension to reach the catalogue.

Pi reads servers from the `mcp.json` in its agent directory
(`~/.pi/agent/mcp.json` by default) and from `.pi/mcp.json` under the directory
it runs in. It does not read a root `.mcp.json`, and it takes no flag naming a
config file. `PI_MCP_HARNESS` writes `.pi/mcp.json` into the turn's scratch
workspace, and since Pi reads a project file only for a project it trusts, the
launch passes `--approve`. Nothing is written to the agent directory.

SharedOS passes no flag that narrows what Pi offers its model. Unless the host
restricts them, the model sees beside the catalogue Pi's own built-in tools,
`read`, `bash`, `edit` and `write`, the tools of any servers in the agent
directory's `mcp.json`, which Pi connects as well, and Pi's `codemode` tool,
which Pi turns on when a server it connects has `codemode` exposure, Pi's
default. A host may narrow them through `args` with `--tools`, and one that
wants Pi's model kept to the
catalogue appends `--tools 'mcp__sharedos__*'` through `args` (with its own
server name if it set one). Pi still connects the other servers, and declares
only the catalogue's tools to the model.

`piMcpConfig` gives the server `direct` exposure, so each tool is declared to
the model as a tool of its own, named `mcp__<server>__<tool>` with every
character outside `[A-Za-z0-9_]` made an underscore: `files.read` reaches the
model as `mcp__sharedos__files_read`. A name that would run past 64 characters,
or one two tools would share, is cut to fit and ends in an 8-character hash.
Pi's default exposure, `codemode`, would hide the catalogue behind a single
scripting tool. Either way Pi runs the call itself, and what arrives at the
bridge is an ordinary `tools/call` naming the canonical tool, authorized like
any other. The manifest stamps `mcpSupport: "native"`.

A bearer token goes in `headers.Authorization` with every `$` in it doubled.
Pi reads `$NAME` and `${NAME}` in a header value as environment variables and
`$$` as one `$`, so a token written as chosen could reach the bridge rewritten
and be refused.

Pi connects its servers in the background when the session starts, and the
first prompt waits up to 10 seconds for servers with direct tools. That wait is
Pi's own. SharedOS sets no limit there.

### What `--approve` trusts

`--approve` makes Pi trust the turn's workspace as a project for that one run.
In the words of Pi's own trust prompt, that allows it to load `.pi` settings
and resources, install missing project packages, and execute project
extensions. In the workspace, that covers everything under `.pi/`: the
`mcp.json` SharedOS wrote and anything a host writes there with `turnFiles`.
A `.pi/settings.json` naming packages would have Pi install them, and a file
under `.pi/extensions` would run as code. The trust also loads `.agents/skills`
from the workspace and from every directory above it.

So a host keeps its turn-file names fixed in its own code rather than taking
them from a turn's input, and chooses a `workspaceRoot` with no `.agents/skills`
in any directory above it. The default root is the operating system's
temporary directory, which on a shared machine other users can write to.

An extension that replaces Pi's client, such as `pi-mcp-adapter`, is still the
host's choice. It is loaded with flags the host appends through `args`, and from
then on what it reads and how it names tools are its own.
`scripts/mcp-conformance.mjs` records such a column as `mcpSupport: "extension"`
only when the host configuration names the extension with `mcpExtension`.

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

Pass the token as `McpHarnessRuntimeOptions.token` and each spec hands it to its
CLI in the form that CLI takes: a header in Claude Code's and DeepSeek's
configuration, Pi's `bearerToken`, and for Codex the environment variable
`SHAREDOS_MCP_TOKEN` (`SHAREDOS_MCP_TOKEN_VARIABLE`), which the Codex override
names as `bearer_token_env_var`. None of these hides the token from the harness
itself. Codex's default `shell_environment_policy` passes its environment,
the variable included, to every shell command the model runs, as the other
harnesses can read the workspace files their tokens are written to. That is
safe for the reason below: the token identifies the session and carries no
authority, and the bridge re-authorizes every call.

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
the model column when a key is present. It runs each CLI with its own tools,
like any host that sets no restriction. Driven over its stdio a CLI runs those
tools itself, Pi with no permission prompt at all, so a call naming one of them
(a name with no `<namespace>.` prefix) has already happened when its frame is
read: it is recorded as run by the harness, counted under `harnessRan` in
`native-conformance.json`, and never handed to the envelope, so it is not
recorded as refused. The row it stood in for reads `not exercised`. A call
naming a SharedOS-shaped tool the CLI does not have is passed on and refused
as before. It shares `--case`, `--harness` (which
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
containing one. `externalDirect` names the MCP servers the machine configures
for that CLI, which the launch leaves loaded, and makes the column's declared
policy `hybrid`; `harnessLocal` replaces the CLI's built-in tool list when
`args` narrowed it. Declaring `credentialVariables` also makes the credential
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
