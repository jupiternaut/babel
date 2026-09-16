import type { BabelWorkbenchState } from './types';

const DEFAULT: BabelWorkbenchState = {
  section: 'trackers',
  projectId: 'fixture-project-babel',
  deviceId: null,
};

let state: BabelWorkbenchState = { ...DEFAULT };
const listeners = new Set<() => void>();

export function getBabelWorkbench(): BabelWorkbenchState {
  return state;
}

export function setBabelWorkbench(patch: Partial<BabelWorkbenchState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeBabelWorkbench(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
