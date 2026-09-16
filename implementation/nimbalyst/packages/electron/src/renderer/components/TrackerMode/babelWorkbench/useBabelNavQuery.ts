import { useEffect, useMemo, useState } from 'react';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { countActiveRunsByDevice, taskListInput, type TaskListCard } from './babelScope';

export type BabelNavConnection = 'idle' | 'demo' | 'local' | 'unavailable';

export interface BabelProjectRow {
  id: string;
  name: string;
}

export interface BabelDeviceRow {
  id: string;
  label: string;
  displayStatus: string;
  demo: boolean;
  available: boolean;
  activeRuns: number;
}

export interface BabelNavQuery {
  mode?: 'demo' | 'local';
  boundProjectId?: string;
  connection: BabelNavConnection;
  connectionNote: string;
  demoLabel: string;
  projects: BabelProjectRow[];
  devices: BabelDeviceRow[];
  listed: TaskListCard[] | null;
  listedIds: Set<string> | null;
}

const EMPTY: BabelNavQuery = {
  connection: 'idle',
  connectionNote: '',
  demoLabel: '演示数据',
  projects: [],
  devices: [],
  listed: null,
  listedIds: null,
};
const PENDING: BabelNavQuery = { ...EMPTY, listedIds: new Set() };

export function useBabelNavQuery(
  source: BabelDemoTrackerDataSource | null,
  projectId: string | undefined,
  deviceId: string | null,
  search?: string,
): BabelNavQuery {
  const initialMode = source?.mode ?? 'demo';
  const pending = { ...PENDING, mode: initialMode, demoLabel: initialMode === 'local' ? '本机 Pi' : '演示数据' };
  const effectiveProject = projectId ?? source?.projectId;
  const scope = useMemo(() => ({ source, effectiveProject, deviceId, search }), [source, effectiveProject, deviceId, search]);
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope | null; query: BabelNavQuery }>({ scope: null, query: EMPTY });

  useEffect(() => {
    const setState = (next: BabelNavQuery | ((previous: BabelNavQuery) => BabelNavQuery)) => {
      setSnapshot((previous) => ({ scope, query: typeof next === 'function'
        ? next(previous.scope === scope ? previous.query : pending) : next }));
    };
    if (!source || !effectiveProject) {
      setState(EMPTY);
      return;
    }
    if (effectiveProject !== source.projectId) {
      setState({ ...pending, boundProjectId: source.projectId, connection: 'unavailable', connectionNote: '此项目尚未绑定当前工作区，请在对应工作区打开。' });
      return;
    }
    let cancelled = false;
    let generation = 0;
    setState(pending);
    const refresh = async () => {
      const request = ++generation;
      try {
        const listInput = taskListInput({ deviceId, search });
        const listQuery = source.queryRaw<{ mode?: string; demoLabel?: string; items?: TaskListCard[] }>('task.list', listInput);
        const projectListQuery = deviceId || search?.trim()
          ? source.queryRaw<{ items?: TaskListCard[] }>('task.list', taskListInput({}))
          : listQuery;
        const [projectsBody, devicesBody, listBody, projectListBody] = await Promise.all([
          source.queryRaw<{ mode?: string; projects?: BabelProjectRow[] }>('project.list'),
          source.queryRaw<{ mode?: string; devices?: Array<BabelDeviceRow> }>('device.list'),
          listQuery,
          projectListQuery,
        ]);
        if (cancelled || request !== generation) return;
        const listed = listBody.items ?? [];
        const active = countActiveRunsByDevice(projectListBody.items ?? []);
        const mode = listBody.mode === 'local' ? 'local' : listBody.mode === 'demo' ? 'demo' : initialMode;
        setState({
          mode,
          boundProjectId: source.projectId,
          connection: mode,
          connectionNote: mode === 'local' ? '已连接本机 Pi 服务。执行状态以实际会话输出为准。' : '演示服务已连接。设备状态来自 fixture，不是真实在线探测。',
          demoLabel: mode === 'local' ? '本机 Pi' : listBody.demoLabel ?? '演示数据',
          projects: (projectsBody.projects ?? []).map((row) => ({ id: row.id, name: row.name })),
          devices: (devicesBody.devices ?? []).map((row) => ({
            id: row.id,
            label: row.label,
            displayStatus: row.displayStatus,
            demo: mode === 'demo',
            available: Boolean(row.available),
            activeRuns: active[row.id] ?? 0,
          })),
          listed,
          listedIds: new Set(listed.map((row) => row.trackerId)),
        });
      } catch {
        if (cancelled || request !== generation) return;
        setState((previous) => ({
          ...previous,
          connection: 'unavailable',
          connectionNote: previous.listed
            ? '连接中断，保留上次查询快照；状态可能已过期。'
            : initialMode === 'local' ? '本机 Pi 服务未接入，尚无当前范围的快照。' : '演示服务未接入，尚无当前范围的快照。',
        }));
      }
    };
    const unsubscribe = source.subscribe(() => { void refresh(); });
    void refresh();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [source, effectiveProject, deviceId, search, scope]);

  // Identity changes must hide the previous scope even before the effect runs.
  return snapshot.scope === scope ? snapshot.query : source ? pending : EMPTY;
}
