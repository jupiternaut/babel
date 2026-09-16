// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_ID, type BabelEvent, type CommandResult, type RunRecord } from "../src/contracts.ts";
import type { Snapshot } from "../src/core/store.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/recovery-server.ts", import.meta.url));
const profiles: string[] = [];
const children: ReturnType<typeof launch>[] = [];

interface Ready {
  type: "ready";
  endpoint: string;
  pid: number;
  nodeVersion: string;
  profileDir: string;
}

function launch(profileDir: string) {
  const child = spawn(process.execPath, ["--import", "tsx", fixture, profileDir], {
    cwd: packageRoot,
    env: { PATH: path.dirname(process.execPath), HOME: profileDir, TMPDIR: tmpdir(), SystemRoot: process.env.SystemRoot },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<Ready>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Recovery server startup timeout: ${stderr}`)), 5000);
    const finish = (error?: Error, value?: Ready) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value!);
    };
    const onMessage = (value: unknown) => {
      if (value && typeof value === "object" && "type" in value && value.type === "ready") finish(undefined, value as Ready);
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish(new Error(`Recovery server exited before ready: ${stderr}`));
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
  return { child, ready, exited };
}

async function startServer(profileDir: string) {
  const server = launch(profileDir);
  children.push(server);
  const ready = await server.ready;
  expect(ready.pid).toBe(server.child.pid);
  expect(ready.profileDir).toBe(profileDir);
  expect(new URL(ready.endpoint).hostname).toBe("127.0.0.1");
  expect(Number(new URL(ready.endpoint).port)).toBeGreaterThan(0);
  return { ...server, ...ready };
}

async function stop(server: ReturnType<typeof launch>, signal: NodeJS.Signals = "SIGTERM") {
  if (!server.child.pid) return;
  if (server.child.exitCode !== null || server.child.signalCode !== null) return server.exited;
  const force = setTimeout(() => server.child.kill("SIGKILL"), 3000);
  server.child.kill(signal);
  try { return await server.exited; }
  finally { clearTimeout(force); }
}

async function post<T>(endpoint: string, route: "command" | "query", body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${endpoint}/v2/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: DEFAULT_PROJECT_ID, ...body }),
    signal: AbortSignal.timeout(3000),
  });
  const result = await response.json();
  expect(response.ok, JSON.stringify(result)).toBe(true);
  return result as T;
}

async function snapshot(endpoint: string) {
  const response = await fetch(`${endpoint}/v2/snapshot?projectId=${DEFAULT_PROJECT_ID}`, { signal: AbortSignal.timeout(3000) });
  expect(response.ok).toBe(true);
  return (await response.json() as { snapshot: Snapshot }).snapshot;
}

async function waitStatus(endpoint: string, runId: string, status: RunRecord["status"]) {
  await vi.waitFor(async () => {
    const result = await post<{ run: RunRecord }>(endpoint, "query", { name: "run.show", input: { runId } });
    expect(result.run.status).toBe(status);
  }, { timeout: 8000, interval: 25 });
}

afterEach(async () => {
  for (const server of children.splice(0)) await stop(server);
  for (const profile of profiles.splice(0)) rmSync(profile, { recursive: true, force: true });
});

describe("HTTP demo service recovery after a real process crash", () => {
  it.each(["executing", "verifying"] as const)("survives SIGKILL during %s without replay or automatic completion", async phase => {
    const profile = mkdtempSync(path.join(tmpdir(), "babel-http-recovery-"));
    profiles.push(profile);
    const first = await startServer(profile);
    const seeded = (await snapshot(first.endpoint)).runs;
    const created = await post<CommandResult>(first.endpoint, "command", {
      name: "task.create", input: { title: `崩溃恢复 ${phase}`, acceptance: [{ id: "check", text: "保留执行证据", required: true }] },
    });
    const request = { name: "run.start", input: { trackerId: created.trackerId }, idempotencyKey: "crash-start-once" };
    const started = await post<CommandResult>(first.endpoint, "command", request);
    const runId = started.runId!;
    await waitStatus(first.endpoint, runId, phase);
    const before = await snapshot(first.endpoint);
    const beforeRun = before.runs.find(run => run.id === runId)!;
    expect(beforeRun.status).toBe(phase);
    const crashed = await stop(first, "SIGKILL");
    expect(crashed?.signal).toBe("SIGKILL");
    await expect(fetch(`${first.endpoint}/v2/health`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();

    const second = await startServer(profile);
    expect(second.pid).not.toBe(first.pid);
    const replay = await post<CommandResult>(second.endpoint, "command", request);
    expect(replay).toMatchObject({ commandStatus: "replayed", runId });
    await waitStatus(second.endpoint, runId, "review_required");
    // Allow another complete simulation interval: finishing the process is not approval.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const after = await snapshot(second.endpoint);
    const recovered = after.runs.find(run => run.id === runId)!;
    expect(recovered).toMatchObject({ id: beforeRun.id, taskId: beforeRun.taskId, attempt: beforeRun.attempt, sessionId: beforeRun.sessionId, inputSnapshotId: beforeRun.inputSnapshotId, executionFence: beforeRun.executionFence, startedAt: beforeRun.startedAt, status: "review_required", endedAt: null, review: null });
    expect(recovered.messages).toHaveLength(1);
    expect(recovered.verification.every(item => item.state === "passed")).toBe(true);
    expect(after.runs.filter(run => run.taskId === created.trackerId)).toHaveLength(1);
    expect(after.runs.filter(run => seeded.some(item => item.id === run.id))).toEqual(seeded);
    const events = after.events.filter(event => event.runId === runId);
    const beforeEvents = before.events.filter(event => event.runId === runId);
    expect(events.slice(0, beforeEvents.length)).toEqual(beforeEvents);
    expect(events.map(event => event.type)).toEqual(["run.accepted", "run.started", "message.delta", "tool.started", "tool.finished", "verification.updated"]);
    expect(new Set(events.map(event => event.eventId)).size).toBe(events.length);
    expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const detail = await post<{ stage: string; binding: { outcome: string } }>(second.endpoint, "query", { name: "task.get", input: { trackerId: created.trackerId } });
    expect(detail).toMatchObject({ stage: "RUNNING", binding: { outcome: "unresolved" } });
    await stop(second);
    await expect(fetch(`${second.endpoint}/v2/health`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    console.info(JSON.stringify({ evidence: "real-process-crash-recovery", phase, platform: process.platform, node: first.nodeVersion, profile, firstPid: first.pid, secondPid: second.pid, endpoints: [first.endpoint, second.endpoint], signal: crashed?.signal, trackerId: created.trackerId, runId, status: recovered.status, eventIds: events.map((event: BabelEvent) => event.eventId), eventTypes: events.map(event => event.type), autoDone: false, childProcessesStopped: true, listenersClosed: true }));
  }, 20_000);
});
