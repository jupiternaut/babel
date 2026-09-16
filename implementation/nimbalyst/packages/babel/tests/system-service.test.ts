// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SystemConsoleService } from '../src/system/service.ts';
import type { ServiceDefinition, ServiceSnapshot, SystemAdapter } from '../src/system/types.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'babel-system-test-')); dirs.push(dir);
  let running = false, calls = 0;
  const row: ServiceDefinition = { id: 'test', label: 'Test', kind: 'managed-process', target: 'test' };
  const snap = (): ServiceSnapshot => ({ id: row.id, state: running ? 'running' : 'stopped', autostart: { enabled: false, trigger: 'none' }, health: 'not-configured', sampledAt: new Date().toISOString(), processes: [] });
  const adapter: SystemAdapter = {
    resources: async () => { throw new Error('unused'); }, processes: async () => [],
    inspect: async () => snap(), control: async (_, action) => { calls++; running = action !== 'stop'; },
    setAutostart: async () => {}, logs: async () => '', terminateProcess: async () => { calls++; },
  };
  return { dir, row, adapter, calls: () => calls };
}
it('serializes duplicate requests and persists replay without repeating the system effect', async () => {
  const f = fixture(); const service = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  const cmd = { name: 'service.start' as const, serviceId: 'test', requestId: 'same' };
  const [a, b] = await Promise.all([service.command(cmd), service.command(cmd)]);
  expect(a.status).toBe('succeeded'); expect(b.id).toBe(a.id); expect(f.calls()).toBe(1);
  const reopened = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  expect((await reopened.command(cmd)).id).toBe(a.id); expect(f.calls()).toBe(1);
  await expect(reopened.command({ ...cmd, name: 'service.stop' })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('does not report success when the operating system does not reflect the requested autostart', async () => {
  const f = fixture(); const service = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  const op = await service.command({ name: 'service.autostart', serviceId: 'test', enabled: true, requestId: 'auto' });
  expect(op.status).toBe('failed'); expect(op.error?.code).toBe('VERIFY_FAILED');
  expect(JSON.parse(readFileSync(path.join(f.dir, 'system-state.json'), 'utf8')).operations[0].status).toBe('failed');
});
it('rejects unknown services and invalid process identity before invoking the operating system', async () => {
  const f = fixture(); const service = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  await expect(service.command({ name: 'service.start', serviceId: 'other', requestId: 'bad' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.command({ name: 'process.terminate', process: { pid: 0, startedAt: '' }, requestId: 'bad2' })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(f.calls()).toBe(0);
});
it('refuses a missing dependency without starting either service', async () => {
  const f = fixture(); f.row.dependsOn = ['missing'];
  expect(() => new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter })).toThrow(/依赖/);
  expect(f.calls()).toBe(0);
});
it('blocks stop and restart until every reverse dependency is explicitly stopped', async () => {
  const f = fixture();
  const dependent = { ...f.row, id: 'dependent', dependsOn: ['test'] };
  let dependencyState: ServiceSnapshot['state'] = 'running';
  f.adapter.inspect = async row => ({ id: row.id, state: row.id === 'dependent' ? dependencyState : 'running', autostart: { enabled: false, trigger: 'none' }, health: 'not-configured', sampledAt: new Date().toISOString(), processes: [] });
  const service = new SystemConsoleService({ profileDir: f.dir, services: [f.row, dependent], adapter: f.adapter });
  for (const state of ['running', 'starting', 'stopping', 'unknown', 'unavailable'] as const) {
    dependencyState = state;
    for (const name of ['service.stop', 'service.restart'] as const) {
      const op = await service.command({ name, serviceId: 'test', requestId: `${name}-${state}` });
      expect(op.error?.code).toBe('DEPENDENCY');
    }
  }
  expect(f.calls()).toBe(0);
  dependencyState = 'stopped';
  expect((await service.command({ name: 'service.restart', serviceId: 'test', requestId: 'safe-restart' })).status).toBe('succeeded');
  expect(f.calls()).toBe(1);
});
it('writes interrupted state on recovery and never replays an uncertain side effect automatically', async () => {
  const f = fixture(); let resolve!: () => void;
  f.adapter.control = async () => new Promise<void>(r => { resolve = r; });
  const service = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  const pending = service.command({ name: 'service.start', serviceId: 'test', requestId: 'crash' });
  await new Promise(r => setTimeout(r, 20));
  const recovered = new SystemConsoleService({ profileDir: f.dir, services: [f.row], adapter: f.adapter });
  expect((await recovered.query({ name: 'operations' }) as Array<{status: string}>)[0].status).toBe('interrupted');
  const again = await recovered.command({ name: 'service.start', serviceId: 'test', requestId: 'crash' });
  expect(again.status).toBe('interrupted');
  resolve(); await pending;
});
