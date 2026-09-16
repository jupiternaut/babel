import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NODES_SCRATCH_ROOT, SyntheticNodeHost } from "../src/nodes/index.ts";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function open(label: string) {
  const isolationRoot = path.join(
    NODES_SCRATCH_ROOT,
    "lr-12-tests",
    `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temps.push(isolationRoot);
  const host = new SyntheticNodeHost({ isolationRoot });
  return { host, isolationRoot };
}

describe("断线负例（合成，不是真机 SSH）", () => {
  it("断开 SSH 后只读引用失败，已绑定 run 不取消", () => {
    const { host } = open("disconnect-run");
    host.command("node.register", {
      nodeId: "node-ubuntu",
      platform: "ubuntu",
      layers: { ssh: "reachable", worker: "available", agent: "idle" },
      seedFiles: { "notes/readme.txt": "keep\n" },
    });
    host.command("node.collect", { nodeId: "node-ubuntu" });
    host.command("node.try_start", {
      nodeId: "node-ubuntu",
      runId: "run-keep",
      trackerId: "trk-keep",
      projectId: "proj-keep",
    });
    const before = host.command("node.attach", { nodeId: "node-ubuntu", relativePath: "notes/readme.txt" });
    expect(before.result.readonly).toBe(true);

    const disconnected = host.command("node.disconnect", { nodeId: "node-ubuntu" });
    expect(disconnected.result.bindingCancelled).toBe(false);
    expect((host.query("node.session", { nodeId: "node-ubuntu" }).connected)).toBe(false);

    expect(() => host.resolveFile("node-ubuntu", "notes/readme.txt")).toThrow(/已断开/);
    try {
      host.resolveFile("node-ubuntu", "notes/readme.txt");
    } catch (error) {
      expect((error as Error).name).toBe("DISCONNECTED");
    }

    const binding = host.query("node.run", { runId: "run-keep" }).binding as { cancelled: boolean; runId: string };
    expect(binding.runId).toBe("run-keep");
    expect(binding.cancelled).toBe(false);

    const events = (host.query("node.events", { nodeId: "node-ubuntu" }).events) as Array<{ kind: string; payload: { cancelledRuns?: boolean } }>;
    expect(events.some((event) => event.kind === "disconnected" && event.payload.cancelledRuns === false)).toBe(true);
  });

  it("断线后 SSH 与 Worker / Agent 分层仍分开，不把 Worker 写成已停止", () => {
    const { host } = open("disconnect-layers");
    host.command("node.register", {
      nodeId: "node-mac",
      platform: "macos",
      layers: { ssh: "reachable", worker: "available", agent: "available" },
    });
    host.command("node.collect", { nodeId: "node-mac" });
    host.command("node.disconnect", { nodeId: "node-mac" });
    host.command("node.collect", { nodeId: "node-mac" });

    const snapshot = (host.query("node.snapshot", { nodeId: "node-mac" }).snapshot) as {
      layers: {
        ssh: { kind: string; note: string };
        worker: { kind: string; note: string };
        agent: { kind: string; note: string };
      };
      realMachine: false;
    };
    expect(snapshot.realMachine).toBe(false);
    expect(snapshot.layers.ssh.kind).toBe("disconnected");
    expect(snapshot.layers.ssh.note).toMatch(/不等于执行已停止/);
    expect(snapshot.layers.worker.kind).toBe("available");
    expect(snapshot.layers.worker.note).not.toMatch(/已停止/);
    expect(snapshot.layers.agent.kind).toBe("available");
    expect(snapshot.layers.agent.note).toMatch(/不等于 Agent 已在运行|合成探测/);
  });

  it("重连恢复会话，不重跑、不取消原 run", () => {
    const { host } = open("reconnect");
    host.command("node.register", {
      nodeId: "node-win",
      platform: "windows",
      layers: { ssh: "reachable", worker: "available", agent: "idle" },
      seedFiles: { "notes/readme.txt": "resume\n" },
    });
    host.command("node.collect", { nodeId: "node-win" });
    const started = host.command("node.try_start", {
      nodeId: "node-win",
      runId: "run-resume",
      trackerId: "trk-resume",
      projectId: "proj-resume",
    });
    host.command("node.disconnect", { nodeId: "node-win" });
    const reconnected = host.command("node.reconnect", { nodeId: "node-win" });
    expect(reconnected.result.snapshot).toMatchObject({ nodeId: "node-win" });
    expect(host.query("node.session", { nodeId: "node-win" }).connected).toBe(true);
    expect(host.resolveFile("node-win", "notes/readme.txt").readonly).toBe(true);
    expect((host.query("node.run", { runId: "run-resume" }).binding as { cancelled: boolean; startedAt: string }).cancelled).toBe(false);
    expect((host.query("node.run", { runId: "run-resume" }).binding as { startedAt: string }).startedAt).toBe(started.result.startedAt);

    const events = (host.query("node.events", { nodeId: "node-win" }).events) as Array<{ kind: string; payload: { reran?: boolean } }>;
    expect(events.some((event) => event.kind === "reconnected" && event.payload.reran === false)).toBe(true);
    expect(events.filter((event) => event.kind === "start_accepted")).toHaveLength(1);
  });
});
