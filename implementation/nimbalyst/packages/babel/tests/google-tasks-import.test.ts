import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAP_WINDOW_MS,
  GoogleTasksImporter,
  MemoryGoogleTasksHttp,
  MemoryImportSink,
  SYNTHETIC_ACCOUNT_ID,
  SyntheticGoogleTasksAuth,
  googleTaskIdentity,
  overlapUpdatedMin,
} from "../src/connectors/google-tasks/index.ts";

function auth() {
  return new SyntheticGoogleTasksAuth({
    mode: "synthetic",
    accountId: SYNTHETIC_ACCOUNT_ID,
    authorized: true,
    reauthRequired: false,
    usedUserToken: false,
  });
}

describe("Google Tasks synthetic import", () => {
  it("walks every nextPageToken and imports new items as TODO without starting an Agent", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [
            { id: "gt-1", title: "资料", status: "needsAction", updated: "2026-09-14T10:00:00.000Z" },
          ],
          nextPageToken: "p2",
        },
        p2: {
          items: [
            { id: "gt-2", title: "同步", status: "needsAction", updated: "2026-09-14T10:01:00.000Z" },
          ],
          nextPageToken: "p3",
        },
        p3: {
          items: [
            { id: "gt-3", title: "归档说明", status: "needsAction", updated: "2026-09-14T10:02:00.000Z" },
          ],
        },
      },
    });
    const sink = new MemoryImportSink();
    const importer = new GoogleTasksImporter(http, auth());
    const result = await importer.pull({
      tasklistId: "list-babel",
      local: [],
      firstBind: true,
      persistPage: (index, items) => sink.persist(index, items),
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("demo");
    expect(result.realSync).toBe(false);
    expect(result.pagesFetched).toBe(3);
    expect(result.pagesPersisted).toBe(3);
    expect(result.imported.map((row) => row.taskId)).toEqual(["gt-1", "gt-2", "gt-3"]);
    expect(result.imported.every((row) => row.importedAs === "TODO")).toBe(true);
    expect(result.imported.every((row) => row.agentStarted === false)).toBe(true);
    expect(result.cursor.resumePageToken).toBeUndefined();
    expect(result.cursor.lastSuccessfulUpdatedMin).toBe("2026-09-14T10:02:00.000Z");
    expect(result.imported[0].identity).toBe(
      googleTaskIdentity(SYNTHETIC_ACCOUNT_ID, "list-babel", "gt-1"),
    );
  });

  it("deduplicates overlapping updatedMin windows by account/list/task identity", async () => {
    const lastSuccessful = "2026-09-14T10:05:00.000Z";
    const updatedMin = overlapUpdatedMin(lastSuccessful, DEFAULT_OVERLAP_WINDOW_MS);
    expect(updatedMin).toBe("2026-09-14T10:03:00.000Z");

    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [
            { id: "gt-1", title: "资料", status: "needsAction", updated: "2026-09-14T10:03:30.000Z" },
            { id: "gt-1", title: "资料（重叠旧页）", status: "needsAction", updated: "2026-09-14T10:03:00.000Z" },
            { id: "gt-old", title: "窗口外", status: "needsAction", updated: "2026-09-14T10:02:00.000Z" },
          ],
          nextPageToken: "p2",
        },
        p2: {
          items: [
            { id: "gt-1", title: "资料（重叠新页）", status: "needsAction", updated: "2026-09-14T10:04:00.000Z" },
            { id: "gt-2", title: "同步", status: "needsAction", updated: "2026-09-14T10:06:00.000Z" },
          ],
        },
      },
    });
    const importer = new GoogleTasksImporter(http, auth());
    const result = await importer.pull({
      tasklistId: "list-babel",
      local: [],
      cursor: {
        accountId: SYNTHETIC_ACCOUNT_ID,
        tasklistId: "list-babel",
        overlapWindowMs: DEFAULT_OVERLAP_WINDOW_MS,
        lastSuccessfulUpdatedMin: lastSuccessful,
      },
    });

    expect(result.imported.map((row) => `${row.taskId}:${row.title}`)).toEqual([
      "gt-1:资料（重叠新页）",
      "gt-2:同步",
    ]);
    expect(result.imported).toHaveLength(2);
  });

  it("does not import already-completed or deleted remote tasks as new TODOs", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [
            { id: "gt-open", title: "待办", status: "needsAction", updated: "2026-09-14T10:00:00.000Z" },
            { id: "gt-done", title: "早已完成", status: "completed", updated: "2026-09-14T09:00:00.000Z" },
            { id: "gt-gone", title: "已删除", status: "needsAction", updated: "2026-09-14T09:30:00.000Z", deleted: true },
            { id: "gt-hidden", title: "隐藏完成", status: "completed", updated: "2026-09-14T09:40:00.000Z", hidden: true },
          ],
        },
      },
    });
    const importer = new GoogleTasksImporter(http, auth());
    const result = await importer.pull({
      tasklistId: "list-babel",
      local: [],
      firstBind: true,
    });

    expect(result.imported.map((row) => row.taskId)).toEqual(["gt-open"]);
    expect(result.skipped.map((row) => row.skipReason)).toEqual([
      "completed_before_bind",
      "deleted_before_bind",
      "completed_before_bind",
    ]);
    expect(result.imported[0].agentStarted).toBe(false);
  });

  it("refuses to import every list when no tasklist is selected", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: { "": { items: [{ id: "gt-1", title: "x", status: "needsAction", updated: "2026-09-14T10:00:00.000Z" }] } },
    });
    const result = await new GoogleTasksImporter(http, auth()).pull({
      tasklistId: "",
      local: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("未选择任务列表");
    expect(result.imported).toEqual([]);
    expect(result.realSync).toBe(false);
  });
});
