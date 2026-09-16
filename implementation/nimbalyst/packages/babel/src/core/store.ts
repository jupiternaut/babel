import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  BabelEvent,
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
  mode: "demo";
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

  constructor(profileDir: string) {
    mkdirSync(path.join(profileDir, "state"), { recursive: true });
    this.file = path.join(profileDir, "state", "demo-store.json");
    if (existsSync(this.file)) {
      this.data = JSON.parse(readFileSync(this.file, "utf8")) as Snapshot;
    } else {
      this.data = emptySnapshot("2026-09-14T07:00:00Z");
      this.persist();
    }
  }

  persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.file);
  }

  transaction<T>(fn: (data: Snapshot) => T): T {
    const result = fn(this.data);
    this.persist();
    return result;
  }
}
