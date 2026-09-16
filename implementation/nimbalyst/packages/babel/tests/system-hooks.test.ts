// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SystemHooks, runSystemHook } from '../src/system/hooks.ts';
import type { ConsoleEvent } from '../src/system/types.ts';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const temp = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'system-hooks-')); dirs.push(dir); return dir; };
const hook = { id: 'audit', executable: process.execPath, args: ['-e', 'process.exit(0)'] };
const events: ConsoleEvent[] = [1,2].map(seq => ({ seq, type: 'operation.succeeded', at: new Date().toISOString(), operationId: `op-${seq}`, targetId: 'test' }));
it('persists observation acknowledgements and resumes without replaying acknowledged events', async () => {
  const profile = temp(); const received: number[] = [];
  const read = async (after: number) => events.filter(e => e.seq > after);
  const run = async (_: unknown, payload: any) => { received.push(payload.event.seq); };
  await new SystemHooks(profile, { observers: [hook] }, run).drain(read);
  await new SystemHooks(profile, { observers: [hook] }, run).drain(read);
  expect(received).toEqual([1,2]);
});
it('observer failure retains the cursor for retry and never executes a business command', async () => {
  const profile = temp(); let count = 0;
  const hooks = new SystemHooks(profile, { observers: [hook] }, async () => { count++; throw new Error('unavailable'); });
  await hooks.drain(async after => events.filter(e => e.seq > after));
  await hooks.drain(async () => events);
  expect(count).toBe(1);
  const saved = JSON.parse(readFileSync(path.join(profile, 'hook-deliveries.json'), 'utf8'));
  expect(saved.deliveries.audit.seq).toBe(0);
  saved.deliveries.audit.retryAt = 0;
  writeFileSync(path.join(profile, 'hook-deliveries.json'), JSON.stringify(saved));
  const replay: number[] = [];
  await new SystemHooks(profile, { observers: [hook] }, async (_, p: any) => { replay.push(p.event.seq); }).drain(async () => events);
  expect(replay).toEqual([1,2]);
});
it('required validation failure rejects the operation', async () => {
  const hooks = new SystemHooks(temp(), { before: [hook] }, async () => { throw new Error('denied'); });
  await expect(hooks.before({ name: 'service.start', serviceId: 'test', requestId: 'one' })).rejects.toThrow('denied');
});
it('executes a real isolated hook with JSON stdin and bounds failures and timeout', async () => {
  await runSystemHook({ ...hook, args: ['-e', "let s=''; process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.exit(JSON.parse(s).type==='test'?0:4))"] }, { type: 'test' });
  await expect(runSystemHook({ ...hook, args: ['-e', 'process.exit(7)'] }, {})).rejects.toMatchObject({ code: 'HOOK_REJECTED' });
  await expect(runSystemHook({ ...hook, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }, {})).rejects.toMatchObject({ code: 'HOOK_TIMEOUT' });
});
