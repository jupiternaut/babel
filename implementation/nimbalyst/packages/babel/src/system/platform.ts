import { execFile, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemError, type ProcessIdentity, type ProcessInfo, type ResourceSnapshot, type ServiceDefinition, type ServiceSnapshot, type SystemAction, type SystemAdapter } from './types.ts';

type CommandResult = { stdout: string; stderr: string };
type Runner = (file: string, args: string[], timeout?: number) => Promise<CommandResult>;
/** Injection is for platform contract tests; the HTTP API never accepts these options. */
export interface PlatformOptions { platform?: NodeJS.Platform; run?: Runner }
interface RawProcess extends ProcessInfo { cpuMilliseconds?: number }
interface ManagedRecord extends ProcessIdentity { executable: string; args: string[]; cwd?: string }
// The packaged Electron server pins this to the script copied next to its bundle.
const windowsScript = process.env.BABEL_SYSTEM_WINDOWS_SCRIPT || fileURLToPath(new URL('./platform-windows.ps1', import.meta.url));
const protectedNames = /^(system|idle|registry|secure system|smss|csrss|wininit|services|lsass|winlogon|svchost|dwm|init|systemd|launchd|kernel_task)(\.exe)?$/i;
const commandRunner: Runner = (file, args, timeout = 30_000) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
      const message = `${stderr || stdout || error.message}`.trim();
      const code = (error as NodeJS.ErrnoException).code;
      reject(new SystemError(code === 'EACCES' || code === 'EPERM' || /access.*denied|permission denied|not authorized|拒绝访问|需要提升|禁止运行脚本|running scripts is disabled|execution polic|authentication is required/i.test(message) ? 'PERMISSION' : code === 'ENOENT' ? 'UNSUPPORTED' : 'COMMAND_FAILED', message));
    } else resolve({ stdout, stderr });
  });
});
function requireText(value: unknown, name: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\0\r\n]/.test(value) || (pattern && !pattern.test(value))) throw new SystemError('INVALID_ARGUMENT', `Invalid ${name}`);
}
function validate(service: ServiceDefinition): void {
  requireText(service.id, 'service id', /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/);
  requireText(service.target, 'service target');
  if (!['windows-service', 'scheduled-task', 'startup-shortcut', 'wsl-systemd', 'systemd', 'launchd', 'managed-process'].includes(service.kind)) throw new SystemError('INVALID_ARGUMENT', 'Unsupported service kind');
  if (['windows-service', 'systemd', 'wsl-systemd', 'launchd'].includes(service.kind)) requireText(service.target, 'service target', /^[a-zA-Z0-9_][a-zA-Z0-9_.@ -]*$/);
  if (service.kind === 'scheduled-task') {
    requireText(service.target, 'task name', /^[^\\/*?"<>|\0\r\n]+$/);
    if (service.taskPath !== undefined) requireText(service.taskPath, 'task path', /^\\(?:[^/*?"<>|\0\r\n]+\\)?$/);
  }
  if (service.kind === 'wsl-systemd') requireText(service.distribution, 'WSL distribution', /^[a-zA-Z0-9_][a-zA-Z0-9_. -]*$/);
  for (const field of ['executable', 'cwd', 'shortcutPath', 'startupPath', 'logPath'] as const) {
    if (service[field] !== undefined) { requireText(service[field], field); if (!path.isAbsolute(service[field]!)) throw new SystemError('INVALID_ARGUMENT', `${field} must be an absolute path`); }
  }
  if (service.args !== undefined && (!Array.isArray(service.args) || service.args.length > 256 || service.args.some(x => typeof x !== 'string' || x.length > 32_768 || /[\0\r\n]/.test(x)))) throw new SystemError('INVALID_ARGUMENT', 'Invalid executable arguments');
  if (service.processName !== undefined) requireText(service.processName, 'process name', /^[a-zA-Z0-9_. -]+$/);
}
function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new SystemError('INVALID_ARGUMENT', 'Log limit must be between 1 and 2000');
  return limit;
}
function identityMatches(left: ProcessIdentity, right: ProcessIdentity): boolean { return left.pid === right.pid && left.startedAt === right.startedAt; }
function cpuTotals() { return os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 }); }
function baseSnapshot(id: string): ServiceSnapshot { return { id, state: 'unknown', autostart: { enabled: null, trigger: 'unknown' }, processes: [], sampledAt: new Date().toISOString(), health: 'not-configured' }; }

export function createSystemAdapter(profileDir: string, options: PlatformOptions = {}): SystemAdapter {
  return new NativeSystemAdapter(profileDir, options);
}

class NativeSystemAdapter implements SystemAdapter {
  private readonly platform: NodeJS.Platform;
  private readonly run: Runner;
  private readonly managedDir: string;
  private previousCpu = cpuTotals();
  private readonly processCpu = new Map<number, { startedAt: string; cpu: number; at: number }>();
  private readonly locks = new Map<string, Promise<void>>();
  constructor(profileDir: string, options: PlatformOptions) { this.platform = options.platform ?? process.platform; this.run = options.run ?? commandRunner; this.managedDir = path.join(profileDir, 'system-managed'); }

  private async windows<T>(operation: string, payload: object = {}): Promise<T> {
    const input = Buffer.from(JSON.stringify({ operation, ...payload, protectedPids: [process.pid, process.ppid] }), 'utf8').toString('base64');
    const { stdout } = await this.run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', windowsScript, '-Payload', input], 120_000);
    let result: { ok: boolean; value?: T; error?: { code: string; message: string } };
    try { result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { throw new SystemError('INVALID_RESPONSE', 'Windows adapter returned an invalid response'); }
    if (!result.ok) throw new SystemError(result.error?.code ?? 'COMMAND_FAILED', result.error?.message ?? 'Windows operation failed');
    return result.value as T;
  }

  async resources(): Promise<ResourceSnapshot> {
    const next = cpuTotals(), delta = next.total - this.previousCpu.total;
    const cpuPercent = delta > 0 ? Math.max(0, Math.min(100, 100 * (1 - (next.idle - this.previousCpu.idle) / delta))) : null;
    this.previousCpu = next;
    const totalBytes = os.totalmem(), availableBytes = os.freemem();
    let disks: ResourceSnapshot['disks'] = [];
    const warnings: string[] = [];
    try {
      if (this.platform === 'win32') disks = await this.windows('disks');
      else {
        const { stdout } = await this.run('df', ['-kP']);
        disks = stdout.trim().split('\n').slice(1).flatMap(line => {
          const match = line.match(/^(.+?)\s+(\d+)\s+\d+\s+(\d+)\s+\d+%\s+(.+)$/);
          return match ? [{ name: match[4], totalBytes: Number(match[2]) * 1024, freeBytes: Number(match[3]) * 1024 }] : [];
        });
      }
    } catch (error) { warnings.push(`Disk sampling: ${(error as Error).message}`); }
    return { hostname: os.hostname(), platform: this.platform, sampledAt: new Date().toISOString(), cpuPercent, memory: { totalBytes, availableBytes, usedBytes: totalBytes - availableBytes }, disks, uptimeSeconds: os.uptime(), warnings };
  }

  async processes(): Promise<ProcessInfo[]> {
    const raw: RawProcess[] = this.platform === 'win32' ? await this.windows('processes') : await this.posixProcesses();
    const now = Date.now(), ids = new Set(raw.map(p => p.pid));
    for (const id of this.processCpu.keys()) if (!ids.has(id)) this.processCpu.delete(id);
    return raw.map(({ cpuMilliseconds, ...p }) => {
      if (typeof cpuMilliseconds === 'number') {
        const last = this.processCpu.get(p.pid);
        p.cpuPercent = last && last.startedAt === p.startedAt && now > last.at ? Math.max(0, Math.min(100, 100 * (cpuMilliseconds - last.cpu) / (now - last.at) / Math.max(1, os.cpus().length))) : null;
        this.processCpu.set(p.pid, { startedAt: p.startedAt, cpu: cpuMilliseconds, at: now });
      }
      return p;
    });
  }

  private async posixProcesses(): Promise<ProcessInfo[]> {
    const { stdout } = await this.run('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,lstart=,comm=']);
    return stdout.trim().split('\n').flatMap(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.{24})\s+(.+)$/);
      if (!match) return [];
      return [{ pid: Number(match[1]), parentPid: Number(match[2]), cpuPercent: Number(match[3]), memoryBytes: Number(match[4]) * 1024, startedAt: match[5], name: path.basename(match[6]), executable: match[6] }];
    });
  }

  private async processIdentity(pid: number): Promise<ProcessIdentity | null> {
    if (this.platform === 'win32') return this.windows('identity', { pid });
    return (await this.processes()).find(p => p.pid === pid) ?? null;
  }
  private recordPath(service: ServiceDefinition) { return path.join(this.managedDir, `${service.id}.json`); }
  private logPath(service: ServiceDefinition) { return service.logPath ?? path.join(this.managedDir, `${service.id}.log`); }
  private async record(service: ServiceDefinition): Promise<ManagedRecord | null> {
    try {
      const record = JSON.parse(await readFile(this.recordPath(service), 'utf8')) as ManagedRecord;
      if (!Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.startedAt !== 'string' || typeof record.executable !== 'string' || !Array.isArray(record.args)) throw new Error('Invalid managed process identity');
      return record;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new SystemError('STATE_INVALID', `Cannot read managed process identity: ${(error as Error).message}`); }
  }
  private async inspectManaged(service: ServiceDefinition): Promise<ServiceSnapshot> {
    const result = baseSnapshot(service.id), record = await this.record(service);
    const current = record ? await this.processIdentity(record.pid) : null;
    result.state = current && record && identityMatches(current, record) ? 'running' : 'stopped';
    result.processes = result.state === 'running' ? [{ pid: record!.pid, startedAt: record!.startedAt }] : [];
    result.autostart = { enabled: null, trigger: 'unsupported', detail: 'Managed processes have no OS autostart registration.' };
    if (record && current && !identityMatches(record, current)) result.message = 'Stored PID has been reused; the unrelated process is not controlled.';
    return result;
  }

  private async runningDistributions(): Promise<string[]> {
    const { stdout } = await this.run('wsl.exe', ['--list', '--running', '--quiet']);
    return stdout.replace(/\0/g, '').replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }
  private async systemctl(service: ServiceDefinition, args: string[]): Promise<CommandResult> {
    if (service.kind === 'wsl-systemd') return this.run('wsl.exe', ['--distribution', service.distribution!, '--user', 'root', '--exec', '/bin/systemctl', ...args], 120_000);
    return this.run('systemctl', args, 120_000);
  }
  private async inspectSystemd(service: ServiceDefinition): Promise<ServiceSnapshot> {
    const result = baseSnapshot(service.id);
    if (service.kind === 'wsl-systemd' && !(await this.runningDistributions()).includes(service.distribution!)) {
      result.state = 'stopped';
      result.autostart = { enabled: null, trigger: 'distribution-boot', detail: 'WSL is stopped; unit autostart was not queried to avoid starting the distribution.' };
    } else {
      const { stdout } = await this.systemctl(service, ['show', service.target, '--property=LoadState,ActiveState,SubState,UnitFileState,MainPID']);
      const data = Object.fromEntries(stdout.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim()]; }));
      result.state = data.LoadState === 'not-found' ? 'unavailable' : data.ActiveState === 'active' ? 'running' : data.ActiveState === 'activating' ? 'starting' : data.ActiveState === 'deactivating' ? 'stopping' : ['inactive', 'failed'].includes(data.ActiveState) ? 'stopped' : 'unknown';
      result.autostart = { enabled: ['enabled', 'enabled-runtime'].includes(data.UnitFileState) ? true : ['disabled', 'masked', 'masked-runtime'].includes(data.UnitFileState) ? false : null, trigger: service.kind === 'wsl-systemd' ? 'distribution-boot' : 'system-boot', detail: `UnitFileState=${data.UnitFileState || 'unknown'}; SubState=${data.SubState || 'unknown'}` };
      if (service.kind === 'wsl-systemd' && service.target === 'gitlab-runsvdir.service' && result.state === 'running') {
        let status: string;
        try { status = (await this.run('wsl.exe', ['--distribution', service.distribution!, '--user', 'root', '--exec', '/usr/bin/gitlab-ctl', 'status'])).stdout; }
        catch (error) {
          // gitlab-ctl returns nonzero for a down component, with status in stdout.
          if (error instanceof SystemError && error.code === 'COMMAND_FAILED' && /^(run|down):/m.test(error.message)) status = error.message;
          else throw error;
        }
        const components = status.split(/\r?\n/).filter(line => /^(run|down):/.test(line));
        const running = components.filter(line => line.startsWith('run:')).length;
        if (!components.length) { result.state = 'unknown'; result.message = 'runsvdir is active, but gitlab-ctl returned no recognizable component status.'; }
        else {
          result.state = running > 0 ? 'running' : 'stopped';
          result.message = `GitLab components running: ${running}/${components.length}.`;
          if (running !== components.length) result.health = 'unhealthy';
        }
      }
      // WSL PIDs belong to a different namespace and must never become host terminate targets.
      if (service.kind === 'systemd' && Number(data.MainPID) > 0) { const p = await this.processIdentity(Number(data.MainPID)); if (p) result.processes = [p]; }
    }
    if (service.kind === 'wsl-systemd' && service.shortcutPath && service.startupPath) {
      const shortcut = await this.windows<{ enabled: boolean }>('shortcut-autostart', { service });
      const unit = result.autostart.enabled;
      result.autostart = { enabled: unit === shortcut.enabled ? unit : null, trigger: 'windows-logon + distribution-boot', detail: `Windows logon=${shortcut.enabled ? 'enabled' : 'disabled'}; Linux unit=${unit === null ? 'unknown (distribution stopped or unit static)' : unit ? 'enabled' : 'disabled'}. ${result.autostart.detail ?? ''}` };
    }
    return result;
  }

  async inspect(service: ServiceDefinition): Promise<ServiceSnapshot> {
    validate(service);
    let result: ServiceSnapshot;
    if (service.kind === 'managed-process') result = await this.inspectManaged(service);
    else if (service.kind === 'wsl-systemd' && this.platform === 'win32' || service.kind === 'systemd' && this.platform === 'linux') result = await this.inspectSystemd(service);
    else if (this.platform === 'win32' && ['windows-service', 'scheduled-task', 'startup-shortcut'].includes(service.kind)) result = { ...baseSnapshot(service.id), ...await this.windows<Partial<ServiceSnapshot>>('inspect', { service }) };
    else if (service.kind === 'launchd' && this.platform === 'darwin') {
      result = baseSnapshot(service.id);
      const { stdout } = await this.run('launchctl', ['print', `gui/${process.getuid!()}/${service.target}`]);
      result.state = /state = running/.test(stdout) ? 'running' : 'stopped';
      result.autostart = { enabled: null, trigger: 'launchd', detail: 'LaunchAgent autostart editing is unsupported; manage its plist in macOS.' };
    } else throw new SystemError('UNSUPPORTED', `${service.kind} is not supported on ${this.platform}`);
    result.sampledAt = new Date().toISOString();
    if (service.healthUrl) {
      if (result.state !== 'running') result.health = 'unknown';
      else {
        let url: URL;
        try { url = new URL(service.healthUrl); } catch { throw new SystemError('INVALID_ARGUMENT', 'Invalid health URL'); }
        if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw new SystemError('INVALID_ARGUMENT', 'Health URL must use HTTP(S) on the local machine');
        try { const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' }); result.health = response.ok && result.health !== 'unhealthy' ? 'healthy' : 'unhealthy'; await response.body?.cancel(); } catch { result.health = 'unhealthy'; }
      }
    }
    return result;
  }

  async control(service: ServiceDefinition, action: SystemAction): Promise<void> {
    validate(service);
    if (!['start', 'stop', 'restart'].includes(action)) throw new SystemError('INVALID_ARGUMENT', 'Invalid service action');
    await this.serial(service.id, async () => {
      if (service.kind === 'managed-process') { await this.controlManaged(service, action); return; }
      if (service.kind === 'wsl-systemd' && this.platform === 'win32' || service.kind === 'systemd' && this.platform === 'linux') {
        if (service.kind === 'wsl-systemd' && action === 'stop' && !(await this.runningDistributions()).includes(service.distribution!)) return;
        if (service.target === 'gitlab-runsvdir.service' && service.kind === 'wsl-systemd') {
          const gitlab = (verb: string) => this.run('wsl.exe', ['--distribution', service.distribution!, '--user', 'root', '--exec', '/usr/bin/gitlab-ctl', verb], 120_000);
          if (action !== 'start') await gitlab('stop');
          await this.systemctl(service, [action, service.target]);
          if (action !== 'stop') await gitlab('start');
        } else await this.systemctl(service, [action, service.target]);
        return;
      }
      if (this.platform === 'win32' && ['windows-service', 'scheduled-task', 'startup-shortcut'].includes(service.kind)) { await this.windows('control', { service, action }); return; }
      if (service.kind === 'launchd' && this.platform === 'darwin') {
        const target = `gui/${process.getuid!()}/${service.target}`;
        await this.run('launchctl', action === 'stop' ? ['kill', 'SIGTERM', target] : ['kickstart', ...(action === 'restart' ? ['-k'] : []), target]); return;
      }
      throw new SystemError('UNSUPPORTED', `${service.kind} control is unsupported on ${this.platform}`);
    });
  }
  private async serial(id: string, work: () => Promise<void>) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work); this.locks.set(id, current);
    try { await current; } finally { if (this.locks.get(id) === current) this.locks.delete(id); }
  }
  private async controlManaged(service: ServiceDefinition, action: SystemAction) {
    const before = await this.inspectManaged(service);
    if (action !== 'start' && before.processes.length) {
      await this.terminateProcess(before.processes[0], false);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const current = await this.processIdentity(before.processes[0].pid);
        if (!current || !identityMatches(current, before.processes[0])) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const current = await this.processIdentity(before.processes[0].pid);
      if (current && identityMatches(current, before.processes[0])) throw new SystemError('STOP_TIMEOUT', 'The process did not exit; use explicit force termination if appropriate.');
    }
    if (action === 'stop' || action === 'start' && before.state === 'running') return;
    if (!service.executable || !path.isAbsolute(service.executable)) throw new SystemError('INVALID_ARGUMENT', 'Managed process requires a configured absolute executable');
    const metadata = await stat(service.executable);
    if (!metadata.isFile()) throw new SystemError('INVALID_ARGUMENT', 'Executable is not a file');
    await mkdir(this.managedDir, { recursive: true, mode: 0o700 });
    const fd = openSync(this.logPath(service), 'a', 0o600);
    const child = spawn(service.executable, service.args ?? [], { cwd: service.cwd, detached: true, windowsHide: true, shell: false, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    try { await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
    catch (error) { throw new SystemError((error as NodeJS.ErrnoException).code === 'EACCES' ? 'PERMISSION' : 'START_FAILED', (error as Error).message); }
    child.unref();
    let identity: ProcessIdentity | null;
    try { identity = await this.processIdentity(child.pid!); }
    catch (error) { child.kill(); throw error; }
    if (!identity) throw new SystemError('START_FAILED', 'Process exited before its identity could be recorded; inspect the service log.');
    const record: ManagedRecord = { ...identity, executable: service.executable, args: service.args ?? [], cwd: service.cwd };
    const temporary = `${this.recordPath(service)}.${process.pid}.tmp`;
    try { await writeFile(temporary, JSON.stringify(record), { mode: 0o600 }); await rename(temporary, this.recordPath(service)); }
    catch (error) { await this.terminateProcess(identity, true); throw new SystemError('STATE_WRITE_FAILED', `Process stopped because its identity could not be persisted: ${(error as Error).message}`); }
  }

  async setAutostart(service: ServiceDefinition, enabled: boolean): Promise<void> {
    validate(service);
    if (typeof enabled !== 'boolean') throw new SystemError('INVALID_ARGUMENT', 'Autostart enabled must be boolean');
    if (service.kind === 'managed-process') throw new SystemError('UNSUPPORTED', 'Managed process autostart is unsupported. Register an OS service, scheduled task or Startup shortcut.');
    await this.serial(service.id, async () => {
      if (service.kind === 'wsl-systemd' && this.platform === 'win32' || service.kind === 'systemd' && this.platform === 'linux') {
        await this.systemctl(service, [enabled ? 'enable' : 'disable', service.target]);
        if (service.kind === 'wsl-systemd' && service.shortcutPath && service.startupPath) await this.windows('set-shortcut-autostart', { service, enabled });
      } else if (this.platform === 'win32' && ['windows-service', 'scheduled-task', 'startup-shortcut'].includes(service.kind)) await this.windows('autostart', { service, enabled });
      else throw new SystemError('UNSUPPORTED', `Autostart editing is unsupported for ${service.kind} on ${this.platform}`);
    });
  }

  async logs(service: ServiceDefinition, limit: number): Promise<string> {
    validate(service); boundedLimit(limit);
    if (service.logPath || service.kind === 'managed-process') {
      try {
        // Bound reads, including a single giant log line, without loading an entire service log.
        const file = await open(this.logPath(service), 'r');
        try { const info = await file.stat(), size = Math.min(info.size, 1024 * 1024), buffer = Buffer.alloc(size); await file.read(buffer, 0, size, info.size - size); const text = buffer.toString('utf8'); return (info.size > size ? '[last 1 MiB]\n' : '') + text.split(/\r?\n/).slice(-limit).join('\n'); } finally { await file.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'No log file has been created.'; throw error; }
    }
    if (service.kind === 'wsl-systemd' && this.platform === 'win32') {
      if (!(await this.runningDistributions()).includes(service.distribution!)) return 'WSL is stopped. Logs were not queried to avoid starting the distribution.';
      return (await this.run('wsl.exe', ['--distribution', service.distribution!, '--user', 'root', '--exec', '/bin/journalctl', '-u', service.target, '-n', String(limit), '--no-pager', '-o', 'short-iso'])).stdout;
    }
    if (service.kind === 'systemd' && this.platform === 'linux') return (await this.run('journalctl', ['-u', service.target, '-n', String(limit), '--no-pager', '-o', 'short-iso'])).stdout;
    if (this.platform === 'win32' && ['windows-service', 'scheduled-task', 'startup-shortcut'].includes(service.kind)) return this.windows('logs', { service, limit });
    throw new SystemError('UNSUPPORTED', 'No log source is configured for this service');
  }

  async terminateProcess(identity: ProcessIdentity, force: boolean): Promise<void> {
    if (!identity || !Number.isSafeInteger(identity.pid) || identity.pid <= 4 || typeof identity.startedAt !== 'string' || !identity.startedAt || typeof force !== 'boolean') throw new SystemError('INVALID_ARGUMENT', 'A PID and its exact start identity are required');
    if ([process.pid, process.ppid].includes(identity.pid)) throw new SystemError('PROTECTED_PROCESS', 'The console and its parent process cannot be terminated');
    if (this.platform === 'win32') { await this.windows('terminate', { identity, force }); return; }
    const current = (await this.processes()).find(p => p.pid === identity.pid);
    if (!current) throw new SystemError('PROCESS_GONE', 'The process has already exited');
    if (!identityMatches(current, identity)) throw new SystemError('IDENTITY_MISMATCH', 'PID was reused; the current process was not terminated');
    if (protectedNames.test(current.name)) throw new SystemError('PROTECTED_PROCESS', 'System processes cannot be terminated');
    // POSIX has no portable pidfd API in Node; refresh immediately before sending the signal.
    const fresh = await this.processIdentity(identity.pid);
    if (!fresh || !identityMatches(fresh, identity)) throw new SystemError('IDENTITY_MISMATCH', 'Process identity changed before termination');
    try { process.kill(identity.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch (error) { throw new SystemError((error as NodeJS.ErrnoException).code === 'EPERM' ? 'PERMISSION' : 'PROCESS_GONE', (error as Error).message); }
  }
}
