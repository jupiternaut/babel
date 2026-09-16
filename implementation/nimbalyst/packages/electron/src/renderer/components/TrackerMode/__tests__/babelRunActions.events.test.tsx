import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { useBabelRunActions } from '../babelWorkbench/useBabelRunActions';

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
