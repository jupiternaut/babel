import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BabelEvent } from "../src/contracts.ts";
import {
  EXAMPLES_DIR,
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

type DedupState = {
  seen: string[];
  applied: Array<{ eventId: string; cursor: string | null; seq: number | null; type: string | null }>;
  duplicates: string[];
};

type ConsumeResult = {
  ok: boolean;
  after: number;
  applied: Array<{ eventId: string; type: string; cursor: string; seq: number; streamId: string }>;
  lastCursor: number;
  unique: number;
};

async function waitDeliveryAttempts(domain: { store: { data: { outbox: Array<{ deliveryId: string; attempts: number }> } } }, deliveryId: string, minAttempts: number, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = domain.store.data.outbox.find((item) => item.deliveryId === deliveryId);
    if (row && row.attempts >= minAttempts) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`delivery ${deliveryId} did not reach ${minAttempts} attempts`);
}

function runConsumeCursor(events: BabelEvent[], after: number | string = 0): Promise<ConsumeResult> {
  const script = path.join(EXAMPLES_DIR, "consume-cursor.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, String(after)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`consume-cursor exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(JSON.parse(stdout) as ConsumeResult);
    });
    child.stdin.write(JSON.stringify(events));
    child.stdin.end();
  });
}

describe("HOOK-02 duplicate delivery, disorder, resume cursor", () => {
  it("retries the same eventId without applying twice or rerunning the command", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const statePath = path.join(opened.profileDir, "observe-dedup-state.json");
    await command(d, "hook.register", {
      ...hookInput({
        hookId: "tmp-observe-dedup",
        phase: "observe",
        script: "observe-dedup.mjs",
      }),
      argv: [path.join(EXAMPLES_DIR, "observe-dedup.mjs"), statePath],
    });

    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", { title: "去重投递" });
    expect(created.ok).toBe(true);
    const committed = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(committed.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(true);
    await waitOutboxAttempted(d);

    const first = query<HookList>(d, "hook.list");
    const row = first.outbox.find((item) => item.hookId === "tmp-observe-dedup" && item.eventId === committed[0]?.eventId);
    expect(row?.status).toBe("delivered");
    expect(existsSync(statePath)).toBe(true);
    const afterFirst = JSON.parse(readFileSync(statePath, "utf8")) as DedupState;
    expect(afterFirst.applied.map((item) => item.eventId).sort()).toEqual([...new Set(afterFirst.seen)].sort());

    const retryCursor = d.store.data.cursor;
    const attemptsBeforeRetry = row!.attempts;
    const retried = await command(d, "hook.retry_delivery", { deliveryId: row!.deliveryId });
    expect(retried.ok).toBe(true);
    expect(retried.result.reranCommand).toBe(false);
    const retryEvents = relatedEvents(d, PROJECT, retryCursor, retried.correlationId);
    expect(retryEvents.some((event) => event.type === "task.updated")).toBe(false);
    await waitDeliveryAttempts(d, row!.deliveryId, attemptsBeforeRetry + 1);

    const afterRetry = JSON.parse(readFileSync(statePath, "utf8")) as DedupState;
    expect(afterRetry.duplicates.length).toBeGreaterThan(0);
    expect(afterRetry.applied.filter((item) => item.eventId === row!.eventId)).toHaveLength(1);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("去重投递");
    expect(detail.record.revision).toBe(created.revision);
    const listed = query<HookList>(d, "hook.list");
    expect(listed.outbox.filter((item) => item.eventId === row!.eventId).length).toBe(1);
  });

  it("orders disordered events by cursor/seq and resumes from the last cursor", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "乱序续读" });
    const injectCursor = d.store.data.cursor;
    const injected = await command(d, "demo.inject", {
      scenario: "message_disorder",
      trackerId: created.trackerId,
    });
    expect(injected.ok).toBe(true);
    const listedAfterInject = query<{ events: BabelEvent[] }>(d, "events.list", {
      cursor: String(injectCursor),
    });
    const stream = listedAfterInject.events.filter((event) => event.type === "message.delta" && event.payload.disorder === true);
    expect(stream.map((event) => event.payload.label)).toEqual(["B", "A"]);
    expect(Number(stream[0]!.cursor)).toBeLessThan(Number(stream[1]!.cursor));
    expect(stream[0]!.seq).toBeLessThan(stream[1]!.seq);

    const shuffled = [stream[1]!, stream[0]!, stream[0]!];
    const consumed = await runConsumeCursor(shuffled, injectCursor);
    expect(consumed.ok).toBe(true);
    expect(consumed.unique).toBe(2);
    expect(consumed.applied.map((event) => event.eventId)).toEqual(stream.map((event) => event.eventId));

    const listed = query<{ mode: string; events: BabelEvent[] }>(d, "events.list", {
      cursor: String(consumed.lastCursor),
    });
    expect(listed.mode).toBe("demo");
    expect(listed.events.some((event) => event.eventId === stream[0]!.eventId)).toBe(false);
    expect(listed.events.some((event) => event.eventId === stream[1]!.eventId)).toBe(false);

    const shown = query<{ run: { messages: Array<{ text: string }> } }>(d, "run.show", { runId: injected.runId });
    expect(shown.run.messages.some((row) => row.text.includes("乱序消息 B"))).toBe(true);
    expect(shown.run.messages.some((row) => row.text.includes("乱序消息 A"))).toBe(true);
  });

  it("re-queries the snapshot when the cursor is past the latest event", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "过期游标" });
    const stale = String(d.store.data.cursor + 50);
    const listed = query<{ events: BabelEvent[] }>(d, "events.list", { cursor: stale });
    expect(listed.events).toHaveLength(0);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.id).toBe(created.trackerId);
    expect(detail.record.fields.title).toBe("过期游标");
  });

  it("observe crash records delivery failure and leaves the committed task", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-observe-crash",
      phase: "observe",
      script: "observe-crash.mjs",
    }));
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", { title: "观察崩溃仍应存在" });
    expect(relatedEvents(d, PROJECT, cursor, created.correlationId).some((event) => event.type === "task.updated")).toBe(true);
    await waitOutboxAttempted(d);
    const hooks = query<HookList>(d, "hook.list");
    const failed = hooks.outbox.find((row) => row.hookId === "tmp-observe-crash");
    expect(failed).toBeTruthy();
    expect(failed!.status).not.toBe("delivered");
    expect(hooks.deliveries.some((row) => row.hookId === "tmp-observe-crash" && row.ok === false)).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("观察崩溃仍应存在");
  });
});
