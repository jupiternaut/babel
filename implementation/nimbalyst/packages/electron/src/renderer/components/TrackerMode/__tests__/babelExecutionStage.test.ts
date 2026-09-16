import { describe, expect, it } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  countExecutionStages,
  hostArchiveGuard,
  projectExecutionBoardItems,
} from '../babelExecutionStage';

function record(partial: Partial<TrackerRecord> & { id: string; primaryType: string }): TrackerRecord {
  return {
    typeTags: [partial.primaryType],
    source: 'native',
    archived: Boolean(partial.archived),
    syncStatus: 'synced',
    content: { format: 'markdown', markdown: '' },
    system: { workspace: 'demo', createdAt: '2026-09-14T07:00:00Z', updatedAt: '2026-09-14T07:00:00Z' },
    fields: {
      title: String(partial.fields?.title ?? partial.id),
      status: String(partial.fields?.status ?? 'to-do'),
      description: '',
      acceptance: [],
      dependsOn: [],
      blocks: [],
      ...(partial.fields ?? {}),
    },
    revision: 1,
    ...partial,
  } as TrackerRecord;
}

describe('execution board projection', () => {
  const items = [
    record({ id: 'fixture-tracker-pdf', primaryType: 'task', fields: { title: 'PDF', status: 'to-do', babelStage: 'TODO' } }),
    record({ id: 'fixture-tracker-research', primaryType: 'task', fields: { title: '资料', status: 'to-do', babelStage: 'TODO' } }),
    record({ id: 'fixture-tracker-sync', primaryType: 'task', fields: { title: '同步', status: 'in-progress', babelStage: 'RUNNING' } }),
    record({ id: 'fixture-tracker-state', primaryType: 'task', fields: { title: '状态', status: 'done', babelStage: 'DONE' } }),
    record({ id: 'fixture-tracker-layout', primaryType: 'task', archived: true, fields: { title: '布局', status: 'done', babelStage: 'ARCHIVED' } }),
    record({ id: 'fixture-tracker-plan', primaryType: 'plan', fields: { title: '计划', status: 'ready-for-development', demoScene: 'semantic' } }),
    record({ id: 'fixture-tracker-idea', primaryType: 'idea', fields: { title: '想法', status: 'accepted', demoScene: 'semantic' } }),
    record({ id: 'fixture-tracker-milestone', primaryType: 'milestone', fields: { title: '里程碑', status: 'active', demoScene: 'semantic' } }),
    record({ id: 'fixture-tracker-approved', primaryType: 'task', fields: { title: 'approved', status: 'approved', babelStage: 'RUNNING', demoScene: 'semantic' } }),
    record({ id: 'user-created', primaryType: 'task', fields: { title: '新建任务', status: 'to-do', babelStage: 'TODO' } }),
  ];

  it('defaults to executable lifecycle without plan/idea/milestone or semantic extras', () => {
    const projected = projectExecutionBoardItems(items);
    expect(projected.map((item) => item.id)).toEqual([
      'fixture-tracker-pdf',
      'fixture-tracker-research',
      'fixture-tracker-sync',
      'fixture-tracker-state',
      'fixture-tracker-layout',
      'user-created',
    ]);
    expect(countExecutionStages(projected.filter((item) => item.id.startsWith('fixture-')))).toEqual({
      TODO: 2,
      RUNNING: 1,
      DONE: 1,
      ARCHIVED: 1,
    });
  });

  it('does not treat approved as DONE', () => {
    const approved = items.find((item) => item.id === 'fixture-tracker-approved')!;
    expect(approved.fields.status).toBe('approved');
    const projected = projectExecutionBoardItems([approved], { includeSemantic: true });
    expect(countExecutionStages(projected)).toEqual({ TODO: 0, RUNNING: 1, DONE: 0, ARCHIVED: 0 });
  });

  it('keeps non-executable types out of the default board', () => {
    const projected = projectExecutionBoardItems(items, { selectedType: 'plan' });
    expect(projected).toEqual([]);
  });
});

describe('archive guard', () => {
  it('blocks archive while executing or lost', () => {
    expect(hostArchiveGuard(record({
      id: 'run',
      primaryType: 'task',
      fields: { babelRunStatus: 'executing' },
    }))).toMatchObject({ allowed: false, code: 'PRECONDITION' });
    expect(hostArchiveGuard(record({
      id: 'lost',
      primaryType: 'task',
      fields: { babelRunStatus: 'lost' },
    }))).toMatchObject({ allowed: false, code: 'LOST_UNRECONCILED' });
  });
});
