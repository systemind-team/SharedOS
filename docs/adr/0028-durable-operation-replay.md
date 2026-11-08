# ADR 0028: Durable operation replay

Status: Accepted for opt-in deployment; protocol activation requires the protocol-versioning release.

## Problem

IDs currently correlate events. Repeating a resource operation ID and its input
calls the provider twice. HTTP delegates to the same paths. Kernel tool calls,
message sends and executor turns have the same gap. Grant-use and audit commits
are separate concerns and are unchanged by this decision.

## Identity and fingerprint

The trusted `AccessContext.namespaceId` is the tenant/world boundary. A replay
key is the tuple `(namespaceId, kind, scope, id)`, encoded structurally, never
by delimiter concatenation. Execution, resource and message IDs are unique
within their tenant and kind (`scope = ""`). Tool-call IDs are unique within
an execution, taking their scope from trusted `AccessContext.executionId`.
Embedded callers may supply the legacy operation option when the context has no
execution ID; standalone calls outside an execution use their trusted trace ID.
The executor normalizes the context to its request execution ID before both
fingerprinting and dispatch, overriding any incoming context execution ID.
Hosts must keep namespace IDs stable and never recycle them between tenants.

SharedOS computes a SHA-256 fingerprint of canonical JSON with object keys
sorted by Unicode code-unit order, array order preserved, and JSON number/string
encoding. It includes actor, authority, owner, purpose, trace identity, namespace
settings, operation target and all semantic input (including metadata). Context
`now` and tool `requestedAt` are observation times and are excluded. Envelope
`createdAt` is retained. An omitted resource owner is normalized to context owner.
Execution fingerprints additionally include the selected runtime manifest and
executor defaults. Inputs are cloned before hashing and dispatch so mutations
cannot change an already claimed operation. Non-JSON inputs fail validation.
Same key with different fingerprint is `replay_conflict`, including different
actors. A replay can return data only to the same trusted identity/context; it
is retrieval of a previously admitted result, not new authority or a new effect.
Changing authority or retrying a denial requires a new operation ID.

## Atomic claim and states

A host `ReplayStore` atomically inserts a pending record or returns the existing
record; comparing fingerprints is kernel policy. Exactly one worker owns the
claim. Its opaque token fences every settlement; all records and results are
JSON-safe. Independent kernel instances must share the same durable store.

- Pending duplicates return `replay_pending` promptly. They do not wait for or
  cancel the owner and never enter a provider.
- Completed results, including denied results, are replayed verbatim. Failed
  results are also retained and replayed; an error may follow a committed effect.
- Effect cancellation or an exception before a durable result leaves an interrupted
  tombstone. Later duplicates return `replay_interrupted`. Cancellation before
  claim creates no record. A late provider result cannot reopen a settled claim.
  An executor that finishes with a typed cancelled result retains that result;
  its interrupted child effects remain blocked. Pre-aborted executions do not claim.
- A process crash leaves pending state. There is no automatic lease expiry or
  takeover. A trusted host recovery worker may use the claim token to mark the
  abandoned record interrupted after establishing that the owner is stopped.
  SharedOS never automatically re-executes it.
- Store errors fail closed with `replay_unavailable` and invoke no effect before
  claim. A settlement outage after an effect leaves pending/ambiguous state and
  returns `replay_unavailable`; retrying that ID still cannot perform the effect.

## Retention and recovery

The store retains identity, fingerprint and terminal state permanently (or for
the lifetime of a tenant whose identifiers will never be reused). Hosts may
expire sensitive result bodies to an `expired` tombstone: duplicates return
`replay_expired`, never execute again. Retained successful/failed results must be
validated by SharedOS before release. Retention clocks, quotas, encryption,
access controls and administrative recovery belong to the host. Recovery can
reconcile a pending effect with external evidence and settle the original token;
it must not clear the record to invite an automatic retry.

An atomic claim does not atomically commit an external effect and its result.
A crash between them is ambiguous. Exactly-once execution is not promised for
external systems. Hosts should forward stable operation identity to providers
with idempotency support, or reconcile using provider receipts. Arbitrary
external systems may require a human to resolve the ambiguity.

## Nested operations and transport

An execution claim encloses the complete turn. Replaying it returns stored events
and result and does not run the plugin or stream new lifecycle events. Tool calls
claim independently in that execution's scope. Runtime refusal before reaching
the kernel is part of the enclosing execution result. Resource calls through
standard OS tool adapters are effects of the claimed tool call: their provider
operation ID is derived with `childOperationId` from the full trusted tool key
and the adapter child slot, so identical call IDs in separate executions cannot
collide at a provider. They do not re-enter the resource kernel gate. Legacy
unprotected adapters and direct handler calls retain their call-ID correlation.
Direct kernel resource calls have their own tenant-scoped resource identity.
The kernel passes an optional trusted replay key as the fourth `ToolHandler.invoke`
argument when replay is enabled. Composite handlers can use `childOperationId`
with distinct child slots. Custom composite handlers must assign stable, distinct child IDs and route
separate effects through the appropriate kernel method; they must not use the
parent ID for multiple children of the same kind. A parent replay never reruns
children. Cycles/self-reentry encounter pending rather than recursively dispatch.

`messages.request` generates a stable message ID from tenant, trusted trace,
actor, execution scope and call ID. Both direct sends and its already-authorized transport path
claim that message ID. The delivery receipt and tool reply are distinct retained
results. Receiver execution uses a separately assigned execution ID; message
receipt does not deduplicate arbitrary host scheduling. Delivery never forwards
authority. Fan-out needs a distinct message ID per recipient.

HTTP is an adapter: it keeps the existing typed result/error shapes and delegates
to the same gates. Caller IDs remain untrusted; authenticated context establishes
the tenant. Replay is not freshness: timestamps do not grant authority and no
universal wall-clock freshness window is introduced.

## Contracts and rollout

The store port and replay error codes are additive. Installing `replayStore` on
the kernel activates all four gates; executors use the kernel's replay port.
Without it, v1 preserves its existing unprotected behavior for compatibility.
Production hosts MUST supply a durable store; the isolated testkit adapter is
not production storage. This transitional omission is deliberately documented,
not an exactly-once guarantee. ADR 0019 freezes protocol `"1"` at the
`1.0.0-preview` shape. A future mandatory fail-closed store requirement must be
coordinated with the next semantic protocol version and host construction
migration; no epoch 2 or `/v2` route is assumed by this change.
Do not independently change the global version constant in this PR: older v1
clients still parse these existing result shapes. No grant reservation or audit
transaction changes are included.
