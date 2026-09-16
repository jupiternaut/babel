import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerEvent, WorkerLease } from "../gateway/contracts.ts";
import { assertIsolatedPath } from "./paths.ts";

export type OfflineExecutorKind = "protocol-double" | "pi-sim";

export interface ExecutorContext {
  lease: WorkerLease;
  worktree: string;
  emit: (event: WorkerEvent) => void;
}

export interface WorkerExecutor {
  readonly kind: OfflineExecutorKind;
  readonly pid: number | null;
  start(ctx: ExecutorContext): Promise<void>;
  sendMessage(text: string): Promise<void>;
  record(kind: "tool" | "diff" | "artifact", extra?: Record<string, unknown>): Promise<WorkerEvent[]>;
  cancel(): Promise<WorkerEvent>;
  crash(): void;
  isAlive(): boolean;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createExecutor(kind: OfflineExecutorKind): WorkerExecutor {
  return kind === "pi-sim" ? new SyntheticChildExecutor() : new ProtocolDoubleExecutor();
}

export class ProtocolDoubleExecutor implements WorkerExecutor {
  readonly kind = "protocol-double" as const;
  pid: number | null = process.pid;
  private ctx: ExecutorContext | null = null;
  private alive = false;

  async start(ctx: ExecutorContext): Promise<void> {
    this.ctx = ctx;
    this.alive = true;
    this.pid = process.pid;
    emit(ctx, "log", { message: "protocol-double accepted; not a real Pi" });
    emit(ctx, "message", { role: "agent", text: "协议替身已开始合成执行" });
    emit(ctx, "tool", { name: "read_worktree", phase: "started" });
    emit(ctx, "tool", { name: "read_worktree", phase: "finished" });
    writeSyntheticDiff(ctx.worktree);
    emit(ctx, "diff", { files: [{ path: "src/hello.txt", status: "modified" }] });
    writeSyntheticArtifact(ctx.worktree, "protocol-double");
    emit(ctx, "artifact", { path: "artifacts/result.json", name: "result.json", realPi: false });
  }

  async sendMessage(text: string): Promise<void> {
    const ctx = this.requireLive();
    emit(ctx, "message", { role: "user", text });
    emit(ctx, "message", { role: "agent", text: "协议替身已收到消息" });
  }

  async record(kind: "tool" | "diff" | "artifact", extra: Record<string, unknown> = {}): Promise<WorkerEvent[]> {
    const ctx = this.requireLive();
    if (kind === "tool") {
      const name = String(extra.name ?? "synthetic_tool");
      const started = emit(ctx, "tool", { name, phase: "started", ...extra });
      const finished = emit(ctx, "tool", { name, phase: "finished", ...extra });
      return [started, finished];
    }
    if (kind === "diff") {
      writeSyntheticDiff(ctx.worktree);
      return [emit(ctx, "diff", { files: [{ path: "src/hello.txt", status: "modified" }], ...extra })];
    }
    writeSyntheticArtifact(ctx.worktree, "protocol-double");
    return [emit(ctx, "artifact", { path: "artifacts/result.json", name: "result.json", realPi: false, ...extra })];
  }

  async cancel(): Promise<WorkerEvent> {
    const ctx = this.requireCtx();
    this.alive = false;
    return emit(ctx, "cancel_ack", { confirmed: true });
  }

  crash(): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.ctx) emit(this.ctx, "lost", { reason: "crash", message: "进程已崩溃；租约未释放，禁止再开第二次执行" });
  }

  isAlive(): boolean {
    return this.alive;
  }

  private requireCtx(): ExecutorContext {
    if (!this.ctx) {
      const error = new Error("执行器尚未启动");
      error.name = "PRECONDITION";
      throw error;
    }
    return this.ctx;
  }

  private requireLive(): ExecutorContext {
    const ctx = this.requireCtx();
    if (!this.alive) {
      const error = new Error("执行进程已不在运行");
      error.name = "LOST_UNRECONCILED";
      throw error;
    }
    return ctx;
  }
}

export class SyntheticChildExecutor implements WorkerExecutor {
  readonly kind = "pi-sim" as const;
  pid: number | null = null;
  private ctx: ExecutorContext | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private alive = false;
  private closed = false;
  private buffer = "";
  private received: WorkerEvent[] = [];
  private waiters: Array<{ kind: WorkerEvent["kind"]; after: number; resolve: (event: WorkerEvent) => void }> = [];

  async start(ctx: ExecutorContext): Promise<void> {
    this.ctx = ctx;
    const script = fileURLToPath(new URL("./synthetic-child.mjs", import.meta.url));
    const child = spawn(process.execPath, [script, `--worktree=${ctx.worktree}`, `--runId=${ctx.lease.runId}`], {
      cwd: ctx.worktree,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.pid = child.pid ?? null;
    this.alive = true;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.on("exit", (code, signal) => {
      this.alive = false;
      if (this.closed || !this.ctx) return;
      emit(this.ctx, "exited", { code, signal });
    });
    await this.waitForKind("artifact", 4000, 0);
  }

  async sendMessage(text: string): Promise<void> {
    this.requireLive();
    const after = this.received.length;
    this.send({ op: "message", text });
    await this.waitForKind("message", 2000, after);
  }

  async record(kind: "tool" | "diff" | "artifact", extra: Record<string, unknown> = {}): Promise<WorkerEvent[]> {
    this.requireLive();
    const after = this.received.length;
    this.send({ op: "record", kind, ...extra });
    const event = await this.waitForKind(kind, 2000, after);
    return [event];
  }

  async cancel(): Promise<WorkerEvent> {
    const ctx = this.requireCtx();
    let ack: WorkerEvent | undefined;
    if (this.alive && this.child) {
      const after = this.received.length;
      this.send({ op: "cancel" });
      try {
        ack = await this.waitForKind("cancel_ack", 2000, after);
      } catch {
        /* recovered ack below */
      }
    }
    this.alive = false;
    this.closed = true;
    this.detachChild();
    return ack ?? emit(ctx, "cancel_ack", { confirmed: true, recovered: true });
  }

  crash(): void {
    const already = this.closed;
    this.closed = true;
    this.alive = false;
    this.detachChild();
    if (!already && this.ctx) {
      emit(this.ctx, "lost", { reason: "crash", message: "合成子进程已杀死；租约未释放，禁止再开第二次执行" });
    }
  }

  isAlive(): boolean {
    return this.alive && this.child !== null && this.child.exitCode === null;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child || this.closed) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private detachChild(): void {
    if (!this.child) return;
    this.child.stdout.removeAllListeners();
    this.child.removeAllListeners();
    if (this.child.exitCode === null) this.child.kill();
    this.child = null;
  }

  private onStdout(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: WorkerEvent;
      try {
        parsed = JSON.parse(line) as WorkerEvent;
      } catch {
        continue;
      }
      this.received.push(parsed);
      this.ctx?.emit(parsed);
      this.flushWaiters();
    }
  }

  private waitForKind(kind: WorkerEvent["kind"], timeoutMs: number, after: number): Promise<WorkerEvent> {
    const existing = this.received.slice(after).find((event) => event.kind === kind);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${kind} 超时`)), timeoutMs);
      this.waiters.push({
        kind,
        after,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  }

  private flushWaiters(): void {
    this.waiters = this.waiters.filter((waiter) => {
      const match = this.received.slice(waiter.after).find((event) => event.kind === waiter.kind);
      if (!match) return true;
      waiter.resolve(match);
      return false;
    });
  }

  private requireCtx(): ExecutorContext {
    if (!this.ctx) {
      const error = new Error("执行器尚未启动");
      error.name = "PRECONDITION";
      throw error;
    }
    return this.ctx;
  }

  private requireLive(): ExecutorContext {
    const ctx = this.requireCtx();
    if (!this.isAlive()) {
      const error = new Error("执行进程已不在运行");
      error.name = "LOST_UNRECONCILED";
      throw error;
    }
    return ctx;
  }
}

function emit(ctx: ExecutorContext, kind: WorkerEvent["kind"], payload: Record<string, unknown>): WorkerEvent {
  const event: WorkerEvent = { kind, runId: ctx.lease.runId, at: nowIso(), payload };
  ctx.emit(event);
  return event;
}

function writeSyntheticDiff(worktree: string): void {
  const file = path.join(assertIsolatedPath(worktree, "worktree"), "src", "hello.txt");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `hello from offline worker at ${nowIso()}\n`, "utf8");
}

function writeSyntheticArtifact(worktree: string, executor: OfflineExecutorKind): void {
  const file = path.join(assertIsolatedPath(worktree, "worktree"), "artifacts", "result.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ok: true, executor, realPi: false }, null, 2)}\n`, "utf8");
}
