import React, { useCallback, useEffect, useState } from 'react';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { formatBabelHostError } from '../../../services/babelDemoErrors';

interface BabelWorkflowPanelProps {
  trackerId: string;
  dataSource: BabelDemoTrackerDataSource;
}

interface RunRow {
  id: string;
  status: string;
  attempt?: number;
}

export const BabelWorkflowPanel: React.FC<BabelWorkflowPanelProps> = ({ trackerId, dataSource }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [stage, setStage] = useState('');
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [historyText, setHistoryText] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [startReason, setStartReason] = useState<string | null>(null);
  const [acceptReason, setAcceptReason] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[trackerId] ?? '';

  const refresh = useCallback(async () => {
    try {
      const [detail, caps] = await Promise.all([
        dataSource.getTask(trackerId),
        dataSource.getCapabilities(trackerId),
      ]);
      setStage(String(detail.stage ?? ''));
      const latest = detail.binding?.latestRunId ?? detail.latestRun?.id ?? null;
      setRunId(latest);
      setReadOnly(Boolean(detail.record.system.readOnly));
      setRevision(detail.record.revision);
      setStartReason(caps.actions['run.start'] && !caps.actions['run.start'].allowed
        ? caps.actions['run.start'].reason ?? caps.actions['run.start'].code ?? null
        : null);
      setAcceptReason(caps.actions['review.accept'] && !caps.actions['review.accept'].allowed
        ? caps.actions['review.accept'].reason ?? caps.actions['review.accept'].code ?? null
        : null);
      const listed = await dataSource.queryRaw<{ runs?: RunRow[] }>('run.list', { trackerId });
      setRuns(listed.runs ?? []);
      if (latest) {
        const shown = await dataSource.queryRaw<{
          run?: { status?: string; inputRequests?: Array<{ id: string; answered?: boolean }>; messages?: unknown[] };
        }>('run.show', { runId: latest });
        const pending = shown.run?.inputRequests?.find((row) => !row.answered);
        setPendingRequest(pending?.id ?? null);
      } else {
        setPendingRequest(null);
      }
    } catch (error) {
      setNote(formatBabelHostError(error).message);
    }
  }, [dataSource, trackerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      await refresh();
    } catch (error) {
      setNote(formatBabelHostError(error).message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <section
      className="flex shrink-0 flex-col gap-2 border-b border-nim bg-nim-secondary px-3 py-2 text-[12px] text-nim"
      data-testid="babel-workflow-panel"
      aria-label="当前任务工作流"
    >
      <p className="text-[11px] text-nim-muted">
        演示数据 · {trackerId}
        {stage ? ` · ${stage}` : ''}
        {runId ? ` · run ${runId}` : ' · 还没有 run'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="rounded bg-[var(--nim-primary)] px-2 py-0.5 text-white disabled:opacity-50" disabled={busy || readOnly || Boolean(startReason)} onClick={() => void act(async () => {
          const result = await dataSource.startRun(trackerId, `host-start-${trackerId}-${Date.now()}`);
          setRunId(typeof result.runId === 'string' ? result.runId : null);
          setNote('已接受模拟执行。创建会话不等于已经开始。');
        })}>
          开始模拟
        </button>
        <button type="button" className="rounded border border-nim px-2 py-0.5 disabled:opacity-50" disabled={busy || !runId} onClick={() => void act(async () => {
          if (runId) await dataSource.cancelRun(runId);
        })}>
          取消
        </button>
        <button type="button" className="rounded border border-nim px-2 py-0.5 disabled:opacity-50" disabled={busy || !runId} onClick={() => void act(async () => {
          if (!runId) return;
          const data = await dataSource.getDiff(runId);
          const files = (data.diff as { files?: Array<{ path: string; additions: number; deletions: number }> } | null)?.files ?? [];
          setDiffText(files.length ? files.map((file) => `${file.path} +${file.additions} -${file.deletions}`).join('；') : '当前没有差异');
        })}>
          差异
        </button>
        <button type="button" className="rounded border border-nim px-2 py-0.5 disabled:opacity-50" disabled={busy || !runId} onClick={() => void act(async () => {
          if (!runId) return;
          const data = await dataSource.queryRaw<{ artifacts?: Array<{ path?: string; name?: string }> }>('artifact.list', { runId });
          const rows = data.artifacts ?? [];
          setArtifacts(rows.length ? rows.map((row) => row.path ?? row.name ?? '产物').join('；') : '当前没有产物');
        })}>
          产物
        </button>
        <button type="button" className="rounded border border-nim px-2 py-0.5 disabled:opacity-50" disabled={busy || !runId || Boolean(acceptReason)} title={acceptReason ?? undefined} onClick={() => void act(async () => {
          if (runId) await dataSource.acceptReview(runId, revision);
          setNote('已验收完成。这是演示结果，不是真实 Agent 成功。');
        })}>
          验收
        </button>
        <button type="button" className="rounded border border-nim px-2 py-0.5 disabled:opacity-50" disabled={busy} onClick={() => void act(async () => {
          const data = await dataSource.queryRaw<{
            activity?: Array<{ at: string; detail: string }>;
            runs?: Array<{ id: string; status: string; attempt: number }>;
          }>('history.get', { trackerId });
          const lines = [
            ...(data.activity ?? []).map((row) => `${row.at} ${row.detail}`),
            ...(data.runs ?? []).map((row) => `run ${row.id} 第${row.attempt ?? 1}次 ${row.status}`),
          ];
          setHistoryText(lines.join('\n') || '没有历史');
        })}>
          历史
        </button>
      </div>
      {startReason || readOnly ? (
        <p className="text-[11px] text-nim-muted">{readOnly ? '只读远端文件条目不可写入' : startReason}</p>
      ) : null}
      <label className="block text-[11px] text-nim-muted">
        {pendingRequest ? '回答待答请求' : '补充消息'}
        <textarea
          className="mt-1 min-h-12 w-full rounded border border-nim bg-nim px-2 py-1 text-[12px] text-nim"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="self-start rounded border border-nim px-2 py-0.5 disabled:opacity-50"
        disabled={busy || !runId || !message.trim()}
        onClick={() => void act(async () => {
          if (!runId) return;
          await dataSource.postRaw(pendingRequest ? 'run.respond' : 'run.message', pendingRequest
            ? { runId, requestId: pendingRequest, text: message }
            : { runId, text: message });
          setMessage('');
        })}
      >
        发送
      </button>
      <label className="block text-[11px] text-nim-muted">
        输入草稿（切卡片不丢）
        <textarea
          className="mt-1 min-h-10 w-full rounded border border-nim bg-nim px-2 py-1 text-[12px] text-nim"
          value={draft}
          onChange={(event) => setDrafts((current) => ({ ...current, [trackerId]: event.target.value }))}
        />
      </label>
      {runs.length > 1 ? (
        <label className="text-[11px] text-nim-muted">
          历史 run
          <select
            className="ml-2 rounded border border-nim bg-nim px-1 py-0.5 text-[12px] text-nim"
            value={runId ?? ''}
            onChange={(event) => setRunId(event.target.value || null)}
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>{run.id} · {run.status}</option>
            ))}
          </select>
        </label>
      ) : null}
      {note ? <p className="text-[11px] text-nim-faint">{note}</p> : null}
      {diffText ? <p data-testid="babel-run-diff" className="text-[11px] text-nim-faint">{diffText}</p> : null}
      {artifacts ? <p className="text-[11px] text-nim-faint">{artifacts}</p> : null}
      {historyText ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-nim-faint">{historyText}</pre> : null}
    </section>
  );
};
