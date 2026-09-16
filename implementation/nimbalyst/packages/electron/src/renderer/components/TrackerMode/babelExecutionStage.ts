import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';

export type BabelExecutionStage = 'TODO' | 'RUNNING' | 'DONE' | 'ARCHIVED';

export const BABEL_EXECUTION_STAGES: readonly BabelExecutionStage[] = ['TODO', 'RUNNING', 'DONE', 'ARCHIVED'];

export const BABEL_EXECUTION_STAGE_LABEL: Record<BabelExecutionStage, string> = {
  TODO: '待办',
  RUNNING: '运行',
  DONE: '完成',
  ARCHIVED: '归档',
};

const EXECUTABLE_TYPES = new Set(['task', 'bug']);

const STARTED = new Set([
  'approved',
  'in-progress',
  'in-review',
  'changes-requested',
  'blocked',
  'active',
  'executing',
  'wont-do',
  'duplicate',
]);

const DONE = new Set(['done', 'completed', 'released', 'closed', 'decided', 'implemented']);

const ACTIVE_RUN_BLOCKS_ARCHIVE = new Set([
  'requested',
  'accepted',
  'executing',
  'waiting_input',
  'verifying',
  'cancel_requested',
  'lost',
]);

export function isHostExecutableType(type: string, executionEnabled = false): boolean {
  if (EXECUTABLE_TYPES.has(type)) return true;
  return type === 'plan' && executionEnabled;
}

export function isSemanticDemoRecord(record: TrackerRecord): boolean {
  return record.fields.demoScene === 'semantic';
}

export function isDefaultExecutionBoardRecord(record: TrackerRecord): boolean {
  if (isSemanticDemoRecord(record)) return false;
  const enabled = record.fields.executionEnabled === true;
  return isHostExecutableType(record.primaryType, enabled);
}

export function projectExecutionBoardItems(
  items: readonly TrackerRecord[],
  options: { selectedType?: string; search?: string; includeSemantic?: boolean } = {},
): TrackerRecord[] {
  const search = options.search?.trim().toLowerCase() ?? '';
  const selectedType = options.selectedType ?? 'all';

  return items.filter((item) => {
    if (!options.includeSemantic && isSemanticDemoRecord(item)) return false;

    const enabled = item.fields.executionEnabled === true;
    if (selectedType === 'all') {
      if (!isHostExecutableType(item.primaryType, enabled)) return false;
    } else if (selectedType === 'plan') {
      if (item.primaryType !== 'plan' || !enabled) return false;
    } else if (selectedType === 'task' || selectedType === 'bug') {
      if (item.primaryType !== selectedType) return false;
    } else {
      return false;
    }

    if (!search) return true;
    const blob = `${item.fields.title ?? ''} ${item.fields.description ?? ''} ${item.id}`.toLowerCase();
    return blob.includes(search);
  });
}

export function countExecutionStages(items: readonly TrackerRecord[]): Record<BabelExecutionStage, number> {
  const counts: Record<BabelExecutionStage, number> = { TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 };
  for (const item of items) counts[deriveHostExecutionStage(item)] += 1;
  return counts;
}

export function deriveHostExecutionStage(record: TrackerRecord): BabelExecutionStage {
  const explicit = record.fields.babelStage;
  if (explicit === 'TODO' || explicit === 'RUNNING' || explicit === 'DONE' || explicit === 'ARCHIVED') {
    return explicit;
  }
  if (record.archived) return 'ARCHIVED';
  if (record.fields.babelOutcome === 'succeeded') return 'DONE';
  const status = String(record.fields.status ?? '').trim().toLowerCase();
  if (DONE.has(status)) return 'DONE';
  if (STARTED.has(status)) return 'RUNNING';
  return 'TODO';
}

export function hostArchiveGuard(record: TrackerRecord): { allowed: boolean; reason?: string; code?: string } {
  const runStatus = String(record.fields.babelRunStatus ?? '').trim();
  if (runStatus === 'cancel_requested') {
    return { allowed: false, reason: '取消尚未确认，不能归档', code: 'CANCEL_PENDING' };
  }
  if (runStatus === 'lost') {
    return { allowed: false, reason: '失联执行尚未核对，不能归档', code: 'LOST_UNRECONCILED' };
  }
  if (ACTIVE_RUN_BLOCKS_ARCHIVE.has(runStatus)) {
    return { allowed: false, reason: '进行中的执行不能归档，请先结束或取消', code: 'PRECONDITION' };
  }
  return { allowed: true };
}

export function hostRecordProjectId(record: TrackerRecord): string | undefined {
  const value = record.fields.projectId;
  return typeof value === 'string' && value ? value : undefined;
}

export function hostRecordRevision(record: TrackerRecord): number | undefined {
  const value = record.fields.revision;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
