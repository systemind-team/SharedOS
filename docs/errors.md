# Reason and error codes

Every refusal in SharedOS is a code, not a thrown exception. This page is what
each one means and what to do about it.

## Denied is not failed

Three statuses appear across `ToolResult`, `ResourceResult`, and
`ExecutionResult`:

| Status      | Meaning                                            | Retry?                    |
| ----------- | -------------------------------------------------- | ------------------------- |
| `succeeded` | It happened                                        | —                         |
| `denied`    | Authorization refused it. Nothing ran              | No — change the grant     |
| `failed`    | It was allowed, and something broke while doing it | Maybe — check `retryable` |

`MessageDeliveryResult` has the same `denied` and `failed`, and says `accepted`
or `delivered` where the others say `succeeded`. `ExecutionResult` adds `cancelled` for a deadline or host cancellation, and
`escalated` for a turn that stopped and asked for a human. An escalated result
carries an `escalation`, not an `error`: a denial is a decision SharedOS made,
and an escalation is one it declined to make. Counting them together inflates
every denial rate by the cases where the system correctly asked.

Over HTTP a denial is a **200**, like a success or a failure; the one exception
is a message the transport `accepted` for later delivery, which is **202**. A `403` means the request never reached the
kernel's decision. Client code that only checks the HTTP status will read
denials as successes.

## Authorization reason codes

`AuthorizationDecision.reasonCode`, and the `reason` field on
`authorization.checked` audit events.

| Code                          | Means                                                                                                  | Fix                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `allowed`                     | A grant matched                                                                                        | —                                                      |
| `no_matching_grant`           | Nothing the `GrantSource` returned covers this resource and action                                     | See the checklist below                                |
| `grant_exhausted`             | A matching grant exists but its `maxUses` is spent                                                     | Issue a new grant; usage is not resettable             |
| `host_policy_denied`          | A grant matched and the host ceiling overrode it                                                       | Product or organization policy, not authority          |
| `invalid_context`             | The `AccessContext` failed its schema                                                                  | A host bug. Build the context server-side              |
| `invalid_request`             | The resource or action failed its schema, or names another world                                       | Check path segments, action naming, and the owner      |
| `authority_unavailable`       | The `GrantSource` threw, or answered with unusable material                                            | Fail-closed. See the authority table below             |
| `usage_store_unavailable`     | The grant has `maxUses` and there is no `usageStore`, or it threw                                      | Supply `CapabilityAuthorizer({ usageStore })`          |
| `delegation_chain_unverified` | The chain could not be established at all                                                              | Supply `CapabilityAuthorizer({ delegationResolver })`  |
| `delegation_chain_invalid`    | The chain resolved and broke a rule — often a revoked ancestor                                         | Usually working as intended — upstream authority ended |
| `host_policy_unavailable`     | The host ceiling threw, answered with a decision it was not shown, or the turn's `PolicySource` failed | Fail-closed. A ceiling may only narrow                 |

Four of these are SharedOS failing to establish a fact rather than a policy
decision: `authority_unavailable`, `usage_store_unavailable`,
`delegation_chain_unverified`, and `host_policy_unavailable`. They are named once,
in `INFRASTRUCTURE_DENIAL_REASONS`, and their audit records carry
`failClosed: true`. Exclude them before computing any denial rate.
`delegation_chain_invalid` is **not** among them: a chain that resolved and broke
a rule is a real answer about authority, not a failure to get one.

`host_policy_denied` is the opposite case and is kept apart from
`no_matching_grant` for the reason the separation exists at all: "nobody
authorized this" and "a grant authorized this and our own policy overrode it"
are different facts about a deployment, and a host that expressed the second by
withholding the grant made the kernel assert the first. It is not marked
`failClosed` — a deliberate refusal is not an outage — and it carries the
`grantId` it overrode, so the two are countable separately (ADR 0020).

Two of them are usually not faults at all but omissions, and say so:
`usage_store_unavailable` and `delegation_chain_unverified` add
`missingDependency: "usageStore" | "delegationResolver"` to the audit record when
the authorizer was built without the port the grant needed. A `maxUses` grant
with no `usageStore`, or a derived grant with no `delegationResolver`, denies
every time and looks exactly like a permission problem. It is a wiring problem;
see [host integration](host-integration.md#ports-a-grant-can-need).

`authority_unavailable` collapses four situations on purpose, so that no caller
can tell a broken store from a rejected one:

| Situation                                               | Internal code            |
| ------------------------------------------------------- | ------------------------ |
| the source threw                                        | `grant_source_failed`    |
| a grant does not satisfy `CapabilityGrantSchema`        | `invalid_grant_material` |
| a grant is outside the context's namespace/actor/issuer | `grant_scope_mismatch`   |
| more grants than `MAX_RESOLVED_GRANTS`                  | `grant_limit_exceeded`   |

A source that answers with a superset fails closed rather than being quietly
filtered: pre-filtering to (namespace, actor, authority) is part of the
contract. Which of the three the grant broke, and which grant it was, is on the
`authority.resolved` audit event as `rejectedGrants` — the caller still sees one
code.

### When you get `no_matching_grant` and expected otherwise

Walk these in order. Every one of them produces the identical code.

1. **`context.authority` does not equal `grant.issuer`.** The most common cause.
   `authority` is _whose grants are being exercised_, not who owns the data. For
   a grant Alice issued it is Alice; for a grant Bob derived from it, it is Bob.
2. **`context.actor` does not equal `grant.subject`.** The grant was issued to
   someone else.
3. **`context.purpose` is not in `constraints.purposes`.** Purpose is matched
   exactly, not by prefix.
4. **`context.now` is outside `notBefore` / `expiresAt`.**
5. **`namespaceId` differs.** Grants never cross worlds or tenants.
6. **The path is not covered.** `scope: "exact"` matches only that path.
   `scope: "descendants"` matches the path and below — and segments are compared
   as segments, so `cell-3` never covers `cell-30`.
7. **The action is not listed.** Actions are matched literally, with one
   exception: a grant whose `actions` contains the literal `"*"` covers every
   action on its resource. Nothing else expands — `snapshot:*` is an ordinary
   string that matches nothing — and `"*"` in a _request_ matches only a grant
   that lists it.
8. **A `grantVerifier` returned false or threw.** A throw is treated as false.
9. **The capability is spread across grants.** One requirement must be satisfied
   by one grant. Path from one and action from another is refused deliberately.

**You do not have to walk the list by hand.** The reason code is the same for
all nine because a caller may not learn which one it was; the host may. Every
denial records a `rejectedGrants` array on its `authorization.checked` audit
event, naming each resolved grant and the first condition it failed:

```text
authorization.checked  denied  files/Work/Finance  no_matching_grant
  grantsResolved: 2
  rejectedGrants: [ { grantId: "grant-17", reason: "issuer" },
                    { grantId: "grant-19", reason: "capability" } ]
```

`reason` is one of `issuer`, `subject`, `namespace`, `window`, `purpose`,
`verifier`, `capability`, `delegation`, or `exhausted`. `grantsResolved: 0` with
no rejections is a different fault from every grant being rejected: the store
returned nothing for this context at all.

Three of the nine — `namespace`, `subject`, and `issuer` — are checked earlier,
when authority is resolved, and refuse the whole set rather than one grant. Those
appear on the `authority.resolved` event instead, under the same key, beside
`authority: "grant_scope_mismatch"`.

### The denial says which capability it wanted

A `no_matching_grant` decision carries `requiredAuthority`: a
`CapabilityRequest` naming the exact resource and action that would have
satisfied it, with the requester, owner, namespace, and purpose from the context
that asked. It is what a consent workflow needs in order to issue a grant on one
action rather than parse a sentence, and `SharedOSKernel.recordEscalation`
accepts it so an escalation carries it to whoever resolves it.

It is a description and nothing else. It grants nothing, no port accepts one as
input, `allowed` stays `false`, and a host that ignores it sees no change. Its
`id` is derived from the fields rather than random, so the same missing
authority has the same identifier every time it is described.

Three things it is deliberately not:

- **Not on any other denial.** `grant_exhausted` names a grant that exists,
  `host_policy_denied` names one that exists and was overridden, and the
  infrastructure denials name a fact SharedOS could not establish. Issuing a
  grant is not the remedy for any of them.
- **Not on discovery.** `canDiscover` is asked about a tool's declared
  capability, which may be a broader ceiling than any call. A description there
  would name more authority than an operation needed.
- **Not an existence oracle.** It restates the request and the caller's own
  context. It does not say whether the path exists, whether a grant for it
  exists, or who holds one.

## `tool_unavailable` covers three different situations

`kernel.invokeTool` returns `denied` with `tool_unavailable` — and the same
message — when the tool is not registered for this context, when its namespace
is disabled, _and_ when no grant makes it discoverable. That is deliberate: the
caller learns it cannot use the tool, not which of the three reasons applies.

**The specific reason is in the audit trail**, on the `tool.invoked` event
itself, as `cause`:

```text
tool.invoked  denied  files.read  <- tool_unavailable, cause: namespace_disabled
```

`cause` is one of `not_registered`, `namespace_disabled`, the reason code the
discovery check returned (`no_matching_grant`, `host_policy_denied`, or a
fail-closed code), or — from the execution envelope — `not_offered`, a tool name
the turn's catalogue never held. A `messages.request` the transport refused
carries the transport's code the same way: the caller is told
`message_request_not_accepted`, and `cause` says what the transport answered. `reason` stays the code the caller was given, so
the audit code and the wire code remain comparable and one refusal keeps one
name (ADR 0012).

Where the refusal came from a decision, an `authorization.checked` event is also
recorded immediately before, carries the same reason, and carries the call's id
as `operationId`, so the two records join on the id rather than on their order
in the sink. That decision carries the same account as any other denial:
`grantsResolved`, `rejectedGrants`, and `missingDependency` where a port was
never wired. A tool whose only grant is bounded is refused here when there is no
`usageStore`, before `authorize` is reached, so this is the record that says so.
Listing a catalogue runs the same check on every tool and records no account
for any of them. Two of the situations produce no decision — nothing was checked when the tool is not registered, and
nothing was checked when its namespace is off — so `cause` is what makes the
disambiguation hold for all of them rather than for the one that happens to
consult the authorizer.

If you are debugging a `tool_unavailable` and have no audit sink wired, wire one
first.

**Both boundaries use this one code.** The execution envelope refuses a tool
outside the turn's permission-filtered catalogue with `tool_unavailable`, the
same code the kernel uses. Which boundary refused is recorded separately, as
`source` on the audit event and as `OperationRecord.source` in a
conformance record: a code says what was refused, a source says who refused it.
The earlier `tool_not_available` is gone rather than aliased — two names for one
refusal is the defect.

An owner-crossing requirement is the other pair worth keeping apart:
`invalid_request` is a denial, checked before the tool's declared ceiling and
answered by the authorizer, so it produces an authorization decision;
`invalid_tool_requirement` says the tool misbehaved, not that the request was
impermissible.

### Naming the gate a refusal came from

Every field above is already on the record. What a host reading a denied
`ToolResult` still had to do by hand was join it to those records and decide
which check refused: a `tool_unavailable` whose `cause` is `not_registered` is a
registration problem, one whose `cause` is `host_policy_denied` is a policy
problem, and one whose `cause` is `no_matching_grant` is the only one a grant
fixes. `@aicoo/sharedos-core` does both:

```ts
import { classifyRefusal, explainRefusal } from "@aicoo/sharedos-core";

// `events` is whatever your AuditSink retained; the testkit's
// InMemoryAuditSink keeps them on `.events`.
const result = await kernel.invokeTool(context, call);
if (result.status === "denied") {
  const explained = explainRefusal(result, events);
  explained?.gate; // "registration" | "request" | "infrastructure" | "ceiling" | "grant" | "envelope"
  explained?.cause; // cause on the tool.invoked record
  explained?.decision?.metadata; // rejectedGrants, grantsResolved, missingDependency
}
```

`classifyRefusal(event)` names the gate for one denied audit event, and
`explainRefusal(result, events)` finds the event for a result and names it. Both
return facts the kernel recorded and no prose: what each gate means and what
fixes it is the table below, and a sentence copied into a return value is a
sentence that drifts.

| Gate             | It was refused because                                                                  | Fix                                                                |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `envelope`       | The turn's catalogue never offered the tool, a budget is spent, or the turn is draining | The model guessed a name, the turn is over-budget, or it is ending |
| `registration`   | No such tool for this context, or its namespace is off                                  | `registerTool`, or enable the namespace                            |
| `request`        | The call or context is malformed, or names another world                                | A host bug. Fix the caller                                         |
| `infrastructure` | SharedOS could not establish a fact and failed closed                                   | Wire the missing port, or fix the store that threw                 |
| `ceiling`        | A grant authorized it and host policy overrode it                                       | Product or organization policy. A grant will not help              |
| `grant`          | Nothing the source returned covers it, or what covers it is spent                       | Issue a grant. `rejectedGrants` says why each one failed           |

The classifier reads the record in the order the checks ran: `source` first,
because the envelope refuses before the kernel is asked; `cause` next, because the kernel refuses an unregistered or disabled tool before
consulting the authorizer; then `failClosed` and the code. It returns
`undefined` for a code it does not know rather than filing it under a gate it
may not belong to.

**The join is on `operationId`, never on recency.** The kernel and the envelope
both stamp it with the call's id. Two turns interleaved on one sink put another
call's refusal last, and a reader that takes the most recent `tool.invoked`
explains the wrong denial with the right code.

**None of this goes back to the caller.** The gate, the cause, and the rejected
grants are host-side facts the coarse code exists to withhold. A host that
appends them to a denied `ToolResult`, or narrates them to the model "to help
it", has handed the caller the permission-topology oracle ADR 0012 refuses to
be. Log them, alert on them, put them in an operator console; do not put them
on the wire.

## Tool invocation

| Code                                 | Status | Means                                                                                                                                                 |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_unavailable`                   | denied | Not registered, namespace off, or not discoverable — see above                                                                                        |
| `no_matching_grant`                  | denied | The exact argument-selected resource is not authorized                                                                                                |
| `invalid_request`                    | denied | The resolved requirement names a world other than the caller's own                                                                                    |
| `invalid_tool_arguments`             | failed | `parseArguments` rejected the call. The thrown error goes to `onProviderError` and nowhere else (below)                                               |
| `invalid_tool_requirement`           | failed | `resolveRequirement` returned something outside the declared ceiling                                                                                  |
| `tool_requirement_resolution_failed` | failed | `resolveRequirement` threw. The thrown error goes to `onProviderError` and nowhere else (below)                                                       |
| `tool_catalog_unavailable`           | failed | A `ContextToolProvider` threw. The catalog is never partially returned. The thrown error goes to `onProviderError` and nowhere else (below)           |
| `tool_execution_failed`              | failed | Your `invoke` threw. The thrown error goes to `onProviderError` and nowhere else (below)                                                              |
| `invalid_tool_result`                | failed | Your handler returned something that is not a `ToolResult`                                                                                            |
| `escalation_not_terminated`          | failed | `sharedos.escalate` reached its handler: the runtime passed the call on instead of ending the turn on it. See [tools](tools.md#kernel-supplied-tools) |
| `trace_mismatch`                     | denied | `call.traceId` does not match the context                                                                                                             |
| `step_limit_exceeded`                | denied | The call names a step at or past the envelope's `maxSteps`. This call is refused; the turn continues                                                  |
| `tool_call_limit_exceeded`           | denied | The envelope's `maxToolCalls` is spent. This call is refused; the turn continues                                                                      |
| `turn_draining`                      | denied | The turn is inside its `drainGraceMs`, or ending on an audit outage, and takes no new calls. Nothing ran; calls already running still answer          |

A budget refuses a call; it does not end a turn. The envelope answers the call
that crosses `maxSteps` or `maxToolCalls` with `denied`, the runtime receives an
ordinary tool result, and the turn may still complete. The one budget that ends
a turn is the standard loop's own: a driver that is still asking for tools
when the loop's last step is spent fails the turn with `step_limit_exceeded`
(see [turns](#turns)). Which boundary refused is `OperationRecord.source`, as
for `tool_unavailable`.

## Resources

| Code                          | Status | Means                                                                                          |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `resource_provider_not_found` | failed | No provider registered for that namespace                                                      |
| `resource_execution_failed`   | failed | Your provider threw. The thrown error goes to `onProviderError` and nowhere else (below)       |
| `invalid_resource_result`     | failed | Your provider returned a malformed `ResourceResult`, or one whose `operationId` does not match |

## Messages

| Code                                    | Status | Means                                                                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `message_transport_not_configured`      | failed | No `messageTransport` was supplied to the kernel                                                                         |
| `message_context_mismatch`              | denied | The envelope's sender, purpose, or trace disagrees with the context                                                      |
| `message_requirement_resolution_failed` | failed | The capability resolver threw. The thrown error goes to `onProviderError` and nowhere else (below)                       |
| `message_delivery_failed`               | failed | Your transport threw. The thrown error goes to `onProviderError` and nowhere else (below)                                |
| `invalid_message_receipt`               | failed | Your transport returned a malformed delivery result                                                                      |
| `message_request_not_prepared`          | failed | The request tool did not prepare the authorized call                                                                     |
| `message_request_not_accepted`          | failed | The transport did not accept the request                                                                                 |
| `message_reply_resolution_failed`       | failed | The host router could not resolve the durable reply. The thrown error goes to `onProviderError` and nowhere else (below) |
| `invalid_message_reply`                 | failed | The resolved reply did not preserve request context                                                                      |

## Turns

| Code                       | Status    | Means                                                                                                                                                                                                                                            |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actor_mismatch`           | denied    | The turn's agent is not the admitted one                                                                                                                                                                                                         |
| `receiver_mismatch`        | denied    | The delivered message's receiver is not the executing agent                                                                                                                                                                                      |
| `message_context_mismatch` | denied    | The delivered message's trace or purpose disagrees with the context                                                                                                                                                                              |
| `execution_in_progress`    | denied    | A turn under this `executionId` is still running. Nothing was loaded or run; wait for it, or use a new id                                                                                                                                        |
| `no_matching_grant`        | denied    | No `sharedos.execution` / `invoke` grant for the target agent                                                                                                                                                                                    |
| `escalation_requested`     | escalated | The runtime stopped and asked for a human. Nothing was granted                                                                                                                                                                                   |
| `step_limit_exceeded`      | failed    | The standard loop spent its own steps while the driver was still asking for tools. The envelope's budgets refuse calls instead — see [tool invocation](#tool-invocation)                                                                         |
| `driver_failed`            | failed    | Your `AgentTurnDriver` threw. The thrown error goes to `onTurnError` and nowhere else (below)                                                                                                                                                    |
| `invalid_driver_decision`  | failed    | The driver returned something that is not a valid decision                                                                                                                                                                                       |
| `runtime_failed`           | failed    | A `RuntimePlugin` threw, or a host port the turn body called did. The message is fixed and the thrown error goes nowhere near the wire — install `onTurnError` to see it (below)                                                                 |
| `invalid_runtime_outcome`  | failed    | A plugin returned a malformed outcome                                                                                                                                                                                                            |
| `tool_unavailable`         | failed    | A plugin returned `escalate` on a turn whose catalogue does not offer `sharedos.escalate`. The envelope refuses the outcome as it refuses a call outside the catalogue, under the same code (ADR 0017); the turn's `turn.ended` event carries it |
| `audit_unavailable`        | failed    | The audit sink could not record a decision, so the envelope ended the turn. `retryable` is `true` only when nothing the turn asked for can have taken effect; the sink's error goes to `onTurnError` (below)                                     |
| `turn_cancelled`           | cancelled | Deadline expired, or the host aborted. With a `drainGraceMs` the turn stops taking calls that long before its deadline and ends once the calls in flight have answered (below)                                                                   |

### Before you retry a turn

Read `retryable` on the result, whatever the code. It says whether running the
turn again repeats anything, and the envelope decides it for `turn_cancelled`,
`runtime_failed` and `audit_unavailable`, and caps it for a failure a plugin
reported itself. It is `false` once a call to a `write` tool that is not declared
`idempotent` came back anything but `denied`, or was still with the kernel when
the turn ended: that call may have taken effect, and a second run would do it
again. Calls to `read` tools never count, so a turn that only searched and ran
out of time is still `retryable: true`.

The rule rests on your tool definitions. Declare a tool `read` only if running
it twice changes nothing, and mark a `write` `idempotent` only if the second run
is a no-op; when in doubt leave it a plain `write`. Until this rule the two
envelope endings said `true` unconditionally, so a host that retried every
`turn_cancelled` will now be told not to after a transfer.

### A deadline that lets handlers finish

`SharedOSExecutor`'s `drainGraceMs` takes time from the end of `timeoutMs`, never
adds to it. With 120 000 and 5 000, a call asked for after 115 s is refused
`turn_draining`, a handler running then is not signalled and answers with its
real outcome, and the abort reaches whatever is still running at 120 s, which is
recorded `interrupted`. An audit outage drains the same way for the grace or the
time left. Your own `signal` does not: aborting it stops the turn at once.

The model is not asked about a result that arrives during the grace, and the
turn ends once it has. The call's id, tool and status are in the turn's `events`
as `tool.completed` and its outcome is in the audit trail. SharedOS keeps no
history between turns, so if you carry a conversation forward, record the call
from those events before the next turn, or its model may ask for it again.

## Diagnosing a contained throw

Every code in this document is a bounded fact: it says an operation stopped and
does not say why. That is deliberate. A `ProtocolError.message` reaches the
model, an `ExecutionEvent` reaches an `ExecutionRecord` that travels further than
an audit sink, and audit has never carried call data — while a thrown message
may hold arguments, rows, or credentials the thrower had in scope.

So the error itself goes to a host-side sink instead, whole and unwrapped. There
are two, one per layer that contains a throw, and neither changes anything a
caller can see.

**`SharedOSKernelOptions.onProviderError`** — a provider, tool handler,
transport, or router threw, and the kernel answered with a reason code:

```ts
new SharedOSKernel({
  grantSource,
  onProviderError: (error, op) =>
    logger.error({ err: error, ...op }, `${op.kind} port failed: ${op.reasonCode}`),
});
```

One hook covers every such port. `op.kind` is `"tool"`, `"tool_catalog"`,
`"resource"`, or `"message"`, so a host that wants to route a transport failure
differently branches on it — and a port added later reaches the hook already
installed. `op.reasonCode` is the code the kernel returned in its place and the
one the matching audit event carries under `reason`, so a log line joins to
audit without correlating on timing. It is usually also what the agent was told;
the exception is a transport failure under the message-request tool, where audit
records `message_delivery_failed` and the tool result says
`message_request_not_accepted`. Both carry the same `operationId`.

`kind` follows the entry point rather than the port where the two differ: a
`MessageCapabilityResolver` that throws is `message` under `sendMessage` and
`tool` under the message-request tool, which is a tool call resolving its
requirement. Match on `reasonCode` to watch one port.

The error arrives as thrown, with one exception: when a `ContextToolProvider`'s
`listTools` throws, the kernel replaces it with one catalogue-failure sentence
every caller can match on, and the provider's error survives as that wrapper's
`cause`. A `tool_catalog` report from another origin — a returned handler the
registry refuses, which throws a named `DuplicateRegistrationError` or
`TypeError` a caller can branch on — carries that error unwrapped and has no
`cause`. Log `error` and let a formatter walk it.

The same provider failure reaches a different hook depending on who asked. A
throw from `listTools` during a turn is contained by the execution envelope as
`runtime_failed` and reported to `onTurnError`, because the turn body calls
`listTools` itself; only a call made through `invokeTool` reaches
`onProviderError` as `tool_catalog_unavailable`.

**`SharedOSExecutorOptions.onTurnError`** — a turn ended on a throw:

```ts
new SharedOSExecutor(kernel, plugin, {
  onTurnError: (error, { executionId, traceId }) =>
    logger.error({ err: error, executionId, traceId }, "turn ended on a throw"),
});
```

The standard loop takes the same option, because only one of the two catches any
given throw: a driver's becomes the loop's cooperative `driver_failed` outcome,
which the envelope never sees as an exception, and the executor catches
everything else as `runtime_failed`. Install one sink in both options and it
covers both.

`createMcpHarnessRuntime` takes no such option: a harness's failures end the turn
through the envelope, whose reporter already covers them. Stating a fact for the
record through `RuntimeHost.annotate` reaches neither sink, because it never
refuses on the state of the host and so has nothing to report.

Read the stack. `runtime_failed` is also what a throw from `openTurnAuthority`,
`admitTurn`, or `listTools` ends a turn as, so the code alone does not say
whether the plugin or one of your own ports failed; the stack does.

One throw is named rather than folded in: an audit sink that fails on a record
written before an effect. The kernel rejects with an `AuditUnavailableError`
whose `cause` is what your sink threw, and the envelope ends the turn
`audit_unavailable` by its own decision -- a plugin that catches the rejection
does not keep the turn going. `onTurnError` receives the error. Read `retryable`
on the result before trying the turn again, as for any ending (above).

Both hooks are observational and synchronous. One that throws is ignored, a
component with none installed behaves identically, and neither is awaited —
unlike `onAuditError`, which fires after the side effect where there is nothing
left to hold up, these fire mid-flight with a result still to construct. A
cancelled operation is not reported: every site that awaits a host port re-throws
the abort ahead of the containment, and the three that do not — an argument
parser, a requirement resolver, a message capability resolver — wrap synchronous
code that is never handed the signal, so an abort cannot be what made them throw.
A caller that stopped the work is not a defect.

`HostCeiling` reports through the same shape, but from
`CapabilityAuthorizerOptions.onProviderError` rather than the kernel's: the
ceiling is installed on the authorizer, so the kernel's hook cannot reach it. A
host wanting both passes one function to both. Its reports carry
`kind: "policy"` and `reasonCode: "host_policy_unavailable"`. A `PolicySource`
that throws reports the same `kind` and `reasonCode` through the kernel's hook,
once per turn at the boundary rather than once per decision it fails, and with
no resource or action, because no operation had started.

Still uncovered: the four authority ports discard a throw the same way, and they
are not equally bad. `GrantSource`, `GrantUsageStore`, and
`DelegationChainResolver` at least fail closed under their own codes —
`authority_unavailable`, `usage_store_unavailable`,
`delegation_chain_unverified`, each marked `failClosed` — so the failure is
classified even though the cause is gone.

`CapabilityGrantVerifier` is the one to watch. A throw from `verify` is treated
as `false` (reason 8 under
[`no_matching_grant`](#when-you-get-no_matching_grant-and-expected-otherwise)), so
the grant becomes invisible and the denial reads `no_matching_grant` — not a
`failClosed` code, and indistinguishable from an actor who was simply never
granted the capability. A broken verifier looks exactly like correct enforcement.

## Adapters and the MCP harness path

Codes from `@aicoo/sharedos-adapters`. The `harness_*` and `model_*` codes are
how a driver or plugin ends its turn, so they surface as a `failed`
`ExecutionResult`; `escalation_pending` is a tool result on the MCP path.

| Code                                                                                                                        | Status | Means                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `escalation_pending`                                                                                                        | denied | A `tools/call` made after the turn asked for a human. The bridge refuses it in band and nothing further runs on that turn (ADR 0018). An agent without the escalation grant gets `tool_unavailable`                                                                      |
| `harness_not_started`                                                                                                       | failed | The vendor CLI could not be spawned                                                                                                                                                                                                                                      |
| `harness_exited_without_outcome`                                                                                            | failed | The CLI exited non-zero without a terminal frame                                                                                                                                                                                                                         |
| `harness_ended_without_outcome`                                                                                             | failed | The harness closed its channel before completing the turn                                                                                                                                                                                                                |
| `harness_frame_limit_exceeded`                                                                                              | failed | Too many frames without an outcome (`maxIgnoredFrames`)                                                                                                                                                                                                                  |
| `harness_arguments_unparseable`                                                                                             | failed | Codex or DeepSeek Harness sent tool arguments that are not a JSON object                                                                                                                                                                                                 |
| `harness_command_rejected`                                                                                                  | failed | Pi rejected a command. Retryable                                                                                                                                                                                                                                         |
| `harness_failed`                                                                                                            | failed | The harness reported its own failure. Retryable; Codex and Claude Code substitute the vendor's own code when the frame names one. The Codex CLI's `turn.failed` names none, so it keeps this code with the CLI's message                                                 |
| `harness_turn_aborted`, `harness_turn_blocked`, `harness_turn_error`, `harness_turn_max_tokens`, `harness_turn_interrupted` | failed | DeepSeek Harness ended its turn without completing it, for the reason the code names. Retryable; the vendor's own code is substituted when the frame names one, and DeepSeek never reports `harness_failed`                                                              |
| `model_call_failed`                                                                                                         | failed | `StandardTurnDriver`'s provider call threw, other than by cancellation                                                                                                                                                                                                   |
| `model_output_truncated`                                                                                                    | failed | The provider cut `StandardTurnDriver`'s reply at the output-token ceiling (`finish_reason: length`). Nothing in a cut-off reply is a decision the model finished making, so none of it is released                                                                       |
| `model_malformed_call_limit_exceeded`                                                                                       | failed | The model made more than `maxMalformedCalls` (default 8) calls whose arguments were not a JSON object. Each was refused in place as `invalid_tool_arguments` and answered back to the model, never sent as `{}`; the turn's metadata counts them as `malformedToolCalls` |

## HTTP

| Status | Code                     | Means                                           |
| ------ | ------------------------ | ----------------------------------------------- |
| 400    | `invalid_json`           | Body is not JSON                                |
| 400    | `invalid_request`        | Body does not match the v1 contract             |
| 403    | `permission_denied`      | An error carrying that code reached the handler |
| 404    | `not_found`              | Unknown path                                    |
| 405    | `method_not_allowed`     | Wrong verb                                      |
| 500    | `invalid_access_context` | `resolveContext` returned an invalid context    |
| 500    | `internal_error`         | Anything else; details never leak               |

`resolveContext` answers with a status and code of its own by throwing
`SharedOSHttpError(status, code, message)`, which is how a failed authentication
becomes a `401`; a plain `Error` thrown there is a `500`. `SharedOSClientError`
carries the handler's code, or one of two the client raises itself:
`invalid_response` for an answer that is not JSON or fails the route's schema, and
`request_failed` for a non-2xx answer with no error body.

## Delegation

Delegation has two boundaries and each has its own vocabulary. `deriveGrant`
refuses to **issue**; the chain check refuses to **honour**. A host that hits the
first has a bug in what it is trying to hand out; a host that hits the second
has a grant that was fine when written and is not fine now.

### Refused at issue — `deriveGrant`

`deriveGrant` returns `{ ok: false, reason }` rather than clamping — a silently
narrowed delegation reads as accepted, and the delegator then believes it passed
on more than it did.

| Reason                         | Means                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty_capabilities`           | Nothing was actually delegated                                                                                                                                    |
| `id_collides_with_parent`      | The derived grant reuses the parent's id                                                                                                                          |
| `parent_not_delegable`         | The parent has no `delegationDepth`, or it is already zero                                                                                                        |
| `depth_exhausted`              | The child asked for a longer chain than was received                                                                                                              |
| `capability_not_within_parent` | Wider or sibling path, an unheld action, an exact parent widened into a subtree, an owner pinned onto an unowned parent, or one capability assembled from several |
| `purpose_not_within_parent`    | A purpose the parent does not carry                                                                                                                               |
| `window_not_within_parent`     | A validity window outside the parent's                                                                                                                            |
| `issued_before_parent`         | The child is dated earlier than the grant that authorized it                                                                                                      |
| `bounded_parent_not_delegable` | A `maxUses` parent. Sharing one budget across a chain needs cross-grant accounting, so it is refused rather than multiplied                                       |

### Refused at use — the chain check

Reported as `delegation_chain_invalid`, with the failing link's code and grant id
in `AuthorizationDecision.metadata`.

| Code                           | Means                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| `issuer_not_parent_subject`    | The child's issuer is not who the parent was issued to                  |
| `namespace_mismatch`           | Parent and child are in different worlds                                |
| `parent_inactive`              | An ancestor is revoked, expired, or out of purpose                      |
| `capability_widened`           | A child capability is not contained in one parent capability            |
| `constraints_widened`          | Window, purposes, or issue order widened — an omitted constraint counts |
| `delegation_not_permitted`     | The parent declares no delegation budget                                |
| `delegation_depth_exceeded`    | The child's budget is not strictly smaller                              |
| `bounded_parent_not_delegable` | The parent is bounded by `maxUses`                                      |
| `chain_cycle`                  | The chain leads back to a grant already walked                          |
| `chain_too_long`               | More links than `DEFAULT_MAX_DELEGATION_CHAIN_LENGTH`                   |

And as `delegation_chain_unverified`, when the chain could not be established at
all: `resolver_unavailable` (none installed), `parent_not_found`, or
`resolver_failed`. Unverified outranks invalid when several grants fail
differently, so an outage is never reported as a policy decision.

## Execution events

`ExecutionResult.events`, append-only and ordered by `sequence`.

| Type             | When                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `turn.started`   | Admission passed; the runtime is about to run                                                                                                                                        |
| `tool.requested` | The runtime asked for a call, before authorization                                                                                                                                   |
| `tool.completed` | Any outcome — succeeded, denied, or failed                                                                                                                                           |
| `runtime.event`  | A plugin's own event, wrapped rather than trusted                                                                                                                                    |
| `turn.completed` | The runtime finished                                                                                                                                                                 |
| `turn.escalated` | The runtime stopped and asked for a human; the result is `escalated`                                                                                                                 |
| `turn.failed`    | The turn ended in failure; `source` says who ended it — `envelope` (it refused the runtime's outcome, or the runtime threw) or `runtime` (a failure the runtime reported as its own) |
| `turn.denied`    | Admission or context validation refused the turn                                                                                                                                     |
| `turn.cancelled` | Deadline expired or the host cancelled                                                                                                                                               |

## Audit events

| Type                               | Outcomes                                       | When                                                                                                                                |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `authority.resolved`               | `succeeded`, `failed`                          | A turn loaded its authority, once; `failed` is fail-closed                                                                          |
| `authorization.checked`            | `allowed`, `denied`                            | One decision, before any tool, resource, message, or turn                                                                           |
| `escalation.requested`             | `escalated`                                    | A turn ended by asking for a human; nothing was granted                                                                             |
| `escalation.auto_decided`          | `allowed`, `denied`                            | An escalation was decided from precedent, without a human. Built by `@aicoo/sharedos-precedent`; the host's control plane writes it |
| `resource.invoked`                 | `succeeded`, `denied`, `failed`, `interrupted` | A direct resource operation                                                                                                         |
| `tool.invoked`                     | `succeeded`, `denied`, `failed`, `interrupted` | A tool call                                                                                                                         |
| `tool.catalog.listed`              | `succeeded`, `denied`                          | A catalogue was computed; `denied` is an empty one, fail-closed                                                                     |
| `tool.namespace.catalog.listed`    | `succeeded`                                    | The management-plane namespace catalogue was read                                                                                   |
| `tool.namespace.selection.updated` | `succeeded`                                    | A namespace patch was applied; a refused patch throws and writes nothing                                                            |
| `message.sent`                     | `succeeded`, `denied`, `failed`, `interrupted` | A message was delivered through the transport                                                                                       |
| `turn.ended`                       | `succeeded`, `denied`, `failed`, `escalated`   | One turn reached a terminal outcome, recorded by the envelope                                                                       |

`authority.resolved` opens a turn: a turn resolves authority once, and this is
the event that records which grants it resolved to. It carries `authorityHash`
and, in `metadata`, the `grantIds` and `grantCount` behind that hash — so every
later decision in the turn, which carries the same hash, can be traced back to
the exact authority set it was made against. A failure records
`authority_unavailable` and `failClosed`, because a source that could not answer
denies rather than widening.

`escalation.requested` is the audit record of a turn that stopped and asked a
human. Its outcome is `escalated`, which is deliberately not `denied`: a denial
is a decision SharedOS made, an escalation is one it declined to make. Counting
them together inflates every denial rate by the cases where the system correctly
asked for help.

Every event carries `version`, `id`, `type`, `outcome`, `at`, `traceId`,
`namespaceId`, `actor`, `authority`, `owner`, `purpose`, and where applicable
`resource`, `action`, `grantId`, `authorityHash`, `operationId`, `tool`,
`messageId`, `receiver`, `reason`, `source`, `cause`, `failClosed`, `consumed`,
`endedBy`, `requestedAuthority`, and `metadata`.

`id` is the record's own identity, minted when the event is made and never
derived from its content. `at` is the turn's instant, so every record of one
turn shares it, and a bare `authorize` names no `operationId`; the same question
asked twice in one turn is therefore two records that agree on every field but
`id`. A store that deduplicates keys on `id`. Keyed on a hash of the content, it
keeps one of the two and loses the other.

`turn.ended` is the execution envelope's one event, written at the terminal
through the kernel, which owns audit. It carries the turn's `executionId` as
`operationId` and the terminal code as `reason`. A cancelled turn is recorded
`failed` with reason `turn_cancelled` rather than adding an `AuditOutcome` of its
own: the outcome vocabulary is a compatibility surface, and `reason` already
separates a deadline from a defect. There is one event per turn, not one per transition —
a `turn.denied` would double-count against the `authorization.checked` that
admission already produced for the same refusal (ADR 0023).

`requestedAuthority` appears on `escalation.requested`, and only when the
escalation named a capability. The kernel minted it: its `id`, `namespaceId`,
`requester`, `owner`, and `requestedAt` come from the trusted context, not from
the caller, and the `id` is derived from the ask. It is the same payload a denial carries as
`requiredAuthority` — one concept in two roles: a denial says what was required,
and an escalation requests it. It is the `CapabilityRequest` a reviewer's queue is built from — a
top-level field rather than a `metadata` key because it is a contract type with
its own schema, and a consumer reading it should be reading that shape rather
than trusting an untyped bag to hold it (ADR 0019).

`authorityHash` names the exact authority set a decision was made against. A
turn resolves authority once, so the `authority.resolved` event that opened it
and every `authorization.checked` and `tool.catalog.listed` event inside it
carry the same value (ADR 0010); a consumer reconstructing a turn can pin every
decision to that one load.

What SharedOS itself states about an event is a field, typed by
`AuditEventSchema` in `@aicoo/sharedos-contracts`; `metadata` holds what a host
port supplied and the details particular to one event type (ADR 0023). Five
facts are fields:

| Field        | On                                                                        | Says                                                                                            |
| ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `source`     | `tool.invoked`, `resource.invoked`, `message.sent`, `tool.catalog.listed` | `kernel` or `envelope`: the boundary that performed or refused it. Never who recorded           |
| `cause`      | `tool.invoked`                                                            | Which situation a coarse `reason` stood in for                                                  |
| `failClosed` | any event that can record an outage                                       | Present and `true` when SharedOS could not establish a fact and refused rather than guess       |
| `consumed`   | `authorization.checked`                                                   | Whether a bounded use was spent                                                                 |
| `endedBy`    | `turn.ended`, on a failure                                                | `envelope` or `runtime`, so a reader crediting enforcement does not credit a plugin's own error |

`source` was free to infer until the envelope began recording — anything in
audit was the kernel's, because the envelope wrote nothing — and it exists so
closing that gap did not open an ambiguity in its place. A `turn.ended` carries
none: every turn ending is recorded by the envelope, so it would say nothing.

`metadata` keys a host may rely on: `authority.resolved` carries `grantIds` and
`grantCount` (or `authority`, the internal code, when it failed), and
`hostCeiling`, `"installed"` or `"absent"`, on both; `authorization.checked`
carries whatever the decision itself carried — a `HostCeiling`'s own keys, or
`delegation` detail on a broken chain — and the authorizer's account of a
denial; `tool.catalog.listed` carries `catalogHash`, `enabledNamespaces`,
`hostPolicyVersion`, and `withheldCount` (below), with `authority` when
authority itself could not load and the catalogue is empty; `tool.invoked`
carries the turn's `catalogHash`, whichever boundary answered the call, so a
`not_offered` refusal names the catalogue that did not offer the tool;
`escalation.requested` carries `detail` (the reason the runtime gave),
`reviewer`, `reviewerAssumed`, and `resolution`, and the execution it ended as
its `operationId`, which is what that turn's `turn.ended` carries. A port that
writes a key named `failClosed` has written a key in its own `metadata`: the
field is the kernel's, and nothing a port supplies can reach it.

A listing is recorded by what it was computed from, not by the names it
returned or withheld. `catalogHash` is the catalogue the caller was shown,
computed as `listPublishedTools` computes it, so an execution's manifest and the
audit record match on one identifier; `enabledNamespaces` is the caller's own
filter; `hostPolicyVersion` is the version the turn's `PolicySource` stated,
present only when one loaded; and `withheldCount` is how many registered tools
were not returned. With `authorityHash` at the top level, equal values on two
events mean the same catalogue for the same reasons, and the record does not
grow with the registry — a two-hundred-tool registry would otherwise write its
names to audit on every turn to say what one digest says once. What a count
cannot carry is the per-tool cause; `failClosed: true` keeps the one distinction
a reader cannot do without, that something was withheld by an outage rather than
by a decision, and an attempted call on a withheld tool is still recorded on
`tool.invoked` with its own `cause`.

This vocabulary is a compatibility surface. Hosts persist these events under
closed schemas of their own, so a new type, outcome, or top-level field is a
contract change to record here; a new `metadata` key or `reason` string is
not.

`interrupted` is the sixth outcome, on `tool.invoked`, `resource.invoked` and
`message.sent`. It is written for an operation whose port -- a tool handler, a
resource provider, a message transport -- was entered and stopped before it
answered, so **any part of its effect may have committed**. `reason` is
`operation_aborted` when the caller aborted (a turn's deadline, a cancellation,
a turn ended on an audit outage) and `audit_unavailable` when the port asked the
kernel for a decision that could not be recorded. Do not treat it as `failed`:
`failed` also covers refusals where nothing ran, and an interrupted transfer is
not safe to retry without checking what it did. A port that answers despite the
abort is recorded with its real outcome; a port that never answers writes
nothing, because there is no moment at which the kernel learns it stopped.

Wire `onAuditError` to alerting. A dropped audit write must not pass silently —
it is the only record that separates "was allowed to" from "did it and nobody
stopped it". It fires for the records written after an effect: an operation's
outcome, a turn's ending, an envelope refusal, an escalation. The caller still
receives the result it would have received, because a failure there would
invite a retry of something already done. The records written before an effect
— an authority load, a decision, a catalogue listing — do not reach it: a sink
that throws on one of those rejects the operation with an
`AuditUnavailableError`, nothing runs, and inside a turn the envelope ends the
turn `audit_unavailable`.

A sink that hangs is not a throw. Set `auditWriteTimeoutMs` on the kernel and a
record written after an effect that is still unanswered at the limit reaches
`onAuditError` with an `AuditWriteTimeoutError` (`code: "audit_write_timeout"`),
and the caller gets its result; the sink may still write the record later.
Without the option the result of a committed effect waits for the sink, and a
turn that reaches its deadline first loses it. Records written before an effect
are never limited.

## Contract limits

Rejected by the schemas, so they hold identically on both boundaries.

| Limit                       | Value                | Limit                  | Value         |
| --------------------------- | -------------------- | ---------------------- | ------------- |
| Turn timeout                | ≤ 600,000 ms         | Tool calls per turn    | ≤ 10,000      |
| Steps per turn              | ≤ 1,000              | Tools per request      | ≤ 512         |
| Path segments               | ≤ 64                 | Segment length         | ≤ 256 chars   |
| Capabilities per grant      | ≤ 64                 | Actions per capability | ≤ 64          |
| Purposes per grant          | ≤ 64                 | Purpose length         | ≤ 512 chars   |
| Delegation chain            | ≤ 16                 | Namespaces per catalog | ≤ 256         |
| Search query / grep pattern | ≤ 8,192 chars        | Search results         | ≤ 100         |
| Grep context                | ≤ 100 lines per side | Tool description       | ≤ 8,192 chars |

Path segments additionally reject separators, traversal markers, and control
characters. A filesystem-backed provider must **still** resolve beneath its own
root and reject link escapes — the contract cannot see your disk.

## Durable replay

Installing `SharedOSKernelOptions.replayStore` activates the replay state machine
in [ADR 0028](adr/0028-durable-operation-replay.md). Production storage belongs to
the host. Keep IDs stable across transport retries; use a new ID only for a new
intent after reconciling any ambiguous effect.

| Code                 | Meaning                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `replay_conflict`    | The tenant-scoped ID is already bound to different input or trusted context. Denied; do not reuse it.                                     |
| `replay_pending`     | Another worker owns the claim. Poll/retry the same ID for its retained result; never dispatch a replacement effect.                       |
| `replay_interrupted` | The outcome is ambiguous or the operation was interrupted. Reconcile through trusted host recovery.                                       |
| `replay_expired`     | The result body expired; the identity tombstone still prevents another effect.                                                            |
| `replay_unavailable` | Storage or its response could not be trusted. No effect starts without a claim; failure to persist a result after an effect is ambiguous. |

All replay refusals are non-retryable as new turns/effects. Pending requests can
be resubmitted with the same ID to retrieve the result. Except for conflict,
refusals use `failed` rather than `denied`, since a previous or concurrent effect
may already exist. Replayed terminal results preserve their original timestamps,
IDs, metadata and events. Replaying an execution does not stream new events.
