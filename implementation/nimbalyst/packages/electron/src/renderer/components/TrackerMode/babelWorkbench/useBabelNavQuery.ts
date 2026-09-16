import { useEffect, useMemo, useState } from 'react';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { babelHostQuery } from './babelHostClient';
import { countActiveRunsByDevice, taskListInput, type TaskListCard } from './babelScope';

export type BabelNavConnection = 'idle' | 'demo' | 'unavailable';

export interface BabelProjectRow {
  id: string;
  name: string;
}

export interface BabelDeviceRow {
  id: string;
  label: string;
  displayStatus: string;
  demo: true;
  available: boolean;
  activeRuns: number;
}

export interface BabelNavQuery {
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

export function useBabelNavQuery(
  source: BabelDemoTrackerDataSource | null,
  projectId: string | undefined,
  deviceId: string | null,
  search?: string,
): BabelNavQuery {
  const [state, setState] = useState<BabelNavQuery>(EMPTY);
  const effectiveProject = projectId ?? source?.projectId;

  useEffect(() => {
    if (!source || !effectiveProject) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sameProject = effectiveProject === source.projectId;
        const listInput = taskListInput({ deviceId, search });
        const [projectsBody, devicesBody, listBody] = await Promise.all([
          source.queryRaw<{ mode?: string; projects?: BabelProjectRow[] }>('project.list'),
          sameProject
            ? source.queryRaw<{ mode?: string; devices?: Array<BabelDeviceRow & { demo?: true }> }>('device.list')
            : babelHostQuery<{ mode?: string; devices?: Array<BabelDeviceRow & { demo?: true }> }>(
              source,
              'device.list',
              {},
              effectiveProject,
            ),
          sameProject
            ? source.queryRaw<{ mode?: string; demoLabel?: string; items?: TaskListCard[] }>('task.list', listInput)
            : babelHostQuery<{ mode?: string; demoLabel?: string; items?: TaskListCard[] }>(
              source,
              'task.list',
              listInput,
              effectiveProject,
            ),
        ]);
        if (cancelled) return;
        const listed = listBody.items ?? [];
        const active = countActiveRunsByDevice(listed);
        setState({
          connection: 'demo',
          connectionNote: '演示服务已连接。设备状态来自 fixture，不是真实在线探测。',
          demoLabel: listBody.demoLabel ?? '演示数据',
          projects: (projectsBody.projects ?? []).map((row) => ({ id: row.id, name: row.name })),
          devices: (devicesBody.devices ?? []).map((row) => ({
            id: row.id,
            label: row.label,
            displayStatus: row.displayStatus,
            demo: true,
            available: Boolean(row.available),
            activeRuns: active[row.id] ?? 0,
          })),
          listed,
          listedIds: new Set(listed.map((row) => row.trackerId)),
        });
      } catch {
        if (cancelled) return;
        setState({
          connection: 'unavailable',
          connectionNote: '演示服务未接入。未按项目或设备筛选，也不显示在线。',
          demoLabel: '演示数据',
          projects: [],
          devices: [],
          listed: null,
          listedIds: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, effectiveProject, deviceId, search]);

  return useMemo(() => state, [state]);
}
