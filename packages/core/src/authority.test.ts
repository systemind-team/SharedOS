import { describe, expect, it, vi } from "vitest";

import type { AccessContext, CapabilityGrant, ResourceRef } from "@aicoo/sharedos-contracts";

import type { AuditEvent } from "./audit.js";
import { type GrantSource, MAX_RESOLVED_GRANTS, TrustedAuthorityResolver } from "./authority.js";
import { isInfrastructureDenial } from "./authorization.js";
import { ExecutionInProgressError } from "./errors.js";
import { SharedOSKernel } from "./kernel.js";
import type { ResourceInvocationRequest, ResourceProvider } from "./resource-registry.js";

const NOW = "2026-08-03T09:00:00.000Z";
const ACTOR = { kind: "agent", agentId: "agent-bob" } as const;
const AUTHORITY = { kind: "human", userId: "user-alice" } as const;
const OWNER = AUTHORITY;
const RESOURCE: ResourceRef = { namespace: "files", path: ["Workspace", "report.md"] };

function context(): AccessContext {
  return {
    namespaceId: "world-alpha",
    enabledToolNamespaces: ["files"],
    actor: ACTOR,
    authority: AUTHORITY,
    owner: OWNER,
    purpose: "prepare-update",
    traceId: "trace-1",
    now: NOW,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "grant-read",
    namespaceId: "world-alpha",
    subject: ACTOR,
    issuer: AUTHORITY,
    capabilities: [{ resource: RESOURCE, actions: ["read"], scope: "exact" }],
    constraints: { purposes: ["prepare-update"] },
    issuedAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

function sourceOf(load: GrantSource["load"]): GrantSource {
  return { load };
}

function staticSource(grants: readonly CapabilityGrant[]): GrantSource {
  return sourceOf(async () => grants);
}

const READ_REQUEST = { resource: RESOURCE, action: "read" } as const;

describe("TrustedAuthorityResolver", () => {
  const resolve = (source: GrantSource): Promise<unknown> =>
    new TrustedAuthorityResolver(source).resolve(context(), new AbortController().signal);

  it("returns the grants a trusted source loaded, with a snapshot naming them", async () => {
    await expect(resolve(staticSource([grant()]))).resolves.toMatchObject({
      status: "resolved",
      authority: {
        context: context(),
        grants: [grant()],
        snapshot: {
          hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          grantIds: ["grant-read"],
          grantCount: 1,
          loadedAt: NOW,
        },
      },
    });
  });

  it("hashes authority by content, independently of the order a source returns it", async () => {
    const first = grant({ id: "grant-a" });
    const second = grant({ id: "grant-b" });
    const hashOf = async (grants: readonly CapabilityGrant[]): Promise<string> => {
      const resolution = await new TrustedAuthorityResolver(staticSource(grants)).resolve(
        context(),
        new AbortController().signal,
      );
      return resolution.status === "resolved" ? resolution.authority.snapshot.hash : "";
    };

    expect(await hashOf([first, second])).toBe(await hashOf([second, first]));
    expect(await hashOf([first])).not.toBe(await hashOf([first, second]));
    expect(await hashOf([grant({ constraints: { purposes: ["other"] } })])).not.toBe(
      await hashOf([grant()]),
    );
  });

  it("requires a source that can actually be called", () => {
    expect(() => new TrustedAuthorityResolver(undefined as unknown as GrantSource)).toThrow(
      "requires a grant source",
    );
  });

  it("fails closed when the source throws", async () => {
    await expect(
      resolve(
        sourceOf(async () => {
          throw new Error("grant store is unreachable");
        }),
      ),
    ).resolves.toEqual({ status: "unavailable", code: "grant_source_failed" });
  });

  it("fails closed on material that is not a valid grant", async () => {
    await expect(
      resolve(sourceOf(async () => [{ id: "grant-read" } as unknown as CapabilityGrant])),
    ).resolves.toEqual({ status: "unavailable", code: "invalid_grant_material" });

    await expect(
      resolve(sourceOf(async () => ({}) as unknown as readonly CapabilityGrant[])),
    ).resolves.toEqual({ status: "unavailable", code: "invalid_grant_material" });
  });

  it("fails closed instead of quietly filtering out-of-scope authority", async () => {
    // One code for the caller, and the dimension named for the host: the
    // decision stays `authority_unavailable` either way, but an operator
    // reading the audit record should not have to guess which of the three
    // conditions the grant failed.
    for (const [reason, outOfScope] of [
      ["namespace", grant({ namespaceId: "world-beta" })],
      ["subject", grant({ subject: { kind: "agent", agentId: "agent-other" } })],
      ["issuer", grant({ issuer: { kind: "human", userId: "user-mallory" } })],
    ] as const) {
      await expect(resolve(staticSource([grant(), outOfScope]))).resolves.toEqual({
        status: "unavailable",
        code: "grant_scope_mismatch",
        detail: { grantId: outOfScope.id, reason },
      });
    }
  });

  it("fails closed when a source answers with an unbounded set", async () => {
    const oversized = Array.from({ length: MAX_RESOLVED_GRANTS + 1 }, (_value, index) =>
      grant({ id: `grant-${index}` }),
    );

    await expect(resolve(staticSource(oversized))).resolves.toEqual({
      status: "unavailable",
      code: "grant_limit_exceeded",
    });
  });

  it("does not hand the source a mutable view of the caller's context", async () => {
    const seen: AccessContext[] = [];
    await resolve(
      sourceOf(async (access) => {
        seen.push(access);
        (access as { purpose: string }).purpose = "exfiltrate";
        return [];
      }),
    );

    expect(seen[0]?.purpose).toBe("exfiltrate");
    expect(context().purpose).toBe("prepare-update");
  });
});

describe("SharedOSKernel authority boundary", () => {
  function kernelWith(
    source: GrantSource,
    events: AuditEvent[] = [],
    provider?: ResourceProvider,
  ): SharedOSKernel {
    const kernel = new SharedOSKernel({
      grantSource: source,
      audit: { record: async (event) => void events.push(event) },
    });
    if (provider !== undefined) {
      kernel.registerResourceProvider(provider);
    }
    return kernel;
  }

  it("names the authority every decision was made against", async () => {
    const events: AuditEvent[] = [];
    let revoked = false;
    const kernel = kernelWith(
      sourceOf(async () => (revoked ? [] : [grant()])),
      events,
    );

    await kernel.authorize(context(), READ_REQUEST);
    revoked = true;
    await kernel.authorize(context(), READ_REQUEST);

    const [firstResolved, firstDecision, secondResolved, secondDecision] = events;
    expect(firstDecision?.authorityHash).toBe(firstResolved?.authorityHash);
    expect(secondDecision?.authorityHash).toBe(secondResolved?.authorityHash);
    expect(firstDecision?.authorityHash).not.toBe(secondDecision?.authorityHash);
    // `hostCeiling` and `hostPolicy` ride on every authority load so a reader
    // can tell an absent policy port from one that never fired, and a ceiling
    // deciding over loaded state from one deciding over its own (ADR 0020).
    expect(firstResolved?.metadata).toEqual({
      grantIds: ["grant-read"],
      grantCount: 1,
      hostCeiling: "absent",
      hostPolicy: "absent",
    });
    expect(secondResolved?.metadata).toEqual({
      grantIds: [],
      grantCount: 0,
      hostCeiling: "absent",
      hostPolicy: "absent",
    });
  });

  it("authorizes only what the trusted source served", async () => {
    await expect(
      kernelWith(staticSource([grant()])).authorize(context(), READ_REQUEST),
    ).resolves.toEqual({ allowed: true, reasonCode: "allowed", matchedGrantId: "grant-read" });
    await expect(
      kernelWith(staticSource([])).authorize(context(), READ_REQUEST),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
      requiredAuthority: {
        capabilities: [
          { resource: READ_REQUEST.resource, actions: [READ_REQUEST.action], scope: "exact" },
        ],
      },
    });
  });

  it("denies and audits every operation when authority cannot be loaded", async () => {
    const events: AuditEvent[] = [];
    const unavailable = sourceOf(async () => {
      throw new Error("grant store is unreachable");
    });
    const kernel = kernelWith(unavailable, events);

    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toEqual({
      allowed: false,
      reasonCode: "authority_unavailable",
      metadata: { authority: { code: "grant_source_failed" } },
    });
    await expect(kernel.admitTurn(context(), ACTOR)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "authority_unavailable",
    });
    expect(events.map(({ type }) => type)).toEqual([
      "authority.resolved",
      "authorization.checked",
      "authority.resolved",
      "authorization.checked",
    ]);
    expect(events.every((event) => event.failClosed === true)).toBe(true);
    expect(isInfrastructureDenial("authority_unavailable")).toBe(true);
  });

  it("never reaches a resource provider when authority is unavailable", async () => {
    const invoke = vi.fn<ResourceProvider["invoke"]>();
    const request: ResourceInvocationRequest = {
      operationId: "operation-1",
      resource: RESOURCE,
      action: "read",
    };
    const kernel = kernelWith(
      sourceOf(async () => {
        throw new Error("grant store is unreachable");
      }),
      [],
      { namespace: "files", invoke },
    );

    await expect(kernel.invokeResource(context(), request)).resolves.toMatchObject({
      status: "denied",
      error: { code: "authority_unavailable" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exposes no tools when authority is unavailable", async () => {
    const events: AuditEvent[] = [];
    const kernel = kernelWith(
      sourceOf(async () => {
        throw new Error("grant store is unreachable");
      }),
      events,
    );
    kernel.registerTool({
      definition: {
        name: "files.read",
        description: "Read one authorized file",
        namespace: "files",
        source: "sharedos",
        readWrite: "read",
        inputSchema: { type: "object" },
        requiredCapability: { resource: RESOURCE, action: "read" },
        annotations: { readOnly: true },
      },
      parseArguments: (arguments_) => arguments_,
      invoke: async (_access, call) => ({
        callId: call.id,
        tool: call.tool,
        status: "succeeded",
        output: null,
        completedAt: NOW,
      }),
    });

    await expect(kernel.listTools(context())).resolves.toEqual([]);
    await expect(
      kernel.invokeTool(context(), {
        id: "call-1",
        tool: "files.read",
        arguments: {},
        traceId: "trace-1",
        requestedAt: NOW,
      }),
    ).resolves.toMatchObject({ status: "denied", error: { code: "authority_unavailable" } });
    expect(events.find(({ type }) => type === "tool.catalog.listed")).toMatchObject({
      outcome: "denied",
      reason: "authority_unavailable",
    });
  });

  it("resolves authority per operation when no turn is open", async () => {
    let revoked = false;
    const kernel = kernelWith(sourceOf(async () => (revoked ? [] : [grant()])));

    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: true,
    });
    revoked = true;
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
    });
  });
});

describe("SharedOSKernel turn-scoped authority", () => {
  const kernelWith = (
    source: GrantSource,
    loads?: { count: number },
    events?: AuditEvent[],
  ): SharedOSKernel =>
    new SharedOSKernel({
      grantSource: {
        load: async (accessContext, signal) => {
          if (loads !== undefined) {
            loads.count += 1;
          }
          return source.load(accessContext, signal);
        },
      },
      ...(events === undefined
        ? {}
        : { audit: { record: async (event: AuditEvent) => void events.push(event) } }),
    });

  it("isolates executions sharing every access field", async () => {
    let revoked = false;
    const loads = { count: 0 };
    const kernel = kernelWith(
      sourceOf(async () => (revoked ? [] : [grant()])),
      loads,
    );
    const firstContext = { ...context(), executionId: "execution-a" };
    const secondContext = { ...context(), executionId: "execution-b" };
    const first = await kernel.openTurnAuthority(firstContext);
    revoked = true;
    const second = await kernel.openTurnAuthority(secondContext);
    try {
      await expect(kernel.authorize(firstContext, READ_REQUEST)).resolves.toMatchObject({
        allowed: true,
      });
      await expect(kernel.authorize(secondContext, READ_REQUEST)).resolves.toMatchObject({
        allowed: false,
      });
      expect(loads.count).toBe(2);
    } finally {
      first.close();
      second.close();
    }
  });

  it("refuses a second open under an execution id whose turn is still open", async () => {
    const loads = { count: 0 };
    const events: AuditEvent[] = [];
    const kernel = kernelWith(staticSource([grant()]), loads, events);
    const running = { ...context(), executionId: "execution-a" };
    const scope = await kernel.openTurnAuthority(running);

    const refusal = await kernel.openTurnAuthority(running).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(ExecutionInProgressError);
    expect(refusal).toMatchObject({ code: "execution_in_progress" });
    // Refused from the lease table: no store read, no record, and the open
    // turn still answers.
    expect(loads.count).toBe(1);
    expect(events.filter(({ type }) => type === "authority.resolved")).toHaveLength(1);
    await expect(kernel.authorize(running, READ_REQUEST)).resolves.toMatchObject({ allowed: true });

    scope.close();
    const again = await kernel.openTurnAuthority(running);
    expect(again.status).toBe("resolved");
    again.close();
  });

  it("refuses the later of two opens that race under one execution id", async () => {
    let finishFirst!: (grants: readonly CapabilityGrant[]) => void;
    const slow = new Promise<readonly CapabilityGrant[]>((resolve) => {
      finishFirst = resolve;
    });
    // The first read waits and any later one answers at once, so a turn that
    // went to whichever load finished first would go to the later open.
    let reads = 0;
    const kernel = kernelWith(sourceOf(async () => (reads++ === 0 ? slow : [grant()])));
    const racing = { ...context(), executionId: "execution-a" };
    const first = kernel.openTurnAuthority(racing);
    const second = kernel.openTurnAuthority(racing);

    // Refused at once and without a store read: the open called first holds
    // the turn while it loads.
    await expect(second).rejects.toMatchObject({ code: "execution_in_progress" });
    expect(reads).toBe(1);
    finishFirst([grant()]);
    const scope = await first;
    expect(scope.status).toBe("resolved");
    await expect(kernel.authorize(racing, READ_REQUEST)).resolves.toMatchObject({ allowed: true });
    scope.close();
  });

  it("frees a turn whose open was cancelled while it loaded", async () => {
    let reads = 0;
    const kernel = kernelWith(
      sourceOf(async (_context, signal) => {
        reads += 1;
        if (reads > 1) {
          return [grant()];
        }
        return new Promise<readonly CapabilityGrant[]>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
    );
    const racing = { ...context(), executionId: "execution-a" };
    const controller = new AbortController();
    const cancelled = kernel.openTurnAuthority(racing, { signal: controller.signal });
    controller.abort(new Error("host cancelled"));

    await expect(cancelled).rejects.toThrow("host cancelled");
    const scope = await kernel.openTurnAuthority(racing);
    expect(scope.status).toBe("resolved");
    scope.close();
  });

  it("keeps a turn's authority until the last of two racing opens closes", async () => {
    let finish!: (grants: readonly CapabilityGrant[]) => void;
    const pending = new Promise<readonly CapabilityGrant[]>((resolve) => {
      finish = resolve;
    });
    let revoked = false;
    const loads = { count: 0 };
    const kernel = kernelWith(
      sourceOf(async () => (revoked ? [] : pending)),
      loads,
    );
    const firstOpening = kernel.openTurnAuthority(context());
    const secondOpening = kernel.openTurnAuthority(context());
    finish([grant()]);
    const [first, second] = await Promise.all([firstOpening, secondOpening]);
    revoked = true;
    first.close();
    try {
      await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
        allowed: true,
      });
      expect(loads.count).toBe(2);
    } finally {
      second.close();
    }
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("holds one authority state for the whole turn, however many decisions it makes", async () => {
    const loads = { count: 0 };
    const kernel = kernelWith(staticSource([grant()]), loads);

    const turn = await kernel.openTurnAuthority(context());
    for (let index = 0; index < 4; index += 1) {
      await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
        allowed: true,
      });
    }
    turn.close();

    expect(turn.status).toBe("resolved");
    expect(loads.count).toBe(1);
  });

  it("does not observe a revocation recorded while the turn is running", async () => {
    let revoked = false;
    const kernel = kernelWith(sourceOf(async () => (revoked ? [] : [grant()])));

    const turn = await kernel.openTurnAuthority(context());
    revoked = true;
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: true,
    });
    turn.close();

    // The next turn loads again, and the revocation lands there.
    const next = await kernel.openTurnAuthority(context());
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
    });
    next.close();
  });

  it("observes an expiry the operation's own clock has passed, inside the turn", async () => {
    const expiring = grant({ constraints: { purposes: ["prepare-update"], expiresAt: NOW } });
    const kernel = kernelWith(staticSource([expiring]));
    const beforeExpiry = { ...context(), now: "2026-08-03T08:59:00.000Z" };

    const turn = await kernel.openTurnAuthority(beforeExpiry);
    // Admitted before the window closed, so the turn holds the grant.
    await expect(kernel.authorize(beforeExpiry, READ_REQUEST)).resolves.toMatchObject({
      allowed: true,
    });
    // Same turn, same held grant set, later operation. The window has closed and
    // the grant is refused without the store being read again.
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
    });
    turn.close();
  });

  it("refuses an expired grant without re-reading the store", async () => {
    const expiring = grant({ constraints: { purposes: ["prepare-update"], expiresAt: NOW } });
    const loads = { count: 0 };
    const kernel = kernelWith(staticSource([expiring]), loads);

    const turn = await kernel.openTurnAuthority({ ...context(), now: "2026-08-03T08:59:00.000Z" });
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
    });
    turn.close();

    expect(loads.count).toBe(1);
  });

  it("names the turn's one snapshot on a decision an expiry narrowed", async () => {
    const events: AuditEvent[] = [];
    const expiring = grant({ constraints: { purposes: ["prepare-update"], expiresAt: NOW } });
    const kernel = kernelWith(staticSource([expiring]), undefined, events);
    const beforeExpiry = { ...context(), now: "2026-08-03T08:59:00.000Z" };

    const turn = await kernel.openTurnAuthority(beforeExpiry);
    await kernel.authorize(beforeExpiry, READ_REQUEST);
    await kernel.authorize(context(), READ_REQUEST);
    turn.close();

    // Expiry narrows what one snapshot authorizes; it does not make a second
    // authority state, so both decisions name the same hash.
    const decisions = events.filter(({ type }) => type === "authorization.checked");
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.authorityHash).toBe(decisions[1]?.authorityHash);
    expect(decisions[0]?.authorityHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("does not let a validity window open mid-turn", async () => {
    // The mirror of the expiry rule, and the reason the split is directional
    // rather than a matter of where the fact came from: the operation's clock
    // may take authority away and may never hand any back.
    const pending = grant({
      constraints: { purposes: ["prepare-update"], notBefore: "2026-08-03T09:30:00.000Z" },
    });
    const kernel = kernelWith(staticSource([pending]));
    const afterNotBefore = { ...context(), now: "2026-08-03T10:00:00.000Z" };

    const turn = await kernel.openTurnAuthority(context());
    await expect(kernel.authorize(afterNotBefore, READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "no_matching_grant",
    });
    turn.close();

    // The next turn is admitted inside the window and holds it.
    const next = await kernel.openTurnAuthority(afterNotBefore);
    await expect(kernel.authorize(afterNotBefore, READ_REQUEST)).resolves.toMatchObject({
      allowed: true,
    });
    next.close();
  });

  it("does not let an operation instant before the turn's revive an expired grant", async () => {
    const expiring = grant({ constraints: { purposes: ["prepare-update"], expiresAt: NOW } });
    const kernel = kernelWith(staticSource([expiring]));

    const turn = await kernel.openTurnAuthority(context());
    await expect(
      kernel.authorize({ ...context(), now: "2026-08-03T08:30:00.000Z" }, READ_REQUEST),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "no_matching_grant" });
    turn.close();
  });

  it("never answers one turn's operation from another turn's authority", async () => {
    const kernel = kernelWith(staticSource([grant()]));

    const turn = await kernel.openTurnAuthority(context());
    // Same actor and namespace, different purpose: a different decision, and one
    // this grant does not permit.
    await expect(
      kernel.authorize({ ...context(), purpose: "publish-summary" }, READ_REQUEST),
    ).resolves.toMatchObject({ allowed: false, reasonCode: "no_matching_grant" });
    turn.close();
  });

  it("stops answering from a closed turn", async () => {
    const loads = { count: 0 };
    const kernel = kernelWith(staticSource([grant()]), loads);

    (await kernel.openTurnAuthority(context())).close();
    await kernel.authorize(context(), READ_REQUEST);

    expect(loads.count).toBe(2);
  });

  it("keeps a turn fail-closed without re-reading an unavailable store", async () => {
    const loads = { count: 0 };
    const kernel = kernelWith(
      sourceOf(async () => {
        throw new Error("grant store is unreachable");
      }),
      loads,
    );

    const turn = await kernel.openTurnAuthority(context());
    expect(turn).toMatchObject({ status: "unavailable", code: "grant_source_failed" });
    await expect(kernel.authorize(context(), READ_REQUEST)).resolves.toMatchObject({
      allowed: false,
      reasonCode: "authority_unavailable",
    });
    turn.close();

    expect(loads.count).toBe(1);
  });
});
