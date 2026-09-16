import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { useBabelRunActions } from '../babelWorkbench/useBabelRunActions';
import { clearWorkbenchSessionStateForTests } from '../babelWorkbench/babelDrafts';

afterEach(() => { cleanup(); clearWorkbenchSessionStateForTests(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function task(id: string) {
  const run = { id: `run-${id}`, status: 'review_required' };
  return { record: { revision: 1, fields: { title: id } }, stage: 'RUNNING',
    binding: { latestRunId: run.id }, latestRun: run, runs: [run, { id: `old-${id}`, status: 'failed' }] };
}

function mockSource(identity: { endpoint?: string; projectId?: string } = {}) {
  const mock = {
    endpoint: identity.endpoint ?? 'http://127.0.0.1:7780',
    projectId: identity.projectId ?? 'project-a',
    getTask: vi.fn(async (id: string) => task(id)),
    getCapabilities: vi.fn(async (_id: string) => ({ actions: { 'review.accept': { allowed: true } } })),
    queryRaw: vi.fn(async (name: string, input: Record<string, string>): Promise<Record<string, unknown>> => {
      if (name === 'artifact.list') return { artifacts: [{ name: input.runId }] };
      if (name === 'history.get') return { comments: [{ id: input.trackerId, body: input.trackerId }] };
      return { run: { id: input.runId, status: 'failed' } };
    }),
    subscribe: vi.fn((_listener: () => void) => () => undefined),
    startRun: vi.fn(async () => undefined),
    acceptReview: vi.fn(async (_id: string) => undefined),
    cancelRun: vi.fn(async (_id: string) => undefined),
    getDiff: vi.fn(async (_id: string) => undefined),
    postRaw: vi.fn(async (_name: string, _input: Record<string, unknown>): Promise<void> => undefined),
  };
  return { mock, source: mock as unknown as BabelDemoTrackerDataSource };
}

it.each(['endpoint', 'projectId'] as const)('isolates drafts and viewed runs by %s and restores a stable task identity', async (field) => {
  const first = mockSource();
  const second = mockSource({ [field]: field === 'endpoint' ? 'http://127.0.0.1:7781' : 'project-b' });
  const { result, rerender } = renderHook(({ id, source }) => useBabelRunActions(id, source), { initialProps: { id: 'a', source: first.source } });
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => {
    result.current.updateDraft({ message: 'A message', respondText: 'A answer', reviewComment: 'A review', startSummary: 'A plan' });
    result.current.viewRun('old-a');
  });
  await waitFor(() => expect(result.current.viewingRun?.id).toBe('old-a'));

  rerender({ id: 'a', source: second.source });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft).toEqual({ message: '', respondText: '', reviewComment: '', startSummary: '' });
  expect(result.current.viewingRunId).toBeNull();
  act(() => { result.current.updateDraft({ message: 'B message' }); result.current.viewRun('run-a'); });

  const rebuilt = mockSource();
  rerender({ id: 'a', source: rebuilt.source });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft.message).toBe('A message');
  expect(result.current.viewingRunId).toBe('old-a');
  rerender({ id: 'b', source: rebuilt.source });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft.message).toBe('');
  expect(result.current.viewingRunId).toBeNull();
  rerender({ id: 'a', source: rebuilt.source });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft.message).toBe('A message');
  expect(result.current.viewingRunId).toBe('old-a');
  rerender({ id: 'a', source: second.source });
  await waitFor(() => expect(result.current.busy).toBe(false));
  expect(result.current.draft.message).toBe('B message');
  expect(result.current.viewingRunId).toBe('run-a');
});

it('ignores a slow previous task response after selecting another task', async () => {
  const { mock, source } = mockSource();
  const old = deferred<ReturnType<typeof task>>();
  mock.getTask.mockImplementation(id => id === 'a' ? old.promise : Promise.resolve(task(id)));
  const { result, rerender } = renderHook(({ id }) => useBabelRunActions(id, source), { initialProps: { id: 'a' } });
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('b'));
  await act(async () => { old.resolve(task('a')); await old.promise; });
  expect(result.current.detail?.title).toBe('b');
  expect(result.current.artifacts[0]?.name).toBe('run-b');
  expect(result.current.history?.comments[0]?.body).toBe('b');
});

it('invalidates the previous source even when the tracker id stays the same', async () => {
  const first = mockSource(), second = mockSource();
  second.mock.getTask.mockResolvedValue(task('other-source'));
  const { result, rerender } = renderHook(({ source }) => useBabelRunActions('a', source), { initialProps: { source: first.source } });
  await waitFor(() => expect(result.current.detail?.title).toBe('a'));
  const previous = result.current;
  const old = deferred<ReturnType<typeof task>>();
  first.mock.getTask.mockReturnValue(old.promise);
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  rerender({ source: second.source });
  await waitFor(() => expect(result.current.detail?.title).toBe('other-source'));
  await act(async () => { await previous.accept(); old.resolve(task('a')); await pending; });
  expect(first.mock.acceptReview).not.toHaveBeenCalled();
  expect(result.current.detail?.title).toBe('other-source');
});

it('keeps the newest run snapshot after overlapping refreshes and rejects an obsolete run handler', async () => {
  const { mock, source } = mockSource();
  const { result } = renderHook(() => useBabelRunActions('a', source));
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('a'));
  const previous = result.current;
  const old = deferred<ReturnType<typeof task>>();
  const next = task('a');
  next.binding.latestRunId = 'run-a-2';
  next.latestRun.id = 'run-a-2';
  mock.getTask.mockImplementationOnce(() => old.promise).mockResolvedValue(next);
  let pending!: Promise<void>;
  act(() => { pending = result.current.refresh(); });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.detail?.bindingRunId).toBe('run-a-2');
  await act(async () => { old.resolve(task('a')); await pending; await previous.accept(); });
  expect(result.current.detail?.bindingRunId).toBe('run-a-2');
  expect(result.current.artifacts[0]?.name).toBe('run-a-2');
  expect(mock.acceptReview).not.toHaveBeenCalled();
  await act(async () => { await result.current.accept(); });
  expect(mock.acceptReview.mock.calls).toEqual([['run-a-2', 1]]);
});

it('disables actions while identity changes and rejects callbacks carrying the old run', async () => {
  const { mock, source } = mockSource();
  const next = deferred<ReturnType<typeof task>>();
  const { result, rerender } = renderHook(({ id }) => useBabelRunActions(id, source), { initialProps: { id: 'a' } });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('a'));
  const previous = result.current;
  mock.getTask.mockImplementation(id => id === 'b' ? next.promise : Promise.resolve(task(id)));
  rerender({ id: 'b' });
  expect(result.current.detail).toBeNull();
  expect(result.current.busy).toBe(true);
  await act(async () => { await result.current.accept(); await previous.accept(); await previous.cancel(); await previous.start(); });
  expect(mock.acceptReview).not.toHaveBeenCalled();
  expect(mock.cancelRun).not.toHaveBeenCalled();
  expect(mock.startRun).not.toHaveBeenCalled();
  await act(async () => { next.resolve(task('b')); await next.promise; });
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => { await previous.accept(); await result.current.accept(); });
  expect(mock.acceptReview.mock.calls).toEqual([['run-b', 1]]);
});

it.each(['artifact.list', 'history.get', 'run.show'])('ignores a late %s response after changing selection', async (heldQuery) => {
  const { mock, source } = mockSource();
  const old = deferred<Record<string, unknown>>();
  const { result, rerender } = renderHook(({ id }) => useBabelRunActions(id, source), { initialProps: { id: 'a' } });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('a'));
  const query = mock.queryRaw.getMockImplementation()!;
  let requested = false;
  mock.queryRaw.mockImplementation((name, input) => {
    if (name === heldQuery && (input.runId?.endsWith('-a') || input.trackerId === 'a')) { requested = true; return old.promise; }
    return query(name, input);
  });
  let refresh: Promise<void> | undefined;
  act(() => {
    if (heldQuery === 'run.show') result.current.viewRun('old-a');
    else refresh = result.current.refresh();
  });
  await waitFor(() => expect(requested).toBe(true));
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('b'));
  await act(async () => { old.resolve({ artifacts: [{ name: 'stale-a' }], comments: [{ id: 'a', body: 'stale-a' }], run: { id: 'old-a' } }); await refresh; });
  expect(result.current.artifacts[0]?.name).toBe('run-b');
  expect(result.current.history?.comments[0]?.body).toBe('b');
  expect(result.current.viewingRun).toBeNull();
});

it('keeps a new task draft and busy action when a previous task message completes', async () => {
  const { mock, source } = mockSource();
  const oldSend = deferred<void>(), newSend = deferred<void>();
  mock.postRaw.mockImplementation((_name, input) => input.runId === 'run-a' ? oldSend.promise : newSend.promise);
  const { result, rerender } = renderHook(({ id }) => useBabelRunActions(id, source), { initialProps: { id: 'a' } });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('a'));
  act(() => result.current.updateDraft({ message: 'A message' }));
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = result.current.sendMessage(); });
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.history?.comments[0]?.body).toBe('b'));
  act(() => result.current.updateDraft({ message: 'B message' }));
  act(() => { second = result.current.sendMessage(); });
  expect(result.current.busy).toBe(true);
  act(() => result.current.updateDraft({ message: 'B edited while sending' }));
  await act(async () => { oldSend.resolve(); await first; });
  expect(result.current.busy).toBe(true);
  expect(result.current.draft.message).toBe('B edited while sending');
  expect(result.current.detail?.title).toBe('b');
  await act(async () => { newSend.resolve(); await second; });
  expect(result.current.draft.message).toBe('B edited while sending');
  expect(result.current.busy).toBe(false);
});

it.each([
  ['message', false], ['message', true], ['respondText', false], ['respondText', true],
] as const)('keeps an in-flight %s locked after leaving and returning, with a newer draft: %s', async (field, editWhileSending) => {
  const first = mockSource(), rebuilt = mockSource();
  const sent = deferred<void>();
  first.mock.postRaw.mockReturnValue(sent.promise);
  const { result, rerender } = renderHook(({ id, source }) => useBabelRunActions(id, source), {
    initialProps: { id: 'a', source: first.source },
  });
  const send = () => field === 'message' ? result.current.sendMessage() : result.current.respond('request-a');
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.updateDraft({ [field]: 'send once' }));
  let pending!: Promise<void>;
  act(() => { pending = send(); });
  try {
    rerender({ id: 'b', source: first.source });
    await waitFor(() => expect(result.current.detail?.title).toBe('b'));
    expect(result.current.busy).toBe(false);
    rerender({ id: 'a', source: rebuilt.source });
    await waitFor(() => expect(result.current.detail?.title).toBe('a'));
    expect(result.current.busy).toBe(true);
    await act(async () => { await send(); });
    expect(rebuilt.mock.postRaw).not.toHaveBeenCalled();
    if (editWhileSending) act(() => result.current.updateDraft({ [field]: 'next unsent draft' }));
    await act(async () => { sent.resolve(); await pending; });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.draft[field]).toBe(editWhileSending ? 'next unsent draft' : '');
    expect(first.mock.postRaw).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { sent.resolve(); await pending; });
  }
});

it('refreshes selected run and review capability after another client writes', async () => {
  let stage = 'TODO';
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const source = {
    getTask: async () => ({ record: { revision: 2, fields: { title: 'same task' } }, stage,
      binding: { latestRunId: stage === 'TODO' ? null : 'external-run' },
      latestRun: stage === 'TODO' ? null : { id: 'external-run', status: 'review_required' } }),
    getCapabilities: async () => ({ actions: { 'review.accept': { allowed: stage === 'RUNNING' } } }),
    queryRaw: async () => ({}),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); unsubscribe(); }; },
  } as unknown as BabelDemoTrackerDataSource;
  const { result, unmount } = renderHook(() => useBabelRunActions('events-test', source));
  await waitFor(() => expect(result.current.detail?.stage).toBe('TODO'));
  act(() => { stage = 'RUNNING'; for (const listener of listeners) listener(); });
  await waitFor(() => expect(result.current.detail?.bindingRunId).toBe('external-run'));
  expect(result.current.caps['review.accept'].allowed).toBe(true);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});


it('keeps historical runs read-only even if a current-run action callback is invoked', async () => {
  const { mock, source } = mockSource();
  const { result } = renderHook(() => useBabelRunActions('a', source));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => { result.current.updateDraft({ message: 'do not send' }); result.current.viewRun('old-a'); });
  await waitFor(() => expect(result.current.viewingRun?.id).toBe('old-a'));
  await act(async () => {
    await result.current.start(); await result.current.cancel(); await result.current.accept();
    await result.current.sendMessage(); await result.current.showDiff();
  });
  expect(mock.startRun).not.toHaveBeenCalled(); expect(mock.cancelRun).not.toHaveBeenCalled();
  expect(mock.acceptReview).not.toHaveBeenCalled(); expect(mock.postRaw).not.toHaveBeenCalled();
  expect(mock.getDiff).toHaveBeenCalledWith('old-a');
});
