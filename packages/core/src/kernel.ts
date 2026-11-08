import type {
  AccessContext,
  Address,
  AgentCardView,
  AuthorizationDecision,
  Capability,
  CapabilityRequirement,
  Escalation,
  JsonObject,
  MessageDeliveryResult,
  MessageEnvelope,
  ReachResult,
  ResourceResult,
  SharedOSToolCatalog,
  ToolCall,
  ToolDefinition,
  ToolNamespaceCatalog,
  ToolNamespaceUpdate,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import {
  AGENT_CARD_VIEWS,
  AddressSchema,
  EnabledToolNamespacesSchema,
  EscalationSchema,
  MessageDeliveryResultSchema,
  MessageEnvelopeSchema,
  ResourceResultSchema,
  ToolNamespaceUpdateSchema,
  ToolResultSchema,
} from "@aicoo/sharedos-contracts";

import {
  type AgentCardRead,
  agentCardRequest,
  composeAgentCard,
  subjectCardContext,
} from "./agent-card.js";
import {
  type AuditEvent,
  type AuditEventInput,
  type AuditSource,
  type AuditSink,
  NoopAuditSink,
  auditEvent,
} from "./audit.js";
import {
  type AuthorityResolution,
  type AuthorityUnavailableCode,
  type GrantSource,
  type LoadedPolicy,
  type PolicyResolution,
  type PolicySource,
  type ResolvedAuthority,
  TrustedAuthorityResolver,
  type TurnAuthorityScope,
  turnAuthorityKey,
} from "./authority.js";
import {
  type AuthorizationExplanation,
  CapabilityAuthorizer,
  addressesEqual,
  isInfrastructureDenial,
} from "./authorization.js";
import type { ProviderErrorContext, ProviderErrorReporter } from "./diagnostics.js";
import { type CapabilityRequestPayload, mintCapabilityRequest } from "./capability-request.js";
import {
  type MessageCapabilityResolver,
  type MessageRequestRouter,
  type MessageTransport,
  RecipientScopedMessageCapabilityResolver,
  addressPath,
} from "./message-service.js";
import { createMessageRequestTool, MESSAGE_REQUEST_TOOL_NAME } from "./message-tool.js";
import {
  type ResourceInvocationRequest,
  type ResourceProvider,
  ResourceProviderRegistry,
  toResourceOperation,
} from "./resource-registry.js";
import { buildToolCatalog, catalogHash, publishToolCatalog } from "./published-tool.js";
import {
  ReplayProtection,
  ReplayError,
  replayContext,
  canonicalReplayJson,
  type ReplayStore,
} from "./replay.js";
import { sha256Hex } from "./hashing.js";
import { SPAN, measure, type SpanSink } from "./spans.js";
import { type ContextToolProvider, type ToolHandler, ToolRegistry } from "./tool-registry.js";
import type { ToolNamespaceSettingsStore } from "./tool-namespace-control.js";
import {
  AUDIT_UNAVAILABLE,
  AuditUnavailableError,
  AuditWriteTimeoutError,
  DuplicateRegistrationError,
  ExecutionInProgressError,
  MissingRegistrationError,
} from "./errors.js";
import {
  deepFreeze,
  protocolError,
  raceAbort,
  readJsonObject,
  refusedToolResult,
  reportProviderError,
} from "./internal.js";

export interface SharedOSKernelOptions {
  /** Activate durable replay enforcement for all effect and execution paths (ADR 0028). */
  readonly replayStore?: ReplayStore;
  /**
   * The trusted boundary that loads authority. It is required: a kernel with
   * no authoritative grant source can only fail closed.
   */
  readonly grantSource: GrantSource;
  /**
   * The trusted boundary that loads host policy, once per turn, beside the
   * grant set. See {@link PolicySource}.
   *
   * Optional. Without one the ceiling installed on the authorizer, if any, is
   * handed `undefined` and decides over state it closes over. It is installed
   * here rather than beside the ceiling because the load is a turn-boundary
   * event and the kernel owns the turn boundary; a throw is reported to
   * {@link SharedOSKernelOptions.onProviderError} as `kind: "policy"`, and the
   * turn's policy fails closed.
   */
  readonly policySource?: PolicySource;
  readonly authorizer?: CapabilityAuthorizer;
  readonly resources?: ResourceProviderRegistry;
  readonly tools?: ToolRegistry;
  readonly toolProviders?: readonly ContextToolProvider[];
  readonly toolNamespaceSettings?: ToolNamespaceSettingsStore;
  readonly messageTransport?: MessageTransport;
  readonly messageRequestRouter?: MessageRequestRouter;
  readonly messageCapabilityResolver?: MessageCapabilityResolver;
  readonly createMessageId?: (context: AccessContext, call: ToolCall) => string;
  /**
   * How each audit record gets its identity. A random UUID by default.
   *
   * Override for a deterministic host -- a replayed fixture, a conformance
   * run -- and nowhere else, and never with a factory that can repeat: two
   * records with one id are one record to every sink that deduplicates, which
   * is exactly the loss `AuditEvent.id` exists to prevent.
   */
  readonly createAuditId?: () => string;
  readonly audit?: AuditSink;
  /**
   * Notification for an audit write that failed after the effect it records.
   *
   * An operation's outcome, a turn's ending and an escalation are written once
   * the answer is final; a sink that throws there is handed here and the caller
   * receives the result it would have received. The writes made *before* an
   * effect -- an authority load, a decision, a catalogue listing -- are not
   * reported here: a sink that throws on one of those rejects the operation
   * with an `AuditUnavailableError`, and nothing runs.
   */
  readonly onAuditError?: (error: unknown, event: AuditEvent) => void | Promise<void>;
  /**
   * How long a record written after an effect may keep a caller from its result.
   *
   * A sink that throws on such a record is already handed to `onAuditError`. A
   * sink that does not answer at all is not a throw, and without a limit the
   * result of an effect that has committed waits behind it for as long as the
   * caller does: a turn that reaches its deadline first drops a result whose
   * transfer went through. Past the limit the event is handed to `onAuditError`
   * with an `AuditWriteTimeoutError` and the caller receives its result. The
   * hook is held to the same limit, since it usually writes to the same store.
   *
   * Absent means no limit, which is the behaviour before this option. The
   * records written before an effect are never limited: there a sink that does
   * not answer holds back an operation that has not run, which is the point.
   */
  readonly auditWriteTimeoutMs?: number;
  /**
   * Notification for a throw the kernel contained rather than propagated.
   *
   * A provider, tool handler, transport, or router that throws is answered with
   * a fixed reason code, and until a host installs this the error itself is
   * gone: `tool_execution_failed` says an operation stopped and does not say
   * why. One hook covers every such port, and {@link ProviderErrorContext.kind}
   * is what a host branches on if it wants to treat them differently.
   *
   * Synchronous, unlike {@link SharedOSKernelOptions.onAuditError}, and see
   * {@link reportContainedError} for why the two differ.
   */
  readonly onProviderError?: ProviderErrorReporter;
  /**
   * Where the cost of enforcement is reported, when a host is measuring it.
   *
   * Absent by default and absent in every production path that does not ask for
   * it, which is what keeps a measured run and an unmeasured one the same run.
   * See {@link SpanSink}.
   */
  readonly spans?: SpanSink;
}

export interface KernelOperationOptions {
  /** Trusted executor scope for tool-call IDs; standalone calls use context.traceId. */
  readonly executionId?: string;
  readonly signal?: AbortSignal;
}

/** How a turn finished, as the boundary that finished it saw it. */
export interface TurnEndRecord {
  readonly executionId: string;
  readonly status: "succeeded" | "denied" | "failed" | "cancelled" | "escalated";
  /** The terminal code, where the ending had one. */
  readonly reasonCode?: string;
  /**
   * Who produced a failure: the envelope refusing, or the runtime reporting its
   * own. The same distinction `ExecutionEvent` carries, kept because a record
   * reader crediting enforcement must not credit a plugin's self-reported error.
   */
  readonly endedBy?: "envelope" | "runtime";
}

/** One call an enforcement boundary refused without invoking anything. */
export interface RefusedCall {
  readonly callId: string;
  readonly tool: string;
  readonly reasonCode: string;
  /** Which situation a coarse code was, where it covers several. */
  readonly cause?: string;
}

/** What a `tool.invoked` event carries beyond the call and its result. */
interface ToolResultAuditDetail {
  readonly grantId?: string;
  readonly requirement?: CapabilityRequirement;
  /**
   * Which situation a coarse refusal was, when the code covers several.
   *
   * `tool_unavailable` is deliberately one code over "not registered",
   * "namespace disabled", and "not discoverable to you" so the caller learns it
   * cannot use the tool and not which. An audit reader is not the caller.
   */
  readonly cause?: string;
}

export interface EscalationOptions extends KernelOperationOptions {
  /**
   * The execution the escalation ended, where the caller has one.
   *
   * Recorded as the event's `operationId`, which is what `turn.ended` carries
   * for the same turn, so a reviewer's queue built from audit joins an
   * escalation to its turn on an id rather than on `traceId` and time order.
   * The execution envelope passes it; a host escalating outside a turn has
   * none and omits it.
   */
  readonly executionId?: string;
  /**
   * The authority this escalation is asking for.
   *
   * A host escalating a denial passes the `requiredAuthority` that denial
   * described; a model-chosen escalation usually has none, because a sentence
   * is all it produced. Either way nothing here advances the escalation --
   * resolution stays host-owned work that ends in a grant the next turn loads.
   *
   * The two names are one concept in two roles, and both end in the noun this
   * package uses for what grants confer: a denial says what was *required*, and
   * an escalation *requests* it. `{ requestedAuthority: denial.requiredAuthority }`
   * is the whole hop.
   *
   * What is recorded is minted, not copied. The ask -- capabilities, purpose,
   * constraints, metadata -- is the caller's; `id`, `namespaceId`, `requester`,
   * `owner`, and `requestedAt` come from the trusted context, whatever the
   * caller wrote, because a request the caller authored would be a
   * caller-chosen correlation for a decision the kernel made. The hop above
   * still round-trips: the denial's description was minted from the same ask,
   * so it comes back under the same identifier (ADR 0019).
   */
  readonly requestedAuthority?: CapabilityRequestPayload;
}

export interface AgentCardReadOptions extends KernelOperationOptions {
  /**
   * The view to serve, defaulting to `reach`.
   *
   * `reach` is the default because a directory without reach is not the
   * feature: an agent asking about a colleague's agent is asking what it can be
   * asked for. A reader that holds only a narrower view is refused and told
   * which views it may still ask for, rather than being quietly served a
   * different card than the one it asked for.
   */
  readonly view?: AgentCardView;
}

export const EXECUTION_NAMESPACE = "sharedos.execution";
export const AGENT_INVOKE_ACTION = "invoke";

export function agentExecutionCapability(agent: Address, owner: Address): Capability {
  return {
    resource: {
      namespace: EXECUTION_NAMESPACE,
      path: addressPath(agent),
      owner,
    },
    actions: [AGENT_INVOKE_ACTION],
    scope: "exact",
  };
}

/**
 * One turn's shared catalogue derivation, and who is still waiting on it.
 *
 * The derivation runs under a signal of its own rather than under the signal
 * of whichever operation happened to need a catalogue first. Sharing one
 * derivation is the point; sharing one caller's cancellation is not, and a
 * turn's operations abort independently of each other.
 */
interface HeldRegistry {
  readonly promise: Promise<ToolRegistry>;
  readonly controller: AbortController;
  /** Operations still awaiting it. At zero, nobody is left to answer. */
  waiting: number;
  settled: boolean;
}

/** One turn's frozen authority, and the number of open handles on it. */
interface AuthorityLease {
  refs: number;
  readonly resolution: AuthorityResolution;
  /**
   * The effective registry this turn resolved, once an operation needed one.
   *
   * The promise rather than the value, so operations that need a catalogue at
   * the same moment share one derivation instead of racing to produce two
   * (ADR 0026).
   */
  registry?: HeldRegistry | undefined;
  /**
   * The catalogue identity this turn published, once it has published one.
   *
   * Set by `listTools`, which is where a catalogue is filtered to what the
   * caller may see and hashed. A turn that never listed carries none, and its
   * calls say nothing rather than naming a catalogue nobody was served.
   */
  catalogHash?: string | undefined;
}

/**
 * Host-neutral facade for every permission-controlled SharedOS operation.
 * AccessContext is a trusted host-created boundary; never construct it from an
 * unverified request body.
 */
export class SharedOSKernel {
  readonly replayProtection: ReplayProtection;
  readonly #authority: TrustedAuthorityResolver;
  readonly #policySource: PolicySource | undefined;
  readonly #leases = new Map<string, AuthorityLease>();
  /**
   * What a message transport answered when it refused a `messages.request`.
   *
   * The caller is told `message_request_not_accepted` whatever the transport
   * said, for the reason `tool_unavailable` is one code over several: the
   * transport's vocabulary is the host's, and what it reveals is not the
   * caller's to learn. The tool's audit record is not the caller, and names the
   * transport's code as its `cause`. It travels here rather than through the
   * handler's result, which is returned to the caller whole. Keyed on the
   * frozen call the kernel hands the handler, so concurrent calls sharing an id
   * cannot read each other's, and held weakly, so nothing outlives its call.
   */
  readonly #dispatchCauses = new WeakMap<ToolCall, string>();
  readonly #authorizer: CapabilityAuthorizer;
  readonly #resources: ResourceProviderRegistry;
  readonly #tools: ToolRegistry;
  readonly #toolProviders: Map<string, ContextToolProvider>;
  readonly #toolNamespaceSettings: ToolNamespaceSettingsStore | undefined;
  readonly #messageTransport: MessageTransport | undefined;
  readonly #messageRequestRouter: MessageRequestRouter | undefined;
  readonly #messageCapabilityResolver: MessageCapabilityResolver;
  readonly #messageIds = new WeakMap<ToolCall, string>();
  readonly #createMessageId: (context: AccessContext, call: ToolCall) => string;
  readonly #createAuditId: () => string;
  readonly #audit: AuditSink;
  readonly #onAuditError: ((error: unknown, event: AuditEvent) => void | Promise<void>) | undefined;
  readonly #auditWriteTimeoutMs: number | undefined;
  readonly #onProviderError: ProviderErrorReporter | undefined;
  readonly #spans: SpanSink | undefined;

  constructor(options: SharedOSKernelOptions) {
    this.replayProtection = new ReplayProtection(options.replayStore);
    this.#authority = new TrustedAuthorityResolver(options?.grantSource);
    if (options.policySource !== undefined && typeof options.policySource?.load !== "function") {
      throw new TypeError("SharedOS requires a policy source that provides a load function");
    }
    this.#policySource = options.policySource;
    this.#authorizer = options.authorizer ?? new CapabilityAuthorizer();
    this.#resources = options.resources ?? new ResourceProviderRegistry();
    this.#tools = options.tools ?? new ToolRegistry();
    this.#toolProviders = new Map();
    for (const provider of options.toolProviders ?? []) {
      this.registerToolProvider(provider);
    }
    this.#toolNamespaceSettings = options.toolNamespaceSettings;
    this.#messageTransport = options.messageTransport;
    this.#messageRequestRouter = options.messageRequestRouter;
    this.#messageCapabilityResolver =
      options.messageCapabilityResolver ?? new RecipientScopedMessageCapabilityResolver();
    this.#createMessageId =
      options.createMessageId ??
      ((_context, call) => {
        const id = this.#messageIds.get(call);
        if (id === undefined) throw new Error("Message identity was not prepared");
        return id;
      });
    this.#createAuditId = options.createAuditId ?? (() => crypto.randomUUID());
    this.#audit = options.audit ?? new NoopAuditSink();
    this.#onAuditError = options.onAuditError;
    this.#auditWriteTimeoutMs = options.auditWriteTimeoutMs;
    if (
      this.#auditWriteTimeoutMs !== undefined &&
      (!Number.isInteger(this.#auditWriteTimeoutMs) || this.#auditWriteTimeoutMs <= 0)
    ) {
      throw new TypeError("auditWriteTimeoutMs must be a positive integer");
    }
    this.#onProviderError = options.onProviderError;
    this.#spans = options.spans;
  }

  registerResourceProvider(provider: ResourceProvider): void {
    this.#resources.register(provider);
  }

  registerTool(handler: ToolHandler): void {
    this.#tools.register(handler);
  }

  registerToolProvider(provider: ContextToolProvider): void {
    const id = provider.id.trim();
    if (id.length === 0) {
      throw new TypeError("tool provider id must not be empty");
    }
    if (this.#toolProviders.has(id)) {
      throw new DuplicateRegistrationError("tool provider", id);
    }
    this.#toolProviders.set(id, provider);
  }

  /**
   * Resolve the authority one turn will be decided against, and hold it.
   *
   * A turn must decide against a single authority state. This loads that state
   * once, at the turn boundary, and every kernel operation presenting the same
   * turn identity is then answered from it -- including operations a tool
   * handler makes back into the kernel, which never receive a handle and would
   * otherwise re-read the store.
   *
   * An unavailable source is held too, so a turn that could not establish
   * authority stays fail-closed for its whole length instead of retrying the
   * store on every call and possibly changing its mind.
   *
   * A context that carries an `executionId` opens a turn of its own, and a
   * second open while that turn is held rejects with an
   * `ExecutionInProgressError`. One that carries none joins the lease its other
   * fields already hold.
   *
   * Callers must `close` the returned scope on every exit path. Hosts that call
   * kernel operations outside any turn need not open one: an operation with no
   * lease resolves its own authority, which is a turn of one operation.
   */
  async openTurnAuthority(
    context: AccessContext,
    options: KernelOperationOptions = {},
  ): Promise<TurnAuthorityScope> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);

    const key = turnAuthorityKey(context);
    // The lease table is the record of what is running. A context that names
    // its execution may not join a lease: one execution id is one turn.
    const held = (): AuthorityLease | undefined => {
      const lease = this.#leases.get(key);
      if (lease !== undefined && context.executionId !== undefined) {
        throw new ExecutionInProgressError(context.executionId);
      }
      return lease;
    };

    let lease = held();
    if (lease === undefined) {
      const resolution = await this.#loadAuthority(context, options.signal);
      // Read again: another open of this turn may have installed its lease
      // while this one loaded, and replacing it would let its close drop ours.
      lease = held();
      if (lease === undefined) {
        lease = { refs: 0, resolution };
        this.#leases.set(key, lease);
      }
    }
    lease.refs += 1;
    return scopeFor(lease.resolution, () => this.#releaseTurnAuthority(key));
  }

  #releaseTurnAuthority(key: string): void {
    const lease = this.#leases.get(key);
    if (lease === undefined) {
      return;
    }
    lease.refs -= 1;
    if (lease.refs <= 0) {
      this.#leases.delete(key);
    }
  }

  async authorize(
    context: AccessContext,
    request: CapabilityRequirement,
    options: KernelOperationOptions = {},
  ): Promise<AuthorizationDecision> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    request = structuredClone(request);
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      return this.#denyUnavailableAuthority(context, request, authority.code, false);
    }
    return this.#authorize(context, authority.authority, request, false);
  }

  /** Consume permission to invoke exactly one target agent turn. */
  async admitTurn(
    context: AccessContext,
    agent: Address,
    options: KernelOperationOptions = {},
  ): Promise<AuthorizationDecision> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    agent = structuredClone(agent);
    const request: CapabilityRequirement = {
      resource: {
        namespace: EXECUTION_NAMESPACE,
        path: addressPath(agent),
        owner: context.owner,
      },
      action: AGENT_INVOKE_ACTION,
    };
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      return this.#denyUnavailableAuthority(context, request, authority.code, true);
    }
    return this.#authorize(context, authority.authority, request, true);
  }

  /**
   * Record that a turn stopped and asked a human to decide.
   *
   * This mints nothing and unblocks nothing. It writes one audit event and
   * returns the stub the turn terminates with, so an escalation is visible in
   * the same stream as the decisions around it rather than surviving only as
   * runtime prose. The reviewer is the owner the turn already runs on behalf
   * of; SharedOS has no review roster and does not invent one.
   *
   * Resolving an escalation is host-owned control-plane work: it ends in a new
   * grant issued to the trusted store, which the *next* turn loads. There is
   * deliberately no path from here back into the running turn.
   */
  async recordEscalation(
    context: AccessContext,
    reason: string,
    options: EscalationOptions = {},
  ): Promise<Escalation> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const requestedAuthority =
      options.requestedAuthority === undefined
        ? undefined
        : await mintCapabilityRequest(context, structuredClone(options.requestedAuthority));
    if (options.requestedAuthority !== undefined && requestedAuthority === undefined) {
      throw new TypeError("escalation requestedAuthority does not match the SharedOS v1 contract");
    }
    const parsed = EscalationSchema.safeParse({
      reason,
      reviewer: context.owner,
      requestedAt: context.now,
      status: "pending",
      ...(requestedAuthority === undefined ? {} : { requestedAuthority }),
    });
    if (!parsed.success) {
      throw new TypeError("escalation does not match the SharedOS v1 contract");
    }

    // The outcome path, not the decision path. This is the turn's terminal
    // record: the runtime has already elected to escalate and nothing is
    // waiting on the write, so a sink that throws here is reported to
    // `onAuditError` and the turn still ends `escalated`. Propagating it would
    // end the turn `runtime_failed` and blame a plugin that did nothing wrong.
    await this.#recordOutcome(
      this.#auditEvent(context, {
        type: "escalation.requested",
        outcome: "escalated",
        reason: "escalation_requested",
        ...(options.executionId === undefined ? {} : { operationId: options.executionId }),
        metadata: {
          detail: parsed.data.reason,
          reviewer: parsed.data.reviewer,
          reviewerAssumed: true,
          resolution: "pending",
        },
        // Recorded so a reviewer's queue can be built from audit alone. The
        // reason is what a model wrote; this is what can be turned into a grant
        // without reading it (ADR 0019).
        ...(parsed.data.requestedAuthority === undefined
          ? {}
          : { requestedAuthority: parsed.data.requestedAuthority }),
      }),
    );

    return parsed.data;
  }

  /**
   * Record how a turn ended, from the boundary that ended it.
   *
   * The envelope owns turn termination and, until this existed, owned no audit
   * at all: a turn that started, completed, failed, or was cancelled left
   * nothing in the trail, so a host reading audit could not bound a turn or
   * join a set of tool calls to the one that made them beyond `traceId`. It is
   * called through the kernel rather than from an `AuditSink` of the envelope's
   * own, because one sink passed in two places is one sink a host can forget to
   * pass twice -- and the failure mode of forgetting is a turn that enforces
   * correctly and records nothing (ADR 0023).
   *
   * One event, at the terminal. Not five: a lifecycle event per transition
   * would triple the audit volume of every successful turn to say nothing more,
   * and a `turn.denied` would double-count against the `authorization.checked`
   * {@link admitTurn} already produced for the same refusal.
   *
   * A cancelled turn is recorded `failed` with reason `turn_cancelled` rather
   * than gaining an `AuditOutcome` of its own. The outcome vocabulary is a
   * compatibility surface every host persists against, and `reason` already
   * separates a deadline from a defect.
   */
  async recordTurnEnd(
    context: AccessContext,
    turn: TurnEndRecord,
    options: KernelOperationOptions = {},
  ): Promise<void> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    await this.#recordOutcome(
      this.#auditEvent(context, {
        type: "turn.ended",
        outcome: turn.status === "cancelled" ? "failed" : turn.status,
        operationId: turn.executionId,
        ...(turn.reasonCode === undefined ? {} : { reason: turn.reasonCode }),
        // No `source`. It would say who recorded, which is always the envelope;
        // who *ended* the turn is `endedBy`, and that is the fact a reader wants.
        ...(turn.endedBy === undefined ? {} : { endedBy: turn.endedBy }),
        ...failClosedFor(turn.reasonCode),
      }),
    );
  }

  /**
   * Record a tool call the envelope refused before the kernel was asked.
   *
   * A name the turn's catalogue never offered, a spent step budget, a spent
   * tool-call budget. These are attempted violations -- the guessed tool name is
   * the clearest one the system produces -- and they reached no audit sink at
   * all, because the boundary that refused them does not own one.
   *
   * Recorded as `tool.invoked`, because that is what it is: a tool call that was
   * attempted and denied. `source` says `envelope`, which is the fact
   * that stops being inferable the moment this method exists (ADR 0023).
   */
  async recordRefusedCall(
    context: AccessContext,
    call: RefusedCall,
    options: KernelOperationOptions = {},
  ): Promise<void> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    await this.#recordToolInvoked(context, {
      source: "envelope",
      callId: call.callId,
      tool: call.tool,
      outcome: "denied",
      reasonCode: call.reasonCode,
      ...(call.cause === undefined ? {} : { cause: call.cause }),
    });
  }

  /**
   * The kernel's description of one agent: identity, computed reach, nothing
   * else.
   *
   * SharedOS can address an agent and can authorize one; this is how it
   * describes one, so an agent asking a colleague's agent for something can
   * find out what that agent may be asked for instead of learning it out of
   * band. Reach is derived here, from the grants in force at this instant, and
   * is never stored: a stored reach would keep advertising a revoked grant,
   * and it is the one description of authority in SharedOS that nothing would
   * invalidate.
   *
   * Reading a card is itself authorized, over `sharedos` /
   * `["directory", <subject>]` / `read`. Without that gate the directory is an
   * enumeration oracle: it would answer "does this agent exist" and, through
   * reach, "what resources exist and where", in one call rather than one
   * refusal at a time -- exactly the disclosure ADR 0012 and ADR 0019 decline
   * to make. The gate is also what pays for the second authority load: nothing
   * loads a subject's grants until a reader has been authorized to ask about
   * that subject, and the `identity` view never loads them at all.
   *
   * A card is a view rather than a record. A less-authorized reader is served a
   * narrower card, built from the fields that view declares, and never a wider
   * one with a redaction pass over it. See `agentCardPath` for how the
   * views are addressed and ADR 0021 for why the coarse answer is its own view
   * rather than a filter inside `reach`.
   *
   * Nothing is consumed. Reading that a door exists is not opening it, for the
   * same reason discovery does not spend a bounded grant.
   *
   * The host's richer card composes around this one. Display names, avatars,
   * skills and protocol bindings stay in the host: the test is not whether a
   * field is useful but whether it is authority.
   */
  async readAgentCard(
    context: AccessContext,
    subject: Address,
    options: AgentCardReadOptions = {},
  ): Promise<AgentCardRead> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const parsedSubject = AddressSchema.safeParse(structuredClone(subject));
    if (!parsedSubject.success) {
      throw new TypeError("agent card subject does not match the SharedOS v1 contract");
    }
    subject = parsedSubject.data;
    const view = options.view ?? "reach";
    const request = agentCardRequest(subject, context.owner, view);

    const reader = await this.#resolveAuthority(context, options.signal);
    if (reader.status !== "resolved") {
      const decision = await this.#denyUnavailableAuthority(context, request, reader.code, false);
      return { status: "refused", reasonCode: decision.reasonCode, servableViews: [] };
    }

    const decision = await this.#authorize(context, reader.authority, request, false);
    if (!decision.allowed) {
      return {
        status: "refused",
        reasonCode: decision.reasonCode,
        servableViews: await this.#servableCardViews(
          context,
          reader.authority,
          subject,
          view,
          options.signal,
        ),
        ...(decision.requiredAuthority === undefined
          ? {}
          : { requiredAuthority: decision.requiredAuthority }),
      };
    }

    if (view === "identity") {
      // No reach on this view, so no second load: the subject's grants are read
      // only when the card the reader was authorized for is made of them.
      return { status: "served", card: composeAgentCard(view, subject, context, []) };
    }

    // The second load. Same namespace, same instant, same authority as the
    // reader's own -- only the actor differs, which is what bounds the card to
    // what the subject holds under the authority the reader is operating under.
    // A subject authority that cannot be established refuses the read rather
    // than serving an empty reach, which would understate silently.
    const subjectContext = subjectCardContext(context, subject);
    const subjectAuthority = await this.#resolveAuthority(subjectContext, options.signal);
    if (subjectAuthority.status !== "resolved") {
      return { status: "refused", reasonCode: "authority_unavailable", servableViews: [] };
    }

    const reach = await this.#authorizer.reach(subjectAuthority.authority, { now: context.now });
    if (reach.status !== "computed") {
      // A budget that cannot be read refuses the card rather than narrowing it,
      // under the code the decide path already fails closed with (ADR 0021).
      return { status: "refused", reasonCode: reach.reasonCode, servableViews: [] };
    }
    return { status: "served", card: composeAgentCard(view, subject, context, reach.reach) };
  }

  /**
   * Which other views of this subject this same reader could be served.
   *
   * Advice attached to a refusal, not decisions about the operation, so they
   * are checked against the authority already in hand and are not audited: one
   * card read is one recorded `authorization.checked`, on the view that was
   * asked for. They are non-consuming, and they disclose nothing the reader did
   * not already hold -- every entry is a grant this reader has.
   */
  async #servableCardViews(
    context: AccessContext,
    authority: ResolvedAuthority,
    subject: Address,
    refused: AgentCardView,
    signal: AbortSignal | undefined,
  ): Promise<readonly AgentCardView[]> {
    const servable: AgentCardView[] = [];
    for (const view of AGENT_CARD_VIEWS) {
      signal?.throwIfAborted();
      if (view === refused) {
        continue;
      }
      const decision = await this.#authorizer.authorize(
        authority,
        agentCardRequest(subject, context.owner, view),
        { now: context.now },
      );
      if (decision.allowed) {
        servable.push(view);
      }
    }
    return servable;
  }

  /**
   * Where this actor may operate, with the authority stripped out.
   *
   * The turn's own reach: namespace, path, actions and scope from the grants
   * that would authorize something at this instant, and nothing about who
   * granted them, for how long, or how many uses remain. A runtime is handed it
   * as `RuntimeVisibleContext.reach`, so a model can be told where to look
   * without the host reading raw grants to write a prompt -- at exactly the
   * boundary designed to keep grants away from the model. The card in
   * {@link readAgentCard} is this same derivation pointed at somebody else.
   *
   * Grant reach, over the whole world this context names. The host ceiling is
   * not consulted, for the reason ADR 0021 gives, and `enabledToolNamespaces`
   * is not applied here: the resource plane is not gated by tool namespaces, so
   * an actor may reach through `invokeResource` what no enabled tool offers. A
   * caller acting only through tools narrows to its catalogue with
   * `reachThroughTools`, which is what the execution envelope does for a turn.
   *
   * Non-consuming, and never a substitute for authorization: an over-wide entry
   * is harmless because every operation is decided independently afterwards.
   *
   * Fails whole rather than narrow. Authority that cannot be loaded and a
   * bounded budget that cannot be read both answer `unavailable`, under the
   * code the decide path fails closed with, because a reach that quietly
   * omitted a live grant would be indistinguishable from one that is true. The
   * authority load records itself; a turn that ends on an unavailable reach is
   * recorded by the envelope as the turn's terminal.
   */
  async reach(context: AccessContext, options: KernelOperationOptions = {}): Promise<ReachResult> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      return { status: "unavailable", reasonCode: "authority_unavailable" };
    }
    return this.#authorizer.reach(authority.authority, { now: context.now });
  }

  async listTools(
    context: AccessContext,
    options: KernelOperationOptions = {},
  ): Promise<readonly ToolDefinition[]> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      await this.#recordDecision(
        this.#auditEvent(context, {
          type: "tool.catalog.listed",
          outcome: "denied",
          reason: "authority_unavailable",
          source: "kernel",
          failClosed: true,
          metadata: {
            catalogHash: this.#holdCatalogHash(context, await catalogHash([])),
            enabledNamespaces: [...context.enabledToolNamespaces],
            withheldCount: 0,
            authority: authority.code,
          },
        }),
      );
      return [];
    }

    const allowed: ToolDefinition[] = [];
    let withheldCount = 0;
    let withheldByOutage = false;
    const enabledNamespaces = new Set(context.enabledToolNamespaces);
    const tools = await this.#resolveToolRegistry(context, options.signal);

    for (const definition of tools.definitions()) {
      options.signal?.throwIfAborted();
      if (!enabledNamespaces.has(definition.namespace)) {
        withheldCount += 1;
        continue;
      }
      const decision = await this.#authorizer.canDiscover(
        authority.authority,
        {
          resource: definition.requiredCapability.resource,
          action: definition.requiredCapability.action,
        },
        { now: context.now },
      );
      if (decision.allowed) {
        allowed.push(definition);
      } else {
        withheldCount += 1;
        withheldByOutage ||= isInfrastructureDenial(decision.reasonCode);
      }
    }

    const { hostPolicy } = authority.authority;
    await this.#recordDecision(
      this.#auditEvent(context, {
        type: "tool.catalog.listed",
        outcome: "succeeded",
        authorityHash: authority.authority.snapshot.hash,
        source: "kernel",
        ...(withheldByOutage ? { failClosed: true } : {}),
        metadata: {
          // What the listing was computed from and what it came to, as
          // identifiers and a count rather than as names. `catalogHash` is the
          // catalogue the caller was shown -- the identifier `listPublishedTools`
          // hands a harness, so audit and an execution's manifest match on it;
          // `authorityHash` above and `hostPolicyVersion` are the two states it
          // was decided against; `enabledNamespaces` is the caller's own
          // filter. Equal values on two events mean the same catalogue for the
          // same reasons, and the record does not grow with the registry: a
          // two-hundred-tool registry would otherwise write its names to audit
          // on every turn to say what one digest says once. A tool name is a
          // registry constant, so what the names cost was volume, not secrecy.
          // What a count cannot carry is the per-tool cause, and `failClosed`
          // keeps the one distinction a reader cannot do without: whether
          // something was withheld by an outage rather than by a decision
          // (ADR 0023).
          catalogHash: this.#holdCatalogHash(
            context,
            await catalogHash(publishToolCatalog(allowed)),
          ),
          enabledNamespaces: [...context.enabledToolNamespaces],
          ...(hostPolicy?.status === "loaded" ? { hostPolicyVersion: hostPolicy.version } : {}),
          withheldCount,
        },
      }),
    );

    return allowed;
  }

  /**
   * The effective catalogue as an external harness receives it.
   *
   * {@link listTools} answers with SharedOS registrations, which carry the
   * capability each tool would require. That is the right answer inside the host
   * and the wrong thing to put on a wire, so everything crossing the MCP
   * boundary goes through this instead: the same permission-filtered set,
   * projected to what a model is allowed to see, in canonical order, with the
   * hash that identifies it.
   *
   * A context whose authority could not be loaded receives an empty catalogue
   * and a hash over nothing, exactly as {@link listTools} returns no tools --
   * fail-closed, and still a well-formed catalogue rather than an error the
   * harness would have to interpret.
   */
  async listPublishedTools(
    context: AccessContext,
    options: KernelOperationOptions & { readonly executionId: string },
  ): Promise<SharedOSToolCatalog> {
    const definitions = await this.listTools(context, options);
    return buildToolCatalog(definitions, { executionId: options.executionId });
  }

  async listToolNamespaces(
    context: AccessContext,
    options: KernelOperationOptions = {},
  ): Promise<ToolNamespaceCatalog> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const tools = await this.#resolveToolRegistry(context, options.signal);
    const catalog = tools.namespaceCatalog(context.enabledToolNamespaces);

    await this.#recordDecision(
      this.#auditEvent(context, {
        type: "tool.namespace.catalog.listed",
        outcome: "succeeded",
        metadata: {
          totalNamespaces: catalog.summary.total,
          enabledNamespaces: catalog.summary.enabled,
        },
      }),
    );

    return catalog;
  }

  async updateToolNamespaces(
    context: AccessContext,
    update: ToolNamespaceUpdate,
    options: KernelOperationOptions = {},
  ): Promise<ToolNamespaceCatalog> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    const parsedUpdate = ToolNamespaceUpdateSchema.safeParse(structuredClone(update));
    if (!parsedUpdate.success) {
      throw new TypeError("tool namespace update does not match the SharedOS contract");
    }
    if (this.#toolNamespaceSettings === undefined) {
      throw new MissingRegistrationError("tool namespace settings", "default");
    }

    const candidate = await this.#toolNamespaceSettings.applyUpdate(
      context,
      parsedUpdate.data,
      options.signal ?? neverAbortedSignal(),
    );
    options.signal?.throwIfAborted();
    const parsedEnabled = EnabledToolNamespacesSchema.safeParse([...candidate]);
    if (!parsedEnabled.success) {
      throw new TypeError("tool namespace settings returned an invalid selection");
    }

    const updatedContext: AccessContext = {
      ...context,
      enabledToolNamespaces: parsedEnabled.data,
    };
    const tools = await this.#resolveToolRegistry(updatedContext, options.signal);
    const catalog = tools.namespaceCatalog(updatedContext.enabledToolNamespaces);

    await this.#recordOutcome(
      this.#auditEvent(updatedContext, {
        type: "tool.namespace.selection.updated",
        outcome: "succeeded",
        metadata: {
          enabledNamespaces: catalog.namespaces
            .filter((namespace) => namespace.enabled)
            .map((namespace) => namespace.namespace),
        },
      }),
    );

    return catalog;
  }

  /**
   * Re-authorize and dispatch one tool call.
   *
   * The span around it is the kernel's whole share of one mediated call, and it
   * contains the provider's own work, which is not enforcement. That part is
   * named separately as `SPAN.TOOL_HANDLER` and carries the same call id,
   * so a report subtracts it rather than attributing the host's storage to
   * SharedOS. Both spans exist or neither does.
   */
  async invokeTool(
    context: AccessContext,
    call: ToolCall,
    options: KernelOperationOptions = {},
  ): Promise<ToolResult> {
    return measure(
      this.#spans,
      SPAN.TOOL_INVOKE,
      (span) => {
        span.set("callId", call.id);
        span.set("tool", call.tool);
        const snapshot = structuredClone({ context, call });
        const { requestedAt: _requestedAt, ...input } = snapshot.call;
        return this.#replayTool(snapshot.context, snapshot.call, options, input);
      },
      (result, span) => span.set("outcome", result.status),
    );
  }

  async #replayTool(
    context: AccessContext,
    call: ToolCall,
    options: KernelOperationOptions,
    input: unknown,
  ): Promise<ToolResult> {
    try {
      return await this.replayProtection.run(
        {
          namespaceId: context.namespaceId,
          kind: "tool",
          scope: context.executionId ?? options.executionId ?? context.traceId,
          id: call.id,
        },
        { context: replayContext(context), call: input },
        () => this.#invokeTool(context, call, options),
        (value) => {
          const result = ToolResultSchema.parse(value);
          if (result.callId !== call.id || result.tool !== call.tool)
            throw new Error("Mismatched replay result");
          return result;
        },
        options.signal,
      );
    } catch (error) {
      if (!(error instanceof ReplayError)) throw error;
      const result = refusedToolResult(
        call,
        error.code === "replay_conflict" ? "denied" : "failed",
        context.now,
        error.code,
        "Operation replay refused",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }
  }

  async #invokeTool(
    context: AccessContext,
    call: ToolCall,
    options: KernelOperationOptions = {},
  ): Promise<ToolResult> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    call = structuredClone(call);
    if (call.traceId !== context.traceId) {
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        "trace_mismatch",
        "Tool call traceId does not match its access context",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        "authority_unavailable",
        AUTHORITY_UNAVAILABLE_MESSAGE,
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    let tools: ToolRegistry;
    try {
      // Named separately because the segment is the catalogue's, and a number
      // that could not be attributed to it would read as the cost of
      // authorizing. Inside a turn this reads the held resolution, so what the
      // span reports after the first operation is the holding, not a derivation.
      tools = await measure(this.#spans, SPAN.TOOL_CATALOGUE, (span) => {
        span.set("callId", call.id);
        return this.#resolveToolRegistry(context, options.signal);
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      // What arrives here is the wrapper `#resolveToolRegistry` threw, with the
      // provider's own error as its `cause`. The wrapper is the sentence every
      // caller of the catalogue reads; the cause is the only account of what
      // actually broke, and it would have been destroyed without it. A host
      // logging this wants both, which is why neither is unwrapped here.
      this.#reportProviderError(error, context, {
        kind: "tool_catalog",
        reasonCode: "tool_catalog_unavailable",
        operationId: call.id,
        tool: call.tool,
      });
      const result = refusedToolResult(
        call,
        "failed",
        context.now,
        "tool_catalog_unavailable",
        "The tool catalog could not be resolved",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    const handler = tools.get(call.tool);
    if (handler === undefined) {
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        "tool_unavailable",
        "The requested tool is not available in this access context",
      );
      await this.#recordToolResult(context, call, result, { cause: "not_registered" });
      return result;
    }

    if (!context.enabledToolNamespaces.includes(handler.definition.namespace)) {
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        "tool_unavailable",
        "The requested tool is not available in this access context",
      );
      await this.#recordToolResult(context, call, result, { cause: "namespace_disabled" });
      return result;
    }

    // Asked for here and not in `listTools`. A catalogue being filtered denies
    // on most of what it looks at; this is one call somebody made, refused at
    // this check and nowhere else, and the record of it is the only place a
    // host can read which grant was turned away or which port was never wired.
    let discoveryExplanation: AuthorizationExplanation | undefined;
    const discoverable = await measure(
      this.#spans,
      SPAN.TOOL_DISCOVER,
      (span) => {
        span.set("callId", call.id);
        return this.#authorizer.canDiscover(
          authority.authority,
          {
            resource: handler.definition.requiredCapability.resource,
            action: handler.definition.requiredCapability.action,
          },
          {
            now: context.now,
            onExplain: (received) => {
              discoveryExplanation = received;
            },
          },
        );
      },
      (decision, span) => span.set("outcome", decision.allowed ? "visible" : "hidden"),
    );
    if (!discoverable.allowed) {
      await this.#recordAuthorizationDecision(
        context,
        {
          resource: handler.definition.requiredCapability.resource,
          action: handler.definition.requiredCapability.action,
        },
        discoverable,
        false,
        authority.authority.snapshot.hash,
        // The decision was made for this call, and the refusal below carries
        // the same id. Without it the two records join only on time order,
        // and a reader with two turns on one sink joins the wrong pair.
        call.id,
        discoveryExplanation,
      );
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        "tool_unavailable",
        "The requested tool is not available in this access context",
      );
      // The cause follows the decision rather than being hard-coded, so a
      // catalogue refusal a host ceiling made is nameable as one. Without it,
      // `host_policy_denied` could only ever appear on the decision event, and
      // a host counting policy refusals from the operation events would get
      // zero (ADR 0023).
      await this.#recordToolResult(context, call, result, {
        cause: discoverable.reasonCode,
        requirement: {
          resource: handler.definition.requiredCapability.resource,
          action: handler.definition.requiredCapability.action,
        },
      });
      return result;
    }

    let parsedCall: ToolCall;
    try {
      const parsedArguments = readJsonObject(handler.parseArguments(call.arguments));
      if (parsedArguments === undefined) {
        throw new TypeError("tool argument parser returned a non-JSON object");
      }
      parsedCall = deepFreeze(structuredClone({ ...call, arguments: parsedArguments }));
    } catch (error) {
      this.#reportProviderError(error, context, {
        kind: "tool",
        reasonCode: "invalid_tool_arguments",
        operationId: call.id,
        tool: call.tool,
      });
      const result = refusedToolResult(
        call,
        "failed",
        context.now,
        "invalid_tool_arguments",
        "The requested tool arguments are invalid",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    let requirement: CapabilityRequirement;
    try {
      if (call.tool === MESSAGE_REQUEST_TOOL_NAME) {
        this.#messageIds.set(
          parsedCall,
          await sha256Hex(
            canonicalReplayJson([
              context.namespaceId,
              context.executionId ?? options.executionId ?? context.traceId,
              context.actor,
              call.id,
            ]),
          ),
        );
      }
      requirement =
        handler.resolveRequirement?.(context, parsedCall) ?? handler.definition.requiredCapability;
    } catch (error) {
      this.#reportProviderError(error, context, {
        kind: "tool",
        reasonCode: "tool_requirement_resolution_failed",
        operationId: call.id,
        tool: call.tool,
      });
      const result = refusedToolResult(
        call,
        "failed",
        context.now,
        "tool_requirement_resolution_failed",
        "The tool could not resolve its required capability",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    // The world boundary is checked before the tool's own ceiling. A requirement
    // naming another owner is a request to act outside this world, which is a
    // denial the authorizer already has a code for -- `invalid_request` -- and
    // it is answered there so the refusal carries a recorded authorization
    // decision like every other denial. Deciding it here first would report a
    // boundary crossing as `invalid_tool_requirement`, which means something
    // else: a tool that resolved a capability outside the boundary it declared.
    if (!requirementBelongsToContext(requirement, context)) {
      const crossing = await this.#authorize(
        context,
        authority.authority,
        { resource: requirement.resource, action: requirement.action },
        false,
        call.id,
      );
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        crossing.reasonCode,
        "The requested resource lies outside this access context's world",
      );
      await this.#recordToolResult(context, call, result, { requirement });
      return result;
    }

    if (!requirementIsWithinDefinition(handler.definition, requirement, context)) {
      const result = refusedToolResult(
        call,
        "failed",
        context.now,
        "invalid_tool_requirement",
        "The tool resolved a capability outside its declared boundary",
      );
      await this.#recordToolResult(context, call, result);
      return result;
    }

    const decision = await this.#authorize(
      context,
      authority.authority,
      { resource: requirement.resource, action: requirement.action },
      true,
      call.id,
    );
    if (!decision.allowed) {
      const result = refusedToolResult(
        call,
        "denied",
        context.now,
        decision.reasonCode,
        "The access context does not grant this tool capability",
      );
      await this.#recordToolResult(context, call, result, { requirement });
      return result;
    }

    const result = await this.#invokePort<ToolResult>({
      context,
      signal: options.signal,
      invoke: () =>
        measure(this.#spans, SPAN.TOOL_HANDLER, (span) => {
          span.set("callId", call.id);
          span.set("tool", call.tool);
          return handler.invoke(
            context,
            parsedCall,
            options.signal ?? neverAbortedSignal(),
            this.replayProtection.store === undefined
              ? undefined
              : deepFreeze({
                  namespaceId: context.namespaceId,
                  kind: "tool",
                  scope: context.executionId ?? options.executionId ?? context.traceId,
                  id: call.id,
                }),
          );
        }),
      accept: (candidate) => {
        const parsed = ToolResultSchema.safeParse(candidate);
        return parsed.success && parsed.data.callId === call.id && parsed.data.tool === call.tool
          ? parsed.data
          : undefined;
      },
      refuse: (code, message) => refusedToolResult(call, "failed", context.now, code, message),
      invalid: ["invalid_tool_result", "The tool returned an invalid protocol result"],
      failed: ["tool_execution_failed", "The tool failed while executing"],
      operation: {
        kind: "tool",
        operationId: call.id,
        tool: call.tool,
        resource: requirement.resource,
        action: requirement.action,
      },
      interrupted: (reasonCode) =>
        this.#recordToolInvoked(context, {
          source: "kernel",
          callId: call.id,
          tool: call.tool,
          outcome: "interrupted",
          reasonCode,
          ...(decision.matchedGrantId === undefined ? {} : { grantId: decision.matchedGrantId }),
          requirement,
        }),
    });

    const dispatchCause = this.#dispatchCauses.get(parsedCall);
    await this.#recordToolResult(context, call, result, {
      ...(decision.matchedGrantId === undefined ? {} : { grantId: decision.matchedGrantId }),
      requirement,
      ...(result.status === "succeeded" || dispatchCause === undefined
        ? {}
        : { cause: dispatchCause }),
    });
    return result;
  }

  async invokeResource(
    context: AccessContext,
    request: ResourceInvocationRequest,
    options: KernelOperationOptions = {},
  ): Promise<ResourceResult> {
    context = structuredClone(context);
    request = structuredClone(request);
    request = {
      ...request,
      resource: { ...request.resource, owner: request.resource.owner ?? context.owner },
    };
    try {
      return await this.replayProtection.run(
        { namespaceId: context.namespaceId, kind: "resource", scope: "", id: request.operationId },
        { context: replayContext(context), request },
        () => this.#invokeResource(context, request, options),
        (value) => {
          const result = ResourceResultSchema.parse(value);
          if (result.operationId !== request.operationId)
            throw new Error("Mismatched replay result");
          return result;
        },
        options.signal,
      );
    } catch (error) {
      if (!(error instanceof ReplayError)) throw error;
      const result = refusedResourceResult(
        request,
        error.code === "replay_conflict" ? "denied" : "failed",
        context.now,
        error.code,
        "Operation replay refused",
      );
      await this.#recordResourceResult(context, request, result);
      return result;
    }
  }

  async #invokeResource(
    context: AccessContext,
    request: ResourceInvocationRequest,
    options: KernelOperationOptions = {},
  ): Promise<ResourceResult> {
    options.signal?.throwIfAborted();
    context = structuredClone(context);
    request = structuredClone(request);
    request = {
      ...request,
      resource: {
        ...request.resource,
        owner: request.resource.owner ?? context.owner,
      },
    };
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      const result = refusedResourceResult(
        request,
        "denied",
        context.now,
        "authority_unavailable",
        AUTHORITY_UNAVAILABLE_MESSAGE,
      );
      await this.#recordResourceResult(context, request, result);
      return result;
    }

    const decision = await this.#authorize(
      context,
      authority.authority,
      { resource: request.resource, action: request.action },
      true,
    );
    if (!decision.allowed) {
      const result = refusedResourceResult(
        request,
        "denied",
        context.now,
        decision.reasonCode,
        "The access context does not grant this resource capability",
      );
      await this.#recordResourceResult(context, request, result);
      return result;
    }

    const provider = this.#resources.get(request.resource.namespace);
    let result: ResourceResult;
    if (provider === undefined) {
      result = refusedResourceResult(
        request,
        "failed",
        context.now,
        "resource_provider_not_found",
        "No provider is registered for the requested resource namespace",
      );
    } else {
      result = await this.#invokePort<ResourceResult>({
        context,
        signal: options.signal,
        invoke: () =>
          provider.invoke(
            toResourceOperation(context, request),
            options.signal ?? neverAbortedSignal(),
          ),
        accept: (candidate) => {
          const parsed = ResourceResultSchema.safeParse(candidate);
          return parsed.success && parsed.data.operationId === request.operationId
            ? parsed.data
            : undefined;
        },
        refuse: (code, message) =>
          refusedResourceResult(request, "failed", context.now, code, message),
        invalid: [
          "invalid_resource_result",
          "The resource provider returned an invalid protocol result",
        ],
        failed: ["resource_execution_failed", "The resource provider failed while executing"],
        operation: {
          kind: "resource",
          operationId: request.operationId,
          resource: request.resource,
          action: request.action,
        },
        interrupted: (reasonCode) =>
          this.#recordOutcome(
            this.#auditEvent(context, {
              type: "resource.invoked",
              outcome: "interrupted",
              operationId: request.operationId,
              resource: request.resource,
              action: request.action,
              ...(decision.matchedGrantId === undefined
                ? {}
                : { grantId: decision.matchedGrantId }),
              ...operationFacts("kernel", reasonCode),
            }),
          ),
      });
    }

    await this.#recordResourceResult(context, request, result, decision.matchedGrantId);
    return result;
  }

  /**
   * The effective tool registry this turn is answered from.
   *
   * Resolved once and held on the turn's authority lease, so every operation a
   * turn makes reads the same catalogue: the one `catalogHash` names, the one
   * the MCP handshake's `listChanged` of `false` promises a client, and the one
   * the model was shown. A `ContextToolProvider` is host-supplied and live --
   * the MCP server behind it reconnects, the configuration behind it is
   * re-read -- so re-deriving per operation let a turn's second call be decided
   * against a definition its first call never saw, carrying a
   * `requiredCapability` the recorded catalogue never advertised (ADR 0026).
   *
   * An operation outside a lease resolves its own, which is a turn of one
   * operation: the degrade ADR 0010 already defines for authority, and the
   * reason this guarantee needs nothing threaded through a host to hold.
   *
   * A rejection is not held. It is not a catalogue, the operation that met it
   * fails closed on its own, and holding one would let an abort belonging to a
   * single caller's signal answer for the rest of the turn.
   *
   * Which is also why the derivation does not run under the signal of the
   * operation that started it. That signal belongs to one caller, and a caller
   * that gives up would otherwise cancel the derivation every other operation
   * in the turn is waiting on -- failing them `tool_catalog_unavailable`, or
   * throwing its `AbortError` at an operation that passed no signal at all.
   * Each caller instead waits against its own signal, and the shared
   * derivation is cancelled only once every caller waiting on it has gone.
   */
  async #resolveToolRegistry(
    context: AccessContext,
    signal: AbortSignal | undefined,
  ): Promise<ToolRegistry> {
    const lease = this.#leases.get(turnAuthorityKey(context));
    if (lease === undefined) {
      return this.#deriveToolRegistry(context, signal);
    }

    const held = (lease.registry ??= this.#holdRegistry(lease, context));
    held.waiting += 1;
    try {
      return await raceAbort(held.promise, signal);
    } finally {
      held.waiting -= 1;
      // Nobody is left to be answered, so the work nobody asked for any more is
      // cancelled. Guarded on `settled` so a derivation that already produced a
      // catalogue is not sent an abort its provider could still be holding.
      if (held.waiting === 0 && !held.settled) {
        held.controller.abort();
      }
    }
  }

  /** Start this turn's one derivation, under a signal no single caller owns. */
  #holdRegistry(lease: AuthorityLease, context: AccessContext): HeldRegistry {
    const controller = new AbortController();
    const held: HeldRegistry = {
      controller,
      waiting: 0,
      settled: false,
      promise: this.#deriveToolRegistry(context, controller.signal),
    };
    held.promise.then(
      () => {
        held.settled = true;
      },
      () => {
        held.settled = true;
        // Not held: a rejection is not a catalogue, and a later operation in
        // the turn is entitled to try again. Guarded so a rejection arriving
        // after another operation already began a fresh derivation does not
        // discard that one too.
        if (lease.registry === held) {
          lease.registry = undefined;
        }
      },
    );
    return held;
  }

  /**
   * Hold the catalogue identity this turn published, and hand it back.
   *
   * `catalogHash` said which catalogue a listing served and nothing said which
   * one a call was answered from, so the correspondence between them was a
   * claim in a comment rather than anything a reader could check. Holding it
   * beside the resolution it identifies is what lets `tool.invoked` carry it:
   * the two events then join on a value, and a turn's calls are attributable to
   * the catalogue its model was shown.
   *
   * Returned rather than only stored, so the event being built reads the same
   * value that was held instead of computing it twice.
   */
  #holdCatalogHash(context: AccessContext, hash: string): string {
    const lease = this.#leases.get(turnAuthorityKey(context));
    if (lease !== undefined) {
      lease.catalogHash = hash;
    }
    return hash;
  }

  async #deriveToolRegistry(
    context: AccessContext,
    signal: AbortSignal | undefined,
  ): Promise<ToolRegistry> {
    // Copied rather than re-registered. `#tools` holds handlers `register` has
    // already validated, cloned and frozen, and re-deriving them per call spent
    // a schema parse and a JSON round trip each to arrive at equal values. The
    // copy is what every registration below lands on, so a host registry handed
    // in as `options.tools` is still never mutated by resolving a catalogue.
    const resolved = this.#tools.copy();

    if (this.#messageTransport !== undefined && this.#messageRequestRouter !== undefined) {
      // Constructed with the derivation, which is now once per turn rather than
      // once per call. It carries the envelope it prepared between
      // `resolveRequirement` and `invoke`, and that state is keyed on the call
      // object rather than held on the handler, so concurrent calls in one turn
      // do not share it.
      resolved.register(
        createMessageRequestTool({
          capabilityResolver: this.#messageCapabilityResolver,
          router: this.#messageRequestRouter,
          createMessageId: this.#createMessageId,
          reportProviderError: (error, access, operation) =>
            this.#reportProviderError(error, access, operation),
          deliverAuthorizedMessage: async (access, envelope, operationSignal, call) => {
            const delivery = await this.#replayMessage(access, envelope, operationSignal, () =>
              this.#deliverAuthorizedMessage(access, envelope, operationSignal, undefined, call.id),
            );
            if (delivery.status === "denied" || delivery.status === "failed") {
              this.#dispatchCauses.set(call, delivery.error.code);
            }
            return delivery;
          },
        }),
      );
    }

    for (const provider of [...this.#toolProviders.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      signal?.throwIfAborted();
      let handlers: readonly ToolHandler[];
      try {
        handlers = await provider.listTools(
          structuredClone(context),
          signal ?? neverAbortedSignal(),
        );
      } catch (error) {
        signal?.throwIfAborted();
        // Wrapped rather than re-thrown, so every caller sees one sentence for
        // "the catalogue could not be built" -- and `cause`d, so the provider's
        // own error survives to whoever ends up looking. `listTools` lets this
        // reach its caller; `invokeTool` contains it and reports it.
        throw new Error("A context tool provider failed to resolve its catalog", { cause: error });
      }
      if (!Array.isArray(handlers)) {
        throw new TypeError("A context tool provider returned an invalid catalog");
      }
      for (const handler of handlers) {
        // Deliberately not wrapped. A handler the registry refuses throws a
        // named error -- `DuplicateRegistrationError`, or a `TypeError` naming
        // what about the definition was wrong -- and a caller of `listTools`
        // both sees and matches on those today. Wrapping them to make the
        // diagnostic hook's `cause` unconditional would trade a typed error a
        // host can branch on for a sentence it cannot, which is the wrong way
        // round; the hook's contract says instead that it reports the error as
        // thrown, and names the one case that is wrapped.
        resolved.register(handler);
      }
    }

    return resolved;
  }

  async sendMessage(
    context: AccessContext,
    envelope: MessageEnvelope,
    options: KernelOperationOptions = {},
  ): Promise<MessageDeliveryResult> {
    context = structuredClone(context);
    const parsed = MessageEnvelopeSchema.safeParse(structuredClone(envelope));
    if (!parsed.success)
      throw new TypeError("message envelope does not match the SharedOS contract");
    envelope = parsed.data;
    return this.#replayMessage(context, envelope, options.signal, () =>
      this.#sendMessage(context, envelope, options),
    );
  }

  async #replayMessage(
    context: AccessContext,
    envelope: MessageEnvelope,
    signal: AbortSignal | undefined,
    invoke: () => Promise<MessageDeliveryResult>,
  ): Promise<MessageDeliveryResult> {
    try {
      return await this.replayProtection.run(
        { namespaceId: context.namespaceId, kind: "message", scope: "", id: envelope.id },
        { context: replayContext(context), envelope },
        invoke,
        (value) => {
          const result = MessageDeliveryResultSchema.parse(value);
          if (result.messageId !== envelope.id) throw new Error("Mismatched replay result");
          return result;
        },
        signal,
      );
    } catch (error) {
      if (!(error instanceof ReplayError)) throw error;
      const result = refusedMessageResult(
        envelope,
        error.code === "replay_conflict" ? "denied" : "failed",
        context.now,
        error.code,
        "Operation replay refused",
      );
      await this.#recordMessageResult(context, envelope, result);
      return result;
    }
  }

  async #sendMessage(
    context: AccessContext,
    envelope: MessageEnvelope,
    options: KernelOperationOptions = {},
  ): Promise<MessageDeliveryResult> {
    options.signal?.throwIfAborted();
    let parsedEnvelope: ReturnType<typeof MessageEnvelopeSchema.safeParse>;
    try {
      parsedEnvelope = MessageEnvelopeSchema.safeParse(structuredClone(envelope));
    } catch {
      throw new TypeError("message envelope does not match the SharedOS contract");
    }
    if (!parsedEnvelope.success) {
      throw new TypeError("message envelope does not match the SharedOS contract");
    }
    context = structuredClone(context);
    envelope = parsedEnvelope.data;
    if (
      !addressesEqual(context.actor, envelope.sender) ||
      context.purpose !== envelope.purpose ||
      context.traceId !== envelope.traceId
    ) {
      const result = refusedMessageResult(
        envelope,
        "denied",
        context.now,
        "message_context_mismatch",
        "Message sender, purpose, or trace does not match its access context",
      );
      await this.#recordMessageResult(context, envelope, result);
      return result;
    }

    let requirement: CapabilityRequirement;
    try {
      requirement = this.#messageCapabilityResolver.resolve(
        structuredClone(context),
        structuredClone(envelope),
      );
    } catch (error) {
      this.#reportProviderError(error, context, {
        kind: "message",
        reasonCode: "message_requirement_resolution_failed",
      });
      const result = refusedMessageResult(
        envelope,
        "failed",
        context.now,
        "message_requirement_resolution_failed",
        "The message capability requirement could not be resolved",
      );
      await this.#recordMessageResult(context, envelope, result);
      return result;
    }
    const authority = await this.#resolveAuthority(context, options.signal);
    if (authority.status !== "resolved") {
      const result = refusedMessageResult(
        envelope,
        "denied",
        context.now,
        "authority_unavailable",
        AUTHORITY_UNAVAILABLE_MESSAGE,
      );
      await this.#recordMessageResult(context, envelope, result);
      return result;
    }

    const decision = await this.#authorize(context, authority.authority, requirement, true);
    if (!decision.allowed) {
      const result = refusedMessageResult(
        envelope,
        "denied",
        context.now,
        decision.reasonCode,
        "The access context does not grant permission to send this message",
      );
      await this.#recordMessageResult(context, envelope, result);
      return result;
    }

    return this.#deliverAuthorizedMessage(
      context,
      envelope,
      options.signal ?? neverAbortedSignal(),
      decision.matchedGrantId,
    );
  }

  /** Deliver and audit a message whose exact send requirement was already consumed. */
  async #deliverAuthorizedMessage(
    context: AccessContext,
    envelope: MessageEnvelope,
    signal: AbortSignal,
    grantId?: string,
    operationId?: string,
  ): Promise<MessageDeliveryResult> {
    const trustedContext = deepFreeze(structuredClone(context));
    const trustedEnvelope = deepFreeze(structuredClone(envelope));
    if (this.#messageTransport === undefined) {
      const result = refusedMessageResult(
        trustedEnvelope,
        "failed",
        trustedContext.now,
        "message_transport_not_configured",
        "No message transport is configured",
      );
      await this.#recordMessageResult(
        trustedContext,
        trustedEnvelope,
        result,
        grantId,
        operationId,
      );
      return result;
    }

    const transport = this.#messageTransport;
    const result = await this.#invokePort<MessageDeliveryResult>({
      context: trustedContext,
      signal,
      invoke: () =>
        transport.deliver(
          structuredClone(trustedContext),
          structuredClone(trustedEnvelope),
          signal,
        ),
      accept: (receipt) => {
        const parsed = MessageDeliveryResultSchema.safeParse(receipt);
        return parsed.success && parsed.data.messageId === trustedEnvelope.id
          ? parsed.data
          : undefined;
      },
      refuse: (code, message) =>
        refusedMessageResult(trustedEnvelope, "failed", trustedContext.now, code, message),
      invalid: ["invalid_message_receipt", "The message transport returned a mismatched receipt"],
      failed: [
        "message_delivery_failed",
        "The message transport failed while delivering the message",
      ],
      operation: { kind: "message", ...(operationId === undefined ? {} : { operationId }) },
      interrupted: (reasonCode) =>
        this.#recordOutcome(
          this.#auditEvent(trustedContext, {
            type: "message.sent",
            outcome: "interrupted",
            messageId: trustedEnvelope.id,
            receiver: trustedEnvelope.receiver,
            ...(operationId === undefined ? {} : { operationId }),
            ...(grantId === undefined ? {} : { grantId }),
            ...operationFacts("kernel", reasonCode),
          }),
        ),
    });

    await this.#recordMessageResult(trustedContext, trustedEnvelope, result, grantId, operationId);
    return result;
  }

  /**
   * Decide and audit one request.
   *
   * The decision is made against `authority`, whose context carries the instant
   * the turn's authority was resolved, and against the live `context`, which
   * carries the instant of this operation. The grant set is the turn's; the
   * clock is the operation's, so a grant whose validity window closed while the
   * turn was running is refused here rather than at the next turn. See
   * `grantIsActive` in `internal.ts` for which removals move with the operation
   * and which stay with the turn.
   *
   * The audit event is written against the live `context` too, so a record
   * states when each decision happened rather than restamping every one of them
   * with the turn's opening instant.
   */
  /**
   * One decision against authority the turn already holds.
   *
   * Measured as a unit, audit included. The write is not separable from the
   * decision in any way a host could act on: a decision that was not recorded
   * did not happen as far as the evidence is concerned, so a cost figure that
   * left the record out would be the cost of a decision SharedOS does not make.
   */
  async #authorize(
    context: AccessContext,
    authority: ResolvedAuthority,
    request: CapabilityRequirement,
    consume: boolean,
    /**
     * The operation this decision was made for, when there is one.
     *
     * Carried onto the span and audit event, never into the decision. Every
     * record produced for one call names that call, which is what lets a report
     * attribute the cost and outcome to the same operation. An operation that
     * is not a tool call -- a bare `authorize`, a turn admission -- has no id.
     */
    operationId?: string,
  ): Promise<AuthorizationDecision> {
    return measure(
      this.#spans,
      SPAN.AUTHORIZE,
      (span) => {
        if (operationId !== undefined) {
          span.set("callId", operationId);
        }
        span.set("consumed", consume);
        return this.#decideAndRecord(context, authority, request, consume, operationId);
      },
      (decision, span) => span.set("outcome", decision.allowed ? "allowed" : "denied"),
    );
  }

  async #decideAndRecord(
    context: AccessContext,
    authority: ResolvedAuthority,
    request: CapabilityRequirement,
    consume: boolean,
    operationId?: string,
  ): Promise<AuthorizationDecision> {
    let explanation: AuthorizationExplanation | undefined;
    const decision = await this.#authorizer.authorize(authority, request, {
      consume,
      now: context.now,
      onExplain: (received) => {
        explanation = received;
      },
    });

    await this.#recordAuthorizationDecision(
      context,
      request,
      decision,
      consume,
      authority.snapshot.hash,
      operationId,
      explanation,
    );

    return decision;
  }

  /**
   * The authority one operation is decided against.
   *
   * A turn that opened a lease is answered from it, with no store read and no
   * second `authority.resolved` event: the turn loaded its authority once and
   * every decision in it names that one state. An operation outside any turn
   * resolves its own, which is a turn of one operation (ADR 0010).
   */
  async #resolveAuthority(
    context: AccessContext,
    signal: AbortSignal | undefined,
  ): Promise<AuthorityResolution> {
    const lease = this.#leases.get(turnAuthorityKey(context));
    return lease === undefined ? this.#loadAuthority(context, signal) : lease.resolution;
  }

  /** Read authority from the trusted source once, and audit the attempt. */
  async #loadAuthority(
    context: AccessContext,
    signal: AbortSignal | undefined,
  ): Promise<AuthorityResolution> {
    return measure(
      this.#spans,
      SPAN.AUTHORITY_LOAD,
      () => this.#loadAuthorityOnce(context, signal),
      (resolution, span) =>
        span.set("outcome", resolution.status === "resolved" ? "resolved" : "unavailable"),
    );
  }

  async #loadAuthorityOnce(
    context: AccessContext,
    signal: AbortSignal | undefined,
  ): Promise<AuthorityResolution> {
    const abort = signal ?? neverAbortedSignal();
    // A turn resolves one grant set and one policy set, and the two loads are
    // in flight together: neither reads the other's result, and the record of
    // the load says what each port did even on a turn where the other failed.
    const [resolved, hostPolicy] = await Promise.all([
      this.#authority.resolve(context, abort),
      this.#loadHostPolicy(context, abort),
    ]);
    const resolution: AuthorityResolution =
      resolved.status === "resolved" && hostPolicy !== undefined
        ? { status: "resolved", authority: { ...resolved.authority, hostPolicy } }
        : resolved;
    await this.#recordDecision(
      this.#auditEvent(
        context,
        resolution.status === "resolved"
          ? {
              type: "authority.resolved",
              outcome: "succeeded",
              authorityHash: resolution.authority.snapshot.hash,
              metadata: {
                grantIds: [...resolution.authority.snapshot.grantIds],
                grantCount: resolution.authority.snapshot.grantCount,
                hostCeiling: this.#hostCeilingState(),
                hostPolicy: hostPolicyState(hostPolicy),
              },
            }
          : {
              type: "authority.resolved",
              outcome: "failed",
              reason: "authority_unavailable",
              failClosed: true,
              metadata: {
                authority: resolution.code,
                hostCeiling: this.#hostCeilingState(),
                hostPolicy: hostPolicyState(hostPolicy),
                ...(resolution.detail === undefined
                  ? {}
                  : {
                      rejectedGrants: [
                        { grantId: resolution.detail.grantId, reason: resolution.detail.reason },
                      ],
                    }),
              },
            },
      ),
    );
    return resolution;
  }

  /**
   * Read the turn's host policy from its source once, failing closed.
   *
   * `undefined` when no source is installed, which is a different fact from a
   * source that failed: the first hands the ceiling nothing and lets it decide
   * over its own state; the second refuses every decision the ceiling would
   * have made. The error is reported here, once per turn, rather than on each
   * decision it fails, because one outage is one report. A cancelled load is
   * re-thrown, not reported: a caller that stopped the work is not a defect.
   *
   * A source that answered without naming what it loaded is as broken as one
   * that threw. Nothing could pin a decision to the policy it was made against,
   * so nothing is decided against it: the same outage, the same report.
   */
  async #loadHostPolicy(
    context: AccessContext,
    signal: AbortSignal,
  ): Promise<PolicyResolution | undefined> {
    if (this.#policySource === undefined) {
      return undefined;
    }
    let loaded: unknown;
    try {
      loaded = await this.#policySource.load(structuredClone(context), signal);
    } catch (error) {
      signal.throwIfAborted();
      this.#reportProviderError(error, context, POLICY_OUTAGE);
      return { status: "unavailable" };
    }
    if (!isLoadedPolicy(loaded)) {
      this.#reportProviderError(
        new TypeError(
          "A policy source must resolve to { policy, version } with a non-empty version",
        ),
        context,
        POLICY_OUTAGE,
      );
      return { status: "unavailable" };
    }
    return { status: "loaded", policy: loaded.policy, version: loaded.version };
  }

  /**
   * Whether product policy can refuse anything in this deployment.
   *
   * Recorded on every turn's authority load so an audit stream is readable
   * without knowing how the kernel was constructed. A stream with no
   * `host_policy_denied` in it means one thing when no ceiling is installed and
   * something else entirely when one is, and nothing else in the record
   * separates them (ADR 0020).
   */
  #hostCeilingState(): "installed" | "absent" {
    return this.#authorizer.hasHostCeiling ? "installed" : "absent";
  }

  async #denyUnavailableAuthority(
    context: AccessContext,
    request: CapabilityRequirement,
    code: AuthorityUnavailableCode,
    consume: boolean,
  ): Promise<AuthorizationDecision> {
    const decision: AuthorizationDecision = {
      allowed: false,
      reasonCode: "authority_unavailable",
      metadata: { authority: { code } },
    };
    await this.#recordAuthorizationDecision(context, request, decision, consume);
    return decision;
  }

  /** Every record the kernel emits is stamped here, so every one carries an id. */
  #auditEvent(context: AccessContext, event: AuditEventInput): AuditEvent {
    return auditEvent(context, event, this.#createAuditId);
  }

  async #recordAuthorizationDecision(
    context: AccessContext,
    request: CapabilityRequirement,
    decision: AuthorizationDecision,
    consume: boolean,
    authorityHash?: string,
    operationId?: string,
    explanation?: AuthorizationExplanation,
  ): Promise<void> {
    await this.#recordDecision(
      this.#auditEvent(context, {
        type: "authorization.checked",
        outcome: decision.allowed ? "allowed" : "denied",
        resource: request.resource,
        action: request.action,
        ...(authorityHash === undefined ? {} : { authorityHash }),
        ...(operationId === undefined ? {} : { operationId }),
        ...(decision.matchedGrantId === undefined ? {} : { grantId: decision.matchedGrantId }),
        ...(!decision.allowed ? { reason: decision.reasonCode } : {}),
        // Fields, so nothing a port supplies can stand in for them. A decision
        // may carry metadata of its own -- a host ceiling's rule, or the
        // authorizer's delegation detail on a broken chain -- and while these
        // two lived in the same bag a port's `failClosed: true` would have
        // moved a deliberate refusal out of the policy counts it belongs in
        // (ADR 0023).
        consumed: consume,
        ...(decision.allowed ? {} : failClosedFor(decision.reasonCode)),
        ...metadataOf({
          ...decision.metadata,
          ...(explanation === undefined ? {} : explanationMetadata(explanation)),
        }),
      }),
    );
  }

  async #recordToolResult(
    context: AccessContext,
    call: ToolCall,
    result: ToolResult,
    detail: ToolResultAuditDetail = {},
  ): Promise<void> {
    await this.#recordToolInvoked(context, {
      source: "kernel",
      callId: call.id,
      tool: call.tool,
      outcome: result.status,
      ...(result.status === "succeeded" ? {} : { reasonCode: result.error.code }),
      ...detail,
    });
  }

  /**
   * The one `tool.invoked` record, whichever boundary answered the call.
   *
   * The kernel records the calls it decided and, through `recordRefusedCall`,
   * the ones the envelope refused before asking it. They are one event type
   * and were built twice, which is how the envelope's came to lack the
   * catalogue the kernel's carried.
   */
  async #recordToolInvoked(
    context: AccessContext,
    invoked: ToolResultAuditDetail & {
      readonly source: AuditSource;
      readonly callId: string;
      readonly tool: string;
      readonly outcome: "succeeded" | "denied" | "failed" | "interrupted";
      readonly reasonCode?: string;
    },
  ): Promise<void> {
    const { grantId, requirement } = invoked;
    // Which catalogue answered it. The turn resolves one and holds it
    // (ADR 0026), so this is the same value the turn's `tool.catalog.listed`
    // carries, and the two join on it: a reader can say which calls a
    // catalogue produced -- and which guessed names it never offered --
    // without inferring it from time order. Absent on a call whose turn never
    // listed -- a turn of one operation, or a host that invokes without
    // discovering -- because there is no catalogue the caller was shown to
    // name.
    const catalogueServed = this.#leases.get(turnAuthorityKey(context))?.catalogHash;
    await this.#recordOutcome(
      this.#auditEvent(context, {
        type: "tool.invoked",
        outcome: invoked.outcome,
        operationId: invoked.callId,
        tool: invoked.tool,
        ...(requirement === undefined
          ? {}
          : { resource: requirement.resource, action: requirement.action }),
        ...(grantId === undefined ? {} : { grantId }),
        ...operationFacts(invoked.source, invoked.reasonCode, invoked.cause),
        ...metadataOf(catalogueServed === undefined ? {} : { catalogHash: catalogueServed }),
      }),
    );
  }

  async #recordResourceResult(
    context: AccessContext,
    request: ResourceInvocationRequest,
    result: ResourceResult,
    grantId?: string,
  ): Promise<void> {
    await this.#recordOutcome(
      this.#auditEvent(context, {
        type: "resource.invoked",
        outcome: result.status,
        operationId: request.operationId,
        resource: request.resource,
        action: request.action,
        ...(grantId === undefined ? {} : { grantId }),
        ...operationFacts("kernel", result.status === "succeeded" ? undefined : result.error.code),
      }),
    );
  }

  async #recordMessageResult(
    context: AccessContext,
    envelope: MessageEnvelope,
    result: MessageDeliveryResult,
    grantId?: string,
    operationId?: string,
  ): Promise<void> {
    await this.#recordOutcome(
      this.#auditEvent(context, {
        type: "message.sent",
        outcome:
          result.status === "accepted" || result.status === "delivered"
            ? "succeeded"
            : result.status,
        messageId: envelope.id,
        receiver: envelope.receiver,
        ...(operationId === undefined ? {} : { operationId }),
        ...(grantId === undefined ? {} : { grantId }),
        ...operationFacts(
          "kernel",
          result.status === "denied" || result.status === "failed" ? result.error.code : undefined,
        ),
      }),
    );
  }

  /**
   * Call one host port, and answer for it when it cannot be believed.
   *
   * The three ports that do an operation's work -- a tool handler, a resource
   * provider, a message transport -- are called the same way: not at all once
   * the caller has stopped, then validated against the contract and matched to
   * the operation that asked, and contained when they throw. An abort is
   * re-thrown ahead of the containment, so a caller that stopped the work is
   * never reported as a port that failed. Each code is stated once here and
   * reaches both the result and the host's diagnostic sink, which is what lets
   * a log line join to audit on it.
   *
   * A port that was entered and stopped before it answered is recorded
   * `interrupted` before the stop is re-thrown. The decision is already in the
   * trail and the port may have done any part of its work, so leaving no
   * operation event would read as a call that never started. Two things stop a
   * port: the caller's abort, and an audit outage on a decision the port itself
   * asked the kernel for, which is the kernel's failure and not the port's.
   */
  async #invokePort<Result>(port: {
    readonly context: AccessContext;
    readonly signal: AbortSignal | undefined;
    readonly invoke: () => Promise<unknown>;
    /** The port's answer when it is well-formed and names this operation. */
    readonly accept: (candidate: unknown) => Result | undefined;
    readonly refuse: (code: string, message: string) => Result;
    readonly invalid: readonly [code: string, message: string];
    readonly failed: readonly [code: string, message: string];
    readonly operation: Omit<ProviderErrorContext, "traceId" | "namespaceId" | "reasonCode">;
    /** Record the operation as entered and stopped, under the code that stopped it. */
    readonly interrupted: (reasonCode: string) => Promise<void>;
  }): Promise<Result> {
    port.signal?.throwIfAborted();
    try {
      return port.accept(await port.invoke()) ?? port.refuse(...port.invalid);
    } catch (error) {
      if (error instanceof AuditUnavailableError) {
        await port.interrupted(AUDIT_UNAVAILABLE);
        throw new AuditUnavailableError(error.cause, "unknown");
      }
      if (port.signal?.aborted === true) {
        await port.interrupted(OPERATION_ABORTED);
        port.signal.throwIfAborted();
      }
      this.#reportProviderError(error, port.context, {
        ...port.operation,
        reasonCode: port.failed[0],
      });
      return port.refuse(...port.failed);
    }
  }

  /**
   * Hand one contained throw to the host's diagnostic sink.
   *
   * The context is assembled here rather than at each catch so every call site
   * contributes only what is specific to it -- what kind of port failed, the
   * code returned in its place, and whichever identifiers that path has -- and
   * the trace and namespace come from the one place that always knows them.
   */
  #reportProviderError(
    error: unknown,
    context: AccessContext,
    operation: Omit<ProviderErrorContext, "traceId" | "namespaceId">,
  ): void {
    reportProviderError(this.#onProviderError, error, context, operation);
  }

  /**
   * Write a record that comes before an effect, and let a failure refuse it.
   *
   * An authority load, an authorization decision and a catalogue listing are
   * each written before anything acts on them. A sink that throws here rejects
   * the operation with an `AuditUnavailableError` carrying what the sink threw:
   * nothing has run, and a decision that was never recorded is not one SharedOS
   * will act on. `onAuditError` is not called, because the caller is handed the
   * failure itself.
   *
   * This and `#recordOutcome` are the only two callers of
   * the sink, so which rule a write follows is visible at its call site.
   */
  async #recordDecision(event: AuditEvent): Promise<void> {
    try {
      await this.#audit.record(event);
    } catch (error) {
      throw new AuditUnavailableError(error);
    }
  }

  /**
   * Write a record that comes after an effect, and never let a failure change it.
   *
   * An operation's outcome, a turn's ending, an escalation. The effect has
   * committed or the answer is final, so a sink that throws is handed to
   * `onAuditError` and the caller receives the result it would have received:
   * returning a failure here would invite a retry of something already done.
   * A sink that does not answer within `auditWriteTimeoutMs` is treated the
   * same way, so the result is released either once its record is written or
   * once the host has been told it was not.
   */
  async #recordOutcome(event: AuditEvent): Promise<void> {
    try {
      await this.#withinAuditWriteLimit(this.#audit.record(event));
    } catch (error) {
      try {
        await this.#withinAuditWriteLimit(this.#onAuditError?.(error, event));
      } catch {
        // A post-effect observability hook must not turn success into a retry.
      }
    }
  }

  async #withinAuditWriteLimit(write: void | Promise<void>): Promise<void> {
    const timeoutMs = this.#auditWriteTimeoutMs;
    if (timeoutMs === undefined) {
      await write;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve(write);
    // Left running past the limit, so what it then does must land somewhere.
    pending.catch(() => undefined);
    try {
      await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new AuditWriteTimeoutError(timeoutMs)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * What a tool call, a resource operation and a message are each told when
 * authority could not be resolved. The three refuse in their own result shape;
 * the sentence is the one thing they share.
 */
const AUTHORITY_UNAVAILABLE_MESSAGE = "Authority could not be loaded from its trusted source";

/** What a policy source that could not be read is reported as; it names no operation. */
const POLICY_OUTAGE = { kind: "policy", reasonCode: "host_policy_unavailable" } as const;

/**
 * What the kernel states about one operation event, in the fields that carry it.
 *
 * One builder for `tool.invoked`, `resource.invoked` and `message.sent`: who
 * answered, the code the caller was given, which situation a coarse code stood
 * in for, and whether SharedOS failed closed. The three were written apart, and
 * the resource and message records came to omit `failClosed` on exactly the
 * denials a host is told to filter on.
 */
function operationFacts(
  source: AuditSource,
  reasonCode: string | undefined,
  cause?: string,
): Pick<AuditEventInput, "source" | "reason" | "cause" | "failClosed"> {
  return {
    source,
    ...(reasonCode === undefined ? {} : { reason: reasonCode }),
    ...(cause === undefined ? {} : { cause }),
    ...failClosedFor(reasonCode),
  };
}

/** The reason on an operation its caller stopped after the port was entered. */
const OPERATION_ABORTED = "operation_aborted";

/** `failClosed`, present only on a code that is SharedOS failing to establish a fact. */
function failClosedFor(reasonCode: string | undefined): Pick<AuditEventInput, "failClosed"> {
  return reasonCode !== undefined &&
    (isInfrastructureDenial(reasonCode) ||
      reasonCode === AUDIT_UNAVAILABLE ||
      reasonCode === "replay_unavailable")
    ? { failClosed: true }
    : {};
}

/** `metadata`, present only when there is something in it. */
function metadataOf(metadata: JsonObject): Pick<AuditEventInput, "metadata"> {
  return Object.keys(metadata).length === 0 ? {} : { metadata };
}

/**
 * Wrap one resolution as a turn handle whose `close` runs at most once.
 *
 * Double-closing would release a lease another turn still holds, so the guard
 * is here rather than in every caller's cleanup path.
 */
function scopeFor(resolution: AuthorityResolution, release: () => void): TurnAuthorityScope {
  let closed = false;
  return {
    status: resolution.status,
    ...(resolution.status === "resolved"
      ? { snapshot: resolution.authority.snapshot }
      : { code: resolution.code }),
    close: (): void => {
      if (closed) {
        return;
      }
      closed = true;
      release();
    },
  };
}

/**
 * A resource operation answered without its provider's result.
 *
 * `refusedToolResult` in `internal.ts` is the tool-shaped one; these two differ
 * from it only in the id they carry and, for a message, in what the instant is
 * called.
 */
function refusedResourceResult(
  request: ResourceInvocationRequest,
  status: "denied" | "failed",
  completedAt: string,
  code: string,
  message: string,
): ResourceResult {
  return {
    operationId: request.operationId,
    status,
    completedAt,
    error: protocolError(code, message),
  };
}

function refusedMessageResult(
  envelope: MessageEnvelope,
  status: "denied" | "failed",
  completedAt: string,
  code: string,
  message: string,
): MessageDeliveryResult {
  return {
    messageId: envelope.id,
    status,
    timestamp: completedAt,
    error: protocolError(code, message),
  };
}

/**
 * The host-facing account of a denial, flattened onto the audit record.
 *
 * This is the only place the collapsed reason codes are taken apart, and it is
 * deliberately the audit sink rather than the response: the caller learns that
 * it may not proceed, the operator learns why. `grantsResolved: 0` with no
 * rejections says the store returned nothing for this context, which is a
 * different fault from every grant being rejected and is indistinguishable
 * from the reason code alone.
 */
function explanationMetadata(explanation: AuthorizationExplanation): JsonObject {
  return {
    grantsResolved: explanation.grantsResolved,
    ...(explanation.rejections.length === 0
      ? {}
      : {
          rejectedGrants: explanation.rejections.map((rejection) => ({
            grantId: rejection.grantId,
            reason: rejection.reason,
          })),
        }),
    ...(explanation.missingDependency === undefined
      ? {}
      : { missingDependency: explanation.missingDependency }),
  };
}

/**
 * Whether a resolved requirement stays inside the caller's own world.
 *
 * An omitted owner is the context's own owner, so only an explicitly named
 * foreign owner crosses the boundary. This is the same rule
 * `CapabilityAuthorizer` applies; it is asked here only to decide *which*
 * refusal a crossing is, never to perform the refusal itself.
 */
function requirementBelongsToContext(
  requirement: CapabilityRequirement,
  context: AccessContext,
): boolean {
  return (
    requirement.resource.owner === undefined ||
    addressesEqual(requirement.resource.owner, context.owner)
  );
}

/**
 * Whether a resolved requirement stays inside the ceiling the tool declared.
 *
 * By the time this runs the requirement is known to name the context's own
 * owner, so the owner comparison here catches the remaining case: a tool whose
 * declared capability names some *other* owner outright.
 */
function requirementIsWithinDefinition(
  definition: ToolDefinition,
  requirement: CapabilityRequirement,
  context: AccessContext,
): boolean {
  const declared = definition.requiredCapability;
  const declaredOwner = declared.resource.owner ?? context.owner;
  const requestedOwner = requirement.resource.owner ?? context.owner;

  return (
    requirement.action === declared.action &&
    requirement.resource.namespace === declared.resource.namespace &&
    addressesEqual(declaredOwner, requestedOwner) &&
    declared.resource.path.length <= requirement.resource.path.length &&
    declared.resource.path.every((segment, index) => segment === requirement.resource.path[index])
  );
}

let fallbackSignal: AbortSignal | undefined;

function neverAbortedSignal(): AbortSignal {
  fallbackSignal ??= new AbortController().signal;
  return fallbackSignal;
}

/**
 * What one turn's policy load came to, for the `authority.resolved` record.
 *
 * `absent` says no `PolicySource` is installed, not that there is no policy: a
 * ceiling may close over its own. Beside `hostCeiling`, it lets a reader tell a
 * deployment whose ceiling decides over loaded state from one whose ceiling
 * decides over state it carries, and a turn that could not load its policy --
 * every policy decision in it fail-closed -- from one that could (ADR 0020).
 */
function isLoadedPolicy(value: unknown): value is LoadedPolicy {
  return (
    typeof value === "object" &&
    value !== null &&
    "policy" in value &&
    "version" in value &&
    typeof value.version === "string" &&
    value.version.length > 0
  );
}

function hostPolicyState(
  hostPolicy: PolicyResolution | undefined,
): "loaded" | "unavailable" | "absent" {
  return hostPolicy === undefined ? "absent" : hostPolicy.status;
}
