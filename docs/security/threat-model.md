# Threat model

## Scope

This threat model covers SharedOS contracts, permission evaluation, one-turn
execution, resource and tool provider boundaries, messaging, and the HTTP
adapter. It also states requirements that a host must satisfy for the SharedOS
guarantees to hold.

It should be reviewed whenever a new resource namespace, external connector,
delegation mechanism, authentication scheme, or scheduler integration is added.

## Security goals

SharedOS aims to ensure that:

- an actor can perform only operations covered by active trusted grants and the
  host policy ceiling;
- agent messages and model output cannot create authority;
- one tenant or experiment world cannot observe or modify another;
- expiry and bounded-use constraints are enforced at point of use, and a
  revocation is decided when a turn's authority is resolved and observed by the
  next turn (ADR 0016);
- built-in, external, and MCP tools share the same permission gate;
- decisions and side effects have reconstructable provenance;
- protocol failures fail closed without masquerading as successful output.

## Trust boundaries

### Trusted computing base

- SharedOS contract validation, core authorization, and the fixed runtime
  security envelope.
- The host component that establishes authenticated identity.
- Host grant, usage, resource, tool, and audit providers, to the extent required
  by their contracts.
- In-process runtime plugins, because they share the host process's ambient
  filesystem, network, environment, and module privileges.
- Deployment configuration and secrets management.

Provider implementations are security-sensitive. SharedOS cannot prevent a
malicious or buggy host provider from returning another tenant's data after
receiving a correctly scoped request.

### Untrusted or partially trusted inputs

- Message payloads, purpose claims, and provenance metadata.
- Model and agent output, including proposed tool calls.
- Files, notes, documents, web pages, and tool results that may contain prompt
  injection.
- HTTP bodies, headers, IDs, and timestamps from callers.
- External services, MCP servers, connector metadata, and their responses.
- Capability requests before trusted issuance.

Authenticated callers remain untrusted for authorization.

## Assets

- User and agent identities.
- Capability grants and revocation state.
- Private files, mounted memory views, messages, and embeddings.
- OAuth tokens, API keys, MCP credentials, and model-provider secrets.
- Tool side effects such as email, calendar, repository, and financial actions.
- Audit history, provenance, experiment integrity, and availability budgets.

## Threats and required controls

| Threat                   | Example                                                           | Required controls                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-issued authority    | A message includes a fabricated grant                             | Keep grants outside envelopes; load from trusted storage or verify them                                                                                     |
| Confused deputy          | Agent asks a more privileged agent to read a private file         | Authorize the effective actor, owner, purpose, and resource at every operation                                                                              |
| Permission cross-product | Read scope from one grant combines with write action from another | Match a complete capability and constraints; never flatten grant dimensions                                                                                 |
| Prompt injection         | A note instructs the model to exfiltrate secrets                  | Treat content as data; expose only authorized tools; re-authorize every call                                                                                |
| Tool substitution        | Model names a shadow tool with weaker permissions                 | Resolve definitions from a trusted registry and reject duplicate/ambiguous names                                                                            |
| Namespace bypass         | Caller invokes a guessed tool from a disabled family              | Filter discovery and recheck namespace enablement at invocation                                                                                             |
| Cross-user MCP mutation  | One user's reload replaces another user's dynamic tools           | Resolve dynamic catalogs per trusted context; avoid shared mutable registration                                                                             |
| Discovery leakage        | Tool list reveals a private connector or account                  | Permission-filter definitions and metadata before returning the catalog                                                                                     |
| Tenant/world escape      | Crafted path reaches another run or user                          | Bind namespace/world and owner in every provider call; use segment-safe paths                                                                               |
| Replay                   | Captured request repeats a destructive call                       | Host-owned durable deduplication and freshness checks; SharedOS ships no replay port                                                                        |
| Revocation race          | Grant is revoked while a turn is running                          | Decided at admission and observed by the next turn (ADR 0010/0016); bound turn length, or issue short-lived grants, whose expiry is refused inside the turn |
| Bounded-use race         | Two workers consume the last use                                  | Durable atomic compare-and-set; deny when the usage store is unavailable                                                                                    |
| SSRF / connector escape  | MCP tool fetches metadata endpoints                               | Destination allowlists, DNS/IP validation, redirects policy, egress controls                                                                                |
| Secret disclosure        | Provider output or logs contain OAuth tokens                      | Never place secrets in contracts, model context, errors, or audit payloads                                                                                  |
| Resource exhaustion      | Large schema, loop, payload, or tool call consumes resources      | Host-set step, tool-call and time limits, rate limits, cancellation                                                                                         |
| Audit tampering          | Operator removes denied calls                                     | Append-only/tamper-evident host storage, sequence checks, restricted access                                                                                 |
| Evaluation leakage       | An evaluation runtime sees hidden gold labels                     | Separate execution and evaluation channels; fresh world per run                                                                                             |
| Runtime escape           | A third-party harness bypasses the broker or keeps calling later  | Give plugins only the scoped broker; close it after the turn; isolate untrusted code                                                                        |

## Detailed attack surfaces

### Transport and identity

The HTTP adapter must authenticate callers before accepting an actor identity.
It must not trust `sender`, `actor`, `authority`, tenant, or owner fields merely
because they are schema-valid. The adapter binds or verifies those values
against the authenticated principal and host policy.

Bearer tokens require TLS and must not appear in query parameters or logs.
Authentication, rate limiting, payload limits, CORS, and denial-of-service
controls are deployment responsibilities. Transport auth never replaces a
capability decision.

The MCP bridge is a second listener and must be reviewed as one. It binds
loopback by default and is scoped to a single turn, so its default exposure is
the subprocess it was opened for. Its controls are the `authorize` hook, which
validates a bearer token on every request, and a session id that binds requests
to one bridge — a request presenting another bridge's session is refused rather
than adopted. Widening the bind address turns a loopback bridge into a network
service: require the token, terminate TLS ahead of it, and treat the port as
reachable by anything on that network. The execution token identifies a session.
It carries no authority, and a valid token still buys nothing that a capability
grant does not allow.

### Grant injection and tampering

`ExecutionRequest` carries an access context for embedded portability.
`@aicoo/sharedos-client` deliberately uses a narrower remote request that omits the
context and visible tools. At an HTTP boundary, any grants or tool definitions
inside caller-controlled JSON are untrusted. The host must reconstruct context
from trusted grant storage or verify grant authenticity and bind the grant to
the caller, authority, owner, namespace/world, and current revocation state.

Metadata cannot alter authorization. Unknown fields are rejected at protocol
boundaries to prevent hidden policy channels.

### Agent-to-agent messaging

A trusted sender identity does not make payload instructions safe. Forwarding a
message does not forward permission. Each hop is a new routing decision, and
every requested resource or tool operation is separately authorized. The
envelope's optional `provenance` is host-owned metadata: the kernel checks its
shape, neither sets nor reads it, and does not record hops itself.

Executing the receiving agent is also a side effect: it requires a
recipient-scoped `sharedos.execution` + `invoke` grant before the model driver is
opened. The driver receives sanitized context without grants or issuer identity.

Loops, fan-out, and recursive delegation can exhaust budgets. SharedOS sets
no turn limit of its own. When the host sets them, the envelope enforces a
tool-call ceiling and a timeout on the turn, and a step ceiling where the
runtime declares steps. `createStandardRuntime` does;
`createMcpHarnessRuntime` runs the vendor's own loop and declares none, so its
count bound is `maxToolCalls`. The host scheduler limits cross-turn behavior.

### Runtime plugins

`RuntimePlugin` is an execution seam, not an authorization seam. The fixed
`SharedOSExecutor` admits the target agent before opening a plugin, constructs a
frozen context without grants or issuing authority, intersects the requested
and authorized tool catalogs, and exposes effects only through `RuntimeHost`.
The broker re-authorizes every exact tool call and is closed when the turn
finishes. Runtime observations are wrapped as `runtime.event`, so a plugin
cannot forge authoritative `turn.*` or `tool.*` lifecycle events.

Runtime selection is trusted host policy. A message, retrieved file, model
output, or unverified request metadata cannot select a weaker harness. The
runtime manifest is snapshotted before execution and recorded in result
metadata; hosts and benchmarks separately retain model, runtime, backend, and
protocol versions.

The TypeScript interface does not sandbox code. An in-process plugin can use
ambient Node.js APIs independently of `RuntimeHost` and is therefore in the
trusted computing base. Third-party or otherwise untrusted runtimes must run in
a process, container, microVM, or remote service whose only SharedOS effect path
is an equivalent scoped broker. Aborting the turn closes the broker, but
providers and isolated adapters must still honor cancellation before committing
side effects.

### Files, retrieval, and mounted memory

Indexes, caches, embeddings, result counts, ranking, excerpts, and metadata can
all leak information. Namespace and owner filtering occurs inside the provider's
query, not only after retrieval. Cache keys include all authorization-relevant
scope and must be invalidated on revocation when cached data would otherwise
remain visible.

Retrieved content can contain prompt injection. It cannot change grants, tool
definitions, system policy, or the actor identity.

Providers interpret paths as structured segments. Filesystem adapters reject
absolute paths, traversal, symlink escapes, alternate separators, null bytes,
and encoding tricks. Database-backed adapters apply equivalent owner and
namespace predicates to every query.

Search and grep must not scan unauthorized content even if only authorized
matches are returned.

Memory and workspace are semantic roles or mounted roots over files. A memory
index, cache, or embedding does not acquire authority independent of its source
file, and moving a file between roots must not silently widen access.

### External and MCP tools

Connector registration is privileged. Hosts validate ownership, origin, tool
names, schemas, destination scope, and credential binding. The model cannot
replace the registered capability requirement or annotations.

Tool namespace enablement is a coarse availability ceiling, not a capability.
The host derives it from authenticated settings and product policy. SharedOS
checks it during both discovery and invocation, while the exact operation still
requires a matching grant. Settings writes go through a host-owned atomic port;
that port must verify the actor is eligible to manage the selection and may
narrow it with organization policy. OAuth and MCP connection lifecycle remain
outside SharedOS.

The unfiltered namespace catalog is intended for an authenticated management
surface, not model context. Agent drivers receive only the namespace- and
capability-filtered tool definitions. Hosts with separate human and agent API
tokens must restrict the management route accordingly.

Dynamic catalogs are resolved for one access context. A provider may use the
context to load that user's MCP connections, but it must not mutate a singleton
registry whose contents can be cleared or overwritten by another request. The
kernel rejects duplicate tool names when merging static and dynamic handlers.

Every registered tool supplies a runtime argument parser. The kernel validates
once, freezes the parsed call, and uses that same call for authorization and
invocation. Destructive or non-idempotent calls should require explicit actions
and host confirmation policy where appropriate. Tool outputs are untrusted;
SharedOS does not limit their size, so a host that needs a bound sets it in the
provider.

For network-capable tools, use egress controls and protect link-local, loopback,
private, metadata-service, and internal control-plane destinations unless a
specific deployment policy allows them.

### Idempotency and concurrency

SharedOS does **not** yet implement durable replay or
idempotency enforcement for message IDs, call IDs, operation IDs, or execution
IDs, and it does not impose a created-at freshness window. A production host
must atomically bind each accepted identifier to namespace/world,
authenticated actor, operation, target, and semantic input, and must reject a
replay whose input changes. This is a production gate, not a publication one: the
packages are public, and until this is a tested SharedOS port with production and
isolated adapters it stays a host obligation
([release readiness](../release-readiness.md)).

A retry is the commonest replay, and the envelope says when one is unsafe. A
turn's ending carries `retryable`, and it is `false` once a call to a `write`
tool not declared `idempotent` came back anything but `denied`, or was still
running when the turn ended. A handler cut off by the deadline is recorded
`interrupted` rather than left without a record, and `drainGraceMs` stops the
turn taking new calls before the deadline so that fewer are cut off at all. The
rule rests on the host's tool declarations; see
[Before you retry a turn](../errors.md#before-you-retry-a-turn).

Authorization and a side effect can have a time-of-check/time-of-use gap. For
high-risk writes, hosts should combine grant-use consumption, their own
revocation check against the issuing store, and the side effect in a
transaction or compensating protocol. The kernel itself decides revocation once
per turn, at admission (ADR 0010/0016), and does not re-read the store before a
side effect.

### Audit and observability

Audit records omit message secrets, tool credentials, raw authorization tokens,
and sensitive provider payloads. Stable IDs and hashes can connect events
without duplicating private content. Access to audit storage is itself an
authorized resource.

Clock skew and event reordering can obscure an incident; record sequence numbers
per execution and use a trusted timestamp source where policy depends on time.

An audit record that must precede an effect fails closed. If the sink throws on
an authority load, a decision or a catalogue listing, the operation is refused
and the turn ends `audit_unavailable`: an effect that cannot be recorded is not
attempted. A sink that hangs there holds back an operation that has not run,
which is the point. One that hangs after an effect would hold the result, so
`auditWriteTimeoutMs` bounds it.

If durable outcome-audit append fails after a side effect commits, returning a
transport error can cause a retry and duplicate the effect. The kernel therefore
preserves the typed provider result and reports `onAuditError`; production hosts
must persist the effect and audit outcome through an outbox or equivalent atomic
protocol.

## Evaluation integrity

An evaluation host uses a fresh namespace and provider world for each run. The
responder and SharedOS execution path do not receive gold labels or
evaluator-only channels.
Evaluation starts after execution is frozen. Adapter and protocol versions are
recorded so results from semantically different runtimes are not accidentally
pooled.

## Availability

SharedOS sets no size, step, tool-call or time limit of its own; the host
sets the ones it wants on the executor. Cancellation is propagated with
`AbortSignal`, but JavaScript cannot forcibly stop arbitrary plugin or provider
code; components in the trusted computing base must honor it before committing
side effects. Hosts add request rate limits, concurrency limits, provider
circuit breakers, and model or tool budgets. A timeout or provider outage is
not an invitation to retry with broader authority.

## Non-goals

SharedOS does not by itself:

- secure a malicious host or compromised deployment administrator;
- verify that a declared purpose reflects a model's private motivation;
- make arbitrary third-party tools trustworthy;
- provide user authentication, credential custody, or network sandboxing;
- provide durable replay protection; that remains a host obligation;
- guarantee storage durability or deletion when a host provider violates its
  contract;
- define host billing policy or the statistical validity of an evaluation.

These limits should be explicit in deployment documentation rather than hidden
behind the SharedOS permission guarantee.

## Release review checklist

- Are new inputs classified as trusted, authenticated, or untrusted?
- Does every new side effect have an explicit capability requirement?
- Are tenant/world and owner boundaries enforced inside provider queries?
- Can grant state change between discovery and invocation?
- Are concurrency and replay safe across multiple processes?
- Can any secret reach model context, errors, logs, or audit events?
- Are allow, deny, expiry, revocation, cross-tenant, and malformed-input paths
  tested?
- Does the change expand the trusted computing base or require a new ADR?
