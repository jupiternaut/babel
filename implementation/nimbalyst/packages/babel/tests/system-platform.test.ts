// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { createSystemAdapter } from '../src/system/platform.ts';
import { SystemError, type ServiceDefinition } from '../src/system/types.ts';

const wsl: ServiceDefinition = { id: 'gitlab', label: 'GitLab', kind: 'wsl-systemd', target: 'gitlab-runsvdir.service', distribution: 'Ubuntu' };
const reply = (value: unknown) => ({ stdout: JSON.stringify({ ok: true, value }), stderr: '' });
const payload = (args: string[]) => JSON.parse(Buffer.from(args.at(-1)!, 'base64').toString());

describe('native system adapter boundaries', () => {
  it('rejects command targets, paths, malformed identities and unsupported autostart before execution', async () => {
    const run = vi.fn(async () => reply(null));
    const adapter = createSystemAdapter(os.tmpdir(), { platform: 'win32', run });
    await expect(adapter.control({ ...wsl, target: 'x; Remove-Item C:\\' }, 'start')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(adapter.control({ ...wsl, distribution: '--exec' }, 'start')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(adapter.control({ ...wsl, id: '../escape' }, 'start')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(adapter.control({ ...wsl, args: ['bad\0arg'] }, 'start')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(adapter.terminateProcess({ pid: process.pid, startedAt: 'x' }, true)).rejects.toMatchObject({ code: 'PROTECTED_PROCESS' });
    await expect(adapter.terminateProcess({ pid: 1, startedAt: 'x' }, true)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(adapter.setAutostart({ id: 'probe', label: 'Probe', kind: 'managed-process', target: 'probe' }, true)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(run).not.toHaveBeenCalled();
  });

  it('does not wake a stopped WSL distribution for inspect, logs, or stop', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const adapter = createSystemAdapter(os.tmpdir(), { platform: 'win32', run });
    expect(await adapter.inspect(wsl)).toMatchObject({ state: 'stopped', autostart: { enabled: null } });
    expect(await adapter.logs(wsl, 20)).toContain('avoid starting');
    await adapter.control(wsl, 'stop');
    expect(run.mock.calls).toEqual(Array.from({ length: 3 }, () => ['wsl.exe', ['--list', '--running', '--quiet']]));
  });

  it('reports mixed Windows/Linux autostart honestly and never exposes WSL PIDs as host PIDs', async () => {
    const run = vi.fn(async (file: string, args: string[]) => {
      if (file === 'powershell.exe') return reply({ enabled: false });
      if (args[0] === '--list') return { stdout: 'U\0b\0u\0n\0t\0u\0\r\0\n\0', stderr: '' };
      if (args.at(-1) === 'status') return { stdout: 'run: gitaly: (pid 100) 120s\nrun: puma: (pid 101) 120s', stderr: '' };
      return { stdout: 'LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=123', stderr: '' };
    });
    const adapter = createSystemAdapter(os.tmpdir(), { platform: 'win32', run });
    const result = await adapter.inspect({ ...wsl, shortcutPath: 'C:\\source.lnk', startupPath: 'C:\\startup\\source.lnk' });
    expect(result).toMatchObject({ state: 'running', processes: [], autostart: { enabled: null } });
    expect(result.autostart.detail).toContain('Windows logon=disabled; Linux unit=enabled');
  });

  it('coordinates GitLab service stop/start with its runsvdir unit using argument arrays', async () => {
    const run = vi.fn(async () => ({ stdout: 'Ubuntu\n', stderr: '' }));
    const adapter = createSystemAdapter(os.tmpdir(), { platform: 'win32', run });
    await adapter.control(wsl, 'restart');
    expect(run.mock.calls).toEqual([
      ['wsl.exe', ['--distribution', 'Ubuntu', '--user', 'root', '--exec', '/usr/bin/gitlab-ctl', 'stop'], 120000],
      ['wsl.exe', ['--distribution', 'Ubuntu', '--user', 'root', '--exec', '/bin/systemctl', 'restart', 'gitlab-runsvdir.service'], 120000],
      ['wsl.exe', ['--distribution', 'Ubuntu', '--user', 'root', '--exec', '/usr/bin/gitlab-ctl', 'start'], 120000],
    ]);
  });

  it('does not label GitLab running when its supervisor is active but every component is down', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === '--list') return { stdout: 'Ubuntu\n', stderr: '' };
      if (args.at(-1) === 'status') throw new SystemError('COMMAND_FAILED', 'down: puma: 0s, normally up\ndown: sidekiq: 0s, normally up');
      return { stdout: 'LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=123', stderr: '' };
    });
    expect(await createSystemAdapter(os.tmpdir(), { platform: 'win32', run }).inspect(wsl)).toMatchObject({ state: 'stopped', health: 'unhealthy', message: 'GitLab components running: 0/2.' });
  });

  it('preserves permission and PID reuse error codes from the native identity guard', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => ({ stdout: JSON.stringify({ ok: false, error: { code: payload(args).operation === 'terminate' ? 'IDENTITY_MISMATCH' : 'PERMISSION', message: 'guard rejected operation' } }), stderr: '' }));
    const adapter = createSystemAdapter(os.tmpdir(), { platform: 'win32', run });
    await expect(adapter.terminateProcess({ pid: 99001, startedAt: 'original-start' }, true)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
    await expect(adapter.control({ id: 'safe', label: 'Safe', kind: 'windows-service', target: 'SafeService' }, 'start')).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(payload(run.mock.calls[0][1])).toMatchObject({ identity: { pid: 99001, startedAt: 'original-start' } });
  });
});

describe.skipIf(process.platform !== 'win32')('Windows native behavior', () => {
  const bridge = fileURLToPath(new URL('../src/system/platform-windows.ps1', import.meta.url));
  async function scheduledFixture(failStart: boolean, operation = 'control', enabled = true) {
    const input = Buffer.from(JSON.stringify({ operation, action: 'start', enabled, service: { id: 'fixture', kind: 'scheduled-task', target: 'Fixture', taskPath: '\\' } })).toString('base64');
    const script = `
$global:trace = New-Object Collections.Generic.List[string]
$global:fixtureTask = [pscustomobject]@{TaskName='Fixture';TaskPath='\\';State='Ready';Settings=[pscustomobject]@{Enabled=$false};Triggers=@([pscustomobject]@{Enabled=$true;CimClass=[pscustomobject]@{CimClassName='MSFT_TaskLogonTrigger'}})}
function Get-ScheduledTask { param($TaskPath) return $global:fixtureTask }
function Enable-ScheduledTask { param($InputObject) $global:trace.Add('enable'); $global:fixtureTask.Settings.Enabled=$true }
function Disable-ScheduledTask { param($InputObject) $global:trace.Add('disable'); $global:fixtureTask.Settings.Enabled=$false }
function Set-ScheduledTask { param($InputObject) $global:trace.Add('set'); return $InputObject }
function Start-ScheduledTask { param($InputObject) $global:trace.Add('start'); ${failStart ? "throw 'fixture start failure'" : "$global:fixtureTask.State='Running'"} }
$result = & '${bridge.replaceAll("'", "''")}' -Payload '${input}' | ConvertFrom-Json
@{result=$result;trace=@($global:trace.ToArray());enabled=$global:fixtureTask.Settings.Enabled;triggerEnabled=$global:fixtureTask.Triggers[0].Enabled} | ConvertTo-Json -Depth 10 -Compress
`;
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    return JSON.parse(stdout.trim());
  }

  it('temporarily enables disabled task for manual start and restores it on success and failure', async () => {
    const success = await scheduledFixture(false);
    expect(success).toMatchObject({ result: { ok: true }, trace: ['enable', 'start', 'disable'], enabled: false });
    const failed = await scheduledFixture(true);
    expect(failed).toMatchObject({ result: { ok: false }, trace: ['enable', 'start', 'disable'], enabled: false });
  }, 20_000);

  it('edits only boot/logon triggers for autostart disable and clears task-level disable on explicit enable', async () => {
    const off = await scheduledFixture(false, 'autostart', false);
    expect(off).toMatchObject({ result: { ok: true }, trace: ['set'], triggerEnabled: false });
    const on = await scheduledFixture(false, 'autostart', true);
    expect(on).toMatchObject({ result: { ok: true }, trace: ['set', 'enable'], enabled: true, triggerEnabled: true });
  }, 20_000);

  it('samples real device resources and lists the real test process', async () => {
    const adapter = createSystemAdapter(os.tmpdir());
    const resources = await adapter.resources();
    expect(resources.memory.totalBytes).toBeGreaterThan(0);
    expect(resources.disks.some(d => d.totalBytes > d.freeBytes && d.freeBytes > 0)).toBe(true);
    const processes = await adapter.processes();
    expect(processes.find(p => p.pid === process.pid)?.startedAt).toMatch(/^\d{4}-/);
  }, 20_000);

  it.runIf(process.env.BABEL_NATIVE_TASK_TEST === '1')('starts an isolated disabled Windows task and restores its disabled flag', async context => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'babel-task-native-'));
    const script = path.join(directory, 'isolated-task.cjs');
    const service: ServiceDefinition = { id: 'isolated-task', label: 'Isolated task', kind: 'scheduled-task', target: `BabelIsolated-${path.basename(directory)}`, taskPath: '\\', executable: process.execPath, args: [script] };
    await writeFile(script, 'setInterval(() => {}, 1000);');
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const ps = async (body: string) => promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${body}`, 'utf16le').toString('base64')], { windowsHide: true });
    const adapter = createSystemAdapter(directory);
    let registered = false;
    try {
      try {
        await ps(`$action=New-ScheduledTaskAction -Execute ${literal(process.execPath)} -Argument ${literal('"' + script + '"')}; $trigger=New-ScheduledTaskTrigger -AtLogOn; $null=Register-ScheduledTask -TaskName ${literal(service.target)} -Action $action -Trigger $trigger -Description 'Temporary Babel native adapter acceptance test'; $null=Disable-ScheduledTask -TaskName ${literal(service.target)}`);
        registered = true;
      } catch (error) {
        if (/access.*denied|拒绝访问|0x80070005/i.test(String(error))) { context.skip('Task Scheduler registration denied by Windows permissions; no elevation requested.'); return; }
        throw error;
      }
      expect((await adapter.inspect(service)).autostart.enabled).toBe(false);
      await adapter.control(service, 'start');
      const running = await adapter.inspect(service);
      expect(running.state).toBe('running');
      expect(running.autostart.enabled).toBe(false);
      expect(running.processes.length).toBeGreaterThan(0);
      await adapter.control(service, 'stop');
      expect((await adapter.inspect(service)).state).toBe('stopped');
    } finally {
      if (registered) { await adapter.control(service, 'stop'); await ps(`Unregister-ScheduledTask -TaskName ${literal(service.target)} -Confirm:$false`); }
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
});

describe('isolated real managed process', () => {
  it('starts a local HTTP process once, persists identity/logs, rejects stale PID identity and restarts/stops it', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'babel-system-adapter-'));
    const script = path.join(directory, 'service.cjs'), ready = path.join(directory, 'ready.json');
    await writeFile(script, `const http = require('node:http'); const fs = require('node:fs'); const server = http.createServer((req,res)=>res.end('isolated-real-service')); server.listen(0,'127.0.0.1',()=>{ fs.writeFileSync(process.argv[2], JSON.stringify({port:server.address().port,pid:process.pid})); console.log('READY ' + process.argv[3]); });`);
    const literal = 'literal; $(never execute) & argument';
    const service: ServiceDefinition = { id: 'isolated-probe', label: 'Isolated probe', kind: 'managed-process', target: 'isolated-probe', executable: process.execPath, args: [script, ready, literal], cwd: directory };
    const adapter = createSystemAdapter(directory);
    try {
      await Promise.all([adapter.control(service, 'start'), adapter.control(service, 'start')]);
      const initial = await adapter.inspect(service);
      expect(initial.state).toBe('running');
      expect(initial.processes).toHaveLength(1);
      const listening = JSON.parse(await readFile(ready, 'utf8'));
      expect(listening.pid).toBe(initial.processes[0].pid);
      expect(await (await fetch(`http://127.0.0.1:${listening.port}`)).text()).toBe('isolated-real-service');
      expect(await adapter.logs(service, 100)).toContain(literal);
      const reloaded = createSystemAdapter(directory);
      expect((await reloaded.inspect(service)).processes).toEqual(initial.processes);
      await expect(reloaded.terminateProcess({ ...initial.processes[0], startedAt: '1970-01-01T00:00:00.0000000Z' }, true)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
      expect((await reloaded.inspect(service)).state).toBe('running');
      await reloaded.control(service, 'restart');
      const restarted = await reloaded.inspect(service);
      expect(restarted.state).toBe('running');
      expect(restarted.processes[0]).not.toEqual(initial.processes[0]);
      await reloaded.control(service, 'stop');
      expect((await adapter.inspect(service)).state).toBe('stopped');
      await expect(adapter.setAutostart(service, true)).rejects.toBeInstanceOf(SystemError);
    } finally {
      await adapter.control(service, 'stop');
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
