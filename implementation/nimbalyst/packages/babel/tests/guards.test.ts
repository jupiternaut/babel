import { afterEach, describe, expect, it } from "vitest";
import { BabelError } from "../src/contracts.ts";
import type { DomainService } from "../src/core/domain.ts";
import { PROJECT, command, expectCode, openDomain, query, type TaskDetail } from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

function domain(simulate: "off" | "sync" = "off"): DomainService {
  const opened = openDomain(simulate);
  sessions.push(opened);
  return opened.domain;
}

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("CAP-16/19 write guards", () => {
  it("rejects run.start on fixture-tracker-sync with RUN_ACTIVE", async () => {
    const d = domain("off");
    const error = await expectCode(
      () => command(d, "run.start", { trackerId: "fixture-tracker-sync" }),
      "RUN_ACTIVE",
    );
    expect(error.details.runId).toBe("fixture-run-sync-2");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-sync" });
    expect(detail.latestRun?.id ?? detail.binding.latestRunId).toBe("fixture-run-sync-2");
  });

  it("rejects writes to fixture-tracker-readonly with READ_ONLY", async () => {
    const d = domain();
    await expectCode(
      () => command(d, "task.update", { trackerId: "fixture-tracker-readonly", title: "x" }),
      "READ_ONLY",
    );
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-readonly" });
    expect(detail.record.fields.title).toBe("只读远端文件条目");
  });

  it("rejects managed status:done with COMPLETION_GUARD", async () => {
    const d = domain();
    await expectCode(
      () => command(d, "task.update", { trackerId: "fixture-tracker-pdf", status: "done" }),
      "COMPLETION_GUARD",
    );
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(detail.record.fields.status).not.toBe("done");
    expect(detail.stage).toBe("TODO");
  });

  it("rejects stage/outcome patches with VALIDATION", async () => {
    const d = domain();
    await expectCode(
      () => command(d, "task.update", { trackerId: "fixture-tracker-pdf", stage: "DONE" }),
      "VALIDATION",
    );
  });

  it("rejects stale expectedRevision with REVISION_CONFLICT", async () => {
    const d = domain();
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    await expectCode(
      () => command(d, "task.update", { trackerId: "fixture-tracker-pdf", title: "冲突" }, { expectedRevision: detail.record.revision - 1 }),
      "REVISION_CONFLICT",
    );
  });

  it("rejects the same idempotency key with a different payload", async () => {
    const d = domain("off");
    await command(d, "run.start", { trackerId: "fixture-tracker-pdf" }, { idempotencyKey: "start-pdf-1" });
    await expectCode(
      () => command(d, "run.start", { trackerId: "fixture-tracker-pdf", summary: "另一份摘要" }, { idempotencyKey: "start-pdf-1" }),
      "IDEMPOTENCY_CONFLICT",
    );
  });
});

describe("CAP-12 hook cannot self-approve", () => {
  it("rejects review.accept from actor.kind=hook", async () => {
    const d = domain("sync");
    const started = await command(d, "run.start", { trackerId: "fixture-tracker-research" });
    await expectCode(
      () => command(d, "review.accept", { runId: started.runId }, {
        actor: { id: "hook-actor", kind: "hook", projectIds: [PROJECT] },
      }),
      "COMPLETION_GUARD",
    );
    const shown = query<{ run: { status: string } }>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).toBe("review_required");
  });
});

describe("CAP-10 lost and cancel_pending", () => {
  it.each([
    ["lost", "READ_ONLY"], ["cancel_unconfirmed", "READ_ONLY"],
    ["lost", "REVISION_CONFLICT"], ["cancel_unconfirmed", "REVISION_CONFLICT"],
  ] as const)("rejects %s reconciliation with %s without terminating the run", async (scenario, code) => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "核对守卫" });
    await command(d, "demo.inject", { scenario, trackerId: created.trackerId });
    const initial = structuredClone(query<TaskDetail>(d, "task.get", { trackerId: created.trackerId }));
    if (code === "READ_ONLY") {
      d.store.transaction(data => { data.records.find(row => row.id === created.trackerId)!.system.readOnly = true; });
    } else {
      await command(d, "task.update", { trackerId: created.trackerId, title: "确认期间已更新" });
    }
    const before = structuredClone(query<TaskDetail>(d, "task.get", { trackerId: created.trackerId }));
    const finished = d.store.data.events.filter(event => event.runId === initial.latestRun!.id && event.type === "run.finished");
    await expectCode(() => command(d, "run.reconcile", {
      runId: initial.latestRun!.id, resolution: "cancelled",
    }, { expectedRevision: initial.record.revision }), code);
    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.record).toEqual(before.record);
    expect(after.latestRun).toEqual(before.latestRun);
    expect(after.binding).toEqual(before.binding);
    expect(d.store.data.events.filter(event => event.runId === initial.latestRun!.id && event.type === "run.finished")).toEqual(finished);
    if (code === "READ_ONLY") {
      for (const input of [{ trackerId: created.trackerId }, { runId: initial.latestRun!.id }]) {
        const caps = query<{ actions: Record<string, { allowed: boolean; code?: string }> }>(d, "capabilities.get", input);
        expect(caps.actions["run.reconcile"]).toMatchObject({ allowed: false, code: "READ_ONLY" });
      }
    }
  });

  it.each(["lost", "cancel_unconfirmed"] as const)("reconciles %s once and keeps the same run unresolved", async scenario => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "明确核对结果" });
    await command(d, "demo.inject", { scenario, trackerId: created.trackerId });
    const before = structuredClone(query<TaskDetail>(d, "task.get", { trackerId: created.trackerId }));
    const input = { runId: before.latestRun!.id, resolution: scenario === "lost" ? "failed" : "cancelled" };
    const options = { expectedRevision: before.record.revision, idempotencyKey: "reconcile-once" };
    await command(d, "run.reconcile", input, options);
    await command(d, "run.reconcile", input, options);
    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.latestRun).toMatchObject({ id: input.runId, status: input.resolution });
    expect(after.binding.outcome).toBe("unresolved");
    expect(after.runs).toHaveLength(before.runs.length);
    expect(after.stage).not.toBe("DONE");
    expect(d.store.data.events.filter(event => event.runId === input.runId && event.type === "run.finished" && event.payload.reconciled === true)).toHaveLength(1);
    const caps = query<{ actions: Record<string, { allowed: boolean; code?: string }> }>(d, "capabilities.get", { trackerId: created.trackerId });
    expect(caps.actions["run.reconcile"]).toMatchObject({ allowed: false, code: "PRECONDITION" });
  });

  it("blocks start after lost until reconcile", async () => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "失联条目" });
    await command(d, "demo.inject", { scenario: "lost", trackerId: created.trackerId });
    await expectCode(
      () => command(d, "run.start", { trackerId: created.trackerId }),
      "LOST_UNRECONCILED",
    );
    try {
      await command(d, "run.retry", { trackerId: created.trackerId });
      expect.fail("retry should be rejected while lost");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect(["LOST_UNRECONCILED", "RUN_ACTIVE"]).toContain((error as BabelError).code);
    }
    const caps = query<{ actions: Record<string, { code?: string }> }>(d, "capabilities.get", {
      trackerId: created.trackerId,
    });
    expect(caps.actions["run.start"]?.code).toBe("LOST_UNRECONCILED");
    expect(caps.actions["run.retry"]?.code).toBe("LOST_UNRECONCILED");
  });

  it("blocks archive while a run is executing", async () => {
    const d = domain("off");
    await expectCode(
      () => command(d, "task.archive", { trackerId: "fixture-tracker-sync" }),
      "PRECONDITION",
    );
    const caps = query<{ actions: Record<string, { code?: string; allowed: boolean; reason?: string }> }>(d, "capabilities.get", {
      trackerId: "fixture-tracker-sync",
    });
    expect(caps.actions["task.archive"]?.allowed).toBe(false);
    expect(caps.actions["task.archive"]?.code).toBe("PRECONDITION");
    expect(caps.actions["task.archive"]?.reason).toBe("进行中的执行不能归档，请先结束或取消");
  });

  it("blocks archive after lost until reconcile", async () => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "失联后归档" });
    await command(d, "demo.inject", { scenario: "lost", trackerId: created.trackerId });
    await expectCode(
      () => command(d, "task.archive", { trackerId: created.trackerId }),
      "LOST_UNRECONCILED",
    );
    const caps = query<{ actions: Record<string, { code?: string; allowed: boolean }> }>(d, "capabilities.get", {
      trackerId: created.trackerId,
    });
    expect(caps.actions["task.archive"]?.allowed).toBe(false);
    expect(caps.actions["task.archive"]?.code).toBe("LOST_UNRECONCILED");
  });

  it("blocks archive on cancel_requested with CANCEL_PENDING", async () => {
    const d = domain("off");
    const created = await command(d, "task.create", { title: "取消待确认" });
    await command(d, "demo.inject", { scenario: "cancel_unconfirmed", trackerId: created.trackerId });
    await expectCode(
      () => command(d, "task.archive", { trackerId: created.trackerId }),
      "CANCEL_PENDING",
    );
    try {
      await command(d, "run.retry", { trackerId: created.trackerId });
      expect.fail("retry should be rejected while cancel is pending");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect(["CANCEL_PENDING", "RUN_ACTIVE"]).toContain((error as BabelError).code);
    }
    const caps = query<{ actions: Record<string, { code?: string; allowed: boolean }> }>(d, "capabilities.get", {
      trackerId: created.trackerId,
    });
    expect(caps.actions["task.archive"]?.code).toBe("CANCEL_PENDING");
    expect(caps.actions["run.retry"]?.code).toBe("CANCEL_PENDING");
    expect(caps.actions["task.archive"]?.allowed).toBe(false);
  });
});

describe("CAP-19 cross-project permission", () => {
  it("rejects commands when actor.projectIds omit the project", async () => {
    const d = domain();
    await expectCode(
      () => command(d, "task.create", { title: "越权创建" }, {
        actor: { id: "stranger", kind: "cli", projectIds: ["fixture-project-research"] },
      }),
      "PERMISSION",
    );
  });
});


describe("CAP-04 base metadata updates", () => {
  it("round-trips Unicode owner and ordered tags, allows clears, and rejects stale or readonly edits without events", async () => {
    const d = domain();
    const created = await command(d, "task.create", { title: "基础字段" });
    const trackerId = created.trackerId!;
    const initial = structuredClone(query<TaskDetail>(d, "task.get", { trackerId }));
    const cursor = d.store.data.cursor;
    const updated = await command(d, "task.update", { trackerId, owner: "中文负责人", priority: "high", tags: ["界面", "待复核"] }, { expectedRevision: initial.record.revision });
    const saved = structuredClone(query<TaskDetail>(d, "task.get", { trackerId }));
    expect(saved.record.fields).toMatchObject({ owner: "中文负责人", priority: "high", tags: ["界面", "待复核"] });
    expect(saved.record.revision).toBe(initial.record.revision + 1);
    expect(saved.binding.latestRunId).toBeNull();
    expect(d.eventsSince(PROJECT, cursor).filter(e => e.type === "task.updated")).toEqual([expect.objectContaining({ trackerId, revision: updated.revision })]);
    const beforeConflict = d.store.data.cursor;
    await expectCode(() => command(d, "task.update", { trackerId, tags: ["旧草稿"] }, { expectedRevision: initial.record.revision }), "REVISION_CONFLICT");
    expect(query<TaskDetail>(d, "task.get", { trackerId }).record).toEqual(saved.record);
    expect(d.eventsSince(PROJECT, beforeConflict)).toHaveLength(0);
    await command(d, "task.update", { trackerId, owner: "", tags: [] }, { expectedRevision: saved.record.revision });
    expect(query<TaskDetail>(d, "task.get", { trackerId }).record.fields).toMatchObject({ owner: "", tags: [], priority: "high" });
    const readonly = structuredClone(query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-readonly" }));
    const beforeReadonly = d.store.data.cursor;
    await expectCode(() => command(d, "task.update", { trackerId: readonly.record.id, tags: ["不可写"] }, { expectedRevision: readonly.record.revision }), "READ_ONLY");
    expect(query<TaskDetail>(d, "task.get", { trackerId: readonly.record.id }).record).toEqual(readonly.record);
    expect(d.eventsSince(PROJECT, beforeReadonly)).toHaveLength(0);
  });

  it.each([{ owner: 7 }, { owner: null }, { priority: {} }, { priority: null }, { tags: "错" }, { tags: ["有效", 7] }, { tags: null }])(
    "rejects malformed metadata atomically: %j", async invalid => {
      const d = domain();
      const created = await command(d, "task.create", { title: "原始任务" });
      const trackerId = created.trackerId!;
      const before = structuredClone(query<TaskDetail>(d, "task.get", { trackerId }));
      const cursor = d.store.data.cursor;
      await expectCode(() => command(d, "task.update", { trackerId, title: "也不能改", ...invalid }, { expectedRevision: before.record.revision }), "VALIDATION");
      expect(query<TaskDetail>(d, "task.get", { trackerId }).record).toEqual(before.record);
      expect(d.eventsSince(PROJECT, cursor)).toHaveLength(0);
    },
  );
});


describe("base field revision requirement", () => {
  it.each([undefined, 0, 1.5])("rejects missing or invalid revision %s before changing fields", async expectedRevision => {
    const d = domain();
    const created = await command(d, "task.create", { title: "需要版本" });
    const trackerId = created.trackerId!;
    const before = structuredClone(query<TaskDetail>(d, "task.get", { trackerId }));
    const cursor = d.store.data.cursor;
    await expectCode(() => command(d, "task.update", { trackerId, owner: "拒绝无版本写入" }, { expectedRevision }), "VALIDATION");
    expect(query<TaskDetail>(d, "task.get", { trackerId }).record).toEqual(before.record);
    expect(d.eventsSince(PROJECT, cursor)).toHaveLength(0);
  });
});
