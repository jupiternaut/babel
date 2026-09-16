import { afterEach, describe, expect, it } from "vitest";
import {
  PROJECT,
  command,
  openDomain,
  query,
  relatedEvents,
  type TaskDetail,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("LIFE restore after archive does not start a run", () => {
  it("restore reports started=false and query shows no new run", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "归档后恢复" });
    const beforeRuns = query<{ runs: Array<{ id: string; status: string }> }>(d, "run.list", {
      trackerId: created.trackerId,
    });
    const archiveCursor = d.store.data.cursor;
    const archived = await command(d, "task.archive", {
      trackerId: created.trackerId,
    }, { expectedRevision: created.revision ?? undefined });
    expect(archived.ok).toBe(true);
    expect(relatedEvents(d, PROJECT, archiveCursor, archived.correlationId).some((event) => event.type === "task.archived")).toBe(true);
    const archivedDetail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(archivedDetail.record.archived).toBe(true);
    expect(archivedDetail.stage).toBe("ARCHIVED");

    const restoreCursor = d.store.data.cursor;
    const restored = await command(d, "task.restore", { trackerId: created.trackerId });
    expect(restored.ok).toBe(true);
    expect(restored.result.started).toBe(false);
    const events = relatedEvents(d, PROJECT, restoreCursor, restored.correlationId);
    expect(events.some((event) => event.payload.action === "restore" && event.payload.started === false)).toBe(true);
    expect(events.some((event) => event.type === "run.accepted" || event.type === "run.started")).toBe(false);

    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.id).toBe(created.trackerId);
    expect(detail.record.projectId).toBe(PROJECT);
    expect(detail.record.archived).toBe(false);
    expect(detail.binding.latestRunId).toBeNull();
    expect(detail.latestRun).toBeNull();
    const afterRuns = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: created.trackerId });
    expect(afterRuns.runs.map((row) => row.id)).toEqual(beforeRuns.runs.map((row) => row.id));
  });

  it("restoring fixture-tracker-state keeps the historical run and does not emit run.start", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const before = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-state" });
    const beforeRuns = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: "fixture-tracker-state" });
    const archiveCursor = d.store.data.cursor;
    const archived = await command(d, "task.archive", {
      trackerId: "fixture-tracker-state",
    }, { expectedRevision: before.record.revision });
    expect(relatedEvents(d, PROJECT, archiveCursor, archived.correlationId).some((event) => event.type === "task.archived")).toBe(true);

    const restoreCursor = d.store.data.cursor;
    const restored = await command(d, "task.restore", { trackerId: "fixture-tracker-state" });
    expect(restored.result.started).toBe(false);
    const events = relatedEvents(d, PROJECT, restoreCursor, restored.correlationId);
    expect(events.some((event) => event.type === "run.started")).toBe(false);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-state" });
    expect(detail.record.archived).toBe(false);
    expect(detail.binding.latestRunId).toBe(before.binding.latestRunId);
    const afterRuns = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: "fixture-tracker-state" });
    expect(afterRuns.runs.map((row) => row.id).sort()).toEqual(beforeRuns.runs.map((row) => row.id).sort());
  });
});
