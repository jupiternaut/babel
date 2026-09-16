import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXAMPLES_DIR,
  PROJECT,
  command,
  hookInput,
  openDomain,
  query,
  relatedEvents,
  type HookList,
  type RunShow,
  type TaskDetail,
  waitOutboxAttempted,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

function runCodex(payload: unknown, extraArgs: string[] = []): Promise<{
  code: number | null;
  result: Record<string, unknown>;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(EXAMPLES_DIR, "vendor-codex.mjs"), ...extraArgs], {
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
        reject(new Error(`vendor-codex exit ${code}: ${stderr || stdout}: ${String(error)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("vendor-codex adapter parse / reject / timeout", () => {
  it("parses codex.hook.v1 completed and keeps source fields; finished is not complete", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "Codex 适配观察" });
    const started = await command(d, "run.start", { trackerId: created.trackerId });
    expect(started.settled).toBe(false);

    const adapted = await runCodex({
      eventVersion: "codex.hook.v1",
      type: "session.completed",
      eventId: "codex-evt-1",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: started.runId,
      status: "completed",
      apiKey: "should-not-leak",
    });
    expect(adapted.code).toBe(0);
    expect(adapted.result.ok).toBe(true);
    expect(adapted.result.businessComplete).toBe(false);
    expect(adapted.result.observationOnly).toBe(true);
    const source = adapted.result.source as { vendor?: string; eventVersion?: string; rawType?: string };
    expect(source.vendor).toBe("codex");
    expect(source.eventVersion).toBe("codex.hook.v1");
    expect(source.rawType).toBe("session.completed");
    const event = adapted.result.event as { type?: string; payload?: { businessComplete?: boolean; vendorResult?: string } };
    expect(event.type).toBe("run.finished");
    expect(event.payload?.businessComplete).toBe(false);
    expect(event.payload?.vendorResult).toBe("succeeded");
    expect(JSON.stringify(adapted.result)).not.toContain("should-not-leak");

    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).not.toBe("succeeded");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.stage).not.toBe("DONE");
    expect(detail.binding.outcome).not.toBe("succeeded");
  });

  it("rejects unknown version, missing type, and foreign project", async () => {
    const unknown = await runCodex({
      eventVersion: "codex.hook.v0",
      type: "session.completed",
      projectId: PROJECT,
    });
    expect(unknown.code).not.toBe(0);
    expect(unknown.result.code).toBe("UNKNOWN_VERSION");
    expect(unknown.result.businessComplete).toBe(false);

    const missing = await runCodex({ eventVersion: "codex.hook.v1", projectId: PROJECT });
    expect(missing.code).not.toBe(0);
    expect(missing.result.code).toBe("VALIDATION");

    const denied = await runCodex({
      eventVersion: "codex.hook.v1",
      type: "item.completed",
      projectId: PROJECT,
      actor: { id: "stranger", projectIds: ["fixture-project-research"] },
      status: "completed",
    });
    expect(denied.code).toBe(5);
    expect(denied.result.code).toBe("PERMISSION");
  });

  it("times out when sleep exceeds timeout-ms", async () => {
    const timed = await runCodex({ eventVersion: "codex.hook.v1", type: "session.completed" }, [
      "--timeout-ms",
      "40",
      "--sleep-ms",
      "200",
    ]);
    expect(timed.code).toBe(8);
    expect(timed.result.ok).toBe(false);
    expect(timed.result.timedOut).toBe(true);
    expect(timed.result.businessComplete).toBe(false);
  });

  it("observe delivery of the adapter does not mark the task done", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", {
      ...hookInput({
        hookId: "vendor-codex-observe",
        phase: "observe",
        script: "vendor-codex.mjs",
      }),
    });
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", { title: "Codex 观察不完成" });
    expect(relatedEvents(d, PROJECT, cursor, created.correlationId).some((event) => event.type === "task.updated")).toBe(true);
    await waitOutboxAttempted(d);
    const hooks = query<HookList>(d, "hook.list");
    const row = hooks.outbox.find((item) => item.hookId === "vendor-codex-observe");
    expect(row?.status).toBe("delivered");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("Codex 观察不完成");
    expect(detail.stage).toBe("TODO");
    expect(detail.binding.outcome).toBe("not_started");
  });
});
