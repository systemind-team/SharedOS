# Host integration guide

This guide is for a product or benchmark that wants to run agents through
SharedOS. It describes the production boundary; the complete executable example
is in [`examples/quickstart`](../examples/quickstart/src/index.ts).

## What you are integrating

SharedOS is the permission and one-turn execution layer between an agent and the
state it wants to use. A host keeps its existing product, storage, model
provider, credentials, and scheduler, then supplies those capabilities through
SharedOS ports.

```text
host identity + policy + state
             |
             v
     trusted AccessContext
             |
             v
 SharedOS kernel + SharedOSExecutor
      |                 |
      v                 v
 files / live tools   agent driver
```

SharedOS does not become the source of truth for users or data. It owns the
portable contracts and the decision that a particular actor may perform a
particular action for a particular purpose. The host owns the facts used to
construct that decision.

## Current package status

The intended one-install entry point is `@aicoo/sharedos`, with individual
`@aicoo/sharedos-*` packages available for hosts that need a smaller dependency
surface. The packages are public `0.x` releases on npm; the contracts are not
yet stable or production-hardened.

For development, clone this repository and either use workspace dependencies or
create verified local tarballs:

```bash
pnpm install
pnpm pack:preview
```

The tarballs are written to `artifacts/npm/`. Public consumers install with
`npm install @aicoo/sharedos`, which takes the release npm's `latest` tag points
at; the remaining production gates are tracked in
[release readiness](release-readiness.md).

## Choose an integration shape

### Embedded runtime

Use the packages in the host process. This is the preferred shape for products
that already own transactions, persistence, and model calls.
There is no extra network hop, and the host can implement providers directly
over its existing services.

### Remote runtime

Expose the same kernel through `@aicoo/sharedos-http` and call it with
`@aicoo/sharedos-client`. Use this when process or language isolation matters more
than the additional deployment boundary. Transport authentication identifies
the caller; it does not replace SharedOS capability authorization.

Evaluation harnesses use a third, related shape: the runner owns the experiment
loop and calls an embedded or remote SharedOS adapter once per tick. SharedOS
still executes only one bounded turn.

## Embedded integration, step by step

### 1. Resolve a trusted access context

For every request, the host resolves identity, namespace settings, and time from
trusted server-side state. An access context carries no authority:

```ts
import type { AccessContext } from "@aicoo/sharedos";

const context: AccessContext = {
  namespaceId: "tenant-acme",
  actor: { kind: "agent", agentId: "researcher" },
  authority: { kind: "human", userId: "owner-1" },
  owner: { kind: "human", userId: "owner-1" },
  purpose: "prepare-investor-update",
  traceId: crypto.randomUUID(),
  enabledToolNamespaces: ["files", "calendar"],
  now: new Date().toISOString(),
};
```

Do not deserialize an `AccessContext` supplied by a model, message payload, or
untrusted client and treat it as trusted identity. In particular:

- `actor` is the principal performing the operation;
- `authority` is the issuer whose grants are being exercised;
- `owner` scopes the target resources;
- `namespaceId` isolates the tenant or benchmark world;
- `purpose`, time, expiry, and usage limits participate in authorization;
- `enabledToolNamespaces` comes from host-owned settings.

### 1b. Implement the trusted grant source

Authority enters SharedOS only through a `GrantSource`, which every kernel
requires. The kernel calls it once per turn, so a grant _revoked_ while a turn is
running is observed by the next turn. A grant that _expires_ while a turn is
running is refused inside it: the expiry is already on the grant the turn holds,
so honouring it needs no second load. See
`docs/adr/0016-expiry-is-instant-bound.md`.

```ts
import type { GrantSource } from "@aicoo/sharedos";

const grantSource: GrantSource = {
  async load(access, signal) {
    // Answer from the issuing store, never from anything the caller supplied.
    return grantStore.activeGrantsFor(
      {
        namespaceId: access.namespaceId,
        subject: access.actor,
        issuer: access.authority,
      },
      { signal },
    );
  },
};
```

The contract is narrow on purpose:

- return only grants issued to `access.actor` by `access.authority` inside
  `access.namespaceId`; anything else is treated as an unavailable source, not
  as partial authority;
- **do not apply policy here.** Return the grants the actor holds. Product or
  organization policy that narrows what those grants may do belongs in a
  `HostCeiling` (below); withholding a grant instead makes the kernel record
  `no_matching_grant` for a call a grant did authorize, which is a false
  statement in your own audit trail and the reason denial counts cannot be
  trusted without this rule;
- return material that satisfies `CapabilityGrantSchema`, including signature or
  revocation verification the host requires;
- throw when the store is unreachable. SharedOS converts that into a fail-closed
  `authority_unavailable` denial and never falls back to a cached set.

A host that issues delegated grants also installs a `DelegationChainResolver`
so ancestors can be re-resolved; see
`docs/adr/0008-delegation-chain-validation.md`.

That rule holds because `AuthoritySnapshot.hash` identifies **authority held**,
not authority usable. A request-dependent filter in the source would make the
snapshot depend on the call, which is the property ADR 0010 relies on for one
snapshot per turn. The trade is worth naming: a snapshot now lists grants a
ceiling may refuse, so an auditor reading a snapshot alone overstates what the
turn could do, and must read the decisions too.

#### The host ceiling

Judgment a grant cannot express — a relationship model, a content-sensitivity
check, an org-wide freeze — goes here:

```ts
const kernel = new SharedOSKernel({
  grantSource: stores,
  authorizer: new CapabilityAuthorizer({
    usageStore: stores,
    hostCeiling: {
      // Synchronous by contract: no network call, no database read, no model
      // call on the authorization path. Load policy into memory and refresh it
      // on your own schedule.
      narrow: (decision, request) =>
        frozenNamespaces.has(request.resource.namespace)
          ? { allowed: false, reasonCode: "host_policy_denied", metadata: { rule: "freeze" } }
          : decision,
    },
    // The ceiling lives here, not on the kernel, so the kernel's own
    // `onProviderError` cannot reach it. Pass the same function to both.
    onProviderError: (error, op) => logger.error({ err: error, ...op }, op.reasonCode),
  }),
});
```

Return the decision you were given, or a `HostPolicyDenial`: `allowed: false`,
`reasonCode: "host_policy_denied"`, and whatever you want to say in `metadata`.
The types admit nothing else — `narrow` takes an `AllowedDecision`, so a denial
cannot be passed in, and returns a `HostCeilingVerdict`, so a code cannot be
authored — and anything else at runtime fails closed as
`host_policy_unavailable`, including an `async narrow`, whose promise has no
`allowed` to read, and a branch that falls off the end.

It is consulted only on a grant that would otherwise allow, so it can narrow and
never widen, and it is consulted before a bounded use is consumed, so a refused
call does not spend one. Its refusal is recorded as `host_policy_denied` with
the `grantId` it overrode — separable from `no_matching_grant` in every count,
and not marked `failClosed`, because a deliberate refusal is not an outage. A
host outside TypeScript that returns some other `reasonCode` has it replaced;
`metadata` is preserved as written. `consumed` and `failClosed` are fields of
the audit event, which the kernel states itself and a ceiling's metadata cannot
reach.

A ceiling whose policy lives in a database does not close over a stale copy
and does not read the store on the authorization path. It installs a
`PolicySource` on the kernel, beside the grant source, and reads what that
loaded as `narrow`'s fourth argument:

```ts
interface FolderPolicy {
  readonly frozen: ReadonlySet<string>;
}

const kernel = new SharedOSKernel({
  grantSource: stores,
  // Loaded once per turn, in flight beside the grant load, and held for the
  // turn: a decision inside it never reads the store. Throw on an outage.
  policySource: {
    load: async (access, signal): Promise<LoadedPolicy<FolderPolicy>> => {
      const { revision, folders } = await policyDb.frozenFolders(access.owner, { signal });
      // `version` is the one thing SharedOS reads: your own name for what was
      // loaded, recorded on every catalogue listing in the turn.
      return { policy: { frozen: new Set(folders) }, version: `frozen-folders@${revision}` };
    },
  },
  authorizer: new CapabilityAuthorizer({
    usageStore: stores,
    hostCeiling: {
      // `policy` is what `load` returned, exactly as returned -- not cloned,
      // because SharedOS does not know its shape. It is `undefined` when no
      // source is installed, which is how the closure above stays valid.
      narrow: (decision, request, _context, policy: FolderPolicy | undefined) =>
        policy?.frozen.has(request.resource.path[0] ?? "") === true
          ? {
              allowed: false,
              reasonCode: "host_policy_denied",
              metadata: { rule: "folder-freeze" },
            }
          : decision,
    } satisfies HostCeiling<FolderPolicy>,
  }),
});
```

The pairing is yours: SharedOS cannot check that the type a ceiling expects is
the type its source produced. A source that throws fails the turn's policy
closed — every decision the ceiling would have made is refused
`host_policy_unavailable`, `narrow` is never called, and the error goes to the
kernel's `onProviderError` as `kind: "policy"`, once per turn. A result without
a `version` is treated the same way. A cancelled load re-throws the abort
instead. Every `authority.resolved` event says which case the turn was:
`hostPolicy: "loaded"`, `"unavailable"`, or `"absent"` when no source is
installed, and every `tool.catalog.listed` event in the turn carries the
`version` a loaded source stated as `hostPolicyVersion`, beside `authorityHash`
and `catalogHash`, so a catalogue can be pinned to the policy state it was
decided against.

Two things it does not cover, and both are yours to close:

- **Namespace availability.** `enabledToolNamespaces` still carries the user's
  own settings choice, and a namespace withheld by _policy_ is still invisible.
  Routing it through the ceiling is the intended direction and is **not possible
  yet**: `listTools` filters on namespace before it asks the authorizer, so a
  disabled namespace never reaches the port, and `narrow` is shown a resource
  namespace rather than a tool namespace. ADR 0020 records this as an open
  question.
- **Anything upstream of the kernel.** A gate that has to call a model cannot be
  this port. Run it where you run it, and emit its verdict to the same
  `AuditSink` with the same vocabulary, or that refusal is missing from the
  record.

### 2. Adapt host state to the `files` resource plane

SharedOS uses one canonical `files` namespace. Memory, workspace, identity,
history, raw evidence, and curated knowledge are roles or roots inside that
file tree—not separate permission systems.

Implement `ResourceProvider` over the host's existing storage:

```ts
import type { ResourceProvider } from "@aicoo/sharedos";

const files: ResourceProvider = {
  namespace: "files",
  async invoke(operation, signal) {
    signal.throwIfAborted();
    return hostFiles.invoke({
      namespaceId: operation.context.namespaceId,
      owner: operation.resource.owner ?? operation.context.owner,
      path: operation.resource.path,
      action: operation.action,
      input: operation.input,
      signal,
    });
  },
};
```

The provider maps SharedOS actions onto host behavior:

| Read surface                             | Mutation surface                        | Recovery surface                                       |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `list`, `stat`, `read`, `search`, `grep` | `create`, `replace`, `append`, `delete` | `snapshot:create`, `snapshot:list`, `snapshot:restore` |

The provider must preserve tenant isolation, canonicalize paths beneath its
configured root, reject symlink or traversal escapes, implement version checks
for concurrent writes, and return JSON-safe `ResourceResult` values. Search
indexes and model context mounts must preserve the grants of their source files.

### 3. Build the kernel and register file tools

```ts
import { CapabilityAuthorizer, SharedOSKernel, registerStandardOsTools } from "@aicoo/sharedos";

const kernel = new SharedOSKernel({
  grantSource,
  authorizer: new CapabilityAuthorizer({
    usageStore: durableGrantUsageStore,
    grantVerifier: durableGrantVerifier,
  }),
  // Every record carries its own `id`. A sink that deduplicates -- a retried
  // batch, a replayed outbox -- keys on it, never on a hash of the content:
  // one turn can ask the same question twice, and both answers are records.
  audit: durableAuditSink,
  toolNamespaceSettings,
  toolProviders: [userMcpToolProvider],
  // Durable host ports. The router returns only a reply accepted from the
  // run's message log; it does not fabricate an envelope from model output.
  messageTransport: durableMessageLog,
  messageRequestRouter: durableReplyRouter,
  createMessageId: () => crypto.randomUUID(),
  // Where a throw from any of the ports above goes. Without it, one of them
  // failing is reported to the agent as a reason code and to you as nothing;
  // see [Diagnosing a contained throw](errors.md#diagnosing-a-contained-throw).
  onProviderError: (error, op) => logger.error({ err: error, ...op }, op.reasonCode),
});

kernel.registerResourceProvider(files);
registerStandardOsTools(kernel, { files });
```

Registering the provider enables direct resource operations. Registering the
standard tools exposes the same operations as model-callable tools such as
`files.search` and `files.append`. Neither registration grants access.

A host that vets a Git subset registers it the same way, as a second provider
whose namespace is `repo`: `kernel.registerResourceProvider(repo)` and
`registerStandardOsTools(kernel, { files, repo })`. The two planes may address
the same directory and share no authority — a file grant over a working tree
grants nothing under `repo`, and the reverse — so a host issues commit authority
deliberately instead of inheriting it from file access
([ADR 0024](adr/0024-git-is-its-own-resource-namespace.md)).

The in-memory stores from `@aicoo/sharedos-testkit` are useful for tests and
isolated experiment worlds. They are not production persistence.

When both message ports are configured, the kernel adds the canonical
`messages.request` tool to each effective turn catalog. Enable the `messages`
tool namespace and issue a recipient-scoped `sharedos.messaging` + `send`
grant. The model supplies only `recipient` and JSON-safe `payload`; SharedOS
copies sender, purpose, trace, timestamp, and message id from trusted context,
consumes the exact send capability once, and validates the correlated reply.

The transport and router do not make SharedOS a scheduler. After durable
acceptance, the host wakes the recipient and invokes another SharedOS turn with
the recipient as both `context.actor` and `request.agent`. That recipient needs
its own `sharedos.execution` + `invoke` grant and its own file or tool grants.
The reply is another authorized envelope whose `replyTo` names the immutable
request id.

### 4. Grant the minimum authority

A grant binds subject, issuer, namespace, purpose, time constraints, resource
scope, and actions. For example, this capability allows semantic search below
one project root, but does not allow reading another root or changing a file:

```ts
const projectSearch = {
  resource: {
    namespace: "files",
    path: ["Work", "Projects", "sharedos"],
    owner: { kind: "human", userId: "owner-1" },
  },
  actions: ["search"],
  scope: "descendants",
} as const;
```

Invoking the target agent is a separate capability. Use
`agentExecutionCapability(targetAgent, owner)` when issuing that grant. A
message addressed to the target agent is never sufficient by itself.

Asking for a human is a capability too. Register the affordance once, enable
the `sharedos` tool namespace for the contexts that may use it, and grant it to
the agents that may ask:

```ts
import { createEscalationTool } from "@aicoo/sharedos";

kernel.registerTool(createEscalationTool());

const mayEscalate = {
  resource: {
    namespace: "sharedos",
    path: ["escalation"],
    owner: { kind: "human", userId: "owner-1" },
  },
  actions: ["request"],
  scope: "exact",
} as const;
```

An agent without that grant does not see `sharedos.escalate` in its catalogue
and cannot escalate. The tool is never executed — a driver ends the turn on the
name — so the handler only fails if a driver forwards the call; see
[kernel-supplied tools](tools.md#kernel-supplied-tools).

#### Ports a grant can need

Two grant features do not work on a default authorizer, and both fail closed
rather than loudly: a grant is issued, everything about it looks right, and every
call it should have allowed is denied.

| Grant feature             | Port needed          | Without it                                |
| ------------------------- | -------------------- | ----------------------------------------- |
| `constraints.maxUses`     | `usageStore`         | denies with `usage_store_unavailable`     |
| `parentGrantId` (derived) | `delegationResolver` | denies with `delegation_chain_unverified` |

```ts
const authorizer = new CapabilityAuthorizer({
  usageStore: new InMemoryGrantUsageStore(), // single process only
  delegationResolver,
});
```

`InMemoryGrantUsageStore` is process-local and suitable for tests and
single-process hosts; a distributed host owes a durable compare-and-set store,
because a bounded grant is only bounded if two nodes cannot both spend its last
use. Both denials carry `missingDependency` on the audit record naming the port
that was absent, so this is diagnosable from the trail rather than by inspection.

A usage store may also implement `release(namespaceId, grantId)`: an atomic
decrement that stops at zero. The kernel calls it when the decision that spent a
use could not be recorded, so the call never ran. Without it that use stays
spent.

**A denial you did not expect is answered by the audit record, not the response
body.** The reason codes collapse deliberately — `no_matching_grant` covers nine
causes and `authority_unavailable` covers four — so that a caller cannot map the
permission topology by reading refusals. The host is not the caller: every
denial records `grantsResolved` and a `rejectedGrants` array naming each grant
and the first condition it failed. Wire an `audit` sink before you need it. See
[errors](errors.md).

### 5. Add native, connector, or MCP tools

Live systems such as calendar, email, GitHub, and Notion remain tools because
their state must be observed—or changed—at execution time. The host owns OAuth,
credentials, MCP connections, and the implementation of each `ToolHandler`.

Use `kernel.registerTool` for static, process-wide tools. Use a
`ContextToolProvider` for user-specific or dynamically discovered catalogs so
one user's MCP reload cannot mutate another user's tool registry.

Every tool declares:

- a globally stable tool name, such as `notion.search`;
- a logical namespace, such as `notion`;
- a source, such as `native` or `mcp`;
- a read/write classification, and `annotations.idempotent` where it applies.
  Both are conservative and both are load-bearing: they decide whether a turn
  that ended early is reported `retryable`
  (see [Before you retry a turn](errors.md#before-you-retry-a-turn));
- an input schema;
- a capability ceiling for discovery;
- preferably, `resolveRequirement`, which derives the exact resource and action
  from validated call arguments immediately before invocation.

A Notion MCP connection can therefore be mounted safely, but connecting it and
authorizing it are different operations. A typical search call is usable only
when all of the following are true:

```text
the host registered this user's Notion handler
AND the `notion` namespace is enabled
AND a matching `notion` resource/action grant exists
AND the exact argument-selected page or database is still authorized
```

For example, the host can grant search on one database without granting page
updates. Similarly, a calendar namespace can expose free/busy reads while event
details, event creation, and event deletion remain separately scoped actions.

### 6. Select a runtime and execute exactly one bounded turn

For the standard loop, the host implements `AgentTurnDriver`, seats it with
`createStandardRuntime`, and places that plugin inside `SharedOSExecutor`:

```ts
import { SharedOSExecutor, createStandardRuntime } from "@aicoo/sharedos";

const runtime = createStandardRuntime({ driver: agentDriver });
const turns = new SharedOSExecutor(kernel, runtime, {
  defaultMaxSteps: 16,
  defaultMaxToolCalls: 16,
  defaultTimeoutMs: 120_000,
});

const visibleTools = await kernel.listTools(context);
const result = await turns.execute({
  version: "1",
  executionId: crypto.randomUUID(),
  agent: targetAgent,
  context,
  message,
  tools: [...visibleTools],
});
```

For an inbound Bob → Alice message, `targetAgent` and `context.actor` are both
Alice. The envelope sender remains Bob for provenance; it is not the actor whose
grants are used by Alice's turn. Purpose and trace must match the trusted
recipient context.

The driver receives the same full `ToolDefinition`s the request listed,
`requiredCapability` included. That field is the discovery ceiling, not what a
call will be authorized against, and it is not something a model should be
told: a driver that talks to a model provider projects first with
`publishToolCatalog`, which yields the `PublishedToolDefinition` the MCP
boundary serves. `StandardTurnDriver` sends less still: a name, a description and
the input schema. The
[HTTP reference](http-api.md#get-v1tools) states the same rule for
`GET /v1/tools`.

A vendor CLI that keeps its own loop (Codex, Claude Code, DeepSeek Harness, Pi)
ships seated. `createMcpHarnessRuntime` starts the CLI for the turn and serves it
the same permission-filtered catalogue over MCP; see
[MCP toolshare](mcp-toolshare.md#the-installed-clis). A private harness implements
`RuntimePlugin`. Either way, select the runtime from trusted host configuration:

```ts
import { RuntimeRegistry, SharedOSExecutor } from "@aicoo/sharedos";
import { CODEX_MCP_HARNESS, createMcpHarnessRuntime } from "@aicoo/sharedos-adapters/node";

const codexRuntime = createMcpHarnessRuntime(CODEX_MCP_HARNESS);
const runtimes = new RuntimeRegistry([standardRuntime, codexRuntime, privateRuntime]);
const runtime = runtimes.resolve(serverPolicy.runtimeId);
const turns = new SharedOSExecutor(kernel, runtime);
```

Do not resolve `runtimeId` directly from a message, model output, or unverified
request metadata. A runtime receives a frozen, sanitized context without grants
or issuing authority. The envelope admits the target-agent invocation, filters
discovery, and re-authorizes every exact tool call through `RuntimeHost`. A turn
ends when the runtime completes, escalates or fails, the deadline expires, the
host cancels it, or the audit sink fails on a record that must precede an effect,
which ends it `failed` with `audit_unavailable`. The standard runtime additionally
enforces its driver step limit; a harness runtime declares no step and is bounded
by `defaultMaxToolCalls`.

Set `drainGraceMs` on the executor if your handlers have side effects. The turn
then stops taking new calls that long before its deadline, so a handler already
running answers with its real outcome rather than being cut half-way; one still
running at the deadline is recorded `interrupted`. Before retrying a turn that
ended early, read `retryable` on its error: it is `false` once a call that may
have taken effect cannot safely be repeated. See
[Turns](errors.md#turns).

SharedOS does not decide when an entire agent network is complete. Runtime
coordination, adaptive routing, retries, budgets, and network-level stopping
belong to the host scheduler, which may invoke another bounded turn after
examining the result and events.

## Why namespace enablement is not permission

Tool availability has three independent gates:

```text
usable tool = registered for this context
              AND namespace enabled
              AND capability allowed
```

Namespace settings are the product control plane: they answer whether a family
of tools should appear in this context. Capabilities are the authority plane:
they answer which exact resources and actions the actor may use. SharedOS
filters discovery and checks invocation again so neither a stale catalog nor a
model-authored call can bypass the second gate.

If the product allows users to change namespace settings, implement
`ToolNamespaceSettingsStore.applyUpdate` as an atomic update over fresh state.
The store may narrow a request according to organization policy, but must not
widen it.

## Remote integration

On the server, wrap the same kernel and turn executor:

```ts
import { createKernelSharedOSApi, createSharedOSHandler } from "@aicoo/sharedos";

const api = createKernelSharedOSApi({ kernel, turns });
const handle = createSharedOSHandler({
  api,
  resolveContext: async (request) => resolveTrustedContextFromSession(request),
});
```

On the caller, use `SharedOSClient`. It has one method per route and
validates every response against the same schema the server used:

```ts
import { SharedOSClient } from "@aicoo/sharedos";

const sharedos = new SharedOSClient({
  baseUrl: "https://sharedos.internal.example",
  // A value, or an async function so a short-lived token is minted per call.
  headers: async () => ({ authorization: `Bearer ${await serviceIdentityToken()}` }),
});
```

The HTTP server must derive `AccessContext` from authenticated server-side
state. Never accept the authorization context from the remote JSON body.

Every route, request shape, and status code is listed in the
[HTTP API reference](http-api.md).

## Production responsibilities that remain in the host

Before production use, the host must provide:

- authenticated identity and tenant resolution;
- a durable `GrantSource`, revocation verification, and atomic bounded-grant
  usage;
- isolated file and tool providers with cancellation-safe side effects;
- durable tool namespace settings and credential isolation;
- durable, append-only audit storage and operational alerting;
- a diagnostic sink on `onProviderError`, so a failing provider, transport, or
  router is debuggable: the kernel answers the agent with a reason code and
  keeps the thrown error off the wire deliberately, which leaves that hook as
  the only place the cause appears;
- replay and idempotency controls around externally visible mutations;
- model-driver limits, product scheduling, retries, budgets, and stopping;
- consent, policy administration, retention, deletion, and incident response.

See the [permission model](security/permission-model.md) and
[threat model](security/threat-model.md) before exposing writes or external
tools.

## Adoption checklist

1. Select embedded or remote deployment and record the SharedOS version.
2. Map product identities to structured addresses and choose the world or
   tenant `namespaceId` boundary.
3. Implement the trusted `AccessContext` resolver.
4. Adapt existing knowledge and working state to one `files` provider.
5. Register built-in, native, and context-specific MCP tools.
6. Persist enabled tool namespaces independently from grants.
7. Issue least-authority grants, including a separate target-agent invocation
   grant.
8. Select a trusted `RuntimePlugin`; use the standard loop with a bounded
   `AgentTurnDriver` when the reference loop is sufficient.
9. Add allowed and denied conformance tests for every permission-bearing path.
10. Record runtime id/version separately from model and execution backend, and
    keep network scheduling outside SharedOS.
11. Run `pnpm check` and test cancellation, replay, revocation, audit failure,
    broker closure, and tenant isolation before enabling production writes.

Host-specific mappings live outside this guide: they depend on how your product
already models storage, identity, and tools.
