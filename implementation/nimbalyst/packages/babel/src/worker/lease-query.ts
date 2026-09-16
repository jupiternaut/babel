import { DatabaseSync } from "node:sqlite";
import type { WorkerLease } from "../gateway/contracts.ts";
import type { GatewaySqliteStore } from "../gateway/sqlite-store.ts";

export interface StoredWorkerLease extends WorkerLease {
  releasedAt: string | null;
}

export function getStoredLease(store: GatewaySqliteStore, runId: string): StoredWorkerLease | null {
  const db = new DatabaseSync(store.dbPath, { readOnly: true });
  try {
    const row = db.prepare(`
      SELECT lease_id, run_id, tracker_id, project_id, worker_id, protocol, worktree, started_at, released_at
      FROM worker_leases WHERE run_id = ?
    `).get(runId) as
      | {
          lease_id: string;
          run_id: string;
          tracker_id: string;
          project_id: string;
          worker_id: string;
          protocol: WorkerLease["protocol"];
          worktree: string;
          started_at: string;
          released_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return rowToLease(row);
  } finally {
    db.close();
  }
}

export function listStoredLeases(store: GatewaySqliteStore, projectId?: string): StoredWorkerLease[] {
  const db = new DatabaseSync(store.dbPath, { readOnly: true });
  try {
    const rows = (
      projectId
        ? db.prepare(`
            SELECT lease_id, run_id, tracker_id, project_id, worker_id, protocol, worktree, started_at, released_at
            FROM worker_leases WHERE project_id = ? ORDER BY started_at ASC
          `).all(projectId)
        : db.prepare(`
            SELECT lease_id, run_id, tracker_id, project_id, worker_id, protocol, worktree, started_at, released_at
            FROM worker_leases ORDER BY started_at ASC
          `).all()
    ) as Array<{
      lease_id: string;
      run_id: string;
      tracker_id: string;
      project_id: string;
      worker_id: string;
      protocol: WorkerLease["protocol"];
      worktree: string;
      started_at: string;
      released_at: string | null;
    }>;
    return rows.map(rowToLease);
  } finally {
    db.close();
  }
}

function rowToLease(row: {
  lease_id: string;
  run_id: string;
  tracker_id: string;
  project_id: string;
  worker_id: string;
  protocol: WorkerLease["protocol"];
  worktree: string;
  started_at: string;
  released_at: string | null;
}): StoredWorkerLease {
  return {
    leaseId: row.lease_id,
    runId: row.run_id,
    trackerId: row.tracker_id,
    projectId: row.project_id,
    workerId: row.worker_id,
    protocol: row.protocol,
    worktree: row.worktree,
    startedAt: row.started_at,
    releasedAt: row.released_at ?? null,
  };
}
