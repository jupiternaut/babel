// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { BabelRunControls } from '../BabelRunControls';
import { BabelExecutionShell } from '../babelWorkbench/BabelExecutionShell';
import { clearWorkbenchSessionStateForTests } from '../babelWorkbench/babelDrafts';

afterEach(() => { cleanup(); clearWorkbenchSessionStateForTests(); });
const target = { workdir: '/tmp/pi-project', provider: 'test-provider', model: 'test-model' };
function setup(mode: 'local' | 'demo' = 'local', running = false) {
  const listeners = new Set<() => void>();
  let revision = 4;
  let configuredTarget = { ...target };
  const startRun = vi.fn(async () => undefined);
  const postRaw = vi.fn(async () => undefined);
  const source = {
    endpoint: 'http://127.0.0.1:7781', projectId: 'local-project', mode: 'demo',
    getTask: async (id: string) => ({
      mode, executionTarget: mode === 'local' ? { ...configuredTarget } : undefined,
      record: { revision, fields: { title: `任务 ${id}` } }, stage: running ? 'RUNNING' : 'TODO',
      latestRun: running ? { id: 'run-a', status: 'executing', sessionId: 'pi-session-1', execution: { kind: 'pi', ...target },
        messages: [{ id: 'tool-1', role: 'tool', text: '工具开始\n尚未结束', at: 'now' }] } : null,
    }),
    getCapabilities: async () => ({ actions: { 'run.start': { allowed: true } } }),
    queryRaw: async () => ({}),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    startRun, postRaw,
  };
  return { source: source as unknown as BabelDemoTrackerDataSource, startRun, postRaw,
    refresh: () => { for (const listener of listeners) listener(); },
    changeTarget: () => { configuredTarget = { ...target, model: 'another-model' }; for (const listener of listeners) listener(); },
    update: () => { revision++; for (const listener of listeners) listener(); } };
}

it('requires a reviewable local target confirmation and cancelling never starts Pi', async () => {
  const { source, startRun } = setup();
  render(<BabelRunControls trackerId="a" dataSource={source} />);
  const start = await screen.findByRole('button', { name: '开始执行' });
  await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
  start.focus();
  fireEvent.click(start);
  const dialog = screen.getByRole('dialog', { name: '确认开始 Pi 执行' });
  for (const text of ['任务 a', target.workdir, target.provider, target.model]) expect(dialog.textContent).toContain(text);
  expect(startRun).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '返回' }));
  expect(startRun).not.toHaveBeenCalled();
  fireEvent.click(start);
  fireEvent.keyDown(screen.getByRole('dialog', { name: '确认开始 Pi 执行' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(start));
  expect(startRun).not.toHaveBeenCalled();
  fireEvent.click(start);
  fireEvent.click(screen.getByRole('button', { name: '确认开始执行' }));
  await waitFor(() => expect(startRun).toHaveBeenCalledWith('a', expect.any(String), 4, target));
  expect(screen.queryByText(/demo run/)).toBeNull();
});

it.each(['identical', 'changed-target'] as const)('keeps confirmed start bound to its semantic snapshot after %s refresh', async (change) => {
  const { source, startRun, refresh, changeTarget } = setup();
  render(<BabelRunControls trackerId="a" dataSource={source} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '开始执行' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始执行' }));
  await act(async () => { if (change === 'identical') refresh(); else changeTarget(); });
  fireEvent.click(screen.getByRole('button', { name: '确认开始执行' }));
  await act(async () => {});
  if (change === 'identical') expect(startRun).toHaveBeenCalledWith('a', expect.any(String), 4, target);
  else {
    expect(startRun).not.toHaveBeenCalled();
    expect(screen.getByText('任务或执行目标已变化，请重新确认后开始。')).toBeTruthy();
  }
});

it.each(['selection', 'revision'] as const)('never redirects a frozen local start after %s changes', async (change) => {
  const { source, startRun, update } = setup();
  const { rerender } = render(<BabelRunControls trackerId="a" dataSource={source} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '开始执行' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始执行' }));
  if (change === 'selection') rerender(<BabelRunControls trackerId="b" dataSource={source} />);
  else await act(async () => { update(); });
  fireEvent.click(screen.getByRole('button', { name: '确认开始执行' }));
  await act(async () => {});
  expect(startRun).not.toHaveBeenCalled();
});

it('keeps demo start behavior without the local execution confirmation', async () => {
  const { source, startRun } = setup('demo');
  render(<BabelRunControls trackerId="a" dataSource={source} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '开始模拟' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始模拟' }));
  await waitFor(() => expect(startRun).toHaveBeenCalledWith('a', expect.any(String)));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('uses authoritative local mode and displays Pi identity without claiming tool completion', async () => {
  const { source, postRaw } = setup('local', true);
  render(<BabelExecutionShell enabled trackerId="a" dataSource={source} onClose={() => {}}><p>任务详情</p></BabelExecutionShell>);
  await screen.findByText(target.workdir);
  expect(screen.getByText(`${target.provider} / ${target.model}`)).toBeTruthy();
  expect(screen.getByText('pi-session-1')).toBeTruthy();
  expect(screen.queryByText('演示数据')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '会话' }));
  expect(screen.queryByText(/工具开始.*已完成/)).toBeNull();
  fireEvent.change(screen.getByLabelText('补充消息（发给当前执行，不是任务讨论）'), { target: { value: '继续检查' } });
  fireEvent.click(screen.getByRole('button', { name: '发送补充消息' }));
  await waitFor(() => expect(postRaw).toHaveBeenCalledWith('run.message', { runId: 'run-a', text: '继续检查', clientMessageId: expect.any(String) }, undefined, expect.any(String)));
});
