import { useCallback, useEffect, useState } from 'react';
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
  const [draft, setDraft] = useState<BabelWorkbenchDraft>(() => getWorkbenchDraft(trackerId));
  const [viewingRunId, setViewing] = useState<string | null>(() => getViewingRunId(trackerId));
  const [viewingRun, setViewingRun] = useState<BabelRunView | null>(null);

  useEffect(() => {
    setDraft(getWorkbenchDraft(trackerId));
    setViewing(getViewingRunId(trackerId));
    setNote(null);
  }, [trackerId]);

  const refresh = useCallback(async () => {
    try {
      const [task, capabilities] = await Promise.all([
        dataSource.getTask(trackerId),
        dataSource.getCapabilities(trackerId),
      ]);
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
      setDetail(next);
      setCaps(capabilities.actions ?? {});
      const runId = next.bindingRunId;
      if (runId) {
        try {
          const listed = await dataSource.queryRaw<{ artifacts?: BabelArtifact[] }>('artifact.list', { runId });
          setArtifacts(listed.artifacts ?? []);
        } catch {
          setArtifacts([]);
        }
      } else {
        setArtifacts([]);
      }
      try {
        const hist = await dataSource.queryRaw<{
          comments?: Array<{ id: string; authorId?: string; createdAt?: string; body: string }>;
          activity?: Array<{ id: string; at?: string; actorId?: string; detail?: string }>;
          runs?: BabelRunView[];
        }>('history.get', { trackerId });
        setHistory({
          comments: hist.comments ?? [],
          activity: hist.activity ?? [],
          runs: hist.runs ?? runs,
        });
      } catch {
        setHistory({ comments: [], activity: [], runs });
      }
    } catch (error) {
      setNote(formatBabelHostError(error).message);
    }
  }, [dataSource, trackerId]);

  useEffect(() => {
    void refresh();
    return dataSource.subscribe(() => { void refresh(); });
  }, [dataSource, refresh]);

  useEffect(() => {
    if (!viewingRunId) {
      setViewingRun(null);
      return;
    }
    let cancelled = false;
    void dataSource.queryRaw<{ run?: BabelRunView }>('run.show', { runId: viewingRunId })
      .then((body) => {
        if (!cancelled) setViewingRun(body.run ?? null);
      })
      .catch((error) => {
        if (!cancelled) setNote(formatBabelHostError(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, viewingRunId]);

  const updateDraft = useCallback((patch: Partial<BabelWorkbenchDraft>) => {
    setDraft(patchWorkbenchDraft(trackerId, patch));
  }, [trackerId]);

  const viewRun = useCallback((runId: string | null) => {
    setViewingRunId(trackerId, runId);
    setViewing(runId);
  }, [trackerId]);

  const runAction = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
      await refresh();
    } catch (error) {
      setNote(formatBabelHostError(error).message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const start = useCallback(() => runAction(async () => {
    await dataSource.startRun(trackerId, `host-start-${trackerId}-${Date.now()}`);
    setNote('已接受模拟执行。创建会话不等于已经开始；这是 demo run，不是真实 Agent。');
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
    return runAction(async () => {
      await dataSource.acceptReview(runId, detail?.revision);
      setNote('已验收完成。这是演示结果，不是真实 Agent 成功。');
    });
  }, [dataSource, detail?.bindingRunId, detail?.revision, runAction]);

  const sendMessage = useCallback(() => {
    const runId = detail?.bindingRunId;
    if (!runId || !draft.message.trim()) return Promise.resolve();
    return runAction(async () => {
      await dataSource.postRaw('run.message', { runId, text: draft.message.trim() });
      updateDraft({ message: '' });
    });
  }, [dataSource, detail?.bindingRunId, draft.message, runAction, updateDraft]);

  const respond = useCallback((requestId: string) => {
    const runId = detail?.bindingRunId;
    if (!runId || !draft.respondText.trim()) return Promise.resolve();
    return runAction(async () => {
      await dataSource.postRaw('run.respond', {
        runId,
        requestId,
        text: draft.respondText.trim(),
      });
      updateDraft({ respondText: '' });
    });
  }, [dataSource, detail?.bindingRunId, draft.respondText, runAction, updateDraft]);

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
    return runAction(async () => {
      await dataSource.postRaw('run.retry', { runId });
      setNote('已接受重试。这是演示执行，不是真实 Agent。');
    });
  }, [dataSource, detail?.bindingRunId, runAction]);

  return {
    busy,
    note,
    detail,
    caps,
    artifacts,
    history,
    draft,
    updateDraft,
    viewingRunId,
    viewingRun,
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
  };
}

export function capabilityOf(
  caps: CapabilityMap,
  name: string,
): { allowed: boolean; reason?: string; code?: string } {
  return caps[name] ?? { allowed: true };
}
