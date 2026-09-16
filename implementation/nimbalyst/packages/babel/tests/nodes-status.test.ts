import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdjustableClock,
  NODE_COLLECTION_INTERVAL_SECONDS,
  NODES_SCRATCH_ROOT,
  PLATFORM_SERVICE,
  SyntheticNodeHost,
} from "../src/nodes/index.ts";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function open(label: string, clock = new AdjustableClock()) {
  const isolationRoot = path.join(
    NODES_SCRATCH_ROOT,
    "lr-12-tests",
    `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temps.push(isolationRoot);
  const host = new SyntheticNodeHost({ isolationRoot, clock });
  return { host, clock, isolationRoot };
}

describe("三平台节点状态模型（合成）", () => {
  it("Windows / Ubuntu / macOS 使用同一套分层字段，服务机制分开", () => {
    const { host } = open("platforms");
    host.command("node.register", { nodeId: "node-win", platform: "windows" });
    host.command("node.register", { nodeId: "node-ubuntu", platform: "ubuntu" });
    host.command("node.register", { nodeId: "node-mac", platform: "macos" });

    const listed = host.query("node.list") as { realMachine: boolean; snapshots: Array<{ platform: string; serviceKind: string; layers: { ssh: unknown; worker: unknown; agent: unknown } }> };
    expect(listed.realMachine).toBe(false);
    expect(listed.snapshots.map((row) => row.platform)).toEqual(["node-win", "node-ubuntu", "node-mac"].map((_, i) => ["windows", "ubuntu", "macos"][i]));
    expect(listed.snapshots.map((row) => row.serviceKind)).toEqual([
      PLATFORM_SERVICE.windows,
      PLATFORM_SERVICE.ubuntu,
      PLATFORM_SERVICE.macos,
    ]);
    for (const row of listed.snapshots) {
      expect(row.layers).toHaveProperty("ssh");
      expect(row.layers).toHaveProperty("worker");
      expect(row.layers).toHaveProperty("agent");
      expect(row.layers.ssh).toMatchObject({ kind: "unknown" });
    }
  });

  it("SSH 可达且 Worker 不可用时不能启动（DEVICE-01）", () => {
    const { host } = open("device-01");
    host.command("node.register", {
      nodeId: "node-ubuntu",
      platform: "ubuntu",
      layers: { ssh: "reachable", worker: "unavailable", agent: "unknown" },
    });
    host.command("node.collect", { nodeId: "node-ubuntu" });

    const snapshot = (host.query("node.snapshot", { nodeId: "node-ubuntu" }).snapshot) as {
      layers: { ssh: { kind: string; note: string }; worker: { kind: string; note: string } };
    };
    expect(snapshot.layers.ssh.kind).toBe("reachable");
    expect(snapshot.layers.worker.kind).toBe("unavailable");
    expect(snapshot.layers.ssh.note).toMatch(/不等于 Worker/);
    expect(snapshot.layers.worker.note).toMatch(/即使 SSH 可达也不能启动/);

    expect(() => host.command("node.try_start", {
      nodeId: "node-ubuntu",
      runId: "run-1",
      trackerId: "trk-1",
      projectId: "proj-1",
    })).toThrow(/不能启动/);

    try {
      host.command("node.try_start", {
        nodeId: "node-ubuntu",
        runId: "run-1",
        trackerId: "trk-1",
        projectId: "proj-1",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("UNAVAILABLE");
    }

    const events = (host.query("node.events", { nodeId: "node-ubuntu" }).events) as Array<{ kind: string }>;
    expect(events.map((event) => event.kind)).toContain("start_rejected");
    expect(host.query("node.run", { runId: "run-1" }).binding).toBeNull();
  });

  it("SSH 不可达但 Worker 可用时可以启动，进程不依赖 SSH 查询连接", () => {
    const { host } = open("ssh-down-worker-up");
    host.command("node.register", {
      nodeId: "node-win",
      platform: "windows",
      layers: { ssh: "unreachable", worker: "available", agent: "idle" },
    });
    host.command("node.collect", { nodeId: "node-win" });
    const started = host.command("node.try_start", {
      nodeId: "node-win",
      runId: "run-win",
      trackerId: "trk-win",
      projectId: "proj-win",
    });
    expect(started.ok).toBe(true);
    expect(started.realMachine).toBe(false);
    expect(started.result.cancelled).toBe(false);
    const replay = host.command("node.try_start", {
      nodeId: "node-win",
      runId: "run-win",
      trackerId: "trk-win",
      projectId: "proj-win",
    });
    expect(replay.result.startedAt).toBe(started.result.startedAt);
    const snapshot = (host.query("node.show", { nodeId: "node-win" }).snapshot) as {
      layers: { ssh: { kind: string }; worker: { kind: string }; agent: { kind: string } };
    };
    expect(snapshot.layers.ssh.kind).toBe("unreachable");
    expect(snapshot.layers.worker.kind).toBe("available");
    expect(snapshot.layers.agent.kind).toBe("idle");
  });

  it("采集 freshness：未知 / 新鲜 / 过期，过期不推断离线或 Agent 已停止", () => {
    const clock = new AdjustableClock("2026-09-14T16:00:00.000Z");
    const { host } = open("freshness", clock);
    host.command("node.register", {
      nodeId: "node-mac",
      platform: "macos",
      layers: { ssh: "reachable", worker: "available", agent: "available" },
    });
    const unknown = (host.query("node.snapshot", { nodeId: "node-mac" }).snapshot) as {
      freshness: string;
      freshnessNote: string;
      snapshotRevision: number;
    };
    expect(unknown.freshness).toBe("unknown");
    expect(unknown.freshnessNote).toMatch(/不能推断/);
    expect(unknown.snapshotRevision).toBe(0);

    const collected = host.command("node.collect", { nodeId: "node-mac" });
    const fresh = collected.result.snapshot as { freshness: string; snapshotRevision: number };
    expect(fresh.freshness).toBe("fresh");
    expect(fresh.snapshotRevision).toBe(1);

    host.command("node.fail_collect", { nodeId: "node-mac" });
    clock.advance(151_000);
    const stale = (host.query("node.snapshot", { nodeId: "node-mac" }).snapshot) as {
      freshness: string;
      freshnessNote: string;
      snapshotRevision: number;
      layers: { agent: { kind: string; note: string } };
    };
    expect(stale.freshness).toBe("stale");
    expect(stale.freshnessNote).toMatch(/不能推断离线或 Agent 已停止/);
    expect(stale.snapshotRevision).toBe(1);
    expect(stale.layers.agent.kind).toBe("available");
    expect(stale.layers.agent.note).not.toMatch(/已停止$/);
  });

  it("60 秒调度：手动采集 A 不改 B 的下次到期", () => {
    const clock = new AdjustableClock("2026-09-14T16:00:00.000Z");
    const { host } = open("schedule", clock);
    host.command("node.register", { nodeId: "node-a", platform: "ubuntu", layers: { ssh: "reachable" } });
    host.command("node.register", { nodeId: "node-b", platform: "windows", layers: { ssh: "reachable" } });
    host.command("node.collect", { nodeId: "node-a" });

    const due = host.command("node.collect_due");
    const collectedIds = (due.result.snapshots as Array<{ nodeId: string }>).map((row) => row.nodeId);
    expect(collectedIds).toEqual(["node-b"]);

    const snapA = (host.query("node.show", { nodeId: "node-a" }).snapshot) as { nextDueAt: string; snapshotRevision: number };
    const snapB = (host.query("node.show", { nodeId: "node-b" }).snapshot) as { nextDueAt: string; snapshotRevision: number };
    expect(snapA.snapshotRevision).toBe(1);
    expect(snapB.snapshotRevision).toBe(1);
    expect(Date.parse(snapA.nextDueAt)).toBe(Date.parse("2026-09-14T16:00:00.000Z") + NODE_COLLECTION_INTERVAL_SECONDS * 1000);
    expect(Date.parse(snapB.nextDueAt)).toBe(Date.parse(snapA.nextDueAt));

    clock.advance(NODE_COLLECTION_INTERVAL_SECONDS * 1000);
    const second = host.command("node.collect_due");
    expect((second.result.snapshots as Array<{ nodeId: string }>).map((row) => row.nodeId).sort()).toEqual(["node-a", "node-b"]);
  });

  it("Agent 失联不是已停止，核对前拒绝启动", () => {
    const { host } = open("agent-lost");
    host.command("node.register", {
      nodeId: "node-ubuntu",
      platform: "ubuntu",
      layers: { ssh: "reachable", worker: "available", agent: "lost" },
    });
    host.command("node.collect", { nodeId: "node-ubuntu" });
    const snapshot = (host.query("node.snapshot", { nodeId: "node-ubuntu" }).snapshot) as {
      layers: { agent: { kind: string; note: string } };
    };
    expect(snapshot.layers.agent.kind).toBe("lost");
    expect(snapshot.layers.agent.note).toMatch(/失联不是已停止/);
    expect(() => host.command("node.try_start", {
      nodeId: "node-ubuntu",
      runId: "run-lost",
      trackerId: "trk-lost",
      projectId: "proj-lost",
    })).toThrow(/核对/);
    expect(host.query("node.run", { runId: "run-lost" }).binding).toBeNull();
  });
});
