import { describe, expect, it } from 'vitest';
import {
  GOOGLE_OVERLAP_WINDOW_SECONDS,
  GOOGLE_POLL_INTERVAL_SECONDS,
  claimsRealGoogleSync,
  googleAccessLabel,
  googleSyncKind,
  googleSyncLabel,
  projectGoogleTasksView,
  sanitizeSyncNote,
} from '../babelGoogle';

describe('babel Google Tasks projection', () => {
  it('labels demo versus unconnected access and never claims a real sync', () => {
    expect(googleAccessLabel('demo')).toBe('演示');
    expect(googleAccessLabel('idle')).toBe('未接入');
    expect(googleAccessLabel('unavailable')).toBe('未接入');
    expect(GOOGLE_POLL_INTERVAL_SECONDS).toBe(60);
    expect(GOOGLE_OVERLAP_WINDOW_SECONDS).toBe(120);

    const view = projectGoogleTasksView({
      status: {
        connection: 'demo',
        demoLabel: '演示数据',
        lastSyntheticPullAt: '2026-09-14T11:00:00.000Z',
      },
    });
    expect(view.realSync).toBe(false);
    expect(view.oauthStarted).toBe(false);
    expect(view.syncLabel).toBe('合成拉取已完成（演示）');
    expect(view.syncNote).toMatch(/不是真实 Google 同步成功/);
    expect(claimsRealGoogleSync(view.syncLabel)).toBe(false);
    expect(claimsRealGoogleSync(view.syncNote)).toBe(false);
  });

  it('does not treat a missing pull time as a successful Google sync', () => {
    expect(googleSyncKind({ connection: 'demo' })).toBe('unknown');
    expect(googleSyncLabel('unknown')).toBe('未知');
    const view = projectGoogleTasksView({
      status: { connection: 'demo', demoLabel: '演示数据' },
    });
    expect(view.syncKind).toBe('unknown');
    expect(view.syncNote).toMatch(/不能写成已同步/);
  });

  it('rewrites unconnected rows that try to say 同步成功', () => {
    expect(claimsRealGoogleSync('同步成功')).toBe(true);
    expect(claimsRealGoogleSync('已同步')).toBe(true);
    expect(claimsRealGoogleSync('合成拉取已完成（演示）')).toBe(false);
    expect(sanitizeSyncNote('同步成功')).toBe('未接入真实 Google 账号。不显示同步成功。');

    const view = projectGoogleTasksView({
      status: {
        connection: 'idle',
        connectionNote: '同步成功',
        selectedTasklistId: 'list-babel',
        selectedTasklistTitle: '巴别塔',
      },
    });
    expect(view.accessLabel).toBe('未接入');
    expect(view.realSync).toBe(false);
    expect(view.connectionNote).toBe('未接入真实 Google 账号。不显示同步成功。');
    expect(view.syncLabel).toBe('未接入');
    expect(view.selectedListNote).toMatch(/不能当作已同步/);
  });

  it('surfaces 需重新登录 without starting OAuth', () => {
    const view = projectGoogleTasksView({
      status: {
        connection: 'demo',
        reauthRequired: true,
        lastError: { status: 401, message: '需重新登录' },
      },
    });
    expect(view.syncKind).toBe('reauth');
    expect(view.syncLabel).toBe('需重新登录');
    expect(view.oauthStarted).toBe(false);
    expect(view.errors.some((row) => row.code === 'REAUTH_REQUIRED')).toBe(true);
  });
});
