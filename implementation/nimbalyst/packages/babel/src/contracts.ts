/** Public command / query / event / error contract for Babel M0. */

export const SCHEMA_VERSION = 1 as const;
export const PROTOCOL_VERSION = "2.3.0-m0";
export const DEFAULT_PROJECT_ID = "fixture-project-babel";
export const DEFAULT_ENDPOINT = "http://127.0.0.1:7780";

export type Mode = "demo";
export type Stage = "TODO" | "RUNNING" | "DONE" | "ARCHIVED";
export type Outcome = "not_started" | "unresolved" | "succeeded";
export type CompletionPolicy = "verified_auto" | "verified_and_reviewed";
export type StatusCategory = "backlog" | "unstarted" | "started" | "done" | "cancelled";
export type TrackerSource = "native" | "inline" | "frontmatter" | "import";
export type ActorKind = "human" | "cli" | "tui" | "gui" | "hook" | "system";

export type RunStatus =
  | "requested"
  | "accepted"
  | "executing"
  | "waiting_input"
  | "verifying"
  | "review_required"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "lost";

export const EXECUTABLE_TYPES = ["task", "bug"] as const;
export const NATIVE_TYPES = ["plan", "decision", "bug", "task", "idea", "milestone", "release"] as const;

export const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export const ACTIVE_RUN: ReadonlySet<RunStatus> = new Set([
  "requested",
  "accepted",
  "executing",
  "waiting_input",
  "verifying",
  "review_required",
  "cancel_requested",
  "lost",
]);

export type ErrorCode =
  | "USAGE"
  | "VALIDATION"
  | "CONFLICT"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "PERMISSION"
  | "NOT_FOUND"
  | "HOOK_DENIED"
  | "HOOK_TIMEOUT"
  | "PRECONDITION"
  | "RUN_ACTIVE"
  | "CANCEL_PENDING"
  | "LOST_UNRECONCILED"
  | "READ_ONLY"
  | "COMPLETION_GUARD"
  | "NOT_TTY"
  | "UNAVAILABLE"
  | "WAIT_TIMEOUT"
  | "UNAUTHORIZED_STREAM";

export const EXIT_BY_CODE: Record<ErrorCode, number> = {
  USAGE: 2,
  VALIDATION: 3,
  CONFLICT: 4,
  REVISION_CONFLICT: 4,
  IDEMPOTENCY_CONFLICT: 4,
  PERMISSION: 5,
  NOT_FOUND: 6,
  HOOK_DENIED: 7,
  HOOK_TIMEOUT: 8,
  PRECONDITION: 9,
  RUN_ACTIVE: 9,
  CANCEL_PENDING: 9,
  LOST_UNRECONCILED: 9,
  READ_ONLY: 9,
  COMPLETION_GUARD: 9,
  NOT_TTY: 11,
  UNAVAILABLE: 10,
  WAIT_TIMEOUT: 21,
  UNAUTHORIZED_STREAM: 5,
};

export class BabelError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}, retryable = false) {
    super(message);
    this.name = "BabelError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export interface Actor {
  id: string;
  kind: ActorKind;
  projectIds: string[];
}

export interface AcceptanceItem {
  id: string;
  text: string;
  required: boolean;
}

export interface VerificationItem extends AcceptanceItem {
  state: "pending" | "passed" | "failed" | "skipped" | "waived";
  waivedBy?: string;
  waivedAt?: string;
  reason?: string;
}

export interface TrackerComment {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
}

export interface TrackerActivity {
  id: string;
  at: string;
  actorId: string;
  kind: string;
  detail: string;
}

export interface TrackerRecord {
  id: string;
  projectId: string;
  primaryType: string;
  typeTags: string[];
  issueKey?: string;
  source: TrackerSource;
  sourceRef?: string;
  archived: boolean;
  syncStatus: "local" | "pending" | "synced";
  content: { format: "markdown"; markdown: string };
  system: {
    workspace: string;
    createdAt: string;
    updatedAt: string;
    documentPath?: string;
    linkedSessions?: string[];
    comments?: TrackerComment[];
    activity?: TrackerActivity[];
    origin?: { kind: string; externalId?: string };
    readOnly?: boolean;
  };
  fields: {
    title: string;
    status: string;
    description: string;
    priority?: string;
    owner?: string;
    acceptance: AcceptanceItem[];
    dependsOn: string[];
    blocks: string[];
    [key: string]: unknown;
  };
  revision: number;
  orderKey: string;
}

export interface ExecutionBinding {
  projectId: string;
  trackerId: string;
  targetDeviceId: string | null;
  providerId: string | null;
  latestRunId: string | null;
  completionPolicy: CompletionPolicy;
  revision: number;
  archivedAt: string | null;
  outcome: Outcome;
  restoreStage: Stage | null;
  executionEnabled: boolean;
}

export interface RunMessage {
  id: string;
  role: "agent" | "user" | "system" | "tool";
  text: string;
  at: string;
  clientMessageId?: string;
  inputRequestId?: string;
}

export interface InputRequest {
  id: string;
  prompt: string;
  answered: boolean;
  answer?: string;
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  taskId: string;
  attempt: number;
  status: RunStatus;
  deviceId: string;
  providerId: string;
  sessionId: string | null;
  taskRevision: number;
  inputSnapshotId: string;
  baseCommit: string | null;
  executionFence: number;
  startedAt: string | null;
  endedAt: string | null;
  lastEventSeq: number;
  summary: string;
  messages: RunMessage[];
  inputRequests: InputRequest[];
  verification: VerificationItem[];
  diff: { files: DiffFile[]; label: string } | null;
  review: { decision: "accept" | "request_changes"; at: string; actorId: string } | null;
}

export interface DeviceRecord {
  id: string;
  label: string;
  displayStatus: string;
  available: boolean;
}

export interface SavedView {
  viewId: string;
  name: string;
  builtin?: boolean;
  definition: {
    types?: string[] | "all" | "executable";
    statusScope?: "open" | "closed" | "all";
    includeArchived?: boolean;
    includeSemantic?: boolean;
    deviceId?: string | null;
    q?: string;
    viewMode?: "execution" | "native-list";
  };
}

export interface ProjectRecord {
  id: string;
  name: string;
  workdir: string;
}

export interface BabelEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  projectId: string | null;
  trackerId: string | null;
  taskId: string | null;
  runId: string | null;
  type: string;
  streamId: string;
  seq: number;
  cursor: string;
  revision: number | null;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  mode: Mode;
  payload: Record<string, unknown>;
}

export type CommandName =
  | "task.create"
  | "task.update"
  | "task.reorder"
  | "task.archive"
  | "task.restore"
  | "run.start"
  | "run.message"
  | "run.respond"
  | "run.cancel"
  | "run.reconcile"
  | "run.retry"
  | "review.accept"
  | "review.request_changes"
  | "comment.add"
  | "relation.set"
  | "view.save"
  | "demo.reset"
  | "demo.inject"
  | "hook.register"
  | "hook.retry_delivery";

export type QueryName =
  | "task.get"
  | "task.list"
  | "run.show"
  | "run.list"
  | "diff.get"
  | "artifact.list"
  | "events.list"
  | "view.list"
  | "ready.list"
  | "schema.types"
  | "capabilities.get"
  | "device.list"
  | "hook.list"
  | "history.get"
  | "project.list";

export interface CommandRequest {
  name: CommandName;
  projectId: string;
  input: Record<string, unknown>;
  expectedRevision?: number;
  idempotencyKey?: string;
  correlationId?: string;
  actor?: Actor;
}

export interface CommandResult {
  ok: true;
  commandStatus: "accepted" | "replayed";
  settled: boolean;
  revision: number | null;
  projectId: string;
  trackerId: string | null;
  runId: string | null;
  correlationId: string;
  mode: Mode;
  result: Record<string, unknown>;
}

export interface QueryRequest {
  name: QueryName;
  projectId?: string;
  input?: Record<string, unknown>;
  actor?: Actor;
}

export interface HookConfig {
  hookId: string;
  phase: "beforeCommand" | "observe";
  commands?: CommandName[];
  executable: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  required: boolean;
  envAllow: string[];
}

export const DEMO_UNIMPLEMENTED_CODE = "UNAVAILABLE" satisfies ErrorCode;
export const DEMO_UNIMPLEMENTED_MESSAGE = "该操作尚未在演示适配中实现";

export const DEMO_ACTOR: Actor = {
  id: "demo-operator",
  kind: "cli",
  projectIds: ["fixture-project-babel", "fixture-project-research"],
};

/** In-process / token-authenticated actor. HTTP never accepts this from the client. */
export const SERVICE_ACTOR: Actor = {
  id: "babel-service",
  kind: "system",
  projectIds: ["fixture-project-babel", "fixture-project-research"],
};

export function isExecutableType(type: string, executionEnabled = false): boolean {
  if ((EXECUTABLE_TYPES as readonly string[]).includes(type)) return true;
  return type === "plan" && executionEnabled;
}

export function categoryOfStatus(status: string): StatusCategory {
  const value = String(status ?? "").trim().toLowerCase();
  const table: Record<string, StatusCategory> = {
    done: "done",
    completed: "done",
    complete: "done",
    closed: "done",
    resolved: "done",
    released: "done",
    shipped: "done",
    implemented: "done",
    decided: "done",
    fixed: "done",
    cancelled: "cancelled",
    canceled: "cancelled",
    rejected: "cancelled",
    declined: "cancelled",
    abandoned: "cancelled",
    obsolete: "cancelled",
    superseded: "cancelled",
    duplicate: "cancelled",
    "wont-do": "cancelled",
    "wont-fix": "cancelled",
    "in-progress": "started",
    "in-development": "started",
    "in-review": "started",
    "changes-requested": "started",
    approved: "started",
    blocked: "started",
    active: "started",
    "to-do": "unstarted",
    todo: "unstarted",
    open: "unstarted",
    planned: "unstarted",
    ready: "unstarted",
    "ready-for-development": "unstarted",
    draft: "backlog",
    new: "backlog",
    backlog: "backlog",
    proposed: "backlog",
    triage: "backlog",
  };
  return table[value] ?? "started";
}

export function deriveStage(record: TrackerRecord, binding: ExecutionBinding | undefined): Stage {
  if (record.archived || binding?.archivedAt) return "ARCHIVED";
  if (binding?.outcome === "succeeded") return "DONE";
  const cat = categoryOfStatus(String(record.fields.status));
  if (!binding || !binding.executionEnabled) {
    if (cat === "done") return "DONE";
    if (cat === "cancelled") return "RUNNING";
    if (cat === "started") return "RUNNING";
    return "TODO";
  }
  if (binding.outcome === "not_started" && !binding.latestRunId) return "TODO";
  if (binding.outcome === "not_started") return "TODO";
  return "RUNNING";
}

export function runNeedsAttention(status: RunStatus): boolean {
  return status === "failed" || status === "cancelled" || status === "lost" || status === "cancel_requested";
}
