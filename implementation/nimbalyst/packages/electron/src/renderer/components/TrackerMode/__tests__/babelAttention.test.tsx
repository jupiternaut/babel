// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { useBabelNavQuery } from '../babelWorkbench/useBabelNavQuery';
import { attentionCards, type TaskListCard } from '../babelWorkbench/babelScope';
import { BabelAttention } from '../babelWorkbench/BabelAttention';

afterEach(cleanup);

it('does not query another project through a source whose details and commands belong to the current workspace', async () => {
  const source = { projectId: 'bound', queryRaw: vi.fn(), subscribe: vi.fn() } as unknown as BabelDemoTrackerDataSource;
  const { result } = renderHook(() => useBabelNavQuery(source, 'other', null));
  await waitFor(() => expect(result.current.connection).toBe('unavailable'));
  expect(result.current.listedIds).toEqual(new Set());
  expect(source.queryRaw).not.toHaveBeenCalled();
  expect(source.subscribe).not.toHaveBeenCalled();
});

it('never releases device scope while its first snapshot is pending or fails', async () => {
  let fail: (error: Error) => void = () => undefined;
  const source = {
    projectId: 'p', subscribe: () => () => undefined,
    queryRaw: vi.fn(async (name: string, input?: { deviceId?: string }) => {
      if (name !== 'task.list') return {};
      if (input?.deviceId === 'offline') return new Promise((_resolve, reject) => { fail = reject; });
      return { items: [{ trackerId: 'other-device' }] };
    }),
  } as unknown as BabelDemoTrackerDataSource;
  const { result, rerender } = renderHook(({ device }) => useBabelNavQuery(source, 'p', device), { initialProps: { device: 'online' } });
  await waitFor(() => expect(result.current.listedIds).toEqual(new Set(['other-device'])));
  rerender({ device: 'offline' });
  expect(result.current.listedIds).toEqual(new Set());
  await act(async () => fail(new Error('offline')));
  expect(result.current.connection).toBe('unavailable');
  expect(result.current.listedIds).toEqual(new Set());
});

it('keeps device counts project-wide while narrowing the board, reusing the unfiltered task query', async () => {
  const rows = [
    { trackerId: 'a', title: 'Alpha', deviceId: 'd1', runStatus: 'executing' },
    { trackerId: 'b', title: 'Beta', deviceId: 'd2', runStatus: 'waiting_input' },
  ];
  const queryRaw = vi.fn(async (name: string, input?: { deviceId?: string; q?: string }) => {
    if (name === 'device.list') return { devices: ['d1', 'd2'].map(id => ({ id, label: id, available: true })) };
    if (name !== 'task.list') return {};
    return { items: rows.filter(row => (!input?.deviceId || row.deviceId === input.deviceId)
      && (!input?.q || row.title.includes(input.q))) };
  });
  const source = { projectId: 'p', queryRaw, subscribe: () => () => undefined } as unknown as BabelDemoTrackerDataSource;
  const { result, rerender } = renderHook(({ device, search }) => useBabelNavQuery(source, 'p', device, search), {
    initialProps: { device: null as string | null, search: '' },
  });
  await waitFor(() => expect(result.current.connection).toBe('demo'));
  expect(result.current.devices.map(row => row.activeRuns)).toEqual([1, 1]);
  expect(queryRaw.mock.calls.filter(([name]) => name === 'task.list')).toHaveLength(1);
  for (const filter of [{ device: 'd1', search: '' }, { device: null, search: 'Alpha' }]) {
    queryRaw.mockClear();
    rerender(filter);
    await waitFor(() => expect(result.current.connection).toBe('demo'));
    expect(result.current.listedIds).toEqual(new Set(['a']));
    expect(result.current.devices.map(row => row.activeRuns)).toEqual([1, 1]);
    expect(queryRaw.mock.calls.filter(([name]) => name === 'task.list')).toHaveLength(2);
  }
});

it('keeps attention a deduplicated projection of authoritative, unarchived records', () => {
  const waiting = { trackerId: 'waiting', attention: true, runStatus: 'waiting_input' };
  expect(attentionCards([
    waiting, waiting,
    { trackerId: 'review', attention: true, runStatus: 'review_required' },
    { trackerId: 'archived', attention: true, archived: true },
    { trackerId: 'running', attention: false, runStatus: 'executing' },
  ]).map((row) => row.trackerId)).toEqual(['waiting', 'review']);
});

it('selects the original record without changing its lifecycle and uses the event timestamp', () => {
  const select = vi.fn();
  const filter = vi.fn();
  render(<BabelAttention attentionOnly onAttentionChange={filter} onAttentionSelect={select} stale={false} listed={[
    { trackerId: 'waiting', title: '等待确认文件范围', attention: true, runStatus: 'waiting_input', lastUpdatedAt: '2026-09-16T12:00:00Z' },
  ]} />);
  fireEvent.click(screen.getByTestId('babel-attention-waiting'));
  expect(select).toHaveBeenCalledExactlyOnceWith('waiting');
  expect(screen.getByTestId('babel-attention-waiting').querySelector('time')?.dateTime).toBe('2026-09-16T12:00:00Z');
  fireEvent.click(screen.getByTestId('babel-attention-toggle'));
  expect(filter).toHaveBeenCalledExactlyOnceWith(false);
});

it('ignores an older query finishing after a newer committed event', async () => {
  let notify: () => void = () => undefined;
  let finishOld: (value: unknown) => void = () => undefined;
  let pending = true;
  const source = {
    projectId: 'p', subscribe: (listener: () => void) => { notify = listener; return () => undefined; },
    queryRaw: vi.fn(async (name: string) => {
      if (name !== 'task.list') return {};
      if (pending) return new Promise((resolve) => { finishOld = resolve; });
      return { items: [{ trackerId: 'new' }] };
    }),
  } as unknown as BabelDemoTrackerDataSource;
  const { result } = renderHook(() => useBabelNavQuery(source, 'p', null));
  pending = false;
  act(() => notify());
  await waitFor(() => expect(result.current.listedIds).toEqual(new Set(['new'])));
  await act(async () => finishOld({ items: [{ trackerId: 'old' }] }));
  expect(result.current.listedIds).toEqual(new Set(['new']));
});

it('refreshes scope after authoritative events, keeps the last snapshot on disconnect and unsubscribes', async () => {
  let notify: () => void = () => undefined;
  let rows: TaskListCard[] = [{ trackerId: 'a', attention: false }];
  let offline = false;
  const unsubscribe = vi.fn();
  const source = {
    projectId: 'project-a',
    subscribe: vi.fn((listener: () => void) => { notify = listener; return unsubscribe; }),
    queryRaw: vi.fn(async (name: string) => {
      if (offline) throw new Error('offline');
      if (name === 'project.list') return { projects: [{ id: 'project-a', name: 'A' }] };
      if (name === 'device.list') return { devices: [] };
      return { items: rows };
    }),
  } as unknown as BabelDemoTrackerDataSource;
  const { result, unmount } = renderHook(() => useBabelNavQuery(source, 'project-a', null));
  await waitFor(() => expect(result.current.listedIds).toEqual(new Set(['a'])));
  rows = [{ trackerId: 'b', attention: true, lastUpdatedAt: '2026-09-16T12:00:00Z' }];
  act(() => notify());
  await waitFor(() => expect(result.current.listedIds).toEqual(new Set(['b'])));
  expect(attentionCards(result.current.listed ?? [])[0].lastUpdatedAt).toBe('2026-09-16T12:00:00Z');
  offline = true;
  act(() => notify());
  await waitFor(() => expect(result.current.connection).toBe('unavailable'));
  expect(result.current.listedIds).toEqual(new Set(['b']));
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
