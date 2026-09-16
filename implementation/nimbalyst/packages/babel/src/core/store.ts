import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  BabelEvent,
  Mode,
  DeviceRecord,
  ExecutionBinding,
  HookConfig,
  ProjectRecord,
  RunRecord,
  SavedView,
  TrackerRecord,
} from "../contracts.ts";

export interface IdempotencyRow {
  key: string;
  actorId: string;
  projectId: string;
  command: string;
  payloadHash: string;
  resultJson: string;
  effectError?: string;
}

export interface OutboxItem {
  deliveryId: string;
  eventId: string;
  hookId: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  status: "pending" | "delivered" | "failed";
  lastError?: string;
}

export interface HookDeliveryLog {
  deliveryId: string;
  eventId: string;
  hookId: string;
  at: string;
  ok: boolean;
  error?: string;
}

export interface Snapshot {
  schemaVersion: 1;
  mode: Mode;
  clock: string;
  seqByStream: Record<string, number>;
  cursor: number;
  projects: ProjectRecord[];
  records: TrackerRecord[];
  bindings: ExecutionBinding[];
  runs: RunRecord[];
  devices: DeviceRecord[];
  views: SavedView[];
  events: BabelEvent[];
  outbox: OutboxItem[];
  hookConfigs: HookConfig[];
  hookDeliveries: HookDeliveryLog[];
  idempotency: IdempotencyRow[];
  drafts: Record<string, { text: string; updatedAt: string }>;
}

export function emptySnapshot(clock: string): Snapshot {
  return {
    schemaVersion: 1,
    mode: "demo",
    clock,
    seqByStream: {},
    cursor: 0,
    projects: [],
    records: [],
    bindings: [],
    runs: [],
    devices: [],
    views: [],
    events: [],
    outbox: [],
    hookConfigs: [],
    hookDeliveries: [],
    idempotency: [],
    drafts: {},
  };
}

export class FileStore {
  readonly file: string;
  data: Snapshot;
  private lock?: { file: string; identity: string };

  constructor(profileDir: string, mode: Mode = "demo") {
    mkdirSync(path.join(profileDir, "state"), { recursive: true });
    if (mode === "local") {
      const file = path.join(profileDir, "state", "local-writer.lock");
      const identity = JSON.stringify({ pid: process.pid, id: randomUUID() });
      try { writeFileSync(file, identity, { flag: "wx", mode: 0o600 }); }
      catch { throw new Error(`本地 profile 已锁定：${file}；请先确认原服务与 Pi 已停止，不会自动抢占锁`); }
      this.lock = { file, identity };
    }
    this.file = path.join(profileDir, "state", `${mode}-store.json`);
    try {
      if (existsSync(this.file)) {
        this.data = JSON.parse(readFileSync(this.file, "utf8")) as Snapshot;
      } else {
        this.data = emptySnapshot("2026-09-14T07:00:00Z");
        this.data.mode = mode;
        this.persist();
      }
    } catch (error) { this.close(); throw error; }
  }

  close(): void {
    if (!this.lock) return;
    if (existsSync(this.lock.file) && readFileSync(this.lock.file, "utf8") === this.lock.identity) unlinkSync(this.lock.file);
    this.lock = undefined;
  }

  persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: this.data.mode === "local" ? 0o600 : 0o644 });
    renameSync(tmp, this.file);
  }

  transaction<T>(fn: (data: Snapshot) => T): T {
    const result = fn(this.data);
    this.persist();
    return result;
  }
}
