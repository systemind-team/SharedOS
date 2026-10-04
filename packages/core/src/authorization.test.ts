import { describe, expect, it, vi } from "vitest";

import type {
  AccessContext,
  Address,
  AuthorizationDecision,
  CapabilityGrant,
  ResourceRef,
} from "@aicoo/sharedos-contracts";

import type { PolicyResolution, ResolvedAuthority } from "./authority.js";
import {
  type CapabilityGrantVerifier,
  CapabilityAuthorizer,
  type GrantUsageStore,
  type HostCeiling,
  InMemoryGrantUsageStore,
  isInfrastructureDenial,
} from "./authorization.js";

const NOW = "2026-08-03T09:00:00.000Z";
const ACTOR = { kind: "agent", agentId: "agent-bob" } as const;
const AUTHORITY = { kind: "human", userId: "user-alice" } as const;
const OWNER = { kind: "human", userId: "user-alice" } as const;
const RESOURCE: ResourceRef = {
  namespace: "files",
  path: ["Workspace", "projects", "sharedos"],
  owner: OWNER,
};

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "grant-files-read",
    namespaceId: "world-alpha",
    subject: ACTOR,
    issuer: AUTHORITY,
    capabilities: [{ resource: RESOURCE, actions: ["read"], scope: "exact" }],
    constraints: { purposes: ["prepare-update"] },
    issuedAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

function accessContext(namespaceId = "world-alpha"): AccessContext {
  return {
    namespaceId,
    enabledToolNamespaces: [],
    actor: ACTOR,
    authority: AUTHORITY,
    owner: OWNER,
    purpose: "prepare-update",
    traceId: "trace-1",
    now: NOW,
  };
}

/** Authority as the kernel would have resolved it from a trusted source. */
function context(grants: CapabilityGrant[]): ResolvedAuthority {
  return authorityFor(accessContext(), grants);
}

function authorityFor(access: AccessContext, grants: CapabilityGrant[]): ResolvedAuthority {
  return {
    context: access,
    grants,
    snapshot: {
      hash: `snapshot-${grants.map(({ id }) => id).join("+")}`,
      grantIds: grants.map(({ id }) => id),
      grantCount: grants.length,
      loadedAt: access.now,
    },
  };
}

/**
 * The denial nothing matched, together with the description ADR 0019 attaches.
 *
 * Asserted as one thing because the description's safety property only holds
 * jointly: a boundary test whose grant *nearly* matched must still see its own
 * request described and never the near-miss grant. Checking the reason code
 * alone would pass while the field named authority the caller never asked for.
 */
function expectNoMatchingGrant(
  decision: AuthorizationDecision,
  request: { resource: ResourceRef; action: string },
  access: AccessContext = accessContext(),
): void {
  const { requiredAuthority, ...rest } = decision;
  expect(rest).toEqual({ allowed: false, reasonCode: "no_matching_grant" });
  expect(requiredAuthority).toEqual({
    id: expect.stringMatching(/^capreq-[0-9a-f]{64}$/u) as unknown as string,
    namespaceId: access.namespaceId,
    requester: access.actor,
    owner: access.owner,
    purpose: access.purpose,
    requestedAt: access.now,
    capabilities: [{ resource: request.resource, actions: [request.action], scope: "exact" }],
  });
}

describe("CapabilityAuthorizer", () => {
  it("denies by default and allows only an explicit matching grant", async () => {
    const authorizer = new CapabilityAuthorizer();
    const request = { resource: RESOURCE, action: "read" };

    expectNoMatchingGrant(await authorizer.authorize(context([]), request), request);
    await expect(authorizer.authorize(context([grant()]), request)).resolves.toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-files-read",
    });
  });

  it.each([
    ["subject", { subject: { kind: "agent", agentId: "agent-eve" } }],
    ["issuer", { issuer: { kind: "human", userId: "user-mallory" } }],
    ["namespace", { namespaceId: "world-other" }],
    ["purpose", { constraints: { purposes: ["unrelated-purpose"] } }],
    ["not-before", { constraints: { notBefore: "2026-08-04T00:00:00Z" } }],
    ["expired", { constraints: { expiresAt: NOW } }],
    ["revoked", { revokedAt: NOW }],
  ] satisfies ReadonlyArray<readonly [string, Partial<CapabilityGrant>]>)(
    "rejects a grant with a mismatched %s boundary",
    async (_label, overrides) => {
      const request = { resource: RESOURCE, action: "read" };
      const decision = await new CapabilityAuthorizer().authorize(
        context([grant(overrides)]),
        request,
      );

      expectNoMatchingGrant(decision, request);
    },
  );

  it("binds resources to the context owner", async () => {
    const otherOwner: Address = { kind: "human", userId: "user-eve" };
    const decision = await new CapabilityAuthorizer().authorize(context([grant()]), {
      resource: { ...RESOURCE, owner: otherOwner },
      action: "read",
    });

    expect(decision).toEqual({
      allowed: false,
      reasonCode: "invalid_request",
    });
  });

  it("matches descendant paths by segment without matching siblings", async () => {
    const descendantGrant = grant({
      capabilities: [
        {
          resource: {
            namespace: "files",
            path: ["Workspace", "projects", "sharedos"],
          },
          actions: ["grep"],
          scope: "descendants",
        },
      ],
    });
    const authorizer = new CapabilityAuthorizer();
    const access = context([descendantGrant]);

    await expect(
      authorizer.authorize(access, {
        resource: {
          namespace: "files",
          path: ["Workspace", "projects", "sharedos", "README.md"],
        },
        action: "grep",
      }),
    ).resolves.toMatchObject({ allowed: true });

    const sibling = {
      resource: {
        namespace: "files",
        path: ["Workspace", "projects", "sharedos-evil", "README.md"],
      },
      action: "grep",
    };
    expectNoMatchingGrant(await authorizer.authorize(access, sibling), sibling);
  });

  it("does not consume maxUses during inspection and consumes atomically", async () => {
    const access = context([grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } })]);
    const authorizer = new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() });
    const request = { resource: RESOURCE, action: "read" };

    await expect(authorizer.authorize(access, request)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(authorizer.authorize(access, request)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(authorizer.authorize(access, request, { consume: true })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(authorizer.authorize(access, request, { consume: true })).resolves.toEqual({
      allowed: false,
      reasonCode: "grant_exhausted",
    });
  });

  it("accounts for maxUses independently inside each namespace", async () => {
    const authorizer = new CapabilityAuthorizer({ usageStore: new InMemoryGrantUsageStore() });
    const request = { resource: RESOURCE, action: "read" };
    const alphaGrant = grant({
      id: "locally-unique-grant",
      constraints: { maxUses: 1 },
    });
    const betaGrant = grant({
      id: "locally-unique-grant",
      namespaceId: "world-beta",
      constraints: { maxUses: 1 },
    });
    const betaContext = authorityFor(accessContext("world-beta"), [betaGrant]);

    await expect(
      authorizer.authorize(context([alphaGrant]), request, { consume: true }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      authorizer.authorize(betaContext, request, { consume: true }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("fails closed when bounded usage cannot be checked", async () => {
    const unavailableStore: GrantUsageStore = {
      async getUsage() {
        throw new Error("offline");
      },
      async tryConsume() {
        throw new Error("offline");
      },
    };
    const authorizer = new CapabilityAuthorizer({
      usageStore: unavailableStore,
    });
    const access = context([grant({ constraints: { maxUses: 1 } })]);

    await expect(
      authorizer.authorize(access, { resource: RESOURCE, action: "read" }),
    ).resolves.toEqual({
      allowed: false,
      reasonCode: "usage_store_unavailable",
    });
  });

  it("requires an explicit usage store for bounded grants", async () => {
    const access = context([grant({ constraints: { maxUses: 1 } })]);

    await expect(
      new CapabilityAuthorizer().authorize(access, { resource: RESOURCE, action: "read" }),
    ).resolves.toEqual({
      allowed: false,
      reasonCode: "usage_store_unavailable",
    });
  });

  it("keeps adversarial namespace and grant IDs in separate counters", async () => {
    const store = new InMemoryGrantUsageStore();

    await expect(store.tryConsume("tenant-a", "grant\u0000victim", 1)).resolves.toBe(true);
    await expect(store.getUsage("tenant-a\u0000grant", "victim")).resolves.toBe(0);
  });

  it("gives one use back at a time and never counts below zero", async () => {
    const store = new InMemoryGrantUsageStore();

    await store.release("tenant-a", "grant-1");
    await expect(store.getUsage("tenant-a", "grant-1")).resolves.toBe(0);

    await expect(store.tryConsume("tenant-a", "grant-1", 1)).resolves.toBe(true);
    await store.release("tenant-b", "grant-1");
    await expect(store.tryConsume("tenant-a", "grant-1", 1)).resolves.toBe(false);
    await store.release("tenant-a", "grant-1");
    await expect(store.tryConsume("tenant-a", "grant-1", 1)).resolves.toBe(true);
  });

  it("releases nothing for a grant that is not bounded", async () => {
    const release = vi.fn(async () => undefined);
    const usageStore: GrantUsageStore = {
      getUsage: async () => 0,
      tryConsume: async () => true,
      release,
    };
    const authorizer = new CapabilityAuthorizer({ usageStore });
    const unbounded = grant();
    const bounded = grant({ id: "grant-bounded", constraints: { maxUses: 1 } });
    const access = context([unbounded, bounded]);

    await authorizer.release(access, unbounded.id);
    await authorizer.release(access, "grant-unknown");
    expect(release).not.toHaveBeenCalled();

    await authorizer.release(access, bounded.id);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(access.context.namespaceId, bounded.id);
  });

  describe("the operation instant", () => {
    const LATER = "2026-08-03T10:00:00.000Z";
    const EXPIRES_AT = "2026-08-03T09:30:00.000Z";
    const READ = { resource: RESOURCE, action: "read" } as const;

    it("decides expiry at the operation instant rather than the turn's", async () => {
      const authorizer = new CapabilityAuthorizer();
      const expiring = grant({
        constraints: { purposes: ["prepare-update"], expiresAt: EXPIRES_AT },
      });
      const authority = context([expiring]);

      await expect(authorizer.authorize(authority, READ)).resolves.toMatchObject({
        allowed: true,
      });
      // `requestedAt` follows the context instant, not the operation instant:
      // the description says when the turn asked, which is what a reviewer's
      // queue orders on.
      expectNoMatchingGrant(await authorizer.authorize(authority, READ, { now: LATER }), READ);
    });

    it("keeps revocation at the turn's instant, where the store edit was not seen", async () => {
      const authorizer = new CapabilityAuthorizer();
      // Recorded in the store after this turn was admitted. The turn holds the
      // grant as it was loaded, so a later operation is still authorized.
      const revoked = grant({ revokedAt: EXPIRES_AT });

      await expect(
        authorizer.authorize(context([revoked]), READ, { now: LATER }),
      ).resolves.toMatchObject({ allowed: true });
    });

    it("keeps a validity window from opening at the operation instant", async () => {
      const authorizer = new CapabilityAuthorizer();
      const pending = grant({
        constraints: { purposes: ["prepare-update"], notBefore: EXPIRES_AT },
      });

      expectNoMatchingGrant(
        await authorizer.authorize(context([pending]), READ, { now: LATER }),
        READ,
      );
    });

    it("filters discovery at the operation instant too", async () => {
      const authorizer = new CapabilityAuthorizer();
      const expiring = grant({
        constraints: { purposes: ["prepare-update"], expiresAt: EXPIRES_AT },
      });
      const ceiling = {
        resource: { namespace: "files", path: ["Workspace"], owner: OWNER },
        action: "read",
      };

      await expect(authorizer.canDiscover(context([expiring]), ceiling)).resolves.toMatchObject({
        allowed: true,
      });
      // Exact equality, and it is the assertion: discovery carries no
      // description. The requirement here is the tool's declared ceiling, which
      // is broader than any call, so describing it would ask a reviewer to issue
      // more authority than an operation needed (ADR 0019).
      await expect(
        authorizer.canDiscover(context([expiring]), ceiling, { now: LATER }),
      ).resolves.toEqual({ allowed: false, reasonCode: "no_matching_grant" });
    });

    it("invalidates a descendant when its ancestor expires mid-turn", async () => {
      const parent = grant({
        id: "grant-root",
        subject: AUTHORITY,
        constraints: {
          purposes: ["prepare-update"],
          delegationDepth: 1,
          expiresAt: EXPIRES_AT,
        },
      });
      const child = grant({
        id: "grant-derived",
        parentGrantId: "grant-root",
        constraints: { purposes: ["prepare-update"], expiresAt: EXPIRES_AT },
      });
      const authorizer = new CapabilityAuthorizer({
        delegationResolver: { resolve: async () => parent },
      });

      await expect(authorizer.authorize(context([child]), READ)).resolves.toMatchObject({
        allowed: true,
      });
      // The child is refused on its own expiry before the chain is walked, so
      // widen its window and leave the ancestor's closed: the denial is then
      // attributable to the ancestor.
      const outlivingChild = { ...child, constraints: { purposes: ["prepare-update"] } };
      await expect(
        authorizer.authorize(context([outlivingChild]), READ, { now: LATER }),
      ).resolves.toMatchObject({
        allowed: false,
        reasonCode: "delegation_chain_invalid",
        metadata: { delegation: { code: "parent_inactive", grantId: "grant-root" } },
      });
    });

    it("refuses an unparsable operation instant rather than deciding at the turn's", async () => {
      const authorizer = new CapabilityAuthorizer();

      await expect(
        authorizer.authorize(context([grant()]), READ, { now: "not-an-instant" }),
      ).resolves.toEqual({ allowed: false, reasonCode: "invalid_context" });
    });
  });

  it("supports host verification of trusted grant material", async () => {
    const rejectAll: CapabilityGrantVerifier = {
      async verify() {
        return false;
      },
    };
    const authorizer = new CapabilityAuthorizer({ grantVerifier: rejectAll });

    const request = { resource: RESOURCE, action: "read" };
    expectNoMatchingGrant(await authorizer.authorize(context([grant()]), request), request);
  });
});

describe('the "*" action', () => {
  const everything = grant({
    id: "grant-files-everything",
    capabilities: [{ resource: RESOURCE, actions: ["*"], scope: "exact" }],
  });

  it("is a granted literal that covers every action on its resource", async () => {
    const authorizer = new CapabilityAuthorizer();
    for (const action of ["read", "delete", "snapshot:restore"]) {
      await expect(
        authorizer.authorize(context([everything]), { resource: RESOURCE, action }),
      ).resolves.toEqual({
        allowed: true,
        reasonCode: "allowed",
        matchedGrantId: "grant-files-everything",
      });
    }
  });

  it("widens the action test only: path, scope, and purpose still have to match", async () => {
    const authorizer = new CapabilityAuthorizer();
    const deeper = {
      resource: { ...RESOURCE, path: [...RESOURCE.path, "notes.md"] },
      action: "read",
    };
    expectNoMatchingGrant(await authorizer.authorize(context([everything]), deeper), deeper);

    // A different purpose describes the same capability under that purpose,
    // because purpose comes from the caller's context rather than the grant.
    const elsewhere = { ...accessContext(), purpose: "publish-summary" };
    expectNoMatchingGrant(
      await authorizer.authorize(authorityFor(elsewhere, [everything]), {
        resource: RESOURCE,
        action: "read",
      }),
      { resource: RESOURCE, action: "read" },
      elsewhere,
    );
  });

  it('is not a request pattern: asking for "*" against named actions is denied', async () => {
    const authorizer = new CapabilityAuthorizer();
    const wildcard = { resource: RESOURCE, action: "*" };
    expectNoMatchingGrant(await authorizer.authorize(context([grant()]), wildcard), wildcard);
  });

  it("makes every tool over the resource discoverable, and nothing outside it", async () => {
    const authorizer = new CapabilityAuthorizer();
    await expect(
      authorizer.canDiscover(context([everything]), {
        resource: { namespace: "files", path: [] },
        action: "delete",
      }),
    ).resolves.toMatchObject({ allowed: true, matchedGrantId: "grant-files-everything" });
    await expect(
      authorizer.canDiscover(context([everything]), {
        resource: { namespace: "calendar", path: [] },
        action: "read",
      }),
    ).resolves.toEqual({ allowed: false, reasonCode: "no_matching_grant" });
  });
});

describe("the capability a denial describes", () => {
  const REQUEST = { resource: RESOURCE, action: "read" };

  it("derives the identifier from the authority, not from when it was asked", async () => {
    const authorizer = new CapabilityAuthorizer();
    const later = { ...accessContext(), now: "2026-08-03T11:00:00.000Z" };

    const first = await authorizer.authorize(context([]), REQUEST);
    const second = await authorizer.authorize(authorityFor(later, []), REQUEST);

    // The instant moves and the identifier does not. A turn refreshes
    // `context.now` per operation, so hashing it would give two identical
    // denials two ids -- and give a conformance case a different record on
    // every run.
    expect(first.requiredAuthority?.requestedAt).toBe(NOW);
    expect(second.requiredAuthority?.requestedAt).toBe(later.now);
    expect(second.requiredAuthority?.id).toBe(first.requiredAuthority?.id);
  });

  it("gives one identifier whether an optional key is omitted or explicitly undefined", async () => {
    const authorizer = new CapabilityAuthorizer();
    const bare = { namespace: "files", path: ["Memory"] };

    const omitted = await authorizer.authorize(context([]), { resource: bare, action: "read" });
    const explicit = await authorizer.authorize(context([]), {
      resource: { ...bare, owner: undefined },
      action: "read",
    });

    // `structuredClone` keeps an own property whose value is `undefined`, and
    // `canonicalJson` emits one, so building the description by spreading the
    // request would hash these to two ids for one missing authority -- and a
    // host de-duplicating consent requests by id would raise two asks.
    expect(explicit.requiredAuthority?.id).toBe(omitted.requiredAuthority?.id);
    expect(explicit.requiredAuthority?.capabilities[0]?.resource).not.toHaveProperty("owner");
  });

  it("takes the owner from the context's owner, not from its authority", async () => {
    // The shared fixture makes AUTHORITY and OWNER the same principal, so the
    // helper's owner assertion cannot tell them apart. Here they differ.
    const carol = { kind: "human", userId: "user-carol" } as const;
    const access = { ...accessContext(), owner: carol };
    const request = {
      resource: { namespace: "files", path: ["Memory"], owner: carol },
      action: "read",
    };

    const decision = await new CapabilityAuthorizer().authorize(authorityFor(access, []), request);

    expect(decision.requiredAuthority?.owner).toEqual(carol);
    expect(decision.requiredAuthority?.requester).toEqual(ACTOR);
  });

  it("describes exactly one capability, whatever the schema permits", async () => {
    const decision = await new CapabilityAuthorizer().authorize(context([]), REQUEST);

    // `CapabilityRequestSchema` allows 64 for a host-built consent request. A
    // kernel-built description concerns the one resource and action the caller
    // named; a second entry could only be a guess at what else it wanted.
    expect(decision.requiredAuthority?.capabilities).toHaveLength(1);
  });

  it("is absent from grant_exhausted, where a grant exists and is spent", async () => {
    const usageStore = new InMemoryGrantUsageStore();
    const authorizer = new CapabilityAuthorizer({ usageStore });
    const access = context([grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } })]);

    await expect(authorizer.authorize(access, REQUEST, { consume: true })).resolves.toMatchObject({
      allowed: true,
    });
    const spent = await authorizer.authorize(access, REQUEST, { consume: true });

    // Issuing a grant is not the remedy here: one was issued and it is used up.
    expect(spent).toEqual({ allowed: false, reasonCode: "grant_exhausted" });
  });

  it("is absent from an infrastructure denial, which is not about authority at all", async () => {
    // No usage store, so a bounded grant cannot be decided and fails closed.
    const authorizer = new CapabilityAuthorizer();
    const access = context([grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } })]);

    expect(await authorizer.authorize(access, REQUEST)).toEqual({
      allowed: false,
      reasonCode: "usage_store_unavailable",
    });
  });
});

describe("the host ceiling", () => {
  const REQUEST = { resource: RESOURCE, action: "read" };
  /** Refuses everything it is shown. */
  const refuseAll: HostCeiling = {
    narrow: () => ({ allowed: false, reasonCode: "host_policy_denied" }),
  };

  it("refuses a grant that would have allowed, and names the grant it overrode", async () => {
    const authorizer = new CapabilityAuthorizer({ hostCeiling: refuseAll });

    const decision = await authorizer.authorize(context([grant()]), REQUEST);

    // Not `no_matching_grant`: a grant exists and policy overrode it. That
    // separation is the whole measurable point (ADR 0020).
    expect(decision).toEqual({
      allowed: false,
      reasonCode: "host_policy_denied",
      matchedGrantId: "grant-files-read",
    });
    expect(isInfrastructureDenial(decision.reasonCode)).toBe(false);
    // No grant would satisfy it -- one was issued and overridden -- so
    // describing a capability would say issuing one is the remedy (ADR 0019).
    expect(decision.requiredAuthority).toBeUndefined();
  });

  it("does not spend a bounded use on a call it refused", async () => {
    const usageStore = new InMemoryGrantUsageStore();
    const bounded = grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } });
    const refused = new CapabilityAuthorizer({ hostCeiling: refuseAll, usageStore });

    await expect(
      refused.authorize(context([bounded]), REQUEST, { consume: true }),
    ).resolves.toMatchObject({ reasonCode: "host_policy_denied" });

    // The single use is still there. `maxUses` counts what an actor did, and a
    // call product policy stopped is not something the actor did -- which is
    // why the ceiling is consulted before consumption, not after.
    const permitted = new CapabilityAuthorizer({ usageStore });
    await expect(
      permitted.authorize(context([bounded]), REQUEST, { consume: true }),
    ).resolves.toMatchObject({ allowed: true, matchedGrantId: "grant-files-read" });
  });

  it("keeps walking: a refusal ends one grant's candidacy, not the decision", async () => {
    // Two grants cover the same request. Policy distinguishes them, which is
    // the case that makes stopping at the first refusal wrong.
    const frozen = grant({ id: "grant-legacy" });
    const current = grant({ id: "grant-current" });
    const exceptLegacy: HostCeiling = {
      narrow: (decision) =>
        decision.matchedGrantId === "grant-legacy"
          ? { allowed: false, reasonCode: "host_policy_denied" }
          : decision,
    };
    const authorizer = new CapabilityAuthorizer({ hostCeiling: exceptLegacy });

    await expect(authorizer.authorize(context([frozen, current]), REQUEST)).resolves.toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-current",
    });
  });

  it("reports a policy refusal rather than an absence when every grant is refused", async () => {
    const authorizer = new CapabilityAuthorizer({ hostCeiling: refuseAll });

    await expect(
      authorizer.authorize(context([grant({ id: "grant-a" }), grant({ id: "grant-b" })]), REQUEST),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "host_policy_denied" });
  });

  it("is never shown a denial, so it cannot turn one into an allow", async () => {
    const shown: string[] = [];
    const widenEverything: HostCeiling = {
      narrow: (decision) => {
        shown.push(decision.reasonCode);
        return { allowed: true, reasonCode: "allowed", matchedGrantId: "grant-forged" };
      },
    };

    // No grant matches at all, so the ceiling is not consulted and the denial
    // stands. Widening is not reachable, not merely forbidden.
    await expect(
      new CapabilityAuthorizer({ hostCeiling: widenEverything }).authorize(context([]), REQUEST),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "no_matching_grant" });
    expect(shown).toEqual([]);
  });

  it("fails closed when it returns an allow for a grant it was not shown", async () => {
    const swapGrant: HostCeiling = {
      narrow: () => ({ allowed: true, reasonCode: "allowed", matchedGrantId: "grant-forged" }),
    };

    const decision = await new CapabilityAuthorizer({ hostCeiling: swapGrant }).authorize(
      context([grant()]),
      REQUEST,
    );

    expect(decision).toEqual({ allowed: false, reasonCode: "host_policy_unavailable" });
    expect(isInfrastructureDenial(decision.reasonCode)).toBe(true);
  });

  it("keeps a refusal's metadata but not its reason code", async () => {
    // Not expressible in the type -- `HostPolicyDenial` pins the code -- so
    // this is what a host outside TypeScript can still do.
    const detailed = {
      narrow: () => ({
        allowed: false,
        reasonCode: "no_matching_grant",
        metadata: { rule: "hr-freeze" },
      }),
    } as unknown as HostCeiling;

    // A ceiling free to name its own code could return the very
    // misattribution the separate bucket exists to end, so the code is
    // replaced at runtime as well; what it wanted to say survives in metadata.
    await expect(
      new CapabilityAuthorizer({ hostCeiling: detailed }).authorize(context([grant()]), REQUEST),
    ).resolves.toMatchObject({
      reasonCode: "host_policy_denied",
      metadata: { rule: "hr-freeze" },
    });
  });

  it("fails closed when it throws", async () => {
    const broken: HostCeiling = {
      narrow: () => {
        throw new Error("policy service is unreachable");
      },
    };

    const decision = await new CapabilityAuthorizer({ hostCeiling: broken }).authorize(
      context([grant()]),
      REQUEST,
    );

    expect(decision).toEqual({ allowed: false, reasonCode: "host_policy_unavailable" });
    expect(isInfrastructureDenial(decision.reasonCode)).toBe(true);
  });

  it("filters discovery on the same policy, so a catalogue matches invocation", async () => {
    const authorizer = new CapabilityAuthorizer({ hostCeiling: refuseAll });
    const ceiling = {
      resource: { namespace: "files", path: ["Workspace"], owner: OWNER },
      action: "read",
    };

    // ADR 0016's agreement property: nothing is offered on authority that
    // invocation would refuse.
    await expect(authorizer.canDiscover(context([grant()]), ceiling)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "host_policy_denied",
    });
  });

  it("ranks a policy refusal below a fail-closed chain and above exhaustion", async () => {
    const usageStore = new InMemoryGrantUsageStore();
    const spent = grant({
      id: "grant-spent",
      constraints: { purposes: ["prepare-update"], maxUses: 1 },
    });
    const refusedGrant = grant({ id: "grant-refused" });
    const onlyRefused: HostCeiling = {
      narrow: (decision) =>
        decision.matchedGrantId === "grant-refused"
          ? { allowed: false, reasonCode: "host_policy_denied" }
          : decision,
    };
    const authorizer = new CapabilityAuthorizer({ hostCeiling: onlyRefused, usageStore });

    await expect(
      authorizer.authorize(context([spent]), REQUEST, { consume: true }),
    ).resolves.toMatchObject({ allowed: true });

    // A deliberate refusal outranks a spent budget: under-counting policy
    // denials is the defect the port exists to fix.
    await expect(
      authorizer.authorize(context([spent, refusedGrant]), REQUEST, { consume: true }),
    ).resolves.toMatchObject({ reasonCode: "host_policy_denied" });

    // But an unverifiable chain outranks the policy refusal, because reporting
    // a deliberate decision would hide an infrastructure failure behind it.
    const derived = grant({ id: "grant-derived", parentGrantId: "grant-missing" });
    await expect(
      authorizer.authorize(context([derived, refusedGrant]), REQUEST),
    ).resolves.toMatchObject({ reasonCode: "delegation_chain_unverified" });
  });

  it("is handed the caller's request and the resolved context, not just a decision", async () => {
    const seen: { decision: unknown; request: unknown; context: unknown }[] = [];
    const spy: HostCeiling = {
      narrow: (decision, request, ceilingContext) => {
        seen.push({ decision, request, context: ceilingContext });
        return decision;
      },
    };

    // The port's contract is "decide from `request` and `context`". Asserting
    // only the outcome would leave those two arguments unobserved, and a
    // version that passed `undefined` for both would look identical.
    await new CapabilityAuthorizer({ hostCeiling: spy }).authorize(context([grant()]), REQUEST);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.decision).toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-files-read",
    });
    expect(seen[0]?.request).toEqual(REQUEST);
    expect(seen[0]?.context).toEqual(accessContext());
  });

  it("cannot change the walk by mutating what it was handed", async () => {
    const consulted: (string | undefined)[] = [];
    const vandal: HostCeiling = {
      narrow: (decision, request, ceilingContext) => {
        consulted.push(decision.matchedGrantId);
        // A ceiling that edits the purpose in place would make every later
        // grant stop matching -- changing authorization for grants it was never
        // shown. The arguments are cloned, so this writes to a copy.
        (ceilingContext as { purpose: string }).purpose = "unrelated-purpose";
        (request as { action: string }).action = "delete";
        return decision.matchedGrantId === "grant-first"
          ? { allowed: false, reasonCode: "host_policy_denied" }
          : decision;
      },
    };

    const decision = await new CapabilityAuthorizer({ hostCeiling: vandal }).authorize(
      context([grant({ id: "grant-first" }), grant({ id: "grant-second" })]),
      REQUEST,
    );

    expect(consulted).toEqual(["grant-first", "grant-second"]);
    expect(decision).toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-second",
    });
  });

  it("names the first grant it refused, not the last", async () => {
    const authorizer = new CapabilityAuthorizer({ hostCeiling: refuseAll });

    // Which grant a multi-grant refusal names is observable -- it reaches the
    // audit event -- so it is pinned rather than left to walk order.
    await expect(
      authorizer.authorize(context([grant({ id: "grant-a" }), grant({ id: "grant-b" })]), REQUEST),
    ).resolves.toEqual({
      allowed: false,
      reasonCode: "host_policy_denied",
      matchedGrantId: "grant-a",
    });
  });

  it.each([
    ["an async narrow, which returns a promise", async () => ({ allowed: false, reasonCode: "x" })],
    ["a branch that falls off the end", () => undefined],
    ["something that is not an object at all", () => "denied"],
  ])("fails closed on a malformed return: %s", async (_label, narrow) => {
    const decision = await new CapabilityAuthorizer({
      hostCeiling: { narrow } as unknown as HostCeiling,
    }).authorize(context([grant()]), REQUEST);

    // The async case is the one that matters. Read optimistically, its
    // `allowed` is `undefined` -- falsy -- and a broken port would be recorded
    // as a deliberate `host_policy_denied`, inflating the one count this port
    // exists to make trustworthy. It is a malfunction, so it fails closed.
    expect(decision).toEqual({ allowed: false, reasonCode: "host_policy_unavailable" });
    expect(isInfrastructureDenial(decision.reasonCode)).toBe(true);
  });

  it("hands a throw to the diagnostic sink instead of destroying it", async () => {
    const seen: { error: unknown; operation: { kind: string; reasonCode: string } }[] = [];
    const failure = new Error("policy table is malformed");
    const broken: HostCeiling = {
      narrow: () => {
        throw failure;
      },
    };

    await new CapabilityAuthorizer({
      hostCeiling: broken,
      onProviderError: (error, operation) => void seen.push({ error, operation }),
    }).authorize(context([grant()]), REQUEST);

    // Without this, a ceiling with one bad row denies every operation in the
    // deployment and says nothing about why.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.error).toBe(failure);
    expect(seen[0]?.operation).toMatchObject({
      kind: "policy",
      reasonCode: "host_policy_unavailable",
      resource: RESOURCE,
      action: "read",
    });
  });

  it("drops metadata that is not a JSON object rather than carrying it", async () => {
    const badMetadata: HostCeiling = {
      narrow: () =>
        ({
          allowed: false,
          reasonCode: "host_policy_denied",
          metadata: "hr-freeze",
        }) as unknown as ReturnType<HostCeiling["narrow"]>,
    };

    // The refusal is still true and useful without it, and letting a non-JSON
    // value reach `structuredClone` in the audit path would turn a policy
    // denial into a thrown turn.
    const decision = await new CapabilityAuthorizer({ hostCeiling: badMetadata }).authorize(
      context([grant()]),
      REQUEST,
    );
    expect(decision).toEqual({
      allowed: false,
      reasonCode: "host_policy_denied",
      matchedGrantId: "grant-files-read",
    });
  });

  it("reports whether one is installed at all", () => {
    expect(new CapabilityAuthorizer().hasHostCeiling).toBe(false);
    expect(new CapabilityAuthorizer({ hostCeiling: refuseAll }).hasHostCeiling).toBe(true);
  });
});

describe("the policy a host ceiling decides against", () => {
  const REQUEST = { resource: RESOURCE, action: "read" };
  /** Authority as the kernel resolves it when a `PolicySource` is installed. */
  const withPolicy = (
    grants: CapabilityGrant[],
    hostPolicy: PolicyResolution,
  ): ResolvedAuthority => ({
    ...context(grants),
    hostPolicy,
  });

  it("hands the ceiling what the turn loaded, as loaded, on both paths", async () => {
    // Not JSON on purpose: a `Set` and a function do not survive
    // `structuredClone`. SharedOS does not know a policy's shape and reads
    // nothing from it, so it hands back the object it was given.
    const policy = { frozen: new Set(["files"]), rule: () => "org-freeze" };
    const seen: unknown[] = [];
    const fromPolicy: HostCeiling<typeof policy> = {
      narrow: (decision, request, _context, loaded) => {
        seen.push(loaded);
        return loaded !== undefined && loaded.frozen.has(request.resource.namespace)
          ? { allowed: false, reasonCode: "host_policy_denied", metadata: { rule: loaded.rule() } }
          : decision;
      },
    };
    const authorizer = new CapabilityAuthorizer({ hostCeiling: fromPolicy });
    const authority = withPolicy([grant()], { status: "loaded", policy, version: "org-freeze-3" });

    await expect(authorizer.authorize(authority, REQUEST)).resolves.toMatchObject({
      reasonCode: "host_policy_denied",
      metadata: { rule: "org-freeze" },
    });
    await expect(authorizer.canDiscover(authority, REQUEST)).resolves.toMatchObject({
      reasonCode: "host_policy_denied",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(policy);
    expect(seen[1]).toBe(policy);
  });

  it("fails closed without consulting the ceiling when the turn's policy could not be loaded", async () => {
    const consulted: string[] = [];
    const ceiling: HostCeiling = {
      narrow: (decision) => {
        consulted.push(decision.matchedGrantId ?? "");
        return decision;
      },
    };
    const usageStore = new InMemoryGrantUsageStore();
    const bounded = grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } });
    const authorizer = new CapabilityAuthorizer({ hostCeiling: ceiling, usageStore });
    const authority = withPolicy([bounded], { status: "unavailable" });

    const decision = await authorizer.authorize(authority, REQUEST, { consume: true });

    // The same code a broken ceiling produces: the port is unavailable either
    // way, and a reader separating outages from decisions needs one bucket.
    expect(decision).toEqual({ allowed: false, reasonCode: "host_policy_unavailable" });
    expect(isInfrastructureDenial(decision.reasonCode)).toBe(true);
    expect(consulted).toEqual([]);
    // Discovery agrees, so a catalogue is not offered on authority the turn
    // cannot decide about.
    await expect(authorizer.canDiscover(authority, REQUEST)).resolves.toMatchObject({
      reasonCode: "host_policy_unavailable",
    });
    // And the bounded use is still there: refused before consumption, as
    // every ceiling refusal is.
    await expect(usageStore.getUsage("world-alpha", bounded.id)).resolves.toBe(0);
  });

  it("is the ceiling's outage, not authority's: with no ceiling installed it changes nothing", async () => {
    const authority = withPolicy([grant()], { status: "unavailable" });

    await expect(new CapabilityAuthorizer().authorize(authority, REQUEST)).resolves.toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-files-read",
    });
  });

  it("hands a ceiling with no source `undefined`, and lets it decide over its own state", async () => {
    const seen: unknown[] = [];
    const closure: HostCeiling = {
      narrow: (decision, _request, _context, policy) => {
        seen.push(policy);
        return decision;
      },
    };

    await expect(
      new CapabilityAuthorizer({ hostCeiling: closure }).authorize(context([grant()]), REQUEST),
    ).resolves.toMatchObject({ allowed: true });
    expect(seen).toEqual([undefined]);
  });
});

describe("CapabilityAuthorizer.reach", () => {
  async function reachOf(
    authorizer: CapabilityAuthorizer,
    authority: Parameters<CapabilityAuthorizer["reach"]>[0],
    options?: Parameters<CapabilityAuthorizer["reach"]>[1],
  ) {
    const result = await authorizer.reach(authority, options);
    if (result.status !== "computed") {
      throw new Error(`reach was ${result.reasonCode}`);
    }
    return result.reach;
  }

  it("describes the reachable surface without the authority behind it", async () => {
    const reach = await reachOf(new CapabilityAuthorizer(), context([grant()]));

    expect(reach).toEqual([
      {
        namespace: "files",
        path: ["Workspace", "projects", "sharedos"],
        actions: ["read"],
        scope: "exact",
      },
    ]);
    // The point of the shape: nothing here says who allowed it, for how long,
    // or how much budget is left.
    for (const entry of reach) {
      expect(Object.keys(entry).sort()).toEqual(["actions", "namespace", "path", "scope"]);
    }
  });

  it("omits a grant that would not authorize anything right now", async () => {
    const authorizer = new CapabilityAuthorizer();

    const expired = await reachOf(
      authorizer,
      context([
        grant({
          constraints: { purposes: ["prepare-update"], expiresAt: "2026-08-03T08:30:00.000Z" },
        }),
      ]),
    );
    const revoked = await reachOf(
      authorizer,
      context([grant({ revokedAt: "2026-08-03T08:45:00.000Z" })]),
    );
    const wrongPurpose = await reachOf(
      authorizer,
      context([grant({ constraints: { purposes: ["something-else"] } })]),
    );
    const wrongSubject = await reachOf(
      authorizer,
      context([grant({ subject: { kind: "agent", agentId: "agent-carol" } as Address })]),
    );

    expect(expired).toEqual([]);
    expect(revoked).toEqual([]);
    expect(wrongPurpose).toEqual([]);
    expect(wrongSubject).toEqual([]);
  });

  it("omits a grant a verifier rejects", async () => {
    const revoked: CapabilityGrantVerifier = { verify: async () => false };
    const reach = await reachOf(
      new CapabilityAuthorizer({ grantVerifier: revoked }),
      context([grant()]),
    );

    expect(reach).toEqual([]);
  });

  it("omits a delegated grant whose chain cannot be verified", async () => {
    const reach = await reachOf(
      new CapabilityAuthorizer(),
      context([grant({ parentGrantId: "grant-parent" })]),
    );

    expect(reach).toEqual([]);
  });

  it("does not advertise a door that is already closed, and never spends one to look", async () => {
    const usageStore = new InMemoryGrantUsageStore();
    const authorizer = new CapabilityAuthorizer({ usageStore });
    const bounded = context([grant({ constraints: { purposes: ["prepare-update"], maxUses: 1 } })]);

    expect(await reachOf(authorizer, bounded)).toHaveLength(1);
    // Asking repeatedly must not consume the budget.
    expect(await reachOf(authorizer, bounded)).toHaveLength(1);
    expect(await usageStore.getUsage("world-alpha", "grant-files-read")).toBe(0);

    const spent = await authorizer.authorize(
      bounded,
      { resource: RESOURCE, action: "read" },
      { consume: true },
    );
    expect(spent.allowed).toBe(true);
    expect(await reachOf(authorizer, bounded)).toEqual([]);
  });

  it("is unavailable rather than narrower when a bounded budget cannot be read", async () => {
    const bounded = context([grant({ constraints: { purposes: ["prepare-update"], maxUses: 5 } })]);
    const broken: GrantUsageStore = {
      getUsage: async () => {
        throw new Error("store down");
      },
      tryConsume: async () => false,
    };
    const unavailable = { status: "unavailable", reasonCode: "usage_store_unavailable" };

    await expect(new CapabilityAuthorizer({ usageStore: broken }).reach(bounded)).resolves.toEqual(
      unavailable,
    );
    await expect(new CapabilityAuthorizer().reach(bounded)).resolves.toEqual(unavailable);
    // An unbounded grant reads no budget, so its reach needs no store.
    expect(await reachOf(new CapabilityAuthorizer(), context([grant()]))).toHaveLength(1);
  });

  it("is empty for a context that could not authorize anything", async () => {
    const reach = await reachOf(
      new CapabilityAuthorizer(),
      authorityFor({ ...accessContext(), purpose: "" }, [grant()]),
    );

    expect(reach).toEqual([]);
  });

  it("expires at the operation instant a caller names, not only at the turn's", async () => {
    const authorizer = new CapabilityAuthorizer();
    const bounded = context([
      grant({
        constraints: { purposes: ["prepare-update"], expiresAt: "2026-08-03T09:30:00.000Z" },
      }),
    ]);

    expect(await reachOf(authorizer, bounded)).toHaveLength(1);
    expect(await reachOf(authorizer, bounded, { now: "2026-08-03T10:00:00.000Z" })).toEqual([]);
  });

  it("omits a capability that names another owner, which could authorize nothing here", async () => {
    const elsewhere = grant({
      id: "grant-other-owner",
      capabilities: [
        {
          resource: { ...RESOURCE, owner: { kind: "human", userId: "user-dana" } },
          actions: ["read"],
          scope: "exact",
        },
      ],
    });

    expect(await reachOf(new CapabilityAuthorizer(), context([elsewhere]))).toEqual([]);
  });

  it("is deduplicated and ordered the same way whatever order the store served", async () => {
    const calendar: CapabilityGrant = grant({
      id: "grant-calendar",
      capabilities: [
        {
          resource: { namespace: "calendar", path: ["primary"], owner: OWNER },
          actions: ["write", "read"],
          scope: "descendants",
        },
      ],
    });
    const duplicate = grant({ id: "grant-files-read-again" });
    const authorizer = new CapabilityAuthorizer();

    const expected = [
      {
        namespace: "calendar",
        path: ["primary"],
        actions: ["read", "write"],
        scope: "descendants",
      },
      {
        namespace: "files",
        path: ["Workspace", "projects", "sharedos"],
        actions: ["read"],
        scope: "exact",
      },
    ];
    expect(await reachOf(authorizer, context([grant(), calendar, duplicate]))).toEqual(expected);
    expect(await reachOf(authorizer, context([duplicate, calendar, grant()]))).toEqual(expected);
  });
});
