export interface TaskListCard {
  trackerId: string;
  projectId?: string;
  deviceId?: string | null;
  runStatus?: string | null;
  stage?: string;
  title?: string;
}

const TERMINAL_RUN = new Set(['succeeded', 'failed', 'cancelled']);

/** Intersect host TrackerRecords with a task.list result. Same IDs, no second copy. */
export function intersectHostItemsWithTaskList<T extends { id: string }>(
  items: readonly T[],
  listed: readonly TaskListCard[],
): T[] {
  const ids = new Set(listed.map((row) => row.trackerId));
  return items.filter((item) => ids.has(item.id));
}

/**
 * Device-row count: non-terminal runs on that device in the current project.
 * Failed/cancelled cards can still sit in the 运行 column; they are not counted here.
 */
export function countActiveRunsByDevice(listed: readonly TaskListCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of listed) {
    if (!card.deviceId || !card.runStatus || TERMINAL_RUN.has(card.runStatus)) continue;
    counts[card.deviceId] = (counts[card.deviceId] ?? 0) + 1;
  }
  return counts;
}

export function boardLayoutMode(widthPx: number): 'columns' | 'stage-list' {
  return widthPx < 768 ? 'stage-list' : 'columns';
}

export function taskListInput(options: {
  deviceId?: string | null;
  search?: string;
  types?: string | string[];
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    types: options.types ?? 'all',
    statusScope: 'all',
    includeArchived: true,
  };
  if (options.deviceId) input.deviceId = options.deviceId;
  if (options.search?.trim()) input.q = options.search.trim();
  return input;
}
