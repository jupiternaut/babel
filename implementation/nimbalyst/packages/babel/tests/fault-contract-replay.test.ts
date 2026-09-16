import { afterEach, describe, expect, it } from "vitest";
import type { EventRecord, OutboxRecord } from "../src/gateway/contracts.ts";
import type { BabelEvent } from "../src/contracts.ts";
import {
  PROJECT,
  command,
  expectCode,
  openDomain,
  query,
  relatedEvents,
  type TaskDetail,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

function toGatewayEvent(event: BabelEvent): EventRecord {
  return {
    eventId: event.eventId,
    projectId: event.projectId,
    trackerId: event.trackerId,
    runId: event.runId,
    type: event.type,
    streamId: event.streamId,
    seq: event.seq,
    cursor: Number(event.cursor),
    payloadJson: JSON.stringify(event.payload),
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
  };
}

describe("production contract: failed write and idempotent replay", () => {
  it("VALIDATION does not persist a record or emit task.updated", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    await expectCode(() => command(d, "task.create", { title: "   " }), "VALIDATION");
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.type === "task.updated")).toBe(false);
    expect(d.store.data.records.length).toBe(count);
    expect(d.store.data.cursor).toBe(cursor);
    const listed = query<TaskListResult>(d, "task.list", {
      types: "all",
      includeSemantic: true,
      q: "空白标题不应出现",
    });
    expect(listed.items).toHaveLength(0);
  });

  it("REVISION_CONFLICT leaves the title and revision unchanged", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "冲突前标题" });
    expect(created.ok).toBe(true);
    const cursor = d.store.data.cursor;
    await expectCode(
      () => command(d, "task.update", { trackerId: created.trackerId, title: "不应写入" }, {
        expectedRevision: (created.revision ?? 1) - 1,
      }),
      "REVISION_CONFLICT",
    );
    expect(d.eventsSince(PROJECT, cursor).some((event) => event.payload.action === "update")).toBe(false);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("冲突前标题");
    expect(detail.record.revision).toBe(created.revision);
  });

  it("same idempotency key replays without a second create event", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const first = await command(d, "task.create", { title: "幂等重放", id: "fault-replay-tracker" }, {
      idempotencyKey: "fault-replay-create-1",
    });
    expect(first.ok).toBe(true);
    expect(first.commandStatus).toBe("accepted");
    const cursor = d.store.data.cursor;
    const second = await command(d, "task.create", { title: "幂等重放", id: "fault-replay-tracker" }, {
      idempotencyKey: "fault-replay-create-1",
    });
    expect(second.ok).toBe(true);
    expect(second.commandStatus).toBe("replayed");
    expect(second.trackerId).toBe(first.trackerId);
    expect(second.correlationId).toBe(first.correlationId);
    const replayEvents = d.eventsSince(PROJECT, cursor);
    expect(replayEvents.some((event) => event.type === "task.updated")).toBe(false);
    const listed = query<TaskListResult>(d, "task.list", { types: "all", q: "幂等重放" });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.trackerId).toBe("fault-replay-tracker");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: first.trackerId });
    expect(detail.record.revision).toBe(first.revision);
  });

  it("maps a committed Babel event onto Gateway EventRecord without vendor config", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", { title: "合同投影" });
    const committed = relatedEvents(d, PROJECT, cursor, created.correlationId);
    const updated = committed.find((event) => event.type === "task.updated");
    expect(updated).toBeTruthy();
    const row = toGatewayEvent(updated!);
    expect(row.eventId).toBe(updated!.eventId);
    expect(row.projectId).toBe(PROJECT);
    expect(row.trackerId).toBe(created.trackerId);
    expect(row.correlationId).toBe(created.correlationId);
    expect(JSON.parse(row.payloadJson)).not.toHaveProperty("apiKey");
    const outboxShape: OutboxRecord = {
      deliveryId: "dlv-shape",
      eventId: row.eventId,
      hookId: "observe-shape",
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: row.occurredAt,
      status: "pending",
    };
    expect(outboxShape.status).toBe("pending");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("合同投影");
  });
});
