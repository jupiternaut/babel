import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { useBabelRunActions } from '../babelWorkbench/useBabelRunActions';
import { BabelExecutionShell } from '../babelWorkbench/BabelExecutionShell';
import { clearWorkbenchSessionStateForTests } from '../babelWorkbench/babelDrafts';

afterEach(() => { cleanup(); clearWorkbenchSessionStateForTests(); });

function sourceFixture() {
  const state = {
    status: 'lost', revision: 7 as number | undefined, readOnly: false,
    runSuffix: 'current', allowed: true as boolean | undefined,
  };
  const task = (id: string) => {
    const run = { id: `${id}-${state.runSuffix}`, status: state.status };
    return { record: { revision: state.revision, system: { readOnly: state.readOnly }, fields: { title: id } },
      stage: 'RUNNING', binding: { latestRunId: run.id }, latestRun: run,
      runs: [run, { id: `${id}-old`, status: 'lost' }] };
  };
  const mock = {
    endpoint: 'http://127.0.0.1:7780', projectId: 'project-a',
    getTask: vi.fn(async (id: string) => task(id)),
    getCapabilities: vi.fn(async () => ({ actions: state.allowed === undefined ? {} : {
      'run.reconcile': { allowed: state.allowed, reason: state.allowed ? undefined : '禁止核对' },
    } })),
    queryRaw: vi.fn(async (name: string, input: Record<string, string>): Promise<Record<string, unknown>> => (
      name === 'history.get' ? { runs: task(input.trackerId).runs }
        : name === 'run.show' ? { run: { id: input.runId, status: 'lost' } } : {}
    )),
    subscribe: vi.fn(() => () => undefined),
    postRaw: vi.fn(async (_name: string, input: Record<string, unknown>, _revision?: number): Promise<Record<string, unknown>> => {
      state.status = String(input.resolution);
      return {};
    }),
  };
  return { state, mock, source: mock as unknown as BabelDemoTrackerDataSource };
}

it.each(['lost', 'cancel_requested'])('submits a confirmed %s reconciliation with the task revision and refreshes authority', async (status) => {
  const { state, mock, source } = sourceFixture();
  state.status = status;
  const { result } = renderHook(() => useBabelRunActions('a', source));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => { await result.current.reconcile('failed'); });
  expect(mock.postRaw).toHaveBeenCalledExactlyOnceWith('run.reconcile', { runId: 'a-current', resolution: 'failed' }, 7);
  expect(result.current.detail?.latestRun?.status).toBe('failed');
  expect(result.current.note).toContain('不代表真实 Worker 已停止');
});

it.each(['denied', 'missing-capability', 'readonly', 'missing-revision', 'terminal', 'old-run'] as const)(
  'rejects reconciliation for %s even if its callback is invoked', async (guard) => {
    const { state, mock, source } = sourceFixture();
    if (guard === 'denied') state.allowed = false;
    if (guard === 'missing-capability') state.allowed = undefined;
    if (guard === 'readonly') state.readOnly = true;
    if (guard === 'missing-revision') state.revision = undefined;
    if (guard === 'terminal') state.status = 'cancelled';
    const { result } = renderHook(() => useBabelRunActions('a', source));
    await waitFor(() => expect(result.current.busy).toBe(false));
    const captured = result.current.reconcile;
    if (guard === 'old-run') act(() => result.current.viewRun('a-old'));
    await act(async () => { await captured('cancelled'); await result.current.reconcile('failed'); });
    expect(mock.postRaw).not.toHaveBeenCalled();
  },
);

it.each(['task', 'source', 'run', 'revision', 'snapshot'] as const)('rejects a confirmation captured before a %s change', async (change) => {
  const first = sourceFixture(), second = sourceFixture();
  const { result, rerender } = renderHook(({ id, source }) => useBabelRunActions(id, source), {
    initialProps: { id: 'a', source: first.source },
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  const captured = result.current.reconcile;
  if (change === 'task' || change === 'source') {
    rerender({ id: change === 'task' ? 'b' : 'a', source: change === 'source' ? second.source : first.source });
    await waitFor(() => expect(result.current.busy).toBe(false));
  } else {
    if (change === 'run') first.state.runSuffix = 'new';
    if (change === 'revision') first.state.revision = 8;
    await act(async () => { await result.current.refresh(); });
  }
  await act(async () => { await captured('cancelled'); });
  expect(first.mock.postRaw).not.toHaveBeenCalled();
  expect(second.mock.postRaw).not.toHaveBeenCalled();
  if (change === 'run' || change === 'revision' || change === 'snapshot') {
    expect(result.current.note).toContain('执行信息已更新，请重新打开核对确认');
  } else {
    expect(result.current.note).toBeNull();
  }
});

function shell(id: string, source: BabelDemoTrackerDataSource) {
  return <BabelExecutionShell enabled trackerId={id} dataSource={source} onClose={() => undefined}>
    <div>Native detail</div>
  </BabelExecutionShell>;
}

it('requires a second confirmation, supports Escape, restores focus, and sends only the chosen demo result', async () => {
  const { mock, source } = sourceFixture();
  render(shell('a', source));
  const trigger = await screen.findByRole('button', { name: '核对演示执行' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '确认核对演示执行' });
  expect(mock.postRaw).not.toHaveBeenCalled();
  expect(dialog.textContent).toContain('不检测或终止真实 Worker');
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '返回' })));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(mock.postRaw).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('核对结果'), { target: { value: 'failed' } });
  fireEvent.click(trigger);
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认标记为失败' }));
  await waitFor(() => expect(mock.postRaw).toHaveBeenCalledExactlyOnceWith('run.reconcile', { runId: 'a-current', resolution: 'failed' }, 7));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('discards an open confirmation when task selection changes', async () => {
  const { mock, source } = sourceFixture();
  const { rerender } = render(shell('a', source));
  fireEvent.click(await screen.findByRole('button', { name: '核对演示执行' }));
  const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: '确认标记为已取消' });
  rerender(shell('b', source));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(confirm);
  expect(mock.postRaw).not.toHaveBeenCalled();
});

it.each(['readonly', 'capability'] as const)('disables the visible reconciliation entry for %s without opening a confirmation', async (guard) => {
  const { state, mock, source } = sourceFixture();
  if (guard === 'readonly') state.readOnly = true;
  else state.allowed = false;
  render(shell('a', source));
  const trigger = await screen.findByRole('button', { name: '核对演示执行' }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mock.postRaw).not.toHaveBeenCalled();
});

it('reports a refused reconciliation without inventing a terminal state', async () => {
  const { mock, source } = sourceFixture();
  mock.postRaw.mockRejectedValue(new Error('版本冲突，请刷新后再核对'));
  const { result } = renderHook(() => useBabelRunActions('a', source));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => { await result.current.reconcile('cancelled'); });
  expect(result.current.detail?.latestRun?.status).toBe('lost');
  expect(result.current.note).toContain('版本冲突');
  expect(result.current.busy).toBe(false);
});

it('deduplicates a pending reconciliation and keeps the next task draft and notice isolated', async () => {
  const { mock, source } = sourceFixture();
  let finish!: (value: Record<string, unknown>) => void;
  mock.postRaw.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ id }) => useBabelRunActions(id, source), { initialProps: { id: 'a' } });
  await waitFor(() => expect(result.current.busy).toBe(false));
  const captured = result.current.reconcile;
  let pending!: Promise<void>;
  act(() => { pending = captured('cancelled'); });
  await act(async () => { await captured('failed'); });
  expect(mock.postRaw).toHaveBeenCalledTimes(1);
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.updateDraft({ message: '新任务草稿' }));
  await act(async () => { finish({}); await pending; });
  expect(result.current.detail?.title).toBe('b');
  expect(result.current.draft.message).toBe('新任务草稿');
  expect(result.current.note).toBeNull();
});
