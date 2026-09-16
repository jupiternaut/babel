import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConsoleCommand, ConsoleEvent } from './types.ts';
import { SystemError } from './types.ts';

export interface SystemHook {
  id: string;
  executable: string;
  args?: string[];
  timeoutMs?: number;
}
export interface SystemHooksConfig { before?: SystemHook[]; observers?: SystemHook[] }
interface Delivery { seq: number; failures: number; retryAt: number; lastError?: string }

export function validateSystemHooks(config: SystemHooksConfig): void {
  if (!config || typeof config !== 'object') throw new SystemError('CONFIG', 'Hook 配置无效');
  const ids = new Set<string>();
  for (const list of [config.before ?? [], config.observers ?? []]) {
    if (!Array.isArray(list) || list.length > 20) throw new SystemError('CONFIG', 'Hook 清单无效');
    for (const hook of list) {
      if (!hook || !/^[a-zA-Z0-9][\w.-]{0,95}$/.test(hook.id) || ids.has(hook.id) || typeof hook.executable !== 'string' || !path.isAbsolute(hook.executable)) throw new SystemError('CONFIG', 'Hook 需要唯一 ID 和可执行文件绝对路径');
      if (hook.args && (!Array.isArray(hook.args) || hook.args.some(arg => typeof arg !== 'string' || arg.includes('\0')))) throw new SystemError('CONFIG', 'Hook 参数无效');
      if (hook.timeoutMs !== undefined && (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs < 100 || hook.timeoutMs > 10000)) throw new SystemError('CONFIG', 'Hook 超时必须在 100–10000 ms');
      ids.add(hook.id);
    }
  }
}

/** Explicit local executable configuration only. No shell expansion or inherited credentials. */
export function runSystemHook(hook: SystemHook, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(hook.executable, hook.args ?? [], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => { child.kill(); finish(new SystemError('HOOK_TIMEOUT', `Hook ${hook.id} 超时，未批准操作`)); }, hook.timeoutMs ?? 10000);
    let size = 0;
    const drain = (chunk: Buffer) => { size += chunk.length; if (size > 65536) { child.kill(); finish(new SystemError('HOOK_OUTPUT', `Hook ${hook.id} 输出过量`)); } };
    child.stdout.on('data', drain); child.stderr.on('data', drain);
    child.on('error', () => finish(new SystemError('HOOK_ERROR', `Hook ${hook.id} 无法启动`)));
    child.on('exit', code => finish(code === 0 ? undefined : new SystemError('HOOK_REJECTED', `Hook ${hook.id} 返回 ${code ?? 'signal'}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload) + '\n');
  });
}

/** Events are durable in the service journal. Ack is persisted only after a successful delivery. */
export class SystemHooks {
  private readonly file: string;
  private deliveries: Record<string, Delivery> = Object.create(null);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  constructor(private readonly profile: string, private readonly config: SystemHooksConfig, private readonly run = runSystemHook) {
    validateSystemHooks(config);
    this.file = path.join(profile, 'hook-deliveries.json');
    if (existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8'));
        if (saved.version !== 1 || !saved.deliveries || typeof saved.deliveries !== 'object') throw new Error();
        for (const [id, value] of Object.entries(saved.deliveries)) {
          const row = value as Delivery;
          if (!Number.isSafeInteger(row.seq) || row.seq < 0 || !Number.isFinite(row.retryAt) || !Number.isSafeInteger(row.failures) || row.failures < 0) throw new Error();
          this.deliveries[id] = row;
        }
      } catch { throw new SystemError('STATE_CORRUPT', 'Hook 投递记录损坏，保留文件且不重置游标'); }
    }
  }
  before = async (command: ConsoleCommand): Promise<void> => {
    for (const hook of this.config.before ?? []) await this.run(hook, { version: 1, type: 'command.validate', command });
  };
  private persist(): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, deliveries: this.deliveries }, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  async drain(read: (after: number) => Promise<ConsoleEvent[]>): Promise<void> {
    for (const hook of this.config.observers ?? []) {
      const delivery = this.deliveries[hook.id] ?? { seq: 0, failures: 0, retryAt: 0 };
      this.deliveries[hook.id] = delivery;
      if (Date.now() < delivery.retryAt) continue;
      for (const event of await read(delivery.seq)) {
        try {
          await this.run(hook, { version: 1, type: 'event.observe', event, deliveryId: `${hook.id}:${event.seq}` });
          delivery.seq = event.seq; delivery.failures = 0; delivery.retryAt = 0; delete delivery.lastError;
        } catch (error) {
          delivery.failures++; delivery.retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(delivery.failures, 6));
          delivery.lastError = error instanceof Error ? error.message : 'Hook delivery failed';
          this.persist(); break;
        }
        this.persist();
      }
    }
  }
  start(read: (after: number) => Promise<ConsoleEvent[]>): void {
    this.stopped = false;
    const poll = async () => {
      try { await this.drain(read); }
      catch { process.stderr.write('Hook delivery journal unavailable; observers will retry.\n'); }
      if (!this.stopped) this.timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}
