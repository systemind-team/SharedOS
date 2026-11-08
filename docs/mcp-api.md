# MCP API reference

SharedOS presents its permission-filtered tool catalogue as an MCP server, so a
harness that already speaks MCP — Codex, Claude Code, DeepSeek Harness — runs
natively against it without a shim. Pi ships no MCP client and reaches it through
an MCP extension. This page is the wire reference: transports,
methods, status codes, and headers. Why this boundary exists, what crosses it,
and what is deliberately never published are in
[MCP toolshare](mcp-toolshare.md) and [ADR 0014](adr/0014-mcp-toolshare.md).

This is the second network surface. The first is the
[HTTP API](http-api.md), which serves your own code. They are not alternatives:
the kernel behind them is the same, and a `tools/call` here becomes exactly the
`ToolCall` that `POST /v1/tools/invoke` would have made.

```ts
import { McpToolServer } from "@aicoo/sharedos-mcp";
import { createStreamableHttpMcpServer } from "@aicoo/sharedos-mcp/node";

const bridge = await createStreamableHttpMcpServer({
  server: new McpToolServer({ invoker, serverInfo: { name: "sharedos", version: "1" } }),
  authorize: (token) => verifySessionToken(token),
});
// bridge.url  ->  http://127.0.0.1:53124/mcp
```

## A bridge lives for one turn

The catalogue is resolved once per turn and cannot change underneath a running
harness. Everything else about this surface follows from that:

- `initialize` advertises `tools: { listChanged: false }` — stated, not omitted.
  A client polling for catalogue changes would wait on a notification this
  server will never have cause to send.
- `tools/list` is served whole. There is no pagination, because a harness that
  acted on a prefix would be acting on a partially discovered catalogue —
  exactly the stale-discovery failure `catalogHash` exists to catch.
- There is no server-initiated stream. `GET` is refused rather than left open.
- A session id from an earlier bridge is answered with `404`, not silently
  adopted, so a client re-initializes instead of calling into a turn that ended.

## Transports

| Transport       | Entry point                     | Lifetime                                                          |
| --------------- | ------------------------------- | ----------------------------------------------------------------- |
| stdio           | `serveMcpOverStdio`             | The harness spawns SharedOS; the process ends with the invocation |
| Streamable HTTP | `createStreamableHttpMcpServer` | Loopback listener, closed with the turn                           |

Both entry points are exported from `@aicoo/sharedos-mcp/node`, which keeps
`node:http` out of the package's main entry point. Both carry the same
`McpToolServer`. Choose stdio when SharedOS _is_ the
subprocess — a turn-scoped bridge and a process lifetime that already match need
nothing to keep them in step. Choose HTTP when the harness is sandboxed or
remote and cannot be handed a stream pair at all; it is also the transport every
emitted harness configuration points at.

### stdio

Newline-delimited JSON on a `Readable`/`Writable` pair. Messages are answered in
arrival order — MCP permits interleaving, but a bridge that answered out of order
would let a harness observe two calls resolving against one turn in an order the
audit trail does not show. Resolves when the input ends or the signal aborts.

### Streamable HTTP

One route, on loopback by default.

| Option      | Default     | Meaning                                                              |
| ----------- | ----------- | -------------------------------------------------------------------- |
| `path`      | `/mcp`      | The path every emitted harness configuration expects                 |
| `host`      | `127.0.0.1` | Loopback unless a host deliberately widens it                        |
| `port`      | `0`         | Ask the OS for a free port, which is what a turn-scoped bridge wants |
| `authorize` | absent      | Validates the bearer token on every request                          |

The returned server carries `url`, `port`, `sessionId`, and `close()`.

| Request                                    | Status | Response                                                                     |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------- |
| `POST` with one message or a batch         | `200`  | The JSON-RPC answer, or an array for a batch                                 |
| `POST` whose answers are all notifications | `202`  | Empty. Accepted, with nothing to say back                                    |
| `POST` with `accept: text/event-stream`    | `200`  | The same answers, framed as SSE                                              |
| `DELETE`                                   | `200`  | Empty. The client is done with the session                                   |
| Any other method                           | `405`  | `{"error":"method_not_allowed"}`, with `allow: POST, DELETE`                 |
| Any other path                             | `404`  | Empty                                                                        |
| `authorize` returned false                 | `401`  | `{"error":"unauthorized"}`, with `www-authenticate: Bearer realm="sharedos"` |
| `mcp-session-id` from another bridge       | `404`  | `{"error":"unknown_session"}`                                                |
| Body is not JSON                           | `400`  | JSON-RPC `-32700`                                                            |
| Empty JSON-RPC batch                       | `400`  | JSON-RPC `-32600`                                                            |
| Unhandled failure                          | `500`  | `{"error":"internal_error"}`                                                 |

Every answer to an accepted `POST` carries `mcp-session-id`: the `200`, the
`202`, and the `400` for a body that could not be read as JSON-RPC. The refusals
that come before a message is read (`401`, both `404`s, `405`), the `DELETE`
`200` and the `500` do not.

`authorize` receives the bearer token, or `undefined` when none was sent. Leave
it absent for a loopback bridge whose port is known only to the subprocess it was
opened for. Supply it for a sandboxed or remote harness, where the execution
token identifies the broker session — `mintExecutionToken` and
`verifyExecutionToken` are in the same package. **The token identifies a session
and never carries authority.** Authorization is still the kernel's, per call,
against a grant.

## Methods

| Method                      | Params               | Result                                                           |
| --------------------------- | -------------------- | ---------------------------------------------------------------- |
| `initialize`                | `protocolVersion?`   | `protocolVersion`, `capabilities`, `serverInfo`, `instructions?` |
| `ping`                      | —                    | `{}`                                                             |
| `tools/list`                | —                    | `tools[]`, `_meta`                                               |
| `tools/call`                | `name`, `arguments?` | `content[]`, `structuredContent?`, `isError`                     |
| `notifications/initialized` | —                    | No response                                                      |

Anything else is `-32601`.

### `initialize`

```json
{
  "protocolVersion": "2025-06-18",
  "capabilities": { "tools": { "listChanged": false } },
  "serverInfo": { "name": "sharedos", "version": "1" },
  "instructions": "…"
}
```

Supported protocol versions are `2025-06-18` (latest), `2025-03-26`, and
`2024-11-05`. A version outside that set — including none at all — negotiates to
the latest rather than failing, so an older client is never refused at the door
for a version string.

### `tools/list`

```json
{
  "tools": [
    {
      "name": "files.search",
      "description": "Semantically search files inside an explicitly granted path.",
      "inputSchema": { "type": "object", "required": ["path", "query"], "properties": {} },
      "outputSchema": { "type": "object", "properties": {} },
      "annotations": { "readOnlyHint": true },
      "_meta": { "sharedos/namespace": "files", "sharedos/source": "sharedos" }
    }
  ],
  "_meta": {
    "sharedos/catalogHash": "…",
    "sharedos/executionId": "execution-1"
  }
}
```

This is the same effective catalogue `GET /v1/tools` returns for the same
context: registered **and** namespace enabled **and** allowed by some grant. A
tool the caller may not use does not appear, so a model driven by this list never
learns it exists.

`name` is the canonical SharedOS tool ID, unchanged. A harness may rewrite it for
its own display — Claude Code, Codex, and DeepSeek all use
`mcp__<server>__<tool>` — and that alias is recorded on the bridge for diagnosis,
never on the `ToolCall`, so it cannot reach an authorization decision even by
mistake.

Three fields change name on the way out. SharedOS annotates a tool `readOnly`,
`destructive` and `idempotent`; what is published are MCP's own `readOnlyHint`,
`destructiveHint` and `idempotentHint`. Namespace and source are not MCP fields at all, so they travel
under `_meta` as `sharedos/namespace` and `sharedos/source`. What is never
published — the required capability, the grants behind it, the issuing authority,
namespace settings, credentials, handler references — is listed in
[MCP toolshare](mcp-toolshare.md#what-crosses-the-boundary).

`catalogHash` is 64 hex characters over the tools and nothing else, so two
harnesses handed the same semantic tool set produce the same hash even though
their execution ids, transports, and aliases differ. A catalogue holds any
number of tools.

### `tools/call`

```json
{
  "name": "files.search",
  "arguments": { "path": ["Work", "Projects", "atlas"], "query": "ship date" }
}
```

The exposed name is mapped back to the canonical ID, the call is given a fresh
SharedOS call id, and the invoker hands it to the kernel — where the arguments
are parsed, the exact resource is re-derived from them, and that resource and
action are authorized again. A name that was never published is passed through to
be refused `tool_unavailable` rather than rejected at the bridge, so an
unpublished tool and a misspelled one fail the same way.

```json
{
  "content": [{ "type": "text", "text": "{\"hits\":[…]}" }],
  "structuredContent": { "hits": [] },
  "isError": false
}
```

`structuredContent` is present only when the published tool declares an
`outputSchema` and the output is a JSON object.

**A denied call is a successful JSON-RPC response.** Refusals and failures come
back as a tool result, not a JSON-RPC error:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"status\":\"denied\",\"code\":\"no_matching_grant\",\"message\":\"…\"}"
    }
  ],
  "isError": true,
  "_meta": { "sharedos/status": "denied", "sharedos/code": "no_matching_grant" }
}
```

The text body also carries `retryable` when the result's error states one. Read
`_meta["sharedos/status"]` to separate `denied` from `failed`, and
`sharedos/code` for the [reason code](errors.md). A client that treats every
`isError` alike will report a permission decision as an outage.

### JSON-RPC errors

Reserved for messages that never reached a tool at all.

| Code     | Meaning                                                                         |
| -------- | ------------------------------------------------------------------------------- |
| `-32700` | Body is not JSON, or is JSON with no usable `id` that is not a JSON-RPC message |
| `-32600` | A message with an `id` that is not a JSON-RPC request, or an empty batch        |
| `-32601` | Unknown method                                                                  |
| `-32602` | `tools/call` without a tool name                                                |
| `-32603` | Internal failure                                                                |

## Harness configuration

`@aicoo/sharedos-mcp` emits the connection file each harness expects, so a
bridge URL becomes a working configuration without hand-editing.

| `McpHarnessId` | File               | Function              |
| -------------- | ------------------ | --------------------- |
| `codex`        | `config.toml`      | `codexMcpConfig`      |
| `claude-code`  | `.mcp.json`        | `claudeCodeMcpConfig` |
| `deepseek`     | `cordis.patch.yml` | `deepseekMcpConfig`   |
| `pi`           | `.mcp.json`        | `piMcpConfig`         |

`harnessMcpConfigFile(harness, connection)` returns the filename and contents for
any of them; `claudeAgentSdkMcpOptions` reuses the Claude Code server block for
the Agent SDK; `harnessToolAlias` reproduces the display name a harness will
show. Pi's file is the shape `pi-mcp-adapter` reads, because Pi has no MCP client
of its own; which extension a host installs is the host's choice.

For a connection that carries a token, Codex's table names the variable the
token is read from rather than the token:

```toml
[mcp_servers.sharedos]
url = "http://127.0.0.1:53124/mcp"
required = true
default_tools_approval_mode = "approve"
bearer_token_env_var = "SHAREDOS_MCP_TOKEN"
```

Start Codex with `SHAREDOS_MCP_TOKEN` set to the token; the name is exported
as `SHAREDOS_MCP_TOKEN_VARIABLE`. Codex refuses an inline `bearer_token` from
0.46 ("bearer_token is not supported for streamable_http") and does not start,
and a token named by variable is on no command line and in no file.
`CODEX_MCP_HARNESS` passes the same settings as `-c` overrides and sets the
variable in the CLI's environment.

### Launching the installed CLIs

`createMcpHarnessRuntime` with `CLAUDE_CODE_MCP_HARNESS`, `CODEX_MCP_HARNESS`,
`DEEPSEEK_MCP_HARNESS` or `PI_MCP_HARNESS` writes the file above into a scratch
workspace (Codex takes the same settings as `-c` overrides instead), starts the
CLI there, and reads its stdout for the turn's outcome:

| Harness     | Command line                                                                                       | Prompt                 |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| Claude Code | `claude -p --allowedTools mcp__sharedos --mcp-config <file> --output-format stream-json --verbose` | stdin                  |
| Codex       | `codex exec --json --skip-git-repo-check -c ... -`                                                 | stdin                  |
| DeepSeek    | `dsh --profile headless --patch <file> --json -`                                                   | stdin                  |
| Pi          | `pi --mode rpc --no-session --no-builtin-tools`                                                    | stdin, as an RPC frame |

The prompt always goes on stdin, so its length is not bounded by the 128 KiB
one argument may hold and a prompt that starts with `-` is not read as an
option. A host's `args` are appended after the spec's. Claude's line ends on
`--verbose`, which takes no value, so an appended token is never read as one
more `--allowedTools` entry. dsh's ends on `-`, its task, so whatever a host
appends there is read by the headless app: its own options, such as
`--permission-mode <preset>`, `--approval-policy <policy>` or
`--add-dir <path>`, work, and a launcher flag such as `--patch` or a second
task argument fails the run. Codex applies `-c` overrides placed after its
`-`.

Apart from Pi's `--no-builtin-tools`, none of these restricts the harness's own
tools or the other MCP servers it loads: SharedOS decides the calls that reach
it here, and nothing else. A host that wants a restriction appends it through
`args`. A CLI's version is not checked;
[MCP toolshare](mcp-toolshare.md#versions) records the versions each launch was
found to need.

## Escalation over MCP

A turn driven over MCP can end by asking a human to decide, the same as one
driven in-process. The affordance is published as an ordinary tool,
`sharedos.escalate`, and is permission-filtered like any other — an agent with no
grant over it does not see it in the catalogue at all.

The harness calls it like any other tool, and the call never reaches the kernel.
`createMcpHarnessRuntime` answers it `succeeded` with
`{ escalated: true, reason, note }` and ends the turn with an escalate outcome.
Every later call on that turn is answered `denied` with `escalation_pending`,
`retryable: false`: the turn has ended by asking, so nothing further runs on it.
See [ADR 0018](adr/0018-escalation-over-mcp.md) and
[ADR 0011](adr/0011-escalation-terminal-outcome.md).

## Calling it with curl

```bash
BRIDGE=http://127.0.0.1:53124/mcp
AUTH="authorization: Bearer $EXECUTION_TOKEN"
JSON='content-type: application/json'

curl -s "$BRIDGE" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

curl -s "$BRIDGE" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -s "$BRIDGE" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s "$BRIDGE" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"files.search","arguments":{"path":["Work"],"query":"ship date"}}}'
```

## Related

- [MCP toolshare](mcp-toolshare.md): what crosses the boundary, and what never does.
- [HTTP API reference](http-api.md): the same kernel for your own code.
- [Tool catalog](tools.md): the three availability gates behind every list.
- [Reason and error codes](errors.md): what a `denied` status means.
