import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  type RunShow,
  type TaskDetail,
  type TaskListResult,
  waitOutboxAttempted,
} from "./helpers.ts";
import type { CommandName } from "../src/contracts.ts";

const sessions: Array<{ domain: { dispose: () => void }; profileDir: string }> = [];

async function drainStoreIo(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

afterEach(async () => {
  while (sessions.length) {
    const session = sessions.pop();
    if (!session) continue;
    session.domain.dispose();
    await drainStoreIo();
    rmSync(session.profileDir, { recursive: true, force: true });
  }
});

function runVendor(script: string, payload: unknown): Promise<{
  code: number | null;
  result: Record<string, unknown>;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(EXAMPLES_DIR, script)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ code, result: JSON.parse(stdout || "{}") as Record<string, unknown>, stderr });
      } catch (error) {
        reject(new Error(`${script} exit ${code}: ${stderr || stdout}: ${String(error)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("LR-17 unknown command has no side effects", () => {
  it("DomainService unknown command is USAGE and does not write", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    const title = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" }).record.fields.title;
    await expectCode(
      () => d.command({
        name: "task.delete" as CommandName,
        projectId: PROJECT,
        input: { trackerId: "fixture-tracker-pdf" },
      }),
      "USAGE",
    );
    expect(d.store.data.cursor).toBe(cursor);
    expect(d.store.data.records.length).toBe(count);
    expect(d.eventsSince(PROJECT, cursor)).toHaveLength(0);
    const after = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(after.record.fields.title).toBe(title);
    expect(after.record.archived).toBe(false);
  });
});

describe("LR-17 hook before-deny and delivery retry", () => {
  it("required beforeCommand deny does not submit create", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "lr17-deny",
      phase: "beforeCommand",
      script: "deny.mjs",
      commands: ["task.create"],
    }));
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    await expectCode(() => command(d, "task.create", { title: "LR17 应被拒绝" }), "HOOK_DENIED");
    expect(d.eventsSince(PROJECT, cursor).some((event) => event.type === "task.updated")).toBe(false);
    expect(d.store.data.records.length).toBe(count);
    expect(d.store.data.cursor).toBe(cursor);
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "LR17 应被拒绝" });
    expect(listed.items).toHaveLength(0);
  });

  it("observe delivery failure retry does not rerun the original command", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "lr17-observe-fail",
      phase: "observe",
      script: "observe-fail.mjs",
    }));
    const cursor = d.store.data.cursor;
    const runCount = d.store.data.runs.length;
    const created = await command(d, "task.create", { title: "LR17 投递失败仍在" });
    expect(created.ok).toBe(true);
    expect(relatedEvents(d, PROJECT, cursor, created.correlationId).some(
      (event) => event.type === "task.updated" && event.payload.action === "create",
    )).toBe(true);
    await waitOutboxAttempted(d);

    const before = query<HookList>(d, "hook.list");
    const failed = before.outbox.find((row) => row.hookId === "lr17-observe-fail");
    expect(failed).toBeTruthy();
    expect(failed!.status).not.toBe("delivered");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("LR17 投递失败仍在");
    expect(detail.binding.latestRunId).toBeNull();

    const attemptsBefore = failed!.attempts;
    const retryCursor = d.store.data.cursor;
    const retried = await command(d, "hook.retry_delivery", { deliveryId: failed!.deliveryId });
    expect(retried.ok).toBe(true);
    expect(retried.result.reranCommand).toBe(false);
    const retryEvents = relatedEvents(d, PROJECT, retryCursor, retried.correlationId);
    expect(retryEvents.some((event) => event.type === "task.updated")).toBe(false);
    expect(retryEvents.some((event) => event.type === "run.accepted" || event.type === "run.started")).toBe(false);
    await vi.waitFor(() => expect(d.store.data.outbox.find(row => row.deliveryId === failed!.deliveryId)?.attempts).toBeGreaterThan(attemptsBefore));

    expect(d.store.data.runs.length).toBe(runCount);
    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.record.revision).toBe(detail.record.revision);
    expect(after.record.id).toBe(created.trackerId);
    const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "LR17 投递失败仍在" });
    expect(listed.items).toHaveLength(1);
  });
});

describe("LR-17 vendor finished is not business success", () => {
  it("codex session.completed does not mark the authoritative run succeeded", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "LR17 Codex finished 不完成" });
    const started = await command(d, "run.start", { trackerId: created.trackerId });
    expect(started.settled).toBe(false);

    const adapted = await runVendor("vendor-codex.mjs", {
      eventVersion: "codex.hook.v1",
      type: "session.completed",
      eventId: "lr17-codex-1",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: started.runId,
      status: "completed",
    });
    expect(adapted.code).toBe(0);
    expect(adapted.result.ok).toBe(true);
    expect(adapted.result.businessComplete).toBe(false);
    const event = adapted.result.event as { type?: string; payload?: { businessComplete?: boolean } };
    expect(event.type).toBe("run.finished");
    expect(event.payload?.businessComplete).toBe(false);

    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).not.toBe("succeeded");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.stage).not.toBe("DONE");
    expect(detail.binding.outcome).not.toBe("succeeded");
    expect(detail.binding.latestRunId).toBe(started.runId);
  });

  it("pi exited does not mark the authoritative run succeeded", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "LR17 Pi finished 不完成" });
    const started = await command(d, "run.start", { trackerId: created.trackerId });

    const adapted = await runVendor("vendor-pi.mjs", {
      eventVersion: "pi.agent.v1",
      kind: "exited",
      eventId: "lr17-pi-1",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: started.runId,
      protocol: "pi",
      status: "exited",
    });
    expect(adapted.code).toBe(0);
    expect(adapted.result.businessComplete).toBe(false);

    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).toBe("accepted");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.stage).toBe("RUNNING");
    expect(detail.binding.outcome).not.toBe("succeeded");
  });
});
