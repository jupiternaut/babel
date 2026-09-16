// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { useBabelFieldDraft } from '../babelWorkbench/useBabelFieldDraft';
import { BabelHostCommandError } from '../../../services/babelDemoErrors';
let scope = 0;
beforeEach(() => { scope++; });
function record(fields: Record<string, unknown> = {}, id = 'a'): TrackerRecord {
  return { id, primaryType: 'task', typeTags: ['task'], source: 'native', archived: false, syncStatus: 'local', fields: { priority: 'normal', owner: '', tags: ['old'], revision: 1, ...fields }, system: { workspace: '/ws', createdAt: '2026-09-16', updatedAt: '2026-09-16' } } as TrackerRecord;
}
function source(command = vi.fn().mockResolvedValue({ ok: true })) {
  return { endpoint: `http://localhost:${10000 + scope}`, projectId: 'project', command } as any;
}
const setup = (item = record(), ds = source()) => ({ ds, ...renderHook(({ item, ds, editable }) => useBabelFieldDraft(item, ds, editable), { initialProps: { item, ds, editable: true } }) });

describe('Babel field draft write boundary', () => {
  it('collects only changed allowed fields, keeps the base revision, and does not autosave', async () => {
    const { result, ds } = setup();
    act(() => { result.current.change('priority', 'high'); result.current.change('owner', '小明'); result.current.change('tags', []); result.current.change('status', 'done'); });
    expect(ds.command).not.toHaveBeenCalled();
    expect(result.current.values).toMatchObject({ priority: 'high', owner: '小明', tags: [] });
    act(() => result.current.change('priority', 'normal'));
    await act(() => result.current.save());
    expect(ds.command).toHaveBeenCalledExactlyOnceWith({ type: 'update-item', input: { itemId: 'a', updates: { owner: '小明', tags: [] }, expectedRevision: 1 } });
    expect(result.current.dirty).toBe(false);
  });

  it('requires explicit conflict review and preserves unrelated remote fields when rebasing', async () => {
    const { result, rerender, ds } = setup();
    act(() => { result.current.change('owner', '我的负责人'); result.current.change('tags', ['new']); });
    rerender({ item: record({ owner: 'CLI', tags: ['new'], priority: 'high', revision: 2 }), ds, editable: true });
    expect(result.current.conflict).toBe(true);
    expect(result.current.remote.owner).toBe('CLI');
    expect(result.current.values).toMatchObject({ owner: '我的负责人', priority: 'high' });
    await act(() => result.current.save());
    expect(ds.command).not.toHaveBeenCalled();
    act(() => result.current.continueEditing());
    await act(() => result.current.save());
    expect(ds.command).toHaveBeenCalledExactlyOnceWith({ type: 'update-item', input: { itemId: 'a', updates: { owner: '我的负责人' }, expectedRevision: 2 } });
  });

  it('retains rejected drafts, blocks blind conflict retry, and adopts remote without writing', async () => {
    const ds = source(vi.fn().mockRejectedValue(new BabelHostCommandError('REVISION_CONFLICT', 'changed')));
    const { result } = setup(record(), ds);
    act(() => result.current.change('owner', 'mine'));
    await act(() => result.current.save());
    expect(result.current.values.owner).toBe('mine');
    expect(result.current.conflict).toBe(true);
    await act(() => result.current.save());
    expect(ds.command).toHaveBeenCalledTimes(1);
    act(() => result.current.useRemote());
    expect(result.current.values.owner).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('isolates cache by authority and item, survives unmount and source recreation', () => {
    const { result, rerender, unmount, ds } = setup();
    act(() => result.current.change('owner', 'A draft'));
    for (const [item, other] of [[record({}, 'b'), ds], [record(), { ...ds, endpoint: 'http://other' }], [record(), { ...ds, projectId: 'other' }]] as const) {
      rerender({ item, ds: other, editable: true });
      expect(result.current.dirty).toBe(false);
    }
    unmount();
    const restored = setup(record({ revision: 2 }), { ...ds });
    expect(restored.result.current.values.owner).toBe('A draft');
    expect(restored.result.current.conflict).toBe(true);
  });

  it('ignores stale target callbacks and keeps late failures on the original draft', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    const ds = source(vi.fn().mockReturnValue(pending));
    const { result, rerender } = setup(record(), ds);
    act(() => result.current.change('owner', 'A draft'));
    const old = result.current;
    let saved!: Promise<void>;
    act(() => { saved = old.save(); void old.save(); });
    expect(ds.command).toHaveBeenCalledTimes(1);
    rerender({ item: record({}, 'b'), ds, editable: true });
    act(() => { result.current.change('owner', 'B draft'); old.change('owner', 'stale'); old.useRemote(); });
    await act(async () => { reject(new BabelHostCommandError('PERMISSION_DENIED', 'denied')); await saved; });
    expect(result.current.values.owner).toBe('B draft');
    expect(result.current.error).toBeNull();
    rerender({ item: record(), ds, editable: true });
    expect(result.current.values.owner).toBe('A draft');
    expect(result.current.error?.code).toBe('PERMISSION_DENIED');
  });

  it.each([{ babelReadOnly: true }, { revision: undefined }, { revision: 0 }])('blocks edits without writable authority: %j', async (fields) => {
    const { result, ds } = setup(record(fields));
    act(() => result.current.change('owner', 'cannot write'));
    await act(() => result.current.save());
    expect(result.current.dirty).toBe(false);
    expect(ds.command).not.toHaveBeenCalled();
  });

  it('retains drafts when permissions change and prevents old callbacks from writing', async () => {
    const item = record();
    const { result, rerender, ds } = setup(item);
    act(() => result.current.change('owner', 'preserved'));
    const old = result.current;
    rerender({ item, ds, editable: false });
    await act(() => old.save());
    await act(() => result.current.save());
    expect(result.current.values.owner).toBe('preserved');
    expect(ds.command).not.toHaveBeenCalled();
  });
});
