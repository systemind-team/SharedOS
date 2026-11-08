# HTTP API reference

`createSharedOSHandler` returns a plain `(Request) => Promise<Response>` over
the Fetch API, so it mounts in Node, Bun, Deno, Next.js, Hono, or any runtime
that speaks `Request`/`Response`. It exposes the same kernel that embedded
consumers call in-process, over the same contracts.

```ts
import { createKernelSharedOSApi, createSharedOSHandler } from "@aicoo/sharedos";

const handler = createSharedOSHandler({
  api: createKernelSharedOSApi({ kernel, turns }),
  resolveContext: async (request) => /* trusted server-side state */,
  onError: (error, request, requestId) => logger.error({ error, requestId }),
});
```

`api` is an interface, not a class. `createKernelSharedOSApi` is the standard
implementation over `SharedOSKernel`; a deployment that routes to another
process can implement `SharedOSApi` directly.

## Authentication is yours; authorization is not

There is exactly one place identity enters:

```ts
resolveContext(request: Request): Promise<AccessContext>
```

Everything about who is calling comes from there — your session cookie, your
bearer token, your mTLS peer, your service mesh identity. SharedOS does not
define a login, a token format, or a header name.

Three properties hold as a result, and they are the reason this boundary is
safe to expose:

1. **No request body carries authority.** The wire schemas for the two
   context-bearing endpoints (`RemoteResourceOperation`, `RemoteExecutionRequest`)
   are the embedded shapes with `context` — and for turns, `tools` — _removed_.
   A caller cannot describe its own grants, and cannot widen its own catalog.
   Neither can `resolveContext`: an `AccessContext` has no `grants` field at
   all, and the kernel loads authority itself, through its `GrantSource`.
2. **The context you return is re-validated.** It is parsed against
   `AccessContextSchema` before anything runs. A host bug that produces a
   malformed context is a `500 invalid_access_context`, not a bypass.
3. **Transport authentication is not permission.** Passing `resolveContext` gets
   you a principal. Every operation still needs a matching capability grant.

`/health` is the only route that never calls `resolveContext`.

## Routes

| Method | Path                   | Request body              | 2xx response            |
| ------ | ---------------------- | ------------------------- | ----------------------- |
| GET    | `/health`              | —                         | `SharedOSHealth`        |
| POST   | `/v1/authorize`        | `CapabilityRequirement`   | `AuthorizationDecision` |
| GET    | `/v1/tools`            | —                         | `ToolDefinition[]`      |
| GET    | `/v1/reach`            | —                         | `ReachResult`           |
| GET    | `/v1/tools/namespaces` | —                         | `ToolNamespaceCatalog`  |
| PUT    | `/v1/tools/namespaces` | `ToolNamespaceUpdate`     | `ToolNamespaceCatalog`  |
| POST   | `/v1/tools/invoke`     | `ToolCall`                | `ToolResult`            |
| POST   | `/v1/resources/invoke` | `RemoteResourceOperation` | `ResourceResult`        |
| POST   | `/v1/messages`         | `MessageEnvelope`         | `MessageDeliveryResult` |
| POST   | `/v1/turns`            | `RemoteExecutionRequest`  | `ExecutionResult`       |

Unknown paths are `404`. A known path with the wrong verb is `405`.

### What has no route, on purpose

No route issues a grant, answers an escalation, or reads audit. SharedOS issues
no grant anywhere: a turn that needs more ends `escalated` and carries the
request, the kernel records the ask, and deciding it and writing the grant to
the store your `GrantSource` reads is host control-plane work
([ADR 0011](adr/0011-escalation-terminal-outcome.md)). The
next turn loads what you wrote. A route that did it from here would be a second
way for authority to enter, reachable by whatever can reach this surface. Audit
is the same division: the kernel writes to your `AuditSink`, and you read your
own store.

### `GET /health`

Liveness and protocol version. Requires no authentication and resolves no
context, so it is safe as a load-balancer probe.

```json
{ "status": "ok", "protocolVersion": "1" }
```

### `POST /v1/authorize`

Ask whether an action would be allowed, without performing it. Discovery-style
checks like this never consume a bounded (`maxUses`) grant.

```json
{
  "resource": { "namespace": "files", "path": ["Work", "Projects", "atlas"] },
  "action": "search"
}
```

```json
{ "allowed": true, "reasonCode": "allowed", "matchedGrantId": "grant-1" }
```

A refusal is still `200` — the decision is the payload, not the status. See
[reason codes](errors.md#authorization-reason-codes).

### `GET /v1/tools`

The effective catalog for the resolved context: registered **and** namespace
enabled **and** allowed by some grant. A tool the caller may not use does not
appear, so a model driven by this list never learns it exists.

```json
[
  {
    "name": "files.search",
    "description": "Search inside a granted file path.",
    "namespace": "files",
    "source": "sharedos",
    "readWrite": "read",
    "inputSchema": { "type": "object", "required": ["path", "query"], "properties": {} },
    "requiredCapability": { "resource": { "namespace": "files", "path": [] }, "action": "search" },
    "annotations": { "readOnly": true }
  }
]
```

`inputSchema` is JSON Schema and can be handed to a model as a tool definition
unchanged. The rest of the entry is the management projection: this route
returns full `ToolDefinition`s, and `requiredCapability` is the discovery
ceiling, not what any call will be authorized against, so it is not something
a model should be told. A client that drives a model from this route projects
with `publishToolCatalog` first — `name`, `description`, `inputSchema`,
`outputSchema`, annotations, and `metadata.namespace` / `metadata.source` —
which is the same `PublishedToolDefinition` the MCP boundary serves and what
`StandardTurnDriver` sends to a provider. See
[what crosses the boundary](mcp-toolshare.md#what-crosses-the-boundary).

### `GET /v1/reach`

Where the resolved context may operate, with the authority stripped out: the
namespace, path, actions and scope of every place some grant would authorize
something right now, and nothing about which grant, who issued it, when it
expires or how many uses remain. A caller driving its own loop over this API
has no turn to be told this in, so this is how it learns where to look instead
of guessing paths and collecting denials.

```json
{
  "status": "computed",
  "reach": [
    {
      "namespace": "files",
      "path": ["Work", "atlas"],
      "actions": ["read", "search"],
      "scope": "descendants"
    }
  ]
}
```

Descriptive, never permissive: every call is still authorized on its own, so an
entry here is not a permission. It is grant reach for the whole context — the
host ceiling is not consulted, and it is not narrowed to the tool catalogue,
because [`/v1/resources/invoke`](#post-v1resourcesinvoke) is not gated by tool
namespaces. A client driving a model from `/v1/tools` keeps the entries whose
namespace one of those tools operates on (`requiredCapability.resource.namespace`),
which is what the execution envelope does for a turn.

A reach that cannot be established is an answer, not an error:

```json
{ "status": "unavailable", "reasonCode": "usage_store_unavailable" }
```

`reasonCode` is `authority_unavailable` or `usage_store_unavailable`, the same
codes a decision fails closed with. Nothing is narrowed silently: a bounded
grant whose budget cannot be read withholds the whole answer rather than
quietly omitting the grant, because a reach missing a live grant looks exactly
like one that is true. A spent budget simply does not appear. Nothing is
consumed by asking. See ADR 0021.

### `GET /v1/tools/namespaces` · `PUT /v1/tools/namespaces`

Namespaces are the product control plane: whether a _family_ of tools should be
offered in this context at all. They are off by default and are not authority —
enabling `calendar` does not grant anything in it.

`GET` returns descriptors plus a summary:

```json
{
  "namespaces": [
    { "namespace": "files", "sources": ["sharedos"], "toolCount": 12, "enabled": true },
    { "namespace": "notion", "sources": ["mcp"], "toolCount": 4, "enabled": false }
  ],
  "summary": { "total": 2, "enabled": 1, "disabled": 1 }
}
```

`PUT` applies an idempotent patch and returns the authoritative result:

```json
{ "enable": ["files", "calendar"], "disable": ["notion"] }
```

The same namespace may not appear in both lists. The host store applies the
patch atomically against fresh state and may narrow it by organization policy —
never widen it. The response is what actually took effect, which may be less
than what was asked for.

### `POST /v1/tools/invoke`

```json
{
  "id": "call-1",
  "tool": "files.search",
  "arguments": { "path": ["Work", "Projects", "atlas"], "query": "ship date" },
  "traceId": "trace-1",
  "requestedAt": "2026-08-24T09:00:00.000Z"
}
```

Four things happen in order: the arguments are parsed against the tool's schema,
the exact resource is re-derived **from the parsed arguments**, that exact
resource and action are authorized again, and only then does the handler run.
Appearing in `/v1/tools` is not permission to invoke; changing the path in
`arguments` cannot reach outside the grant.

```json
{
  "callId": "call-1",
  "tool": "files.search",
  "status": "succeeded",
  "output": { "hits": [{ "text": "Atlas ships 2026-09-30." }] },
  "completedAt": "2026-08-24T09:00:00.100Z"
}
```

`status` is `succeeded`, `denied`, or `failed`; the latter two carry
`error: { code, message, retryable?, details? }` instead of `output`.

### `POST /v1/resources/invoke`

Direct access to a resource plane, bypassing the tool layer. Use it for host
code paths that are not model-driven — your own UI, a migration, a cron job.

```json
{
  "operationId": "op-1",
  "resource": { "namespace": "files", "path": ["Work", "Projects", "atlas", "status.md"] },
  "action": "read"
}
```

The `context` field of `ResourceOperation` is **not** accepted on the wire; the
server attaches the one it resolved. Returns a `ResourceResult` with the same
three statuses.

### `POST /v1/messages`

Messages coordinate work. They never carry authority — sending one to an agent
does not permit that agent to do anything, and does not permit you to run it.

```json
{
  "version": "1",
  "id": "message-1",
  "sender": { "kind": "agent", "agentId": "bob-assistant" },
  "receiver": { "kind": "agent", "agentId": "alice-assistant" },
  "purpose": "atlas-status",
  "payload": { "text": "When does Atlas ship?" },
  "traceId": "trace-1",
  "createdAt": "2026-08-24T09:00:00.000Z"
}
```

Authorized against the _recipient_: namespace `sharedos.messaging`, action
`send`, path scoped to the receiver's address. Delivery status is `accepted`
(**HTTP 202**), `delivered`, `denied`, or `failed` (all **HTTP 200**).

### `POST /v1/turns`

One bounded agent turn. The server lists the visible tools itself, which is why
`tools` is absent from the wire schema.

```json
{
  "version": "1",
  "executionId": "execution-1",
  "agent": { "kind": "agent", "agentId": "alice-assistant" },
  "message": { "...": "MessageEnvelope" },
  "state": { "optional": "resumption state you keep" },
  "options": { "maxSteps": 8, "maxToolCalls": 8, "timeoutMs": 30000 }
}
```

Running someone's agent requires a recipient-scoped execution grant —
namespace `sharedos.execution`, action `invoke`. Without it the turn is denied
at admission and nothing runs.

```json
{
  "version": "1",
  "executionId": "execution-1",
  "traceId": "trace-1",
  "status": "succeeded",
  "output": { "answer": "2026-09-30." },
  "events": [
    { "type": "turn.started", "sequence": 0, "...": "" },
    { "type": "tool.requested", "sequence": 1, "...": "" },
    { "type": "tool.completed", "sequence": 2, "...": "" },
    { "type": "turn.completed", "sequence": 3, "...": "" }
  ],
  "startedAt": "2026-08-24T09:00:00.000Z",
  "completedAt": "2026-08-24T09:00:02.400Z"
}
```

`status` is `succeeded`, `denied`, `failed`, `cancelled`, or `escalated` — the
last carries an `escalation` and no `error`. `events` is
append-only and ordered by `sequence`; the nine types are listed in
[events](errors.md#execution-events). `options` sets the turn's limits and
each is unset unless the host sets it; an unset limit is no limit. A value that
is not a positive integer is a `400 invalid_request`, as in the embedded schema;
SharedOS sets no ceiling on the values themselves.

There is no streaming endpoint. A turn is one request/response, and the event
list is returned with the result.

## Status codes

| Status | `error.code`             | Cause                                                             |
| ------ | ------------------------ | ----------------------------------------------------------------- |
| 200    | —                        | Success. **Includes authorization denials** — read `status`       |
| 202    | —                        | `/v1/messages` when delivery status is `accepted`                 |
| 400    | `invalid_json`           | Body is not JSON                                                  |
| 400    | `invalid_request`        | Body does not match the v1 contract                               |
| 403    | `permission_denied`      | An error carrying that code reached the handler                   |
| 404    | `not_found`              | Unknown path                                                      |
| 405    | `method_not_allowed`     | Wrong verb for a known path                                       |
| 500    | `invalid_access_context` | `resolveContext` returned something the schema rejects            |
| 500    | `internal_error`         | Anything else. Details never leak into the response               |
| yours  | yours                    | `resolveContext` threw `SharedOSHttpError(status, code, message)` |

Authentication is `resolveContext`'s job, and that last row is how it answers. Throw
`new SharedOSHttpError(401, "unauthenticated", "…")` and the handler responds with
that status and code; throw a plain `Error` and the caller gets a `500`.

The important row is the first one. **A denied operation is a successful HTTP
request.** `403` means the request never reached the kernel's decision; `200`
with `"status": "denied"` means the kernel decided, and the reason code tells
you why. Clients that treat non-2xx as the only failure mode will read denials
as successes.

Error bodies are always:

```json
{ "error": { "code": "invalid_request", "message": "…", "requestId": "…" } }
```

## Headers

| Header          | Direction | Behaviour                                      |
| --------------- | --------- | ---------------------------------------------- |
| `x-request-id`  | both      | Echoed if supplied, generated otherwise        |
| `cache-control` | response  | Always `no-store`                              |
| `content-type`  | request   | Body is read as JSON on every `POST` and `PUT` |

Request cancellation propagates: `request.signal` is passed through to the
kernel and on to your providers, so an abandoned HTTP request aborts the work.
A provider must honour that signal _before_ committing a side effect.

There is no CORS handling, no rate limiting, no payload size cap, and no `OPTIONS`
route. Those belong to your deployment edge — see
[release readiness](release-readiness.md).

## Calling it with curl

```bash
BASE=https://sharedos.internal.example
AUTH="authorization: Bearer $TOKEN"

curl -s "$BASE/health"

curl -s "$BASE/v1/tools" -H "$AUTH"

curl -s "$BASE/v1/authorize" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"resource":{"namespace":"files","path":["Work","Projects","atlas"]},"action":"search"}'

curl -s "$BASE/v1/tools/invoke" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"id":"call-1","tool":"files.search","traceId":"trace-1","requestedAt":"2026-08-24T09:00:00.000Z","arguments":{"path":["Work","Projects","atlas"],"query":"ship date"}}'
```

## Or use the typed client

`SharedOSClient` has one method per route and validates every response against
the same schema the server used, so a version-skewed server surfaces as a client
error rather than a malformed object.

```ts
import { SharedOSClient } from "@aicoo/sharedos";

const sharedos = new SharedOSClient({
  baseUrl: "https://sharedos.internal.example",
  headers: async () => ({ authorization: `Bearer ${await mintToken()}` }),
});
```

| Client method                  | Route                       |
| ------------------------------ | --------------------------- |
| `health()`                     | `GET /health`               |
| `authorize(requirement)`       | `POST /v1/authorize`        |
| `listTools()`                  | `GET /v1/tools`             |
| `reach()`                      | `GET /v1/reach`             |
| `listToolNamespaces()`         | `GET /v1/tools/namespaces`  |
| `updateToolNamespaces(update)` | `PUT /v1/tools/namespaces`  |
| `invokeTool(call)`             | `POST /v1/tools/invoke`     |
| `invokeResource(operation)`    | `POST /v1/resources/invoke` |
| `sendMessage(envelope)`        | `POST /v1/messages`         |
| `executeTurn(request)`         | `POST /v1/turns`            |

Options are `{ baseUrl, token?, fetch?, headers? }`. `token` is a value or an
async function and is sent as `authorization: Bearer <token>`, set after
`headers`, so it wins if both name the header; `headers` is a value or an async
function for anything else. Each call also takes `{ signal?, headers?, purpose? }`:
`purpose` is sent as `x-sharedos-purpose`, a hint the server's `resolveContext`
may read into the trusted context — as the quickstart's does — and never
authority in itself. Failures throw `SharedOSClientError` with `status`,
`code`, and `requestId`. `code` is the handler's, or one of two the client raises
itself: `invalid_response` for an answer that is not JSON or fails the route's
schema, and `request_failed` for a non-2xx answer with no error body.

## Choosing this boundary

Embedding the kernel in the host process is the recommended shape for products:
no extra hop, and providers talk to your services directly. Reach for HTTP when
process or language isolation matters more than the extra boundary — a Python
harness, an untrusted runtime that must stay out of your process, or a shared
kernel serving several deployments.

Whichever you choose, the authorization decision is the same one, and the
context is always host-derived.

These routes are for code you control. An external coding-agent CLI is served by
the other network surface — the same catalogue and the same kernel, presented as
an MCP server, with its own transports and methods in the
[MCP API reference](mcp-api.md).
