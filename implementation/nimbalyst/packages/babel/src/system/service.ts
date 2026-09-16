import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { SystemError, type ConsoleCommand, type ConsoleQuery, type ConsoleEvent, type Operation, type ServiceDefinition, type ServiceSnapshot, type SystemAdapter } from './types.ts';

interface State { version: 1; operations: Operation[]; requests: Record<string, { signature: string; operationId: string }>; events: ConsoleEvent[]; seq: number; }
export interface SystemServiceOptions {
  profileDir: string;
  services: ServiceDefinition[];
  adapter: SystemAdapter;
  beforeCommand?: (command: ConsoleCommand) => Promise<void>;
}
const ACTIONS = new Set(['service.start', 'service.stop', 'service.restart', 'service.autostart', 'process.terminate']);
const KINDS = new Set(['windows-service', 'scheduled-task', 'startup-shortcut', 'wsl-systemd', 'systemd', 'launchd', 'managed-process']);

export function validateCatalog(services: ServiceDefinition[]): ServiceDefinition[] {
  if (!Array.isArray(services) || services.length > 200) throw new SystemError('VALIDATION', '服务清单必须为数组，最多 200 项');
  const ids = new Set<string>();
  for (const row of services) {
    if (!row || !/^[a-zA-Z0-9][\w.-]{0,95}$/.test(row.id) || ids.has(row.id)) throw new SystemError('VALIDATION', '服务 ID 无效或重复');
    if (!KINDS.has(row.kind) || typeof row.label !== 'string' || !row.label.trim() || typeof row.target !== 'string' || !row.target || /[\0\r\n]/.test(row.target)) throw new SystemError('VALIDATION', '服务类型、名称或目标无效');
    if (row.args && (!Array.isArray(row.args) || row.args.some(a => typeof a !== 'string' || a.includes('\0')))) throw new SystemError('VALIDATION', '服务参数必须是字符串数组');
    if (row.healthUrl) { const url = new URL(row.healthUrl); if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new SystemError('VALIDATION', '本机服务健康地址必须为无凭据的回环 HTTP 地址'); }
    ids.add(row.id);
  }
  const visit = (id: string, stack: Set<string>) => {
    if (stack.has(id)) throw new SystemError('VALIDATION', '服务依赖存在循环');
    const row = services.find(s => s.id === id)!;
    for (const dep of row.dependsOn ?? []) {
      if (!ids.has(dep)) throw new SystemError('VALIDATION', `服务 ${id} 的依赖 ${dep} 未登记`);
      visit(dep, new Set([...stack, id]));
    }
  };
  services.forEach(s => visit(s.id, new Set()));
  return structuredClone(services);
}

/** Single writer. Every side effect is journalled before execution; recovery never repeats it. */
export class SystemConsoleService {
  private readonly file: string;
  private readonly adapter: SystemAdapter;
  private readonly catalog: ServiceDefinition[];
  private state: State;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  get isBusy(): boolean { return this.pending > 0; }
  private cache = new Map<string, { expires: number; promise: Promise<unknown> }>();
  constructor(private readonly options: SystemServiceOptions) {
    this.catalog = validateCatalog(options.services);
    this.adapter = options.adapter;
    mkdirSync(options.profileDir, { recursive: true });
    this.file = path.join(options.profileDir, 'system-state.json');
    this.state = { version: 1, operations: [], requests: {}, events: [], seq: 0 };
    if (existsSync(this.file)) {
      try {
        const state = JSON.parse(readFileSync(this.file, 'utf8')) as State;
        if (state.version !== 1 || !Array.isArray(state.operations) || !Array.isArray(state.events) || !state.requests || !Number.isInteger(state.seq)) throw new Error('schema');
        this.state = state;
      } catch { throw new SystemError('STATE_CORRUPT', '操作记录无法读取，保留原文件；请检查 system-state.json 和 .bak，不自动清空'); }
    }
    for (const op of this.state.operations) if (op.status === 'running') {
      op.status = 'interrupted'; op.finishedAt = new Date().toISOString();
      op.error = { code: 'INTERRUPTED', message: '控制服务中断，系统副作用未知，请刷新实际状态；不会自动重试' };
      this.event('operation.interrupted', op);
    }
    this.persist();
  }
  private persist(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    renameSync(tmp, this.file);
  }
  private event(type: string, op: Operation): void {
    this.state.events.push({ seq: ++this.state.seq, type, at: new Date().toISOString(), operationId: op.id, targetId: op.targetId });
  }
  private service(id?: string): ServiceDefinition {
    const row = this.catalog.find(s => s.id === id);
    if (!row) throw new SystemError('NOT_FOUND', '服务未登记');
    return row;
  }
  private cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
    const previous = this.cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.promise as Promise<T>;
    const promise = load().then(value => { const entry = this.cache.get(key); if (entry?.promise === promise) entry.expires = Date.now() + ms; return value; }).catch(error => { this.cache.delete(key); throw error; });
    this.cache.set(key, { expires: Infinity, promise });
    return promise;
  }
  private async inspect(row: ServiceDefinition): Promise<ServiceSnapshot> {
    const snap = await this.adapter.inspect(row);
    if (!row.healthUrl || snap.state !== 'running') return snap;
    try { const response = await fetch(row.healthUrl, { signal: AbortSignal.timeout(2500), redirect: 'error' }); await response.body?.cancel(); return { ...snap, health: response.ok ? 'healthy' : 'unhealthy' }; }
    catch { return { ...snap, health: 'unhealthy' }; }
  }
  async query(query: ConsoleQuery): Promise<unknown> {
    if (!query || typeof query !== 'object') throw new SystemError('VALIDATION', '查询格式无效');
    const limit = Math.max(1, Math.min(500, Number.isFinite(query.limit) ? query.limit! : 100));
    switch (query.name) {
      case 'resources': return this.cached('resources', 1500, () => this.adapter.resources());
      case 'processes': return this.cached('processes', 1500, () => this.adapter.processes());
      case 'services': return { services: await Promise.all(this.catalog.map(async definition => ({ definition, snapshot: await this.cached(`service:${definition.id}`, 2000, () => this.inspect(definition)).catch(error => ({ id: definition.id, state: 'unknown', autostart: { enabled: null, trigger: 'unknown' }, processes: [], sampledAt: new Date().toISOString(), health: 'unknown', message: error instanceof Error ? error.message : String(error) })) }))) };
      case 'service': { const definition = this.service(query.serviceId); return { definition, snapshot: await this.cached(`service:${definition.id}`, 2000, () => this.inspect(definition)) }; }
      case 'logs': return { text: await this.adapter.logs(this.service(query.serviceId), limit) };
      case 'operations': return structuredClone(this.state.operations.slice(-limit).reverse());
      case 'events': return structuredClone(this.state.events.filter(e => e.seq > (query.after ?? 0)).slice(0, limit));
      default: throw new SystemError('VALIDATION', '未知系统查询');
    }
  }
  command(command: ConsoleCommand): Promise<Operation> {
    if (this.pending >= 50) return Promise.reject(new SystemError('BUSY', '操作队列已满，请稍后重试'));
    this.pending++;
    const result = this.queue.then(() => this.execute(command));
    this.queue = result.catch(() => {}).finally(() => { this.pending--; });
    return result;
  }
  private async execute(command: ConsoleCommand): Promise<Operation> {
    if (!command || !ACTIONS.has(command.name) || typeof command.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(command.requestId) || ['__proto__', 'constructor', 'prototype'].includes(command.requestId)) throw new SystemError('VALIDATION', '操作或 requestId 无效');
    if (command.name === 'service.autostart' && typeof command.enabled !== 'boolean') throw new SystemError('VALIDATION', '自启动开关必须是布尔值');
    if (command.name === 'process.terminate' && (!Number.isInteger(command.process?.pid) || command.process!.pid <= 4 || !command.process?.startedAt || !Number.isFinite(Date.parse(command.process.startedAt)))) throw new SystemError('VALIDATION', '结束进程必须提供有效 PID 和精确启动时间');
    const signature = JSON.stringify({ name: command.name, serviceId: command.serviceId, enabled: command.enabled, process: command.process, force: command.force === true });
    const previous = Object.hasOwn(this.state.requests, command.requestId) ? this.state.requests[command.requestId] : undefined;
    if (previous) {
      if (previous.signature !== signature) throw new SystemError('CONFLICT', '同一 requestId 不能用于不同操作');
      return structuredClone(this.state.operations.find(o => o.id === previous.operationId)!);
    }
    const row = command.name === 'process.terminate' ? undefined : this.service(command.serviceId);
    const op: Operation = { id: randomUUID(), requestId: command.requestId, action: command.name, targetId: row?.id ?? String(command.process!.pid), requestedAt: new Date().toISOString(), status: 'running' };
    this.state.requests[command.requestId] = { signature, operationId: op.id };
    this.state.operations.push(op); this.event('operation.requested', op); this.persist();
    try {
      await this.options.beforeCommand?.(structuredClone(command));
      if (row) {
        op.before = await this.inspect(row); this.persist();
        if (['service.start', 'service.restart'].includes(command.name)) {
          for (const id of row.dependsOn ?? []) {
            const dep = await this.inspect(this.service(id));
            if (dep.state !== 'running') throw new SystemError('DEPENDENCY', `依赖 ${id} 未运行，请先启动并核验`);
          }
        }
        if (command.name === 'service.stop' || command.name === 'service.restart') {
          for (const dependent of this.catalog.filter(s => s.dependsOn?.includes(row.id))) {
            if ((await this.inspect(dependent)).state !== 'stopped') throw new SystemError('DEPENDENCY', `${dependent.label} 尚未确认停止，请先停止并核验依赖方`);
          }
        }
        if (command.name === 'service.autostart') await this.adapter.setAutostart(row, command.enabled!);
        else await this.adapter.control(row, command.name.slice('service.'.length) as 'start' | 'stop' | 'restart');
        op.after = await this.inspect(row);
        const desired = command.name === 'service.stop' ? 'stopped' : 'running';
        if (command.name === 'service.autostart') {
          if (op.after.autostart.enabled !== command.enabled) throw new SystemError('VERIFY_FAILED', '自启动配置回读未达到请求状态；请查看两层启动入口与权限');
        } else {
          // Transitional states can settle asynchronously, but success requires a fresh observation.
          for (let i = 0; i < 10 && ['starting', 'stopping'].includes(op.after.state); i++) {
            await new Promise(r => setTimeout(r, 500)); op.after = await this.inspect(row);
          }
          if (op.after.state !== desired) throw new SystemError('VERIFY_FAILED', `服务操作后状态为 ${op.after.state}，预期 ${desired}`);
          if (desired === 'running' && op.after.health === 'unhealthy') throw new SystemError('HEALTH_FAILED', '进程已经运行，但应用健康检查未通过');
        }
      } else {
        await this.adapter.terminateProcess(command.process!, command.force === true);
        const stillAlive = (await this.adapter.processes()).some(p => p.pid === command.process!.pid && p.startedAt === command.process!.startedAt);
        if (stillAlive) throw new SystemError('VERIFY_FAILED', '该进程仍在运行');
      }
      op.status = 'succeeded';
    } catch (error) {
      op.status = 'failed'; op.error = { code: error instanceof SystemError ? error.code : (typeof (error as {code?: unknown})?.code === 'string' ? String((error as {code: string}).code) : 'SYSTEM_ERROR'), message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.cache.clear(); op.finishedAt = new Date().toISOString(); this.event(`operation.${op.status}`, op); this.persist();
    }
    return structuredClone(op);
  }
}
