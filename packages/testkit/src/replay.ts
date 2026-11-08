import type { JsonValue, ReplayKey, ReplayRecord } from "@aicoo/sharedos-contracts";
import { ReplayRecordSchema } from "@aicoo/sharedos-contracts";
import { canonicalReplayJson, type ReplayStore } from "@aicoo/sharedos-core";

/** Isolated test fixture. Not durable and never suitable for production. */
export class InMemoryReplayStore implements ReplayStore {
  readonly #records = new Map<string, ReplayRecord>();

  async claim(
    key: ReplayKey,
    fingerprint: string,
  ): Promise<{ claimed: boolean; record: ReplayRecord }> {
    const identity = canonicalReplayJson(key);
    const existing = this.#records.get(identity);
    if (existing !== undefined) return { claimed: false, record: structuredClone(existing) };
    const record = ReplayRecordSchema.parse({
      key: structuredClone(key),
      fingerprint,
      token: crypto.randomUUID(),
      state: "pending",
    });
    this.#records.set(identity, record);
    return { claimed: true, record: structuredClone(record) };
  }

  async settle(
    key: ReplayKey,
    token: string,
    outcome: {
      readonly state: "completed" | "failed" | "interrupted";
      readonly result?: JsonValue;
    },
  ): Promise<boolean> {
    const identity = canonicalReplayJson(key);
    const existing = this.#records.get(identity);
    if (existing === undefined || existing.token !== token || existing.state !== "pending")
      return false;
    this.#records.set(
      identity,
      ReplayRecordSchema.parse({ ...existing, ...structuredClone(outcome) }),
    );
    return true;
  }

  /** Drop a sensitive result body while preserving its unclaimable identity. */
  expire(key: ReplayKey): boolean {
    const identity = canonicalReplayJson(key);
    const existing = this.#records.get(identity);
    if (existing === undefined || existing.state === "pending") return false;
    const { result: _result, ...record } = existing;
    this.#records.set(identity, { ...record, state: "expired" });
    return true;
  }
}
