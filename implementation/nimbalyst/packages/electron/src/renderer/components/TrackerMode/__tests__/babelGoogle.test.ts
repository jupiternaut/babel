import { describe, expect, it } from 'vitest';
import { projectGoogleErrors, projectGoogleTasksView } from '../babelGoogle';

describe('babel Google Tasks settings notes', () => {
  it('keeps selected list and conflict count as a read-only projection', () => {
    const view = projectGoogleTasksView({
      status: {
        connection: 'demo',
        demoLabel: '演示数据',
        selectedTasklistId: 'list-babel',
        selectedTasklistTitle: '巴别塔',
        lastSyntheticPullAt: '2026-09-14T11:00:00.000Z',
        conflictCount: 2,
      },
    });
    expect(view.selectedTasklistId).toBe('list-babel');
    expect(view.selectedTasklistTitle).toBe('巴别塔');
    expect(view.conflictCount).toBe(2);
    expect(view.conflictNote).toMatch(/外部完成不是 Agent 已成功/);
    expect(view.ruleNotes.some((note) => note.includes('不删除本地记录'))).toBe(true);
    expect(view.ruleNotes.some((note) => note.includes('不读取用户 OAuth'))).toBe(true);
    expect(view.pollIntervalSeconds).toBe(60);
  });

  it('does not apply a list import when the query is unavailable', () => {
    const view = projectGoogleTasksView({
      status: {
        connection: 'unavailable',
        connectionNote: '演示服务未接入。未启动 Google 同步。',
        selectedTasklistId: 'list-babel',
      },
    });
    expect(view.accessLabel).toBe('未接入');
    expect(view.syncKind).toBe('unconnected');
    expect(view.realSync).toBe(false);
    expect(view.errors[0]).toMatchObject({ code: 'UNAVAILABLE' });
    expect(view.selectedListNote).toMatch(/不能当作已同步/);
  });

  it('surfaces structured upstream errors without inventing success', () => {
    expect(projectGoogleErrors({
      connection: 'unavailable',
      connectionNote: '演示服务未接入。未启动 Google 同步。',
    })).toEqual([{
      code: 'UNAVAILABLE',
      message: '演示服务未接入。未启动 Google 同步。',
    }]);
    expect(projectGoogleErrors({
      connection: 'demo',
      lastError: { code: 'RATE_LIMITED', status: 429, message: '请求过于频繁，稍后重试' },
    })).toEqual([{
      code: 'RATE_LIMITED',
      message: '请求过于频繁，稍后重试',
    }]);
  });

  it('defaults to 未接入 when the host has not passed a status snapshot', () => {
    const view = projectGoogleTasksView();
    expect(view.accessLabel).toBe('未接入');
    expect(view.realSync).toBe(false);
    expect(view.oauthStarted).toBe(false);
    expect(view.syncLabel).toBe('未接入');
    expect(view.selectedTasklistId).toBeNull();
  });
});
