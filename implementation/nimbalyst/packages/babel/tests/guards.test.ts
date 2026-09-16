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
