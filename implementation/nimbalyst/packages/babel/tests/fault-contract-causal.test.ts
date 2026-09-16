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
  type TaskDetail,
  waitOutboxAttempted,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

function runVendor(script: string, payload: unknown): Promise<{
  code: number | null;
  result: Record<string, unknown>;
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
        resolve({ code, result: JSON.parse(stdout || "{}") as Record<string, unknown> });
      } catch (error) {
        reject(new Error(`vendor ${script} exit ${code}: ${stderr || stdout}: ${String(error)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("production contract: causal loop and missing core causation", () => {
  it("DomainService emits causationId=null; observe delivery does not create another record", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    await command(d, "hook.register", hookInput({
      hookId: "fault-causal-observe",
      phase: "observe",
      script: "observe-ok.mjs",
    }));
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    const created = await command(d, "task.create", { title: "因果观察" });
    const committed = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((event) => event.causationId === null)).toBe(true);
    await waitOutboxAttempted(d);
    const hooks = query<HookList>(d, "hook.list");
    expect(hooks.outbox.some((row) => row.hookId === "fault-causal-observe" && row.status === "delivered")).toBe(true);
    expect(d.store.data.records.length).toBe(count + 1);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.title).toBe("因果观察");
    expect(detail.record.revision).toBe(created.revision);
  });

  it("Codex adapter rejects self-causation and over-long chains", async () => {
    const looped = await runVendor("vendor-codex.mjs", {
      eventVersion: "codex.hook.v1",
      type: "item.completed",
      eventId: "evt-loop",
      causationId: "evt-loop",
      projectId: PROJECT,
      status: "completed",
    });
    expect(looped.code).not.toBe(0);
    expect(looped.result.ok).toBe(false);
    expect(looped.result.code).toBe("CAUSAL_LOOP");
    expect(looped.result.businessComplete).toBe(false);

    const deep = await runVendor("vendor-codex.mjs", {
      eventVersion: "codex.hook.v1",
      type: "session.completed",
      eventId: "evt-deep",
      causationChain: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      projectId: PROJECT,
      status: "completed",
    });
    expect(deep.code).not.toBe(0);
    expect(deep.result.code).toBe("CAUSAL_LIMIT");
    expect(deep.result.businessComplete).toBe(false);
  });

  it("Pi adapter rejects an already-adapted run.finished echo", async () => {
    const echoed = await runVendor("vendor-pi.mjs", {
      schemaVersion: 1,
      eventId: "evt-echo",
      type: "run.finished",
      projectId: PROJECT,
      causationId: "evt-parent",
      causationTypes: ["run.finished"],
      source: { vendor: "pi", eventVersion: "pi.agent.v1" },
      payload: { result: "succeeded" },
    });
    expect(echoed.code).not.toBe(0);
    expect(echoed.result.code).toBe("CAUSAL_LOOP");
    expect(echoed.result.businessComplete).toBe(false);
  });
});
