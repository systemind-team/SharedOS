# Every endpoint

One page that names every way into SharedOS, and every way out of it. Each entry
links to the reference that specifies it; this page exists so that "all the
endpoints" has one answer rather than four.

"Endpoint" is used here in the broadest useful sense: anything a caller, a model,
or a harness can invoke to make something happen. That is deliberately wider than
"HTTP route", because three of the five surfaces below are not HTTP, and a map
that showed only the routes would miss most of the system.

## The surfaces

| Surface                             | Kind         | Count                   | Reference                      |
| ----------------------------------- | ------------ | ----------------------- | ------------------------------ |
| [Kernel HTTP API](#kernel-http-api) | Network      | 10 routes               | [http-api.md](http-api.md)     |
| [MCP toolshare](#mcp-toolshare)     | Network      | 2 transports, 5 methods | [mcp-api.md](mcp-api.md)       |
| [Tool catalog](#tool-catalog)       | Model-facing | 19 standard tools       | [tools.md](tools.md)           |
| [Embedded API](#embedded-api)       | In-process   | 9 + 18 + 10 methods     | [api/README.md](api/README.md) |
| [Outbound calls](#outbound-calls)   | Egress       | 1                       | —                              |

The kernel behind all of them is one kernel, and the authorization decision is
one decision. A `tools/call` over MCP, a `POST /v1/tools/invoke`, and an embedded
`kernel.invokeTool` converge on the same check against the same grant.

## Kernel HTTP API

`createSharedOSHandler` mounts as a `(Request) => Promise<Response>` in any
runtime that speaks Fetch.

| Method | Path                   | Purpose                                            |
| ------ | ---------------------- | -------------------------------------------------- |
| GET    | `/health`              | Liveness and protocol version                      |
| POST   | `/v1/authorize`        | Would this be allowed? Performs nothing            |
| GET    | `/v1/tools`            | The effective catalog for this context             |
| GET    | `/v1/reach`            | Where this context may operate, authority left out |
| GET    | `/v1/tools/namespaces` | Namespace descriptors and summary                  |
| PUT    | `/v1/tools/namespaces` | Idempotent enable/disable patch                    |
| POST   | `/v1/tools/invoke`     | Run one tool, re-authorized from its arguments     |
| POST   | `/v1/resources/invoke` | Reach a resource plane directly                    |
| POST   | `/v1/messages`         | Deliver one message envelope                       |
| POST   | `/v1/turns`            | Run one bounded agent turn                         |

`/health` is the only route that resolves no context. Unknown paths are `404`; a
known path with the wrong verb is `405`. There is no streaming route, no
`OPTIONS`, and no CORS, rate limiting, or payload cap — those belong to your
deployment edge.

**A denied operation is a successful HTTP request.** `403` means the request never
reached the kernel's decision; `200` with `"status": "denied"` means the kernel
decided. Request bodies, response bodies, status codes, and headers are in the
[HTTP API reference](http-api.md).

`SharedOSClient` has exactly one method per route and validates every response
against the schema the server used.

## MCP toolshare

The same permission-filtered catalog, served to an external harness. Two
transports carry one server.

| Transport       | Entry point                     | Surface                                            |
| --------------- | ------------------------------- | -------------------------------------------------- |
| stdio           | `serveMcpOverStdio`             | Newline-delimited JSON on a stream pair            |
| Streamable HTTP | `createStreamableHttpMcpServer` | `POST` and `DELETE` on `/mcp`, loopback by default |

| Method                      | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `initialize`                | Negotiate version, advertise capabilities       |
| `ping`                      | Liveness                                        |
| `tools/list`                | The whole catalog, never paginated              |
| `tools/call`                | One invocation, mapped back to a canonical name |
| `notifications/initialized` | Client handshake completion                     |

A bridge is scoped to one turn and closes with it. **A denied call is a
successful JSON-RPC response** carrying `isError: true` and
`_meta["sharedos/status"]` — the MCP analogue of the `200`-with-`denied` rule
above. Status codes, headers, session semantics, protocol versions, and the
harness configuration each CLI expects are in the
[MCP API reference](mcp-api.md); what crosses the boundary and what never does is
in [MCP toolshare](mcp-toolshare.md).

## Tool catalog

What a model can actually reach in a turn. Nineteen tools ship with SharedOS;
everything else in a catalog was registered by a host.

| Tools                         | Namespace  | Registered by                                 |
| ----------------------------- | ---------- | --------------------------------------------- |
| `files.*` — twelve operations | `files`    | `registerStandardOsTools(kernel, { files })`  |
| `repo.*` — five operations    | `repo`     | `registerStandardOsTools(kernel, { repo })`   |
| `messages.request`            | `messages` | `createMessageRequestTool`                    |
| `sharedos.escalate`           | `sharedos` | `kernel.registerTool(createEscalationTool())` |

None of the nineteen is registered automatically. Appearing in a catalog is not
permission to invoke: the requirement is re-derived from the parsed arguments and
authorized again immediately before execution. Per-tool actions, argument
schemas, and the three availability gates are in the
[tool catalog](tools.md).

**Nineteen is the floor, not the ceiling.** This is the only closed list on this
page. SharedOS ships a registry, not a tool set: calendar, email, GitHub, an
internal API, and a user's connected MCP servers all enter the same catalog —
statically through `registerTool`, or per context through a
`ContextToolProvider`, which is what keeps one user's reload out of another
user's registry. They are then subject to the identical three gates, because a
tool is not trusted merely because it was registered. A published catalog holds
any number of tools.

`@aicoo/sharedos-conformance` also defines tools — a sealed one, an escaping one,
a mismatched one, a brokered `notion.search`. Those are adversarial fixtures for
the conformance matrix, not part of any shipped catalog.

## Capability space

Every call above resolves to one row here. This is the coordinate system the
authorization decision actually works in — a namespace, a path, and an action.

| Namespace            | Path                     | Actions                                                                                                                                   | Reached by                                    |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `files`              | File path, ≤ 64 segments | `list`, `stat`, `read`, `search`, `grep`, `create`, `replace`, `append`, `delete`, `snapshot:create`, `snapshot:list`, `snapshot:restore` | `files.*` tools, `/v1/resources/invoke`       |
| `sharedos.messaging` | Recipient address        | `send`                                                                                                                                    | `/v1/messages`, `messages.request`            |
| `sharedos.execution` | Target agent address     | `invoke`                                                                                                                                  | `/v1/turns` admission                         |
| `repo`               | Repository path          | `status`, `diff`, `log`, `stage`, `commit`                                                                                                | `repo.*` tools                                |
| `sharedos`           | `["escalation"]`         | `request`                                                                                                                                 | whether `sharedos.escalate` is offered at all |
| `sharedos`           | `["directory", …]`       | `read`                                                                                                                                    | `kernel.readAgentCard`                        |

Host-registered namespaces — `calendar`, `github`, a user's `notion` MCP server —
join this table on the same terms. Note that tool names use dots and actions use
colons: `files.snapshot.create` needs `snapshot:create`.

Grant evaluation, scope, expiry, and delegation are specified in the
[permission model](security/permission-model.md); refusal codes are in
[errors](errors.md).

## Embedded API

Running in-process is the recommended shape for a product host, so these method
surfaces are endpoints in every sense except the network one.

**`SharedOSApi`** — what the HTTP handler is built on, and what a deployment
routing to another process would implement. Nine methods: `authorize`,
`listTools`, `reach`, `listToolNamespaces`, `updateToolNamespaces`, `invokeTool`,
`invokeResource`, `sendMessage`, `executeTurn`. It has no `health`; liveness
belongs to the handler, not the application surface.

**`SharedOSKernel`** — eighteen public methods in five groups:

| Group    | Methods                                                                         |
| -------- | ------------------------------------------------------------------------------- |
| Register | `registerResourceProvider`, `registerTool`, `registerToolProvider`              |
| Decide   | `authorize`, `admitTurn`, `openTurnAuthority`, `reach`, `readAgentCard`         |
| Catalog  | `listTools`, `listPublishedTools`, `listToolNamespaces`, `updateToolNamespaces` |
| Execute  | `invokeTool`, `invokeResource`, `sendMessage`                                   |
| Record   | `recordEscalation`, `recordTurnEnd`, `recordRefusedCall`                        |

The execution envelope needs eight of them, the `TurnKernel` type:
`openTurnAuthority`, `admitTurn`, `reach`, `listTools`, `invokeTool`,
`recordEscalation`, `recordTurnEnd` and `recordRefusedCall`. A kernel passed to
`SharedOSExecutor` must have all eight.

**`SharedOSClient`** — ten methods, one per HTTP route.

Full signatures are in the [generated API reference](api/README.md).

## Outbound calls

SharedOS initiates exactly one kind of network request of its own.

| Direction | Endpoint                     | Made by                                        |
| --------- | ---------------------------- | ---------------------------------------------- |
| POST      | `{baseUrl}/chat/completions` | the model client in `@aicoo/sharedos-adapters` |

The base URL, model, and provider label are all supplied by the caller; no host
is hard-coded. Everything else that leaves the process — a file store, a
database, a third-party API — leaves through a provider the host implemented, on
the host's own egress path.

## What is not an endpoint

The map is only useful if its edges are clear.

**Host ports are inbound obligations, not endpoints.** `SharedOSKernel` calls
them; nobody calls them through SharedOS. `GrantSource` is required — a kernel
with no authoritative grant source can only fail closed. The rest are optional:
`authorizer`, `policySource`, `resources`, `tools`, `toolProviders`,
`toolNamespaceSettings`, `messageTransport`, `messageRequestRouter`,
`messageCapabilityResolver`, `createMessageId`, `audit`, `createAuditId`,
`onAuditError`, `auditWriteTimeoutMs`, `onProviderError`, `spans`.

**Events are outputs, not entry points.** Nine execution event types are returned
with an `ExecutionResult`. There are eleven audit event types: the kernel writes
ten to your `AuditSink`, and `escalation.auto_decided` is built by
`@aicoo/sharedos-precedent` for the host's control plane to write. Both lists are
in [errors](errors.md#execution-events).

**The testkit and the conformance harness are not a runtime surface.** They exist
to exercise the ones above.

## Keeping this map honest

Every count on this page is derivable from source, and that is the point — a map
maintained by hand drifts. If you are checking it after a change:

| Claim                     | Where it is true or false                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The ten HTTP routes       | `SHAREDOS_ROUTES` in `packages/contracts/src/http.ts`                                                                             |
| The MCP transports        | `packages/mcp/src/node.ts`                                                                                                        |
| The MCP methods           | the method switch in `packages/mcp/src/server.ts`                                                                                 |
| The standard tools        | `packages/os/src/index.ts`, `packages/core/src/message-tool.ts`, `packages/runtime/src/escalation.ts`                             |
| The capability namespaces | the namespace constants in `packages/core` and `packages/os`                                                                      |
| The audit event types     | `AuditEventTypeSchema` in `packages/contracts/src/audit.ts`                                                                       |
| The execution event types | the `emit` calls in `packages/runtime/src/executor.ts` — the contract's `type` is an open string, so the schema will not tell you |
