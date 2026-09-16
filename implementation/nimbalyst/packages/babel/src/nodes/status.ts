import {
  NODE_SNAPSHOT_STALE_AFTER_SECONDS,
  type AgentLayerKind,
  type FreshnessKind,
  type NodeLayerStatus,
  type ProbeLayers,
  type SshLayerKind,
  type WorkerLayerKind,
} from "./types.ts";

export function snapshotFreshness(collectedAt: string | null, now: string): FreshnessKind {
  if (!collectedAt) return "unknown";
  const observed = Date.parse(collectedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return "unknown";
  if (current - observed > NODE_SNAPSHOT_STALE_AFTER_SECONDS * 1000) return "stale";
  return "fresh";
}

export function freshnessNote(kind: FreshnessKind): string {
  switch (kind) {
    case "unknown":
      return "尚未取得有效观测时间，不能推断设备离线或 Agent 已停止。";
    case "stale":
      return "超过 150 秒未成功采集。快照过期不能推断离线或 Agent 已停止。";
    case "fresh":
      return "最近一次成功采集在 freshness 阈值内。这是合成节点，不是真机在线探测。";
  }
}

export function sshNote(kind: SshLayerKind): string {
  switch (kind) {
    case "reachable":
      return "SSH 可达不等于 Worker 可用。这是合成探测，不是真机在线。";
    case "unreachable":
      return "SSH 不可达。不能据此推断 Worker 或 Agent 已停止。";
    case "disconnected":
      return "SSH 会话已断开。断开视图不等于执行已停止。";
    case "unknown":
      return "尚未取得有效 SSH 观测，不能推断设备离线。";
  }
}

export function workerNote(kind: WorkerLayerKind): string {
  switch (kind) {
    case "available":
      return "Worker 可用不等于 Agent 可用。这是合成探测，不是真机。";
    case "unavailable":
      return "Worker 不可用。即使 SSH 可达也不能启动。";
    case "unknown":
      return "尚未取得有效 Worker 观测，不能写成节点已停止。";
  }
}

export function agentNote(kind: AgentLayerKind): string {
  switch (kind) {
    case "available":
    case "idle":
      return "Agent 状态来自合成探测，不是真机能力。创建会话不等于 Agent 已在运行。";
    case "unavailable":
      return "Agent 能力不可用。这是合成探测，不是真机已停止。";
    case "lost":
      return "失联不是已停止。需要核对后才能重试、启动或归档。";
    case "unknown":
      return "尚未取得有效 Agent 观测，不能写成 Agent 已停止。";
  }
}

export function projectLayers(probes: ProbeLayers, observedAt: string | null): NodeLayerStatus {
  return {
    ssh: { kind: probes.ssh, observedAt, note: sshNote(probes.ssh) },
    worker: { kind: probes.worker, observedAt, note: workerNote(probes.worker) },
    agent: { kind: probes.agent, observedAt, note: agentNote(probes.agent) },
  };
}

export function startBlockReason(probes: ProbeLayers): string | null {
  if (probes.agent === "lost") {
    return "失联不是已停止。需要核对后才能启动。";
  }
  if (probes.worker !== "available") {
    return "Worker 不可用或尚未观测到，不能启动。SSH 可达不等于可以执行。";
  }
  return null;
}
