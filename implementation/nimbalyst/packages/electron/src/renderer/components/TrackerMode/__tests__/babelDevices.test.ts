import { describe, expect, it } from 'vitest';
import {
  deviceListFilterInput,
  lostRunProjection,
  projectCapabilityNotes,
  projectDeviceConnectionView,
  projectQueryError,
} from '../babelDevices';
import type { DeviceQuerySnapshot } from '../babelDevices';

const demoQuery: DeviceQuerySnapshot = {
  connection: 'demo',
  demoLabel: '演示数据',
  projects: [{ id: 'fixture-project-babel', name: '巴别塔' }],
  devices: [{
    id: 'fixture-device-ubuntu',
    label: 'Ubuntu',
    displayStatus: '演示在线',
    available: true,
    activeRuns: 1,
  }],
};

describe('babel device filter and error projection', () => {
  it('reuses task.list input semantics instead of a local filter machine', () => {
    expect(deviceListFilterInput('fixture-device-ubuntu', ' PDF ')).toMatchObject({
      types: 'all',
      statusScope: 'all',
      includeArchived: true,
      deviceId: 'fixture-device-ubuntu',
      q: 'PDF',
    });
    expect(deviceListFilterInput(null)).not.toHaveProperty('deviceId');

    const allDevices = projectDeviceConnectionView({
      query: demoQuery,
      projectId: 'fixture-project-babel',
      deviceId: null,
    });
    expect(allDevices.filter.applied).toBe(true);
    expect(allDevices.filter.taskListInput).toMatchObject({
      types: 'all',
      includeArchived: true,
    });
    expect(allDevices.filter.taskListInput).not.toHaveProperty('deviceId');
    expect(allDevices.filter.explanation).toMatch(/不按设备过滤/);

    const oneDevice = projectDeviceConnectionView({
      query: demoQuery,
      deviceId: 'fixture-device-ubuntu',
    });
    expect(oneDevice.filter.taskListInput).toMatchObject({
      deviceId: 'fixture-device-ubuntu',
    });
    expect(oneDevice.filter.explanation).toMatch(/task\.list/);
  });

  it('does not apply a device filter when the query is unavailable', () => {
    const view = projectDeviceConnectionView({
      query: {
        connection: 'unavailable',
        connectionNote: '演示服务未接入。未按项目或设备筛选，也不显示在线。',
        projects: [],
        devices: [],
      },
      deviceId: 'fixture-device-ubuntu',
    });
    expect(view.filter.applied).toBe(false);
    expect(view.filter.taskListInput).toBeNull();
    expect(view.filter.explanation).toMatch(/不按项目或设备筛选/);
    expect(view.emptyDevices).toMatch(/不显示在线/);
    expect(view.errors[0]).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('projects capabilities.get denials including lost-unreconciled', () => {
    const notes = projectCapabilityNotes({
      'run.start': { allowed: false, reason: '失联尚未核对', code: 'LOST_UNRECONCILED' },
      'task.archive': { allowed: false, reason: '失联执行尚未核对，不能归档', code: 'LOST_UNRECONCILED' },
      'run.cancel': { allowed: true },
    });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      action: 'run.start',
      code: 'LOST_UNRECONCILED',
      text: 'LOST_UNRECONCILED：失联尚未核对',
    });
  });

  it('treats lost as unreconciled, not stopped', () => {
    const lost = lostRunProjection('lost');
    expect(lost).toMatchObject({
      isLost: true,
      label: '失联，尚未核对',
    });
    expect(lost?.note).toMatch(/不是已停止/);
    expect(lostRunProjection('succeeded')?.isLost).toBe(false);
    expect(lostRunProjection(null)).toBeNull();
  });

  it('surfaces structured query errors without inventing success', () => {
    expect(projectQueryError('unavailable', '演示服务未接入。未按项目或设备筛选，也不显示在线。', undefined))
      .toEqual([{
        code: 'UNAVAILABLE',
        message: '演示服务未接入。未按项目或设备筛选，也不显示在线。',
      }]);
    expect(projectQueryError('demo', undefined, {
      code: 'PERMISSION',
      message: '当前身份不能查询该项目的设备列表',
    })).toEqual([{
      code: 'PERMISSION',
      message: '当前身份不能查询该项目的设备列表',
    }]);
  });

  it('keeps selected project and device as a read-only highlight', () => {
    const view = projectDeviceConnectionView({
      query: demoQuery,
      projectId: 'fixture-project-babel',
      deviceId: 'fixture-device-ubuntu',
      latestRunStatus: 'lost',
      capabilities: {
        'run.retry': { allowed: false, reason: '失联尚未核对', code: 'LOST_UNRECONCILED' },
      },
    });
    expect(view.projects[0].selected).toBe(true);
    expect(view.devices[0].selected).toBe(true);
    expect(view.collectionIntervalSeconds).toBe(60);
    expect(view.lost?.isLost).toBe(true);
    expect(view.capabilityNotes[0].code).toBe('LOST_UNRECONCILED');
  });
});
