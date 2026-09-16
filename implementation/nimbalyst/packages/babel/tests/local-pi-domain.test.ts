import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainService } from "../src/core/domain.ts";
import { createDemoServer } from "../src/server/http.ts";
import type { Actor, CommandName } from "../src/contracts.ts";
import type { PiObservation } from "../src/pi/runtime.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

function setup() {
  const profileDir = mkdtempSync(path.join(tmpdir(), "babel-local-core-"));
  const target = { workdir: profileDir, provider: "protocol-test", model: "no-model" };
  const observers = new Map<string, (event: PiObservation) => void>();
  const active = new Set<string>();
  const runtime = {
    start: vi.fn(async (input: { runId: string; workdir: string; prompt: string }, observe: (event: PiObservation) => void) => {
      active.add(input.runId); observers.set(input.runId, observe);
      observe({ type: "session", sessionId: `pi-${input.runId}`, sessionFile: `${profileDir}/${input.runId}.jsonl` });
    }),
    message: vi.fn(async () => {}),
    cancel: vi.fn(async (runId: string) => { active.delete(runId); observers.get(runId)?.({ type: "stopped" }); }),
    isActive: (runId: string) => active.has(runId),
    dispose: vi.fn(async () => { for (const id of active) observers.get(id)?.({ type: "stopped" }); active.clear(); }),
  };
  const local = { project: { id: "local-project", name: "Local", workdir: profileDir }, provider: target.provider, model: target.model, runtime };
  const domain = new DomainService({ profileDir, local });
  const actor: Actor = { id: "local-user", kind: "human", projectIds: [local.project.id] };
  const command = (name: CommandName, input: Record<string, unknown>, extra = {}) => domain.command({ name, input, projectId: local.project.id, actor, ...extra });
  const create = () => command("task.create", { title: "真实任务绑定测试", description: "Test saved prompt", acceptance: [{ id: "check", text: "待验收", required: true }] });
  const start = async (key = "start-1") => {
    const created = await create();
    return command("run.start", { trackerId: created.trackerId, executionTarget: target }, { expectedRevision: created.revision, idempotencyKey: key });
  };
  cleanups.push(async () => { await domain.shutdown(); rmSync(profileDir, { recursive: true, force: true }); });
  return { domain, runtime, local, profileDir, target, actor, command, create, start, observers };
}

describe("local Pi domain boundary (protocol double, no model)", () => {
  it("starts empty, binds saved task/cwd/session, deduplicates launch and never invents verification", async () => {
    const { domain, runtime, command, create, target, observers } = setup();
    expect(domain.store.data.records).toEqual([]);
    expect(domain.store.file).toMatch(/local-store.json$/);
    const task = await create();
    const input = { trackerId: task.trackerId, executionTarget: target };
    const extra = { expectedRevision: task.revision, idempotencyKey: "launch" };
    const first = await command("run.start", input, extra);
    await command("run.start", input, extra);
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.start.mock.calls[0][0]).toMatchObject({ workdir: target.workdir });
    expect(runtime.start.mock.calls[0][0].prompt).toContain("Test saved prompt");
    const run = domain.store.data.runs[0];
    expect(run.sessionId).toBe(`pi-${first.runId}`);
    expect(run.execution).toMatchObject(target);
    observers.get(run.id)!({ type: "message", id: "a", role: "agent", text: "Hello" });
    observers.get(run.id)!({ type: "message", id: "a", role: "agent", text: "Hello world", replace: true });
    observers.get(run.id)!({ type: "idle" });
    expect(run.status).toBe("review_required");
    await expect(command("task.archive", { trackerId: task.trackerId })).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(run.messages.filter((row) => row.id === "a")).toHaveLength(1);
    expect(run.messages[0].text).toBe("Hello world");
    expect(run.diff).toBeNull();
    expect(run.verification.every((row) => row.state === "pending")).toBe(true);
    expect(domain.store.data.events.every((event) => event.mode === "local")).toBe(true);
    await expect(command("review.accept", { runId: run.id })).rejects.toMatchObject({ code: "PRECONDITION" });
  });

  it("rejects stale/missing target, missing revision/key and competing workdir execution before launch", async () => {
    const { command, create, target, runtime } = setup();
    const task = await create();
    const input = { trackerId: task.trackerId, executionTarget: target };
    for (const extra of [{}, { expectedRevision: task.revision }, { idempotencyKey: "k" }]) {
      await expect(command("run.start", input, extra)).rejects.toMatchObject({ code: "PRECONDITION" });
    }
    await expect(command("run.start", { ...input, executionTarget: { ...target, model: "changed" } }, { expectedRevision: task.revision, idempotencyKey: "wrong" })).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(runtime.start).not.toHaveBeenCalled();
    await command("run.start", input, { expectedRevision: task.revision, idempotencyKey: "good" });
    const second = await create();
    await expect(command("run.start", { trackerId: second.trackerId, executionTarget: target }, { expectedRevision: second.revision, idempotencyKey: "second" })).rejects.toMatchObject({ code: "RUN_ACTIVE" });
    expect(runtime.start).toHaveBeenCalledTimes(1);
  });

  it("does not retransmit uncertain messages; keeps workspace locked until confirmed process stop", async () => {
    const { start, command, runtime, domain } = setup();
    const first = await start();
    runtime.message.mockRejectedValueOnce(new Error("ack timeout"));
    const input = { runId: first.runId, text: "Follow up", clientMessageId: "message-1" };
    await expect(command("run.message", input, { idempotencyKey: "msg" })).rejects.toThrow("ack timeout");
    await expect(command("run.message", input, { idempotencyKey: "msg" })).rejects.toThrow("ack timeout");
    expect(runtime.message).toHaveBeenCalledTimes(1);
    expect(domain.store.data.runs[0].status).toBe("lost");
    await expect(command("run.reconcile", { runId: first.runId })).rejects.toMatchObject({ code: "PRECONDITION" });
    await command("run.cancel", { runId: first.runId });
    expect(domain.store.data.runs[0].status).toBe("cancelled");
    expect(runtime.cancel).toHaveBeenCalledTimes(1);
  });

  it("reopens persisted identity/logs as lost without spawning or injecting demo", async () => {
    const { start, profileDir, domain, local, runtime, observers, command } = setup();
    const result = await start();
    observers.get(result.runId!)!({ type: "message", id: "saved", role: "agent", text: "Persist me" });
    domain.dispose();
    const reopened = new DomainService({ profileDir, local });
    expect(reopened.store.data.runs[0]).toMatchObject({ id: result.runId, status: "lost" });
    expect(reopened.store.data.runs[0].messages[0].text).toBe("Persist me");
    expect(runtime.start).toHaveBeenCalledTimes(1);
    await expect(reopened.command({ name: "demo.reset", projectId: local.project.id, input: {}, actor: { id: "u", kind: "human", projectIds: [local.project.id] } })).rejects.toThrow();
    reopened.dispose();
  });

  it("locks a local profile to one writer and persists confirmed shutdown before reopening", async () => {
    const { start, profileDir, domain, local } = setup();
    const run = await start();
    expect(() => new DomainService({ profileDir, local })).toThrow("profile 已锁定");
    await domain.shutdown();
    const reopened = new DomainService({ profileDir, local });
    expect(reopened.store.data.runs[0]).toMatchObject({ id: run.runId, status: "cancelled" });
    reopened.dispose();
  });

  it("blocks follow-up before the initial prompt is ready and keeps stop confirmation during launch rejection", async () => {
    const { start, runtime, command, domain, observers } = setup();
    const original = runtime.start.getMockImplementation()!;
    let rejectLaunch!: (error: Error) => void;
    runtime.start.mockImplementation(async (input, observe) => {
      await original(input, observe);
      await new Promise<void>((_, reject) => { rejectLaunch = reject; });
    });
    const result = await start();
    await expect(command("run.message", { runId: result.runId, text: "too early" }, { idempotencyKey: "early" })).rejects.toMatchObject({ code: "PRECONDITION" });
    runtime.cancel.mockImplementationOnce(async (id) => {
      rejectLaunch(new Error("start cancelled"));
      await Promise.resolve(); await Promise.resolve();
      observers.get(id)!({ type: "lost", message: "transport closed during abort" });
      observers.get(id)!({ type: "stopped" });
    });
    await command("run.cancel", { runId: result.runId });
    expect(domain.store.data.runs[0].status).toBe("cancelled");
    expect(runtime.message).not.toHaveBeenCalled();
  });

  it("authenticates all local HTTP data and commands against configured project scope", async () => {
    const { domain } = setup();
    const server = createDemoServer({ domain, serviceToken: "local-test-token", port: 0 });
    await server.listen();
    try {
      const post = (body: unknown, headers = {}) => fetch(`${server.endpoint}/v2/query`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      const body = { name: "task.list", projectId: "local-project", actor: { kind: "system", projectIds: ["local-project"] } };
      expect((await post(body)).status).toBe(403);
      expect((await post(body, { authorization: "Bearer wrong" })).status).toBe(403);
      expect((await post(body, { authorization: "Bearer local-test-token", origin: "https://evil.invalid" })).status).toBe(403);
      const allowed = await post(body, { authorization: "Bearer local-test-token" });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ mode: "local", items: [] });
      expect((await post({ ...body, projectId: "fixture-project-babel" }, { authorization: "Bearer local-test-token" })).status).toBe(403);
      expect((await fetch(`${server.endpoint}/v2/snapshot?projectId=local-project`)).status).toBe(403);
      expect((await fetch(`${server.endpoint}/v2/events?projectId=local-project`)).status).toBe(403);
      const stream = await fetch(`${server.endpoint}/v2/events?projectId=local-project`, { headers: { authorization: "Bearer local-test-token" } });
      const drained = stream.text();
      await server.close();
      await drained;
    } finally { if (server.raw.listening) await server.close(); }
  });
});
