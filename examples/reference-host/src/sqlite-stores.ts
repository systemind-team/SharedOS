/**
 * Durable host stores backed by SQLite (node:sqlite, no dependency).
 *
 * SharedOS fails bounded grants closed when no usage store is supplied, so a
 * host that wants `maxUses` at all must implement `tryConsume` atomically.
 */
import { DatabaseSync } from "node:sqlite";

import type {
  AccessContext,
  CapabilityGrant,
  ToolNamespace,
  ToolNamespaceUpdate,
} from "@aicoo/sharedos-contracts";
import {
  applyToolNamespaceUpdate,
  type AuditEvent,
  type AuditSink,
  type GrantSource,
  type GrantUsageStore,
  type ToolNamespaceSettingsStore,
} from "@aicoo/sharedos-core";

export class SqliteHostStores
  implements GrantSource, GrantUsageStore, AuditSink, ToolNamespaceSettingsStore
{
  readonly #db: DatabaseSync;

  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS grant_usage (
        namespace_id TEXT NOT NULL,
        grant_id     TEXT NOT NULL,
        used         INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (namespace_id, grant_id)
      );
      CREATE TABLE IF NOT EXISTS namespace_settings (
        namespace_id TEXT NOT NULL,
        owner_key    TEXT NOT NULL,
        enabled      TEXT NOT NULL,
        PRIMARY KEY (namespace_id, owner_key)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      TEXT NOT NULL,
        type    TEXT NOT NULL,
        outcome TEXT NOT NULL,
        actor   TEXT NOT NULL,
        purpose TEXT NOT NULL,
        target  TEXT,
        reason  TEXT,
        event   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grants (
        namespace_id TEXT NOT NULL,
        grant_id     TEXT NOT NULL,
        revoked_at   TEXT,
        grant        TEXT NOT NULL,
        PRIMARY KEY (namespace_id, grant_id)
      );
    `);
  }

  // ---- GrantUsageStore ---------------------------------------------------

  async getUsage(namespaceId: string, grantId: string): Promise<number> {
    const row = this.#db
      .prepare("SELECT used FROM grant_usage WHERE namespace_id = ? AND grant_id = ?")
      .get(namespaceId, grantId) as { used?: number } | undefined;
    return row?.used ?? 0;
  }

  /** One statement, so two concurrent turns cannot both see the last use. */
  async tryConsume(namespaceId: string, grantId: string, maximumUses: number): Promise<boolean> {
    const result = this.#db
      .prepare(
        `INSERT INTO grant_usage (namespace_id, grant_id, used) VALUES (?, ?, 1)
         ON CONFLICT (namespace_id, grant_id)
           DO UPDATE SET used = used + 1 WHERE grant_usage.used < ?`,
      )
      .run(namespaceId, grantId, maximumUses);
    return result.changes > 0;
  }

  /** Gives back a use whose decision could not be recorded. Never below zero. */
  async release(namespaceId: string, grantId: string): Promise<void> {
    this.#db
      .prepare(
        "UPDATE grant_usage SET used = used - 1 WHERE namespace_id = ? AND grant_id = ? AND used > 0",
      )
      .run(namespaceId, grantId);
  }

  // ---- grant store + verifier -------------------------------------------

  storeGrant(namespaceId: string, grant: CapabilityGrant): void {
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO grants (namespace_id, grant_id, revoked_at, grant) VALUES (?, ?, NULL, ?)",
      )
      .run(namespaceId, grant.id, JSON.stringify(grant));
  }

  revokeGrant(namespaceId: string, grantId: string): void {
    this.#db
      .prepare("UPDATE grants SET revoked_at = ? WHERE namespace_id = ? AND grant_id = ?")
      .run(new Date().toISOString(), namespaceId, grantId);
  }

  resolveGrants(namespaceId: string): CapabilityGrant[] {
    const rows = this.#db
      .prepare("SELECT grant FROM grants WHERE namespace_id = ? AND revoked_at IS NULL")
      .all(namespaceId) as Array<{ grant: string }>;
    return rows.map((row) => JSON.parse(row.grant) as CapabilityGrant);
  }

  /**
   * The only way authority enters the kernel.
   *
   * Pre-filtering to the context's namespace, actor, and issuing authority is
   * part of the contract, not an optimisation: a source that answers with a
   * superset is treated as unavailable rather than quietly narrowed. Throwing
   * here — an outage, a corrupt row — is the correct answer, and the kernel
   * turns it into a fail-closed denial.
   */
  async load(context: AccessContext, signal: AbortSignal): Promise<readonly CapabilityGrant[]> {
    signal.throwIfAborted();
    const actor = JSON.stringify(context.actor);
    const authority = JSON.stringify(context.authority);
    return this.resolveGrants(context.namespaceId).filter(
      (grant) =>
        JSON.stringify(grant.subject) === actor && JSON.stringify(grant.issuer) === authority,
    );
  }

  /** A grant handed to the kernel is only honoured while the store still has it live. */
  async verify(grant: CapabilityGrant, context: AccessContext): Promise<boolean> {
    const row = this.#db
      .prepare("SELECT revoked_at FROM grants WHERE namespace_id = ? AND grant_id = ?")
      .get(context.namespaceId, grant.id) as { revoked_at?: string | null } | undefined;
    return row !== undefined && (row.revoked_at ?? null) === null;
  }

  /** Ancestor lookup for derived grants; revocation lives on the parent. */
  async resolveChain(namespaceId: string, grantId: string): Promise<CapabilityGrant | undefined> {
    const row = this.#db
      .prepare("SELECT grant, revoked_at FROM grants WHERE namespace_id = ? AND grant_id = ?")
      .get(namespaceId, grantId) as { grant: string; revoked_at?: string | null } | undefined;
    if (row === undefined || (row.revoked_at ?? null) !== null) return undefined;
    return JSON.parse(row.grant) as CapabilityGrant;
  }

  // ---- ToolNamespaceSettingsStore ---------------------------------------

  async applyUpdate(
    context: AccessContext,
    update: ToolNamespaceUpdate,
    signal: AbortSignal,
  ): Promise<readonly ToolNamespace[]> {
    signal.throwIfAborted();
    const key = JSON.stringify(context.owner);
    const row = this.#db
      .prepare("SELECT enabled FROM namespace_settings WHERE namespace_id = ? AND owner_key = ?")
      .get(context.namespaceId, key) as { enabled?: string } | undefined;
    const current = row?.enabled === undefined ? [] : (JSON.parse(row.enabled) as ToolNamespace[]);
    const next = applyToolNamespaceUpdate(current, update);
    this.#db
      .prepare(
        "INSERT OR REPLACE INTO namespace_settings (namespace_id, owner_key, enabled) VALUES (?, ?, ?)",
      )
      .run(context.namespaceId, key, JSON.stringify(next));
    return next;
  }

  enabledNamespaces(context: Pick<AccessContext, "namespaceId" | "owner">): ToolNamespace[] {
    const row = this.#db
      .prepare("SELECT enabled FROM namespace_settings WHERE namespace_id = ? AND owner_key = ?")
      .get(context.namespaceId, JSON.stringify(context.owner)) as { enabled?: string } | undefined;
    return row?.enabled === undefined ? [] : (JSON.parse(row.enabled) as ToolNamespace[]);
  }

  // ---- AuditSink ---------------------------------------------------------

  async record(event: AuditEvent): Promise<void> {
    this.#db
      .prepare(
        "INSERT INTO audit (at, type, outcome, actor, purpose, target, reason, event) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.at,
        event.type,
        event.outcome,
        JSON.stringify(event.actor),
        event.purpose,
        event.tool ?? (event.resource === undefined ? null : event.resource.path.join("/")),
        event.reason ?? null,
        JSON.stringify(event),
      );
  }

  auditTrail(): Array<{
    at: string;
    type: string;
    outcome: string;
    target: string | null;
    reason: string | null;
  }> {
    return this.#db
      .prepare("SELECT at, type, outcome, target, reason FROM audit ORDER BY id")
      .all() as Array<{
      at: string;
      type: string;
      outcome: string;
      target: string | null;
      reason: string | null;
    }>;
  }
}
