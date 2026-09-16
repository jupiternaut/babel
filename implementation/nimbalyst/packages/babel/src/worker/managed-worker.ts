import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  GATEWAY_PROTOCOL,
  type GatewayCommandEnvelope,
  type GatewayIdentity,
  type WorkerEvent,
  type WorkerLease,
} from "../gateway/contracts.ts";
import type { GatewaySqliteStore } from "../gateway/sqlite-store.ts";
import { createExecutor, nowIso, type OfflineExecutorKind, type WorkerExecutor } from "./executor.ts";
import { appendWorktreeJournal, eventsFromStore, persistWorkerEvent } from "./journal.ts";
import { getStoredLease, listStoredLeases, type StoredWorkerLease } from "./lease-query.ts";
import { WORKER_SCRATCH_ROOT, assertIsolatedPath, createIsolatedWorktree, fencePath } from "./paths.ts";

export const WORKER_CLIENT_PROTOCOL = "2.3.0-m0";
export const REAL_PI_BLOCKED_REASON = "真实 Pi 不可用；离线实现只使用协议替身或本机合成执行器，不得标为真实 Pi 通过";

export type WorkerCommandName = "worker.start" | "worker.message" | "worker.cancel" | "worker.reconnect" | "worker.record";
export type WorkerQueryName = "worker.show" | "worker.events" | "worker.lease";

export interface WorkerCommandResult {
  ok: true;
  commandStatus: "accepted" | "replayed";
  settled: boolean;
  protocol: typeof GATEWAY_PROTOCOL;
  clientProtocol: typeof WORKER_CLIENT_PROTOCOL;
  mode: "offline";
  realPi: false;
  runId: string;
  correlationId: string;
  result: Record<string, unknown>;
}

export interface ExecutionFence {
  fence: number;
  leaseId: string;
  protocol: WorkerLease["protocol"];
  realPi: false;
  startedAt: string;
}

interface Session {
  lease: WorkerLease;
  executor: WorkerExecutor | null;
  started: boolean;
}

export class ManagedWorker {
  readonly workerId: string;
  readonly isolationRoot: string;
  readonly executorKind: OfflineExecutorKind;
  private readonly store: GatewaySqliteStore;
  private readonly sessions = new Map<string, Session>();

  constructor(
    store: GatewaySqliteStore,
    options: { workerId?: string; isolationRoot?: string; executorKind?: OfflineExecutorKind } = {},
  ) {
    this.store = store;
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.isolationRoot = assertIsolatedPath(options.isolationRoot ?? WORKER_SCRATCH_ROOT, "isolationRoot");
    this.executorKind = options.executorKind ?? "protocol-double";
  }

  command(request: GatewayCommandEnvelope): Promise<WorkerCommandResult> | WorkerCommandResult {
    switch (request.name as WorkerCommandName) {
      case "worker.start":
        return this.start(request);
      case "worker.message":
        return this.message(request);
      case "worker.cancel":
        return this.cancel(request);
      case "worker.reconnect":
        return this.reconnect(request);
      case "worker.record":
        return this.record(request);
      default: {
        const error = new Error(`未知 Worker 命令: ${request.name}`);
        error.name = "VALIDATION";
        throw error;
      }
    }
  }

  query(name: WorkerQueryName, input: { runId?: string; projectId?: string; cursor?: number } = {}): Record<string, unknown> {
    if (name === "worker.lease") {
      const runId = required(input.runId, "runId");
      const lease = getStoredLease(this.store, runId);
      return {
        protocol: GATEWAY_PROTOCOL,
        mode: "offline",
        realPi: false,
        lease,
        live: Boolean(lease && !lease.releasedAt),
        leases: listStoredLeases(this.store, input.projectId),
      };
    }
    if (name === "worker.events") {
      const runId = required(input.runId, "runId");
      const { records, events } = eventsFromStore(this.store, runId, input.cursor ?? 0);
      return {
        protocol: GATEWAY_PROTOCOL,
        mode: "offline",
        realPi: false,
        runId,
        events,
        records,
        cursor: records.at(-1)?.cursor ?? input.cursor ?? 0,
      };
    }
    if (name === "worker.show") {
      const runId = required(input.runId, "runId");
      const lease = getStoredLease(this.store, runId);
      const session = this.sessions.get(runId);
      const { events } = eventsFromStore(this.store, runId);
      return {
        protocol: GATEWAY_PROTOCOL,
        clientProtocol: WORKER_CLIENT_PROTOCOL,
        mode: "offline",
        realPi: false,
        realPiReason: REAL_PI_BLOCKED_REASON,
        lease,
        live: Boolean(lease && !lease.releasedAt),
        processAlive: session?.executor?.isAlive() ?? false,
        executorKind: lease?.protocol ?? this.executorKind,
        worktree: lease?.worktree ?? null,
        fence: lease ? readFence(lease.worktree) : null,
        identity: this.store.getIdentity(this.workerId),
        events,
      };
    }
    const error = new Error(`未知 Worker 查询: ${name}`);
    error.name = "VALIDATION";
    throw error;
  }

  simulateCrash(runId: string): WorkerEvent {
    const session = this.sessions.get(runId);
    if (!session?.executor) {
      const lease = getStoredLease(this.store, runId);
      if (!lease || lease.releasedAt) {
        const error = new Error("没有可崩溃的活动执行");
        error.name = "NOT_FOUND";
        throw error;
      }
      const event = this.publish(lease, { kind: "lost", runId, at: nowIso(), payload: { reason: "crash" } });
      return event;
    }
    session.executor.crash();
    const lost = eventsFromStore(this.store, runId).events.filter((event) => event.kind === "lost").at(-1);
    return lost ?? this.publish(session.lease, { kind: "lost", runId, at: nowIso(), payload: { reason: "crash" } });
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.executor?.isAlive()) session.executor.crash();
    }
    this.sessions.clear();
  }

  private persistIdentity(projectId: string): GatewayIdentity {
    const identity: GatewayIdentity = {
      actorId: this.workerId,
      kind: "worker",
      projectIds: [projectId],
      roles: ["executor"],
    };
    this.store.putIdentity(identity);
    return identity;
  }

  private start(request: GatewayCommandEnvelope): Promise<WorkerCommandResult> | WorkerCommandResult {
    const protocol = this.resolveProtocol(request.input.protocol);
    const runId = required(String(request.input.runId ?? ""), "runId");
    const trackerId = required(String(request.input.trackerId ?? request.input.id ?? ""), "trackerId");
    if (request.idempotencyKey) {
      const existing = this.store.getIdempotency(request.idempotencyKey);
      if (existing) {
        return {
          ok: true,
          commandStatus: "replayed",
          settled: false,
          protocol: GATEWAY_PROTOCOL,
          clientProtocol: WORKER_CLIENT_PROTOCOL,
          mode: "offline",
          realPi: false,
          runId,
          correlationId: request.correlationId ?? request.idempotencyKey,
          result: JSON.parse(existing.resultJson) as Record<string, unknown>,
        };
      }
    }
    this.persistIdentity(request.projectId);
    const prior = getStoredLease(this.store, runId);
    if (prior && !prior.releasedAt) {
      const error = new Error("该 run 已有未释放的 Worker 租约，禁止双执行");
      error.name = "RUN_ACTIVE";
      throw error;
    }
    if (prior?.releasedAt) {
      const error = new Error("同一 run 已有历史租约，重试必须使用新的 runId");
      error.name = "PRECONDITION";
      throw error;
    }
    const worktree = createIsolatedWorktree(request.projectId, runId, this.isolationRoot);
    const lease = this.store.acquireLease({
      leaseId: `lease-${randomUUID()}`,
      runId,
      trackerId,
      projectId: request.projectId,
      workerId: this.workerId,
      protocol,
      worktree,
      startedAt: nowIso(),
    });
    writeFence(worktree, {
      fence: 1,
      leaseId: lease.leaseId,
      protocol,
      realPi: false,
      startedAt: lease.startedAt,
    });
    const executor = createExecutor(protocol === "pi-sim" ? "pi-sim" : "protocol-double");
    const session: Session = { lease, executor, started: true };
    this.sessions.set(runId, session);
    const started = executor.start({
      lease,
      worktree,
      emit: (event) => this.publish(lease, event, request.correlationId),
    });
    const finish = (): WorkerCommandResult => {
      const result = {
        lease,
        worktree,
        fence: readFence(worktree),
        executorKind: executor.kind,
        realPi: false as const,
        note: REAL_PI_BLOCKED_REASON,
      };
      if (request.idempotencyKey) {
        this.store.putIdempotency({
          key: request.idempotencyKey,
          actorId: request.actor.actorId,
          projectId: request.projectId,
          command: request.name,
          payload: request.input,
          result,
        });
      }
      return this.ok(request, runId, result, false);
    };
    if (started && typeof (started as Promise<void>).then === "function") {
      return (started as Promise<void>).then(finish);
    }
    return finish();
  }

  private async message(request: GatewayCommandEnvelope): Promise<WorkerCommandResult> {
    const runId = required(String(request.input.runId ?? request.input.id ?? ""), "runId");
    const text = required(String(request.input.text ?? ""), "text");
    const session = this.requireLiveSession(runId);
    await session.executor!.sendMessage(text);
    return this.ok(request, runId, { delivered: true }, false);
  }

  private async cancel(request: GatewayCommandEnvelope): Promise<WorkerCommandResult> {
    const runId = required(String(request.input.runId ?? request.input.id ?? ""), "runId");
    const lease = this.requireLiveLease(runId);
    const session = this.sessions.get(runId);
    const ack = session?.executor
      ? await session.executor.cancel()
      : this.publish(lease, { kind: "cancel_ack", runId, at: nowIso(), payload: { confirmed: true, recovered: true } }, request.correlationId);
    if (session) session.executor = null;
    this.store.releaseLease(runId, ack.at);
    const stored = getStoredLease(this.store, runId);
    return this.ok(request, runId, { ack, lease: stored, live: false }, true);
  }

  private reconnect(request: GatewayCommandEnvelope): WorkerCommandResult {
    const runId = required(String(request.input.runId ?? request.input.id ?? ""), "runId");
    const stored = getStoredLease(this.store, runId);
    if (!stored) {
      const error = new Error("没有这条执行租约");
      error.name = "NOT_FOUND";
      throw error;
    }
    this.persistIdentity(stored.projectId);
    if (stored.releasedAt) {
      const error = new Error("租约已释放，重连不能再启动同一 run");
      error.name = "PRECONDITION";
      throw error;
    }
    const existing = this.sessions.get(runId);
    if (existing?.executor?.isAlive()) {
      this.publish(stored, {
        kind: "log",
        runId,
        at: nowIso(),
        payload: { message: "reconnect reattached to the same live process; did not start a second execution" },
      }, request.correlationId);
      return this.ok(request, runId, {
        lease: stored,
        reused: true,
        processAlive: true,
        fence: readFence(stored.worktree),
        realPi: false,
      }, false);
    }
    this.sessions.set(runId, { lease: toLease(stored), executor: existing?.executor ?? null, started: true });
    this.publish(stored, {
      kind: "log",
      runId,
      at: nowIso(),
      payload: { message: "reconnect reused existing lease; did not start a second execution" },
    }, request.correlationId);
    return this.ok(request, runId, {
      lease: stored,
      reused: true,
      processAlive: false,
      fence: readFence(stored.worktree),
      realPi: false,
    }, false);
  }

  private async record(request: GatewayCommandEnvelope): Promise<WorkerCommandResult> {
    const runId = required(String(request.input.runId ?? ""), "runId");
    const kind = request.input.kind;
    if (kind !== "tool" && kind !== "diff" && kind !== "artifact") {
      const error = new Error("record.kind 必须是 tool、diff 或 artifact");
      error.name = "VALIDATION";
      throw error;
    }
    const session = this.requireLiveSession(runId);
    const events = await session.executor!.record(kind, request.input);
    return this.ok(request, runId, { events }, false);
  }

  private resolveProtocol(value: unknown): Exclude<WorkerLease["protocol"], "pi"> {
    if (value === "pi") {
      const error = new Error(REAL_PI_BLOCKED_REASON);
      error.name = "UNAVAILABLE";
      throw error;
    }
    if (value === "pi-sim") return "pi-sim";
    if (value === "protocol-double" || value === undefined || value === null || value === "") {
      return this.executorKind === "pi-sim" ? "pi-sim" : "protocol-double";
    }
    const error = new Error("不支持的 Worker 协议");
    error.name = "VALIDATION";
    throw error;
  }

  private requireLiveLease(runId: string): StoredWorkerLease {
    const lease = getStoredLease(this.store, runId);
    if (!lease) {
      const error = new Error("没有这条执行租约");
      error.name = "NOT_FOUND";
      throw error;
    }
    if (lease.releasedAt) {
      const error = new Error("该 run 租约已释放");
      error.name = "PRECONDITION";
      throw error;
    }
    return lease;
  }

  private requireLiveSession(runId: string): Session {
    this.requireLiveLease(runId);
    const session = this.sessions.get(runId);
    if (!session?.executor?.isAlive()) {
      const error = new Error("执行进程已失联，不能当作仍在运行");
      error.name = "LOST_UNRECONCILED";
      throw error;
    }
    return session;
  }

  private publish(lease: WorkerLease, event: WorkerEvent, correlationId?: string): WorkerEvent {
    persistWorkerEvent(this.store, event, {
      projectId: lease.projectId,
      trackerId: lease.trackerId,
      correlationId,
    });
    appendWorktreeJournal(lease.worktree, event);
    return event;
  }

  private ok(
    request: GatewayCommandEnvelope,
    runId: string,
    result: Record<string, unknown>,
    settled: boolean,
    commandStatus: WorkerCommandResult["commandStatus"] = "accepted",
  ): WorkerCommandResult {
    return {
      ok: true,
      commandStatus,
      settled,
      protocol: GATEWAY_PROTOCOL,
      clientProtocol: WORKER_CLIENT_PROTOCOL,
      mode: "offline",
      realPi: false,
      runId,
      correlationId: request.correlationId ?? `corr-${randomUUID()}`,
      result,
    };
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    const error = new Error(`缺少 ${name}`);
    error.name = "VALIDATION";
    throw error;
  }
  return value;
}

function toLease(stored: StoredWorkerLease): WorkerLease {
  const { releasedAt: _releasedAt, ...lease } = stored;
  return lease;
}

function writeFence(worktree: string, fence: ExecutionFence): void {
  writeFileSync(fencePath(worktree), `${JSON.stringify(fence, null, 2)}\n`, "utf8");
}

function readFence(worktree: string): ExecutionFence | null {
  const file = fencePath(worktree);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as ExecutionFence;
}
