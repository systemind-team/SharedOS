# ADR 0014: MCP is the toolshare boundary

- Status: Accepted
- Date: 2026-08-23
- Revised: 2026-09-20. The declared `ToolPolicy` is written to the record. "Three
  tool classes" said what it declares and why a result cannot be read without
  it; nothing put it anywhere a reader of a record would find it.

## Context

SharedOS could exercise a vendor harness two ways, and neither reached the
kernel.

`EvalHarnessDriver` puts SharedOS in the model provider's seat. It speaks the
vendor's API-layer tool-call shape — Responses function calls, Anthropic content
blocks, `dsh` `tool/call`, Pi `toolCall` — and owns the turn loop. The
translation is exact, and the scripted columns prove it against the real kernel
and envelope. What it cannot do is run against an installed CLI: none of the four
CLIs measured on 2026-08-21 (Codex 0.149.0, Claude Code 2.1.238, `dsh`
0.1.1-rc.2, Pi 0.84.2) exposes its API layer or has any wire frame meaning "here
is your tool catalogue".

`native-conformance.mjs` adds the transport and inherits that gap. A live `claude
-p` instructed to call `files.read` reached for its own `Grep` and `ToolSearch`
instead: 83 operations, all correctly refused `tool_unavailable`, and zero
declared attempts issued. The column verified a transport binding and could not
exercise a single kernel row. **The blocker was the catalogue, not credentials**,
and no API key would have changed it.

MCP is the one interface Codex, Claude Code, and DeepSeek Harness all accept a
host-supplied tool set on. Pi ships no MCP client, and reaches one only through
an extension the host installs.

## Decision

**SharedOS is the canonical tool catalogue and authorization broker. MCP is the
default interoperability boundary presented to external harnesses.**

The canonical SharedOS tool ID _is_ the raw MCP tool name. There is no second
identity in the published catalogue:

```
ToolDefinition.name  =  SharedOS canonical tool ID  =  raw MCP Tool.name
```

`ToolNameSchema` makes that enforceable rather than documented. It is distinct
from `IdentifierSchema` — 1–128 characters of `[A-Za-z0-9_.-]` — because a tool
name is not an opaque host identifier: it goes on a wire, so the character set
has to be one every harness carries unchanged. A registration that cannot be
published is rejected at registration.

Harness-visible aliases (`mcp__sharedos__files_read`) are presentation. They are
recorded diagnostically on the bridge, never on the `ToolCall`, so no alias can
reach an authorization decision even by mistake.

### What crosses the boundary

`PublishedToolDefinition` is defined by what it omits. `requiredCapability`,
`resolveRequirement`, grants, issuing authority, namespace settings, credentials,
and handler references do not appear and never cross. A harness receives the
operation surface; SharedOS keeps the authority.

That separation is load-bearing rather than tidy. The capability check is
`resource + action + context`, resolved from the _arguments_ at call time — not
`grant → files.read` — so two calls to one published tool routinely need
different authority:

```
files.read(path="/public/a.txt")   → allowed
files.read(path="/private/a.txt")  → denied
```

The canonical tool ID identifies the operation implementation, not the authority.

### Per turn, not globally

`ContextToolProvider` exists so one user's MCP catalogue never mutates a registry
shared with concurrent users. That invariant now extends through the harness:

1. SharedOS resolves a trusted `AccessContext`.
2. `kernel.listTools(context)` computes the effective catalogue.
3. A turn-scoped bridge exposes only those tools.
4. The harness runs.
5. Every `tools/call` becomes a SharedOS `ToolCall`.
6. `RuntimeHost.invokeTool()` re-authorizes the exact call.
7. The bridge closes when the turn closes.

There is no long-lived SharedOS MCP server holding a union of every user's tools.
Such a server would have to re-derive who is asking on every call, and would be
wrong once.

### Refusals are results

```
SharedOS succeeded → MCP successful content/result
SharedOS denied    → MCP tool error/result, never transport error
SharedOS failed    → MCP tool error/result
cancellation       → aborted MCP request/session
```

A JSON-RPC error means the request could not be processed; a harness receiving
one learns nothing about its authority, and most retry. A denial is a processed
request whose answer is "no". Returning it as `isError: true` is what lets a
harness report the refusal and carry on — which is what the live Claude Code run
did, unprompted, on the first try.

`denied` and `failed` stay distinguishable in the payload. They mean different
things, and collapsing them would make a denial rate uncountable from the
evidence.

### Catalogue hashes

```
catalogHash = SHA-256(canonical JSON(tools sorted by canonical name))
```

Field participation is fixed by `CATALOG_HASH_FIELDS` and asserted by the
projection, which cannot emit a key outside it: `name`, `description`,
`inputSchema`, `outputSchema`, `annotations`, `metadata` (namespace and source)
participate; `executionId`, harness aliases, runtime names, and transports do
not. Without fixed participation two implementations can both claim to compute
`catalogHash` and agree on nothing.

The hash goes into `SystemIdentity`, which is what makes cross-harness comparison
a check rather than an assumption: two columns whose hashes differ were not given
the same tool set, and comparing their refusal behaviour says nothing until that
is explained. It also catches schema drift, a missing tool, a rewritten name, and
a stale discovery cache — failures that otherwise look like a harness behaving
differently.

### Three tool classes

| Class             | Example                         | SharedOS authorized? |
| ----------------- | ------------------------------- | -------------------- |
| `managed`         | `files.search`, brokered GitHub | Yes                  |
| `harness_local`   | patch tool, bounded shell       | No                   |
| `external_direct` | independently configured Jira   | No                   |

The original `strict`/`hybrid` declaration permitted local tools under
`strict`. [ADR 0027](0027-tool-policy-classification.md) supersedes that policy:
version 2 uses `broker-only`, `mixed`, and `unknown`, requires evidence for a
complete inventory, and classifies every local tool outside the broker. A
policy is a declaration, never proof of process isolation.

This matters for how a result reads. "The kernel refused every violation" means
one thing when the managed catalogue was the only way to have an effect, and
almost nothing when the harness also had a shell. So the declaration travels
with the result: a column's policy is written to every execution record it
produces, as `SystemIdentity.toolPolicy`, beside the `catalogHash` that says
which managed tools it was given.

## The MCP conformance column

`mcpColumn` runs the installed CLI natively — its own loop, its own MCP client,
and whatever model the host configured it with — against the permission-filtered
catalogue. It is the column the
other two deliberately do not claim:

- A scripted column leaves out the transport.
- A live column leaves out the catalogue.
- This one leaves out neither.

What it gives up is control of the loop. The harness decides how many calls to
make and when to stop, so an attempt it declines to issue leaves no operation in
the record and is graded `not exercised`. That is the honest grading: the row was
not tested. A column that manufactured the call to make the cell green would be
measuring the prompt rather than the kernel.

It is reported separately from the committed manifest, and for the same reason
the live column is: its correlation is weaker (a live harness mints its own call
ids, so attempts are matched on tool and resource), and its result depends on a
model's choices.

## Consequences

- Adding MCP required no kernel change to enforcement and adds **no second
  permission path**. Calls arrive through the bridge and leave through
  `RuntimeHost.invokeTool`, which is the same envelope-and-kernel path every
  other runtime uses.
- `ToolDefinition.name` is narrower than it was. Every tool in the repository
  already satisfied it; a host with a tool name containing a space now fails at
  registration rather than at the first `tools/list`.
- `ToolCall.tool` is deliberately **not** narrowed. A guess at a malformed or
  unpublished name must reach the kernel to be refused and recorded; rejecting it
  at the parse boundary would erase the attempt, and an attempted violation that
  leaves no trace is the one outcome this boundary must not produce.
- A harness process that outlives its turn — they do, on cancellation and on
  timeout — finds a closed bridge and a released port rather than a door onto a
  turn that has ended.
- Pi gets an MCP column, with a caveat carried in its manifest rather than in a
  footnote. It ships no MCP client, so an extension is **required** before it can
  reach one — and _which_ extension is a **host choice**, not a SharedOS
  requirement. `pi-mcp-adapter` is what this repository is exercised against;
  anything with the same job would serve. `mcpSupport: "extension"` and the
  extension name are stamped on every record that column produces, because a
  column whose MCP client is third-party makes a slightly narrower claim than one
  whose harness ships its own.
- Which model a harness runs is **not** SharedOS's to configure. Provider names,
  base URLs, credentials, and per-vendor flags live in a host configuration file
  the operator supplies; `createMcpHarnessRuntime` takes opaque `env` and `args`
  and passes them through. SharedOS records one string per column — the declared
  model — on `SystemIdentity`, and selects nothing. That separation is deliberate:
  a run whose environment points at one model and whose declaration says another
  is a misconfiguration worth being able to see, and a field that both selected
  and reported would make it invisible.

## Rejected alternatives

**Make the harness config the source of truth.** Rejected. `config.toml`,
`.mcp.json`, and `cordis.yml` declare a _connection_ and cannot declare tools: the
catalogue is resolved per turn from an access context, and a file on disk cannot
know who is asking.

**Publish both a canonical id and a portable wire name.** Rejected. Two names for
one tool is a catalogue where discovery and authorization can disagree.
`ToolNameSchema` exists so the canonical name is always carriable as-is;
`portableToolName` remains available for a transport that genuinely cannot carry
a dot, and the server maps it back before the call is issued.

**Treat a SharedOS denial as a JSON-RPC error.** Rejected. See "Refusals are
results".

**Flatten brokered providers into unqualified names.** Rejected: `github.search`
and `notion.search`, never `search` twice. Two providers exposing the same raw
name would collide into one identity that authorization could not separate.

**Reach for more credentials to make live columns pass.** Rejected as the wrong
diagnosis. The live columns were blocked on the catalogue; an API key would have
produced the same 83 refused operations more expensively.
