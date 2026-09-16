// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BabelDemoTrackerDataSource } from '../BabelDemoTrackerDataSource';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function makeSource(invoke: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('electronAPI', { invoke });
  const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
  const eventSpy = vi.fn(); vi.stubGlobal('EventSource', eventSpy);
  const source = new BabelDemoTrackerDataSource({ workspacePath: '/tmp/pi-work', projectId: 'local-project', mode: 'local' });
  return { source, fetchSpy, eventSpy };
}
it('routes local commands through IPC with the confirmed target and revision, without renderer auth or HTTP', async () => {
  const invoke = vi.fn(async () => ({ ok: true }));
  const { source, fetchSpy, eventSpy } = makeSource(invoke);
  const target = { workdir: '/tmp/pi-work', provider: 'provider', model: 'model' };
  await source.startRun('a', 'once', 5, target);
  expect(invoke).toHaveBeenCalledWith('babel-local:command', '/tmp/pi-work', {
    name: 'run.start', projectId: 'local-project', input: { trackerId: 'a', executionTarget: target }, expectedRevision: 5, idempotencyKey: 'once',
  });
  await source.postRaw('run.message', { runId: 'run-a', text: 'message', clientMessageId: 'message-attempt' }, undefined, 'message-attempt');
  expect(invoke).toHaveBeenLastCalledWith('babel-local:command', '/tmp/pi-work', {
    name: 'run.message', projectId: 'local-project', input: { runId: 'run-a', text: 'message', clientMessageId: 'message-attempt' }, expectedRevision: undefined, idempotencyKey: 'message-attempt',
  });
  expect(fetchSpy).not.toHaveBeenCalled(); expect(eventSpy).not.toHaveBeenCalled(); source.dispose();
});
it('never falls back to unauthenticated HTTP if IPC is missing or rejects', async () => {
  const invoke = vi.fn(async () => ({ ok: false, code: 'UNAUTHORIZED', message: 'Rejected' }));
  const { source, fetchSpy } = makeSource(invoke);
  await expect(source.getTask('a')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  vi.stubGlobal('electronAPI', undefined);
  await expect(source.getTask('a')).rejects.toMatchObject({ code: 'BABEL_LOCAL_CONNECTION' });
  expect(fetchSpy).not.toHaveBeenCalled(); source.dispose();
});
it('polls committed events without skipping a limited batch and stops on unsubscribe', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn(async (_channel, _workspace, body) => {
    if (body.name === 'events.list') return { cursor: '999', events: [{ cursor: '7', trackerId: 'a' }] };
    return { record: { id: 'a', projectId: 'local-project', primaryType: 'task', archived: false, fields: { title: 'a' }, system: { workspace: '/tmp/pi-work', createdAt: 'now', updatedAt: 'now' } }, stage: 'RUNNING' };
  });
  const { source, eventSpy } = makeSource(invoke);
  const listener = vi.fn(); const unsubscribe = source.subscribe(listener);
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'items-upserted' }));
  await vi.advanceTimersByTimeAsync(1000);
  const polls = invoke.mock.calls.filter((call) => call[2].name === 'events.list');
  expect(polls[1][2].input.cursor).toBe('7');
  unsubscribe(); const calls = invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(calls); expect(eventSpy).not.toHaveBeenCalled(); source.dispose();
});
