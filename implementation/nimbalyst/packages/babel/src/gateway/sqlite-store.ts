import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { GATEWAY_MIGRATIONS } from "./migrations.ts";
import type { EventRecord, GatewayIdentity, OutboxRecord, WorkerLease } from "./contracts.ts";

export class GatewaySqliteStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(profileDir: string) {
    mkdirSync(path.join(profileDir, "state"), { recursive: true });
    this.dbPath = path.join(profileDir, "state", "gateway.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): number {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );`);
    const applied = new Set(
      this.db.prepare("SELECT id FROM schema_migrations").all().map((row) => Number((row as { id: number }).id)),
    );
    let count = 0;
    for (const migration of GATEWAY_MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
          migration.id,
          new Date().toISOString(),
        );
      });
      count += 1;
    }
    return count;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  putIdentity(identity: GatewayIdentity): void {
    this.db.prepare(`
      INSERT INTO identities (actor_id, kind, project_ids_json, roles_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(actor_id) DO UPDATE SET
        kind = excluded.kind,
        project_ids_json = excluded.project_ids_json,
        roles_json = excluded.roles_json
    `).run(identity.actorId, identity.kind, JSON.stringify(identity.projectIds), JSON.stringify(identity.roles));
  }

  getIdentity(actorId: string): GatewayIdentity | null {
    const row = this.db.prepare("SELECT * FROM identities WHERE actor_id = ?").get(actorId) as
      | { actor_id: string; kind: GatewayIdentity["kind"]; project_ids_json: string; roles_json: string }
      | undefined;
    if (!row) return null;
    return {
      actorId: row.actor_id,
      kind: row.kind,
      projectIds: JSON.parse(row.project_ids_json) as string[],
      roles: JSON.parse(row.roles_json) as string[],
    };
  }

  assertProjectAccess(identity: GatewayIdentity, projectId: string, write: boolean): void {
    const allowed = identity.projectIds.includes(projectId) || identity.roles.includes("admin");
    if (!allowed) {
      const error = new Error(write ? "无权写入该项目" : "无权读取该项目");
      error.name = "PERMISSION";
      throw error;
    }
  }

  getIdempotency(key: string): { payloadHash: string; resultJson: string } | null {
    const row = this.db.prepare("SELECT payload_hash, result_json FROM idempotency WHERE key = ?").get(key) as
      | { payload_hash: string; result_json: string }
      | undefined;
    return row ? { payloadHash: row.payload_hash, resultJson: row.result_json } : null;
  }

  putIdempotency(input: {
    key: string;
    actorId: string;
    projectId: string;
    command: string;
    payload: unknown;
    result: unknown;
  }): void {
    const payloadHash = hashPayload(input.payload);
    const existing = this.getIdempotency(input.key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        const error = new Error("同一幂等键已用于不同负载");
        error.name = "IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return;
    }
    this.db.prepare(`
      INSERT INTO idempotency (key, actor_id, project_id, command, payload_hash, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.key,
      input.actorId,
      input.projectId,
      input.command,
      payloadHash,
      JSON.stringify(input.result),
      new Date().toISOString(),
    );
  }

  appendEvent(partial: Omit<EventRecord, "cursor" | "seq"> & { seq?: number }): EventRecord {
    const last = this.db.prepare("SELECT MAX(cursor) AS cursor, MAX(seq) AS seq FROM events WHERE stream_id = ?").get(
      partial.streamId,
    ) as { cursor: number | null; seq: number | null };
    const global = this.db.prepare("SELECT MAX(cursor) AS cursor FROM events").get() as { cursor: number | null };
    const seq = partial.seq ?? (last.seq ?? 0) + 1;
    const cursor = (global.cursor ?? 0) + 1;
    const record: EventRecord = { ...partial, seq, cursor };
    this.db.prepare(`
      INSERT INTO events (
        event_id, project_id, tracker_id, run_id, type, stream_id, seq, cursor, payload_json, occurred_at, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.eventId,
      record.projectId,
      record.trackerId,
      record.runId,
      record.type,
      record.streamId,
      record.seq,
      record.cursor,
      record.payloadJson,
      record.occurredAt,
      record.correlationId,
    );
    return record;
  }

  listEventsSince(cursor: number, limit = 100): EventRecord[] {
    const rows = this.db.prepare(`
      SELECT event_id, project_id, tracker_id, run_id, type, stream_id, seq, cursor, payload_json, occurred_at, correlation_id
      FROM events WHERE cursor > ? ORDER BY cursor ASC LIMIT ?
    `).all(cursor, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  enqueueOutbox(item: Omit<OutboxRecord, "attempts" | "status"> & { attempts?: number; status?: OutboxRecord["status"] }): OutboxRecord {
    const record: OutboxRecord = {
      ...item,
      attempts: item.attempts ?? 0,
      status: item.status ?? "pending",
    };
    this.db.prepare(`
      INSERT INTO outbox (delivery_id, event_id, hook_id, attempts, max_attempts, next_retry_at, status, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.deliveryId,
      record.eventId,
      record.hookId,
      record.attempts,
      record.maxAttempts,
      record.nextRetryAt,
      record.status,
      record.lastError ?? null,
    );
    return record;
  }

  claimPendingOutbox(now: string): OutboxRecord[] {
    const rows = this.db.prepare(`
      SELECT delivery_id, event_id, hook_id, attempts, max_attempts, next_retry_at, status, last_error
      FROM outbox WHERE status = 'pending' AND next_retry_at <= ?
    `).all(now) as Array<Record<string, unknown>>;
    return rows.map(rowToOutbox);
  }

  markOutbox(deliveryId: string, status: "delivered" | "failed", error?: string, nextRetryAt?: string): void {
    const current = this.db.prepare("SELECT attempts, max_attempts FROM outbox WHERE delivery_id = ?").get(deliveryId) as
      | { attempts: number; max_attempts: number }
      | undefined;
    if (!current) return;
    const attempts = current.attempts + 1;
    const exhausted = status === "failed" && attempts >= current.max_attempts;
    const nextStatus = status === "delivered" || exhausted ? status : "pending";
    this.db.prepare(`
      UPDATE outbox SET status = ?, attempts = ?, last_error = ?, next_retry_at = COALESCE(?, next_retry_at)
      WHERE delivery_id = ?
    `).run(nextStatus, attempts, error ?? null, nextRetryAt ?? null, deliveryId);
  }

  acquireLease(lease: WorkerLease): WorkerLease {
    const existing = this.db.prepare("SELECT run_id, released_at FROM worker_leases WHERE run_id = ?").get(lease.runId) as
      | { run_id: string; released_at: string | null }
      | undefined;
    if (existing && !existing.released_at) {
      const error = new Error("该 run 已有未释放的 Worker 租约，禁止双执行");
      error.name = "RUN_ACTIVE";
      throw error;
    }
    this.db.prepare(`
      INSERT INTO worker_leases (lease_id, run_id, tracker_id, project_id, worker_id, protocol, worktree, started_at, released_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      lease.leaseId,
      lease.runId,
      lease.trackerId,
      lease.projectId,
      lease.workerId,
      lease.protocol,
      lease.worktree,
      lease.startedAt,
    );
    return lease;
  }

  releaseLease(runId: string, at: string): void {
    this.db.prepare("UPDATE worker_leases SET released_at = ? WHERE run_id = ? AND released_at IS NULL").run(at, runId);
  }

  backupTo(targetFile: string): string {
    mkdirSync(path.dirname(targetFile), { recursive: true });
    this.db.exec("PRAGMA wal_checkpoint(FULL);");
    copyFileSync(this.dbPath, targetFile);
    return targetFile;
  }

  static restoreFrom(backupFile: string, profileDir: string): GatewaySqliteStore {
    if (!existsSync(backupFile)) throw new Error("备份文件不存在");
    mkdirSync(path.join(profileDir, "state"), { recursive: true });
    const dest = path.join(profileDir, "state", "gateway.sqlite");
    copyFileSync(backupFile, dest);
    return new GatewaySqliteStore(profileDir);
  }
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function newDeliveryId(): string {
  return `dlv-${randomUUID()}`;
}

function rowToEvent(row: Record<string, unknown>): EventRecord {
  return {
    eventId: String(row.event_id),
    projectId: (row.project_id as string | null) ?? null,
    trackerId: (row.tracker_id as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    type: String(row.type),
    streamId: String(row.stream_id),
    seq: Number(row.seq),
    cursor: Number(row.cursor),
    payloadJson: String(row.payload_json),
    occurredAt: String(row.occurred_at),
    correlationId: (row.correlation_id as string | null) ?? null,
  };
}

function rowToOutbox(row: Record<string, unknown>): OutboxRecord {
  return {
    deliveryId: String(row.delivery_id),
    eventId: String(row.event_id),
    hookId: String(row.hook_id),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextRetryAt: String(row.next_retry_at),
    status: row.status as OutboxRecord["status"],
    lastError: (row.last_error as string | undefined) ?? undefined,
  };
}
