/** Read-only ops / nodes / PDF sidebar surfaces. Not live integrations. */

export type SurfaceAccess = 'idle' | 'demo' | 'unavailable';
export type SurfaceAccessLabel = '演示' | '未接入';

export interface SurfaceQueryError {
  code: string;
  message: string;
}

export interface SurfaceStatusSnapshot {
  connection?: SurfaceAccess | null;
  demoLabel?: string;
  connectionNote?: string;
  queryError?: { code?: string; message?: string } | unknown;
}

export interface OpsSurfaceSnapshot extends SurfaceStatusSnapshot {
  lastProbeOutcome?: 'ok' | 'http_error' | 'timeout' | 'unreachable' | null;
  lastProbeAt?: string | null;
  draftCount?: number;
  chatVendor?: 'none' | string | null;
}

export interface NodesSurfaceSnapshot extends SurfaceStatusSnapshot {
  nodeId?: string | null;
  platform?: 'windows' | 'ubuntu' | 'macos' | null;
  lastCollectedAt?: string | null;
  attachedResourceCount?: number;
}

export interface PdfSurfaceSnapshot extends SurfaceStatusSnapshot {
  documentId?: string | null;
  revision?: number | null;
  translationSource?: 'test-fixture' | 'live' | null;
  annotationCount?: number;
}

export interface SurfaceLayerView {
  id: string;
  title: string;
  label: string;
  note: string;
}

export type HealthKind = 'unconnected' | 'unknown' | 'synthetic-ok' | 'synthetic-fail';
export type NodeFreshnessKind = 'unconnected' | 'unknown' | 'fresh' | 'stale';
export type TranslationKind = 'unconnected' | 'none' | 'test-fixture';

export interface OpsSurfaceView {
  kind: 'ops';
  accessLabel: SurfaceAccessLabel;
  demoLabel: string;
  connectionNote: string;
  realOps: false;
  realHealth: false;
  restartExecuted: false;
  chatVendorSelected: false;
  healthKind: HealthKind;
  healthLabel: string;
  healthNote: string;
  draftCount: number;
  layers: SurfaceLayerView[];
  ruleNotes: string[];
  errors: SurfaceQueryError[];
}

export interface NodesSurfaceView {
  kind: 'nodes';
  accessLabel: SurfaceAccessLabel;
  demoLabel: string;
  connectionNote: string;
  realMachine: false;
  realSsh: false;
  nodeId: string | null;
  platform: string | null;
  freshnessKind: NodeFreshnessKind;
  freshnessLabel: string;
  freshnessNote: string;
  attachedResourceCount: number;
  layers: SurfaceLayerView[];
  ruleNotes: string[];
  errors: SurfaceQueryError[];
}

export interface PdfSurfaceView {
  kind: 'pdf';
  accessLabel: SurfaceAccessLabel;
  demoLabel: string;
  connectionNote: string;
  realTranslation: false;
  liveReader: false;
  documentId: string | null;
  revision: number | null;
  translationKind: TranslationKind;
  translationLabel: string;
  translationNote: string;
  annotationCount: number;
  layers: SurfaceLayerView[];
  ruleNotes: string[];
  errors: SurfaceQueryError[];
}

export interface OfflineSurfacesView {
  ops: OpsSurfaceView;
  nodes: NodesSurfaceView;
  pdf: PdfSurfaceView;
  boardBreakpointPx: 768;
  boardLayoutMode: 'columns' | 'stage-list';
  boardLayoutNote: string;
  placementNote: string;
}
