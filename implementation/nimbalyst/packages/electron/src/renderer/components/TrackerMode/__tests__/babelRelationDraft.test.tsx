// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { useBabelRelationDraft } from '../babelWorkbench/useBabelRelationDraft';
import { BabelHostCommandError } from '../../../services/babelDemoErrors';
let scope = 0;
beforeEach(() => { scope++; });
function record(fields: Record<string, unknown> = {}, id = 'a'): TrackerRecord {
  return { id, primaryType: 'task', typeTags: ['task'], source: 'native', archived: false, syncStatus: 'local', fields: { dependsOn: ['old'], blocks: [], revision: 1, ...fields }, system: { workspace: '/ws', createdAt: '2026-09-16', updatedAt: '2026-09-16' } } as TrackerRecord;
}
function source(setRelations = vi.fn().mockResolvedValue({ ok: true })) {
  return { endpoint: `http://localhost:${12000 + scope}`, projectId: 'project', setRelations } as any;
}
const setup = (item = record(), ds = source()) => ({ ds, ...renderHook(({ item, ds, editable }) => useBabelRelationDraft(item, ds, editable), { initialProps: { item, ds, editable: true } }) });

describe('Babel relation draft write boundary', () => {
  it('keeps native IDs and only submits changed relations on explicit save, including empty lists', async () => {
    const { result, ds } = setup();
    act(() => { result.current.change('dependsOn', []); result.current.change('blocks', [{ itemId: 'native-b', title: '中文依赖', issueKey: 'B-2' }]); result.current.change('relatedTo', ['unsupported']); });
    expect(ds.setRelations).not.toHaveBeenCalled();
    expect(result.current.values.blocks).toEqual([{ itemId: 'native-b', title: '中文依赖', issueKey: 'B-2' }]);
    await act(() => result.current.save());
    expect(ds.setRelations).toHaveBeenCalledExactlyOnceWith('a', { dependsOn: [], blocks: ['native-b'] }, 1);
    expect(result.current.dirty).toBe(false);
  });

  it('compares relation sets by identity and ignores title-only or ordering differences', () => {
    const { result } = setup(record({ dependsOn: ['one', 'two'] }));
    act(() => result.current.change('dependsOn', [{ itemId: 'two', title: 'renamed' }, { itemId: 'one' }]));
    expect(result.current.dirty).toBe(false);
  });

  it('requires explicit conflict review, drops unchanged relations and keeps unrelated remote changes', async () => {
    const { result, rerender, ds } = setup();
    act(() => { result.current.change('dependsOn', [{ itemId: 'mine' }]); result.current.change('blocks', ['same']); });
    rerender({ item: record({ dependsOn: ['remote'], blocks: ['same'], revision: 2 }), ds, editable: true });
    expect(result.current.conflict).toBe(true);
    expect(result.current.remote.dependsOn).toEqual(['remote']);
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'mine' }]);
    await act(() => result.current.save());
    expect(ds.setRelations).not.toHaveBeenCalled();
    act(() => result.current.continueEditing());
    expect(ds.setRelations).not.toHaveBeenCalled();
    await act(() => result.current.save());
    expect(ds.setRelations).toHaveBeenCalledExactlyOnceWith('a', { dependsOn: ['mine'] }, 2);
  });

  it.each(['REVISION_CONFLICT', 'DEPENDENCY_CYCLE', 'PERMISSION_DENIED'])('retains %s failures and discards only on explicit use remote', async (code) => {
    const ds = source(vi.fn().mockRejectedValue(new BabelHostCommandError(code, 'rejected')));
    const { result } = setup(record(), ds);
    act(() => result.current.change('dependsOn', ['mine']));
    await act(() => result.current.save());
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'mine' }]);
    expect(result.current.error?.code).toBe(code);
    if (code === 'REVISION_CONFLICT') {
      await act(() => result.current.save());
      expect(ds.setRelations).toHaveBeenCalledTimes(1);
    }
    act(() => result.current.useRemote());
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'old' }]);
    expect(result.current.error).toBeNull();
  });

  it('scopes drafts to authority/project/item and survives source recreation and unmount', () => {
    const { result, rerender, unmount, ds } = setup();
    act(() => result.current.change('dependsOn', ['mine']));
    for (const [item, other] of [[record({}, 'b'), ds], [record(), { ...ds, endpoint: 'http://other' }], [record(), { ...ds, projectId: 'other' }]] as const) {
      rerender({ item, ds: other, editable: true });
      expect(result.current.dirty).toBe(false);
    }
    unmount();
    const restored = setup(record({ revision: 2 }), { ...ds });
    expect(restored.result.current.values.dependsOn).toEqual([{ itemId: 'mine' }]);
    expect(restored.result.current.conflict).toBe(true);
  });

  it('blocks double save and stale callbacks while late errors stay attached to the original target', async () => {
    let reject!: (error: Error) => void;
    const ds = source(vi.fn().mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; })));
    const { result, rerender } = setup(record(), ds);
    act(() => result.current.change('dependsOn', ['mine']));
    const old = result.current;
    let saved!: Promise<void>;
    act(() => { saved = old.save(); void old.save(); old.change('blocks', ['ignored']); });
    expect(ds.setRelations).toHaveBeenCalledTimes(1);
    rerender({ item: record({}, 'b'), ds, editable: true });
    act(() => { result.current.change('dependsOn', ['b-draft']); old.change('dependsOn', ['stale']); old.useRemote(); old.continueEditing(); });
    await act(async () => { reject(new BabelHostCommandError('PERMISSION_DENIED', 'denied')); await saved; });
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'b-draft' }]);
    expect(result.current.error).toBeNull();
    rerender({ item: record(), ds, editable: true });
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'mine' }]);
    expect(result.current.error?.code).toBe('PERMISSION_DENIED');
  });

  it.each([{ babelReadOnly: true }, { revision: undefined }, { revision: 0 }])('blocks editors without writable revision: %j', async (fields) => {
    const { result, ds } = setup(record(fields));
    act(() => result.current.change('dependsOn', ['cannot write']));
    await act(() => result.current.save());
    expect(result.current.dirty).toBe(false);
    expect(ds.setRelations).not.toHaveBeenCalled();
  });

  it('keeps drafts when permissions change and disallows callbacks from the writable render', async () => {
    const item = record();
    const { result, rerender, ds } = setup(item);
    act(() => result.current.change('dependsOn', ['preserved']));
    const old = result.current;
    rerender({ item, ds, editable: false });
    await act(() => old.save());
    await act(() => result.current.save());
    expect(result.current.values.dependsOn).toEqual([{ itemId: 'preserved' }]);
    expect(ds.setRelations).not.toHaveBeenCalled();
  });
});
