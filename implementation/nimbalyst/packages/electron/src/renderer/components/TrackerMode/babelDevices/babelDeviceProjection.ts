import { formatBabelHostError } from '../../../services/babelDemoErrors';
import { taskListInput } from '../babelWorkbench/babelScope';
import type {
  AccessLabel,
  CapabilityAction,
  CapabilityNoteView,
  DeviceConnectionView,
  DeviceLayerView,
  DeviceQueryConnection,
  DeviceQueryDevice,
  DeviceQuerySnapshot,
  FreshnessKind,
  LostRunView,
  QueryErrorNote,
} from './types';

/** Spec 8.1: Ubuntu Gateway collects registered nodes on this interval. Display only. */
export const DEVICE_COLLECTION_INTERVAL_SECONDS = 60;

/** Spec 8.1: default stale after this many seconds without a successful collection. */
export const DEVICE_SNAPSHOT_STALE_AFTER_SECONDS = 150;

export interface DeviceConnectionInput {
  query: DeviceQuerySnapshot;
  projectId?: string;
  deviceId?: string | null;
  lastObservedAt?: string | null;
  now?: string;
  capabilities?: Record<string, CapabilityAction>;
  latestRunStatus?: string | null;
  queryError?: { code?: string; message?: string } | unknown;
}

export function connectionAccessLabel(connection: DeviceQueryConnection): AccessLabel {
  return connection === 'demo' ? '演示' : '未接入';
}

export function snapshotFreshnessKind(input: {
  connection: DeviceQueryConnection;
  lastObservedAt?: string | null;
  now: string;
}): FreshnessKind {
  if (input.connection !== 'demo') return 'unconnected';
  if (!input.lastObservedAt) return 'unknown';
  const observed = Date.parse(input.lastObservedAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return 'unknown';
  const ageMs = now - observed;
  if (ageMs > DEVICE_SNAPSHOT_STALE_AFTER_SECONDS * 1000) return 'stale';
  return 'fresh';
}

export function snapshotFreshnessLabel(kind: FreshnessKind): string {
  switch (kind) {
    case 'unconnected':
      return '未接入';
    case 'unknown':
      return '未知';
    case 'stale':
      return '快照过期';
    case 'fresh':
      return '已采集（演示）';
  }
}

export function snapshotFreshnessNote(kind: FreshnessKind): string {
  switch (kind) {
    case 'unconnected':
      return '没有真连接。未接入采集，不显示在线。';
    case 'unknown':
      return '查询未返回观测时间，不能推断设备离线或 Agent 已停止。';
    case 'stale':
      return '超过 150 秒未成功采集。快照过期不能推断离线或 Agent 已停止。';
    case 'fresh':
      return '最近一次成功采集在 freshness 阈值内。这是演示节点，不是真机在线探测。';
  }
}

export function projectDeviceDisplayStatus(
  row: Pick<DeviceQueryDevice, 'displayStatus'>,
  connection: DeviceQueryConnection,
): string {
  if (connection !== 'demo') return '未接入';
  return row.displayStatus;
}

export function claimsRealOnline(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  if (!normalized.includes('在线')) return false;
  return !normalized.includes('演示在线');
}

export function layerProjection(connection: DeviceQueryConnection): DeviceLayerView[] {
  if (connection !== 'demo') {
    return [
      { id: 'ssh', title: 'SSH 可达', label: '未接入', note: '没有 SSH 探测，不能写成不可达或已离线。' },
      { id: 'worker', title: 'Worker 可用', label: '未接入', note: '没有 Worker 探测。SSH 未接入也不等于节点已停止。' },
      { id: 'agent', title: 'Agent 能力可用', label: '未接入', note: '没有 Agent 能力探测。未接入不能写成 Agent 已停止。' },
    ];
  }
  return [
    { id: 'ssh', title: 'SSH 可达', label: '未知', note: 'SSH 可达不等于 Worker 可用。演示节点未做真机探测。' },
    { id: 'worker', title: 'Worker 可用', label: '未知', note: 'Worker 可用不等于 Agent 可用。演示节点未做真机探测。' },
    { id: 'agent', title: 'Agent 能力可用', label: '未知', note: 'Agent 状态来自查询投影，不是真机能力探测。' },
  ];
}

export function availabilityNote(
  connection: DeviceQueryConnection,
  available: boolean | undefined,
): string {
  if (connection !== 'demo') {
    return '未接入。不能把空列表或 available 当成离线。';
  }
  if (available) {
    return '演示节点标为可启动。这不是真机在线探测。';
  }
  return '演示节点标为不可用（演示离线）。这不是真机离线探测。';
}

export function lostRunProjection(status: string | null | undefined): LostRunView | null {
  if (!status) return null;
  if (status === 'lost') {
    return {
      status,
      isLost: true,
      label: '失联，尚未核对',
      note: '失联不是已停止。需要核对后才能重试、启动或归档。',
    };
  }
  return {
    status,
    isLost: false,
    label: status,
    note: '执行状态来自查询，不是设备在线探测。',
  };
}

export function projectCapabilityNotes(
  capabilities: Record<string, CapabilityAction> | undefined,
): CapabilityNoteView[] {
  if (!capabilities) return [];
  return Object.entries(capabilities)
    .filter(([, action]) => action && action.allowed === false)
    .map(([name, action]) => ({
      action: name,
      allowed: false,
      code: action.code,
      reason: action.reason,
      text: [action.code, action.reason].filter(Boolean).join('：') || '该操作当前不可用',
    }));
}

export function deviceListFilterInput(
  deviceId: string | null | undefined,
  search?: string,
): Record<string, unknown> {
  return taskListInput({ deviceId: deviceId ?? null, search });
}

export function projectQueryError(
  connection: DeviceQueryConnection,
  connectionNote: string | undefined,
  queryError: DeviceConnectionInput['queryError'],
): QueryErrorNote[] {
  const errors: QueryErrorNote[] = [];
  if (connection === 'unavailable') {
    errors.push({
      code: 'UNAVAILABLE',
      message: connectionNote || '演示服务未接入。未按项目或设备筛选，也不显示在线。',
    });
  }
  if (queryError != null) {
    if (typeof queryError === 'object' && queryError && 'message' in queryError) {
      const row = queryError as { code?: string; message?: string };
      if (row.message) {
        errors.push({
          code: row.code ?? 'UNAVAILABLE',
          message: row.message,
        });
      }
    } else {
      const formatted = formatBabelHostError(queryError);
      errors.push(formatted);
    }
  }
  return errors;
}

export function projectDeviceConnectionView(input: DeviceConnectionInput): DeviceConnectionView {
  const { query } = input;
  const accessLabel = connectionAccessLabel(query.connection);
  const now = input.now ?? new Date().toISOString();
  const freshnessKind = snapshotFreshnessKind({
    connection: query.connection,
    lastObservedAt: input.lastObservedAt,
    now,
  });
  const deviceId = input.deviceId ?? null;
  const applied = query.connection === 'demo';

  return {
    accessLabel,
    demoLabel: query.demoLabel || '演示数据',
    connectionNote: query.connectionNote
      || (applied
        ? '演示服务已连接。设备状态来自 fixture，不是真实在线探测。'
        : '没有真连接。显示未接入，不显示在线。'),
    realMonitor: false,
    collectionIntervalSeconds: DEVICE_COLLECTION_INTERVAL_SECONDS,
    staleAfterSeconds: DEVICE_SNAPSHOT_STALE_AFTER_SECONDS,
    freshnessKind,
    freshnessLabel: snapshotFreshnessLabel(freshnessKind),
    freshnessNote: snapshotFreshnessNote(freshnessKind),
    layers: layerProjection(query.connection),
    projects: query.projects.map((project) => ({
      ...project,
      selected: project.id === input.projectId,
      accessLabel,
    })),
    devices: query.devices.map((device) => ({
      id: device.id,
      label: device.label,
      accessLabel,
      displayStatus: projectDeviceDisplayStatus(device, query.connection),
      availabilityNote: availabilityNote(query.connection, device.available),
      activeRuns: device.activeRuns ?? 0,
      selected: device.id === deviceId,
    })),
    emptyProjects: query.projects.length === 0
      ? (applied ? '没有可查询的项目。' : '项目列表未接入。')
      : null,
    emptyDevices: query.devices.length === 0
      ? (applied ? '没有可查询的设备。' : '设备列表未接入，不显示在线。')
      : null,
    filter: {
      applied,
      deviceId,
      taskListInput: applied ? deviceListFilterInput(deviceId) : null,
      explanation: applied
        ? (deviceId
          ? '当前筛选带 task.list 的 deviceId，不是面板内另写的状态机。'
          : '未指定 deviceId。task.list 不按设备过滤（含未分配）。')
        : '未接入查询。不按项目或设备筛选，也不显示在线。',
    },
    capabilityNotes: projectCapabilityNotes(input.capabilities),
    lost: lostRunProjection(input.latestRunStatus),
    errors: projectQueryError(query.connection, query.connectionNote, input.queryError),
  };
}
