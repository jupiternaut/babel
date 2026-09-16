import { describe, expect, it } from "vitest";
import {
  GoogleTasksImporter,
  MemoryGoogleTasksHttp,
  MemoryImportSink,
  SYNTHETIC_ACCOUNT_ID,
  SyntheticGoogleTasksAuth,
} from "../src/connectors/google-tasks/index.ts";
import type { SyncCursor } from "../src/connectors/google-tasks/index.ts";

function authorized() {
  return new SyntheticGoogleTasksAuth({
    mode: "synthetic",
    accountId: SYNTHETIC_ACCOUNT_ID,
    authorized: true,
    reauthRequired: false,
    usedUserToken: false,
  });
}

const threePages = {
  "": {
    items: [{ id: "gt-1", title: "一", status: "needsAction" as const, updated: "2026-09-14T10:00:00.000Z" }],
    nextPageToken: "p2",
  },
  p2: {
    items: [{ id: "gt-2", title: "二", status: "needsAction" as const, updated: "2026-09-14T10:01:00.000Z" }],
    nextPageToken: "p3",
  },
  p3: {
    items: [{ id: "gt-3", title: "三", status: "needsAction" as const, updated: "2026-09-14T10:02:00.000Z" }],
  },
};

describe("Google Tasks checkpoint resume", () => {
  it("does not advance lastSuccessfulUpdatedMin when a later page fails, then resumes from that token", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: threePages,
      failOnToken: { p2: { status: 500, remaining: 1 } },
    });
    const previous: SyncCursor = {
      accountId: SYNTHETIC_ACCOUNT_ID,
      tasklistId: "list-babel",
      overlapWindowMs: 120_000,
      lastSuccessfulUpdatedMin: "2026-09-14T09:00:00.000Z",
    };
    const sink = new MemoryImportSink();
    const importer = new GoogleTasksImporter(http, authorized());

    const failed = await importer.pull({
      tasklistId: "list-babel",
      local: [],
      cursor: previous,
      persistPage: (index, items) => sink.persist(index, items),
    });

    expect(failed.ok).toBe(false);
    expect(failed.pagesPersisted).toBe(1);
    expect(failed.cursor.lastSuccessfulUpdatedMin).toBe("2026-09-14T09:00:00.000Z");
    expect(failed.cursor.resumePageToken).toBe("p2");
    expect(failed.imported.map((row) => row.taskId)).toEqual(["gt-1"]);

    const resumed = await importer.pull({
      tasklistId: "list-babel",
      local: [],
      cursor: failed.cursor,
      persistPage: (index, items) => sink.persist(index, items),
    });

    expect(resumed.ok).toBe(true);
    expect(resumed.imported.map((row) => row.taskId)).toEqual(["gt-2", "gt-3"]);
    expect(resumed.cursor.resumePageToken).toBeUndefined();
    expect(resumed.cursor.lastSuccessfulUpdatedMin).toBe("2026-09-14T10:02:00.000Z");
    expect(sink.pages).toHaveLength(3);
  });

  it("keeps the cursor when persist fails mid-pagination", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: threePages,
    });
    const sink = new MemoryImportSink();
    sink.failPersistAfter = 1;
    const failed = await new GoogleTasksImporter(http, authorized()).pull({
      tasklistId: "list-babel",
      local: [],
      persistPage: (index, items) => sink.persist(index, items),
    });

    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("分页持久化失败");
    expect(failed.pagesPersisted).toBe(1);
    expect(failed.cursor.lastSuccessfulUpdatedMin).toBeUndefined();
    expect(failed.cursor.resumePageToken).toBe("p2");
  });

  it("returns 需重新登录 on 401 and does not claim a successful sync", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: threePages,
      failOnToken: { "": { status: 401 } },
    });
    const cursor: SyncCursor = {
      accountId: SYNTHETIC_ACCOUNT_ID,
      tasklistId: "list-babel",
      overlapWindowMs: 120_000,
      lastSuccessfulUpdatedMin: "2026-09-14T09:00:00.000Z",
    };
    const result = await new GoogleTasksImporter(http, authorized()).pull({
      tasklistId: "list-babel",
      local: [],
      cursor,
    });

    expect(result.ok).toBe(false);
    expect(result.reauthRequired).toBe(true);
    expect(result.realSync).toBe(false);
    expect(result.error).toBe("需重新登录");
    expect(result.cursor.lastSuccessfulUpdatedMin).toBe("2026-09-14T09:00:00.000Z");
    expect(result.imported).toEqual([]);
  });

  it("backs off on 429/5xx without dropping the previous cursor", async () => {
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: threePages,
      failOnToken: { "": { status: 429, retryAfterMs: 1500 } },
    });
    const cursor: SyncCursor = {
      accountId: SYNTHETIC_ACCOUNT_ID,
      tasklistId: "list-babel",
      overlapWindowMs: 120_000,
      lastSuccessfulUpdatedMin: "2026-09-14T09:30:00.000Z",
    };
    const result = await new GoogleTasksImporter(http, authorized()).pull({
      tasklistId: "list-babel",
      local: [],
      cursor,
    });

    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBe(1500);
    expect(result.reauthRequired).toBe(false);
    expect(result.cursor.lastSuccessfulUpdatedMin).toBe("2026-09-14T09:30:00.000Z");
    expect(result.imported).toEqual([]);
  });
});
