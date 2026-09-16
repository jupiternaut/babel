import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCommandEnvelope, GatewayIdentity } from "../src/gateway/contracts.ts";
import { GATEWAY_PROTOCOL } from "../src/gateway/contracts.ts";
import { GatewaySqliteStore } from "../src/gateway/sqlite-store.ts";
import { getStoredLease } from "../src/worker/lease-query.ts";
import { ManagedWorker, REAL_PI_BLOCKED_REASON } from "../src/worker/managed-worker.ts";
import { WORKER_SCRATCH_ROOT, assertIsolatedPath } from "../src/worker/paths.ts";

const temps: Array<{ dir: string; worker?: ManagedWorker; store?: GatewaySqliteStore }> = [];

afterEach(() => {
  while (temps.length) {
    const item = temps.pop();
    item?.worker?.dispose();
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

function open(label: string, executorKind: "protocol-double" | "pi-sim" = "pi-sim") {
  const dir = path.join(WORKER_SCRATCH_ROOT, "lr-07-tests", `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const store = new GatewaySqliteStore(path.join(dir, "profile"));
  const worker = new ManagedWorker(store, { workerId: `worker-${label}`, isolationRoot: dir, executorKind });
  temps.push({ dir, worker, store });
  return { dir, store, worker };
}

describe("local synthetic executor and real Pi block", () => {
  it("pi-sim child emits the protocol events and confirms cancel", async () => {
    const { worker, store } = open("child");
    const accepted = await worker.command(envelope("worker.start", {
      runId: "run-sim-1",
      trackerId: "trk-sim",
      protocol: "pi-sim",
    }));
    expect(accepted.protocol).toBe(GATEWAY_PROTOCOL);
    expect(accepted.realPi).toBe(false);
    expect(accepted.result.executorKind).toBe("pi-sim");
    expect(String(accepted.result.worktree).startsWith(WORKER_SCRATCH_ROOT)).toBe(true);
    expect(existsSync(path.join(String(accepted.result.worktree), "src", "hello.txt"))).toBe(true);

    const events = worker.query("worker.events", { runId: "run-sim-1" });
    const kinds = (events.events as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["log", "message", "tool", "diff", "artifact"]));
    expect(getStoredLease(store, "run-sim-1")?.protocol).toBe("pi-sim");
    expect(getStoredLease(store, "run-sim-1")?.releasedAt).toBeNull();

    await worker.command(envelope("worker.message", { runId: "run-sim-1", text: "你好" }));
    const cancelled = await worker.command(envelope("worker.cancel", { runId: "run-sim-1" }));
    expect((cancelled.result.ack as { kind: string }).kind).toBe("cancel_ack");
    expect(worker.query("worker.lease", { runId: "run-sim-1" }).live).toBe(false);
  }, 15000);

  it("killing the pi-sim child keeps one lease and reconnect does not respawn", async () => {
    const { worker, store } = open("child-crash");
    const started = await worker.command(envelope("worker.start", {
      runId: "run-sim-3",
      trackerId: "trk-sim",
      protocol: "pi-sim",
    }));
    const leaseId = (started.result.lease as { leaseId: string }).leaseId;
    worker.simulateCrash("run-sim-3");
    expect(getStoredLease(store, "run-sim-3")?.releasedAt).toBeNull();
    const again = await worker.command(envelope("worker.reconnect", { runId: "run-sim-3" }));
    expect(again.result.reused).toBe(true);
    expect(again.result.processAlive).toBe(false);
    expect((again.result.lease as { leaseId: string }).leaseId).toBe(leaseId);
    expect((again.result.fence as { fence: number }).fence).toBe(1);
    expect(() => worker.command(envelope("worker.start", { runId: "run-sim-3", trackerId: "trk-sim", protocol: "pi-sim" }))).toThrow(/双执行/);
  }, 15000);

  it("refuses protocol=pi and does not treat the stand-in as a real Pi", async () => {
    const { worker } = open("nopi", "protocol-double");
    expect(() => worker.command(envelope("worker.start", {
      runId: "run-sim-2",
      trackerId: "trk-sim",
      protocol: "pi",
    }))).toThrow(REAL_PI_BLOCKED_REASON);
    try {
      worker.command(envelope("worker.start", { runId: "run-sim-2", trackerId: "trk-sim", protocol: "pi" }));
    } catch (error) {
      expect((error as Error).name).toBe("UNAVAILABLE");
    }
    expect(worker.query("worker.lease", { runId: "run-sim-2" }).lease).toBeNull();
  });

  it("rejects a worktree outside the isolated scratch", () => {
    expect(() => assertIsolatedPath("C:\\Users\\gengr\\Downloads\\nimbalyst", "worktree")).toThrow(/隔离目录/);
  });
});
