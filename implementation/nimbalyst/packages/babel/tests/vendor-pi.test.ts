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

function runPi(payload: unknown, extraArgs: string[] = []): Promise<{
  code: number | null;
  result: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(EXAMPLES_DIR, "vendor-pi.mjs"), ...extraArgs], {
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
        resolve({ code, result: JSON.parse(stdout || "{}") as Record<string, unknown> });
      } catch (error) {
        reject(new Error(`vendor-pi exit ${code}: ${stderr || stdout}: ${String(error)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("vendor-pi adapter parse / reject / timeout", () => {
  it("parses pi.agent.v1 exited and does not complete the authoritative run", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "Pi 适配观察" });
    const startCursor = d.store.data.cursor;
    const started = await command(d, "run.start", { trackerId: created.trackerId });
    expect(relatedEvents(d, PROJECT, startCursor, started.correlationId).some((event) => event.type === "run.accepted")).toBe(true);

    const adapted = await runPi({
      eventVersion: "pi.agent.v1",
      kind: "exited",
      eventId: "pi-evt-1",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: started.runId,
      protocol: "pi",
      status: "exited",
      PI_API_KEY: "should-not-leak",
    });
    expect(adapted.code).toBe(0);
    expect(adapted.result.ok).toBe(true);
    expect(adapted.result.businessComplete).toBe(false);
    const source = adapted.result.source as { vendor?: string; eventVersion?: string; rawType?: string };
    expect(source.vendor).toBe("pi");
    expect(source.eventVersion).toBe("pi.agent.v1");
    expect(source.rawType).toBe("exited");
    const event = adapted.result.event as { type?: string; payload?: { businessComplete?: boolean } };
    expect(event.type).toBe("run.finished");
    expect(event.payload?.businessComplete).toBe(false);
    expect(JSON.stringify(adapted.result)).not.toContain("should-not-leak");

    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).toBe("accepted");
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.stage).toBe("RUNNING");
    expect(detail.binding.outcome).not.toBe("succeeded");
  });

  it("maps lost as not-stopped and rejects unknown version", async () => {
    const lost = await runPi({
      eventVersion: "pi.agent.v1",
      kind: "lost",
      projectId: PROJECT,
      runId: "run-x",
    });
    expect(lost.code).toBe(0);
    const event = lost.result.event as { payload?: { vendorResult?: string; stopped?: boolean } };
    expect(event.payload?.vendorResult).toBe("lost");
    expect(event.payload?.stopped).toBe(false);
    expect(lost.result.businessComplete).toBe(false);

    const unknown = await runPi({ eventVersion: "pi.agent.v0", kind: "exited" });
    expect(unknown.code).not.toBe(0);
    expect(unknown.result.code).toBe("UNKNOWN_VERSION");
  });

  it("times out when sleep exceeds timeout-ms", async () => {
    const timed = await runPi({ eventVersion: "pi.agent.v1", kind: "exited" }, [
      "--timeout-ms",
      "40",
      "--sleep-ms",
      "200",
    ]);
    expect(timed.code).toBe(8);
    expect(timed.result.timedOut).toBe(true);
    expect(timed.result.businessComplete).toBe(false);
  });

  it("passthrough Babel run.finished is still not business complete; query stays review_required after sync", async () => {
    const opened = openDomain("sync");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "Pi 透传不验收" });
    const started = await command(d, "run.start", { trackerId: created.trackerId });
    const shown = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).toBe("review_required");

    const passthrough = await runPi({
      schemaVersion: 1,
      eventId: "evt-finished",
      type: "run.finished",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: started.runId,
      payload: { result: "succeeded" },
    });
    expect(passthrough.code).toBe(0);
    expect(passthrough.result.passthrough).toBe(true);
    expect(passthrough.result.businessComplete).toBe(false);

    const after = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(after.stage).not.toBe("DONE");
    expect(after.binding.outcome).not.toBe("succeeded");
    const run = query<RunShow>(d, "run.show", { runId: started.runId });
    expect(run.run.status).toBe("review_required");
  });

  it("observe registration delivers without creating a second run", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "vendor-pi-observe",
      phase: "observe",
      script: "vendor-pi.mjs",
    }));
    const cursor = d.store.data.cursor;
    const runCount = d.store.data.runs.length;
    const created = await command(d, "task.create", { title: "Pi 观察不重跑" });
    expect(relatedEvents(d, PROJECT, cursor, created.correlationId).some((event) => event.type === "task.updated")).toBe(true);
    await waitOutboxAttempted(d);
    const hooks = query<HookList>(d, "hook.list");
    expect(hooks.outbox.find((row) => row.hookId === "vendor-pi-observe")?.status).toBe("delivered");
    expect(d.store.data.runs.length).toBe(runCount);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.binding.latestRunId).toBeNull();
  });
});
