import { useCallback, useRef, useSyncExternalStore } from 'react';
import { normalizeRelationshipValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerRelationships';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { formatBabelHostError } from '../../../services/babelDemoErrors';
import { hostRecordRevision } from '../babelExecutionStage';

export const babelEditableRelations = new Set(['dependsOn', 'blocks']);
interface RelationDraft {
  updates: Record<string, unknown>;
  base: Record<string, unknown>;
  revision: number | undefined;
}
interface RelationState {
  draft: RelationDraft | null;
  request: object | null;
  error: { code: string; message: string } | null;
}
const empty: RelationState = { draft: null, request: null, error: null };
// Session-only drafts, scoped to the authority and record; no host persistence.
const states = new Map<string, RelationState>();
const listeners = new Map<string, Set<() => void>>();
const read = (key: string) => states.get(key) ?? empty;
const ids = (value: unknown) => normalizeRelationshipValue(value).map(link => link.itemId);
const equal = (a: unknown, b: unknown) => JSON.stringify(ids(a).sort()) === JSON.stringify(ids(b).sort());
function write(key: string, state: RelationState) {
  if (state === empty) states.delete(key);
  else states.set(key, state);
  for (const notify of listeners.get(key) ?? []) notify();
}

export function useBabelRelationDraft(item: TrackerRecord | null | undefined, source: BabelDemoTrackerDataSource | null, editable: boolean) {
  const key = JSON.stringify([source?.endpoint, source?.projectId, item?.id]);
  const subscribe = useCallback((notify: () => void) => {
    const entries = listeners.get(key) ?? new Set<() => void>();
    entries.add(notify);
    listeners.set(key, entries);
    return () => { entries.delete(notify); if (!entries.size) listeners.delete(key); };
  }, [key]);
  const state = useSyncExternalStore(subscribe, () => read(key), () => empty);
  const revision = item ? hostRecordRevision(item) : undefined;
  const validRevision = Number.isSafeInteger(revision) && (revision ?? -1) >= 1;
  const writable = Boolean(source && item && editable && !(item.system as { readOnly?: boolean }).readOnly && item.fields.babelReadOnly !== true);
  const currentRef = useRef({ key, item, source, writable });
  currentRef.current = { key, item, source, writable };
  const current = () => currentRef.current.key === key && currentRef.current.item === item && currentRef.current.source === source && currentRef.current.writable === writable;
  const conflict = Boolean(state.draft && !state.request && (state.draft.revision !== revision || state.error?.code === 'REVISION_CONFLICT'));
  const canSave = writable && validRevision && Boolean(state.draft) && !state.request && !conflict;

  function change(field: string, value: unknown) {
    if (!current() || !writable || !validRevision || !item || !babelEditableRelations.has(field)) return;
    const latest = read(key);
    if (latest.request) return;
    const draft = latest.draft ?? { base: { ...item.fields }, revision, updates: {} };
    const updates = { ...draft.updates, [field]: normalizeRelationshipValue(value).map(link => ({ ...link })) };
    if (equal(value, draft.base[field])) delete updates[field];
    write(key, Object.keys(updates).length ? { ...latest, draft: { ...draft, updates } } : empty);
  }
  function useRemote() {
    if (current() && !read(key).request) write(key, empty);
  }
  function continueEditing() {
    if (!current() || !item || !writable || !validRevision) return;
    const latest = read(key);
    if (!latest.draft || latest.request) return;
    const updates = Object.fromEntries(Object.entries(latest.draft.updates).filter(([field, value]) => !equal(value, item.fields[field])));
    write(key, Object.keys(updates).length ? { ...latest, draft: { updates, base: { ...item.fields }, revision }, error: null } : empty);
  }
  async function save() {
    if (!current() || !canSave || !source || !item || read(key).request || read(key).draft !== state.draft) return;
    const draft = state.draft!;
    const request = {};
    write(key, { ...state, request, error: null });
    try {
      const updates = Object.fromEntries(Object.entries(draft.updates).map(([field, value]) => [field, ids(value)]));
      await source.setRelations(item.id, updates, draft.revision!);
      // The adapter publishes the authoritative snapshot before resolving.
      if (read(key).request === request) write(key, empty);
    } catch (failure) {
      const latest = read(key);
      if (latest.request === request) write(key, { ...latest, request: null, error: formatBabelHostError(failure) });
    }
  }
  return { key, values: Object.fromEntries(['dependsOn', 'blocks'].map(field => [field, normalizeRelationshipValue(state.draft?.updates[field] ?? item?.fields[field])])), remote: item?.fields ?? {},
    changedFields: Object.keys(state.draft?.updates ?? {}), dirty: Boolean(state.draft), saving: Boolean(state.request),
    writable, validRevision, conflict, error: state.error, canSave, change, useRemote, continueEditing, save };
}
