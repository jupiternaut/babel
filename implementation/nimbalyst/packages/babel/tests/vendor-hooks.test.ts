import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLES_DIR, PROJECT, command, openDomain, query, type TaskDetail } from "./helpers.ts";
import { mapCodexEvent } from "../src/hooks-examples/vendor-codex.mjs";
import { mapPiEvent } from "../src/hooks-examples/vendor-pi.mjs";

function runVendor(script: string, payload: unknown, extraArgs: string[] = []): Promise<{
  code: number | null;
  result: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(EXAMPLES_DIR, script), ...extraArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, result: JSON.parse(stdout || "{}") as Record<string, unknown> });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("vendor hook adapters (not a live vendor)", () => {
  it("maps Codex session.completed to an observation, not business completion", () => {
    const mapped = mapCodexEvent({
      eventVersion: "codex.hook.v1",
      type: "session.completed",
      projectId: PROJECT,
      runId: "run-vendor-1",
    });
    expect(mapped.ok).toBe(true);
    expect(mapped.event).toMatchObject({ payload: { businessComplete: false } });
  });

  it("maps Pi exited to an observation and keeps lost as not stopped", () => {
    const finished = mapPiEvent({ eventVersion: "pi.agent.v1", kind: "exited", runId: "run-pi-1" });
    expect(finished.ok).toBe(true);
    const lost = mapPiEvent({ eventVersion: "pi.agent.v1", kind: "lost", runId: "run-pi-1" });
    expect(lost.ok).toBe(true);
    expect(lost.event).toMatchObject({ payload: { stopped: false, businessComplete: false } });
  });

  it("rejects unknown vendor versions and times out without marking DONE", async () => {
    const version = await runVendor("vendor-codex.mjs", {
      eventVersion: "codex.hook.v9",
      type: "session.completed",
    });
    expect(version.result.ok).toBe(false);
    expect(version.result.code).toBe("UNKNOWN_VERSION");
    expect(version.result.businessComplete).toBe(false);
    const timed = await runVendor("vendor-codex.mjs", {
      eventVersion: "codex.hook.v1",
      type: "session.completed",
    }, ["--timeout-ms", "20", "--sleep-ms", "80"]);
    expect(timed.result.ok).toBe(false);
    expect(timed.result.code).toBe("HOOK_TIMEOUT");
    expect(timed.result.businessComplete).toBe(false);
  });

  it("adapter finished does not change the authoritative task stage", async () => {
    const opened = openDomain("off");
    const created = await command(opened.domain, "task.create", { title: "厂商 finished 不是完成" });
    const adapted = await runVendor("vendor-pi.mjs", {
      eventVersion: "pi.agent.v1",
      kind: "exited",
      projectId: PROJECT,
      trackerId: created.trackerId,
      runId: "run-not-authoritative",
    });
    expect(adapted.result.businessComplete).toBe(false);
    const detail = query<TaskDetail>(opened.domain, "task.get", { trackerId: created.trackerId });
    expect(detail.stage).toBe("TODO");
    expect(detail.binding.latestRunId).toBeNull();
    opened.dispose();
  });
});
