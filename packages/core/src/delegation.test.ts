import { describe, expect, it } from "vitest";

import type {
  AccessContext,
  CapabilityGrant,
  CapabilityConstraints,
  ResourceRef,
} from "@aicoo/sharedos-contracts";
import { CapabilityGrantSchema } from "@aicoo/sharedos-contracts";

import type { ResolvedAuthority } from "./authority.js";
import { CapabilityAuthorizer } from "./authorization.js";
import {
  type DelegationChainResolver,
  deriveGrant,
  validateDelegationChain,
} from "./delegation.js";

const NOW = "2026-08-03T09:00:00.000Z";
const OWNER = { kind: "human", userId: "user-alice" } as const;
const MANAGER = { kind: "agent", agentId: "agent-manager" } as const;
const WORKER = { kind: "agent", agentId: "agent-worker" } as const;
const PROJECT: ResourceRef = { namespace: "files", path: ["Workspace", "projects"], owner: OWNER };
const REPORT: ResourceRef = {
  namespace: "files",
  path: ["Workspace", "projects", "report"],
  owner: OWNER,
};

/** Root authority the owner issued directly to the manager. */
function parentGrant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "grant-parent",
    namespaceId: "world-alpha",
    subject: MANAGER,
    issuer: OWNER,
    capabilities: [{ resource: PROJECT, actions: ["read", "write"], scope: "descendants" }],
    constraints: {
      purposes: ["prepare-update", "review"],
      expiresAt: "2026-08-04T00:00:00.000Z",
      delegationDepth: 2,
    },
    issuedAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

/** Authority the manager re-issued to a worker, narrowed on every axis. */
function childGrant(
  overrides: Partial<CapabilityGrant> = {},
  constraints: Partial<CapabilityConstraints> = {},
): CapabilityGrant {
  return {
    id: "grant-child",
    namespaceId: "world-alpha",
    subject: WORKER,
    issuer: MANAGER,
    capabilities: [{ resource: REPORT, actions: ["read"], scope: "exact" }],
    constraints: {
      purposes: ["prepare-update"],
      expiresAt: "2026-08-03T18:00:00.000Z",
      delegationDepth: 1,
      ...constraints,
    },
    issuedAt: "2026-08-03T08:30:00.000Z",
    parentGrantId: "grant-parent",
    ...overrides,
  };
}

function context(): AccessContext {
  return {
    namespaceId: "world-alpha",
    enabledToolNamespaces: [],
    actor: WORKER,
    authority: MANAGER,
    owner: OWNER,
    purpose: "prepare-update",
    traceId: "trace-1",
    now: NOW,
  };
}

/** Authority as the kernel would have resolved it from a trusted source. */
function authorityOf(grants: readonly CapabilityGrant[]): ResolvedAuthority {
  return {
    context: context(),
    grants: [...grants],
    snapshot: {
      hash: `snapshot-${grants.map(({ id }) => id).join("+")}`,
      grantIds: grants.map(({ id }) => id),
      grantCount: grants.length,
      loadedAt: NOW,
    },
  };
}

function resolverFor(...grants: readonly CapabilityGrant[]): DelegationChainResolver {
  const byId = new Map(grants.map((grant) => [`${grant.namespaceId}/${grant.id}`, grant]));
  return {
    resolve: async (namespaceId, grantId) => byId.get(`${namespaceId}/${grantId}`),
  };
}

async function validate(
  child: CapabilityGrant,
  resolver: DelegationChainResolver | undefined,
): Promise<ReturnType<typeof validateDelegationChain>> {
  return validateDelegationChain(child, context(), Date.parse(NOW), {
    ...(resolver === undefined ? {} : { resolver }),
  });
}

describe("delegation chain validation", () => {
  it("accepts a root grant without consulting a resolver", async () => {
    await expect(validate(parentGrant(), undefined)).resolves.toEqual({
      status: "valid",
      chain: [],
    });
  });

  it("accepts a chain that narrows resource, action, purpose, time, and depth", async () => {
    const parent = parentGrant();
    await expect(validate(childGrant(), resolverFor(parent))).resolves.toEqual({
      status: "valid",
      chain: ["grant-parent"],
    });
  });

  it("invalidates a descendant once its ancestor is revoked", async () => {
    const revoked = parentGrant({ revokedAt: "2026-08-03T08:45:00.000Z" });

    await expect(validate(childGrant(), resolverFor(revoked))).resolves.toEqual({
      status: "invalid",
      chain: [],
      code: "parent_inactive",
      grantId: "grant-parent",
    });
  });

  it("invalidates a descendant once its ancestor expires", async () => {
    const expired = parentGrant({
      constraints: { ...parentGrant().constraints, expiresAt: "2026-08-03T08:50:00.000Z" },
    });

    await expect(validate(childGrant(), resolverFor(expired))).resolves.toMatchObject({
      status: "invalid",
      code: "parent_inactive",
    });
  });

  it("invalidates a grandchild when the root of the chain is revoked", async () => {
    const root = parentGrant({
      id: "grant-root",
      subject: OWNER,
      issuer: OWNER,
      revokedAt: "2026-08-03T08:40:00.000Z",
      constraints: { ...parentGrant().constraints, delegationDepth: 3 },
    });
    const middle = parentGrant({ parentGrantId: "grant-root", issuer: OWNER });
    const leaf = childGrant();

    await expect(validate(leaf, resolverFor(root, middle))).resolves.toEqual({
      status: "invalid",
      chain: ["grant-parent"],
      code: "parent_inactive",
      grantId: "grant-root",
    });
  });

  it("rejects a link whose issuer is not the parent's subject", async () => {
    const forged = childGrant({ issuer: OWNER });

    await expect(validate(forged, resolverFor(parentGrant()))).resolves.toMatchObject({
      status: "invalid",
      code: "issuer_not_parent_subject",
    });
  });

  it("rejects a child that widens the resource path", async () => {
    const widened = childGrant({
      capabilities: [
        {
          resource: { namespace: "files", path: ["Workspace"], owner: OWNER },
          actions: ["read"],
          scope: "descendants",
        },
      ],
    });

    await expect(validate(widened, resolverFor(parentGrant()))).resolves.toMatchObject({
      status: "invalid",
      code: "capability_widened",
    });
  });

  it("rejects a child that widens actions, including a wildcard", async () => {
    const widened = childGrant({
      capabilities: [{ resource: REPORT, actions: ["*"], scope: "exact" }],
    });

    await expect(validate(widened, resolverFor(parentGrant()))).resolves.toMatchObject({
      status: "invalid",
      code: "capability_widened",
    });
  });

  it("rejects a child that outlives or outlasts its parent", async () => {
    const parent = parentGrant();

    await expect(
      validate(childGrant({}, { expiresAt: "2026-08-05T00:00:00.000Z" }), resolverFor(parent)),
    ).resolves.toMatchObject({ status: "invalid", code: "constraints_widened" });

    await expect(
      validate(childGrant({}, { purposes: ["prepare-update", "exfiltrate"] }), resolverFor(parent)),
    ).resolves.toMatchObject({ status: "invalid", code: "constraints_widened" });

    await expect(
      validate(childGrant({ issuedAt: "2026-08-03T07:00:00.000Z" }), resolverFor(parent)),
    ).resolves.toMatchObject({ status: "invalid", code: "constraints_widened" });
  });

  it("refuses a bounded parent outright rather than splitting its budget", async () => {
    const bounded = parentGrant({ constraints: { ...parentGrant().constraints, maxUses: 5 } });

    // Not a widening question. Usage counters are per grant, so two children of
    // a five-use parent would carry ten uses between them however small each
    // one looks; the link is refused before any attenuation is compared.
    for (const constraints of [{ maxUses: 50 }, { maxUses: 1 }, {}]) {
      await expect(
        validate(childGrant({}, constraints), resolverFor(bounded)),
      ).resolves.toMatchObject({
        status: "invalid",
        code: "bounded_parent_not_delegable",
      });
    }
  });

  it("requires delegation budget that strictly decreases at each link", async () => {
    const exhausted = parentGrant({
      constraints: { ...parentGrant().constraints, delegationDepth: 0 },
    });
    await expect(validate(childGrant(), resolverFor(exhausted))).resolves.toMatchObject({
      status: "invalid",
      code: "delegation_not_permitted",
    });

    const undeclared = parentGrant({ constraints: { purposes: ["prepare-update"] } });
    await expect(validate(childGrant(), resolverFor(undeclared))).resolves.toMatchObject({
      status: "invalid",
      code: "delegation_not_permitted",
    });

    const parent = parentGrant({
      constraints: { ...parentGrant().constraints, delegationDepth: 1 },
    });
    await expect(validate(childGrant(), resolverFor(parent))).resolves.toMatchObject({
      status: "invalid",
      code: "delegation_depth_exceeded",
    });
  });

  it("rejects a chain that crosses namespaces", async () => {
    const foreign = parentGrant({ namespaceId: "world-beta" });

    await expect(validate(childGrant(), resolverFor(foreign))).resolves.toMatchObject({
      status: "unverified",
      code: "parent_not_found",
    });
  });

  it("rejects a cyclic chain instead of looping", async () => {
    const first = parentGrant({
      id: "grant-a",
      parentGrantId: "grant-b",
      subject: MANAGER,
      issuer: OWNER,
      constraints: { ...parentGrant().constraints, delegationDepth: 1 },
    });
    const second = parentGrant({ id: "grant-b", parentGrantId: "grant-a", subject: OWNER });

    await expect(validate(first, resolverFor(first, second))).resolves.toMatchObject({
      status: "invalid",
      code: "chain_cycle",
    });
  });

  it("walks a chain of any length when no maximum is set", async () => {
    const links = 20;
    const agent = (index: number) => ({ kind: "agent", agentId: `agent-${index}` }) as const;
    const chain = Array.from({ length: links + 1 }, (_value, index) =>
      parentGrant({
        id: `grant-${index}`,
        subject: agent(index),
        issuer: index === 0 ? OWNER : agent(index - 1),
        constraints: { ...parentGrant().constraints, delegationDepth: links - index + 1 },
        ...(index === 0 ? {} : { parentGrantId: `grant-${index - 1}` }),
      }),
    );
    const leaf = chain[links] as CapabilityGrant;

    await expect(validate(leaf, resolverFor(...chain))).resolves.toEqual({
      status: "valid",
      chain: Array.from({ length: links }, (_value, index) => `grant-${links - 1 - index}`),
    });
  });

  it("fails closed when the chain cannot be established", async () => {
    await expect(validate(childGrant(), undefined)).resolves.toMatchObject({
      status: "unverified",
      code: "resolver_unavailable",
    });

    await expect(validate(childGrant(), resolverFor())).resolves.toMatchObject({
      status: "unverified",
      code: "parent_not_found",
    });

    const failing: DelegationChainResolver = {
      resolve: async () => {
        throw new Error("grant store is unreachable");
      },
    };
    await expect(validate(childGrant(), failing)).resolves.toMatchObject({
      status: "unverified",
      code: "resolver_failed",
    });
  });
});

describe("CapabilityAuthorizer delegation", () => {
  const request = { resource: REPORT, action: "read" } as const;

  it("authorizes a delegated grant only through a verified chain", async () => {
    const authorizer = new CapabilityAuthorizer({
      delegationResolver: resolverFor(parentGrant()),
    });

    await expect(authorizer.authorize(authorityOf([childGrant()]), request)).resolves.toEqual({
      allowed: true,
      reasonCode: "allowed",
      matchedGrantId: "grant-child",
    });
  });

  it("denies a delegated grant whose parent was revoked and reports the failing link", async () => {
    const authorizer = new CapabilityAuthorizer({
      delegationResolver: resolverFor(parentGrant({ revokedAt: "2026-08-03T08:45:00.000Z" })),
    });

    await expect(authorizer.authorize(authorityOf([childGrant()]), request)).resolves.toEqual({
      allowed: false,
      reasonCode: "delegation_chain_invalid",
      metadata: { delegation: { code: "parent_inactive", grantId: "grant-parent" } },
    });
  });

  it("denies a delegated grant when no resolver is installed", async () => {
    const authorizer = new CapabilityAuthorizer();

    await expect(authorizer.authorize(authorityOf([childGrant()]), request)).resolves.toMatchObject(
      {
        allowed: false,
        reasonCode: "delegation_chain_unverified",
      },
    );
  });

  it("keeps a directly issued grant usable while a delegated sibling is denied", async () => {
    const direct: CapabilityGrant = {
      id: "grant-direct",
      namespaceId: "world-alpha",
      subject: WORKER,
      issuer: MANAGER,
      capabilities: [{ resource: REPORT, actions: ["read"], scope: "exact" }],
      constraints: { purposes: ["prepare-update"] },
      issuedAt: "2026-08-03T08:30:00.000Z",
    };
    const authorizer = new CapabilityAuthorizer({ delegationResolver: resolverFor() });

    await expect(
      authorizer.authorize(authorityOf([childGrant(), direct]), request),
    ).resolves.toMatchObject({ allowed: true, matchedGrantId: "grant-direct" });
  });

  it("reports an unverifiable chain ahead of a merely invalid one", async () => {
    const invalid = childGrant({ id: "grant-invalid", issuer: OWNER });
    const unverifiable = childGrant({ id: "grant-missing", parentGrantId: "grant-absent" });
    const authorizer = new CapabilityAuthorizer({
      delegationResolver: resolverFor(parentGrant()),
    });

    await expect(
      authorizer.authorize(authorityOf([invalid, unverifiable]), request),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "delegation_chain_unverified" });
  });
});

describe("delegated grant contract", () => {
  it("accepts a parent reference and rejects a self-referencing grant", () => {
    expect(CapabilityGrantSchema.safeParse(childGrant()).success).toBe(true);
    expect(
      CapabilityGrantSchema.safeParse(childGrant({ parentGrantId: "grant-child" })).success,
    ).toBe(false);
  });
});

/*
 * The issuing side. A separate vocabulary on purpose: the kernel does not know
 * what an arm is, and a robot line is the clearest way to say that the rules
 * are about resources and actions rather than about files.
 */
const FLEET_NOW = "2026-08-20T09:00:00.000Z";
const FLEET_OWNER = { kind: "human", userId: "fleet-operator" } as const;
const ROBOT_A = { kind: "agent", agentId: "robot-a" } as const;
const ROBOT_B = { kind: "agent", agentId: "robot-b" } as const;

/** Operator grants robot A the whole of cell 3, redelegable once. */
function fleetParent(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "grant-a",
    namespaceId: "fleet",
    subject: ROBOT_A,
    issuer: FLEET_OWNER,
    capabilities: [
      {
        resource: { namespace: "fleet", path: ["cell-3"], owner: FLEET_OWNER },
        actions: ["move", "grip", "release"],
        scope: "descendants",
      },
    ],
    constraints: { purposes: ["pick-and-place"], delegationDepth: 1 },
    issuedAt: "2026-08-20T08:00:00.000Z",
    ...overrides,
  };
}

function derive(
  parent: CapabilityGrant,
  capabilities: CapabilityGrant["capabilities"],
  constraints?: Parameters<typeof deriveGrant>[1]["constraints"],
) {
  return deriveGrant(parent, {
    id: "grant-b",
    subject: ROBOT_B,
    capabilities,
    issuedAt: FLEET_NOW,
    ...(constraints ? { constraints } : {}),
  });
}

const armOnly = [
  {
    resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
    actions: ["grip"],
    scope: "exact" as const,
  },
];

describe("deriveGrant", () => {
  it("passes on a strict subset and names the delegator as issuer", () => {
    const result = derive(fleetParent(), armOnly);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The audit trail has to say who passed the authority on, not only who
    // owned the resource.
    expect(result.grant.issuer).toEqual(ROBOT_A);
    expect(result.grant.subject).toEqual(ROBOT_B);
    // One link, not a chain: the rest of the lineage is the store's to say.
    expect(result.grant.parentGrantId).toBe("grant-a");
    expect(result.grant.constraints.delegationDepth).toBe(0);
    // Purposes are inherited, not dropped.
    expect(result.grant.constraints.purposes).toEqual(["pick-and-place"]);
  });

  it("refuses a wider path", () => {
    const result = derive(fleetParent(), [
      {
        resource: { namespace: "fleet", path: [], owner: FLEET_OWNER },
        actions: ["grip"],
        scope: "descendants",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("refuses a sibling path that shares a prefix", () => {
    // `cell-3` must not cover `cell-30`: matching has to be by segment.
    const result = derive(fleetParent(), [
      {
        resource: { namespace: "fleet", path: ["cell-30"], owner: FLEET_OWNER },
        actions: ["grip"],
        scope: "exact",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("refuses an action the parent does not hold", () => {
    const result = derive(fleetParent(), [
      {
        resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
        actions: ["weld"],
        scope: "exact",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("refuses a wildcard the parent does not hold", () => {
    const result = derive(fleetParent(), [
      {
        resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
        actions: ["*"],
        scope: "exact",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("refuses to widen an exact parent into a subtree", () => {
    const exactParent = fleetParent({
      capabilities: [
        {
          resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
          actions: ["grip"],
          scope: "exact",
        },
      ],
    });
    const result = derive(exactParent, [
      {
        resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
        actions: ["grip"],
        scope: "descendants",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("refuses to pin an owner onto an unowned parent capability", () => {
    // An unowned parent resolves to whoever presents it, so pinning an owner is
    // narrower in one context and wider in every other. Issuing has no context.
    const unowned = fleetParent({
      capabilities: [
        {
          resource: { namespace: "fleet", path: ["cell-3"] },
          actions: ["grip"],
          scope: "descendants",
        },
      ],
    });
    expect(derive(unowned, armOnly)).toEqual({
      ok: false,
      reason: "capability_not_within_parent",
    });
  });

  it("refuses a purpose outside the parent's", () => {
    const result = derive(fleetParent(), armOnly, { purposes: ["teardown"] });
    expect(result).toEqual({ ok: false, reason: "purpose_not_within_parent" });
  });

  it("refuses to outlive the parent, and writes down what it inherited", () => {
    const bounded = fleetParent({
      constraints: { delegationDepth: 1, expiresAt: "2026-08-20T10:00:00.000Z" },
    });
    expect(derive(bounded, armOnly, { expiresAt: "2026-08-20T18:00:00.000Z" })).toEqual({
      ok: false,
      reason: "window_not_within_parent",
    });
    // An unbounded child of a bounded parent outlives it just as surely. The
    // inherited expiry is written onto the derived grant rather than left
    // implicit, because the chain check reads an omission as a widening.
    expect(derive(bounded, armOnly)).toEqual({
      ok: true,
      grant: expect.objectContaining({
        constraints: expect.objectContaining({ expiresAt: "2026-08-20T10:00:00.000Z" }),
      }),
    });
  });

  it("refuses to backdate a child before the parent that authorized it", () => {
    expect(
      deriveGrant(fleetParent(), {
        id: "grant-b",
        subject: ROBOT_B,
        capabilities: armOnly,
        issuedAt: "2026-08-20T07:00:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "issued_before_parent" });
  });

  it("refuses an id that collides with the parent's", () => {
    expect(
      deriveGrant(fleetParent(), {
        id: "grant-a",
        subject: ROBOT_B,
        capabilities: armOnly,
        issuedAt: FLEET_NOW,
      }),
    ).toEqual({ ok: false, reason: "id_collides_with_parent" });
  });

  it("refuses when the parent may not be redelegated", () => {
    expect(derive(fleetParent({ constraints: { delegationDepth: 0 } }), armOnly)).toEqual({
      ok: false,
      reason: "parent_not_delegable",
    });
    expect(derive(fleetParent({ constraints: {} }), armOnly)).toEqual({
      ok: false,
      reason: "parent_not_delegable",
    });
  });

  it("refuses to hand on a longer chain than it received", () => {
    expect(derive(fleetParent(), armOnly, { delegationDepth: 5 })).toEqual({
      ok: false,
      reason: "depth_exhausted",
    });
  });

  it("refuses to split a bounded-use parent", () => {
    // Two children of a 3-use parent would carry six uses between them.
    const bounded = fleetParent({ constraints: { delegationDepth: 1, maxUses: 3 } });
    expect(derive(bounded, armOnly)).toEqual({
      ok: false,
      reason: "bounded_parent_not_delegable",
    });
  });

  it("refuses to satisfy one child capability from parts of several parent ones", () => {
    const split = fleetParent({
      capabilities: [
        {
          resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
          actions: ["grip"],
          scope: "exact",
        },
        {
          resource: { namespace: "fleet", path: ["cell-3", "arm-2"], owner: FLEET_OWNER },
          actions: ["move"],
          scope: "exact",
        },
      ],
    });
    // "move arm-1" is covered by neither, though the pieces exist across both.
    const result = derive(split, [
      {
        resource: { namespace: "fleet", path: ["cell-3", "arm-1"], owner: FLEET_OWNER },
        actions: ["move"],
        scope: "exact",
      },
    ]);
    expect(result).toEqual({ ok: false, reason: "capability_not_within_parent" });
  });

  it("produces a grant the chain check accepts, and stops when the parent dies", async () => {
    // The two halves have to agree: what issuing is willing to write down is
    // exactly what use is willing to honour, and nothing about the child
    // changes when the parent is revoked.
    const parent = fleetParent();
    const derived = derive(parent, armOnly);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    expect(CapabilityGrantSchema.safeParse(derived.grant).success).toBe(true);

    const fleetContext: AccessContext = {
      namespaceId: "fleet",
      enabledToolNamespaces: [],
      actor: ROBOT_B,
      authority: ROBOT_A,
      owner: FLEET_OWNER,
      purpose: "pick-and-place",
      traceId: "shift",
      now: FLEET_NOW,
    };
    const at = Date.parse(FLEET_NOW);

    await expect(
      validateDelegationChain(derived.grant, fleetContext, at, { resolver: resolverFor(parent) }),
    ).resolves.toEqual({ status: "valid", chain: ["grant-a"] });

    const revoked = { ...parent, revokedAt: "2026-08-20T08:30:00.000Z" };
    await expect(
      validateDelegationChain(derived.grant, fleetContext, at, { resolver: resolverFor(revoked) }),
    ).resolves.toMatchObject({ status: "invalid", code: "parent_inactive" });
  });
});
