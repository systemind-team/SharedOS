# Tool catalog

A tool is how a model reaches live state or performs an action. SharedOS ships
two planes of them — `files` and `repo` — two affordances of its own —
`messages.request` and `sharedos.escalate` — and a registry for yours.

## Three gates, all required

```text
usable tool = registered for this context
              AND its namespace is enabled
              AND a capability grant allows the exact resource and action
```

They answer different questions and none substitutes for another.

**Registration** is what exists. `kernel.registerTool` adds a static,
process-wide tool. `kernel.registerToolProvider` adds a `ContextToolProvider`
for per-user or dynamically discovered catalogs — use it for MCP connections so
one user's reload cannot mutate another user's registry.

**Namespace enablement** is the product control plane: should this _family_ of
tools be offered here at all. Namespaces are **off by default**, host-owned, and
never authority. Enabling `calendar` grants nothing in it.

**Capability** is authority: which exact resources and actions this actor may
use. Checked when the catalog is listed, and checked again on every invocation.

The second check is the one that matters. A tool visible in `/v1/tools` is not
permitted; a model that rewrites the `path` in its own arguments does not reach
outside the grant, because the requirement is re-derived from the parsed
arguments immediately before execution.

## The `files` plane

`registerStandardOsTools(kernel, { files })` exposes one `ResourceProvider` as
twelve tools. `files` is the canonical plane for accumulated knowledge — memory,
workspace, identity, history, and curated notes are roots or roles inside one
file tree, not separate permission systems ([ADR 0005](adr/0005-files-resource-plane.md)).

| Tool                     | Action             | Class       | Arguments beyond `path`                                                 |
| ------------------------ | ------------------ | ----------- | ----------------------------------------------------------------------- |
| `files.list`             | `list`             | read        | —                                                                       |
| `files.stat`             | `stat`             | read        | —                                                                       |
| `files.read`             | `read`             | read        | —                                                                       |
| `files.search`           | `search`           | read        | `query`, `limit?`                                                       |
| `files.grep`             | `grep`             | read        | `pattern`, `mode?`, `caseSensitive?`, `contextBefore?`, `contextAfter?` |
| `files.create`           | `create`           | write       | `content`, `metadata?`                                                  |
| `files.replace`          | `replace`          | destructive | `content`, `expectedVersion?`                                           |
| `files.append`           | `append`           | write       | `content`, `expectedVersion?`, `metadata?`                              |
| `files.delete`           | `delete`           | destructive | `expectedVersion?`, `recursive?`                                        |
| `files.snapshot.create`  | `snapshot:create`  | write       | `label?`                                                                |
| `files.snapshot.list`    | `snapshot:list`    | read        | `limit?`                                                                |
| `files.snapshot.restore` | `snapshot:restore` | destructive | `snapshotId`, `expectedVersion?`                                        |

The **action** column is what a grant names. Granting `["search", "read"]`
makes exactly `files.search` and `files.read` visible; the other ten do not
appear in the catalog at all. The literal `"*"` is the one action that covers
every other, so a grant listing it makes all twelve visible — see the
[permission model](security/permission-model.md#capabilities-and-resources).

`path` is an array of segments, at any length. Separators, traversal markers, and control characters are rejected by the
contract, so every host receives the same canonical vocabulary.

Argument schemas are exported if you need to validate ahead of a call:
`FilesSearchArgumentsSchema`, `FilesGrepArgumentsSchema`,
`FilesCreateArgumentsSchema`, and so on.

### Outputs are not yet specified

Every tool's **input** has a schema. Every tool's **output** is a free-form
`JsonValue`, and no `files` tool sets `outputSchema`. Two hosts can therefore
return different shapes from `files.search`, and prompt or client code written
against one is not portable to the other.

If that matters to you, pin the host you integrate with and treat the shape as
that host's contract, not SharedOS's. Constraining these outputs is open work.
The same is true of the `repo` plane below.

## The `repo` plane

`registerStandardOsTools(kernel, { files, repo })` exposes a second
`ResourceProvider` as five Git tools, beside the file tools and sharing no
authority with them ([ADR 0024](adr/0024-git-is-its-own-resource-namespace.md)).

| Tool          | Action   | Class | Arguments beyond `path` |
| ------------- | -------- | ----- | ----------------------- |
| `repo.status` | `status` | read  | —                       |
| `repo.diff`   | `diff`   | read  | `staged?`, `pathspec?`  |
| `repo.log`    | `log`    | read  | `maxCount?`             |
| `repo.stage`  | `stage`  | write | `pathspec`              |
| `repo.commit` | `commit` | write | `message`               |

`path` is the repository. `pathspec` selects paths **inside** it — an array of
segment arrays, in the same canonical vocabulary — and is provider input rather
than a second resource: staging is authorized at the repository, and the
provider confines every entry beneath it.

**A `files` grant over a working tree grants nothing here, and a `repo` grant
grants nothing in `files`.** Capability matching compares the namespace before
it looks at the path or the action, so the two planes may address the same
directory and still share no authority. That is deliberate: `commit` as a write
action under `files` would have made every holder of file-write authority a
committer, without anybody granting it.

`stage` and `commit` are separate actions for the same reason `append` and
`replace` are — "may stage, never commit" is a real arrangement, and one broad
action cannot express it.

Five subcommands is the whole plane. `push`, `reset`, `checkout`, `clean`,
`config`, and `remote` are not tools here and stay behind whatever authorizes an
arbitrary shell command. SharedOS ships the vocabulary and the authorization,
never a Git implementation: the provider is host code, and the hardening it
applies — disabled hooks, no system or global config, no external diff, textconv,
or clean filters, refused symlinks — is a property of that code, not an
authority anyone grants or withholds.

Argument schemas are exported as `RepoDiffArgumentsSchema`,
`RepoStageArgumentsSchema`, `RepoCommitArgumentsSchema`, and so on.

## Kernel-supplied tools

Two tools come from SharedOS itself rather than from a resource provider. Both
pass the same three gates as everything else, and neither is available until a
host opens all three.

### `messages.request`

Send a request to another agent and wait for its durable reply
([ADR 0015](adr/0015-message-purpose-and-recipient-execution.md)).

| Gate         | What satisfies it                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration | The kernel registers it itself, into each context's catalogue, once both `messageTransport` and `messageRequestRouter` are configured                          |
| Namespace    | `messages`                                                                                                                                                     |
| Capability   | `sharedos.messaging` / `[<kind>, <id>]` of the recipient / `send` — resolved per call by `RecipientScopedMessageCapabilityResolver`, owner the context's owner |

The model supplies only `recipient` and a JSON-safe `payload`. Sender, purpose,
trace, timestamp, and message id come from trusted context (`createMessageId`
is the host's), the recipient-scoped send capability is consumed exactly once,
and the reply is validated against the request before its payload is exposed.
A grant for one recipient makes exactly that recipient reachable, and the host
then runs the recipient as its own turn under its own grants — see the
[host integration guide](host-integration.md#3-build-the-kernel-and-register-file-tools).

### `sharedos.escalate`

End the turn by asking a human to decide
([ADR 0017](adr/0017-driver-declared-turn-control.md)).

| Gate         | What satisfies it                                                                       |
| ------------ | --------------------------------------------------------------------------------------- |
| Registration | The host: `kernel.registerTool(createEscalationTool())`, from `@aicoo/sharedos-runtime` |
| Namespace    | `sharedos`                                                                              |
| Capability   | `sharedos` / `["escalation"]` / `request`, owner the context's owner                    |

The tool is catalogued and never executed. A driver whose turn's catalogue
offers it recognises the name (`escalationRequest`) and ends the turn
`escalated` instead of making the call, the kernel records
`escalation.requested`, and nothing is granted while the ask is pending. Without
the grant the name is passed through and refused `tool_unavailable` like any
other unpublished tool, and the envelope refuses an `escalate` outcome from any
runtime plugin on such a turn (ADR 0017, "The catalogue gates the name"). The
registered handler fails with `escalation_not_terminated` if a driver forwards
the call anyway. Over MCP the bridge answers the ask itself and
refuses later calls on that turn with `escalation_pending`
([ADR 0018](adr/0018-escalation-over-mcp.md)). A host that issues no
escalation grant has agents that cannot escalate; that is the intended
arrangement, not a gap.

The resource namespace is `sharedos`, not `sharedos.escalation`, and that is
deliberate. `sharedos.messaging` and `sharedos.execution` are planes with
resources of their own; `sharedos` is the namespace for things about SharedOS
itself. Escalation, at path `["escalation"]`, is the only tool in it; the agent
card `kernel.readAgentCard` serves is authorized in the same namespace, at
`["directory"]` with action `read` ([ADR 0021](adr/0021-agent-card-reach-computed-at-read-time.md)).
The tool namespace, the second gate, is also `sharedos`.

## Registering your own tool

Live systems — calendar, email, GitHub, Notion, an internal API — stay tools
because their state has to be observed, or changed, at execution time. You own
the OAuth, the credentials, the connection, and the implementation.

```ts
import type { ToolHandler } from "@aicoo/sharedos";

const calendarFreeBusy: ToolHandler = {
  definition: {
    name: "calendar.freeBusy", // globally stable
    description: "Read free/busy windows for one calendar.",
    namespace: "calendar", // the availability gate
    source: "native", // "native" | "mcp" | your own label
    readWrite: "read", // "read" only if running it twice changes nothing
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["calendarId", "from", "to"],
      properties: {
        calendarId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
    },
    // The ceiling used for discovery: the broadest thing this tool could
    // ever require. Narrower than this is still checked per call.
    requiredCapability: {
      resource: { namespace: "calendar", path: [] },
      action: "freeBusy",
    },
    annotations: { readOnly: true },
  },

  // Runs before authorization. Throw on anything you would not execute.
  parseArguments: (args) => CalendarFreeBusyArgs.parse(args),

  // The important one. Derive the *exact* resource from validated arguments,
  // immediately before invocation, so argument tampering cannot widen scope.
  resolveRequirement: (context, call) => ({
    resource: {
      namespace: "calendar",
      path: [String(call.arguments.calendarId)],
      owner: context.owner,
    },
    action: "freeBusy",
  }),

  invoke: async (context, call, signal) => {
    const args = CalendarFreeBusyArgs.parse(call.arguments);
    const windows = await calendarApi.freeBusy(args, { signal });
    return {
      callId: call.id,
      tool: call.tool,
      status: "succeeded",
      output: { windows },
      completedAt: new Date().toISOString(),
    };
  },
};

kernel.registerTool(calendarFreeBusy);
```

Omitting `resolveRequirement` means the tool is authorized against its declared
`requiredCapability` only — acceptable for a tool that takes no resource
argument, and a scope hole for anything that does.

A `resolveRequirement` that returns a namespace the declared ceiling does not
cover is rejected as `invalid_tool_requirement`. Declare the ceiling in the same
plane you will resolve into.

`readWrite` and `annotations.idempotent` are more than catalogue labels: they
decide whether a turn that ended early is reported `retryable`. Once a call to a
`write` tool not declared `idempotent` may have taken effect, the turn's ending
says `retryable: false`. Declare `read` only if running the tool twice changes
nothing, and `idempotent` only if the second run is a no-op; when in doubt, leave
it a plain `write`. See
[Before you retry a turn](errors.md#before-you-retry-a-turn).

With that registered, a Notion-style search is usable only when all of these
hold at once:

```text
the host registered this user's handler
AND the `notion` namespace is enabled for this context
AND a `notion` resource/action grant matches
AND the exact page or database the arguments select is still authorized
```

Which means you can grant search on one database without granting page updates,
and expose calendar free/busy while event contents, creation, and deletion stay
separately scoped.

## Per-user catalogs

```ts
import type { ContextToolProvider } from "@aicoo/sharedos";

const mcpTools: ContextToolProvider = {
  id: "user-mcp",
  async listTools(context, signal) {
    const connections = await mcpRegistry.forUser(context.owner, { signal });
    return connections.flatMap(toToolHandlers);
  },
};

const kernel = new SharedOSKernel({ grantSource, toolProviders: [mcpTools] });
```

The provider is called with exactly one trusted context, once per turn, and the
handlers it returns are held for that turn only. Nothing it returns is cached
into a shared registry. A provider that changes what it returns part-way
through a turn does not change what that turn is answered from: the catalogue
resolved for the turn is the one its listing published and the one its calls
are decided against (ADR 0026).

If a provider throws, nothing is answered from a partial list — a truncated
catalog would read as "you have no access to that" and be indistinguishable from
a denial. A call made through `invokeTool` fails with `tool_catalog_unavailable`;
`listTools` rejects, which inside a turn ends it `runtime_failed`. See
[Diagnosing a contained throw](errors.md#diagnosing-a-contained-throw).

## Managing namespaces

```ts
const catalog = await kernel.updateToolNamespaces(
  context,
  { enable: ["files", "calendar"], disable: ["notion"] },
  { signal },
);
```

The same namespace may not appear in both lists. Your
`ToolNamespaceSettingsStore.applyUpdate` must apply the patch atomically
against fresh state, and may narrow the request by organization policy — never
widen it beyond what host policy allows. The returned catalog is what actually
took effect, which may be less than what was requested.

`applyToolNamespaceUpdate(current, update)` implements the standard patch
semantics if you only need persistence around it.

## Related

- [HTTP API reference](http-api.md) — the tool routes on the wire
- [MCP API reference](mcp-api.md) — the same catalog as an MCP server
- [Reason and error codes](errors.md) — what each denial means
- [ADR 0006: Tool namespace control plane](adr/0006-tool-namespace-control-plane.md)
- [Permission model](security/permission-model.md) — the normative invariants
