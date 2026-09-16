import { beforeAll, describe, expect, it } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/ModelLoader';
import {
  createDefaultViewDefinition,
  normalizeViewDefinition,
  type SavedViewDefinition,
} from '@nimbalyst/collab-client/trackers';
import { filterBabelExecutionItems } from '../babelExecutionFilters';

function record(id: string, fields: Record<string, unknown> = {}, extra: Partial<TrackerRecord> = {}): TrackerRecord {
  return {
    id,
    primaryType: 'task',
    typeTags: ['task'],
    archived: false,
    source: 'native',
    syncStatus: 'synced',
    content: { format: 'markdown', markdown: '' },
    fields: { title: id, status: 'to-do', ...fields },
    system: { workspace: '/project', createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z' },
    ...extra,
  };
}

function view(partial: Partial<SavedViewDefinition> = {}): SavedViewDefinition {
  return { ...createDefaultViewDefinition(), statusScope: 'all', ...partial };
}

function ids(items: TrackerRecord[]): string[] {
  return items.map((item) => item.id).sort();
}

const imported = record('imported', { title: 'Release', tags: ['ui'], priority: 'high' }, {
  system: {
    workspace: '/project',
    createdAt: '2026-09-16T00:00:00Z',
    updatedAt: '2026-09-16T00:00:00Z',
    origin: {
      kind: 'external',
      external: {
        providerId: 'github-issues', externalId: '1', urn: 'github://owner/repo#1',
        url: 'https://github.com/owner/repo/issues/1', titleSnapshot: 'Release',
        importedAt: '2026-09-16T00:00:00Z', lastSyncedAt: '2026-09-16T00:00:00Z',
      },
    },
  },
});

describe('execution view filters', () => {
  beforeAll(() => loadBuiltinTrackers());

  const lifecycleItems = [
    record('todo'),
    record('running', { status: 'in-progress', babelRunStatus: 'executing' }),
    record('done', { status: 'done' }),
    record('archived', { status: 'done' }, { archived: true }),
  ];

  it('keeps the full executable lifecycle, including archive, on All', () => {
    const rows = filterBabelExecutionItems([
      ...lifecycleItems,
      record('enabled-plan', { executionEnabled: true }, { primaryType: 'plan', typeTags: ['plan'] }),
      record('plan', {}, { primaryType: 'plan', typeTags: ['plan'] }),
      record('idea', {}, { primaryType: 'idea', typeTags: ['idea'] }),
      record('semantic', { demoScene: 'semantic' }),
    ], view());
    expect(ids(rows)).toEqual(['archived', 'done', 'enabled-plan', 'running', 'todo']);
  });

  it.each([
    ['open', ['running', 'todo']],
    ['closed', ['archived', 'done']],
  ] as const)('honors the %s lifecycle scope', (statusScope, expected) => {
    expect(ids(filterBabelExecutionItems(lifecycleItems, view({ statusScope })))).toEqual(expected);
  });

  it('uses the host status for lifecycle scope even when run metadata differs', () => {
    const items = [
      record('host-open', { status: 'to-do', babelRunStatus: 'succeeded', babelStage: 'DONE' }),
      record('host-closed', { status: 'done', babelRunStatus: 'executing', babelStage: 'RUNNING' }),
    ];
    expect(ids(filterBabelExecutionItems(items, view({ statusScope: 'open' })))).toEqual(['host-open']);
    expect(ids(filterBabelExecutionItems(items, view({ statusScope: 'closed' })))).toEqual(['host-closed']);
  });

  it.each([
    { name: 'priority chip', definition: view({ activeFilters: ['high-priority'] }), options: {}, excluded: record('low', { priority: 'low', tags: ['ui'] }) },
    { name: 'tag', definition: view({ tagFilter: ['ui'] }), options: {}, excluded: record('other-tag', { priority: 'high', tags: ['backend'] }) },
    { name: 'field chip', definition: view({ columnFilters: { clauses: [{ field: 'priority', op: '=', value: 'high' }] } }), options: {}, excluded: record('low', { priority: 'low', tags: ['ui'] }) },
    { name: 'source', definition: view(), options: { sourceFilter: ['github-issues'] }, excluded: record('native', { priority: 'high', tags: ['ui'] }) },
  ])('honors the $name filter', ({ definition, options, excluded }) => {
    expect(ids(filterBabelExecutionItems([imported, excluded], definition, options))).toEqual(['imported']);
  });

  it('composes a restored saved view with source, search, personal context and Babel scope', () => {
    const definition = normalizeViewDefinition({
      selectedType: 'task', statusScope: 'open', activeFilters: ['favorites'], tagFilter: ['ui'],
      columnFilters: { combinator: 'or', clauses: [
        { field: 'priority', op: '=', value: 'high' },
        { field: 'priority', op: '=', value: 'critical' },
      ] },
    });
    const other = (id: string, fields: Record<string, unknown> = {}, extra: Partial<TrackerRecord> = {}) => (
      { ...imported, id, fields: { ...imported.fields, ...fields }, ...extra }
    );
    const items = [
      imported, other('outside-babel'), other('not-favorite'), other('closed', { status: 'done' }),
      other('other-search', { title: 'Documentation' }), other('other-tag', { tags: ['backend'] }),
      other('other-priority', { priority: 'low' }),
      other('other-type', {}, { primaryType: 'bug', typeTags: ['bug'] }),
      record('native', { title: 'Release', tags: ['ui'], priority: 'high' }),
    ];
    const listedIds = new Set(items.filter((item) => item.id !== 'outside-babel').map((item) => item.id));
    const favoriteItemIds = new Set(items.filter((item) => item.id !== 'not-favorite').map((item) => item.id));
    expect(ids(filterBabelExecutionItems(items, definition, {
      sourceFilter: ['github-issues'], searchTerm: ' release ', favoriteItemIds, listedIds,
    }))).toEqual(['imported']);
  });

  it('uses the host search fields after execution type eligibility', () => {
    const items = [
      record('task', { title: 'Unrelated' }, { issueKey: 'PROJ-42' }),
      record('bug', { title: 'Unrelated' }, { primaryType: 'bug', typeTags: ['bug'], issueKey: 'PROJ-43' }),
      record('plan', { title: 'PROJ' }, { primaryType: 'plan', typeTags: ['plan'] }),
    ];
    expect(ids(filterBabelExecutionItems(items, view({ selectedType: 'bug' }), { searchTerm: ' proj ' })))
      .toEqual(['bug']);
  });

  it('restricts an archive chip to archive while keeping normal lifecycle scope', () => {
    const items = [...lifecycleItems, record('archived-open', {}, { archived: true })];
    expect(ids(filterBabelExecutionItems(items, view({ activeFilters: ['archived'] }))))
      .toEqual(['archived', 'archived-open']);
    expect(ids(filterBabelExecutionItems(items, view({ activeFilters: ['archived'], statusScope: 'closed' }))))
      .toEqual(['archived']);
  });

  it.each([true, false])('honors an explicit archived=%s field clause', (archived) => {
    expect(ids(filterBabelExecutionItems(lifecycleItems, view({
      columnFilters: { clauses: [{ field: 'archived', op: '=', value: archived }] },
    })))).toEqual(archived ? ['archived'] : ['done', 'running', 'todo']);
  });

  it('counts only the displayed Babel scope when comparing lifecycle slices', () => {
    const options = { listedIds: new Set(['running', 'archived']) };
    const all = filterBabelExecutionItems(lifecycleItems, view(), options);
    const open = filterBabelExecutionItems(lifecycleItems, view({ statusScope: 'open' }), options);
    expect(ids(all)).toEqual(['archived', 'running']);
    expect(ids(open)).toEqual(['running']);
    expect(all.length - open.length).toBe(1);
    expect(filterBabelExecutionItems(lifecycleItems, view(), { listedIds: new Set() })).toEqual([]);
  });
});
