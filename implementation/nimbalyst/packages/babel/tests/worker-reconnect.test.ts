import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCommandEnvelope, GatewayIdentity } from "../src/gateway/contracts.ts";
import { GatewaySqliteStore } from "../src/gateway/sqlite-store.ts";
import { getStoredLease, listStoredLeases } from "../src/worker/lease-query.ts";
import { ManagedWorker } from "../src/worker/managed-worker.ts";
import { WORKER_SCRATCH_ROOT, fencePath } from "../src/worker/paths.ts";

const temps: Array<{ dir: string; workers: ManagedWorker[]; store?: GatewaySqliteStore }> = [];

afterEach(() => {
  while (temps.length) {
    const item = temps.pop();
    for (const worker of item?.workers ?? []) worker.dispose();
    item?.store?.close();
    if (item?.dir) rmSync(item.dir, { recursive: true, force: true });
  }
});

const actor: GatewayIdentity = {
  actorId: "cli-test",
  kind: "cli",
  projectIds: ["proj-worker"],
  roles: ["operator"],
};

function envelope(name: string, input: Record<string, unknown>): GatewayCommandEnvelope {
  return { name, projectId: "proj-worker", input, actor, correlationId: `corr-${name}` };
}

function open(label: string) {
  const dir = path.join(WORKER_SCRATCH_ROOT, "lr-07-tests", `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const store = new GatewaySqliteStore(path.join(dir, "profile"));
  const worker = new ManagedWorker(store, { workerId: `worker-${label}`, isolationRoot: dir });
  const bag = { dir, store, workers: [worker] };
  temps.push(bag);
  return bag;
}

describe("ManagedWorker crash and reconnect", () => {
  it("crash keeps the live lease and reconnect does not start a second execution", async () => {
    const bag = open("crash");
    const { worker, store } = { worker: bag.workers[0]!, store: bag.store! };
    const started = await worker.command(envelope("worker.start", { runId: "run-re-1", trackerId: "trk-1" }));
    const fenceBefore = (started.result.fence as { fence: number; leaseId: string }).fence;
    const leaseId = (started.result.lease as { leaseId: string }).leaseId;

    const lost = worker.simulateCrash("run-re-1");
    expect(lost.kind).toBe("lost");
    expect(getStoredLease(store, "run-re-1")?.releasedAt).toBeNull();

    const reattached = await worker.command(envelope("worker.reconnect", { runId: "run-re-1" }));
    expect(reattached.result.reused).toBe(true);
    expect(reattached.result.processAlive).toBe(false);
    expect((reattached.result.lease as { leaseId: string }).leaseId).toBe(leaseId);
    expect((reattached.result.fence as { fence: number }).fence).toBe(fenceBefore);

    const events = worker.query("worker.events", { runId: "run-re-1" });
    expect((events.events as Array<{ payload: { message?: string } }>).some((event) => String(event.payload.message ?? "").includes("did not start a second execution"))).toBe(true);
    expect(listStoredLeases(store, "proj-worker").filter((row) => !row.releasedAt)).toHaveLength(1);
    expect(() => worker.command(envelope("worker.start", { runId: "run-re-1", trackerId: "trk-1" }))).toThrow(/双执行/);
  });

  it("a new worker process reuses the stored lease without incrementing the fence", async () => {
    const bag = open("newproc");
    const first = bag.workers[0]!;
    const { store, dir } = bag;
    await first.command(envelope("worker.start", { runId: "run-re-2", trackerId: "trk-2" }));
    first.simulateCrash("run-re-2");
    first.dispose();

    const second = new ManagedWorker(store!, { workerId: "worker-newproc", isolationRoot: dir });
    bag.workers.push(second);
    const again = await second.command(envelope("worker.reconnect", { runId: "run-re-2" }));
    expect(again.result.reused).toBe(true);
    expect((again.result.fence as { fence: number }).fence).toBe(1);
    const show = second.query("worker.show", { runId: "run-re-2" });
    expect(show.live).toBe(true);
    expect(show.processAlive).toBe(false);
    expect(show.realPi).toBe(false);
    expect(JSON.parse(readFileSync(fencePath(String(show.worktree)), "utf8")).fence).toBe(1);
    expect(listStoredLeases(store!, "proj-worker")).toHaveLength(1);
  });

  it("reconnect while the process is still alive does not spawn a second executor", async () => {
    const bag = open("alive");
    const worker = bag.workers[0]!;
    await worker.command(envelope("worker.start", { runId: "run-re-3", trackerId: "trk-3" }));
    const again = await worker.command(envelope("worker.reconnect", { runId: "run-re-3" }));
    expect(again.result.reused).toBe(true);
    expect(again.result.processAlive).toBe(true);
    const events = worker.query("worker.events", { runId: "run-re-3" });
    expect((events.events as Array<{ payload: { message?: string } }>).some((event) => String(event.payload.message ?? "").includes("same live process"))).toBe(true);
    expect(worker.query("worker.lease", { runId: "run-re-3" }).live).toBe(true);
  });
});
