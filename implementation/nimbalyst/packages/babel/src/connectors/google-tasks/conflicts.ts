import { googleTaskIdentity } from "./identity.ts";
import { GOOGLE_TASKS_CONNECTOR, type GoogleTasksConflict, type LocalMappedTask, type NormalizedRemoteTask } from "./types.ts";

export function localByIdentity(local: LocalMappedTask[]): Map<string, LocalMappedTask> {
  const map = new Map<string, LocalMappedTask>();
  for (const row of local) {
    map.set(googleTaskIdentity(row.accountId, row.tasklistId, row.taskId), row);
  }
  return map;
}

export function duplicateLocalIdentities(local: LocalMappedTask[]): GoogleTasksConflict[] {
  const seen = new Map<string, LocalMappedTask>();
  const conflicts: GoogleTasksConflict[] = [];
  for (const row of local) {
    const identity = googleTaskIdentity(row.accountId, row.tasklistId, row.taskId);
    const first = seen.get(identity);
    if (first) {
      conflicts.push(conflict(identity, "duplicate", row.trackerId));
    } else {
      seen.set(identity, row);
    }
  }
  return conflicts;
}

export function detectRemoteConflicts(
  local: LocalMappedTask[],
  remote: NormalizedRemoteTask[],
): GoogleTasksConflict[] {
  const byId = localByIdentity(local);
  const conflicts: GoogleTasksConflict[] = [];

  for (const item of remote) {
    const current = byId.get(item.identity);
    if (!current) continue;

    if (item.deleted) {
      conflicts.push(conflict(item.identity, "external_deleted", current.trackerId));
      continue;
    }

    if (item.completed && !current.completed) {
      conflicts.push(conflict(item.identity, "external_completed", current.trackerId));
    }

    if (current.locallyEdited && fieldsDiffer(current, item)) {
      conflicts.push(conflict(item.identity, "field_mismatch", current.trackerId));
    }
  }

  return conflicts;
}

function fieldsDiffer(local: LocalMappedTask, remote: NormalizedRemoteTask): boolean {
  const localNotes = local.notes ?? "";
  return local.title !== remote.title || localNotes !== remote.notes;
}

function conflict(
  externalId: string,
  reason: GoogleTasksConflict["reason"],
  trackerId?: string,
): GoogleTasksConflict {
  return {
    connector: GOOGLE_TASKS_CONNECTOR,
    externalId,
    trackerId,
    reason,
    agentSucceeded: false,
    cancelledRun: false,
    deletedLocal: false,
  };
}
