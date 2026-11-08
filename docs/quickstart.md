# Quickstart

Two working programs: one that embeds the kernel in your own process, and one
that talks to it over HTTP. Both run against the published packages — nothing
in this page requires a clone of this repository.

```bash
npm install @aicoo/sharedos
```

Node.js 22.19 or newer. The packages are ESM-only. Every SharedOS package is a
`1.0.0` preview, so pin an exact version if you need reproducibility.

## What you have to bring

SharedOS decides whether an action is allowed. It never stores your data, calls
your model, or holds your credentials. A first integration therefore supplies
three things, and only the first is required to see anything work:

| You supply             | Interface                                                                                                                         | Needed for                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Somewhere to put files | `ResourceProvider`                                                                                                                | Any `files` operation at all            |
| A model, or a script   | `AgentTurnDriver`                                                                                                                 | Running a turn rather than single calls |
| Durable stores         | `GrantSource`, `GrantUsageStore`, `CapabilityGrantVerifier`, `DelegationChainResolver`, `ToolNamespaceSettingsStore`, `AuditSink` | Production. Not this page               |

The examples below use an in-memory provider so they run immediately.
[`examples/reference-host`](https://github.com/systemind-team/SharedOS/tree/main/examples/reference-host)
is the same shape backed by a real filesystem and SQLite.

## Embedded: authorize one file read

The whole model in one file. Alice owns some files. Bob's agent may search one
subtree, for one purpose, and nothing else.

```ts
import {
  CapabilityAuthorizer,
  InMemoryGrantUsageStore,
  SharedOSKernel,
  registerStandardOsTools,
  type AccessContext,
  type CapabilityGrant,
  type ResourceProvider,
} from "@aicoo/sharedos";

const alice = { kind: "human", userId: "alice" } as const;
const bobAgent = { kind: "agent", agentId: "bob-assistant" } as const;

// 1. Your storage, behind one interface. Real hosts hit a database here.
const files: ResourceProvider = {
  namespace: "files",
  async invoke(operation, signal) {
    signal.throwIfAborted();
    return {
      operationId: operation.operationId,
      completedAt: new Date().toISOString(),
      status: "succeeded",
      output: { hits: [{ text: "Atlas ships 2026-09-30." }] },
    };
  },
};

// 2. Authority, issued explicitly and scoped on every axis that matters.
const grant: CapabilityGrant = {
  id: "grant-1",
  namespaceId: "acme",
  subject: bobAgent, // who may use it
  issuer: alice, // whose authority it is
  capabilities: [
    {
      resource: { namespace: "files", path: ["Work", "Projects", "atlas"], owner: alice },
      actions: ["search"],
      scope: "descendants",
    },
  ],
  constraints: {
    purposes: ["atlas-status"],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxUses: 3,
  },
  issuedAt: new Date().toISOString(),
};

// 3. A kernel. Registering a provider exposes it; it grants nothing.
//    `grantSource` is required and is the only way authority gets in: the
//    kernel loads it for each turn from your trusted store. A real host queries
//    a database here and throws on an outage — SharedOS turns that into a
//    fail-closed denial rather than falling back to anything.
const issued: CapabilityGrant[] = [grant];
const kernel = new SharedOSKernel({
  grantSource: {
    async load(access) {
      // Answer for this actor and this issuer only. A source that returns a
      // superset is treated as unavailable, not quietly filtered.
      return issued.filter(
        (candidate) =>
          candidate.namespaceId === access.namespaceId &&
          JSON.stringify(candidate.subject) === JSON.stringify(access.actor) &&
          JSON.stringify(candidate.issuer) === JSON.stringify(access.authority),
      );
    },
  },
  // `maxUses` needs somewhere to count. See the next section.
  authorizer: new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() }),
});
kernel.registerResourceProvider(files);
registerStandardOsTools(kernel, { files });

// 4. The trusted context. Build it from server-side state, never from a
//    request body, a message, or model output. It says who is asking, on whose
//    authority, and for what — it carries no grants, so nothing a caller
//    assembles can become authority.
const context: AccessContext = {
  namespaceId: "acme",
  actor: bobAgent, // who is acting
  authority: alice, // whose grants are being exercised
  owner: alice, // whose resources are in scope
  purpose: "atlas-status",
  traceId: crypto.randomUUID(),
  enabledToolNamespaces: ["files"],
  now: new Date().toISOString(),
};

// The catalog is already filtered: `files.search` is visible, the other
// eleven file tools are not, because no grant covers them.
const visible = await kernel.listTools(context);
console.log(visible.map(({ name }) => name)); // [ 'files.search' ]

const allowed = await kernel.invokeTool(context, {
  id: crypto.randomUUID(),
  tool: "files.search",
  arguments: { path: ["Work", "Projects", "atlas"], query: "ship date" },
  traceId: context.traceId,
  requestedAt: new Date().toISOString(),
});
console.log(allowed.status); // 'succeeded'

const denied = await kernel.invokeTool(context, {
  id: crypto.randomUUID(),
  tool: "files.search",
  arguments: { path: ["Work", "Finance"], query: "salary" },
  traceId: context.traceId,
  requestedAt: new Date().toISOString(),
});
console.log(denied.status); // 'denied'
```

Note what the second call proves. Nothing about the request changed except the
path, and the path came from the model's own arguments. The tool was visible,
the namespace was enabled, and it was still refused — because discovery is not
permission, and the exact resource is authorized again at invocation.

### `maxUses` is denied unless you give the kernel somewhere to count

The authorizer above is given an `InMemoryGrantUsageStore` because the grant
sets `maxUses: 3`. Build it as a bare `new CapabilityAuthorizer()` and the
program prints `[]`, `denied`, `denied`: a bounded grant with nowhere to record
usage fails closed rather than silently becoming unbounded, so it makes nothing
discoverable, and both calls are answered `tool_unavailable`. The decision's own
code is `usage_store_unavailable`. `kernel.authorize` returns it, and the audit
trail carries it as the `cause` of the refusal; see
[`tool_unavailable` covers three different situations](errors.md#tool_unavailable-covers-three-different-situations).

In production this must be a durable store whose `tryConsume` is one atomic
statement. Two concurrent turns must not both be allowed to spend the last use.

## Embedded: run one agent turn

Single calls are the floor. The reason to use SharedOS is to hand a whole turn
to a model and still know what it can reach. You supply an `AgentTurnDriver`;
SharedOS gives it the filtered catalog and re-authorizes every call it makes.

```ts
import {
  SharedOSExecutor,
  agentExecutionCapability,
  createStandardRuntime,
  type AgentTurnDriver,
} from "@aicoo/sharedos";

const aliceAgent = { kind: "agent", agentId: "alice-assistant" } as const;

// Annotate the driver. Without it TypeScript widens `type: "tool_call"` to
// `string` and the object stops matching AgentTurnDecision.
const driver: AgentTurnDriver = {
  async open(request) {
    let asked = false;
    return {
      async next(input) {
        if (!asked) {
          asked = true;
          // request.tools is the effective catalog. Hand it to your model as
          // its tool definitions; `inputSchema` is already JSON Schema.
          // request.context.reach says where those tools are worth pointing:
          // the paths some grant covers, with the grant itself left out.
          // describeReach(request.context.reach) renders it as words a model reads.
          return {
            type: "tool_call",
            call: {
              id: crypto.randomUUID(),
              tool: "files.search",
              arguments: { path: ["Work", "Projects", "atlas"], query: "ship date" },
              traceId: request.context.traceId,
              requestedAt: new Date().toISOString(),
            },
          };
        }
        return { type: "complete", output: { saw: input.type } };
      },
    };
  },
};

// Running someone's agent needs its own grant. A message addressed to it is
// never sufficient.
const invokeAlice: CapabilityGrant = {
  ...grant,
  id: "grant-invoke",
  subject: aliceAgent,
  capabilities: [agentExecutionCapability(aliceAgent, alice)],
  constraints: { purposes: ["atlas-status"] },
};

// The recipient needs its own file authority too. The requester's grant does
// not transfer through the message.
const aliceSearch: CapabilityGrant = {
  ...grant,
  id: "grant-alice-search",
  subject: aliceAgent,
};

// The store gains the recipient's grants. The next turn to resolve authority
// sees them — which is also how a revocation lands.
issued.push(invokeAlice, aliceSearch);

const turnContext: AccessContext = {
  ...context,
  actor: aliceAgent,
  traceId: crypto.randomUUID(),
  now: new Date().toISOString(),
};
const tools = await kernel.listTools(turnContext);

const result = await new SharedOSExecutor(kernel, createStandardRuntime({ driver }), {
  defaultMaxSteps: 8,
  defaultMaxToolCalls: 8,
  defaultTimeoutMs: 30_000,
}).execute({
  version: "1",
  executionId: crypto.randomUUID(),
  agent: aliceAgent,
  context: turnContext,
  message: {
    version: "1",
    id: crypto.randomUUID(),
    sender: bobAgent,
    receiver: aliceAgent,
    purpose: turnContext.purpose,
    payload: { text: "When does Atlas ship?" },
    traceId: turnContext.traceId,
    createdAt: new Date().toISOString(),
  },
  tools: [...tools],
});

console.log(
  result.status,
  result.events.map(({ type }) => type),
);
// succeeded [ 'turn.started', 'tool.requested', 'tool.completed', 'turn.completed' ]
```

The driver received `request.context` without grants and without the issuing
authority. It cannot widen its own access, and it cannot reach a tool outside
the catalog it was given — `RuntimeHost.invokeTool` checks the catalog and
re-authorizes before anything runs.

The message sender is Bob, but the trusted turn context actor is Alice, the
executing recipient. Admission and file search therefore use Alice's grants;
Bob's authority is not transferred by the message.

## Remote: the same kernel over HTTP

Expose the kernel when the caller cannot embed it. The contracts are identical;
only the transport changes.

```ts
import { createKernelSharedOSApi, createSharedOSHandler } from "@aicoo/sharedos";

// The executor the embedded example built, kept for the HTTP turn route. The
// kernel and driver are the ones defined above.
const turns = new SharedOSExecutor(kernel, createStandardRuntime({ driver }), {
  defaultMaxSteps: 8,
  defaultMaxToolCalls: 8,
  defaultTimeoutMs: 30_000,
});

const handler = createSharedOSHandler({
  api: createKernelSharedOSApi({ kernel, turns }),

  // The security boundary. Derive identity from your own authenticated
  // server-side state. The request body carries no grants, no tools, and no
  // access context, so a caller cannot describe its own authority.
  async resolveContext(request) {
    const session = await authenticate(request.headers.get("authorization"));
    return {
      namespaceId: session.tenantId,
      actor: session.agent,
      authority: session.authority,
      owner: session.owner,
      purpose: request.headers.get("x-sharedos-purpose") ?? "default",
      traceId: crypto.randomUUID(),
      enabledToolNamespaces: await settings.enabledFor(session),
      now: new Date().toISOString(),
    };
  },
});
```

`createSharedOSHandler` returns a plain `(Request) => Promise<Response>`, so it
mounts anywhere the Fetch API is available:

```ts
// Node 22.19+, Bun, Deno
Deno.serve(handler);
// Next.js app router: app/api/sharedos/[...path]/route.ts
export const GET = handler;
export const POST = handler;
export const PUT = handler;
```

On the caller side:

```ts
import { SharedOSClient } from "@aicoo/sharedos";

const sharedos = new SharedOSClient({
  baseUrl: "https://sharedos.internal.example",
  headers: async () => ({ authorization: `Bearer ${await serviceIdentityToken()}` }),
});

const tools = await sharedos.listTools();
const result = await sharedos.invokeTool({
  id: crypto.randomUUID(),
  tool: "files.search",
  arguments: { path: ["Work", "Projects", "atlas"], query: "ship date" },
  traceId: crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
});
```

`headers` may be a value or an async function, so a short-lived token can be
minted per call. Every route, request shape, and status code is listed in the
[HTTP API reference](http-api.md).

## Four things that will bite a first integration

**`authority` is not the data owner.** It is the issuer whose grants are being
exercised. For a grant Alice issued, that is Alice. For a grant Bob _derived_
from it, that is Bob. Get it wrong and the grant is invisible: the catalogue is empty, a
call is answered `tool_unavailable`, and the decision behind it reads
`no_matching_grant`, identical to having no grant at all.

**Your `GrantSource` must pre-filter.** Answer only for the context's namespace,
actor, and issuing authority. Returning everything and letting the kernel sort it
out is `authority_unavailable`, not partial authority — a source that is loose
about scope is treated as one that is broken.

**Bounded and derived grants fail closed.** `maxUses` needs a `usageStore`;
`deriveGrant` output needs a `delegationResolver`. Without them the kernel denies
rather than assuming, and the decision's reason code, from `kernel.authorize` or
as the `cause` on the audit record, tells you which one is missing.

**A filesystem provider must reject links, not just escapes.** Authorization is
decided on the logical path; your provider serves the physical target. Staying
under your root is not sufficient — a symlink that stays inside the tenant and
points at another subtree voids the grant without SharedOS seeing it. See the
[reference host](https://github.com/systemind-team/SharedOS/tree/main/examples/reference-host).

## Next

- [Every endpoint](endpoints.md) — all five surfaces on one page
- [HTTP API reference](http-api.md) — every route, body, and status code
- [MCP API reference](mcp-api.md) — the same catalog served to a harness
- [Tool catalog](tools.md) — the twelve `files` tools, the two standard tools
  outside them, the three availability gates, and how to register your own
- [Reason and error codes](errors.md) — what a denial means and what to do
- [Host integration guide](host-integration.md) — the production ports
- [Permission model](security/permission-model.md) — the normative invariants
