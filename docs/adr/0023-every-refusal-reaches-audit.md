# ADR 0023: Every refusal reaches audit, and the record names the boundary

- Status: Accepted
- Date: 2026-08-31
- Revised: 2026-09-17. `source`, `cause`, `failClosed`, `consumed` and `endedBy`
  are `AuditEvent` fields rather than `metadata` keys, and the rule for which
  audit write may refuse an operation is stated. Both revisions are in the
  Decision below, which describes what ships.
- Revised: 2026-09-18. An audit outage before an effect is a typed error and
  ends the turn `audit_unavailable`, and an operation stopped after its port was
  entered is recorded `interrupted`. Also in the Decision below.
- Revised: 2026-09-18. A record written after an effect may be held to a time
  limit, and the turn an outage ends drains first where the host set a grace
  (ADR 0007, which also now states the `retryable` rule for every ending).
- Revised: 2026-09-20. The four turn ports on `TurnKernel` are required, where
  they were optional members a partial kernel could leave out. In the Decision
  below.
- Revised: 2026-09-20. The conformance record carries `interrupted` as its own
  outcome and a refusal's `cause` on the operation, under judge version 6.
- Revised: 2026-10-04. A bounded use spent by a decision that could not be
  recorded is given back, where the usage store can. In the Decision below.
- Extends: `docs/adr/0012-one-refusal-vocabulary.md`

## Context

ADR 0012 gave the two boundaries one refusal vocabulary: the envelope and the
kernel refuse an unavailable tool with the same `tool_unavailable`, and which
boundary refused is `OperationRecord.source`. That settled what a refusal is
called. It did not settle where a refusal is written down, and the answer today
is that a large class of them is written nowhere.

The execution envelope makes no audit call of its own. The single event that
reaches audit from a terminal outcome is the escalation, and it gets there by
calling the kernel, which owns audit. Everything else the envelope refuses
exists only in `ExecutionResult.events`, a stream this repository's own
production packages never read — every consumer of it is in
`@aicoo/sharedos-conformance`.

So these are invisible to a host with an audit sink and no conformance record:

| refused                                                                    | where it lives today                            |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| a tool name the turn's catalogue never offered                             | events only                                     |
| `step_limit_exceeded`, `tool_call_limit_exceeded`                          | events only                                     |
| `actor_mismatch`, `receiver_mismatch`, `message_context_mismatch`          | events only                                     |
| a plugin that ended the turn on an escalation the catalogue does not offer | events only                                     |
| `runtime_failed`, `driver_failed`, `invalid_runtime_outcome`               | events, plus `onTurnError` for the thrown error |
| that a turn started, ended, or how                                         | nowhere — no audit type exists                  |

The first is the one worth naming twice. An agent calling a tool it was never
offered is the clearest attempted-violation signal the system produces, and a
host reading audit alone cannot see that it happened.

Discovery has the same shape at the other end. `listTools` records the tools it
returned and nothing about the ones it did not: a namespace that is off is a
bare `continue`, and a tool no grant makes discoverable simply does not appear.
The refusal has no code on either side — the agent is not told, and neither is
the record.

And one documented promise is not kept. `docs/errors.md` says `tool_unavailable`
covers three situations and that the specific reason is in the audit trail,
"recorded immediately before" as an `authorization.checked` event. That holds for
one of the three. A tool that is not registered, or whose namespace is off,
produces `tool.invoked` carrying the same coarse code the wire carried, with no
decision event to disambiguate it.

## Decision

Every refusal a boundary makes is recorded, and every operation event says which
boundary made it.

### The envelope records through the kernel

`TurnKernel` already reaches the kernel through a narrow interface, which holds
`openTurnAuthority` and `recordEscalation` beside the four operations a turn
asks for. The recording surface this ADR needs joins them there:
`recordTurnEnd` and `recordRefusedCall`. All of them are required. A kernel
without the recorders would run a turn whose envelope refusals reach no trail,
which is the defect this ADR removes, so the type does not admit one.

The envelope does not take an `AuditSink` of its own. A host would then have to
pass the same sink in two places, and the failure mode of forgetting the second
is a turn that enforces correctly and records nothing — the exact defect this
ADR exists to remove, reintroduced as a configuration mistake. One sink, owned
by the kernel, reached from the envelope the way escalation already is.

### `turn.ended` — one event, at the terminal

`AuditEventType` gains one value, not five. `turn.ended` carries the outcome and
the reason code of however the turn finished: completed, denied, failed,
cancelled, escalated.

Five lifecycle events would triple the audit volume of every successful turn to
record nothing a single terminal event does not already say. And a
`turn.denied` following an admission refusal would double-count: `admitTurn`
already produces an `authorization.checked`, so the denial is in the stream
once. A host counting denials counts decisions; a host counting turns counts
terminals; neither reads the other's events.

### Envelope-terminated calls become `tool.invoked`

A call the envelope refuses before the kernel sees it is a tool call that was
attempted and denied, which is what `tool.invoked` means. It is recorded as one,
with the code the caller was given.

### `source` on every operation event

`kernel` or `envelope`, mirroring `OperationRecord.source`: the boundary that
performed or refused the operation.

This is required by the change rather than incidental to it. Today the rule "it
is in audit, therefore the kernel refused it" holds for free, because the
envelope records nothing. Routing envelope refusals into audit destroys that
rule, and a host reading audit alone would lose a distinction it has now.
Closing one gap while opening an ambiguity is not an improvement, so the two
land together.

It is on `tool.invoked`, `resource.invoked`, `message.sent` and
`tool.catalog.listed`. It is not on `turn.ended`. Every turn ending is recorded
by the envelope, so a `source` there would say who recorded, which is a second
meaning and one that says nothing; who _ended_ a failed turn is `endedBy`.

### `cause` on the coarse codes

`reason` stays `tool_unavailable` — the same code the caller was given, which is
what keeps ADR 0012's one vocabulary intact and keeps the audit code and the
wire code comparable. The specific fact goes in `cause`: `not_registered`,
`namespace_disabled`, the reason code the discovery check returned, `not_offered`
for the envelope's catalogue refusal, and `host_policy_denied` for the ceiling
of ADR 0020.

That last one is not optional. `host_policy_denied` can only ever appear on an
`authorization.checked` event, so a host counting policy refusals from the
operation events would get zero — and for two of the causes there is no decision
event to join to. The cause field is what makes ADR 0020's count obtainable from
the events a host actually reads.

`message_request_not_accepted` is the same kind of code and is treated the same
way. The caller of `messages.request` is told the request was not accepted
whatever the transport answered, because the transport's vocabulary is the
host's. The tool's record carries what the transport answered as its `cause`,
so a reader does not have to join it to the sibling `message.sent` by call id to
say why. The code travels inside the kernel, never through the handler's
result, which is returned to the caller whole.

### What the kernel states is a field

As first decided and shipped in 0.1.0-alpha.4, `cause` and `source` went in
`metadata`, beside the `failClosed` and `consumed` flags already there, so that
`AuditEvent` kept its top-level shape: hosts persist these events under closed
schemas of their own, and a new `metadata` key breaks nobody.

That put two authors in one untyped object. ADR 0020 records a decision's own
metadata on `authorization.checked` — a host ceiling's rule, the authorizer's
delegation detail on a broken chain — and a port's key could then stand where
the kernel's would have been. Spread order protected `consumed`, which the
kernel always writes. It did not protect `failClosed`, which the kernel only
ever _sets_, on an infrastructure denial: on any other denial a port's
`failClosed: true` would stand and move a deliberate refusal out of the policy
counts. The kernel carried a function whose only job was to strip the two keys
from a port's metadata first. Readers paid too. `classifyRefusal` read three
facts through a helper that checked each was a string; the conformance
assembler compared a string for `source` and re-derived `failClosed` from the
reason code, a second copy of a decision the kernel had already made; and the
three operation events were built apart, so `resource.invoked` and
`message.sent` never carried `failClosed` and a grant store that was down read
as one outage and two deliberate refusals.

So the rule is: **what SharedOS itself states about an event is a field, and
`metadata` holds what a host port supplied and the details particular to one
event type.** Five facts are fields:

- `source` and `cause`, above.
- `failClosed`, present and `true` when SharedOS could not establish a fact and
  refused rather than guess. On every event that can record an outage,
  `resource.invoked` and `message.sent` included.
- `consumed`, whether a bounded use was spent, on `authorization.checked`.
- `endedBy`, `envelope` or `runtime`: who ended a failed turn, on `turn.ended`.

`AuditEventSchema` is published in `@aicoo/sharedos-contracts`, strict, and the
kernel's `AuditEvent` type is inferred from it, so the type and the schema are
one definition; a conformance test parses every event every canonical move
produces. One builder states the operation facts for the three operation
events, and one `tool.invoked` builder serves the kernel's own records and the
refusals the envelope hands it, which is also how an envelope refusal came to
carry the turn's `catalogHash`. A port that writes a key named `failClosed` has
written a key in its own `metadata`; the field is the kernel's, and a port has
no way to reach it.

Details particular to one event type stay in `metadata`: `grantIds` and
`grantCount` on `authority.resolved`, the listing's identifiers below,
`catalogHash` on `tool.invoked`, the authorizer's explanation on a denial,
`detail` and `reviewer` on an escalation. `version` stays `"1"`, and there is no
release in which a fact is written in both places.

### A record before an effect may refuse it; a record after never changes it

The kernel writes to its sink on two paths, and which one a write takes is
decided by when it happens. An authority load, an authorization decision and a
catalogue listing are written before anything acts on them: a sink that throws
there rejects the operation with an `AuditUnavailableError` carrying what the
sink threw, nothing runs, and `onAuditError` is not called because the caller is
handed the failure. An operation's outcome, a turn's
ending, an envelope refusal and an escalation are written once the answer is
final: a sink that throws there is handed to `onAuditError`, and the caller
receives the result it would have received, because returning a failure would
invite a retry of something already done.

A sink that does not answer is not a throw, and on the second path it held the
result of a committed effect for as long as the caller waited: a turn that
reached its deadline first dropped the result of a transfer that went through.
`auditWriteTimeoutMs` bounds that write. Past it the event is handed to
`onAuditError` with an `AuditWriteTimeoutError`, the hook is held to the same
limit, and the caller receives its result. So a result is released once its
record is written or the host has been told it was not, and never before the
write was attempted: the seat cannot act on an effect ahead of its record. The
first path is never bounded. There a sink that does not answer holds back an
operation that has not run, which is what that path is for. Absent, the option
changes nothing.

`escalation.requested` is on the second path. It is the turn's terminal record,
not a gate; written on the first, a sink that threw ended the turn
`runtime_failed` and blamed a plugin that had done nothing wrong.

A bounded use is spent before `authorization.checked` is written. Spending it
is what decides whether the call is allowed, and that has to be atomic across
workers, so the order stays. A sink that threw there used to cost a use with
nothing run: one outage exhausted a `maxUses: 1` grant whose provider was never
entered. The kernel now gives the use back through `GrantUsageStore.release`
when that record is refused. The method is optional. A store without it, or one
that throws from it, keeps the use as every store did before, and the caller is
told of the audit outage either way. Nothing else gives a use back: a call
cancelled or failed after its decision was recorded has used the grant. A sink
that stored the event and then threw leaves an `authorization.checked` that
says a use was spent, with no operation record after it, for a use that went
back.

### An audit outage before an effect ends the turn

Inside a turn the rejection used to reach the runtime plugin as whatever the
sink threw. A plugin that did not catch it ended the turn `runtime_failed`, "The
runtime plugin failed", for an outage the plugin had no part in; the same
happened when the outage was met while the envelope was still opening the turn,
before any plugin ran. A plugin that did catch it could call again, and every
call under the outage is refused the same way.

So the error is typed and the ending is the envelope's. The executor notes an
`AuditUnavailableError` where it called the kernel itself -- opening authority,
admitting the turn, reading reach, listing the catalogue, mediating a tool call,
recording an escalation -- stops the turn taking anything new, lets what is
already inside a handler answer for as long as the host's grace allows (ADR
0007; with no grace the turn is aborted at once), and ends it `failed` with
`audit_unavailable`, `endedBy: envelope`, `failClosed`. It does not read the
error off what a plugin threw: a plugin can neither swallow the rejection and
carry on, nor throw the error itself and be credited with a refusal the envelope
did not make. The host's `onTurnError` receives the error, and with it the
sink's. Only the first path latches. A record that fails after an effect never
ends a turn: the effect stands, and ending the turn as failed would invite the
retry the second path exists to prevent.

The ending's `retryable` is decided by what the turn may already have done. It
is `true` only when every call that cannot safely be repeated came back `denied`
or was refused for the outage before its port was entered, and none is still
with the kernel. One such call that succeeded, failed, was stopped, or has not
settled makes it `false`: refusing a retry costs a host one decision of its own,
and allowing one after a committed effect costs it a second payment. Which calls
can be repeated, and the same rule on every other ending, are in ADR 0007. During the outage the
`ExecutionResult` is the reliable account of what ran, which is why the rule
reads it and not the trail. A direct kernel caller has no turn to end and still
receives the rejection; `effect` on the error says `none` when nothing ran and
`unknown` when the outage was met by a port already entered, such as a host tool
calling back into the kernel.

A typed refusal that let the turn continue was weighed and rejected. A model
reads a refusal as something to try again, each attempt is refused again, and
on a store that cannot give a use back each attempt also costs one.

### An operation stopped after its port was entered is recorded `interrupted`

When a caller aborts, the kernel re-throws the abort ahead of containing the
port's throw, so a cancelled call is never reported as a provider that failed.
It also used to write nothing. A handler that debited one account, saw the
turn's deadline and threw before crediting the other left a trail that ended at
`authorization.checked: allowed`, which reads as a call that never started.

The operation event is now written before the abort is re-thrown, with a sixth
`AuditOutcome`, `interrupted`: the port was entered and stopped before it
answered, so any part of its effect may have committed. `reason` says what
stopped it, `operation_aborted` for the caller's abort and `audit_unavailable`
for an outage under a decision the port itself asked for. Not `failed`: that
outcome also covers refusals where nothing ran (`invalid_tool_arguments`,
`tool_catalog_unavailable`), and a reader that took an interrupted transfer for
one of those would retry it. A cancelled turn keeps `failed` with reason
`turn_cancelled`, because there `reason` separates two causes of one fact; here
the fact differs. A port that answers despite the abort is recorded with its
real outcome, a call stopped before its port was entered writes nothing, and the
abort is still not reported to `onProviderError`. The conformance record
carries `interrupted` as an outcome of its own, as audit does. A receipt built
from it says `failed`, which is what the caller was told, and the judge leaves
an interrupted call out of the refusals it credits to a boundary, so none is
credited with refusing a call that may have run.

Letting calls already inside a handler answer before a turn ends, so that most
get their real outcome and `interrupted` is left for the ones that cannot, is
what a deadline means to a handler and is decided in ADR 0007.

### Discovery is recorded in aggregate

`tool.catalog.listed` records what a listing was computed from and what it came
to, as identifiers and a count: `catalogHash`, the catalogue the caller was
shown, computed as `listPublishedTools` computes it so an execution's manifest
and the audit record match on one value; `enabledNamespaces`, the caller's own
filter; `hostPolicyVersion`, the version the turn's `PolicySource` stated (ADR
0020), when one loaded; and `withheldCount`, how many registered tools were not
returned. `authorityHash` is already on the event. Equal values on two events
mean the same catalogue for the same reasons. One event per listing, as now.

Not one event per tool, and not the names. A registry of two hundred tools would
produce two hundred awaited sink writes per catalogue build, or two hundred
names in one event on every turn, to record what a digest records once. Volume,
not secrecy: a tool name is a registry constant and reveals nothing about the
world. What a count cannot carry is the per-tool cause. `failClosed: true` on
the event keeps the one distinction a reader cannot do without — something was
withheld by an outage rather than by a decision — and an attempted call on a
withheld tool is still recorded on `tool.invoked` with its own `cause`.

### What stays out, and why

- **The MCP transport's `unauthorized` refusal.** It happens before an
  `AccessContext` exists, so there is no namespace, actor, trace, or owner to
  attach the event to. Inventing an actor to fill the fields would put a
  fabricated principal in the trail, which is worse than the gap. It belongs in
  the host's HTTP log.
- **The thrown error behind any refusal.** Reason codes are bounded facts; a
  thrown message may carry arguments, rows, or credentials the thrower had in
  scope. `onProviderError` and `onTurnError` remain the only places one goes.
- **Tool arguments, tool results, message payloads.** Unchanged. The redaction
  rule that `checkRecordRedaction` enforces is not relaxed by any part of this.
- **Validation detail behind `invalid_tool_arguments`.** The code is already
  audited and stays; the parser's message is not added, because it quotes the
  value that failed.

## Consequences

- A host with an audit sink and no conformance record can see every refusal both
  boundaries make, and can tell which made it.
- `docs/errors.md`'s existing promise about `tool_unavailable` becomes true, for
  four causes rather than one of three.
- Hosts wire nothing new. No option is added to the executor, no sink is passed
  twice, and no compatibility facade has a new field to forget to forward.
- `AuditEventType` goes from nine values to ten. `AuditOutcome` goes from five
  values to six with `interrupted`; a host that persists events under a closed
  schema of its own adds the value.
- A turn can end `audit_unavailable`. Turn error codes are open strings, so no
  schema moves; a host that retried every `runtime_failed` should read
  `retryable` on this ending instead.
- Audit volume rises by roughly one event per turn plus one per envelope-refused
  call. Envelope refusals are bounded by `maxToolCalls`, which the host set.
- **`assembleExecutionRecord` must change or it will double-count.** Its
  `envelopeOperations` synthesizes operation records from `tool.completed`
  events precisely because those calls are ones "audit never saw". Once audit
  sees them, the same refusal arrives from both sources. This is the most likely
  silent regression in the change and the conformance record is where it would
  surface, as inflated attempt counts in every column.
- The conformance judge's version moves, and the case-set and world-set hashes
  with it, so every cell in the committed manifest is recomputed.
- The 2026-09-17 revision is a breaking change to a shape that shipped in
  0.1.0-alpha.4. A host that persists audit under a closed schema adds five
  optional fields. A reader of `metadata.source`, `metadata.cause`,
  `metadata.failClosed`, `metadata.consumed` or `metadata.endedBy` reads the
  field of the same name, and a reader of `metadata.source` on `turn.ended` reads
  nothing, because nothing was being said. A trail written before the change
  shows no `failClosed` field on its old events; a host whose report spans both
  filters on both for as long as the old events are in its window.
- That revision does not move the conformance record. `OperationRecord.source`
  and `failClosed` and `DecisionRecord.failClosed` hold the same values, read
  from the event rather than compared or re-derived, and no manifest hash covers
  audit metadata.
- `docs/errors.md` keeps its rule that a new top-level field is a contract
  change. The revision is that change, recorded once, and the rule it adds
  narrows when the next is needed: a fact SharedOS states on every event of a
  kind is a field from the start.

## Rejected alternatives

**Answer an audit outage with a typed refusal and let the turn go on.** Rejected.
Every later decision in the turn fails its record too, a model retries a
refusal, and the ending the host most needs to see is buried in tool results.

**Record a stopped operation as `failed` with a reason.** Rejected. `failed`
already covers refusals where nothing ran, so the outcome a host filters on would
say "safe to retry" about the one call where that is least known.

**Give the envelope its own `AuditSink` option.** Rejected; see above. Two
places to pass one sink, and the failure mode of missing the second is silent.

**Five `turn.*` event types.** Rejected. Volume without information, and it
double-counts admission denials against `authorization.checked`.

**Put the specific cause in `reason` instead of `cause`.** Rejected. It
breaks the correspondence between the audit code and the code the caller was
given, which is what makes the two streams comparable, and it would split one
refusal into four codes that ADR 0012 deliberately unified.

**Emit `authorization.checked` for every `tool_unavailable`.** Rejected for the
not-registered case: there is no resource to have checked and no decision was
made. Recording one would put a decision in the trail that never happened, which
is the same defect as recording `no_matching_grant` for a withheld grant.

**One audit event per withheld tool at discovery.** Rejected on volume, above.

**One `{ tool, cause }` per withheld tool inside the listing event.** The shape
this decision first took, replaced before release. It still grew with the
registry on every turn, and what it bought — the name and cause of each withheld
tool — is recoverable from the registry and the identifiers when a reader needs
it, and is recorded on `tool.invoked` the moment a withheld tool is called.

**Leave the event stream as the record and tell hosts to read it.** Rejected. It
is a required field on `ExecutionResult`, so hosts already pay for it on the
wire, and no production consumer in this repository reads it. Directing hosts to
a channel whose only readers are the conformance package would document the gap
rather than close it.

**Keep the kernel's facts in `metadata` and keep stripping a port's keys.** What
first shipped, and it worked. It leaves every reader parsing an untyped object
for facts the kernel knows the type of, leaves the next kernel-stated flag to be
remembered in the strip or forged, and leaves `source` with two meanings.

**Write both the field and the key for one release.** It keeps the strip, the
string-checking helper and the second derivation alive for exactly the release
meant to delete them, and a reader that has not migrated is no safer for it: the
key it reads is the one a port can still write.

**Promote every kernel-stated key.** `grantIds`, `catalogHash`, `withheldCount`
and the rest are the kernel's too. Each belongs to one event type, so promoting
them makes `AuditEvent` a union discriminated on `type`, a larger break with one
in-repo reader to show for it. The line is the facts shared across event types
or that a port's metadata can sit beside.

**Bump `AuditEvent.version`.** The alpha line records breaking changes in the
changelog and has not versioned a shape for one, and a `"2"` would have to be
threaded through every sink a host wrote against the literal.

**Route every audit write through the path that swallows a failure.** One path
instead of two, and a tool could then run on a decision that was never recorded.
