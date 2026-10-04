# Permission model

This document defines the security invariants that every SharedOS package and
host adapter must preserve. Schema details can evolve during `0.x`; these
invariants cannot change without an ADR and protocol review.

## Core principle

SharedOS is deny-by-default. A requested operation is allowed only when a
trusted, active capability grant matches the complete request.

```text
message / model request  !=  authority
capability request       !=  authority
verified active grant     =  possible authority, after policy evaluation
```

Messages and model output are untrusted input even when they come from a known
agent. A message carries data and one host-bound purpose, never authority.

## Actors and authority

- **Actor**: the principal attempting an operation.
- **Subject**: the principal to whom a grant was issued; it must match the actor
  for direct use.
- **Issuer / authority**: the principal that issued or attests the grant.
- **Owner**: the principal whose resource is being accessed.
- **Host ceiling**: product or organization policy that can reduce, but never
  increase, granted authority. It is a port the kernel calls — `HostCeiling`,
  installed on the `CapabilityAuthorizer` — consulted on a grant that would
  otherwise allow, so its refusal is recorded as `host_policy_denied` instead of
  being invisible. Its answer is a policy decision, not an authority one, and
  the two are counted apart.
- **Namespace / world**: the tenant or experiment isolation boundary within
  which identifiers and resources resolve.

A model is not an authority. A tool registry is not an authority. Authentication
proves which principal is calling but does not authorize a resource operation.

## Capabilities and resources

A capability binds these fields together:

- resource namespace and structured path;
- resource owner;
- one or more actions;
- exact or descendant scope.

Canonical resource namespaces include `files`, `sharedos.messaging`,
`sharedos.execution`, `sharedos` — the kernel's own affordances, today only
`["escalation"]` — and host-registered external tool namespaces. A file path
identifies the smallest stable resource scope, such as
`["Memory", "project-x"]`, `["Workspace", "public", "summary.md"]`, or a
single file. Messaging uses a structured recipient address instead.

The execution namespace/world is a separate isolation boundary and must be
bound to every resolution. A resource identifier from one world cannot resolve
in another world even if its resource namespace, path, and owner text are the
same.

Writes are never implied by reads. Search is never implied by list. Registering
a tool does not imply permission to discover or invoke it.

One action is special. A capability whose `actions` lists the literal `"*"`
covers every action on its resource. There is no switch that enables it: a host
enables it by issuing such a grant, and should do so rarely, because ADR 0005
keeps create, replace, append, and delete distinct precisely so that authority
can be narrower than everything. It widens only the action test — resource,
owner, scope, purpose, time window, and bounded use are matched exactly as for
a named action — and delegation treats it as the widest action set: a derived
grant may carry `"*"` only when its parent does. Nothing else expands;
`snapshot:*` is an ordinary string that matches no action.

## Grant shape and constraints

A grant includes:

- a stable grant ID;
- subject and issuer;
- one or more complete capabilities;
- issuance and optional activation time;
- expiry and revocation state;
- optional allowed purposes;
- optional maximum uses;
- optional delegation depth;
- host metadata that does not itself alter authority.

The host must either load grants from a trusted store or verify their authenticity
through a configured verifier. An HTTP caller cannot make a request authorized
by attaching an arbitrary grant object to its payload.

`CapabilityRequest` expresses requested authority for a consent workflow. It is
not usable authority until an eligible issuer turns it into a trusted grant. The
kernel produces one and accepts none as input: an `AuthorizationDecision` that
matched no grant carries `requiredAuthority` describing what would have
satisfied it, and an `Escalation` may carry that description on to whoever
resolves it. The issuing workflow stays the host's.

## Where authority comes from

An `AccessContext` carries identity, purpose, trace, enabled tool namespaces,
and time. It carries no grants. Authority is loaded by the kernel from a
required `GrantSource`, once per turn, and is held beside the context in a
`ResolvedAuthority` that no provider, tool handler, transport, or runtime can
receive.

Host policy enters the same way, at the same moment. A kernel given an optional
`PolicySource` loads it once per turn beside the grant set and holds the result
on the same `ResolvedAuthority`, so the host ceiling decides every operation in
the turn against one policy state without reading a store. What it loads is
opaque to SharedOS: not validated, not hashed into the authority snapshot, and
never read by anything but the host's own ceiling. The source states a `version`
for what it loaded, and every catalogue listing in the turn records it beside
the authority hash and the catalogue's own hash, so a reader can pin what a turn
was shown to the policy state it was decided against. A source that throws fails
the turn's policy closed, and every decision the ceiling would have made in it
is refused `host_policy_unavailable`.

A `GrantSource` must answer from the issuing store with exactly the grants
issued to the context's actor by the context's authority inside the context's
namespace. Material outside that scope, material that fails the grant contract,
and an unreachable store are all the same outcome: authority is unavailable and
the operation is denied before any provider runs.

```text
Need authority
     |
     v
Trusted grant source
     |
     +-- available ------> evaluate grants
     |
     +-- unavailable ----> DENY (authority_unavailable, failClosed)
```

## Authorization algorithm

For each concrete resource or tool operation, the kernel evaluates:

1. Validate the protocol object and namespace/world binding.
2. Establish the authenticated actor independently from untrusted payload.
3. Load authority from the trusted grant source, or deny. The source returns the
   grants the actor holds and applies no policy of its own. Load the turn's
   host policy beside it, when a `PolicySource` is installed.
4. Ensure the request owner matches the access context owner.
5. Ignore grants whose subject or issuer does not match the access context.
6. Ignore grants that are not active or have been revoked as of the turn's
   admission, and grants that have expired as of this operation.
7. Match the declared purpose when the grant restricts purposes.
8. Match resource namespace, owner, path scope, and exact action together.
9. Validate the delegation chain of a derived grant, or deny.
10. Apply the host ceiling to the matched grant, or deny `host_policy_denied`.
11. Atomically consume a bounded grant only for execution, not discovery.
12. Return an explicit decision and append an audit event.

If no complete grant matches, deny. If trusted grant state, a delegation
ancestor, or an atomic usage store is unavailable, fail closed.

Steps 10 and 11 are in that order deliberately. A call the ceiling refuses does
not spend a bounded use, because `maxUses` counts what an actor did and a call
product policy stopped is not something the actor did.

The ceiling is consulted per matching grant rather than once per request, and a
refusal ends that grant's candidacy rather than the whole decision: two grants
can cover one request and differ in ways policy distinguishes — direct against
delegated, issued before a freeze against after it. If every matching grant is
refused, the denial is `host_policy_denied`. It ranks below both delegation
denials and above `grant_exhausted`. Below the unverified chain because that one
is fail-closed, and reporting a deliberate refusal in its place would hide an
infrastructure failure behind a policy label. Below the invalid chain — which is
_not_ fail-closed — because a chain that resolved and broke a rule says the grant
is not valid authority at all, which is upstream of whether policy would have
allowed it.

The ceiling may only narrow, and the types say so before the kernel does: it is
handed the allow arm alone, so it cannot turn a denial into an allow, and the
only refusal it may return carries `host_policy_denied`, so it cannot author a
code or borrow `no_matching_grant`. At runtime the same holds for a host outside
TypeScript: an `allowed` result naming a grant it was not shown fails closed,
and any other reason code on a refusal is replaced with `host_policy_denied` so
one refusal vocabulary survives. It is synchronous, which structurally forbids a network or
model call on the authorization path; the state it decides against is either
what it closes over or what the turn's `PolicySource` loaded at step 3, handed
to it unchanged on every decision. A turn whose policy could not be loaded
never reaches the ceiling: each decision it would have made is refused
`host_policy_unavailable`, before any bounded use is consumed. Discovery
consults the same port, so a catalogue is not offered on authority invocation
would refuse.

A host that installs none behaves exactly as it did before the port existed.
Every turn's `authority.resolved` audit event records which case it is —
`hostCeiling` says whether a ceiling is installed, `hostPolicy` whether a
per-turn policy was loaded, could not be, or has no source — because an audit
stream with no policy denials in it is otherwise ambiguous between a deployment
that has no policy port and one whose port never fired.

### Denials SharedOS caused

Fail-closed behaviour makes an infrastructure failure look like a denial at the
call site. The reason codes listed in `INFRASTRUCTURE_DENIAL_REASONS`
(`authority_unavailable`, `delegation_chain_unverified`,
`usage_store_unavailable`, `host_policy_unavailable`) mark that case, and their
audit records carry `failClosed: true`. So does `audit_unavailable`, which is not
an authorization code: it is the operation the kernel refused because the record
that must precede it could not be written. A measurement must separate them from
policy denials before computing any rate — and `host_policy_unavailable` is the
one most easily miscounted, because a broken ceiling and a ceiling that refused
are one line apart in the same table. Read `failClosed`, not the prefix.

A turn that could not establish authority at all has no authority state to name,
so record completeness does not require one from a decision that failed closed.
Demanding it would report every correct fail-closed turn as unusable evidence.

### Decisions SharedOS declined to make

An escalated turn is neither of the above. A runtime that stops because it needs
authority it does not hold ends the turn as `escalated`, and the audit event
carries the outcome `escalated` rather than `denied`. It grants nothing:
SharedOS records the request, names the reviewer -- assumed to be the owner the
turn runs on behalf of -- and stops. Resolving it means issuing a grant to the
trusted store, which the next turn loads. See
`docs/adr/0011-escalation-terminal-outcome.md`.

Escalations must be excluded before computing a denial rate, for the same reason
fail-closed denials must: counting them together inflates the rate by the cases
where the system correctly asked for help.

### One refusal, one code

The execution envelope and the kernel both refuse, and they use the same
vocabulary for the same refusal: a tool outside the permission-filtered
catalogue is `tool_unavailable` at either boundary. Which one refused is
recorded separately, as `source` on the audit event (and `OperationRecord.source`
in a conformance record), because a code says what was refused and a source says
who refused it. `classifyRefusal` and `explainRefusal` read an audit event into
the gate that refused; see
[Naming the gate a refusal came from](../errors.md#naming-the-gate-a-refusal-came-from).

Two codes that are easy to confuse are kept apart deliberately:

- `invalid_request` -- the request names a resource outside this world. This is
  a denial, checked before the tool's own ceiling and answered by the
  authorizer, so it carries a recorded authorization decision.
- `invalid_tool_requirement` -- the tool resolved a capability outside the
  ceiling it declared. This says the tool misbehaved, not that the request was
  impermissible.

See `docs/adr/0012-one-refusal-vocabulary.md`.

### No permission cross-products

Independent grant fields must not be unioned into a new synthetic authority.

Suppose one grant allows:

```text
files/Memory/project-x: search, read
purpose: prepare-update
```

and another allows:

```text
files/Workspace/public/summary.md: replace
purpose: publish-summary
```

They do not combine into permission to replace a file under
`files/Memory/project-x`, nor to replace a file for `prepare-update`. The full
requested tuple must match a complete capability under a compatible grant. A
set of valid grants may provide a union of complete authorities, never a
cross-product of their individual fields.

### Path scope

An `exact` capability matches only the same path. A `descendants` capability
matches the same path and children by path segment, never by a raw string
prefix. For example, `projects/x` can contain `projects/x/reports`; it must not
match `projects/x-secret`.

## Purpose

Purpose is a structured policy and audit constraint, not a claim that SharedOS
can infer a model's true motivation. The caller declares a purpose; a grant may
allow specific values; SharedOS propagates the chosen value through the trace
and rejects incompatible values.

Hosts may add workflow-specific evidence or approval before accepting a purpose.
They must not silently substitute a broader purpose after a denial.

## Delegation

Delegation is explicit and bounded. A subject cannot mint authority merely by
forwarding a message or copying a grant. A derived grant names its immediate
ancestor in `parentGrantId`, and SharedOS validates the complete chain before
the grant authorizes anything:

- every link has a verifiable issuer-to-subject relationship;
- each derived grant is no broader in resource, action, purpose, time, or
  namespace than its parent;
- delegation depth decreases at each link, and a parent without delegation
  budget cannot be reissued at all;
- a parent bounded by `maxUses` is not delegable at all;
- revocation and expiry of an ancestor invalidate the usable chain, at the
  turn's instant and this operation's respectively;
- the full chain or a tamper-evident reference is retained in provenance.

Ancestors are loaded from a trusted `DelegationChainResolver`, never from the
presented grant or the access context. A chain that cannot be established is
denied as `delegation_chain_unverified`; a chain that resolves and breaks a rule
above is denied as `delegation_chain_invalid`. Both carry the failing link into
the audit record. A host that issues delegated grants must install a resolver;
without one, `parentGrantId` authorizes nothing.

`delegationDepth` is therefore a ceiling on reissue, not a permission to reissue
without a validated parent. See `docs/adr/0008-delegation-chain-validation.md`.

### Bounded grants are not delegable

`maxUses` is counted per grant. Two children of a three-use parent would carry
six uses between them, so a bounded parent is refused outright rather than
attenuated — at issue as `bounded_parent_not_delegable`, and again at use as a
`delegation_chain_invalid` with the same code. Sharing one budget across a chain
needs usage accounting that spans grants, which SharedOS does not have; refusing
is the honest answer until it does.

### Issuing a derived grant

`deriveGrant` is the supported way to produce a grant whose issuer is not the
resource owner. It is a pure function over the parent: it never consults a
store, and it refuses rather than clamps, because a silently narrowed delegation
reads as accepted and the delegator then believes it passed on more than it did.

Two rules differ from the chain check above, and both differ in the safe
direction:

- **An unowned parent capability may not be given an owner.** An unowned
  capability resolves against whoever presents it, so pinning an owner is
  narrower in one context and wider in every other. Issuing has no context, so
  it must hold in all of them.
- **What a request leaves out is inherited and written down.** An omitted
  expiry, window, or purpose takes the parent's value and is recorded on the
  derived grant. The chain check reads an omitted constraint as a widening, so
  inheritance that stays implicit would be denied at first use.

Deriving a grant is never sufficient on its own. It settles narrowing at the
moment of issue; revocation happens afterwards, and only the chain check
observes it.

## Messaging

A `MessageEnvelope` contains sender, receiver, purpose, payload, trace, time,
and provenance. It intentionally contains no grants.

It also contains no second `intent` field. `purpose` is the single host-bound
reason used by access context, grants, turn validation, and audit; model-authored
instructions belong in the payload.

Sending or receiving a message and performing the requested work are separate
authorization decisions. A recipient may accept the message yet be denied
access to the file or tool named inside it. Replying can also require its own
`sharedos.messaging` + `send` capability. Opening a target agent turn requires a
separate recipient-scoped `sharedos.execution` + `invoke` capability.

Outbound sends execute as the sender. Inbound turns execute as the recipient:
the access actor must equal the target agent and the envelope receiver, while
the envelope sender remains untrusted provenance. The requester's send grant,
the recipient's execution grant, and every file or tool grant used by that
recipient are separate decisions.

For model-authored request/reply, `messages.request` accepts only a recipient
and JSON-safe payload. SharedOS fills trusted envelope fields, authorizes and
consumes the recipient-scoped send capability once, delivers through a host
port, and validates the correlated reply before exposing its payload. Durable
logs, queues, receiver wake-up, and scheduling remain host-owned.

## Tools and MCP

Tool usability requires three independent facts:

1. the trusted registry or context-specific provider registered the tool;
2. the trusted access context enables the tool's logical namespace;
3. an active capability grant covers the required resource and action.

The kernel enforces them in two phases:

1. **Discovery:** return only definitions in enabled namespaces whose required
   capability the actor can currently exercise. Discovery does not consume
   `maxUses`.
2. **Invocation:** recheck namespace enablement and authorize the exact
   registered definition and resource immediately before execution. Invocation
   atomically consumes a bounded use.

Never trust a model-supplied tool name, required capability, annotations, or
schema. Resolve the definition from the host registry, reject ambiguity, validate
arguments with the handler's mandatory runtime parser, then authorize and invoke
the same immutable parsed call. A read-only annotation is descriptive metadata
and cannot replace the capability action.

Likewise, a tool's `namespace`, `source`, and `readWrite` fields are catalog
metadata, not authority. Enabling `calendar` only makes qualifying calendar
tools eligible for discovery; it does not grant read, create, update, or delete
access to any calendar or event.

Namespace settings come from the authenticated host, never from model output.
An empty effective selection means all namespaces are disabled. Standard
updates are idempotent enable/disable patches applied atomically by a host-owned
settings store. The host may narrow the returned selection according to product
or organization policy and must load that authoritative selection into future
access contexts.

The full namespace catalog is management-plane metadata. Hosts expose it only
to an authenticated principal allowed to manage that selection and must not add
disabled connector metadata to the model's turn context. The runtime gives the
model only `listTools` output after namespace and capability filtering.

External and MCP tools follow the same gates as built-in OS capabilities. The
host additionally protects credentials, validates destinations, and prevents a
connector from escaping its configured account or tenant. Dynamic tools are
resolved for one access context and must not be installed by mutating a
process-global registry shared across users.

## Files, indexes, and memory views

The file provider receives an already authorized context plus the exact
operation. It must:

- resolve only within the bound namespace/world and owner;
- return only the fields authorized by the operation;
- avoid widening a search to inaccessible siblings;
- honor cancellation before committing a side effect;
- enforce the host's durable replay/idempotency policy before writes;
- report actual affected resource identifiers for audit;
- treat stored content as untrusted data, not policy instructions.

Memory, workspace, raw material, and wiki content are file paths or mounted
views over the same file plane; they are not independent stores of authority.
Search indexes and embeddings are derived from files and remain inside the same
isolation boundary as their sources. A filtered final result does not make a
cross-tenant search safe if the search itself leaked ranking, counts, timing,
or embeddings.

## Time, revocation, and bounded use

Every external side effect is authorized separately, against the authority the
turn was admitted with. Hosts supply a trusted clock or trusted timestamp
policy.

`maxUses` requires an atomic compare-and-set store shared by all executing
instances. The kernel has no implicit process-local fallback: a bounded grant
fails closed unless the host explicitly supplies a store. The exported in-memory
store is suitable only for tests or a guaranteed single-process host.

A use is spent when the decision is made, before its record is written. If that
record cannot be written the call is refused, and the kernel gives the use back
through the store's optional `release`. A store without one keeps it (ADR 0023).

Authority is loaded from the trusted source once, when a turn is admitted, and
held for that turn. Every way a grant leaves an actor's authority -- not yet
active, expired, revoked, or withdrawn from the requested purpose -- runs through
one check, and that check is evaluated against **two** instants:

- **Expiry** is decided at the instant of the operation. A grant whose validity
  window closes while a turn is running is refused at the next decision in that
  turn, without the store being read again.
- **Revocation, purpose withdrawal, `issuedAt`, and `notBefore`** are decided at
  the instant the turn was admitted, so they are observed by the **next** turn.

The rule is directional: the operation's clock may only take authority away. A
turn carries the grant set it was admitted with and never gains more while it
runs, and a window that opens mid-turn is therefore not honoured until the next
turn. An ancestor follows the same split, so an ancestor expiring mid-turn
invalidates its descendants immediately and an ancestor revoked mid-turn does
not. See `docs/adr/0016-expiry-is-instant-bound.md`.

A host whose revocation SLA is shorter than its longest turn must bound turn
length; the kernel will not cut a turn short. Issuing short-lived grants is one
way to bound it, because their expiry now lands inside the turn. A host that
additionally caches inside its `GrantSource` owns that staleness window on top.

Nothing inside a turn observes a store edit before the next turn. The
per-operation path that once did was kept behind a build-time switch no host
could set, and is removed. A kernel call made outside any turn still resolves
its own authority, which is a turn of one operation. See
`docs/adr/0010-per-turn-authority.md`.

## Audit requirements

Every decision should be reconstructable from tamper-evident records containing:

- decision and reason code;
- actor, authority/issuer, owner, and matched grant ID when allowed;
- namespace/world, resource, action, and purpose;
- execution, operation, message, tool call, and trace identifiers as applicable;
- time and sequence, and an identity of the record's own (`AuditEvent.id`)
  that no other record shares, minted rather than derived from content: the
  same decision made twice in one turn is two records, and a store that
  deduplicates keys on the id, never on a hash of the fields;
- provider result category and affected resources, without leaking secrets.

Denials are first-class events. Audit storage belongs to the host, while event
shape and required provenance belong to SharedOS.

The records written before an effect fail closed. If the sink throws on an
authority load, a decision or a catalogue listing, the kernel refuses the
operation with `AuditUnavailableError` and the execution envelope ends the turn
`audit_unavailable`: an effect that cannot be recorded is not attempted. An
operation whose port was entered and then stopped, by a deadline, a cancellation
or that outage, is recorded `interrupted`, not `failed`, because part of its
effect may have committed.

If outcome audit persistence fails after a provider has committed a side effect,
the kernel preserves the provider's typed result so callers do not retry an
already-completed operation because observability returned 500. Production
hosts must use a transactional outbox or equivalent durable audit design and
surface the `onAuditError` signal operationally. `auditWriteTimeoutMs` bounds a
sink that hangs on such a record, so a result already earned is not held.

## Review checklist

Any permission-related change must answer:

- What is the exact resource-action-purpose tuple?
- Where is the authenticated actor established?
- How is the world/tenant boundary bound and checked?
- Can two grants accidentally combine into broader authority?
- Is expiry checked at the side effect, and revocation at the turn's admission?
- Is bounded use atomic across instances?
- Are discovery and invocation both gated?
- Are allow and deny paths tested?
- Can the audit trail explain the decision without exposing secrets?
