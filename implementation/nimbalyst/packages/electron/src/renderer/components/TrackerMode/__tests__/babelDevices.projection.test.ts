import { describe, expect, it } from 'vitest';
import {
  DEVICE_COLLECTION_INTERVAL_SECONDS,
  DEVICE_SNAPSHOT_STALE_AFTER_SECONDS,
  claimsRealOnline,
  connectionAccessLabel,
  layerProjection,
  projectDeviceConnectionView,
  projectDeviceDisplayStatus,
  snapshotFreshnessKind,
  snapshotFreshnessLabel,
} from '../babelDevices';
import type { DeviceQuerySnapshot } from '../babelDevices';

const demoQuery: DeviceQuerySnapshot = {
  connection: 'demo',
  connectionNote: '演示服务已连接。设备状态来自 fixture，不是真实在线探测。',
  demoLabel: '演示数据',
  projects: [{ id: 'fixture-project-babel', name: '巴别塔' }],
  devices: [
    {
      id: 'fixture-device-ubuntu',
      label: 'Ubuntu',
      displayStatus: '演示在线',
      demo: true,
      available: true,
      activeRuns: 1,
    },
    {
      id: 'fixture-device-mac',
      label: 'MacBook M3',
      displayStatus: '演示离线',
      demo: true,
      available: false,
      activeRuns: 0,
    },
  ],
};

describe('babel device connection projection', () => {
  it('labels demo vs unconnected access without inventing a live monitor', () => {
    expect(connectionAccessLabel('demo')).toBe('演示');
    expect(connectionAccessLabel('idle')).toBe('未接入');
    expect(connectionAccessLabel('unavailable')).toBe('未接入');
    expect(DEVICE_COLLECTION_INTERVAL_SECONDS).toBe(60);
    expect(DEVICE_SNAPSHOT_STALE_AFTER_SECONDS).toBe(150);
    expect(projectDeviceConnectionView({ query: demoQuery }).realMonitor).toBe(false);
  });

  it('keeps fixture 演示在线 only when the query is demo, never as real online', () => {
    expect(projectDeviceDisplayStatus({ displayStatus: '演示在线' }, 'demo')).toBe('演示在线');
    expect(projectDeviceDisplayStatus({ displayStatus: '演示在线' }, 'unavailable')).toBe('未接入');
    expect(projectDeviceDisplayStatus({ displayStatus: '演示在线' }, 'idle')).toBe('未接入');
    expect(claimsRealOnline('演示在线')).toBe(false);
    expect(claimsRealOnline('未接入')).toBe(false);
    expect(claimsRealOnline('在线')).toBe(true);
    expect(claimsRealOnline('设备在线')).toBe(true);
  });

  it('does not treat available=true as online when the query is unconnected', () => {
    const view = projectDeviceConnectionView({
      query: {
        connection: 'unavailable',
        connectionNote: '演示服务未接入。未按项目或设备筛选，也不显示在线。',
        projects: [],
        devices: [{
          id: 'rogue',
          label: 'Ghost',
          displayStatus: '在线',
          available: true,
        }],
      },
    });
    expect(view.accessLabel).toBe('未接入');
    expect(view.devices[0].displayStatus).toBe('未接入');
    expect(view.devices[0].accessLabel).toBe('未接入');
    expect(claimsRealOnline(view.devices[0].displayStatus)).toBe(false);
    expect(view.freshnessKind).toBe('unconnected');
    expect(view.freshnessLabel).toBe('未接入');
  });

  it('marks freshness unknown when device.list has no observation time', () => {
    const view = projectDeviceConnectionView({
      query: demoQuery,
      lastObservedAt: null,
      now: '2026-09-14T16:00:00.000Z',
    });
    expect(view.freshnessKind).toBe('unknown');
    expect(view.freshnessLabel).toBe('未知');
    expect(view.freshnessNote).toMatch(/不能推断设备离线/);
  });

  it('marks a snapshot stale after 150 seconds without calling that offline', () => {
    expect(snapshotFreshnessKind({
      connection: 'demo',
      lastObservedAt: '2026-09-14T15:58:00.000Z',
      now: '2026-09-14T16:00:00.000Z',
    })).toBe('fresh');
    expect(snapshotFreshnessKind({
      connection: 'demo',
      lastObservedAt: '2026-09-14T15:57:29.000Z',
      now: '2026-09-14T16:00:00.000Z',
    })).toBe('stale');
    expect(snapshotFreshnessLabel('stale')).toBe('快照过期');
    const stale = projectDeviceConnectionView({
      query: demoQuery,
      lastObservedAt: '2026-09-14T15:57:29.000Z',
      now: '2026-09-14T16:00:00.000Z',
    });
    expect(stale.freshnessKind).toBe('stale');
    expect(stale.freshnessNote).toMatch(/不能推断离线/);
    expect(stale.devices.every((row) => row.displayStatus !== '离线')).toBe(true);
  });

  it('keeps SSH, Worker and Agent layers separate and unknown on demo nodes', () => {
    const demoLayers = layerProjection('demo');
    expect(demoLayers.map((row) => row.label)).toEqual(['未知', '未知', '未知']);
    expect(demoLayers[0].note).toMatch(/不等于 Worker/);
    expect(layerProjection('idle').every((row) => row.label === '未接入')).toBe(true);
  });
});
