export const NODE_CLIENT_PROTOCOL = "2.3.0-m0" as const;
export const NODE_COLLECTION_INTERVAL_SECONDS = 60;
export const NODE_SNAPSHOT_STALE_AFTER_SECONDS = 150;

export type NodePlatform = "windows" | "ubuntu" | "macos";
export type PlatformServiceKind = "windows-service" | "systemd" | "launchd";

export type SshLayerKind = "reachable" | "unreachable" | "disconnected" | "unknown";
export type WorkerLayerKind = "available" | "unavailable" | "unknown";
export type AgentLayerKind = "available" | "unavailable" | "unknown" | "idle" | "lost";
export type FreshnessKind = "unknown" | "fresh" | "stale";

export interface LayerObservation<K extends string> {
  kind: K;
  observedAt: string | null;
  note: string;
}

export interface NodeLayerStatus {
  ssh: LayerObservation<SshLayerKind>;
  worker: LayerObservation<WorkerLayerKind>;
  agent: LayerObservation<AgentLayerKind>;
}

export interface ProbeLayers {
  ssh: SshLayerKind;
  worker: WorkerLayerKind;
  agent: AgentLayerKind;
}

export interface NodeSnapshot {
  nodeId: string;
  platform: NodePlatform;
  serviceKind: PlatformServiceKind;
  collectedAt: string | null;
  lastAttemptAt: string | null;
  nextDueAt: string | null;
  freshness: FreshnessKind;
  freshnessNote: string;
  snapshotRevision: number;
  layers: NodeLayerStatus;
  realMachine: false;
  mode: "synthetic";
  authorized: boolean;
}

export interface NodeRunBinding {
  nodeId: string;
  runId: string;
  trackerId: string;
  projectId: string;
  cancelled: boolean;
  startedAt: string;
}

export interface AttachedResource {
  resourceId: string;
  nodeId: string;
  relativePath: string;
  revision: string;
  readonly: true;
  attachedAt: string;
}

export type NodeEventKind =
  | "registered"
  | "collected"
  | "collect_failed"
  | "disconnected"
  | "reconnected"
  | "resource_attached"
  | "start_rejected"
  | "start_accepted";

export interface NodeEvent {
  kind: NodeEventKind;
  nodeId: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface Clock {
  now(): Date;
}

export class AdjustableClock implements Clock {
  private current: Date;

  constructor(current: Date | string = "2026-09-14T16:00:00.000Z") {
    this.current = new Date(current);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): Date {
    this.current = new Date(this.current.getTime() + ms);
    return this.now();
  }
}
