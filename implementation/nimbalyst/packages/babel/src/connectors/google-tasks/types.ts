/** Local Google Tasks connector types. Compatible with gateway ConnectorConflict reasons. */

export const GOOGLE_TASKS_CONNECTOR = "google-tasks" as const;
export const DEFAULT_OVERLAP_WINDOW_MS = 120_000;
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;

export type GoogleTaskStatus = "needsAction" | "completed";

export interface GoogleTaskItem {
  id: string;
  title: string;
  notes?: string;
  status: GoogleTaskStatus;
  updated: string;
  deleted?: boolean;
  hidden?: boolean;
  etag?: string;
}

export interface GoogleTaskPage {
  items: GoogleTaskItem[];
  nextPageToken?: string;
}

export interface ListTasksRequest {
  tasklistId: string;
  pageToken?: string;
  updatedMin?: string;
  showCompleted?: boolean;
  showHidden?: boolean;
  showDeleted?: boolean;
}

export type ListTasksSuccess = { ok: true; status: 200; page: GoogleTaskPage };
export type ListTasksFailure = {
  ok: false;
  status: 401 | 429 | 500;
  retryAfterMs?: number;
  message: string;
};
export type ListTasksResult = ListTasksSuccess | ListTasksFailure;

export interface GoogleTasksHttpClient {
  listTasks(request: ListTasksRequest): Promise<ListTasksResult>;
}

export type GoogleTasksAuthMode = "synthetic" | "oauth";

export interface GoogleTasksAuthSession {
  mode: GoogleTasksAuthMode;
  accountId: string;
  authorized: boolean;
  reauthRequired: boolean;
  usedUserToken: false;
}

export interface SyntheticLoginStart {
  kind: "synthetic";
  oauthStarted: false;
  authorizationUrl: null;
}

/** OAuth shape only. Default auth never starts this path or reads user tokens. */
export interface OAuthLoginStart {
  kind: "oauth";
  oauthStarted: true;
  authorizationUrl: string;
  state: string;
  redirectUri: string;
}

export type GoogleTasksLoginStart = SyntheticLoginStart | OAuthLoginStart;

export interface GoogleTasksLoginFlow {
  startLogin(preferOAuth?: boolean): Promise<GoogleTasksLoginStart>;
  completeLogin(input?: { code?: string; syntheticAccountId?: string }): Promise<GoogleTasksAuthSession>;
  currentSession(): GoogleTasksAuthSession | null;
  revoke(): Promise<void>;
}

export interface SyncCursor {
  accountId: string;
  tasklistId: string;
  overlapWindowMs: number;
  lastSuccessfulUpdatedMin?: string;
  resumePageToken?: string;
}

export interface LocalMappedTask {
  trackerId: string;
  accountId: string;
  tasklistId: string;
  taskId: string;
  title: string;
  notes?: string;
  completed: boolean;
  deleted?: boolean;
  locallyEdited: boolean;
  runStatus?: "idle" | "running" | "lost" | "succeeded" | "failed" | "cancelled";
  sourceUpdated: string;
  sourceEtag?: string;
}

export interface NormalizedRemoteTask {
  identity: string;
  accountId: string;
  tasklistId: string;
  taskId: string;
  title: string;
  notes: string;
  completed: boolean;
  deleted: boolean;
  hidden: boolean;
  updated: string;
  etag?: string;
}

export type GoogleTasksConflictReason =
  | "duplicate"
  | "external_completed"
  | "external_deleted"
  | "field_mismatch";

export interface GoogleTasksConflict {
  connector: typeof GOOGLE_TASKS_CONNECTOR;
  externalId: string;
  trackerId?: string;
  reason: GoogleTasksConflictReason;
  agentSucceeded: false;
  cancelledRun: false;
  deletedLocal: false;
}

export type ImportAction = "import" | "skip" | "update" | "conflict" | "hide";

export interface ImportDecision {
  identity: string;
  action: ImportAction;
  importedAs?: "TODO";
  agentStarted: false;
  agentSucceeded: false;
  cancelledRun: false;
  deletedLocal: false;
  skipReason?: "completed_before_bind" | "deleted_before_bind" | "duplicate_identity";
}

export interface ImportedTask {
  identity: string;
  accountId: string;
  tasklistId: string;
  taskId: string;
  trackerId?: string;
  title: string;
  notes: string;
  completed: boolean;
  deleted: boolean;
  importedAs: "TODO";
  agentStarted: false;
}

export interface SyncResult {
  mode: "demo";
  realSync: false;
  ok: boolean;
  reauthRequired: boolean;
  retryAfterMs?: number;
  error?: string;
  imported: ImportedTask[];
  skipped: ImportDecision[];
  decisions: ImportDecision[];
  conflicts: GoogleTasksConflict[];
  cursor: SyncCursor;
  pagesFetched: number;
  pagesPersisted: number;
}

export interface PagePersist {
  (pageIndex: number, items: NormalizedRemoteTask[]): Promise<void>;
}
