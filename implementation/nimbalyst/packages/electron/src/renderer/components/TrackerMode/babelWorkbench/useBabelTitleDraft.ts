import { useCallback, useSyncExternalStore } from 'react';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { formatBabelHostError } from '../../../services/babelDemoErrors';
import { hostRecordRevision } from '../babelExecutionStage';

interface TitleDraft {
  value: string;
  revision: number | undefined;
}

interface TitleState {
  draft: TitleDraft | null;
  error: { code: string; message: string } | null;
  request: object | null;
}

const emptyState: TitleState = { draft: null, error: null, request: null };
// Session-only, like workbench message drafts. Never retain a data source instance.
const states = new Map<string, TitleState>();
const listeners = new Map<string, Set<() => void>>();

function readState(key: string | null): TitleState {
  return key ? states.get(key) ?? emptyState : emptyState;
}

function writeState(key: string, state: TitleState): void {
  if (state === emptyState) states.delete(key);
  else states.set(key, state);
  for (const notify of listeners.get(key) ?? []) notify();
}

/** Babel titles are explicit, revision-checked writes; ordinary host editing stays separate. */
export function useBabelTitleDraft(item: TrackerRecord | null | undefined, source: BabelDemoTrackerDataSource | null) {
  const key = item && source ? JSON.stringify([source.endpoint, source.projectId, item.id]) : null;
  const subscribe = useCallback((notify: () => void) => {
    if (!key) return () => {};
    const subscribers = listeners.get(key) ?? new Set<() => void>();
    subscribers.add(notify);
    listeners.set(key, subscribers);
    return () => {
      subscribers.delete(notify);
      if (!subscribers.size) listeners.delete(key);
    };
  }, [key]);
  const state = useSyncExternalStore(subscribe, () => readState(key), () => emptyState);
  const { draft: active, error, request } = state;
  const saving = request !== null;
  const remoteTitle = item ? getRecordTitle(item) : '';
  const revision = item ? hostRecordRevision(item) : undefined;
  const conflict = Boolean(active && !saving && (active.revision !== revision || error?.code === 'REVISION_CONFLICT'));

  function change(value: string) {
    if (!key || saving) return;
    writeState(key, value === remoteTitle ? emptyState : {
      ...state,
      draft: {
        value,
        // Keep the version at the start of the edit, including after navigation.
        revision: active ? active.revision : revision,
      },
    });
  }

  function useRemote() {
    if (key && !saving) writeState(key, emptyState);
  }

  function continueEditing() {
    if (key && active && !saving) {
      writeState(key, { draft: { ...active, revision }, error: null, request: null });
    }
  }

  async function save() {
    if (!key || !item || !active || !source || saving || conflict || active.revision == null || !active.value.trim()) return;
    // One in-flight write per stable identity, including across remounts.
    if (readState(key).request) return;
    const request = {};
    writeState(key, { draft: active, error: null, request });
    try {
      const input = {
        itemId: item.id,
        updates: { title: active.value, revision: active.revision },
        expectedRevision: active.revision,
      };
      await source.command({ type: 'update-item', input });
      // The data source publishes the authoritative upsert before resolving.
      const current = readState(key);
      if (current.request === request) {
        writeState(key, current.draft === active ? emptyState : { ...current, request: null });
      }
    } catch (failure) {
      const current = readState(key);
      if (current.request === request) {
        writeState(key, { ...current, error: formatBabelHostError(failure), request: null });
      }
    }
  }

  return {
    value: active?.value ?? remoteTitle,
    remoteTitle,
    dirty: Boolean(active),
    conflict,
    error,
    saving,
    canSave: Boolean(active && active.revision != null && active.value.trim() && !saving && !conflict),
    change,
    useRemote,
    continueEditing,
    save,
  };
}
