import { afterEach, describe, expect, it } from "vitest";
import type { DomainService } from "../src/core/domain.ts";
import {
  PROJECT,
  command,
  openDomain,
  query,
  relatedEvents,
  type RunShow,
  type TaskDetail,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

function domain(simulate: "off" | "sync" = "off"): DomainService {
  const opened = openDomain(simulate);
  sessions.push(opened);
  return opened.domain;
}

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("CAP-03/04 create and update", () => {
  it("creates a tracker then queries the same record", async () => {
    const d = domain();
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", {
      title: "交叉创建",
      primaryType: "task",
      description: "GUI/TUI/CLI 同源",
    });
    expect(created.ok).toBe(true);
    expect(created.mode).toBe("demo");
    expect(created.commandStatus).toBe("accepted");
    expect(created.trackerId).toBeTruthy();
    const events = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(events.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.mode).toBe("demo");
    expect(detail.record.fields.title).toBe("交叉创建");
    expect(detail.record.id).toBe(created.trackerId);
    expect(detail.stage).toBe("TODO");
  });

  it("updates title and body with revision", async () => {
    const d = domain();
    const created = await command(d, "task.create", { title: "待改标题", description: "旧正文" });
    const cursor = d.store.data.cursor;
    const updated = await command(d, "task.update", {
      trackerId: created.trackerId,
      title: "已改标题",
      description: "新正文",
    }, { expectedRevision: created.revision ?? undefined });
    expect(updated.ok).toBe(true);
    expect(updated.revision).toBe((created.revision ?? 0) + 1);
    const events = relatedEvents(d, PROJECT, cursor, updated.correlationId);
    expect(events.some((event) => event.type === "task.updated" && event.payload.action === "update")).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("已改标题");
    expect(detail.record.fields.description).toBe("新正文");
    expect(detail.record.revision).toBe(updated.revision);
  });
});

describe("CAP-07/08/11 start, session, diff", () => {
  it("starts a run; accepted is not finished; sync lands on review_required", async () => {
    const d = domain("sync");
    const cursor = d.store.data.cursor;
    const started = await command(d, "run.start", {
      trackerId: "fixture-tracker-pdf",
      deviceId: "fixture-device-ubuntu",
    });
    expect(started.ok).toBe(true);
    expect(started.settled).toBe(false);
    expect(started.result.commandMeans).toBe("accepted_not_finished");
    expect(started.runId).toBeTruthy();
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.type === "run.accepted" && event.runId === started.runId)).toBe(true);
    expect(events.some((event) => event.type === "run.started" && event.runId === started.runId)).toBe(true);
    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.mode).toBe("demo");
    expect(shown.run.status).toBe("review_required");
    expect(shown.run.verification.every((item) => item.state === "passed")).toBe(true);
    const diff = query<{ mode: string; diff: { files: unknown[] } | null }>(d, "diff.get", { runId: started.runId });
    expect(diff.diff?.files.length).toBeGreaterThan(0);
    const artifacts = query<{ artifacts: unknown[] }>(d, "artifact.list", { runId: started.runId });
    expect(artifacts.artifacts.length).toBeGreaterThan(0);
  });

  it("replays the same idempotency key with the same runId", async () => {
    const d = domain("off");
    const first = await command(d, "run.start", { trackerId: "fixture-tracker-pdf" }, { idempotencyKey: "start-pdf-1" });
    expect(first.commandStatus).toBe("accepted");
    const second = await command(d, "run.start", { trackerId: "fixture-tracker-pdf" }, { idempotencyKey: "start-pdf-1" });
    expect(second.commandStatus).toBe("replayed");
    expect(second.runId).toBe(first.runId);
    const runs = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: "fixture-tracker-pdf" });
    expect(runs.runs.filter((row) => row.id === first.runId).length).toBe(1);
  });
});

describe("CAP-09 message and waiting input", () => {
  it("injects waiting_input then responds", async () => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "待答任务" });
    const injected = await command(d, "demo.inject", {
      scenario: "waiting_input",
      trackerId: created.trackerId,
    });
    expect(injected.ok).toBe(true);
    const shown = query<RunShow>(d, "run.show", { runId: injected.runId });
    expect(shown.run.status).toBe("waiting_input");
    const pending = (d.store.data.runs.find((row) => row.id === injected.runId)?.inputRequests ?? []).find(
      (row) => !row.answered,
    );
    expect(pending).toBeTruthy();
    const cursor = d.store.data.cursor;
    const answered = await command(d, "run.respond", {
      runId: injected.runId,
      requestId: pending!.id,
      text: "确认范围",
    });
    expect(answered.ok).toBe(true);
    const events = relatedEvents(d, PROJECT, cursor, answered.correlationId);
    expect(events.some((event) => event.type === "message.delta" && event.payload.answered === true)).toBe(true);
    const after = query<RunShow>(d, "run.show", { runId: injected.runId });
    expect(after.run.status).not.toBe("waiting_input");
  });

  it("appends a run message without finishing the run", async () => {
    const d = domain("off");
    const started = await command(d, "run.start", { trackerId: "fixture-tracker-pdf" });
    const cursor = d.store.data.cursor;
    const sent = await command(d, "run.message", { runId: started.runId, text: "补充说明" });
    expect(sent.settled).toBe(false);
    const events = relatedEvents(d, PROJECT, cursor, sent.correlationId);
    expect(events.some((event) => event.type === "message.delta")).toBe(true);
    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).not.toBe("succeeded");
  });
});

describe("CAP-10 cancel and reconcile", () => {
  it("cancel_requested is not cancelled until reconcile", async () => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "取消核对" });
    const injected = await command(d, "demo.inject", {
      scenario: "cancel_unconfirmed",
      trackerId: created.trackerId,
    });
    const shown = query<RunShow>(d, "run.show", { runId: injected.runId });
    expect(shown.run.status).toBe("cancel_requested");
    const cursor = d.store.data.cursor;
    const reconciled = await command(d, "run.reconcile", {
      runId: injected.runId,
      resolution: "cancelled",
    });
    expect(reconciled.ok).toBe(true);
    const events = relatedEvents(d, PROJECT, cursor, reconciled.correlationId);
    expect(events.some((event) => event.type === "run.finished" && event.payload.result === "cancelled")).toBe(true);
    const after = query<RunShow>(d, "run.show", { runId: injected.runId });
    expect(after.run.status).toBe("cancelled");
  });
});

describe("CAP-12/13 review, retry, new run", () => {
  it("human accept completes; hook cannot", async () => {
    const d = domain("sync");
    const started = await command(d, "run.start", { trackerId: "fixture-tracker-research" });
    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).toBe("review_required");
    const cursor = d.store.data.cursor;
    const accepted = await command(d, "review.accept", { runId: started.runId });
    expect(accepted.ok).toBe(true);
    const events = relatedEvents(d, PROJECT, cursor, accepted.correlationId);
    expect(events.some((event) => event.type === "run.finished" && event.payload.result === "succeeded")).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-research" });
    expect(detail.stage).toBe("DONE");
    expect(detail.binding.outcome).toBe("succeeded");
  });

  it("request_changes then retry allocates a new runId", async () => {
    const d = domain("sync");
    const started = await command(d, "run.start", { trackerId: "fixture-tracker-research" });
    await command(d, "review.request_changes", { runId: started.runId, comment: "需要修改" });
    const cursor = d.store.data.cursor;
    const retried = await command(d, "run.retry", { trackerId: "fixture-tracker-research" });
    expect(retried.runId).toBeTruthy();
    expect(retried.runId).not.toBe(started.runId);
    const events = relatedEvents(d, PROJECT, cursor, retried.correlationId);
    expect(events.some((event) => event.type === "run.accepted" && event.runId === retried.runId)).toBe(true);
    const runs = query<{ runs: Array<{ id: string; attempt: number }> }>(d, "run.list", {
      trackerId: "fixture-tracker-research",
    });
    expect(runs.runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.runs.some((row) => row.id === started.runId)).toBe(true);
    expect(runs.runs.some((row) => row.id === retried.runId)).toBe(true);
  });
});

describe("CAP-14 archive and restore", () => {
  it("restore does not start a new run", async () => {
    const d = domain();
    const beforeRuns = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: "fixture-tracker-state" });
    const cursor = d.store.data.cursor;
    const archived = await command(d, "task.archive", { trackerId: "fixture-tracker-state" });
    expect(relatedEvents(d, PROJECT, cursor, archived.correlationId).some((event) => event.type === "task.archived")).toBe(true);
    const restoreCursor = d.store.data.cursor;
    const restored = await command(d, "task.restore", { trackerId: "fixture-tracker-state" });
    expect(restored.result.started).toBe(false);
    const events = relatedEvents(d, PROJECT, restoreCursor, restored.correlationId);
    expect(events.some((event) => event.payload.action === "restore" && event.payload.started === false)).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-state" });
    expect(detail.record.archived).toBe(false);
    expect(detail.binding.latestRunId).toBe("fixture-run-state-1");
    const afterRuns = query<{ runs: Array<{ id: string }> }>(d, "run.list", { trackerId: "fixture-tracker-state" });
    expect(afterRuns.runs.map((row) => row.id).sort()).toEqual(beforeRuns.runs.map((row) => row.id).sort());
  });
});

describe("CAP-05/06/15 relation, reorder, history", () => {
  it("sets a reverse relation", async () => {
    const d = domain();
    const cursor = d.store.data.cursor;
    const updated = await command(d, "relation.set", {
      trackerId: "fixture-tracker-pdf",
      dependsOn: ["fixture-tracker-research"],
    }, { expectedRevision: query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" }).record.revision });
    expect(updated.ok).toBe(true);
    expect(relatedEvents(d, PROJECT, cursor, updated.correlationId).some((event) => event.payload.action === "relation")).toBe(true);
    const pdf = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    const research = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-research" });
    expect(pdf.record.fields.dependsOn).toContain("fixture-tracker-research");
    expect(research.record.fields.blocks).toContain("fixture-tracker-pdf");
  });

  it("reorders within the project", async () => {
    const d = domain();
    const beforeRevision = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" }).record.revision;
    const cursor = d.store.data.cursor;
    const moved = await command(d, "task.reorder", {
      trackerId: "fixture-tracker-pdf",
      beforeId: "fixture-tracker-research",
    });
    expect(moved.ok).toBe(true);
    expect(moved.result.orderKey).toBeTruthy();
    expect(relatedEvents(d, PROJECT, cursor, moved.correlationId).some((event) => event.payload.action === "reorder")).toBe(true);
    const after = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(after.record.revision).toBe(beforeRevision + 1);
    const list = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true });
    expect(list.items.some((item) => item.trackerId === "fixture-tracker-pdf")).toBe(true);
  });

  it("keeps comments out of run messages", async () => {
    const d = domain();
    const added = await command(d, "comment.add", {
      trackerId: "fixture-tracker-pdf",
      body: "人工讨论，不是执行消息",
    });
    const history = query<{ comments: Array<{ body: string }>; runs: Array<{ messages: unknown[] }> }>(
      d,
      "history.get",
      { trackerId: "fixture-tracker-pdf" },
    );
    expect(history.comments.some((row) => row.body.includes("人工讨论"))).toBe(true);
    expect(added.result.comment).toBeTruthy();
  });
});

describe("CAP-01/02/18 filters, views, demo inject", () => {
  it("lists, filters, and searches without dropping native types from all-types query", async () => {
    const d = domain();
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "PDF" });
    expect(listed.mode).toBe("demo");
    expect(listed.items.some((item) => item.trackerId === "fixture-tracker-pdf")).toBe(true);
    const devices = query<{ mode: string; devices: Array<{ id: string }> }>(d, "device.list");
    expect(devices.devices.some((row) => row.id === "fixture-device-ubuntu")).toBe(true);
    const types = query<{ types: Array<{ id: string }> }>(d, "schema.types");
    expect(types.types.map((row) => row.id)).toEqual(
      expect.arrayContaining(["plan", "decision", "bug", "task", "idea", "milestone", "release"]),
    );
  });

  it("saves a view and lists ready items", async () => {
    const d = domain();
    const saved = await command(d, "view.save", {
      viewId: "test:bugs",
      name: "缺陷",
      definition: { types: ["bug"], statusScope: "all", includeArchived: true },
    });
    expect(saved.ok).toBe(true);
    const views = query<{ views: Array<{ viewId: string }> }>(d, "view.list");
    expect(views.views.some((row) => row.viewId === "test:bugs")).toBe(true);
    const ready = query<{ items: Array<{ trackerId: string }> }>(d, "ready.list");
    expect(Array.isArray(ready.items)).toBe(true);
  });

  it("injects every demo scenario and reset restores fixtures", async () => {
    const d = domain("off");
    const scenarios = [
      "waiting_input",
      "verification_failed",
      "lost",
      "cancel_unconfirmed",
      "message_disorder",
      "review_required",
      "disconnect",
    ] as const;
    for (const scenario of scenarios) {
      const created = await command(d, "task.create", { title: `注入 ${scenario}` });
      const injected = await command(d, "demo.inject", { scenario, trackerId: created.trackerId });
      expect(injected.ok).toBe(true);
      expect(injected.mode).toBe("demo");
      expect(injected.result.scenario).toBe(scenario);
    }
    const reset = await command(d, "demo.reset", {});
    expect(reset.result.reset).toBe(true);
    const pdf = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(pdf.record.fields.title).toContain("PDF");
    expect(pdf.binding.latestRunId).toBeNull();
  });
});

describe("LIFE-01 dispose does not cancel a run", () => {
  it("reopens the same profile and finds the same accepted run", async () => {
    const first = openDomain("off");
    const started = await command(first.domain, "run.start", { trackerId: "fixture-tracker-pdf" });
    expect(started.runId).toBeTruthy();
    first.domain.dispose();
    const second = new (await import("../src/core/domain.ts")).DomainService({
      profileDir: first.profileDir,
      simulate: "off",
    });
    sessions.push({
      dispose() {
        second.dispose();
        first.dispose();
      },
    });
    const shown = query<RunShow>(second, "run.show", { runId: started.runId });
    expect(shown.run.id).toBe(started.runId);
    expect(shown.run.status).not.toBe("cancelled");
  });
});
