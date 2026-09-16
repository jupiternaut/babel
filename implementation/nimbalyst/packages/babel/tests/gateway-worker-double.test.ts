import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewaySqliteStore } from "../src/gateway/sqlite-store.ts";
import { ProtocolDoubleWorker } from "../src/gateway/worker-double.ts";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("ProtocolDoubleWorker", () => {
  it("reconnects without a second live lease", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "babel-double-"));
    temps.push(dir);
    const store = new GatewaySqliteStore(dir);
    const worker = new ProtocolDoubleWorker("worker-test");
    const lease = worker.start(store, {
      runId: "run-double-1",
      trackerId: "trk-1",
      projectId: "p",
      worktree: dir,
    });
    const again = worker.reconnect(store, lease);
    expect(again.runId).toBe(lease.runId);
    expect(worker.listEvents(lease.runId).some((event) => String(event.payload.message).includes("second execution"))).toBe(true);
    const ack = worker.cancel(store, lease.runId);
    expect(ack.kind).toBe("cancel_ack");
    store.close();
  });
});
