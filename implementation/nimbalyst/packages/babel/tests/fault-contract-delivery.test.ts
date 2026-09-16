import { afterEach, describe, expect, it } from "vitest";
import {
  PROJECT,
  command,
  hookInput,
  openDomain,
  query,
  relatedEvents,
  type HookList,
  type TaskDetail,
  waitOutboxAttempted,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("production contract: delivery failure does not rerun the command", () => {
  it("observe failure keeps the committed task; retry_delivery does not start a run", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "fault-contract-observe-fail",
      phase: "observe",
      script: "observe-fail.mjs",
    }));
    const cursor = d.store.data.cursor;
    const runCount = d.store.data.runs.length;
    const created = await command(d, "task.create", { title: "投递失败仍应存在" });
    expect(created.ok).toBe(true);
    const committed = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(committed.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(true);
    await waitOutboxAttempted(d);

    const before = query<HookList>(d, "hook.list");
    const failed = before.outbox.find((row) => row.hookId === "fault-contract-observe-fail");
    expect(failed).toBeTruthy();
    expect(failed!.status).not.toBe("delivered");
    expect(failed!.lastError).toBeTruthy();
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("投递失败仍应存在");
    expect(detail.stage).not.toBe("DONE");
    expect(detail.binding.latestRunId).toBeNull();

    const retryCursor = d.store.data.cursor;
    const retried = await command(d, "hook.retry_delivery", { deliveryId: failed!.deliveryId });
    expect(retried.ok).toBe(true);
    expect(retried.result.reranCommand).toBe(false);
    const retryEvents = relatedEvents(d, PROJECT, retryCursor, retried.correlationId);
    expect(retryEvents.some((event) => event.type === "task.updated")).toBe(false);
    expect(retryEvents.some((event) => event.type === "run.accepted" || event.type === "run.started")).toBe(false);
    await waitOutboxAttempted(d);

    expect(d.store.data.runs.length).toBe(runCount);
    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.record.revision).toBe(detail.record.revision);
    expect(after.record.id).toBe(created.trackerId);
    const listed = query<HookList>(d, "hook.list");
    const row = listed.outbox.find((item) => item.deliveryId === failed!.deliveryId);
    expect(row?.attempts).toBeGreaterThanOrEqual(failed!.attempts);
  });
});
