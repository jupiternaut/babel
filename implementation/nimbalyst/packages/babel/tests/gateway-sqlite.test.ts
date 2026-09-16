import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewaySqliteStore, newDeliveryId } from "../src/gateway/sqlite-store.ts";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function profile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "babel-gateway-"));
  temps.push(dir);
  return dir;
}

describe("GatewaySqliteStore", () => {
  it("applies migrations once and keeps identities", () => {
    const dir = profile();
    const store = new GatewaySqliteStore(dir);
    expect(store.migrate()).toBe(0);
    store.putIdentity({
      actorId: "user-1",
      kind: "cli",
      projectIds: ["fixture-project-babel"],
      roles: ["operator"],
    });
    const identity = store.getIdentity("user-1");
    expect(identity?.projectIds).toEqual(["fixture-project-babel"]);
    store.assertProjectAccess(identity!, "fixture-project-babel", true);
    expect(() => store.assertProjectAccess(identity!, "other", true)).toThrow(/无权/);
    store.close();
  });

  it("rolls back a failed transaction and rejects conflicting idempotency keys", () => {
    const store = new GatewaySqliteStore(profile());
    try {
      store.transaction(() => {
        store.putIdempotency({
          key: "k1",
          actorId: "a",
          projectId: "p",
          command: "task.update",
          payload: { title: "one" },
          result: { ok: true },
        });
        throw new Error("boom");
      });
    } catch (error) {
      expect((error as Error).message).toBe("boom");
    }
    expect(store.getIdempotency("k1")).toBeNull();
    store.putIdempotency({
      key: "k1",
      actorId: "a",
      projectId: "p",
      command: "task.update",
      payload: { title: "one" },
      result: { ok: true, revision: 2 },
    });
    store.putIdempotency({
      key: "k1",
      actorId: "a",
      projectId: "p",
      command: "task.update",
      payload: { title: "one" },
      result: { ignored: true },
    });
    expect(JSON.parse(store.getIdempotency("k1")!.resultJson).revision).toBe(2);
    expect(() => store.putIdempotency({
      key: "k1",
      actorId: "a",
      projectId: "p",
      command: "task.update",
      payload: { title: "two" },
      result: {},
    })).toThrow(/幂等/);
    store.close();
  });

  it("appends events, resumes from cursor, and retries outbox without rerunning the command", () => {
    const store = new GatewaySqliteStore(profile());
    const first = store.appendEvent({
      eventId: "evt-1",
      projectId: "p",
      trackerId: "trk-1",
      runId: null,
      type: "task.updated",
      streamId: "p:trk-1",
      payloadJson: JSON.stringify({ title: "A" }),
      occurredAt: "2026-09-14T16:00:00Z",
      correlationId: "c1",
    });
    store.appendEvent({
      eventId: "evt-2",
      projectId: "p",
      trackerId: "trk-1",
      runId: null,
      type: "task.updated",
      streamId: "p:trk-1",
      payloadJson: JSON.stringify({ title: "B" }),
      occurredAt: "2026-09-14T16:00:01Z",
      correlationId: "c2",
    });
    expect(store.listEventsSince(first.cursor).map((row) => row.eventId)).toEqual(["evt-2"]);
    const deliveryId = newDeliveryId();
    store.enqueueOutbox({
      deliveryId,
      eventId: "evt-1",
      hookId: "observe-ok",
      maxAttempts: 3,
      nextRetryAt: "2026-09-14T16:00:00Z",
    });
    const pending = store.claimPendingOutbox("2026-09-14T16:00:00Z");
    expect(pending).toHaveLength(1);
    store.markOutbox(deliveryId, "failed", "hook crashed", "2026-09-14T16:00:05Z");
    expect(store.claimPendingOutbox("2026-09-14T16:00:00Z")).toHaveLength(0);
    const retried = store.claimPendingOutbox("2026-09-14T16:00:05Z");
    expect(retried).toHaveLength(1);
    expect(retried[0]?.attempts).toBe(1);
    expect(store.listEventsSince(0).map((row) => row.eventId)).toEqual(["evt-1", "evt-2"]);
    store.close();
  });

  it("refuses a second live worker lease for the same runId", () => {
    const store = new GatewaySqliteStore(profile());
    const lease = {
      leaseId: "lease-1",
      runId: "run-1",
      trackerId: "trk-1",
      projectId: "p",
      workerId: "worker-a",
      protocol: "protocol-double" as const,
      worktree: "/tmp/wt",
      startedAt: "2026-09-14T16:00:00Z",
    };
    store.acquireLease(lease);
    expect(() => store.acquireLease({ ...lease, leaseId: "lease-2" })).toThrow(/双执行/);
    store.releaseLease("run-1", "2026-09-14T16:01:00Z");
    store.close();
  });

  it("restores a backup into a new profile", () => {
    const source = profile();
    const store = new GatewaySqliteStore(source);
    store.putIdentity({ actorId: "restored", kind: "system", projectIds: ["p"], roles: ["admin"] });
    const backup = path.join(source, "backup.sqlite");
    store.backupTo(backup);
    store.close();
    const dest = profile();
    const restored = GatewaySqliteStore.restoreFrom(backup, dest);
    expect(restored.getIdentity("restored")?.roles).toEqual(["admin"]);
    restored.close();
  });
});
