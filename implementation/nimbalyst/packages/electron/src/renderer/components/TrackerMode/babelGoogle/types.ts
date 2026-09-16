/** Read-only Google Tasks settings projection. Not a live OAuth client. */

export type GoogleAccess = 'idle' | 'demo' | 'unavailable';

export interface GoogleTasksStatusSnapshot {
  connection: GoogleAccess;
  demoLabel?: string;
  connectionNote?: string;
  selectedTasklistId?: string | null;
  selectedTasklistTitle?: string | null;
  lastSyntheticPullAt?: string | null;
  conflictCount?: number;
  reauthRequired?: boolean;
  lastError?: { code?: string; status?: number; message?: string };
}

export type GoogleAccessLabel = '演示' | '未接入';
export type GoogleSyncKind = 'unconnected' | 'unknown' | 'synthetic' | 'reauth';

export interface GoogleQueryError {
  code: string;
  message: string;
}

export interface GoogleTasksView {
  accessLabel: GoogleAccessLabel;
  demoLabel: string;
  connectionNote: string;
  realSync: false;
  oauthStarted: false;
  pollIntervalSeconds: number;
  overlapWindowSeconds: number;
  syncKind: GoogleSyncKind;
  syncLabel: string;
  syncNote: string;
  selectedTasklistId: string | null;
  selectedTasklistTitle: string | null;
  selectedListNote: string;
  conflictCount: number;
  conflictNote: string;
  ruleNotes: string[];
  errors: GoogleQueryError[];
}
