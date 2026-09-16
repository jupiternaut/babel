import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayCommandEnvelope, GatewayIdentity } from "../src/gateway/contracts.ts";
import { GATEWAY_PROTOCOL } from "../src/gateway/contracts.ts";
import { GatewaySqliteStore } from "../src/gateway/sqlite-store.ts";
import { eventsFromStore } from "../src/worker/journal.ts";
import { getStoredLease } from "../src/worker/lease-query.ts";
import { ManagedWorker, REAL_PI_BLOCKED_REASON } from "../src/worker/managed-worker.ts";
import { WORKER_SCRATCH_ROOT } from "../src/worker/paths.ts";

const temps: Array<{ dir: string; worker?: ManagedWorker; store?: GatewaySqliteStore }> = [];

afterEach(() => {
  while (temps.length) {
    const item = temps.pop();
    item?.worker?.dispose();
    item?.store?.close();
    if (item?.dir) rmSync(item.dir, { recursive: true, force: true });
  }
});

function scratch(label: string): string {
  const dir = path.join(WORKER_SCRATCH_ROOT, "lr-07-tests", `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return dir;
}

function open(label: string, executorKind: "protocol-double" | "pi-sim" = "protocol-double") {
  const dir = scratch(label);
  const store = new GatewaySqliteStore(path.join(dir, "profile"));
  const worker = new ManagedWorker(store, {
    workerId: `worker-${label}`,
    isolationRoot: dir,
    executorKind,
  });
  temps.push({ dir, worker, store });
  return { dir, store, worker };
}

const actor: GatewayIdentity = {
  actorId: "cli-test",
  kind: "cli",
  projectIds: ["proj-worker"],
  roles: ["operator"],
};

function envelope(name: string, input: Record<string, unknown>, extra: Partial<GatewayCommandEnvelope> = {}): GatewayCommandEnvelope {
  return {
    name,
    projectId: "proj-worker",
    input,
    actor,
    correlationId: extra.correlationId ?? `corr-${name}`,
    idempotencyKey: extra.idempotencyKey,
  };
}

describe("ManagedWorker lifecycle (protocol-double)", () => {
  it("start command records log/message/tool/diff/artifact and a live lease", async () => {
    const { worker, store } = open("start");
    const accepted = await worker.command(envelope("worker.start", {
      runId: "run-life-1",
      trackerId: "trk-1",
      protocol: "protocol-double",
    }));
    expect(accepted.ok).toBe(true);
    expect(accepted.mode).toBe("offline");
    expect(accepted.protocol).toBe(GATEWAY_PROTOCOL);
    expect(accepted.realPi).toBe(false);
    expect(accepted.result.executorKind).toBe("protocol-double");

    const events = worker.query("worker.events", { runId: "run-life-1" });
    const kinds = (events.events as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["log", "message", "tool", "diff", "artifact"]));
    expect((events.events as Array<{ payload: { message?: string } }>).some((event) => String(event.payload.message ?? "").includes("not a real Pi"))).toBe(true);

    const stored = eventsFromStore(store, "run-life-1");
    expect(stored.events.map((event) => event.kind)).toEqual(kinds);

    const leaseQuery = worker.query("worker.lease", { runId: "run-life-1", projectId: "proj-worker" });
    expect(leaseQuery.live).toBe(true);
    expect(getStoredLease(store, "run-life-1")?.leaseId).toBe((accepted.result.lease as { leaseId: string }).leaseId);
    expect((leaseQuery.lease as { protocol: string; worktree: string }).protocol).toBe("protocol-double");
    expect(String((leaseQuery.lease as { worktree: string }).worktree).startsWith(WORKER_SCRATCH_ROOT)).toBe(true);
    expect(existsSync(path.join(String(accepted.result.worktree), "src", "hello.txt"))).toBe(true);
    expect(existsSync(path.join(String(accepted.result.worktree), "artifacts", "result.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(String(accepted.result.worktree), "artifacts", "result.json"), "utf8")).realPi).toBe(false);
    expect((accepted.result.fence as { fence: number }).fence).toBe(1);
    expect(store.getIdentity("worker-start")?.kind).toBe("worker");
  });

  it("message and record commands append queryable events without a second lease", async () => {
    const { worker, store } = open("record");
    await worker.command(envelope("worker.start", { runId: "run-life-2", trackerId: "trk-2" }));
    await worker.command(envelope("worker.message", { runId: "run-life-2", text: "补充一句" }));
    await worker.command(envelope("worker.record", { runId: "run-life-2", kind: "tool", name: "apply_patch" }));
    await worker.command(envelope("worker.record", { runId: "run-life-2", kind: "diff" }));
    await worker.command(envelope("worker.record", { runId: "run-life-2", kind: "artifact" }));

    const events = worker.query("worker.events", { runId: "run-life-2" });
    const kinds = (events.events as Array<{ kind: string }>).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "message").length).toBeGreaterThanOrEqual(2);
    expect(kinds).toEqual(expect.arrayContaining(["tool", "diff", "artifact"]));
    expect(getStoredLease(store, "run-life-2")?.releasedAt).toBeNull();
    expect(listLiveCount(store, "run-life-2")).toBe(1);
  });

  it("cancel command yields cancel_ack and releases the lease", async () => {
    const { worker, store } = open("cancel");
    await worker.command(envelope("worker.start", { runId: "run-life-3", trackerId: "trk-3" }));
    const cancelled = await worker.command(envelope("worker.cancel", { runId: "run-life-3" }));
    expect(cancelled.settled).toBe(true);
    expect((cancelled.result.ack as { kind: string; payload: { confirmed: boolean } }).kind).toBe("cancel_ack");
    expect((cancelled.result.ack as { payload: { confirmed: boolean } }).payload.confirmed).toBe(true);

    const events = worker.query("worker.events", { runId: "run-life-3" });
    expect((events.events as Array<{ kind: string }>).some((event) => event.kind === "cancel_ack")).toBe(true);
    const lease = worker.query("worker.lease", { runId: "run-life-3" });
    expect(lease.live).toBe(false);
    expect(getStoredLease(store, "run-life-3")?.releasedAt).toBeTruthy();
  });

  it("replays the same start idempotency key and rejects a second live start", async () => {
    const { worker } = open("idem");
    const first = await worker.command(envelope("worker.start", { runId: "run-life-4", trackerId: "trk-4" }, { idempotencyKey: "start-once" }));
    const replay = await worker.command(envelope("worker.start", { runId: "run-life-4", trackerId: "trk-4" }, { idempotencyKey: "start-once" }));
    expect(replay.commandStatus).toBe("replayed");
    expect((replay.result.lease as { leaseId: string }).leaseId).toBe((first.result.lease as { leaseId: string }).leaseId);
    expect(() => worker.command(envelope("worker.start", { runId: "run-life-4", trackerId: "trk-4" }))).toThrow(/双执行/);
    try {
      worker.command(envelope("worker.start", { runId: "run-life-4", trackerId: "trk-4" }));
    } catch (error) {
      expect((error as Error).name).toBe("RUN_ACTIVE");
    }
  });
});

function listLiveCount(store: GatewaySqliteStore, runId: string): number {
  const lease = getStoredLease(store, runId);
  return lease && !lease.releasedAt ? 1 : 0;
}
