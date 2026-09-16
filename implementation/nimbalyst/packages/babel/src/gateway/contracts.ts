/** Production Gateway / Worker / connector contracts. Clients keep 2.3.0-m0 command names. */

export const GATEWAY_SCHEMA_VERSION = 1 as const;
export const GATEWAY_PROTOCOL = "2.3.0-m1-offline" as const;

export type GatewayActorKind = "human" | "cli" | "tui" | "gui" | "hook" | "system" | "worker";

export interface GatewayIdentity {
  actorId: string;
  kind: GatewayActorKind;
  projectIds: string[];
  roles: string[];
}

export interface GatewayCommandEnvelope {
  name: string;
  projectId: string;
  input: Record<string, unknown>;
  expectedRevision?: number;
  idempotencyKey?: string;
  correlationId?: string;
  actor: GatewayIdentity;
}

export interface WorkerLease {
  runId: string;
  trackerId: string;
  projectId: string;
  workerId: string;
  protocol: "pi-sim" | "pi" | "protocol-double";
  worktree: string;
  leaseId: string;
  startedAt: string;
}

export interface WorkerEvent {
  kind: "log" | "message" | "tool" | "diff" | "artifact" | "cancel_ack" | "lost" | "exited";
  runId: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface ConnectorConflict {
  connector: "google-tasks" | "ssh-sftp" | "chat" | "ops-health";
  externalId: string;
  trackerId?: string;
  reason: "duplicate" | "external_completed" | "external_deleted" | "field_mismatch";
}

export interface OutboxRecord {
  deliveryId: string;
  eventId: string;
  hookId: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  status: "pending" | "delivered" | "failed";
  lastError?: string;
}

export interface EventRecord {
  eventId: string;
  projectId: string | null;
  trackerId: string | null;
  runId: string | null;
  type: string;
  streamId: string;
  seq: number;
  cursor: number;
  payloadJson: string;
  occurredAt: string;
  correlationId: string | null;
}
