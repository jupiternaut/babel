import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { formatBabelHostError } from '../../../services/babelDemoErrors';
import { hostRecordRevision } from '../babelExecutionStage';

interface BodyDraft {
  value: string;
  revision: number | undefined;
  // Keep the editor mounted while typing and while reviewing a conflict.
  editorBase: string;
}
interface BodyState {
  epoch: number;
  draft: BodyDraft | null;
  request: object | null;
  error: { code: string; message: string } | null;
}
const empty: BodyState = { epoch: 0, draft: null, request: null, error: null };
// Session-only drafts survive navigation. No source instance or credentials retained.
const states = new Map<string, BodyState>();
const listeners = new Map<string, Set<() => void>>();
const read = (key: string): BodyState => states.get(key) ?? empty;
function write(key: string, state: BodyState) {
  if (state === empty) states.delete(key);
  else states.set(key, state);
  for (const notify of listeners.get(key) ?? []) notify();
}

export function useBabelBodyDraft(item: TrackerRecord, source: BabelDemoTrackerDataSource, editable: boolean) {
  const key = JSON.stringify([source.endpoint, source.projectId, item.id]);
  const subscribe = useCallback((notify: () => void) => {
    const entries = listeners.get(key) ?? new Set<() => void>();
    entries.add(notify);
    listeners.set(key, entries);
    return () => { entries.delete(notify); if (!entries.size) listeners.delete(key); };
  }, [key]);
  const state = useSyncExternalStore(subscribe, () => read(key), () => empty);
  const remote = typeof item.content === 'string' ? item.content : (item.content as { markdown?: string } | undefined)?.markdown ?? '';
  const revision = hostRecordRevision(item);
  const writable = editable && !(item.system as { readOnly?: boolean }).readOnly && item.fields.babelReadOnly !== true;
  const currentRef = useRef({ key, item, source, writable });
  currentRef.current = { key, item, source, writable };
  const current = () => currentRef.current.key === key && currentRef.current.item === item && currentRef.current.source === source;
  const conflict = Boolean(state.draft && !state.request && (state.draft.revision !== revision || state.error?.code === 'REVISION_CONFLICT'));
  const validRevision = Number.isSafeInteger(state.draft?.revision) && (state.draft?.revision ?? -1) >= 1;
  const canSave = writable && Boolean(state.draft) && validRevision && !state.request && !conflict;

  function change(value: string) {
    if (!current() || !writable) return;
    const latest = read(key);
    if (latest.request) return;
    write(key, value === remote ? empty : {
      ...latest,
      draft: { value, revision: latest.draft ? latest.draft.revision : revision, editorBase: latest.draft?.editorBase ?? remote },
    });
  }
  function useRemote() {
    if (current() && !read(key).request) write(key, { ...empty, epoch: read(key).epoch + 1 });
  }
  function continueEditing() {
    if (!current()) return;
    const latest = read(key);
    if (latest.draft && !latest.request) write(key, { ...latest, draft: { ...latest.draft, revision }, error: null });
  }
  async function save() {
    if (!current() || !canSave || read(key).request || read(key).draft !== state.draft) return;
    const draft = state.draft!;
    const request = {};
    write(key, { ...state, draft, request, error: null });
    try {
      await source.command({ type: 'update-item-content', itemId: item.id, content: draft.value, expectedRevision: draft.revision });
      // Adapter publishes the authoritative record before resolving the command.
      if (read(key).request === request) write(key, empty);
    } catch (failure) {
      const latest = read(key);
      if (latest.request === request) write(key, { ...latest, request: null, error: formatBabelHostError(failure) });
    }
  }
  return { key, epoch: state.epoch, value: state.draft?.value ?? remote, editorBase: state.draft?.editorBase ?? remote,
    remote, dirty: Boolean(state.draft), saving: Boolean(state.request), writable, conflict, error: state.error,
    canSave, change, useRemote, continueEditing, save };
}
