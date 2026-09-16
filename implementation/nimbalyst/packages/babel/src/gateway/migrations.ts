export const GATEWAY_MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identities (
        actor_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        project_ids_json TEXT NOT NULL,
        roles_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        command TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        project_id TEXT,
        tracker_id TEXT,
        run_id TEXT,
        type TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        cursor INTEGER NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        correlation_id TEXT
      );
      CREATE TABLE IF NOT EXISTS outbox (
        delivery_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        hook_id TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_retry_at TEXT NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS worker_leases (
        lease_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        tracker_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        worktree TEXT NOT NULL,
        started_at TEXT NOT NULL,
        released_at TEXT
      );
    `,
  },
];
