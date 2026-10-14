import type {
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
  JsonObject,
  RuntimeManifest,
  ToolPolicy,
} from "@aicoo/sharedos-contracts";
import { RuntimeManifestSchema, ToolPolicySchema, isJsonObject } from "@aicoo/sharedos-contracts";
import { declareToolPolicy, parseToolPolicy } from "@aicoo/sharedos-mcp";
import { type AuditEvent, isInfrastructureDenial } from "@aicoo/sharedos-core";
import {
  ESCALATION_ASKED_ANNOTATION,
  PROMPT_HASH_ANNOTATION,
  terminalSource,
} from "@aicoo/sharedos-runtime";

import {
  type AuthoritySnapshotRecord,
  type ContentHash,
  ContentHashSchema,
  type DecisionRecord,
  EscalationAskedSchema,
  type ExecutionRecord,
  type ExecutionRecordExecution,
  ExecutionRecordSchema,
  type ExperimentIdentity,
  type OperationRecord,
  type StateRecord,
  type SystemIdentity,
} from "./record.js";

/** Identity the experiment layer owns; SharedOS cannot derive any of it. */
export interface ExecutionRecordSystemInput extends Omit<SystemIdentity, "runtime"> {
  /** Overrides the manifest carried in the result's runtime provenance. */
  readonly runtime?: RuntimeManifest;
}

export interface ExecutionRecordCostInput {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly infrastructureMs?: number;
  readonly metadata?: JsonObject;
}

export interface AssembleExecutionRecordInput {
  readonly request: ExecutionRequest;
  readonly result: ExecutionResult;
  /** Audit events for this turn. Events from other traces are ignored. */
  readonly auditEvents?: readonly AuditEvent[];
  readonly experiment: ExperimentIdentity;
  readonly system: ExecutionRecordSystemInput;
  readonly state?: StateRecord;
  readonly cost?: ExecutionRecordCostInput;
  readonly auditRef?: { sink: string; traceId: string; eventCount: number };
  readonly recordedAt?: string;
}

/**
 * Build one comparable execution record from SharedOS evidence.
 *
 * SharedOS evidence is used as-is: nothing here re-derives an authorization
 * outcome, and nothing here judges whether the turn was correct. Fields the
 * kernel cannot know (experiment identity, state references, token cost) come
 * from the caller.
 */
export function assembleExecutionRecord(input: AssembleExecutionRecordInput): ExecutionRecord {
  const { request, result } = input;
  const reported = reportedTokens(result);
  const tokens = {
    inputTokens: input.cost?.inputTokens ?? reported.inputTokens,
    outputTokens: input.cost?.outputTokens ?? reported.outputTokens,
  };
  const audit = (input.auditEvents ?? []).filter(
    (event) => event.traceId === request.context.traceId,
  );

  const record: ExecutionRecord = {
    version: "1",
    recordedAt: input.recordedAt ?? result.completedAt,
    experiment: input.experiment,
    system: {
      ...publishedCatalogue(result),
      ...handedPrompt(result),
      ...declaredModel(result),
      ...input.system,
      runtime: input.system.runtime ?? runtimeManifestOf(result),
      toolPolicy: declaredToolPolicy(result, input.system.toolPolicy),
    },
    authority: {
      principal: request.context.authority,
      actor: request.context.actor,
      owner: request.context.owner,
      namespaceId: request.context.namespaceId,
      purpose: request.context.purpose,
      snapshots: authoritySnapshots(audit),
      ...stableAuthorityHash(audit),
    },
    execution: {
      executionId: result.executionId,
      traceId: result.traceId,
      agent: request.agent,
      status: result.status,
      ...terminalOutcome(result),
      ...endedBy(result),
      ...escalationAsked(result),
      ...callsAfterEscalation(result),
      exposedTools: exposedTools(result.events),
      requestedTools: request.tools.map(({ name }) => name),
      decisions: decisions(audit),
      operations: operations(audit, result.events),
      events: [...result.events],
      ...(input.auditRef === undefined ? {} : { auditRef: input.auditRef }),
    },
    state: input.state ?? {},
    cost: {
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      elapsedMs: elapsedMs(result.startedAt, result.completedAt),
      toolCalls: result.events.filter(({ type }) => type === "tool.requested").length,
      authorityLoads: audit.filter(({ type }) => type === "authority.resolved").length,
      auditEvents: audit.length,
      ...(input.cost?.infrastructureMs === undefined
        ? {}
        : { infrastructureMs: input.cost.infrastructureMs }),
      ...(tokens.inputTokens === undefined ? {} : { inputTokens: tokens.inputTokens }),
      ...(tokens.outputTokens === undefined ? {} : { outputTokens: tokens.outputTokens }),
      ...(input.cost?.metadata === undefined ? {} : { metadata: input.cost.metadata }),
    },
  };

  const parsed = ExecutionRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new TypeError(`Assembled execution record is not valid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Who ended a failed turn, read from the turn's events with the reader the
 * envelope itself uses. From the events and not from the `turn.ended` audit
 * event, which says the same thing: that write can be dropped, and a record is
 * assembled from a result that always has its events.
 */
function endedBy(result: ExecutionResult): Partial<ExecutionRecordExecution> {
  const source = terminalSource(result.events);
  return source === undefined ? {} : { endedBy: source };
}

/**
 * What the turn ended as, in the record's own vocabulary.
 *
 * An escalated turn has no protocol error, because nothing refused it: it
 * stopped and asked. It is given a terminal reason code anyway so a row can be
 * graded on it like any other terminal outcome, and the escalation stub is
 * carried through so the record names the reviewer as well as the fact.
 */
function terminalOutcome(result: ExecutionResult): Partial<ExecutionRecordExecution> {
  switch (result.status) {
    case "succeeded":
      return { output: result.output };
    case "escalated":
      return { terminalReasonCode: "escalation_requested", escalation: result.escalation };
    default:
      return result.error === undefined ? {} : { terminalReasonCode: result.error.code };
  }
}

/**
 * The catalogue identity a published boundary left behind, if there was one.
 *
 * Read from the turn's own result rather than asked of the caller, because the
 * caller is the experiment layer and this is a SharedOS fact. A turn whose
 * runtime never published a catalogue -- the embedded column, a transcript
 * column -- contributes nothing here, and the fields stay absent rather than
 * being filled with a hash over a catalogue no harness was ever served.
 *
 * The caller's own `system` still wins: a host that knows better about its own
 * run is not overridden by an inference from metadata.
 */
function publishedCatalogue(result: ExecutionResult): Partial<SystemIdentity> {
  const catalogHash = result.metadata?.["catalogHash"];
  if (!isContentHash(catalogHash)) {
    return {};
  }
  return { catalogHash, toolCount: exposedTools(result.events).length };
}

/**
 * What the runtime told the seat, if it recorded having told it anything.
 *
 * Read from the turn's own result for the same reason the catalogue is: it is
 * the runtime that composed the text, and a hash the caller supplied would be a
 * claim about what it meant to send. A runtime that hands the seat no text --
 * the embedded adversary, a driven vendor column whose frames are written for
 * it -- leaves the field absent rather than carrying a hash over a prompt no
 * model was shown.
 *
 * One place carries it: the result's metadata, under the key the runtime
 * stated it with. The envelope writes an annotation on every ending, so a turn
 * cancelled at its deadline -- which returns no outcome, and used to need an
 * event beside the metadata for that reason -- carries it like any other. A
 * turn cancelled before its runtime had composed anything carries none, because
 * there was nothing yet to state. A value that is not a content hash is ignored
 * the same way a malformed catalogue hash is.
 */
function handedPrompt(result: ExecutionResult): Partial<SystemIdentity> {
  const promptHash = result.metadata?.[PROMPT_HASH_ANNOTATION];
  return isContentHash(promptHash) ? { promptHash } : {};
}

/**
 * That the delegate said it asked for a human, lifted into the record.
 *
 * A record carries the turn's events and none of its metadata, and the grading
 * rules read a record, so a fact stated through `RuntimeHost.annotate` reaches
 * them only if it is lifted -- as the prompt hash is lifted into the system
 * identity above. Validated rather than trusted on shape: it is the delegate's
 * own statement, and a malformed one reads as none.
 */
function escalationAsked(result: ExecutionResult): Partial<ExecutionRecordExecution> {
  const asked = EscalationAskedSchema.safeParse(result.metadata?.[ESCALATION_ASKED_ANNOTATION]);
  return asked.success ? { escalationAsked: asked.data } : {};
}

/**
 * How many calls the seat made after its ask, lifted the same way and for the
 * same reason. A count that is not a non-negative integer reads as none.
 */
function callsAfterEscalation(result: ExecutionResult): Partial<ExecutionRecordExecution> {
  const calls = result.metadata?.["callsAfterEscalation"];
  return typeof calls === "number" && Number.isInteger(calls) && calls >= 0
    ? { callsAfterEscalation: calls }
    : {};
}

/** The one definition of a content hash the record is validated against. */
function isContentHash(value: unknown): value is ContentHash {
  return ContentHashSchema.safeParse(value).success;
}

/**
 * The model the runtime reported having launched with.
 *
 * Read from the turn's own result rather than from the run's configuration,
 * because those are different claims. A provider that silently substitutes an
 * unrecognised model name -- DeepSeek maps one to `deepseek-v4-flash` rather
 * than rejecting it -- would leave a configuration saying one thing and a run
 * having done another. This records what the harness was actually pointed at,
 * which is the weaker of the two claims and the honest one.
 *
 * The caller's own `system` still wins over it.
 */
function declaredModel(result: ExecutionResult): Partial<SystemIdentity> {
  const model = result.metadata?.["model"];
  const provider = result.metadata?.["modelProvider"];
  return {
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof provider === "string" ? { modelProvider: provider } : {}),
  };
}

/**
 * The token cost the runtime itself reported, if it did.
 *
 * A model driver sums what the provider billed for each call onto the turn's
 * outcome, and nothing else in the record can know it: the kernel sees calls,
 * not tokens. Read under the same rule as the model and the catalogue -- a
 * SharedOS fact the turn left behind, taken unless the caller's own `cost`
 * says otherwise. A runtime that reported none leaves the fields absent, which
 * `checkRecordCompleteness` names as a gap rather than reading as zero.
 */
function reportedTokens(result: ExecutionResult): ExecutionRecordCostInput {
  const input = result.metadata?.["inputTokens"];
  const output = result.metadata?.["outputTokens"];
  return {
    ...(isTokenCount(input) ? { inputTokens: input } : {}),
    ...(isTokenCount(output) ? { outputTokens: output } : {}),
  };
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function runtimeManifestOf(result: ExecutionResult): RuntimeManifest {
  const parsed = RuntimeManifestSchema.safeParse(result.metadata?.["runtime"]);
  if (!parsed.success) {
    throw new TypeError(
      "ExecutionResult carries no runtime provenance; pass system.runtime explicitly",
    );
  }
  return parsed.data;
}

function exposedTools(events: readonly ExecutionEvent[]): string[] {
  const started = events.find(({ type }) => type === "turn.started");
  const visible = isJsonObject(started?.data) ? started.data["visibleTools"] : undefined;
  return Array.isArray(visible)
    ? visible.filter((name): name is string => typeof name === "string")
    : [];
}

function authoritySnapshots(audit: readonly AuditEvent[]): AuthoritySnapshotRecord[] {
  const byHash = new Map<string, AuthoritySnapshotRecord>();

  for (const event of audit) {
    if (event.type !== "authority.resolved" || event.authorityHash === undefined) {
      continue;
    }

    const existing = byHash.get(event.authorityHash);
    if (existing === undefined) {
      byHash.set(event.authorityHash, {
        hash: event.authorityHash,
        grantIds: stringArray(event.metadata?.["grantIds"]),
        grantCount:
          typeof event.metadata?.["grantCount"] === "number" ? event.metadata["grantCount"] : 0,
        firstSeenAt: event.at,
        lastSeenAt: event.at,
        observations: 1,
      });
      continue;
    }

    byHash.set(event.authorityHash, {
      ...existing,
      lastSeenAt: event.at,
      observations: existing.observations + 1,
    });
  }

  return [...byHash.values()];
}

function stableAuthorityHash(
  audit: readonly AuditEvent[],
): { stableAuthorityHash: ContentHash } | Record<string, never> {
  const snapshots = authoritySnapshots(audit);
  const only = snapshots[0];
  return snapshots.length === 1 && only !== undefined ? { stableAuthorityHash: only.hash } : {};
}

function decisions(audit: readonly AuditEvent[]): DecisionRecord[] {
  return audit
    .filter((event) => event.type === "authorization.checked")
    .map((event) => ({
      at: event.at,
      outcome: event.outcome === "allowed" ? ("allowed" as const) : ("denied" as const),
      reasonCode: event.reason ?? (event.outcome === "allowed" ? "allowed" : "denied"),
      ...(event.resource === undefined ? {} : { resource: event.resource }),
      ...(event.action === undefined ? {} : { action: event.action }),
      ...(event.grantId === undefined ? {} : { grantId: event.grantId }),
      ...(event.authorityHash === undefined ? {} : { authorityHash: event.authorityHash }),
      failClosed: event.failClosed === true,
    }));
}

const OPERATION_KINDS: Readonly<Record<string, OperationRecord["kind"]>> = {
  "tool.invoked": "tool",
  "resource.invoked": "resource",
  "message.sent": "message",
};

function operations(
  audit: readonly AuditEvent[],
  events: readonly ExecutionEvent[],
): OperationRecord[] {
  const records: OperationRecord[] = [];

  for (const event of audit) {
    const kind = OPERATION_KINDS[event.type];
    if (kind === undefined) {
      continue;
    }

    records.push({
      at: event.at,
      kind,
      // Read, not assumed. Both boundaries record here now, and taking this from
      // the event rather than from the fact that an event exists is what keeps
      // `refusedBy` a claim about who refused rather than about who happened to
      // own an audit sink (ADR 0023).
      source: event.source ?? "kernel",
      // `interrupted` is carried as itself, never as `denied`: a call that may
      // have taken effect must not be credited to a boundary as a refusal it
      // made.
      outcome:
        event.outcome === "succeeded" ||
        event.outcome === "failed" ||
        event.outcome === "interrupted"
          ? event.outcome
          : "denied",
      ...(event.operationId === undefined ? {} : { operationId: event.operationId }),
      ...(event.tool === undefined ? {} : { tool: event.tool }),
      ...(event.resource === undefined ? {} : { resource: event.resource }),
      ...(event.action === undefined ? {} : { action: event.action }),
      ...(event.grantId === undefined ? {} : { grantId: event.grantId }),
      ...(event.reason === undefined ? {} : { reasonCode: event.reason }),
      ...(event.cause === undefined ? {} : { cause: event.cause }),
      failClosed: event.failClosed === true,
    });
  }

  records.push(...envelopeOperations(records, events));
  return records.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/**
 * Tool calls the envelope refused whose audit write was dropped.
 *
 * A runtime that guesses an unexposed tool name, or exceeds the hard tool-call
 * or step ceiling, never reaches `SharedOSKernel.invokeTool`. Those attempts are
 * real attempted violations and belong in the record.
 *
 * Since ADR 0023 the envelope records them through the kernel, so they arrive
 * as ordinary audit events carrying `source: "envelope"`, the call id is
 * already in `mediated`, and this adds nothing. What it is here for is the
 * write that did not land. `recordRefusedCall` writes after the fact, so a sink
 * that throws or does not answer is handed to `onAuditError` and the turn goes
 * on as it would have: an observation must not change what it observed. Audit
 * then holds nothing for that call, and a record built from audit alone would
 * show a turn in which the refusal never happened.
 *
 * The refusal code comes from the `tool.completed` event, which on that path is
 * the only record of a call audit never saw. It is read rather than inferred so
 * the record itself separates a guessed tool from a blown budget, without
 * depending on the runtime to report honestly about its own refusals.
 */
function envelopeOperations(
  mediated: readonly OperationRecord[],
  events: readonly ExecutionEvent[],
): OperationRecord[] {
  const mediatedCallIds = new Set(
    mediated.filter(({ kind }) => kind === "tool").map(({ operationId }) => operationId),
  );
  const records: OperationRecord[] = [];

  for (const event of events) {
    if (event.type !== "tool.completed" || !isJsonObject(event.data)) {
      continue;
    }

    const callId = event.data["callId"];
    const tool = event.data["tool"];
    const status = event.data["status"];
    const code = event.data["code"];
    if (typeof callId !== "string" || mediatedCallIds.has(callId) || status === "succeeded") {
      continue;
    }

    records.push({
      at: event.occurredAt,
      kind: "tool",
      source: "envelope",
      outcome: status === "failed" ? "failed" : "denied",
      operationId: callId,
      ...(typeof tool === "string" ? { tool } : {}),
      ...(typeof code === "string" ? { reasonCode: code } : {}),
      failClosed: typeof code === "string" && isInfrastructureDenial(code),
    });
  }

  return records;
}

function elapsedMs(startedAt: string, completedAt: string): number {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  return Number.isFinite(started) && Number.isFinite(completed)
    ? Math.max(0, completed - started)
    : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Preserve runtime declarations; a column cannot silently relabel their scope. */
function declaredToolPolicy(result: ExecutionResult, supplied?: ToolPolicy): ToolPolicy {
  const raw = result.metadata?.["toolPolicy"];
  const reported = ToolPolicySchema.safeParse(raw);
  const policy = supplied === undefined ? undefined : parseToolPolicy(supplied);
  if (raw !== undefined && !reported.success) {
    throw new TypeError("runtime reported an invalid tool policy");
  }
  if (
    reported.success &&
    policy !== undefined &&
    JSON.stringify(parseToolPolicy(reported.data)) !== JSON.stringify(policy)
  ) {
    throw new TypeError("column and runtime tool policy declarations disagree");
  }
  return policy ?? (reported.success ? reported.data : declareToolPolicy());
}
