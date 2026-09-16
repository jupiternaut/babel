import { afterEach, describe, expect, it } from "vitest";
import type { DomainService } from "../src/core/domain.ts";
import { openDomain, query, type TaskDetail, type TaskListResult } from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

function domain(): DomainService {
  const opened = openDomain("off");
  sessions.push(opened);
  return opened.domain;
}

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("semantic stages", () => {
  it("approved is RUNNING, not DONE", () => {
    const d = domain();
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-approved" });
    expect(detail.record.fields.status).toBe("approved");
    expect(detail.stage).toBe("RUNNING");
    expect(detail.card.stage).toBe("RUNNING");
    expect(detail.binding.outcome).not.toBe("succeeded");
  });

  it("lists approved executable records by type, not by fixture id", () => {
    const d = domain();
    const listed = query<TaskListResult>(d, "task.list", { types: "executable", includeSemantic: true });
    expect(listed.items.some((item) => item.trackerId === "fixture-tracker-approved" && item.stage === "RUNNING")).toBe(true);
    expect(listed.items.some((item) => item.trackerId === "fixture-tracker-release")).toBe(false);
    const board = query<TaskListResult>(d, "task.list", { types: "executable", includeArchived: true });
    expect(board.counts).toEqual({ TODO: 2, RUNNING: 1, DONE: 1, ARCHIVED: 1 });
    expect(board.items.some((item) => item.primaryType === "plan" || item.primaryType === "idea" || item.primaryType === "milestone")).toBe(false);
  });

  it("release is DONE, not ARCHIVED", () => {
    const d = domain();
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-release" });
    expect(detail.record.primaryType).toBe("release");
    expect(detail.record.archived).toBe(false);
    expect(detail.stage).not.toBe("ARCHIVED");
    expect(detail.stage).toBe("DONE");
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true });
    const release = listed.items.find((item) => item.trackerId === "fixture-tracker-release");
    expect(release).toBeTruthy();
    expect(release!.archived).toBe(false);
    expect(release!.stage).toBe("DONE");
  });

  it("wont-do stays RUNNING and archived layout stays ARCHIVED", () => {
    const d = domain();
    const wont = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-wont" });
    expect(wont.stage).toBe("RUNNING");
    const layout = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-layout" });
    expect(layout.stage).toBe("ARCHIVED");
    expect(layout.record.archived).toBe(true);
  });
});
