/** Read-only shapes that match existing project.list / device.list / capabilities.get queries. */

export type DeviceQueryConnection = 'idle' | 'demo' | 'unavailable';

export interface DeviceQueryProject {
  id: string;
  name: string;
}

export interface DeviceQueryDevice {
  id: string;
  label: string;
  displayStatus: string;
  demo?: boolean;
  available?: boolean;
  activeRuns?: number;
}

export interface DeviceQuerySnapshot {
  connection: DeviceQueryConnection;
  connectionNote?: string;
  demoLabel?: string;
  projects: DeviceQueryProject[];
  devices: DeviceQueryDevice[];
}

export interface CapabilityAction {
  allowed: boolean;
  reason?: string;
  code?: string;
}

export interface QueryErrorNote {
  code: string;
  message: string;
}

export type AccessLabel = '演示' | '未接入';
export type FreshnessKind = 'unconnected' | 'unknown' | 'fresh' | 'stale';

export interface DeviceLayerView {
  id: 'ssh' | 'worker' | 'agent';
  title: string;
  label: string;
  note: string;
}

export interface DeviceRowView {
  id: string;
  label: string;
  accessLabel: AccessLabel;
  displayStatus: string;
  availabilityNote: string;
  activeRuns: number;
  selected: boolean;
}

export interface DeviceFilterView {
  applied: boolean;
  deviceId: string | null;
  taskListInput: Record<string, unknown> | null;
  explanation: string;
}

export interface CapabilityNoteView {
  action: string;
  allowed: boolean;
  code?: string;
  reason?: string;
  text: string;
}

export interface LostRunView {
  status: string;
  isLost: boolean;
  label: string;
  note: string;
}

export interface DeviceConnectionView {
  accessLabel: AccessLabel;
  demoLabel: string;
  connectionNote: string;
  realMonitor: false;
  collectionIntervalSeconds: number;
  staleAfterSeconds: number;
  freshnessKind: FreshnessKind;
  freshnessLabel: string;
  freshnessNote: string;
  layers: DeviceLayerView[];
  projects: Array<DeviceQueryProject & { selected: boolean; accessLabel: AccessLabel }>;
  devices: DeviceRowView[];
  emptyProjects: string | null;
  emptyDevices: string | null;
  filter: DeviceFilterView;
  capabilityNotes: CapabilityNoteView[];
  lost: LostRunView | null;
  errors: QueryErrorNote[];
}
