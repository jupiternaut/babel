import { describe, expect, it } from 'vitest';
import {
  boardLayoutMode,
  countActiveRunsByDevice,
  intersectHostItemsWithTaskList,
  taskListInput,
} from '../babelWorkbench/babelScope';

describe('babel workbench scope helpers', () => {
  it('intersects host records with task.list ids instead of a second copy', () => {
    const host = [{ id: 'trk-a' }, { id: 'trk-b' }, { id: 'trk-c' }];
    const listed = [{ trackerId: 'trk-b' }, { trackerId: 'trk-c' }];
    expect(intersectHostItemsWithTaskList(host, listed).map((row) => row.id)).toEqual(['trk-b', 'trk-c']);
  });

  it('counts only non-terminal runs per device', () => {
    const counts = countActiveRunsByDevice([
      { trackerId: '1', deviceId: 'dev-pi', runStatus: 'running' },
      { trackerId: '2', deviceId: 'dev-pi', runStatus: 'succeeded' },
      { trackerId: '3', deviceId: 'dev-win', runStatus: 'queued' },
    ]);
    expect(counts).toEqual({ 'dev-pi': 1, 'dev-win': 1 });
  });

  it('switches the board to a stage list below 768px', () => {
    expect(boardLayoutMode(767)).toBe('stage-list');
    expect(boardLayoutMode(768)).toBe('columns');
  });

  it('builds a task.list input that keeps archived rows and device filter', () => {
    expect(taskListInput({ deviceId: 'dev-pi', search: ' PDF ' })).toMatchObject({
      types: 'all',
      statusScope: 'all',
      includeArchived: true,
      deviceId: 'dev-pi',
      q: 'PDF',
    });
  });
});
