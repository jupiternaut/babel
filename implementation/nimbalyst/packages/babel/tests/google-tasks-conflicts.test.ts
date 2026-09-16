import { describe, expect, it } from "vitest";
import {
  GOOGLE_TASKS_CONNECTOR,
  GoogleTasksImporter,
  MemoryGoogleTasksHttp,
  SYNTHETIC_ACCOUNT_ID,
  SyntheticGoogleTasksAuth,
  detectRemoteConflicts,
  googleTaskIdentity,
} from "../src/connectors/google-tasks/index.ts";
import type { LocalMappedTask } from "../src/connectors/google-tasks/index.ts";

function auth() {
  return new SyntheticGoogleTasksAuth({
    mode: "synthetic",
    accountId: SYNTHETIC_ACCOUNT_ID,
    authorized: true,
    reauthRequired: false,
    usedUserToken: false,
  });
}

function local(partial: Partial<LocalMappedTask> & { taskId: string }): LocalMappedTask {
  return {
    trackerId: partial.trackerId ?? `tracker-${partial.taskId}`,
    accountId: SYNTHETIC_ACCOUNT_ID,
    tasklistId: "list-babel",
    taskId: partial.taskId,
    title: partial.title ?? "资料",
    notes: partial.notes ?? "",
    completed: partial.completed ?? false,
    deleted: partial.deleted,
    locallyEdited: partial.locallyEdited ?? false,
    runStatus: partial.runStatus,
    sourceUpdated: partial.sourceUpdated ?? "2026-09-14T09:00:00.000Z",
  };
}

describe("Google Tasks conflicts", () => {
  it("records field mismatch when a locally edited title or note differs", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [{
            id: "gt-1",
            title: "Google 侧新标题",
            notes: "远端备注",
            status: "needsAction",
            updated: "2026-09-14T11:00:00.000Z",
          }],
        },
      },
    });
    const result = await new GoogleTasksImporter(http, auth()).pull({
      tasklistId: "list-babel",
      local: [local({ taskId: "gt-1", title: "本地已改标题", notes: "本地备注", locallyEdited: true })],
    });

    expect(result.conflicts).toEqual([expect.objectContaining({
      connector: GOOGLE_TASKS_CONNECTOR,
      externalId: googleTaskIdentity(SYNTHETIC_ACCOUNT_ID, "list-babel", "gt-1"),
      reason: "field_mismatch",
      agentSucceeded: false,
    })]);
    expect(result.imported).toEqual([]);
    expect(result.decisions[0].action).toBe("conflict");
  });

  it("treats Google completion as an external change, not Agent success, even when a run is active", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [{
            id: "gt-run",
            title: "接入任务同步",
            status: "completed",
            updated: "2026-09-14T11:10:00.000Z",
          }],
        },
      },
    });
    const mapped = local({
      taskId: "gt-run",
      title: "接入任务同步",
      runStatus: "running",
    });
    const result = await new GoogleTasksImporter(http, auth()).pull({
      tasklistId: "list-babel",
      local: [mapped],
    });

    expect(result.conflicts.some((row) => row.reason === "external_completed")).toBe(true);
    expect(result.conflicts.every((row) => row.agentSucceeded === false)).toBe(true);
    expect(result.decisions[0]).toMatchObject({
      action: "conflict",
      agentStarted: false,
      agentSucceeded: false,
    });
    expect(mapped.runStatus).toBe("running");
  });

  it("records external delete without deleting local history or cancelling a run", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [{
            id: "gt-del",
            title: "外部删除",
            status: "needsAction",
            updated: "2026-09-14T11:20:00.000Z",
            deleted: true,
          }],
        },
      },
    });
    const mapped = local({
      taskId: "gt-del",
      title: "外部删除",
      runStatus: "running",
    });
    const result = await new GoogleTasksImporter(http, auth()).pull({
      tasklistId: "list-babel",
      local: [mapped],
    });

    expect(result.conflicts).toEqual([expect.objectContaining({
      reason: "external_deleted",
      deletedLocal: false,
      cancelledRun: false,
      agentSucceeded: false,
      trackerId: "tracker-gt-del",
    })]);
    expect(result.decisions[0].action).toBe("hide");
    expect(result.decisions[0].deletedLocal).toBe(false);
    expect(result.decisions[0].cancelledRun).toBe(false);
    expect(mapped.runStatus).toBe("running");
  });

  it("does not emit field mismatch when the local card was not edited", () => {
    const conflicts = detectRemoteConflicts(
      [local({ taskId: "gt-1", title: "旧标题", locallyEdited: false })],
      [{
        identity: googleTaskIdentity(SYNTHETIC_ACCOUNT_ID, "list-babel", "gt-1"),
        accountId: SYNTHETIC_ACCOUNT_ID,
        tasklistId: "list-babel",
        taskId: "gt-1",
        title: "远端新标题",
        notes: "",
        completed: false,
        deleted: false,
        hidden: false,
        updated: "2026-09-14T12:00:00.000Z",
      }],
    );
    expect(conflicts).toEqual([]);
  });
});
