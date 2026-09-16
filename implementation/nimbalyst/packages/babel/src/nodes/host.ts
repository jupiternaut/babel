import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nodeError } from "./errors.ts";
import { createPlatformAdapter, type MockSystemInterface } from "./mock-system.ts";
import { assertIsolatedPath, ensureScratchRoot, NODES_SCRATCH_ROOT, resolveNodeTree } from "./paths.ts";
import { IsolatedNodeFileTree, type IsolatedNodeResource } from "./sftp.ts";
import { MockSshSession } from "./session.ts";
import { freshnessNote, projectLayers, snapshotFreshness, startBlockReason } from "./status.ts";
import {
  NODE_CLIENT_PROTOCOL,
  NODE_COLLECTION_INTERVAL_SECONDS,
  type AdjustableClock,
  type AttachedResource,
  type Clock,
  type NodeEvent,
  type NodePlatform,
  type NodeRunBinding,
  type NodeSnapshot,
  type ProbeLayers,
} from "./types.ts";

export type NodeCommandName =
  | "node.register"
  | "node.collect"
  | "node.collect_due"
  | "node.fail_collect"
  | "node.set_layers"
  | "node.disconnect"
  | "node.reconnect"
  | "node.attach"
  | "node.try_start";

export type NodeQueryName =
  | "node.show"
  | "node.list"
  | "node.snapshot"
  | "node.resource"
  | "node.events"
  | "node.session"
  | "node.run";

export interface NodeCommandResult {
  ok: true;
  commandStatus: "accepted";
  mode: "synthetic";
  realMachine: false;
  protocol: typeof NODE_CLIENT_PROTOCOL;
  nodeId?: string;
  result: Record<string, unknown>;
}

interface RegisteredNode {
  nodeId: string;
  platform: NodePlatform;
  authorized: boolean;
  deniedPaths: string[];
  adapter: MockSystemInterface;
  session: MockSshSession;
  tree: IsolatedNodeFileTree;
  treeRoot: string;
  collectedAt: string | null;
  lastAttemptAt: string | null;
  nextDueAt: string;
  snapshotRevision: number;
  lastLayers: ProbeLayers;
}

export interface RegisterNodeInput {
  nodeId: string;
  platform: NodePlatform;
  authorized?: boolean;
  deniedPaths?: string[];
  layers?: Partial<ProbeLayers>;
  seedFiles?: Record<string, string>;
}

export class SyntheticNodeHost {
  readonly isolationRoot: string;
  readonly realMachine = false as const;
  readonly mode = "synthetic" as const;
  private readonly clock: Clock;
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly events: NodeEvent[] = [];
  private readonly attachments = new Map<string, AttachedResource>();
  private readonly bindings = new Map<string, NodeRunBinding>();

  constructor(options: { isolationRoot?: string; clock?: Clock | AdjustableClock } = {}) {
    this.isolationRoot = assertIsolatedPath(options.isolationRoot ?? ensureScratchRoot(), "isolationRoot");
    this.clock = options.clock ?? { now: () => new Date() };
    mkdirSync(this.isolationRoot, { recursive: true });
  }

  command(name: NodeCommandName, input: Record<string, unknown> = {}): NodeCommandResult {
    switch (name) {
      case "node.register":
        return this.wrap(this.register(input as unknown as RegisterNodeInput));
      case "node.collect":
        return this.wrap(this.collect(String(input.nodeId ?? "")));
      case "node.collect_due":
        return this.wrap({ snapshots: this.collectDue() });
      case "node.fail_collect":
        return this.wrap(this.failCollect(String(input.nodeId ?? "")));
      case "node.set_layers":
        return this.wrap(this.setLayers(String(input.nodeId ?? ""), (input.layers ?? {}) as Partial<ProbeLayers>));
      case "node.disconnect":
        return this.wrap(this.disconnect(String(input.nodeId ?? "")));
      case "node.reconnect":
        return this.wrap(this.reconnect(String(input.nodeId ?? "")));
      case "node.attach":
        return this.wrap(this.attach(
          String(input.nodeId ?? ""),
          String(input.relativePath ?? ""),
          input.expectedRevision != null ? String(input.expectedRevision) : undefined,
        ));
      case "node.try_start":
        return this.wrap(this.tryStart(input));
      default: {
        const unknown = name as string;
        throw nodeError("VALIDATION", `未知节点命令: ${unknown}`);
      }
    }
  }

  query(name: NodeQueryName, input: Record<string, unknown> = {}): Record<string, unknown> {
    const now = this.nowIso();
    switch (name) {
      case "node.show":
      case "node.snapshot":
        return { mode: this.mode, realMachine: false, snapshot: this.snapshot(String(input.nodeId ?? ""), now) };
      case "node.list":
        return {
          mode: this.mode,
          realMachine: false,
          snapshots: [...this.nodes.keys()].map((nodeId) => this.snapshot(nodeId, now)),
        };
      case "node.resource": {
        const nodeId = String(input.nodeId ?? "");
        const relativePath = input.relativePath != null ? String(input.relativePath) : undefined;
        const key = relativePath ? attachmentKey(nodeId, relativePath) : [...this.attachments.keys()].find((item) => item.startsWith(`${nodeId}:`));
        return { mode: this.mode, realMachine: false, resource: key ? this.attachments.get(key) ?? null : null };
      }
      case "node.events": {
        const nodeId = input.nodeId != null ? String(input.nodeId) : null;
        return {
          mode: this.mode,
          realMachine: false,
          events: this.events.filter((event) => !nodeId || event.nodeId === nodeId),
        };
      }
      case "node.session": {
        const node = this.require(String(input.nodeId ?? ""));
        return { mode: this.mode, realMachine: false, connected: node.session.connected, nodeId: node.nodeId };
      }
      case "node.run": {
        const runId = String(input.runId ?? "");
        return { mode: this.mode, realMachine: false, binding: this.bindings.get(runId) ?? null };
      }
      default: {
        const unknown = name as string;
        throw nodeError("VALIDATION", `未知节点查询: ${unknown}`);
      }
    }
  }

  probeHost(host: string): never {
    throw nodeError("UNAUTHORIZED", `未登记主机，拒绝访问（不扫描局域网）: ${host}`);
  }

  resolveFile(nodeId: string, relativePath: string, expectedRevision?: string): IsolatedNodeResource {
    return this.require(nodeId).tree.resolve(relativePath, expectedRevision);
  }

  writeFile(nodeId: string, relativePath: string): never {
    return this.require(nodeId).tree.write(relativePath);
  }

  private register(input: RegisterNodeInput): { snapshot: NodeSnapshot; treeRoot: string } {
    if (!input.nodeId || !input.platform) {
      throw nodeError("VALIDATION", "登记节点需要 nodeId 与 platform");
    }
    if (this.nodes.has(input.nodeId)) {
      throw nodeError("VALIDATION", `节点已登记: ${input.nodeId}`);
    }
    const now = this.nowIso();
    const treeRoot = resolveNodeTree(this.isolationRoot, input.nodeId);
    mkdirSync(treeRoot, { recursive: true });
    for (const [relative, body] of Object.entries(input.seedFiles ?? { "notes/readme.txt": "synthetic isolated tree\n" })) {
      const absolute = path.join(treeRoot, ...relative.replace(/\\/g, "/").split("/"));
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, body, "utf8");
    }
    const session = new MockSshSession(true);
    const authorized = input.authorized !== false;
    const deniedPaths = input.deniedPaths ?? [];
    const adapter = createPlatformAdapter(input.platform, input.layers);
    const node: RegisteredNode = {
      nodeId: input.nodeId,
      platform: input.platform,
      authorized,
      deniedPaths,
      adapter,
      session,
      tree: new IsolatedNodeFileTree(treeRoot, input.nodeId, session, { authorized, deniedPaths }),
      treeRoot,
      collectedAt: null,
      lastAttemptAt: null,
      nextDueAt: now,
      snapshotRevision: 0,
      lastLayers: adapter.probe(),
    };
    this.nodes.set(input.nodeId, node);
    this.record(input.nodeId, "registered", {
      platform: input.platform,
      serviceKind: adapter.serviceKind,
      authorized,
      realMachine: false,
    });
    return { snapshot: this.snapshot(input.nodeId, now), treeRoot };
  }

  private collect(nodeId: string): { snapshot: NodeSnapshot } {
    const node = this.require(nodeId);
    const now = this.nowIso();
    const probes = node.session.connected
      ? node.adapter.probe()
      : { ...node.adapter.probe(), ssh: "disconnected" as const };
    node.lastLayers = probes;
    node.collectedAt = now;
    node.lastAttemptAt = now;
    node.nextDueAt = later(now, NODE_COLLECTION_INTERVAL_SECONDS);
    node.snapshotRevision += 1;
    this.record(nodeId, "collected", {
      snapshotRevision: node.snapshotRevision,
      ssh: probes.ssh,
      worker: probes.worker,
      agent: probes.agent,
    });
    return { snapshot: this.snapshot(nodeId, now) };
  }

  private collectDue(): NodeSnapshot[] {
    const now = this.nowIso();
    const due = [...this.nodes.values()].filter((node) => Date.parse(now) >= Date.parse(node.nextDueAt));
    return due.map((node) => this.collect(node.nodeId).snapshot);
  }

  private failCollect(nodeId: string): { snapshot: NodeSnapshot } {
    const node = this.require(nodeId);
    const now = this.nowIso();
    node.lastAttemptAt = now;
    node.nextDueAt = later(now, NODE_COLLECTION_INTERVAL_SECONDS);
    this.record(nodeId, "collect_failed", { collectedAt: node.collectedAt });
    return { snapshot: this.snapshot(nodeId, now) };
  }

  private setLayers(nodeId: string, layers: Partial<ProbeLayers>): { layers: ProbeLayers } {
    const node = this.require(nodeId);
    const next = node.adapter.setLayers(layers);
    node.lastLayers = node.session.connected ? next : { ...next, ssh: "disconnected" };
    return { layers: node.lastLayers };
  }

  private disconnect(nodeId: string): { snapshot: NodeSnapshot; bindingCancelled: false } {
    const node = this.require(nodeId);
    node.session.disconnect();
    node.adapter.setLayers({ ssh: "disconnected" });
    node.lastLayers = { ...node.adapter.probe(), ssh: "disconnected" };
    this.record(nodeId, "disconnected", { cancelledRuns: false });
    return { snapshot: this.snapshot(nodeId), bindingCancelled: false };
  }

  private reconnect(nodeId: string): { snapshot: NodeSnapshot } {
    const node = this.require(nodeId);
    node.session.reconnect();
    if (node.lastLayers.ssh === "disconnected") {
      node.adapter.setLayers({ ssh: "reachable" });
    }
    node.lastLayers = node.adapter.probe();
    this.record(nodeId, "reconnected", { restoredSession: true, reran: false });
    return { snapshot: this.snapshot(nodeId) };
  }

  private attach(nodeId: string, relativePath: string, expectedRevision?: string): AttachedResource {
    const resource = this.resolveFile(nodeId, relativePath, expectedRevision);
    const attached: AttachedResource = {
      resourceId: resource.resourceId,
      nodeId,
      relativePath: resource.relativePath,
      revision: resource.revision,
      readonly: true,
      attachedAt: this.nowIso(),
    };
    this.attachments.set(attachmentKey(nodeId, resource.relativePath), attached);
    this.record(nodeId, "resource_attached", {
      resourceId: attached.resourceId,
      revision: attached.revision,
    });
    return attached;
  }

  private tryStart(input: Record<string, unknown>): NodeRunBinding {
    const nodeId = String(input.nodeId ?? "");
    const runId = String(input.runId ?? "");
    const trackerId = String(input.trackerId ?? "");
    const projectId = String(input.projectId ?? "");
    if (!nodeId || !runId || !trackerId || !projectId) {
      throw nodeError("VALIDATION", "启动需要 nodeId、runId、trackerId、projectId");
    }
    const node = this.require(nodeId);
    const probes = node.session.connected
      ? node.adapter.probe()
      : { ...node.adapter.probe(), ssh: "disconnected" as const };
    const blocked = startBlockReason(probes);
    if (blocked) {
      this.record(nodeId, "start_rejected", { runId, reason: blocked, ssh: probes.ssh, worker: probes.worker, agent: probes.agent });
      throw nodeError("UNAVAILABLE", blocked, { nodeId, ssh: probes.ssh, worker: probes.worker, agent: probes.agent });
    }
    const existing = this.bindings.get(runId);
    if (existing && !existing.cancelled) {
      return existing;
    }
    const binding: NodeRunBinding = {
      nodeId,
      runId,
      trackerId,
      projectId,
      cancelled: false,
      startedAt: this.nowIso(),
    };
    this.bindings.set(runId, binding);
    this.record(nodeId, "start_accepted", { runId, trackerId, realAgent: false });
    return binding;
  }

  private snapshot(nodeId: string, now = this.nowIso()): NodeSnapshot {
    const node = this.require(nodeId);
    const probes = node.session.connected
      ? node.lastLayers
      : { ...node.lastLayers, ssh: "disconnected" as const };
    const freshness = snapshotFreshness(node.collectedAt, now);
    return {
      nodeId: node.nodeId,
      platform: node.platform,
      serviceKind: node.adapter.serviceKind,
      collectedAt: node.collectedAt,
      lastAttemptAt: node.lastAttemptAt,
      nextDueAt: node.nextDueAt,
      freshness,
      freshnessNote: freshnessNote(freshness),
      snapshotRevision: node.snapshotRevision,
      layers: projectLayers(probes, node.collectedAt),
      realMachine: false,
      mode: "synthetic",
      authorized: node.authorized,
    };
  }

  private require(nodeId: string): RegisteredNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw nodeError("NOT_FOUND", `未登记节点: ${nodeId || "(empty)"}`);
    }
    return node;
  }

  private wrap<T extends object>(result: T): NodeCommandResult {
    return {
      ok: true,
      commandStatus: "accepted",
      mode: "synthetic",
      realMachine: false,
      protocol: NODE_CLIENT_PROTOCOL,
      nodeId: 'nodeId' in result && typeof result.nodeId === "string" ? result.nodeId : undefined,
      result: { ...result } as Record<string, unknown>,
    };
  }

  private record(nodeId: string, kind: NodeEvent["kind"], payload: Record<string, unknown>): void {
    const event: NodeEvent = { kind, nodeId, at: this.nowIso(), payload };
    this.events.push(event);
    const journal = path.join(this.isolationRoot, "node-journal.jsonl");
    appendFileSync(journal, `${JSON.stringify({ ...event, realMachine: false })}\n`, "utf8");
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }
}

export function createSyntheticNodeHost(options?: { isolationRoot?: string; clock?: Clock }): SyntheticNodeHost {
  return new SyntheticNodeHost(options);
}

function later(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function attachmentKey(nodeId: string, relativePath: string): string {
  return `${nodeId}:${relativePath}`;
}

export { NODES_SCRATCH_ROOT };
