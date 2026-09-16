import { detectRemoteConflicts, duplicateLocalIdentities, localByIdentity } from "./conflicts.ts";
import { checkpointCursor, commitCursor, emptyCursor, laterTimestamp, overlapUpdatedMin } from "./cursor.ts";
import { normalizeRemoteTask } from "./synthetic-http.ts";
import {
  DEFAULT_OVERLAP_WINDOW_MS,
  type GoogleTasksHttpClient,
  type GoogleTasksLoginFlow,
  type ImportDecision,
  type ImportedTask,
  type LocalMappedTask,
  type NormalizedRemoteTask,
  type PagePersist,
  type SyncCursor,
  type SyncResult,
} from "./types.ts";

export interface PullInput {
  tasklistId: string;
  local: LocalMappedTask[];
  cursor?: SyncCursor | null;
  firstBind?: boolean;
  persistPage?: PagePersist;
}

export class GoogleTasksImporter {
  constructor(
    private readonly http: GoogleTasksHttpClient,
    private readonly auth: GoogleTasksLoginFlow,
    private readonly overlapWindowMs: number = DEFAULT_OVERLAP_WINDOW_MS,
  ) {}

  async pull(input: PullInput): Promise<SyncResult> {
    const session = this.auth.currentSession();
    const baseCursor = input.cursor ?? emptyCursor({
      accountId: session?.accountId ?? "",
      tasklistId: input.tasklistId,
      overlapWindowMs: this.overlapWindowMs,
    });

    if (!session || !session.authorized || session.reauthRequired) {
      return this.fail(baseCursor, {
        reauthRequired: true,
        error: "需重新登录",
      });
    }
    if (!input.tasklistId) {
      return this.fail(baseCursor, { error: "未选择任务列表" });
    }

    const persist = input.persistPage ?? (async () => undefined);
    const seen = new Map<string, NormalizedRemoteTask>();
    const persisted: NormalizedRemoteTask[] = [];
    let pagesFetched = 0;
    let pagesPersisted = 0;
    let pageToken = baseCursor.resumePageToken;
    const updatedMin = overlapUpdatedMin(baseCursor.lastSuccessfulUpdatedMin, this.overlapWindowMs);
    let working = { ...baseCursor, accountId: session.accountId, tasklistId: input.tasklistId };

    while (true) {
      const result = await this.http.listTasks({
        tasklistId: input.tasklistId,
        pageToken,
        updatedMin,
        showCompleted: true,
        showHidden: true,
        showDeleted: true,
      });
      pagesFetched += 1;

      if (!result.ok) {
        return this.fail(checkpointCursor(working, pageToken), {
          reauthRequired: result.status === 401,
          retryAfterMs: result.retryAfterMs,
          error: result.message,
          pagesFetched,
          pagesPersisted,
          imported: importedFrom(persisted, input.local, input.firstBind === true),
          skipped: [],
          decisions: [],
          conflicts: [],
        });
      }

      const normalized = result.page.items.map((item) =>
        normalizeRemoteTask(item, session.accountId, input.tasklistId),
      );
      const uniquePage: NormalizedRemoteTask[] = [];
      for (const item of normalized) {
        const previous = seen.get(item.identity);
        if (previous && previous.updated >= item.updated) continue;
        seen.set(item.identity, item);
        uniquePage.push(item);
      }

      try {
        await persist(pagesPersisted, uniquePage);
      } catch (error) {
        const message = error instanceof Error ? error.message : "分页持久化失败";
        return this.fail(checkpointCursor(working, pageToken), {
          error: message,
          pagesFetched,
          pagesPersisted,
          imported: importedFrom(persisted, input.local, input.firstBind === true),
        });
      }

      persisted.push(...uniquePage);
      pagesPersisted += 1;
      pageToken = result.page.nextPageToken;
      working = checkpointCursor(working, pageToken);
      if (!pageToken) break;
    }

    const remotes = [...seen.values()];
    const { imported, skipped, decisions } = decideImports(remotes, input.local, input.firstBind === true);
    const conflicts = [
      ...duplicateLocalIdentities(input.local),
      ...detectRemoteConflicts(input.local, remotes),
    ];
    let maxUpdated = working.lastSuccessfulUpdatedMin;
    for (const item of remotes) {
      maxUpdated = laterTimestamp(maxUpdated, item.updated);
    }

    return {
      mode: "demo",
      realSync: false,
      ok: true,
      reauthRequired: false,
      imported,
      skipped,
      decisions,
      conflicts,
      cursor: commitCursor(working, maxUpdated),
      pagesFetched,
      pagesPersisted,
    };
  }

  private fail(
    cursor: SyncCursor,
    extras: Partial<SyncResult> & { error?: string; reauthRequired?: boolean },
  ): SyncResult {
    return {
      mode: "demo",
      realSync: false,
      ok: false,
      reauthRequired: extras.reauthRequired === true,
      retryAfterMs: extras.retryAfterMs,
      error: extras.error,
      imported: extras.imported ?? [],
      skipped: extras.skipped ?? [],
      decisions: extras.decisions ?? [],
      conflicts: extras.conflicts ?? [],
      cursor,
      pagesFetched: extras.pagesFetched ?? 0,
      pagesPersisted: extras.pagesPersisted ?? 0,
    };
  }
}

function decideImports(
  remotes: NormalizedRemoteTask[],
  local: LocalMappedTask[],
  _firstBind: boolean,
): { imported: ImportedTask[]; skipped: ImportDecision[]; decisions: ImportDecision[] } {
  const byId = localByIdentity(local);
  const imported: ImportedTask[] = [];
  const skipped: ImportDecision[] = [];
  const decisions: ImportDecision[] = [];

  for (const item of remotes) {
    const current = byId.get(item.identity);
    if (current) {
      if (item.deleted) {
        const decision = decisionOf(item.identity, "hide");
        decisions.push(decision);
        continue;
      }
      if (item.completed && !current.completed) {
        decisions.push(decisionOf(item.identity, "conflict"));
        continue;
      }
      if (current.locallyEdited && (current.title !== item.title || (current.notes ?? "") !== item.notes)) {
        decisions.push(decisionOf(item.identity, "conflict"));
        continue;
      }
      decisions.push(decisionOf(item.identity, "update"));
      continue;
    }

    if (item.deleted) {
      const decision = decisionOf(item.identity, "skip", "deleted_before_bind");
      skipped.push(decision);
      decisions.push(decision);
      continue;
    }
    if (item.completed) {
      const decision = decisionOf(item.identity, "skip", "completed_before_bind");
      skipped.push(decision);
      decisions.push(decision);
      continue;
    }

    const row: ImportedTask = {
      identity: item.identity,
      accountId: item.accountId,
      tasklistId: item.tasklistId,
      taskId: item.taskId,
      title: item.title,
      notes: item.notes,
      completed: false,
      deleted: false,
      importedAs: "TODO",
      agentStarted: false,
    };
    imported.push(row);
    decisions.push({
      identity: item.identity,
      action: "import",
      importedAs: "TODO",
      agentStarted: false,
      agentSucceeded: false,
      cancelledRun: false,
      deletedLocal: false,
    });
  }

  return { imported, skipped, decisions };
}

function importedFrom(
  persisted: NormalizedRemoteTask[],
  local: LocalMappedTask[],
  firstBind: boolean,
): ImportedTask[] {
  return decideImports(persisted, local, firstBind).imported;
}

function decisionOf(
  identity: string,
  action: ImportDecision["action"],
  skipReason?: ImportDecision["skipReason"],
): ImportDecision {
  return {
    identity,
    action,
    importedAs: action === "import" ? "TODO" : undefined,
    agentStarted: false,
    agentSucceeded: false,
    cancelledRun: false,
    deletedLocal: false,
    skipReason,
  };
}

export class MemoryImportSink {
  readonly pages: NormalizedRemoteTask[][] = [];
  failPersistAfter?: number;

  async persist(pageIndex: number, items: NormalizedRemoteTask[]): Promise<void> {
    if (this.failPersistAfter !== undefined && pageIndex >= this.failPersistAfter) {
      throw new Error("分页持久化失败");
    }
    this.pages.push(items);
  }
}
