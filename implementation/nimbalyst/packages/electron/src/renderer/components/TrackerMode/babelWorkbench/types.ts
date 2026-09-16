export type BabelWorkbenchSection =
  | 'workspace'
  | 'devices'
  | 'projects'
  | 'trackers'
  | 'integrations'
  | 'ops'
  | 'settings';

export interface BabelWorkbenchState {
  section: BabelWorkbenchSection;
  projectId: string;
  deviceId: string | null;
}

export const BABEL_WORKBENCH_SECTION_LABEL: Record<BabelWorkbenchSection, string> = {
  workspace: '工作区',
  devices: '设备',
  projects: '项目',
  trackers: '任务看板',
  integrations: '集成',
  ops: '运维',
  settings: '设置',
};
