import {
  JsonValueSchema,
  ReplayRecordSchema,
  type AccessContext,
  type JsonValue,
  type ReplayKey,
  type ReplayRecord,
} from "@aicoo/sharedos-contracts";

import { sha256Hex } from "./hashing.js";
import { raceAbort } from "./internal.js";

/** Host-owned durable storage. All changes must be atomic across workers. */
export interface ReplayStore {
  /** Insert pending or return the existing record, including a conflicting fingerprint. */
  claim(
    key: ReplayKey,
    fingerprint: string,
  ): Promise<{
    readonly claimed: boolean;
    readonly record: ReplayRecord;
  }>;
  /** CAS pending -> terminal, fenced by token. False means ownership was lost. */
  settle(
    key: ReplayKey,
    token: string,
    outcome: {
      readonly state: "completed" | "failed" | "interrupted";
      readonly result?: JsonValue;
    },
  ): Promise<boolean>;
}

export class ReplayError extends Error {
  constructor(
    readonly code:
      | "replay_conflict"
      | "replay_pending"
      | "replay_interrupted"
      | "replay_expired"
      | "replay_unavailable",
  ) {
    super(code);
    this.name = "ReplayError";
  }
}

/** Canonical JSON: code-unit key order, no locale dependence or unsupported values. */
export function canonicalReplayJson(value: unknown): string {
  if (Array.isArray(value)) return `[${Array.from(value, canonicalReplayJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError("Replay input must be JSON-safe");
    }
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalReplayJson(child)}`)
      .join(",")}}`;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  throw new TypeError("Replay input must be JSON-safe");
}

/** Stable provider-facing identity for a named child of a claimed operation. */
export async function childOperationId(
  parent: ReplayKey,
  kind: ReplayKey["kind"],
  slot: string,
): Promise<string> {
  return `${kind}-${await sha256Hex(canonicalReplayJson({ parent, kind, slot }))}`;
}

/** Bind replayed data to trusted identity and provenance, excluding observation time. */
export function replayContext(context: AccessContext): Omit<AccessContext, "now"> {
  const { now: _now, ...identity } = context;
  return identity;
}

/** Kernel-owned state machine. An omitted store retains legacy v1 behavior (ADR 0028). */
export class ReplayProtection {
  constructor(readonly store?: ReplayStore) {}

  async run<Result>(
    key: ReplayKey,
    input: unknown,
    invoke: () => Promise<Result>,
    accept: (value: unknown) => Result,
    signal?: AbortSignal,
  ): Promise<Result> {
    signal?.throwIfAborted();
    if (this.store === undefined) return invoke();
    const store = this.store;
    const fingerprint = await sha256Hex(canonicalReplayJson(input));
    signal?.throwIfAborted();
    let claim: Awaited<ReturnType<ReplayStore["claim"]>>;
    try {
      // Do not abandon claim on cancellation: it may commit in storage later.
      claim = await store.claim(structuredClone(key), fingerprint);
      if (typeof claim.claimed !== "boolean") throw new Error("Invalid claim status");
      const record = ReplayRecordSchema.parse(claim.record);
      if (
        canonicalReplayJson(record.key) !== canonicalReplayJson(key) ||
        (claim.claimed && (record.state !== "pending" || record.fingerprint !== fingerprint))
      ) {
        throw new Error("Invalid replay claim");
      }
      claim = { claimed: claim.claimed, record };
    } catch {
      throw new ReplayError("replay_unavailable");
    }
    const record = claim.record;
    if (record.fingerprint !== fingerprint) throw new ReplayError("replay_conflict");
    if (!claim.claimed) {
      signal?.throwIfAborted();
      if (record.state === "completed" || record.state === "failed") {
        try {
          return accept(structuredClone(record.result));
        } catch {
          throw new ReplayError("replay_unavailable");
        }
      }
      throw new ReplayError(
        record.state === "pending"
          ? "replay_pending"
          : record.state === "expired"
            ? "replay_expired"
            : "replay_interrupted",
      );
    }
    let result: Result;
    try {
      signal?.throwIfAborted();
      result = await raceAbort(invoke(), signal);
      signal?.throwIfAborted();
    } catch (error) {
      try {
        if (!(await store.settle(key, record.token, { state: "interrupted" })))
          throw new Error("Lost claim");
      } catch {
        throw new ReplayError("replay_unavailable");
      }
      throw error;
    }
    try {
      const json = JsonValueSchema.parse(result);
      const failed =
        typeof json === "object" &&
        json !== null &&
        !Array.isArray(json) &&
        json.status === "failed";
      if (
        !(await store.settle(key, record.token, {
          state: failed ? "failed" : "completed",
          result: json,
        }))
      ) {
        throw new Error("Lost claim");
      }
    } catch {
      throw new ReplayError("replay_unavailable");
    }
    return result;
  }
}
