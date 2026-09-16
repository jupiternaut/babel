import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { formatBabelHostError } from '../../../services/babelDemoErrors';
import {
  getViewingRunId,
  getWorkbenchDraft,
  patchWorkbenchDraft,
  setViewingRunId,
  type BabelWorkbenchDraft,
} from './babelDrafts';

type CapabilityMap = Record<string, { allowed: boolean; reason?: string; code?: string }>;

// A selection can unmount while its command is still in flight. Keep the lock
// with the same service/project/task identity used by the session draft cache.
const pendingActions = new Map<string, Promise<void>>();

export interface BabelRunMessage {
  id: string;
  role: string;
  text: string;
  at: string;
}

export interface BabelInputRequest {
  id: string;
  prompt: string;
  answered?: boolean;
}

export interface BabelVerificationItem {
  id: string;
  text: string;
  state: string;
  required?: boolean;
}

export interface BabelDiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface BabelArtifact {
  name: string;
  kind?: string;
  available?: boolean;
}

export interface BabelRunView {
  id: string;
  status: string;
  deviceId?: string;
  attempt?: number;
  summary?: string;
  sessionId?: string | null;
  messages?: BabelRunMessage[];
  inputRequests?: BabelInputRequest[];
  verification?: BabelVerificationItem[];
  diff?: { label?: string; files?: BabelDiffFile[] } | null;
  review?: { decision?: string } | null;
}

export interface BabelTaskDetail {
  stage: string;
  revision?: number;
  readOnly: boolean;
  title: string;
  archived: boolean;
  latestRun: BabelRunView | null;
  runs: BabelRunView[];
  bindingRunId: string | null;
}

export function useBabelRunActions(trackerId: string, dataSource: BabelDemoTrackerDataSource) {
  const cacheKey = JSON.stringify([dataSource.endpoint, dataSource.projectId, trackerId]);
  const scope = useMemo(() => ({ active: false, generation: 0, detail: null as BabelTaskDetail | null, viewingRunId: getViewingRunId(cacheKey) }), [dataSource, trackerId, cacheKey]);
  const [loadedScope, setLoadedScope] = useState<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<BabelTaskDetail | null>(null);
  const [caps, setCaps] = useState<CapabilityMap>({});
  const [artifacts, setArtifacts] = useState<BabelArtifact[]>([]);
  const [history, setHistory] = useState<{
    comments: Array<{ id: string; authorId?: string; createdAt?: string; body: string }>;
    activity: Array<{ id: string; at?: string; actorId?: string; detail?: string }>;
    runs: BabelRunView[];
  } | null>(null);
  const [draft, setDraft] = useState<BabelWorkbenchDraft>(() => getWorkbenchDraft(cacheKey));
  const [viewingRunId, setViewing] = useState<string | null>(() => getViewingRunId(cacheKey));
  const [viewingRun, setViewingRun] = useState<BabelRunView | null>(null);

  useLayoutEffect(() => {
    scope.active = true;
    return () => { scope.active = false; scope.generation += 1; };
  }, [scope]);

  const refresh = useCallback(async () => {
    if (!scope.active) return;
    const generation = ++scope.generation;
    const current = () => scope.active && generation === scope.generation;
    try {
      const [task, capabilities] = await Promise.all([
        dataSource.getTask(trackerId),
        dataSource.getCapabilities(trackerId),
      ]);
      if (!current()) return;
      const record = task.record as {
        revision?: number;
        archived?: boolean;
        system?: { readOnly?: boolean };
        fields?: Record<string, unknown>;
      };
      const latest = (task.latestRun ?? null) as BabelRunView | null;
      const runs = ((task as { runs?: BabelRunView[] }).runs ?? (latest ? [latest] : [])) as BabelRunView[];
      const next: BabelTaskDetail = {
        stage: String(task.stage ?? ''),
        revision: record.revision,
        readOnly: Boolean(record.system?.readOnly),
        title: String(record.fields?.title ?? trackerId),
        archived: Boolean(record.archived),
        latestRun: latest,
        runs,
        bindingRunId: task.binding?.latestRunId ?? latest?.id ?? null,
      };
      let nextArtifacts: BabelArtifact[] = [];
      const runId = next.bindingRunId;
      if (runId) {
        try {
          const listed = await dataSource.queryRaw<{ artifacts?: BabelArtifact[] }>('artifact.list', { runId });
          nextArtifacts = listed.artifacts ?? [];
        } catch {
          // A missing artifact list does not invalidate the task itself.
        }
      }
      if (!current()) return;
      let nextHistory = { comments: [] as NonNullable<typeof history>['comments'], activity: [] as NonNullable<typeof history>['activity'], runs };
      try {
        const hist = await dataSource.queryRaw<{
          comments?: Array<{ id: string; authorId?: string; createdAt?: string; body: string }>;
          activity?: Array<{ id: string; at?: string; actorId?: string; detail?: string }>;
          runs?: BabelRunView[];
        }>('history.get', { trackerId });
        nextHistory = {
          comments: hist.comments ?? [],
          activity: hist.activity ?? [],
          runs: hist.runs ?? runs,
        };
      } catch {
        // Keep the run history supplied by the authoritative task query.
      }
      if (!current()) return;
      scope.detail = next;
      setDetail(next);
      setCaps(capabilities.actions ?? {});
      setArtifacts(nextArtifacts);
      setHistory(nextHistory);
      setLoadedScope(scope);
    } catch (error) {
      if (current()) setNote(formatBabelHostError(error).message);
    }
  }, [dataSource, trackerId, scope]);

  useEffect(() => {
    const pending = pendingActions.get(cacheKey);
    let cancelled = false;
    setDraft(getWorkbenchDraft(cacheKey));
    setViewing(getViewingRunId(cacheKey));
    setNote(null);
    setBusy(Boolean(pending));
    setViewingRun(null);
    if (pending) void pending.then(() => {
      if (cancelled || !scope.active) return;
      setDraft(getWorkbenchDraft(cacheKey));
      setBusy(false);
      void refresh();
    });
    return () => { cancelled = true; };
  }, [scope, cacheKey, refresh]);

  useEffect(() => {
    void refresh();
    return dataSource.subscribe(() => { void refresh(); });
  }, [dataSource, refresh]);

  useEffect(() => {
    setViewingRun(null);
    if (loadedScope !== scope || !viewingRunId || !detail?.runs.some(run => run.id === viewingRunId)) return;
    let cancelled = false;
    void dataSource.queryRaw<{ run?: BabelRunView }>('run.show', { runId: viewingRunId })
      .then((body) => {
        if (!cancelled && scope.active) setViewingRun(body.run ?? null);
      })
      .catch((error) => {
        if (!cancelled && scope.active) setNote(formatBabelHostError(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, viewingRunId, scope, loadedScope, detail?.runs]);

  const updateDraft = useCallback((patch: Partial<BabelWorkbenchDraft>) => {
    if (!scope.active) return;
    setDraft(patchWorkbenchDraft(cacheKey, patch));
  }, [cacheKey, scope]);

  const viewRun = useCallback((runId: string | null) => {
    if (!scope.active || loadedScope !== scope || (runId && !detail?.runs.some(run => run.id === runId))) return;
    scope.viewingRunId = runId;
    setViewingRunId(cacheKey, runId);
    setViewing(runId);
  }, [cacheKey, scope, loadedScope, detail?.runs]);

  const runAction = useCallback(async (work: (current: () => boolean) => Promise<void>) => {
    // Reject callbacks captured for a previous selection or run snapshot, even
    // if an old button handler is invoked after the new selection renders.
    if (!scope.active || loadedScope !== scope || !detail || scope.detail !== detail || pendingActions.has(cacheKey)) return;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    pendingActions.set(cacheKey, pending);
    const current = () => scope.active;
    setBusy(true);
    setNote(null);
    try {
      await work(current);
      if (current()) await refresh();
    } catch (error) {
      if (current()) setNote(formatBabelHostError(error).message);
    } finally {
      if (pendingActions.get(cacheKey) === pending) pendingActions.delete(cacheKey);
      finish();
      if (current()) setBusy(false);
    }
  }, [refresh, scope, loadedScope, detail, cacheKey]);

  const start = useCallback(() => runAction(async (current) => {
    await dataSource.startRun(trackerId, `host-start-${trackerId}-${Date.now()}`);
    if (current()) setNote('已接受模拟执行。创建会话不等于已经开始；这是 demo run，不是真实 Agent。');
  }), [dataSource, runAction, trackerId]);

  const cancel = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId) return Promise.resolve();
    return runAction(async () => {
      await dataSource.cancelRun(runId);
    });
  }, [dataSource, detail?.bindingRunId, runAction]);

  const showDiff = useCallback(() => {
    const runId = viewingRunId ?? detail?.bindingRunId;
    if (!runId) return Promise.resolve();
    return runAction(async () => {
      await dataSource.getDiff(runId);
    });
  }, [dataSource, detail?.bindingRunId, runAction, viewingRunId]);

  const accept = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId) return Promise.resolve();
    return runAction(async (current) => {
      await dataSource.acceptReview(runId, detail?.revision);
      if (current()) setNote('已验收完成。这是演示结果，不是真实 Agent 成功。');
    });
  }, [dataSource, detail?.bindingRunId, detail?.revision, runAction]);

  const sendMessage = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId || !draft.message.trim()) return Promise.resolve();
    return runAction(async (current) => {
      await dataSource.postRaw('run.message', { runId, text: draft.message.trim() });
      if (getWorkbenchDraft(cacheKey).message === draft.message) {
        const next = patchWorkbenchDraft(cacheKey, { message: '' });
        if (current()) setDraft(next);
      }
    });
  }, [dataSource, detail?.bindingRunId, draft.message, runAction, updateDraft, cacheKey]);

  const respond = useCallback((requestId: string) => {
    const runId = detail?.bindingRunId;
    if (!runId || !draft.respondText.trim()) return Promise.resolve();
    return runAction(async (current) => {
      await dataSource.postRaw('run.respond', {
        runId,
        requestId,
        text: draft.respondText.trim(),
      });
      if (getWorkbenchDraft(cacheKey).respondText === draft.respondText) {
        const next = patchWorkbenchDraft(cacheKey, { respondText: '' });
        if (current()) setDraft(next);
      }
    });
  }, [dataSource, detail?.bindingRunId, draft.respondText, runAction, updateDraft, cacheKey]);

  const requestChanges = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId) return Promise.resolve();
    return runAction(async () => {
      await dataSource.postRaw('review.request_changes', {
        runId,
        comment: draft.reviewComment.trim() || undefined,
      });
    });
  }, [dataSource, detail?.bindingRunId, draft.reviewComment, runAction]);

  const retry = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId) return Promise.resolve();
    return runAction(async (current) => {
      await dataSource.postRaw('run.retry', { runId });
      if (current()) setNote('已接受重试。这是演示执行，不是真实 Agent。');
    });
  }, [dataSource, detail?.bindingRunId, runAction]);

  const reconcile = useCallback((resolution: 'cancelled' | 'failed') => {
    if (!scope.active || loadedScope !== scope) return Promise.resolve();
    if (scope.detail !== detail) {
      setNote('执行信息已更新，请重新打开核对确认。');
      return Promise.resolve();
    }
    const run = detail?.latestRun;
    if (!detail || !run || run.id !== detail.bindingRunId
      || (run.status !== 'lost' && run.status !== 'cancel_requested')
      || (scope.viewingRunId && scope.viewingRunId !== run.id)
      || detail.readOnly || !Number.isInteger(detail.revision)
      || caps['run.reconcile']?.allowed !== true) return Promise.resolve();
    return runAction(async (current) => {
      await dataSource.postRaw('run.reconcile', { runId: run.id, resolution }, detail.revision);
      if (current()) setNote(`已记录演示核对结果：${resolution === 'cancelled' ? '已取消' : '失败'}。不代表真实 Worker 已停止。`);
    });
  }, [caps, dataSource, detail, loadedScope, runAction, scope]);

  return {
    busy: loadedScope !== scope || busy || pendingActions.has(cacheKey),
    note,
    detail: loadedScope === scope ? detail : null,
    caps: loadedScope === scope ? caps : {},
    artifacts: loadedScope === scope ? artifacts : [],
    history: loadedScope === scope ? history : null,
    draft,
    updateDraft,
    viewingRunId,
    viewingRun: loadedScope === scope ? viewingRun : null,
    viewRun,
    refresh,
    start,
    cancel,
    showDiff,
    accept,
    sendMessage,
    respond,
    requestChanges,
    retry,
    reconcile,
  };
}

export function capabilityOf(
  caps: CapabilityMap,
  name: string,
): { allowed: boolean; reason?: string; code?: string } {
  return caps[name] ?? { allowed: true };
}
