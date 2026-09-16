import { describe, expect, it } from 'vitest';
import {
  boardLayoutMode,
  countActiveRunsByDevice,
  intersectHostItemsWithTaskList,
  taskListInput,
} from '../babelWorkbench/babelScope';

describe('babel workbench scope', () => {
  it('intersects host records with task.list ids', () => {
    const host = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const listed = [{ trackerId: 'b' }, { trackerId: 'c' }];
    expect(intersectHostItemsWithTaskList(host, listed).map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('omits deviceId from task.list input for 全部设备 so unassigned TODO remain', () => {
    expect(taskListInput({ deviceId: null })).toEqual({
      types: 'all',
      statusScope: 'all',
      includeArchived: true,
    });
    expect(taskListInput({ deviceId: 'fixture-device-ubuntu', search: 'PDF' })).toEqual({
      types: 'all',
      statusScope: 'all',
      includeArchived: true,
      deviceId: 'fixture-device-ubuntu',
      q: 'PDF',
    });
  });

  it('counts only non-terminal runs on a device', () => {
    expect(countActiveRunsByDevice([
      { trackerId: '1', deviceId: 'ubuntu', runStatus: 'executing' },
      { trackerId: '2', deviceId: 'ubuntu', runStatus: 'failed' },
      { trackerId: '3', deviceId: 'mac', runStatus: 'accepted' },
      { trackerId: '4', deviceId: null, runStatus: 'executing' },
    ])).toEqual({ ubuntu: 1, mac: 1 });
  });
});

describe('board layout', () => {
  it('uses a stage list below 768 and four columns at or above', () => {
    expect(boardLayoutMode(767)).toBe('stage-list');
    expect(boardLayoutMode(768)).toBe('columns');
    expect(boardLayoutMode(1586)).toBe('columns');
  });
});
