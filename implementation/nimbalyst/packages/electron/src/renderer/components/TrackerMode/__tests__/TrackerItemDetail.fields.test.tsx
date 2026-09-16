// @vitest-environment jsdom
/**
 * The detail pane's metadata region: the shared chip row is the canonical
 * presentation of a tracker's fields, tags stay an always-open row, and content
 * focus still hides all of it.
 */
import { Provider } from 'jotai';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';

// The file-backed body editor is only reachable in content focus, and it drags
// in the whole editor stack.
vi.mock('../../TabEditor/TabEditor', () => ({ TabEditor: () => null }));

// The collab body stack blocks on import outside Electron, and this pane's
// metadata region doesn't depend on it: a dormant collab result is enough.
vi.mock('../../../hooks/useTrackerContentCollab', () => ({
  trackerContentCollabKey: (itemId: string) => `tracker-body:${itemId}`,
  useTrackerContentCollab: () => ({
    collaboration: null,
    loading: false,
    status: 'disconnected',
    syncProvider: null,
    commentsConfig: null,
    providerEpoch: 0,
    bodyCacheMarkdown: null,
  }),
}));
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { replaceAllTrackerItemsAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { TrackerItemDetail } from '../TrackerItemDetail';
import { trackerHostDataSourceAtom } from '../../../store/atoms/trackers';
import { BabelHostCommandError } from '../../../services/babelDemoErrors';

const ITEM = {
  id: 'item-a',
  primaryType: 'plan',
  typeTags: ['plan'],
  issueKey: 'NIM-1',
  source: 'native',
  archived: false,
  syncStatus: 'local',
  system: {
    workspace: '/ws',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  fields: {
    title: 'Chip row item',
    status: 'in-development',
    priority: 'high',
    tags: ['auth'],
    agentSessions: [{ sessionId: 'session-1' }],
  },
} as TrackerRecord;

const updateTrackerItem = vi.fn().mockResolvedValue({ success: true });
const createTrackerItem = vi.fn().mockResolvedValue({
  success: true,
  item: { id: 'mst_new', title: 'Gamma', issueKey: 'NIM-2' },
});

beforeAll(() => loadBuiltinTrackers());

let titleTestScope = 0;
beforeEach(() => {
  titleTestScope++;
  store.set(trackerHostDataSourceAtom, null);
  updateTrackerItem.mockClear();
  createTrackerItem.mockClear();
  (window as any).electronAPI = {
    invoke: vi.fn().mockResolvedValue(undefined),
    documentService: {
      updateTrackerItem,
      createTrackerItem,
      getTrackerCreationStatus: vi.fn().mockResolvedValue(null),
      updateTrackerItemInFile: vi.fn().mockResolvedValue({ success: true }),
      getTrackerItemContent: vi.fn().mockResolvedValue({ success: true, content: '' }),
      saveTrackerItemContent: vi.fn().mockResolvedValue({ success: true }),
    },
  };
  store.set(replaceAllTrackerItemsAtom, [ITEM]);
});

describe('Babel native detail title editing', () => {
  function babelItem(title: string, revision: number): TrackerRecord {
    return { ...ITEM, fields: { ...ITEM.fields, title, revision, babelStage: 'TODO' } };
  }

  function useBabelSource(command = vi.fn().mockResolvedValue({ ok: true })) {
    store.set(trackerHostDataSourceAtom, { kind: 'babel-demo', endpoint: `http://localhost:${8000 + titleTestScope}`, projectId: 'title-project', command } as never);
    store.set(replaceAllTrackerItemsAtom, [babelItem('原始标题', 1)]);
    return command;
  }

  it('follows same-item authoritative updates until a local draft exists', async () => {
    const command = useBabelSource();
    await act(async () => { renderDetail(); });
    const input = screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement;
    for (let revision = 2; revision <= 31; revision++) {
      act(() => store.set(replaceAllTrackerItemsAtom, [babelItem(`远端标题 ${revision}`, revision)]));
      expect(input.value).toBe(`远端标题 ${revision}`);
    }
    expect(screen.queryByTestId('babel-title-save')).toBeNull();
    expect(command).not.toHaveBeenCalled();
    expect(updateTrackerItem).not.toHaveBeenCalled();
  });

  it('preserves a dirty draft, shows the remote title, and requires explicit rebase and save', async () => {
    const command = useBabelSource();
    await act(async () => { renderDetail(); });
    const input = screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '我的草稿' } });
    act(() => store.set(replaceAllTrackerItemsAtom, [babelItem('CLI 的新标题', 2)]));
    expect(input.value).toBe('我的草稿');
    expect(screen.getByTestId('babel-title-conflict').textContent).toContain('CLI 的新标题');
    expect((screen.getByTestId('babel-title-save') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(command).not.toHaveBeenCalled();
    expect(updateTrackerItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('继续编辑草稿'));
    expect(command).not.toHaveBeenCalled();
    command.mockImplementationOnce(async () => {
      act(() => store.set(replaceAllTrackerItemsAtom, [babelItem('我的草稿', 3)]));
      return { ok: true };
    });
    fireEvent.click(screen.getByTestId('babel-title-save'));
    await waitFor(() => expect(screen.queryByTestId('babel-title-save')).toBeNull());
    expect(command).toHaveBeenCalledWith({
      type: 'update-item',
      input: { itemId: ITEM.id, updates: { title: '我的草稿', revision: 2 }, expectedRevision: 2 },
    });
    expect(input.value).toBe('我的草稿');
    expect(updateTrackerItem).not.toHaveBeenCalled();
  });

  it('retains a server-rejected draft and can adopt the latest remote title without another write', async () => {
    const command = useBabelSource(vi.fn().mockRejectedValue(new BabelHostCommandError('REVISION_CONFLICT', '记录已被更新')));
    await act(async () => { renderDetail(); });
    const input = screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '未同步草稿' } });
    fireEvent.click(screen.getByTestId('babel-title-save'));
    await waitFor(() => expect(screen.getByTestId('babel-title-conflict').textContent).toContain('REVISION_CONFLICT'));
    expect(command).toHaveBeenCalledWith({
      type: 'update-item',
      input: { itemId: ITEM.id, updates: { title: '未同步草稿', revision: 1 }, expectedRevision: 1 },
    });
    act(() => store.set(replaceAllTrackerItemsAtom, [babelItem('最新远端标题', 2)]));
    expect(input.value).toBe('未同步草稿');
    fireEvent.click(screen.getByTestId('babel-title-use-remote'));
    expect(input.value).toBe('最新远端标题');
    expect(screen.queryByTestId('babel-title-conflict')).toBeNull();
    expect(command).toHaveBeenCalledTimes(1);
    expect(updateTrackerItem).not.toHaveBeenCalled();
  });

  it('keeps the existing debounced title save for non-Babel items', async () => {
    await act(async () => { renderDetail(); });
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: 'Ordinary host title' } });
    await waitFor(() => expect(updateTrackerItem).toHaveBeenCalledWith(expect.objectContaining({
      itemId: ITEM.id, updates: { title: 'Ordinary host title' },
    })));
    expect(screen.queryByTestId('babel-title-save')).toBeNull();
  });

  it('restores drafts and their original revision after navigation, unmount and same-identity source recreation', async () => {
    const command = useBabelSource();
    const source = store.get(trackerHostDataSourceAtom)!;
    const other = { ...babelItem('另一个条目', 1), id: 'item-b' };
    store.set(replaceAllTrackerItemsAtom, [babelItem('原始标题', 1), other]);
    const view = renderDetail();
    await act(async () => {});
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: 'A 的草稿' } });
    await act(async () => { view.rerender(detailElement(other.id)); });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('另一个条目');
    act(() => store.set(replaceAllTrackerItemsAtom, [babelItem('A 远端第二版', 2), other]));
    await act(async () => { view.rerender(detailElement(ITEM.id)); });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('A 的草稿');
    expect(screen.getByTestId('babel-title-conflict').textContent).toContain('A 远端第二版');
    view.unmount();
    act(() => store.set(trackerHostDataSourceAtom, { ...source }));
    await act(async () => { renderDetail(); });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('A 的草稿');
    expect((screen.getByTestId('babel-title-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('babel-title-conflict')).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });

  it('isolates the same tracker ID by endpoint and project', async () => {
    const command = useBabelSource();
    const original = store.get(trackerHostDataSourceAtom)!;
    const otherEndpoint = { ...original, endpoint: 'http://other-host:7780' };
    const otherProject = { ...original, projectId: 'other-project' };
    await act(async () => { renderDetail(); });
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: '原服务草稿' } });
    act(() => {
      store.set(trackerHostDataSourceAtom, otherEndpoint);
      store.set(replaceAllTrackerItemsAtom, [babelItem('另服务权威标题', 10)]);
    });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('另服务权威标题');
    expect(screen.queryByTestId('babel-title-save')).toBeNull();
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: '另服务草稿' } });
    act(() => {
      store.set(trackerHostDataSourceAtom, otherProject);
      store.set(replaceAllTrackerItemsAtom, [babelItem('另项目权威标题', 20)]);
    });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('另项目权威标题');
    expect(screen.queryByTestId('babel-title-save')).toBeNull();
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: '另项目草稿' } });
    for (const [source, title, revision, expected] of [
      [original, '原始标题', 1, '原服务草稿'],
      [otherEndpoint, '另服务权威标题', 10, '另服务草稿'],
      [otherProject, '另项目权威标题', 20, '另项目草稿'],
    ] as const) {
      act(() => {
        store.set(trackerHostDataSourceAtom, { ...source });
        store.set(replaceAllTrackerItemsAtom, [babelItem(title, revision)]);
      });
      expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe(expected);
    }
    expect(command).not.toHaveBeenCalled();
  });

  it('finishes an old item save without clearing a new item draft', async () => {
    let finishSave!: (result: { ok: boolean }) => void;
    const pending = new Promise<{ ok: boolean }>((resolve) => { finishSave = resolve; });
    const command = useBabelSource(vi.fn().mockReturnValueOnce(pending));
    const other = { ...babelItem('B 权威标题', 1), id: 'item-b' };
    store.set(replaceAllTrackerItemsAtom, [babelItem('原始标题', 1), other]);
    const view = renderDetail();
    await act(async () => {});
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: 'A 保存中的标题' } });
    fireEvent.click(screen.getByTestId('babel-title-save'));
    await act(async () => { view.rerender(detailElement(other.id)); });
    fireEvent.change(screen.getByTestId('tracker-detail-title'), { target: { value: 'B 未保存草稿' } });
    await act(async () => {
      store.set(replaceAllTrackerItemsAtom, [babelItem('A 保存中的标题', 2), other]);
      finishSave({ ok: true });
      await pending;
    });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('B 未保存草稿');
    await act(async () => { view.rerender(detailElement(ITEM.id)); });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('A 保存中的标题');
    expect(screen.queryByTestId('babel-title-save')).toBeNull();
    await act(async () => { view.rerender(detailElement(other.id)); });
    expect((screen.getByTestId('tracker-detail-title') as HTMLTextAreaElement).value).toBe('B 未保存草稿');
    expect(command).toHaveBeenCalledTimes(1);
  });
});

function detailElement(itemId: string, props: Record<string, unknown> = {}) {
  return <Provider store={store}><TrackerItemDetail itemId={itemId} onClose={() => {}} {...props} /></Provider>;
}

function renderDetail(props: Record<string, unknown> = {}) {
  return render(detailElement(ITEM.id, props));
}

describe('TrackerItemDetail metadata region', () => {
  it('renders the schema fields as chips, with tags kept as an open row', () => {
    renderDetail();

    const chips = Array.from(
      screen.getByTestId('tracker-detail-field-pills').querySelectorAll('.tracker-field-pill'),
    ).map((chip) => chip.getAttribute('data-field'));

    expect(chips).toContain('status');
    expect(chips).toContain('priority');
    expect(chips).toContain('progress');
    expect(chips).toContain('startDate');
    // Tags are edited far more often than they're read, so they stay open.
    expect(chips).not.toContain('tags');
    screen.getByTestId('tracker-detail-tags');
    // An array of objects has no one-line form: it reads below the chips.
    expect(chips).not.toContain('agentSessions');
    const overflow = document.querySelector('.tracker-detail-overflow-fields');
    expect(overflow?.textContent).toContain('Agent Sessions');
    expect(overflow?.textContent).toContain('{"sessionId":"session-1"}');
    expect(overflow?.textContent).not.toContain('[object Object]');
  });

  it('offers inline collection creation from the detail chip', async () => {
    renderDetail({ workspacePath: '/ws' });

    fireEvent.click(screen.getByTestId('tracker-detail-field-pill-collection'));
    fireEvent.change(screen.getByTestId('tracker-detail-field-collection-picker-search'), {
      target: { value: 'Gamma' },
    });
    fireEvent.click(screen.getByTestId('tracker-detail-field-collection-picker-create'));
    fireEvent.click(screen.getByTestId('tracker-detail-field-collection-picker-type-milestone'));

    await waitFor(() => expect(createTrackerItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Gamma', type: 'milestone', workspace: '/ws' }),
    ));
  });

  it('saves a chip edit through the item write path', async () => {
    renderDetail();

    fireEvent.click(screen.getByTestId('tracker-detail-field-pill-status'));
    fireEvent.click(screen.getByText('Completed'));

    expect(updateTrackerItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ITEM.id, updates: { status: 'completed' } }),
    );
  });

  it('disables the chips for a record it cannot edit', () => {
    // A row's `source` is a plain DB string cast on read, so a document-backed
    // record with a source this build doesn't round-trip does reach the pane.
    store.set(replaceAllTrackerItemsAtom, [{
      ...ITEM,
      source: 'external',
      system: { ...ITEM.system, documentPath: 'plans/imported.md' },
    } as unknown as TrackerRecord]);

    renderDetail();

    const chip = screen.getByTestId('tracker-detail-field-pill-status') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });

  it('hides the metadata region in content focus', () => {
    renderDetail({ enableContentFocus: true, contentFocus: true });

    expect(screen.queryByTestId('tracker-detail-field-pills')).toBeNull();
    expect(screen.queryByTestId('tracker-detail-tags')).toBeNull();
  });
});
