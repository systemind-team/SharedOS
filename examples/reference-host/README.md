# Reference host

The part SharedOS deliberately does not ship. `examples/quickstart` shows the
smallest call sequence and `examples/fleet-delegation` shows the delegation
rules on their own; this example is a working host — real storage, real durable
stores, and a real agent turn — so a product can copy the shape instead of
inferring it from the port definitions.

```bash
pnpm example:reference-host
```

Set `ANTHROPIC_API_KEY` to drive the same turn with a live model instead of the
scripted driver; `ANTHROPIC_BASE_URL` overrides the endpoint. The example needs
Node.js 22.19 or newer, as SharedOS does; its stores use the built-in
`node:sqlite`.

## What it implements

| File                     | Port                                                                                                                                                                                   | Why it is the host's job                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `filesystem-provider.ts` | `ResourceProvider`                                                                                                                                                                     | All twelve `files` actions over one root, per `(namespace, owner)` tenant, with path safety                                                 |
| `sqlite-stores.ts`       | `GrantSource`, `GrantUsageStore`, `CapabilityGrantVerifier`, `ToolNamespaceSettingsStore`, `AuditSink`, and the `resolveChain` query `index.ts` wraps as the `DelegationChainResolver` | Authority has to come from somewhere durable; bounded uses need an atomic compare-and-set; revocation and audit need to outlive the process |
| `driver.ts`              | `AgentTurnDriver`                                                                                                                                                                      | The model, its tool-calling format, and its credentials belong to the host                                                                  |

It uses `node:sqlite`, so it adds no dependency. A production host would use
its existing database and keep the same statement shapes.

## The four things a first integration usually gets wrong

**Authority enters through the grant source, not the request.** The kernel
requires a `GrantSource` and calls it once per turn. `load` must answer only for
the context's namespace, actor, and issuing authority: a superset is treated as
`authority_unavailable` rather than quietly narrowed, and throwing is the right
answer to an outage.

**Bounded grants fail closed without a usage store.** `maxUses` is denied with
`usage_store_unavailable` when `CapabilityAuthorizer` has no `usageStore`, and
`tryConsume` must be one atomic statement or two concurrent turns both spend
the last use.

**Derived grants fail closed without a chain resolver.** A grant produced by
`deriveGrant` is narrowed at derivation, but revocation and expiry happen
afterwards and live on the ancestors. Without `delegationResolver` every derived
grant is denied with `delegation_chain_unverified`.

**`authority` is not the data owner.** It is the issuer whose grants are being
exercised. For a grant Alice issued, that is Alice; for a grant Bob derived
from it, that is Bob. Get it wrong and the grant is silently invisible —
`no_matching_grant`, indistinguishable from having no grant at all.

## Why the path checks are the provider's problem

Authorization is decided on the logical path, but the provider serves the
physical target. Staying under the tenant root is not sufficient: a symlink
that stays inside the tenant and points at a _different_ subtree voids the
grant without SharedOS ever seeing it. The example plants exactly that link and
prints the result, alongside an in-scope read that must still succeed — a
defence that only ever reports "blocked" proves nothing.

```text
traversal markers in the path          blocked (invalid_tool_arguments)
a separator smuggled into a segment    blocked (invalid_tool_arguments)
a link out of the granted subtree      blocked (path_escape)
an out-of-scope path (control)         blocked (no_matching_grant)
the granted path (must succeed)        allowed
```

The first two are rejected by the contracts before the provider runs. The third
is the provider's own check, and it is the one a new host is most likely to
miss.
