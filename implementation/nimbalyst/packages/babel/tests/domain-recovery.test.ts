// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainService, type SimulateMode } from "../src/core/domain.ts";
import type { RunRecord } from "../src/contracts.ts";
import { command, PROJECT } from "./helpers.ts";

const STEP_MS = 20;
const profiles: string[] = [];
const services: DomainService[] = [];

function open(profileDir = mkdtempSync(path.join(tmpdir(), "babel-recovery-")), simulate: SimulateMode = "async") {
  if (!profiles.includes(profileDir)) profiles.push(profileDir);
  const domain = new DomainService({ profileDir, simulate, stepMs: STEP_MS });
  services.push(domain);
  return domain;
}

function reopen(domain: DomainService, simulate: SimulateMode = "async") {
  domain.dispose();
  return open(domain.profileDir, simulate);
}

function runOf(domain: DomainService, runId: string): RunRecord {
  return (domain.query({ name: "run.show", projectId: PROJECT, input: { runId } }) as { run: RunRecord }).run;
}

function eventsOf(domain: DomainService, runId: string) {
  return domain.eventsSince(PROJECT, 0).filter(event => event.runId === runId);
}

async function start(domain: DomainService) {
  const task = await command(domain, "task.create", { title: "重启恢复", acceptance: [{ id: "proof", text: "保留原执行证据", required: true }] });
  const input = { trackerId: task.trackerId };
  const result = await command(domain, "run.start", input, { idempotencyKey: "start-once" });
  return { runId: result.runId!, input };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  services.splice(0).forEach(domain => domain.dispose());
  profiles.splice(0).forEach(profile => rmSync(profile, { recursive: true, force: true }));
  vi.useRealTimers();
});

describe("demo service recovery from persisted execution checkpoints", () => {
  it.each(["accepted", "executing", "verifying"] as const)("resumes %s in the same run without replaying committed progress", async status => {
    let domain = open();
    const { runId, input } = await start(domain);
    const steps = { accepted: 0, executing: 1, verifying: 2 }[status];
    await vi.advanceTimersByTimeAsync(STEP_MS * steps);
    const before = structuredClone(runOf(domain, runId));
    const beforeEvents = structuredClone(eventsOf(domain, runId));
    expect(before.status).toBe(status);

    domain = reopen(domain);
    expect(runOf(domain, runId)).toEqual(before);
    const replay = await command(domain, "run.start", input, { idempotencyKey: "start-once" });
    expect(replay).toMatchObject({ commandStatus: "replayed", runId });
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);

    const recovered = runOf(domain, runId);
    expect(recovered.status).toBe("review_required");
    expect(recovered).toMatchObject({ id: before.id, taskId: before.taskId, attempt: before.attempt, inputSnapshotId: before.inputSnapshotId, executionFence: before.executionFence, startedAt: before.startedAt });
    expect(recovered.messages).toHaveLength(1);
    expect(recovered.verification.every(item => item.state === "passed")).toBe(true);
    expect(domain.store.data.runs.filter(run => run.taskId === recovered.taskId)).toHaveLength(1);
    const events = structuredClone(eventsOf(domain, runId));
    expect(events.slice(0, beforeEvents.length)).toEqual(beforeEvents);
    expect(events.map(event => event.type)).toEqual(["run.accepted", "run.started", "message.delta", "tool.started", "tool.finished", "verification.updated"]);
    expect(new Set(events.map(event => event.eventId)).size).toBe(events.length);

    domain = reopen(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    expect(eventsOf(domain, runId)).toEqual(events);
    expect(runOf(domain, runId).status).toBe("review_required");
  });

  it.each([0, 1, 2])("keeps input pending and resumes the saved checkpoint after an answer (step %i)", async steps => {
    let domain = open();
    const { runId } = await start(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * steps);
    await command(domain, "demo.inject", { runId, scenario: "waiting_input" });
    const pending = structuredClone(runOf(domain, runId));
    const beforeEvents = structuredClone(eventsOf(domain, runId));

    domain = reopen(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    expect(runOf(domain, runId)).toEqual(pending);
    expect(eventsOf(domain, runId)).toEqual(beforeEvents);

    await command(domain, "run.respond", { runId, requestId: pending.inputRequests[0].id, text: "确认范围" });
    domain = reopen(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    const resumed = runOf(domain, runId);
    expect(resumed.status).toBe("review_required");
    expect(resumed.inputRequests[0]).toMatchObject({ answered: true, answer: "确认范围" });
    expect(resumed.messages.filter(message => message.role === "user")).toHaveLength(1);
    for (const type of ["run.accepted", "run.started", "tool.started", "tool.finished", "verification.updated", "input.requested"]) {
      expect(eventsOf(domain, runId).filter(event => event.type === type), type).toHaveLength(1);
    }
  });

  it.each(["cancel_requested", "lost"] as const)("preserves %s until explicit reconciliation", async status => {
    let domain = open();
    const { runId, input } = await start(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS);
    if (status === "cancel_requested") await command(domain, "run.cancel", { runId });
    else await command(domain, "demo.inject", { runId, scenario: "lost" });
    const before = structuredClone(runOf(domain, runId));
    const events = structuredClone(eventsOf(domain, runId));
    domain = reopen(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    expect(runOf(domain, runId)).toEqual(before);
    expect(eventsOf(domain, runId)).toEqual(events);
    await expect(command(domain, "run.retry", input)).rejects.toMatchObject({ code: "RUN_ACTIVE" });
    await command(domain, "run.reconcile", { runId, resolution: "cancelled" });
    expect(runOf(domain, runId).status).toBe("cancelled");
    expect(eventsOf(domain, runId).filter(event => event.type === "run.started")).toHaveLength(1);
  });

  it("does not advance presentation fixtures or opt-out simulations", async () => {
    let domain = open();
    const seeded = structuredClone(domain.store.data.runs);
    const { runId } = await start(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 2);
    const before = structuredClone(runOf(domain, runId));
    const events = structuredClone(eventsOf(domain, runId));
    domain = reopen(domain, "off");
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    expect(runOf(domain, runId)).toEqual(before);
    expect(eventsOf(domain, runId)).toEqual(events);
    domain = reopen(domain);
    await vi.advanceTimersByTimeAsync(STEP_MS * 4);
    expect(runOf(domain, runId).status).toBe("review_required");
    expect(domain.store.data.runs.filter(run => seeded.some(fixture => fixture.id === run.id))).toEqual(seeded);
    expect(domain.eventsSince(PROJECT, 0).filter(event => seeded.some(fixture => fixture.id === event.runId))).toEqual([]);
  });
});
