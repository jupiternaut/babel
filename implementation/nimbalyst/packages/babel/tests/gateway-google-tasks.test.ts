import { describe, expect, it } from "vitest";
import { SyntheticGoogleTasksConnector } from "../src/gateway/google-tasks-connector.ts";

describe("SyntheticGoogleTasksConnector", () => {
  it("pages, de-duplicates, and reports external completion without marking Agent success", () => {
    const connector = new SyntheticGoogleTasksConnector([
      {
        items: [
          { id: "gt-1", title: "资料", status: "needsAction", updated: "2026-09-14T10:00:00Z" },
          { id: "gt-1", title: "资料", status: "needsAction", updated: "2026-09-14T10:00:00Z" },
        ],
        nextPageToken: "p2",
      },
      {
        items: [{ id: "gt-2", title: "同步", status: "completed", updated: "2026-09-14T11:00:00Z" }],
      },
    ]);
    return connector.listAll("2026-09-14T09:00:00Z").then((items) => {
      expect(items.map((row) => row.externalId)).toEqual(["gt-1", "gt-2"]);
      const conflicts = connector.conflictsAgainst(
        [{ externalId: "gt-2", title: "同步", completed: false }],
        items,
      );
      expect(conflicts.some((row) => row.reason === "external_completed")).toBe(true);
      expect(conflicts.every((row) => row.connector === "google-tasks")).toBe(true);
    });
  });
});
