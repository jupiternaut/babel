/** Real device/service control contract. Separate from the synthetic task namespace. */
export type SystemAction = 'start' | 'stop' | 'restart';
export type ServiceKind = 'windows-service' | 'scheduled-task' | 'startup-shortcut' | 'wsl-systemd' | 'systemd' | 'launchd' | 'managed-process';
export interface ServiceDefinition {
  id: string;
  label: string;
  kind: ServiceKind;
  target: string;
  description?: string;
  distribution?: string;
  taskPath?: string;
  executable?: string;
  args?: string[];
  cwd?: string;
  processName?: string;
  shortcutPath?: string;
  startupPath?: string;
  logPath?: string;
  healthUrl?: string;
  ports?: number[];
  dependsOn?: string[];
}
export interface ProcessIdentity { pid: number; startedAt: string; }
export interface ProcessInfo extends ProcessIdentity {
  name: string;
  parentPid?: number;
  cpuPercent: number | null;
  memoryBytes: number;
  executable?: string;
}
export interface ResourceSnapshot {
  hostname: string;
  platform: string;
  sampledAt: string;
  cpuPercent: number | null;
  memory: { totalBytes: number; availableBytes: number; usedBytes: number };
  disks: Array<{ name: string; totalBytes: number; freeBytes: number }>;
  uptimeSeconds: number;
  warnings: string[];
}
export interface ServiceSnapshot {
  id: string;
  state: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown' | 'unavailable';
  autostart: { enabled: boolean | null; trigger: string; detail?: string };
  processes: ProcessIdentity[];
  sampledAt: string;
  health: 'healthy' | 'unhealthy' | 'unknown' | 'not-configured';
  message?: string;
}
export interface SystemAdapter {
  resources(): Promise<ResourceSnapshot>;
  processes(): Promise<ProcessInfo[]>;
  inspect(service: ServiceDefinition): Promise<ServiceSnapshot>;
  control(service: ServiceDefinition, action: SystemAction): Promise<void>;
  setAutostart(service: ServiceDefinition, enabled: boolean): Promise<void>;
  logs(service: ServiceDefinition, limit: number): Promise<string>;
  terminateProcess(identity: ProcessIdentity, force: boolean): Promise<void>;
}
export interface Operation {
  id: string;
  requestId: string;
  action: string;
  targetId: string;
  requestedAt: string;
  finishedAt?: string;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  before?: ServiceSnapshot;
  after?: ServiceSnapshot;
  error?: { code: string; message: string };
}
export interface ConsoleQuery {
  name: 'resources' | 'processes' | 'services' | 'service' | 'logs' | 'operations' | 'events';
  serviceId?: string;
  limit?: number;
  after?: number;
}
export interface ConsoleCommand {
  name: 'service.start' | 'service.stop' | 'service.restart' | 'service.autostart' | 'process.terminate';
  serviceId?: string;
  enabled?: boolean;
  process?: ProcessIdentity;
  force?: boolean;
  requestId: string;
}
export interface ConsoleEvent { seq: number; type: string; at: string; operationId: string; targetId: string; }
export class SystemError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SystemError'; }
}
