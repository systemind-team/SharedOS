[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-precedent

# @aicoo/sharedos-precedent

Admission rules for an auto-decision proposed from an owner's prior answers.

```bash
npm install @aicoo/sharedos-precedent
```

A **precedent** is a resolved escalation: the `CapabilityRequest` that was
asked, what the owner answered, and — when they approved — the width they
approved. Nothing new is stored to have one, and nothing is stored here: the
rows stay host-side behind `PrecedentLookup`, because a precedent is a record of
what one owner answered and SharedOS stores nothing.

The host proposes; this package admits. A matcher may be an exact key match,
Jaccard over tool names, embeddings, or a model trained on the host's own
history — this does not rank, score, learn, or improve. It answers one question
about a finished proposal, **may this be decided without a human?**, against
ADR 0022's four rules, and the proposal carries no similarity score, confidence,
or match type: a field the kernel is handed and must ignore is a field a host
will eventually expect it to honour.

```ts
import {
  admitAutoDecision,
  autoDecisionAuditEvent,
} from "@aicoo/sharedos-precedent";

const admission = await admitAutoDecision(
  {
    request, // the escalation now in front of the control plane
    citedRequestIds: matcher.cite(request), // however the host found them
    proposed: { allowed: true, capabilities: [oneNarrowCapability] },
    marker: { matcher: "jaccard-v3" },
  },
  precedentLookup,
);

if (admission.admitted) {
  await auditSink.record(autoDecisionAuditEvent(context, admission.decision));
  if (admission.decision.allowed) {
    await grants.issue({
      /* ... */
      capabilities: admission.decision.capabilities,
      constraints: admission.decision.constraints,
      metadata: admission.decision.metadata,
    });
  }
}
```

## What it decides, and what it never decides

A precedent decides whether to **ask**, never whether to **permit**. Nothing
here is an `AuthorizationDecision`, nothing returned is assignable to one, and
no port accepts one back as authority. An admitted allow _describes_ a grant for
the host's store to issue; the next turn loads it through `GrantSource` like any
other, and the turn that escalated stays ended. There is no consent queue, no
resumption, and no `pending` grant state.

That a denial cannot become an allow is structural rather than a rule:
`RefusedPrecedent` has no capabilities, so there is no width on a refusal for an
allow to read, and citing one in a proposed allow is inadmissible.

## The four rules

| rule   | what it holds                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | Fuzzy evidence may only narrow. `similar + deny` is admissible; `similar + allow` comes back `narrowed` and bounded by what this request asked for; full width needs an exact key match.          |
| **R2** | Never wider than the precedents cited, checked with `capabilityIsWithin` — the predicate the delegation chain already uses — once per precedent. Disjoint precedents make every proposal refused. |
| **R3** | The tightest envelope: minimum expiry, latest start, minimum bounded use, purpose intersection, `delegationDepth: 0`. It bounds one decision, never a class.                                      |
| **R4** | Every auto-decision is marked. A proposal that declares no matcher is inadmissible, and the marker reaches the grant's metadata and an `escalation.auto_decided` audit event.                     |

R4 is what makes a bad matcher a rollback instead of an incident: an operator
selects everything one matcher produced — `readAutoDecided` off the grant, or
the audit stream — and revokes it in one action, without telling it apart from
what people decided by hand.

## Exactness is derived, not declared

A host never asserts that a match was exact; the assertion is exactly what R1
gates, and a rule enforced against a self-report is a rule enforced against
honest hosts only. `PrecedentKey` is the structured key — namespace, owner,
requester, purpose, and effective capability — and `precedentKeyDigest` is its
only fingerprint. Equality of the digest **is** an exact match; anything else is
fuzzy evidence, including a citation that mixes one identical precedent with a
similar one.

The key is deliberately time-invariant, as `CapabilityRequest.id` is since
ADR 0019. The id is still not usable for this: it hashes the constraints the
requester asked for, and R3 takes the envelope from the precedents rather than
from the ask, so an ask for a shorter expiry must not be a different question.

It is also keyed on **effective** capability rather than on a grant set. A host
that holds authority down outside its grants — a tool map, an allow-list, an
ADR 0020 `HostCeiling` — has an effective authority narrower than its grant set,
and keying on the wider one would teach the system an authority nobody granted,
most of all in the deployments that were being careful.

See [ADR 0022](https://github.com/systemind-team/SharedOS/blob/main/docs/adr/0022-precedent-proposes-the-kernel-admits.md).

SharedOS is currently a `1.0.0` preview.

## Classes

### InMemoryPrecedentLookup

Defined in: [precedent/src/lookup.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L71)

A process-local lookup over a fixed set of rows, for tests and single-process
hosts. Durable hosts inject their own store.

#### Implements

- [`PrecedentLookup`](#precedentlookup)

#### Constructors

##### Constructor

> **new InMemoryPrecedentLookup**(`precedents?`): [`InMemoryPrecedentLookup`](#inmemoryprecedentlookup)

Defined in: [precedent/src/lookup.ts:74](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L74)

###### Parameters

| Parameter    | Type                                 | Default value |
| ------------ | ------------------------------------ | ------------- |
| `precedents` | readonly [`Precedent`](#precedent)[] | `[]`          |

###### Returns

[`InMemoryPrecedentLookup`](#inmemoryprecedentlookup)

#### Methods

##### load()

> **load**(`namespaceId`, `requestIds`): `Promise`\<readonly [`Precedent`](#precedent)[]\>

Defined in: [precedent/src/lookup.ts:90](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L90)

###### Parameters

| Parameter     | Type                |
| ------------- | ------------------- |
| `namespaceId` | `string`            |
| `requestIds`  | readonly `string`[] |

###### Returns

`Promise`\<readonly [`Precedent`](#precedent)[]\>

###### Implementation of

[`PrecedentLookup`](#precedentlookup).[`load`](#load-1)

##### record()

> **record**(`precedent`): `void`

Defined in: [precedent/src/lookup.ts:80](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L80)

###### Parameters

| Parameter   | Type                      |
| ----------- | ------------------------- |
| `precedent` | [`Precedent`](#precedent) |

###### Returns

`void`

## Interfaces

### AdmittedAllow

Defined in: [precedent/src/admission.ts:121](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L121)

An auto-decision that allows, at a width the kernel bounded.

`allowed: true` and nothing else: this is not a third `AuthorizationDecision`
value and is deliberately not assignable to one. It describes a grant for the
host's store to issue, which the next turn loads through `GrantSource` like
any other. Nothing here is authority, no port accepts one back as authority,
and no turn is resumed by it.

#### Extends

- `AdmittedCommon`

#### Properties

| Property                                                | Modifier   | Type                                             | Description                                                                                                                                                                                                                                                                                                                         | Inherited from                   | Defined in                                                                                                                      |
| ------------------------------------------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-allowed"></a> `allowed`                 | `readonly` | `true`                                           | -                                                                                                                                                                                                                                                                                                                                   | -                                | [precedent/src/admission.ts:122](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L122) |
| <a id="property-capabilities"></a> `capabilities`       | `readonly` | readonly `object`[]                              | -                                                                                                                                                                                                                                                                                                                                   | -                                | [precedent/src/admission.ts:132](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L132) |
| <a id="property-citedrequestids"></a> `citedRequestIds` | `readonly` | readonly `string`[]                              | -                                                                                                                                                                                                                                                                                                                                   | `AdmittedCommon.citedRequestIds` | [precedent/src/admission.ts:94](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L94)   |
| <a id="property-constraints"></a> `constraints`         | `readonly` | `object`                                         | R3's tightest envelope across every precedent cited.                                                                                                                                                                                                                                                                                | -                                | [precedent/src/admission.ts:134](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L134) |
| `constraints.delegationDepth?`                          | `public`   | `number`                                         | -                                                                                                                                                                                                                                                                                                                                   | -                                | contracts/dist/capability.d.ts:228                                                                                              |
| `constraints.expiresAt?`                                | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                   | -                                | contracts/dist/capability.d.ts:226                                                                                              |
| `constraints.maxUses?`                                  | `public`   | `number`                                         | -                                                                                                                                                                                                                                                                                                                                   | -                                | contracts/dist/capability.d.ts:227                                                                                              |
| `constraints.notBefore?`                                | `public`   | `string`                                         | -                                                                                                                                                                                                                                                                                                                                   | -                                | contracts/dist/capability.d.ts:225                                                                                              |
| `constraints.purposes?`                                 | `public`   | `string`[]                                       | -                                                                                                                                                                                                                                                                                                                                   | -                                | contracts/dist/capability.d.ts:224                                                                                              |
| <a id="property-match"></a> `match`                     | `readonly` | [`PrecedentMatch`](#precedentmatch)              | -                                                                                                                                                                                                                                                                                                                                   | `AdmittedCommon.match`           | [precedent/src/admission.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L95)   |
| <a id="property-metadata"></a> `metadata`               | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | R4, ready to put on the grant and on the audit event.                                                                                                                                                                                                                                                                               | `AdmittedCommon.metadata`        | [precedent/src/admission.ts:97](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L97)   |
| <a id="property-narrowed"></a> `narrowed`               | `readonly` | `boolean`                                        | True when fuzzy evidence carried it, which is ADR 0022's `allow_narrowed`. Not a decision value. It serialises as an ordinary allow; what differs is that the capability below was additionally bounded by what this request actually asked for, because resemblance may not authorize more than the question in front of us needs. | -                                | [precedent/src/admission.ts:131](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L131) |

---

### AdmittedDeny

Defined in: [precedent/src/admission.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L108)

An auto-decision that refuses.

It issues nothing, so its marker reaches only the audit event. A refusal
still has to be markable: an operator revoking everything one matcher
produced has to be able to find the requests it silently closed as well as
the grants it opened.

#### Extends

- `AdmittedCommon`

#### Properties

| Property                                                  | Modifier   | Type                                             | Description                                           | Inherited from                   | Defined in                                                                                                                      |
| --------------------------------------------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-allowed-1"></a> `allowed`                 | `readonly` | `false`                                          | -                                                     | -                                | [precedent/src/admission.ts:109](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L109) |
| <a id="property-citedrequestids-1"></a> `citedRequestIds` | `readonly` | readonly `string`[]                              | -                                                     | `AdmittedCommon.citedRequestIds` | [precedent/src/admission.ts:94](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L94)   |
| <a id="property-match-1"></a> `match`                     | `readonly` | [`PrecedentMatch`](#precedentmatch)              | -                                                     | `AdmittedCommon.match`           | [precedent/src/admission.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L95)   |
| <a id="property-metadata-1"></a> `metadata`               | `readonly` | [`JsonObject`](sharedos-contracts.md#jsonobject) | R4, ready to put on the grant and on the audit event. | `AdmittedCommon.metadata`        | [precedent/src/admission.ts:97](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L97)   |

---

### ApprovedPrecedent

Defined in: [precedent/src/lookup.ts:14](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L14)

A resolved escalation a human approved, and the width they approved.

`capabilities` is what the owner actually said yes to, which is not always
what was asked: an owner who approves a narrower thing than the request named
produces a precedent narrower than its own key. Both are recorded, because
the key answers "was this the same question" and the capabilities answer "how
much did they allow".

#### Properties

| Property                                            | Modifier   | Type                            | Description                                                 | Defined in                                                                                                              |
| --------------------------------------------------- | ---------- | ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| <a id="property-capabilities-1"></a> `capabilities` | `readonly` | readonly `object`[]             | -                                                           | [precedent/src/lookup.ts:19](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L19) |
| <a id="property-constraints-1"></a> `constraints`   | `readonly` | `object`                        | -                                                           | [precedent/src/lookup.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L20) |
| `constraints.delegationDepth?`                      | `public`   | `number`                        | -                                                           | contracts/dist/capability.d.ts:228                                                                                      |
| `constraints.expiresAt?`                            | `public`   | `string`                        | -                                                           | contracts/dist/capability.d.ts:226                                                                                      |
| `constraints.maxUses?`                              | `public`   | `number`                        | -                                                           | contracts/dist/capability.d.ts:227                                                                                      |
| `constraints.notBefore?`                            | `public`   | `string`                        | -                                                           | contracts/dist/capability.d.ts:225                                                                                      |
| `constraints.purposes?`                             | `public`   | `string`[]                      | -                                                           | contracts/dist/capability.d.ts:224                                                                                      |
| <a id="property-decidedat"></a> `decidedAt`         | `readonly` | `string`                        | -                                                           | [precedent/src/lookup.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L21) |
| <a id="property-key"></a> `key`                     | `readonly` | [`PrecedentKey`](#precedentkey) | -                                                           | [precedent/src/lookup.ts:18](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L18) |
| <a id="property-outcome"></a> `outcome`             | `readonly` | `"approved"`                    | -                                                           | [precedent/src/lookup.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L15) |
| <a id="property-requestid"></a> `requestId`         | `readonly` | `string`                        | The `CapabilityRequest.id` of the escalation this resolved. | [precedent/src/lookup.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L17) |

---

### AutoDecidedMarker

Defined in: [precedent/src/admission.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L36)

What a host declares about the matcher behind a proposal.

`matcher` is the class handle R4 exists for: a product will improve its
matcher, some improvement will be wrong, and the difference between that
being an incident and being a rollback is whether an operator can select
everything one matcher produced and revoke it in one action. Name the matcher
and its version, not the request -- "the thing to revoke" is a generation of
matcher, never a single decision.

#### Extended by

- [`AutoDecidedRecord`](#autodecidedrecord)

#### Properties

| Property                                | Modifier   | Type     | Defined in                                                                                                                    |
| --------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-matcher"></a> `matcher` | `readonly` | `string` | [precedent/src/admission.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L37) |

---

### AutoDecidedRecord

Defined in: [precedent/src/admission.ts:44](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L44)

The marker as it reaches the grant and the audit event, with the citation the
kernel derived rather than the host asserted.

#### Extends

- [`AutoDecidedMarker`](#autodecidedmarker)

#### Properties

| Property                                                  | Modifier   | Type                                | Description                                                       | Inherited from                                                           | Defined in                                                                                                                    |
| --------------------------------------------------------- | ---------- | ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-citedrequestids-2"></a> `citedRequestIds` | `readonly` | readonly `string`[]                 | -                                                                 | -                                                                        | [precedent/src/admission.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L45) |
| <a id="property-match-2"></a> `match`                     | `readonly` | [`PrecedentMatch`](#precedentmatch) | Whether the cited evidence was the identical question. R1's axis. | -                                                                        | [precedent/src/admission.ts:47](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L47) |
| <a id="property-matcher-1"></a> `matcher`                 | `readonly` | `string`                            | -                                                                 | [`AutoDecidedMarker`](#autodecidedmarker).[`matcher`](#property-matcher) | [precedent/src/admission.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L37) |

---

### AutoDecisionProposal

Defined in: [precedent/src/admission.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L71)

#### Properties

| Property                                                  | Modifier   | Type                                                                                                                                                                                                       | Description                                                         | Defined in                                                                                                                    |
| --------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| <a id="property-citedrequestids-3"></a> `citedRequestIds` | `readonly` | readonly `string`[]                                                                                                                                                                                        | The precedents the host's matcher chose, by `CapabilityRequest.id`. | [precedent/src/admission.ts:75](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L75) |
| <a id="property-marker"></a> `marker`                     | `readonly` | [`AutoDecidedMarker`](#autodecidedmarker)                                                                                                                                                                  | -                                                                   | [precedent/src/admission.ts:77](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L77) |
| <a id="property-proposed"></a> `proposed`                 | `readonly` | [`ProposedAutoDecision`](#proposedautodecision)                                                                                                                                                            | -                                                                   | [precedent/src/admission.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L76) |
| <a id="property-request"></a> `request`                   | `readonly` | `object`                                                                                                                                                                                                   | The escalation now in front of the control plane.                   | [precedent/src/admission.ts:73](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L73) |
| `request.capabilities`                                    | `public`   | `object`[]                                                                                                                                                                                                 | -                                                                   | contracts/dist/capability.d.ts:512                                                                                            |
| `request.constraints?`                                    | `public`   | `object`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:534                                                                                            |
| `request.constraints.delegationDepth?`                    | `public`   | `number`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:539                                                                                            |
| `request.constraints.expiresAt?`                          | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:537                                                                                            |
| `request.constraints.maxUses?`                            | `public`   | `number`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:538                                                                                            |
| `request.constraints.notBefore?`                          | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:536                                                                                            |
| `request.constraints.purposes?`                           | `public`   | `string`[]                                                                                                                                                                                                 | -                                                                   | contracts/dist/capability.d.ts:535                                                                                            |
| `request.id`                                              | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:498                                                                                            |
| `request.metadata?`                                       | `public`   | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                           | -                                                                   | contracts/dist/capability.d.ts:541                                                                                            |
| `request.namespaceId`                                     | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:483                                                                                            |
| `request.owner`                                           | `public`   | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                   | contracts/dist/capability.d.ts:484                                                                                            |
| `request.purpose`                                         | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:497                                                                                            |
| `request.requestedAt`                                     | `public`   | `string`                                                                                                                                                                                                   | -                                                                   | contracts/dist/capability.d.ts:533                                                                                            |
| `request.requester`                                       | `public`   | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | -                                                                   | contracts/dist/capability.d.ts:499                                                                                            |

---

### PrecedentKey

Defined in: [precedent/src/key.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L24)

The shape a precedent is filed under, as a structure rather than a string.

The c2c plane this replaces string-encoded a structured key into two fields
meant for something else: `relationshipCluster` carried `c2c:<principalId>`
and `queryFingerprint` carried a JSON tuple, where the escalation plane wrote
a computed cluster and a SHA-256 of normalized intent. One table, two
grammars, and nothing that could tell them apart. Declaring the key makes
that inexpressible -- there is no field here a second encoding could hide in,
and [precedentKeyDigest](#precedentkeydigest) is the only fingerprint.

The five dimensions are the ones that decide whether this is the same
question. `requestedAt` is deliberately not among them: see
[precedentKeyDigest](#precedentkeydigest).

#### Properties

| Property                                            | Modifier   | Type                                                                                                                                                                                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Defined in                                                                                                        |
| --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| <a id="property-capabilities-2"></a> `capabilities` | `readonly` | readonly `object`[]                                                                                                                                                                                        | The effective capability asked for: what the owner was actually answering about, not the grant set that answer produced. A host that holds authority down outside its grant set -- a tool map, an allow-list, an ADR 0020 ceiling -- has an effective authority narrower than its grants. Keying on the grants would record that a human approved authority the host was quietly withholding, and the next proposal would cite that record to justify the wider thing. See ADR 0022. | [precedent/src/key.ts:41](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L41) |
| <a id="property-namespaceid"></a> `namespaceId`     | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [precedent/src/key.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L25) |
| <a id="property-owner"></a> `owner`                 | `readonly` | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | Whose answer this is. A precedent is one owner's record, never a pool.                                                                                                                                                                                                                                                                                                                                                                                                               | [precedent/src/key.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L27) |
| <a id="property-purpose"></a> `purpose`             | `readonly` | `string`                                                                                                                                                                                                   | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [precedent/src/key.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L30) |
| <a id="property-requester"></a> `requester`         | `readonly` | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \} | Who was asking. Only an allow reads this; see `admitAutoDecision`.                                                                                                                                                                                                                                                                                                                                                                                                                   | [precedent/src/key.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L29) |

---

### PrecedentLookup

Defined in: [precedent/src/lookup.ts:63](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L63)

The trusted lookup for the precedents a proposal cites.

SharedOS stores nothing. A precedent is a record of what one owner answered,
and that record belongs to the host that recorded the escalation -- so the
rows stay host-side and reach admission through this port, by id, at the
moment they are judged. Nothing here writes, expires, or garbage-collects a
row; a host that already records resolved escalations already has the
material and needs no new table.

The port is asked for the ids a proposal named, and nothing else. It is not a
matcher: a search interface here would put ranking inside the kernel, which
is the one thing ADR 0022 keeps out. Whichever rows a host's matcher chose,
it cites them by id and they are re-read from the store, so a proposal can
never overstate what a precedent said.

An implementation must resolve only within `namespaceId`, and must throw
rather than answer with a partial or stale set -- an admission built on a row
the store could not vouch for is exactly the widening nobody authorized.
`admitAutoDecision` fails closed on a throw and on any answer that is not
precisely the cited ids.

#### Methods

##### load()

> **load**(`namespaceId`, `requestIds`): `Promise`\<readonly [`Precedent`](#precedent)[]\>

Defined in: [precedent/src/lookup.ts:64](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L64)

###### Parameters

| Parameter     | Type                |
| ------------- | ------------------- |
| `namespaceId` | `string`            |
| `requestIds`  | readonly `string`[] |

###### Returns

`Promise`\<readonly [`Precedent`](#precedent)[]\>

---

### RefusedPrecedent

Defined in: [precedent/src/lookup.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L32)

A resolved escalation a human refused.

It has no capabilities, and that absence is load-bearing rather than tidy: it
is why a proposed allow cannot read a width off a refusal. A denial needs no
width to be worth citing, so nothing is missing here -- there was never a
width to record. See `admitAutoDecision`.

#### Properties

| Property                                      | Modifier   | Type                            | Defined in                                                                                                              |
| --------------------------------------------- | ---------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| <a id="property-decidedat-1"></a> `decidedAt` | `readonly` | `string`                        | [precedent/src/lookup.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L36) |
| <a id="property-key-1"></a> `key`             | `readonly` | [`PrecedentKey`](#precedentkey) | [precedent/src/lookup.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L35) |
| <a id="property-outcome-1"></a> `outcome`     | `readonly` | `"refused"`                     | [precedent/src/lookup.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L33) |
| <a id="property-requestid-1"></a> `requestId` | `readonly` | `string`                        | [precedent/src/lookup.ts:34](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L34) |

## Type Aliases

### AdmittedAutoDecision

> **AdmittedAutoDecision** = [`AdmittedDeny`](#admitteddeny) \| [`AdmittedAllow`](#admittedallow)

Defined in: [precedent/src/admission.ts:137](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L137)

---

### Precedent

> **Precedent** = [`ApprovedPrecedent`](#approvedprecedent) \| [`RefusedPrecedent`](#refusedprecedent)

Defined in: [precedent/src/lookup.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/lookup.ts#L39)

---

### PrecedentAdmission

> **PrecedentAdmission** = \{ `admitted`: `true`; `decision`: [`AdmittedAutoDecision`](#admittedautodecision); \} \| \{ `admitted`: `false`; `reason`: [`PrecedentInadmissibleReason`](#precedentinadmissiblereason); \}

Defined in: [precedent/src/admission.ts:139](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L139)

---

### PrecedentInadmissibleReason

> **PrecedentInadmissibleReason** = `"no_precedent_cited"` \| `"auto_decision_unmarked"` \| `"empty_proposed_capability"` \| `"precedent_unavailable"` \| `"precedent_not_this_owner"` \| `"precedent_not_this_requester"` \| `"allow_cites_refusal"` \| `"wider_than_precedent"` \| `"wider_than_request"` \| `"envelope_unsatisfiable"`

Defined in: [precedent/src/admission.ts:81](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L81)

Why a proposal may not be decided without a human.

---

### PrecedentMatch

> **PrecedentMatch** = `"exact"` \| `"fuzzy"`

Defined in: [precedent/src/admission.ts:57](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L57)

Whether the cited precedents are the same question or merely a similar one.

Derived here, never declared: a host that could assert "this was exact" would
be self-reporting the very thing R1 gates, and a rule enforced against a
self-report is a rule enforced against honest hosts only.

---

### ProposedAutoDecision

> **ProposedAutoDecision** = \{ `allowed`: `false`; \} \| \{ `allowed`: `true`; `capabilities`: readonly [`Capability`](sharedos-contracts.md#capability)[]; \}

Defined in: [precedent/src/admission.ts:67](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L67)

What the host wants to happen, carrying no score, confidence, or match type.

A field the kernel is handed and must ignore is a field a host will
eventually expect it to honour -- ADR 0009 rejected a context carrying
`grants` the kernel ignored for exactly that reason -- so the proposal has
nowhere to put one.

## Variables

### AUTO\_DECIDED\_METADATA\_KEY

> `const` **AUTO\_DECIDED\_METADATA\_KEY**: `"autoDecided"` = `"autoDecided"`

Defined in: [precedent/src/admission.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L24)

The reserved metadata key an auto-decided grant carries.

Reserved and validated rather than left to opaque host metadata, and that is
consistent with ADR 0008 refusing to put the delegation parent there: 0008's
objection was to _authority_ resting on an unvalidated field. This one grants
nothing and removes nothing. It is a handle, and the only thing that has to
be true of a handle is that it is present -- which only a validated key makes
checkable.

---

### PRECEDENT\_KEY\_VERSION

> `const` **PRECEDENT\_KEY\_VERSION**: `"1"` = `"1"`

Defined in: [precedent/src/key.ts:98](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L98)

The key shape this digest is over. Hashed, so versions cannot collide.

## Functions

### admitAutoDecision()

> **admitAutoDecision**(`proposal`, `lookup`): `Promise`\<[`PrecedentAdmission`](#precedentadmission)>\>

Defined in: [precedent/src/admission.ts:186](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L186)

Decide whether one finished proposal may be decided without a human.

The host proposes however it likes -- exact key match, Jaccard over tool
names, embeddings, a model trained on its own history. This does not rank,
score, learn, or improve; it answers one question about a proposal that is
already made, against R1 through R4 of ADR 0022. That separation is the whole
point: a product's matching can get better every quarter without the kernel
ever having to trust a similarity score, and what a security review reads is
four rules rather than a model.

**R1 -- fuzzy evidence may only narrow.** A deny is admissible on either
evidence: refusing something resembling what this owner has refused takes
nothing away that was not already absent, and its worst case is an escalation
the owner never sees, which is today's case for every request. An allow is
the only outcome that creates authority, so only an exact key match may
authorize at the full width a human approved; a fuzzy allow is additionally
bounded by the capabilities this request asked for and comes back
`narrowed`.

**R2 -- never wider than the precedents cited.** Checked with
`capabilityIsWithin`, the same predicate the delegation chain uses, applied
once per cited precedent rather than against a constructed intersection --
the same guarantee without an intersection algebra the contract would then
have to define and test. Cited precedents that are disjoint make every
proposal inadmissible, which is the correct answer.

**R3 -- the tightest envelope.** Minimum expiry, latest start, minimum
bounded use, the intersection of allowed purposes, and `delegationDepth: 0`.
A machine-made grant that can be delegated is one whose blast radius is
decided by somebody else. This bounds one auto-decision, never a class: n
auto-decisions citing a k-use precedent carry n*k uses between them, exactly
as ADR 0008 already found for delegation. What bounds the class is R4.

**R4 -- every auto-decision is marked.** A proposal that declares no marker
is inadmissible, and the marker returned carries the derived citation.
Honouring it at issue is the host's, as ADR 0011 already divides resolution.

Refusing a proposal is not an event. The escalation it concerns is already
recorded and already waiting for a human; manufacturing a second one would
double-count in every denominator. Inadmissible means the auto-decision does
not happen and the request stays where it was.

#### Parameters

| Parameter  | Type                                            |
| ---------- | ----------------------------------------------- |
| `proposal` | [`AutoDecisionProposal`](#autodecisionproposal) |
| `lookup`   | [`PrecedentLookup`](#precedentlookup)           |

#### Returns

`Promise`\<[`PrecedentAdmission`](#precedentadmission)\>

---

### autoDecisionAuditEvent()

> **autoDecisionAuditEvent**(`context`, `decision`, `createId?`): `object`

Defined in: [precedent/src/audit.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/audit.ts#L32)

The `escalation.auto_decided` event for one admitted auto-decision.

R4's other half. An operator asking "what did the machine decide on our
behalf, and what did it cite" reads it from the audit stream, and that
question is the one that decides whether a matcher stays turned on.

It takes an admitted decision and nothing else, so an inadmissible proposal
has no way to become an event. That is deliberate: the escalation it concerns
is already recorded and already waiting for a human, and a second record of
the same unanswered request would double-count in every denominator ADR 0011
was careful about.

The outcome is `allowed` or `denied`, never `escalated`. An escalation is a
decision SharedOS declined to make; this is one that was made, by a matcher
the host installed, on a precedent a human set. Recording it as `escalated`
would count a machine answer as a request for help.

`context` is the control plane's, not a turn's: the auto-decision happens
where the human's would have, between turns, against an escalation that is
already terminal.

`createId` mints the record's identity, as `SharedOSKernelOptions.createAuditId`
does for the kernel's own records; a random UUID when the control plane passes
nothing.

#### Parameters

| Parameter                        | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context`                        | \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \} |
| `context.actor`                  | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.authority`              | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.enabledToolNamespaces?` | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.executionId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.namespaceId?`           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.now?`                   | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.owner?`                 | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `context.purpose?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `context.traceId?`               | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `decision?`                      | [`AdmittedAutoDecision`](#admittedautodecision)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `createId?`                      | () => `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

#### Returns

`object`

##### action?

> `optional` **action?**: `string`

##### actor

> **actor**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

##### at

> **at**: `string`

##### authority

> **authority**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

##### authorityHash?

> `optional` **authorityHash?**: `string`

##### cause?

> `optional` **cause?**: `string`

##### consumed?

> `optional` **consumed?**: `boolean`

##### endedBy?

> `optional` **endedBy?**: `"envelope"` \| `"runtime"`

##### failClosed?

> `optional` **failClosed?**: `boolean`

##### grantId?

> `optional` **grantId?**: `string`

##### id

> **id**: `string`

##### messageId?

> `optional` **messageId?**: `string`

##### metadata?

> `optional` **metadata?**: [`JsonObject`](sharedos-contracts.md#jsonobject)

##### namespaceId

> **namespaceId**: `string`

##### operationId?

> `optional` **operationId?**: `string`

##### outcome

> **outcome**: `"allowed"` \| `"denied"` \| `"failed"` \| `"succeeded"` \| `"escalated"` \| `"interrupted"`

##### owner

> **owner**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

##### purpose

> **purpose**: `string`

##### reason?

> `optional` **reason?**: `string`

##### receiver?

> `optional` **receiver?**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

##### requestedAuthority?

> `optional` **requestedAuthority?**: `object`

###### requestedAuthority.capabilities

> **capabilities**: `object`[]

###### requestedAuthority.constraints?

> `optional` **constraints?**: `object`

###### requestedAuthority.constraints.delegationDepth?

> `optional` **delegationDepth?**: `number`

###### requestedAuthority.constraints.expiresAt?

> `optional` **expiresAt?**: `string`

###### requestedAuthority.constraints.maxUses?

> `optional` **maxUses?**: `number`

###### requestedAuthority.constraints.notBefore?

> `optional` **notBefore?**: `string`

###### requestedAuthority.constraints.purposes?

> `optional` **purposes?**: `string`[]

###### requestedAuthority.id

> **id**: `string`

###### requestedAuthority.metadata?

> `optional` **metadata?**: [`JsonObject`](sharedos-contracts.md#jsonobject)

###### requestedAuthority.namespaceId

> **namespaceId**: `string`

###### requestedAuthority.owner

> **owner**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

###### requestedAuthority.purpose

> **purpose**: `string`

###### requestedAuthority.requestedAt

> **requestedAt**: `string`

###### requestedAuthority.requester

> **requester**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

##### resource?

> `optional` **resource?**: `object`

###### resource.namespace

> **namespace**: `string`

###### resource.owner?

> `optional` **owner?**: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}

###### resource.path

> **path**: `string`[]

##### source?

> `optional` **source?**: `"envelope"` \| `"kernel"`

##### tool?

> `optional` **tool?**: `string`

##### traceId

> **traceId**: `string`

##### type

> **type**: `"escalation.auto_decided"` \| `"tool.invoked"` \| `"authority.resolved"` \| `"authorization.checked"` \| `"escalation.requested"` \| `"resource.invoked"` \| `"tool.catalog.listed"` \| `"tool.namespace.catalog.listed"` \| `"tool.namespace.selection.updated"` \| `"message.sent"` \| `"turn.ended"`

##### version

> **version**: `"1"`

---

### precedentKey()

> **precedentKey**(`request`): [`PrecedentKey`](#precedentkey)

Defined in: [precedent/src/key.ts:52](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L52)

The key of the request in front of us, or of the one a precedent recorded.

Reads only the dimensions above and drops `id`, `requestedAt`, `constraints`
and `metadata`. Dropping the requested constraints cannot widen anything: R3
takes the envelope from the precedents, so what a requester asked to be
bounded by never reaches the issued grant.

#### Parameters

| Parameter                              | Type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`                              | \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](sharedos-contracts.md#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \} |
| `request.capabilities`                 | `object`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `request.constraints?`                 | \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `request.constraints.delegationDepth?` | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.constraints.expiresAt?`       | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.constraints.maxUses?`         | `number`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.constraints.notBefore?`       | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.constraints.purposes?`        | `string`[]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `request.id`                           | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.metadata?`                    | [`JsonObject`](sharedos-contracts.md#jsonobject)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `request.namespaceId`                  | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.owner`                        | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `request.purpose`                      | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.requestedAt`                  | `string`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `request.requester`                    | \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

#### Returns

[`PrecedentKey`](#precedentkey)

---

### precedentKeyDigest()

> **precedentKeyDigest**(`key`): `Promise`\<`string`>\>

Defined in: [precedent/src/key.ts:86](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/key.ts#L86)

A deterministic fingerprint of one key, and the only thing exactness is
derived from.

ADR 0022 proposed re-deriving `CapabilityRequest.id` and comparing. The id
is time-invariant since ADR 0019 -- `mintCapabilityRequest` keeps
`requestedAt` out of the hashed material, so one ask keeps one id across
turns -- but it is still not this key: the id hashes the constraints the
requester asked to be bounded by, and R3 takes the envelope from the
precedents, not from the ask. Keying on the id would make a request that
asked for a shorter expiry a different question from one that did not. The
key reads only what decides whether it is the same question, which is what
"the same question" has to mean.

Normalisation is what makes two hosts agree. Object keys are already ordered
by `canonicalJson`; on top of that an unowned resource is resolved against
the key's owner (they denote the same resource once the owner is known),
actions are deduplicated and sorted, and the capability list is deduplicated
and sorted by its own canonical form. Order of declaration is not part of the
question being asked.

`version` is hashed with the rest so a later change to what a key contains
cannot collide with a digest computed under this one.

#### Parameters

| Parameter | Type                            |
| --------- | ------------------------------- |
| `key`     | [`PrecedentKey`](#precedentkey) |

#### Returns

`Promise`\<`string`\>

---

### readAutoDecided()

> **readAutoDecided**(`metadata`): [`AutoDecidedRecord`](#autodecidedrecord) \| `undefined`

Defined in: [precedent/src/admission.ts:411](https://github.com/systemind-team/SharedOS/blob/main/packages/precedent/src/admission.ts#L411)

The marker on a grant, or `undefined` when it carries none.

The reading half of R4: an operator selecting everything one matcher produced
asks this of each grant's `metadata` rather than parsing a convention. A
grant with no marker was decided by a person, which is the distinction the
whole rule exists to keep drawable.

#### Parameters

| Parameter  | Type                                                            |
| ---------- | --------------------------------------------------------------- |
| `metadata` | [`JsonObject`](sharedos-contracts.md#jsonobject) \| `undefined` |

#### Returns

[`AutoDecidedRecord`](#autodecidedrecord) \| `undefined`
