/** Offline ops / chat-inbox contracts. Neutral adapters only; not a production GitLab/MediaWiki/Element integration. */

export const OPS_MODE = "demo" as const;
export const CHAT_ADAPTER_ID = "synthetic" as const;
export const CHAT_VENDOR = "none" as const;

export type OpsCommandName =
  | "ops.service.register"
  | "ops.health.probe"
  | "ops.repair.create"
  | "ops.repair.execute"
  | "ops.service.restart"
  | "chat.inbox.ingest"
  | "chat.inbox.preview"
  | "chat.inbox.confirm"
  | "chat.inbox.reject";

export type OpsQueryName =
  | "ops.service.list"
  | "ops.health.get"
  | "ops.repair.drafts"
  | "chat.inbox.list"
  | "chat.inbox.draft.get"
  | "chat.adapter.info"
  | "ops.events.list";

export type HealthOutcome = "ok" | "http_error" | "timeout" | "unreachable";

export interface RegisteredService {
  serviceId: string;
  label: string;
  endpoint: string;
  kind: "synthetic-http";
  projectId: string;
}

export interface HealthObservation {
  probeId: string;
  serviceId: string;
  endpoint: string;
  observedAt: string;
  outcome: HealthOutcome;
  statusCode: number | null;
  bodyExcerpt: string | null;
  error: string | null;
  mode: typeof OPS_MODE;
}

export interface RepairProvenance {
  sourceKind: "ops.health";
  serviceId: string;
  serviceLabel: string;
  probeId: string;
  endpoint: string;
  observedAt: string;
  outcome: HealthOutcome;
  statusCode: number | null;
  bodyExcerpt: string | null;
  error: string | null;
  fingerprint: string;
}

export interface ChatProvenance {
  sourceKind: "chat";
  adapterId: typeof CHAT_ADAPTER_ID;
  vendor: typeof CHAT_VENDOR;
  messageId: string;
  roomId: string;
  authorId: string;
  excerpt: string;
  sentAt: string;
  fingerprint: string;
}

export interface TodoInput {
  title: string;
  description: string;
  primaryType: "task";
  id?: string;
}

export interface RepairDraft {
  draftId: string;
  kind: "ops.repair";
  todo: TodoInput;
  provenance: RepairProvenance;
  persistReady: true;
  autoExecute: false;
  restartService: false;
  trackerId: string | null;
}

export interface ChatDraft {
  draftId: string;
  kind: "chat.todo";
  todo: TodoInput;
  provenance: ChatProvenance;
  confirmed: boolean;
  rejected: boolean;
  trackerId: string | null;
}

export interface ChatMessage {
  messageId: string;
  roomId: string;
  authorId: string;
  text: string;
  sentAt: string;
}

export interface OpsEvent {
  eventId: string;
  type: string;
  cursor: number;
  correlationId: string;
  projectId: string;
  trackerId: string | null;
  occurredAt: string;
  mode: typeof OPS_MODE;
  payload: Record<string, unknown>;
}

export interface OpsCommandRequest {
  name: OpsCommandName;
  projectId: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface OpsCommandResult {
  ok: true;
  commandStatus: "accepted" | "replayed";
  settled: true;
  revision: number | null;
  projectId: string;
  trackerId: string | null;
  runId: null;
  correlationId: string;
  mode: typeof OPS_MODE;
  result: Record<string, unknown>;
}

export interface OpsQueryRequest {
  name: OpsQueryName;
  projectId?: string;
  input?: Record<string, unknown>;
}

export interface ChatAdapterInfo {
  mode: typeof OPS_MODE;
  adapterId: typeof CHAT_ADAPTER_ID;
  vendor: typeof CHAT_VENDOR;
  selectedVendor: null;
  element: false;
  fluxer: false;
  deployedChatServer: false;
  contract: "neutral-synthetic";
}
