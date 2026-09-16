import type { TrackerDataSource } from '@nimbalyst/collab-client/trackers';
import { BabelDemoTrackerDataSource } from './BabelDemoTrackerDataSource';
import { isBabelDemoWorkspace } from './babelDemoWorkspace';
import { ElectronTrackerDataSource } from './ElectronTrackerDataSource';

/** One factory for the workspace TrackerDataSource. Demo profile never falls back to IPC. */
export function createWorkspaceTrackerDataSource(workspacePath: string): TrackerDataSource {
  if (isBabelDemoWorkspace(workspacePath)) {
    return new BabelDemoTrackerDataSource({ workspacePath });
  }
  return new ElectronTrackerDataSource({ workspacePath });
}

export function isBabelDemoDataSource(
  source: TrackerDataSource | null | undefined,
): source is BabelDemoTrackerDataSource {
  return Boolean(source && (source as BabelDemoTrackerDataSource).kind === 'babel-demo');
}

export function resolveBabelDemoWriteSource(
  source: TrackerDataSource | null | undefined,
): BabelDemoTrackerDataSource | null {
  return isBabelDemoDataSource(source) ? source : null;
}
