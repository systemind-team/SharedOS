# ADR 0027: Tool policy classifies declared mediation scope

- Status: Accepted
- Date: 2026-10-04
- Supersedes: The tool policy classification in ADR 0014

## Context

`declareToolPolicy({ harnessLocal: ["shell", "apply_patch"] })` returned
`mode: "strict"`. The schema rejected independent MCP servers under `strict`
but permitted local tools that SharedOS could neither authorize nor observe.
A conformance reader could mistake a broker refusal for evidence that the same
effect could not occur through another path. Empty defaults and absent policies
also implied a broker-only configuration without establishing the harness's
capabilities. Launch flags configure a harness; they do not prove isolation.

## Decision

`ToolPolicy` now has its own required `version: "2"` and these modes:

- `broker-only`: the host declares a complete tool inventory with no local or
  independently connected tools. Supporting evidence references are required.
- `mixed`: at least one local tool or independent endpoint is named. This says
  that outside paths are available, not that they were used. Inventory
  completeness remains a separate field and may be unknown.
- `unknown`: no outside paths are named, but the inventory is unknown. This
  includes an omitted declaration and empty lists without completeness evidence.

`inventory` is `complete` or `unknown`. `managedMcp` names at least one SharedOS
endpoint. `harnessLocal` and `externalDirect` remain name lists. `evidence` is a
JSON-safe list of host-owned artifact references, not an attestation verified by
SharedOS. A complete inventory must cite evidence. The helper requires both
outside lists explicitly before accepting completeness; missing arguments do
not silently become declarations of absence. Modes must match the inventory.

All local tools are counted, including shell, patches, writes, reads, planners,
and supposedly harmless utilities. There is no harmless-local exception. A
proxy that exclusively forwards to this turn's SharedOS endpoint belongs to
the managed connection only after host review of its implementation and
configuration; an extension label or read-only hint cannot justify that claim.

A host declaring completeness must retain evidence for the effective tool
inventory, exact harness build and launch configuration, inherited settings,
profiles, extensions, and any operator overrides. The schema checks reference
presence and declaration consistency, not artifact truth. A policy and its hash
are never proof of process or OS isolation, credential containment, or absence
of non-tool side effects. Broker authorization and audit records establish
mediation only for the individual operations reaching SharedOS.

The MCP adapter validates and snapshots a host-supplied policy and annotates it
before launching the harness. Its default remains unknown even when launch
flags disable named tools. Execution-record assembly preserves that declaration
or a column declaration, rejects conflicting or invalid declarations, and writes
unknown when neither exists. Absence in older records must be read as unknown.
The MCP conformance script declares known local paths as mixed and leaves
unreviewed extension inventories unknown. No sandbox is implemented here.

## Migration and versioning

This is a breaking policy contract change. Version 2 rejects legacy unversioned
`strict` and `hybrid` policies; they cannot safely be relabeled automatically.
Hosts must enumerate local and independent tools and review completeness.
Known outside paths migrate to mixed; uncertain inventories migrate to unknown.
Only reviewed configurations with no outside tools may declare broker-only.

The nested policy has a distinct version because its evidence vocabulary changes
without changing the authorization request/event protocol (`PROTOCOL_VERSION`
remains `"1"`) or the execution-record envelope (`version: "1"`). Records with
legacy policies require explicit host migration or a historical version reader;
current strict schemas reject them. Policy hashes change and conformance
artifacts must be regenerated; historical evidence must not be rewritten as if
it had established a stronger classification.

Ship this change in the next synchronized npm prerelease, with contracts, MCP,
adapters, conformance, and SDK released together. The release commit must advance
all package versions and `SHAREDOS_VERSION` together under the existing release
gate; do not republish `1.0.0-preview` with this changed contract. The Unreleased
changelog records the migration until that release version is assigned.

## Validation scope

Tests cover shell/write/read/local tools, direct MCP connections, complete
broker-only declarations, missing inventories and evidence, legacy rejection,
policy hashing, adapter annotations, and record propagation. These tests check
classification and evidence handling; they make no isolation claim.
