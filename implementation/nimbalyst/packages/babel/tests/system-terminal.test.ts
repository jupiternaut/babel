// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SystemClient } from '../src/system/client.ts';
import { parseSystemArgs, runSystemCli, systemRequest } from '../src/system/cli.ts';
import { runCli } from '../src/cli/run.ts';
import { SystemTui } from '../src/system/tui.ts';
import { InputDecoder } from '../src/tui/input.ts';
import { displayWidth } from '../src/tui/width.ts';
import type { ConsoleCommand, ConsoleQuery, Operation, ProcessInfo, ResourceSnapshot, ServiceDefinition, ServiceSnapshot } from '../src/system/types.ts';

const resources: ResourceSnapshot = { hostname: '测试设备', platform: 'win32', sampledAt: '2026-09-16T00:00:00Z', cpuPercent: 5, memory: { totalBytes: 1000, usedBytes: 500, availableBytes: 500 }, disks: [], uptimeSeconds: 50, warnings: [] };
const definition: ServiceDefinition = { id: 'test-service', label: '测试服务', target: 'fixture', kind: 'managed-process' };
const snapshot: ServiceSnapshot = { id: definition.id, state: 'stopped', autostart: { enabled: false, trigger: '登录' }, processes: [], sampledAt: resources.sampledAt, health: 'not-configured' };
const processRow: ProcessInfo = { pid: 456, startedAt: '2026-09-16T01:02:03.000Z', name: '测试进程', cpuPercent: null, memoryBytes: 2048 };
const operation = (command: ConsoleCommand, status: Operation['status'] = 'succeeded'): Operation => ({ id: 'op-1', requestId: command.requestId, action: command.name, targetId: command.serviceId ?? String(command.process?.pid), requestedAt: resources.sampledAt, status, ...(status === 'failed' ? { error: { code: 'ACCESS_DENIED', message: '需要权限' } } : {}) });

describe('system terminal authenticated HTTP boundary', () => {
  let profile: string;
  let server: Server;
  let endpoint: string;
  let calls: Array<{ path: string; body: ConsoleCommand | ConsoleQuery; auth?: string }>;
  let commandStatus: Operation['status'];
  let redirect = false;
  beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'babel-system-terminal-'));
    await writeFile(join(profile, 'service.token'), 'fixture-secret-do-not-print');
    calls = []; commandStatus = 'succeeded'; redirect = false;
    server = createServer(async (req, res) => {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw) as ConsoleCommand | ConsoleQuery;
      calls.push({ path: req.url!, body, auth: req.headers.authorization });
      if (redirect) { res.writeHead(302, { location: '/other' }); res.end(); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/command') res.end(JSON.stringify({ ok: true, result: operation(body as ConsoleCommand, commandStatus) }));
      else res.end(JSON.stringify({ ok: true, result: body.name === 'resources' ? resources : body.name === 'services' ? { services: [{ definition, snapshot }] } : [] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(profile, { recursive: true, force: true }); });
  async function cli(args: string[], routed = false) {
    let stdout = ''; let stderr = '';
    const io = { stdout: { write(text: string) { stdout += text; } }, stderr: { write(text: string) { stderr += text; } } };
    const options = [...args, '--profile', profile, '--endpoint', endpoint];
    const code = await (routed ? runCli(['system', ...options], io) : runSystemCli(options, io));
    expect(stdout + stderr).not.toContain('fixture-secret-do-not-print');
    return { code, json: JSON.parse(stdout) };
  }
  it('routes the real system namespace and carries profile bearer auth', async () => {
    const result = await cli(['resources'], true);
    expect(result).toEqual({ code: 0, json: { ok: true, result: resources } });
    expect(calls).toEqual([{ path: '/v1/query', body: { name: 'resources' }, auth: 'Bearer fixture-secret-do-not-print' }]);
    const events = await cli(['events', '--after', '42', '--limit', '20']);
    expect(events.code).toBe(0);
    expect(calls[1].body).toEqual({ name: 'events', after: 42, limit: 20 });
  });
  it('does not turn a failed or interrupted operation into a successful exit', async () => {
    for (const status of ['failed', 'interrupted', 'running'] as const) {
      commandStatus = status;
      const result = await cli(['start', 'test-service']);
      expect(result.code).toBe(1); expect(result.json.ok).toBe(false); expect(result.json.result.status).toBe(status);
    }
    commandStatus = 'succeeded';
    expect((await cli(['autostart', 'test-service', 'on'])).code).toBe(0);
    expect(calls[3].body).toMatchObject({ name: 'service.autostart', enabled: true, serviceId: 'test-service' });
  });
  it('preserves caller request IDs across retries and reports an uncertain request ID', async () => {
    const retryArgs = ['restart', 'test-service', '--request-id', 'deploy_20260916-01'];
    expect((await cli(retryArgs)).code).toBe(0);
    expect((await cli(retryArgs)).code).toBe(0);
    expect(calls[0].body).toEqual(calls[1].body);
    expect(calls[0].body).toMatchObject({ requestId: 'deploy_20260916-01' });
    redirect = true;
    const uncertain = await cli(retryArgs);
    expect(uncertain.code).toBe(4);
    expect(uncertain.json.requestId).toBe('deploy_20260916-01');
    expect((await cli(['resources', '--request-id', 'bad-read'])).code).toBe(2);
    expect((await cli(['start', 'test-service', '--request-id', 'has:colon'])).code).toBe(2);
    expect(calls).toHaveLength(3);
  });
  it('passes exact process identity, rejects ambiguous arguments, and refuses credential redirects', async () => {
    expect((await cli(['terminate', '456', processRow.startedAt])).code).toBe(0);
    expect(calls[0].body).toMatchObject({ name: 'process.terminate', process: { pid: 456, startedAt: processRow.startedAt }, force: false });
    expect((await cli(['terminate', '456'])).code).toBe(2);
    expect((await cli(['resources', '--after', '5'])).code).toBe(2);
    expect(calls).toHaveLength(1);
    redirect = true;
    expect((await cli(['resources'])).code).toBe(4);
    expect(calls).toHaveLength(2);
    expect(() => new SystemClient({ profile, endpoint: 'http://example.org' })).toThrow('仅支持');
    await rm(join(profile, 'service.token'));
    expect((await cli(['resources'])).code).toBe(3);
    expect(calls).toHaveLength(2);
  });
});

describe('system TUI interaction and polling', () => {
  function fixture() {
    const commands: ConsoleCommand[] = [];
    let status: Operation['status'] = 'succeeded';
    let failed = false;
    const client = {
      async query<T>(query: ConsoleQuery): Promise<T> {
        if (failed) throw new Error('connection failed');
        return (query.name === 'resources' ? resources : query.name === 'services' ? { services: [{ definition, snapshot }] } : query.name === 'processes' ? [processRow] : query.name === 'logs' ? { text: '中文日志\n\x1b]52;c;injection\x07' } : []) as T;
      },
      async command(command: ConsoleCommand) { commands.push(command); return operation(command, status); },
    };
    let quit = false;
    const app = new SystemTui(client, () => {}, () => { quit = true; });
    const key = (text: string) => app.handle({ type: 'text', text });
    return { app, key, commands, setStatus(value: Operation['status']) { status = value; }, fail() { failed = true; }, quit: () => quit };
  }
  it('supports keyboard and mouse service operations and retains failed outcomes', async () => {
    const f = fixture(); await f.app.refresh(); f.app.render(100, 24);
    await f.app.handle(new InputDecoder().push('\x1b[<0;2;23M')[0]);
    expect(f.commands[0]).toMatchObject({ name: 'service.start', serviceId: definition.id });
    await f.key('a'); expect(f.commands[1]).toMatchObject({ name: 'service.autostart', enabled: true });
    f.setStatus('failed'); await f.key('x'); expect(f.app.error).toBe(true); expect(f.app.status).toContain('需要权限');
    await f.key('l'); expect(f.app.logs).toContain('中文日志');
    const screen = f.app.render(70, 20);
    expect(screen).not.toContain('\x1b]52');
    for (const line of screen.split(/\x1b\[\d+;1H/).slice(1)) expect(displayWidth(line.replace(/\x1b\[2K/g, ''))).toBeLessThan(70);
  });
  it('freezes exact identity for confirmation and never kills a process on quit/cancel', async () => {
    const f = fixture(); await f.key('2'); await f.key('x');
    expect(f.commands).toHaveLength(0);
    f.app.processes = [{ ...processRow, startedAt: 'different-process' }];
    await f.key('y'); expect(f.commands[0].process).toEqual({ pid: 456, startedAt: processRow.startedAt });
    await f.key('x'); await f.key('n'); expect(f.commands).toHaveLength(1);
    await f.app.handle(new InputDecoder().push('\x03')[0]);
    expect(f.quit()).toBe(true); expect(f.app.closed).toBe(true); expect(f.commands).toHaveLength(1);
  });
  it('does not overlap refresh cycles and labels retained data when disconnected', async () => {
    let release!: () => void; let calls = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const app = new SystemTui({ async query<T>(query: ConsoleQuery) { calls++; await pending; return (query.name === 'resources' ? resources : { services: [] }) as T; }, async command(command) { return operation(command); } });
    const first = app.refresh(); await app.refresh(); expect(calls).toBe(2); release(); await first;
    const f = fixture(); await f.app.refresh(); f.fail(); await f.app.refresh();
    expect(f.app.resources).toEqual(resources); expect(f.app.error).toBe(true); expect(f.app.status).toContain('上次成功快照');
    await f.key('/'); await f.key('测试'); await f.app.handle({ type: 'key', name: 'enter', raw: '\r', ctrl: false, shift: false });
    expect(f.app.serviceRows).toHaveLength(1);
  });
});

it('CLI validates explicit flags and keeps event cursor zero', () => {
  expect(systemRequest(parseSystemArgs(['events', '--after=0']))).toEqual({ name: 'events', after: 0 });
  expect(() => parseSystemArgs(['history', '--limit=0'])).toThrow();
  expect(() => parseSystemArgs(['resources', '--profile'])).toThrow();
  expect(() => systemRequest(parseSystemArgs(['autostart', 'id', 'maybe']))).toThrow();
  for (const command of [['start', 'id'], ['stop', 'id'], ['restart', 'id'], ['autostart', 'id', 'on'], ['terminate', '456', processRow.startedAt]]) {
    expect(systemRequest(parseSystemArgs([...command, '--request-id=stable-1']))).toMatchObject({ requestId: 'stable-1' });
  }
  for (const id of ['__proto__', 'constructor', 'a:b', 'a/b', 'a'.repeat(129)]) expect(() => parseSystemArgs(['start', 'id', '--request-id', id])).toThrow();
});
