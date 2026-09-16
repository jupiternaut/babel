import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hooks from "../src/core/hooks.ts";
import { DomainService } from "../src/core/domain.ts";
import {
  EXAMPLES_DIR,
  PROJECT,
  command,
  expectCode,
  hookInput,
  openDomain,
  query,
  relatedEvents,
  type HookList,
  type TaskDetail,
  type TaskListResult,
  waitOutboxAttempted,
  writeProfileHook,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
  vi.restoreAllMocks();
});

describe("CAP-20 hook register, beforeCommand, outbox", () => {
  it("does not persist a late observer result after disposal", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    let finish!: (value: { ok: boolean }) => void;
    const observe = vi.spyOn(hooks, "runObserveHook").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await command(d, "hook.register", hookInput({ hookId: "late-observer", phase: "observe", script: "observe-ok.mjs" }));
    await command(d, "task.create", { title: "preserve committed task" });
    expect(observe).toHaveBeenCalledOnce();
    const write = vi.spyOn(d.store, "transaction");
    d.dispose();
    finish({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    expect(write).not.toHaveBeenCalled();
    expect(d.store.data.outbox[0]?.status).toBe("pending");
  });

  it("rejects a command whose validation finishes after disposal", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    let finish!: (value: { allow: boolean }) => void;
    vi.spyOn(hooks, "runBeforeHook").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await command(d, "hook.register", hookInput({ hookId: "late-validator", phase: "beforeCommand", script: "allow.mjs", commands: ["task.create"] }));
    const count = d.store.data.records.length;
    const pending = command(d, "task.create", { title: "must not commit" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
    d.dispose();
    finish({ allow: true });
    await rejected;
    expect(d.store.data.records).toHaveLength(count);
  });
  it("scans profile *.hook.json and ignores *.example", () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), "babel-m0-hooks-"));
    writeProfileHook(profileDir, "allow.hook.json", hookInput({
      hookId: "scanned-allow",
      phase: "beforeCommand",
      script: "allow.mjs",
      commands: ["task.create"],
      required: false,
    }));
    writeProfileHook(profileDir, "deny-create.hook.json.example", hookInput({
      hookId: "scanned-deny-example",
      phase: "beforeCommand",
      script: "deny.mjs",
      commands: ["task.create"],
    }));
    const domain = new DomainService({ profileDir, simulate: "off" });
    sessions.push({
      dispose() {
        domain.dispose();
        rmSync(profileDir, { recursive: true, force: true });
      },
    });
    const listed = query<HookList>(domain, "hook.list");
    expect(listed.hooks.some((row) => row.hookId === "scanned-allow")).toBe(true);
    expect(listed.hooks.some((row) => row.hookId === "scanned-deny-example")).toBe(false);
    expect(EXAMPLES_DIR).toContain("hooks-examples");
  });

  it("allow hook lets create commit", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-allow",
      phase: "beforeCommand",
      script: "allow.mjs",
      commands: ["task.create"],
    }));
    const created = await command(d, "task.create", { title: "Hook 放行创建" });
    expect(created.ok).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("Hook 放行创建");
  });

  it("deny hook does not submit create (HOOK-01)", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-deny",
      phase: "beforeCommand",
      script: "deny.mjs",
      commands: ["task.create"],
    }));
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    await expectCode(() => command(d, "task.create", { title: "应被拒绝" }), "HOOK_DENIED");
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(false);
    expect(d.store.data.records.length).toBe(count);
    expect(d.store.data.cursor).toBe(cursor);
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "应被拒绝" });
    expect(listed.items).toHaveLength(0);
  });

  it("timeout hook does not submit create (HOOK-01)", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-timeout",
      phase: "beforeCommand",
      script: "timeout.mjs",
      commands: ["task.create"],
      timeoutMs: 200,
    }));
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    await expectCode(() => command(d, "task.create", { title: "应超时" }), "HOOK_TIMEOUT");
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.type === "task.updated")).toBe(false);
    expect(d.store.data.records.length).toBe(count);
    expect(d.store.data.cursor).toBe(cursor);
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "应超时" });
    expect(listed.items).toHaveLength(0);
  }, 15000);

  it("observe success delivers at least once and does not replay the command", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-observe-ok",
      phase: "observe",
      script: "observe-ok.mjs",
    }));
    const created = await command(d, "task.create", { title: "观察成功" });
    await waitOutboxAttempted(d);
    const hooks = query<HookList>(d, "hook.list");
    const mine = hooks.outbox.filter((row) => row.hookId === "tmp-observe-ok");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((row) => row.status === "delivered")).toBe(true);
    expect(hooks.deliveries.some((row) => row.hookId === "tmp-observe-ok" && row.ok)).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("观察成功");
  });

  it("observe failure records delivery error and does not roll back (HOOK-01/02)", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "tmp-observe-fail",
      phase: "observe",
      script: "observe-fail.mjs",
    }));
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", { title: "观察失败仍应存在" });
    expect(created.ok).toBe(true);
    const committed = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(committed.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(true);
    await waitOutboxAttempted(d);
    const beforeRetry = query<HookList>(d, "hook.list");
    const failed = beforeRetry.outbox.find((row) => row.hookId === "tmp-observe-fail");
    expect(failed).toBeTruthy();
    expect(failed!.status).not.toBe("delivered");
    expect(failed!.lastError).toBeTruthy();
    expect(beforeRetry.deliveries.some((row) => row.hookId === "tmp-observe-fail" && row.ok === false)).toBe(true);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("观察失败仍应存在");
    const runCount = d.store.data.runs.length;
    const attemptsBefore = failed!.attempts;
    const retried = await command(d, "hook.retry_delivery", { deliveryId: failed!.deliveryId });
    expect(retried.result.reranCommand).toBe(false);
    await vi.waitFor(() => expect(d.store.data.outbox.find(row => row.deliveryId === failed!.deliveryId)?.attempts).toBeGreaterThan(attemptsBefore));
    expect(d.store.data.runs.length).toBe(runCount);
    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.record.revision).toBe(detail.record.revision);
    const again = query<HookList>(d, "hook.list");
    const row = again.outbox.find((item) => item.deliveryId === failed!.deliveryId);
    expect(row?.attempts).toBeGreaterThanOrEqual(failed!.attempts);
  });
});
