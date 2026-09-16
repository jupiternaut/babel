import { DEFAULT_OVERLAP_WINDOW_MS, type SyncCursor } from "./types.ts";

export function overlapUpdatedMin(
  lastSuccessfulUpdatedMin: string | undefined,
  overlapWindowMs: number,
): string | undefined {
  if (!lastSuccessfulUpdatedMin) return undefined;
  const parsed = Date.parse(lastSuccessfulUpdatedMin);
  if (!Number.isFinite(parsed)) return lastSuccessfulUpdatedMin;
  return new Date(parsed - overlapWindowMs).toISOString();
}

export function emptyCursor(input: {
  accountId: string;
  tasklistId: string;
  overlapWindowMs?: number;
}): SyncCursor {
  return {
    accountId: input.accountId,
    tasklistId: input.tasklistId,
    overlapWindowMs: input.overlapWindowMs ?? DEFAULT_OVERLAP_WINDOW_MS,
  };
}

export function checkpointCursor(prev: SyncCursor, resumePageToken: string | undefined): SyncCursor {
  return {
    ...prev,
    resumePageToken,
  };
}

export function commitCursor(prev: SyncCursor, maxUpdated: string | undefined): SyncCursor {
  return {
    ...prev,
    lastSuccessfulUpdatedMin: maxUpdated ?? prev.lastSuccessfulUpdatedMin,
    resumePageToken: undefined,
  };
}

export function laterTimestamp(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}
