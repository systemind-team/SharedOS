# SharedOS documentation

SharedOS is open-source infrastructure for permissioned agent-to-agent
communication. It decides whether one agent may read a given file or call a
given tool on behalf of another — per resource, per action, per call.

## Why SharedOS exists

Start with a request that any two teams will want to make eventually. Your agent
asks a colleague's agent:

> What did your team decide about the Q3 launch, and is your lead free Thursday
> afternoon?

Answering it well requires two very different kinds of access:

- **Accumulated knowledge.** Decisions, plans, and context that were built up
  over time and now sit in notes, documents, and project files.
- **Live state.** Calendar availability right now, which cannot be answered from
  a copy because a copy goes stale the moment it is made.

Answering it safely requires that a long list of adjacent things stay
unavailable: the rest of that person's notes, the contents of the calendar
entries themselves, their inbox, and the ability to send anything to anyone.

Today that request usually has two outcomes, and both are bad. Either the
request is refused, because there is no way to open a narrow door — so agents
can only work inside a single trust boundary, and cross-team delegation never
happens. Or someone hands over a session, an API key, or a broad OAuth scope,
and the actual decision about what may be touched ends up **inside the model's
context**, expressed as instructions the model is asked to respect.

That second outcome is the failure mode SharedOS is built to remove. When
authorization lives in the prompt:

- A message can talk the model into widening its own access, because the text
  asking for the work and the text describing the limits arrive on the same
  channel.
- Tool discovery leaks. A model that can see a tool it must not use will
  eventually try to use it, and every guardrail becomes a string comparison in a
  system prompt.
- Nothing is auditable after the fact. There is no record that separates "the
  agent was allowed to do this" from "the agent did this and nobody stopped it."
- Nothing is revocable. Access ends when a key is rotated, not when a
  collaboration ends.

SharedOS moves that decision out of the model and into a kernel that evaluates
it independently.

### What that looks like for the request above

The colleague's host issues two narrow, separately partitioned grants:

1. A **file capability**: search and read under one project path — not the
   parent directory, not personal notes.
2. A **tool capability**: `free/busy` on one calendar — not event contents, not
   the mailbox, not send.

Then the turn runs inside a fixed envelope. The requesting agent is admitted
only because it holds an execution grant. The tool catalog it is shown is
already filtered down to what it may use, so the model never sees the mailbox
exists. Every individual call — the exact path, the exact action — is authorized
again at invocation time, because passing discovery is not permission to invoke.
The model never sees the grants themselves or the authority that issued them.
The turn carries the deadline the host set, if any, and what was requested,
allowed, and denied is recorded.

The message coordinated the work. It never carried authority.

### What this is not

- **Not a tool-connection protocol.** Connecting a tool is not authorizing it.
  External and MCP tools are welcome here; they arrive as namespaces that are
  off by default and still require an exact capability match per call.
- **Not a messaging platform.** SharedOS authorizes and validates message
  requests, but the host owns durable logs, inboxes, receiver wake-up, retries,
  and multi-turn scheduling. Receiving a message is not permission to act on it.
- **Not an agent framework.** The model, the prompt strategy, the agent loop,
  and the execution backend are all replaceable — that is the point. The
  security envelope around them is the part that does not vary.

SharedOS also deliberately does not own product UI, accounts, billing, or task
scheduling. The host keeps its storage, its credentials, and its users. SharedOS
is the boundary between them and the agents that act on them.

## Start here

- [Quickstart](quickstart.md): two working programs — the kernel embedded in
  your process, and the same kernel over HTTP — against the published packages.
- [Every endpoint](endpoints.md): one page naming all five surfaces — the HTTP
  routes, the MCP methods, the tool catalog, the embedded API, and the one
  outbound call — with the capability space they all resolve to.
- [HTTP API reference](http-api.md): every route, request body, status code, and
  header, plus where authentication enters.
- [Tool catalog](tools.md): the twelve `files` tools, the five `repo` tools, the
  two standard tools outside them, the three availability gates, and how to register native or MCP
  tools of your own.
- [MCP toolshare](mcp-toolshare.md): the permission-filtered catalogue as an MCP
  server, the boundary presented to Codex, Claude Code, DeepSeek Harness, and Pi.
- [MCP API reference](mcp-api.md): that boundary on the wire — both transports,
  every method, and the harness configuration each CLI expects.
- [Reason and error codes](errors.md): what every denial and failure means, and
  what to change in response.
- [Kernel conformance manifest](conformance/kernel-conformance.md): every row of
  the conformance matrix as an attempted violation, what refused it, and the
  case-set, world-set and prompt-set hashes a run is compared on. Generated by
  `pnpm conformance` and gated by `pnpm check`.
- [Systems cost](conformance/systems-cost.md): what enforcement costs apart from
  what the model costs, generated by `pnpm bench`.
- [Architecture](architecture.md): responsibilities, packages, fixed security
  envelope, pluggable runtimes, resource providers, and deployment shapes.
- [Host integration guide](host-integration.md): practical embedded and remote
  setup for files, live tools, grants, one-turn execution, and production ports.
- [Permission model](security/permission-model.md): normative authorization
  invariants and grant evaluation.
- [Threat model](security/threat-model.md): trust boundaries, attack surfaces,
  required controls, and non-goals.
- [Release readiness](release-readiness.md): explicit npm and production gates.
- [npm release runbook](npm-release.md): package validation, first publication,
  trusted publishing, and registry verification.
- [API reference](api/README.md): generated reference for every public package.
- [Changelog](../CHANGELOG.md): what changed between prereleases, and what a host
  has to update.

## Host integrations

- [Aicoo](integrations/aicoo.md): embedded adoption and provider migration.
- [Pulse migration](integrations/pulse-migration.md): concrete files, tools, and
  one-turn cutover plan.
- [PACT](integrations/pact.md): isolated worlds, execution adapters, and the
  experiment scheduler boundary.

## Architecture decisions

- [ADR 0001: Use a library-first runtime](adr/0001-library-first-runtime.md)
- [ADR 0002: Keep production storage in the host](adr/0002-host-owned-storage.md)
- [ADR 0003: Execute one turn and leave scheduling to the host](adr/0003-scheduler-boundary.md)
- [ADR 0004: Canonical resource path segments](adr/0004-canonical-resource-path-segments.md)
- [ADR 0005: Files are the canonical resource plane](adr/0005-files-resource-plane.md)
- [ADR 0006: Standardize the tool namespace control plane](adr/0006-tool-namespace-control-plane.md)
- [ADR 0007: Put replaceable runtimes inside a fixed security envelope](adr/0007-pluggable-runtime-security-envelope.md)
- [ADR 0008: Validate the complete delegation chain before use](adr/0008-delegation-chain-validation.md)
- [ADR 0009: Load authority from a trusted grant source, never from a context](adr/0009-trusted-grant-source.md)
- [ADR 0010: Resolve authority once per turn](adr/0010-per-turn-authority.md)
- [ADR 0011: Escalation is a terminal outcome, not a denial](adr/0011-escalation-terminal-outcome.md)
- [ADR 0012: One refusal vocabulary at both enforcement boundaries](adr/0012-one-refusal-vocabulary.md)
- [ADR 0013: The conformance matrix is the case set](adr/0013-matrix-is-the-case-set.md)
- [ADR 0014: MCP is the toolshare boundary](adr/0014-mcp-toolshare.md)
- [ADR 0015: One message purpose and recipient-owned execution](adr/0015-message-purpose-and-recipient-execution.md)
- [ADR 0016: Expiry is instant-bound, revocation is snapshot-bound](adr/0016-expiry-is-instant-bound.md)
- [ADR 0017: What a driver may declare about its own turn](adr/0017-driver-declared-turn-control.md)
- [ADR 0018: Escalation over MCP is recovered from the call, not returned by it](adr/0018-escalation-over-mcp.md)
- [ADR 0019: An escalation names the authority it needs](adr/0019-escalation-names-the-authority-it-needs.md)
- [ADR 0020: The host ceiling is a port, not a convention](adr/0020-host-ceiling-is-a-port.md)
- [ADR 0021: An agent card, with reach computed at read time](adr/0021-agent-card-reach-computed-at-read-time.md) (proposed)
- [ADR 0022: A precedent proposes; the kernel decides whether it may](adr/0022-precedent-proposes-the-kernel-admits.md) (proposed)
- [ADR 0023: Every refusal reaches audit, and the record names the boundary](adr/0023-every-refusal-reaches-audit.md)
- [ADR 0024: Git is its own resource namespace, and the vetted subset is a provider](adr/0024-git-is-its-own-resource-namespace.md) (proposed)
- [ADR 0025: A route lease is not an authority lease](adr/0025-route-lease-is-not-authority.md) (proposed)
- [ADR 0026: The effective catalogue is resolved once per turn](adr/0026-catalogue-resolved-once-per-turn.md)

## Project governance

- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
- [Open items for review](open-items.md) — declared surface kept pending a
  decision, with the decision each needs

The repository is in `1.0.0` preview development. If code and documentation disagree on a
security invariant, treat that as a defect: do not weaken enforcement silently.
