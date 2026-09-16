import React, { useEffect, useState } from 'react';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { BabelRunActionBar } from '../BabelRunControls';
import {
  getWorkbenchTab,
  setWorkbenchTab,
} from './babelDrafts';
import { runStatusLabel, toolStateLabel, verificationLabel } from './babelRunLabels';
import { capabilityOf, useBabelRunActions } from './useBabelRunActions';

type TabId = 'detail' | 'session' | 'review' | 'history' | 'archive';

interface BabelExecutionShellProps {
  enabled: boolean;
  trackerId: string;
  dataSource: BabelDemoTrackerDataSource | null;
  onClose: () => void;
  hiddenByScope?: boolean;
  children: React.ReactNode;
}

export const BabelExecutionShell: React.FC<BabelExecutionShellProps> = ({
  enabled,
  trackerId,
  dataSource,
  onClose,
  hiddenByScope,
  children,
}) => {
  if (!dataSource) return <>{children}</>;
  return (
    <BabelExecutionShellInner
      enabled={enabled}
      trackerId={trackerId}
      dataSource={dataSource}
      onClose={onClose}
      hiddenByScope={hiddenByScope}
    >
      {children}
    </BabelExecutionShellInner>
  );
};

const BabelExecutionShellInner: React.FC<{
  enabled: boolean;
  trackerId: string;
  dataSource: BabelDemoTrackerDataSource;
  onClose: () => void;
  hiddenByScope?: boolean;
  children: React.ReactNode;
}> = ({ enabled, trackerId, dataSource, onClose, hiddenByScope, children }) => {
  const actions = useBabelRunActions(trackerId, dataSource);
  const [tab, setTab] = useState<TabId>(() => getWorkbenchTab(trackerId, 'detail') as TabId);

  useEffect(() => {
    setTab(getWorkbenchTab(trackerId, 'detail') as TabId);
  }, [trackerId]);

  const selectTab = (next: TabId) => {
    setWorkbenchTab(trackerId, next);
    setTab(next);
  };

  const latest = actions.detail?.latestRun ?? null;
  const shown = actions.viewingRun ?? latest;
  const viewingOld = Boolean(actions.viewingRunId && latest && actions.viewingRunId !== latest.id);
  const archived = Boolean(actions.detail?.archived);
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'detail', label: '详情' },
    { id: 'session', label: '会话' },
    { id: 'review', label: '审查' },
    { id: 'history', label: '历史' },
  ];
  if (archived) tabs.push({ id: 'archive', label: '归档' });
  const current = tabs.some((row) => row.id === tab) ? tab : 'detail';

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-nim"
      data-testid={enabled ? 'babel-execution-detail' : 'babel-execution-detail-idle'}
      aria-label="条目详情"
    >
      {enabled ? (
      <>
      <header className="shrink-0 border-b border-nim px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-medium text-nim">{actions.detail?.title || trackerId}</h2>
            <p className="text-[11px] text-nim-muted">
              演示数据
              {actions.detail?.stage ? ` · ${actions.detail.stage}` : ''}
              {latest ? ` · ${runStatusLabel(latest.status)}` : ''}
              {latest?.deviceId ? ` · ${latest.deviceId}` : ''}
              {latest ? ` · 第 ${latest.attempt ?? 1} 次` : ''}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 min-w-8 items-center justify-center rounded border border-nim text-[12px] text-nim-muted hover:bg-nim-tertiary"
            aria-label="关闭详情"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {hiddenByScope ? (
          <p className="mt-1 text-[11px] text-nim-muted" role="status">
            当前项目或设备筛选下，看板不显示此条目。选中和已保存字段仍保留。
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-nim-faint">单击只选中。开始模拟不会在切卡片或切视图时自动重跑。</p>
      </header>

      <div className="shrink-0 border-b border-nim px-2 py-1">
        <BabelRunActionBar actions={actions} trackerId={trackerId} layout="panel" />
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-nim px-2 py-1" role="tablist" aria-label="任务工作流">
        {tabs.map((row) => (
          <button
            key={row.id}
            type="button"
            role="tab"
            aria-selected={current === row.id}
            className={`min-h-8 rounded px-2 text-[12px] ${
              current === row.id ? 'bg-nim-tertiary text-nim' : 'text-nim-muted hover:bg-nim-tertiary'
            }`}
            onClick={() => selectTab(row.id)}
            data-testid={`babel-detail-tab-${row.id}`}
          >
            {row.label}
          </button>
        ))}
      </div>
      </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <div hidden={enabled && current !== 'detail'} className="h-full min-h-0">
          {children}
        </div>
        {enabled ? (
          <>
        <div hidden={current !== 'session'} className="px-3 py-2 text-[12px] text-nim">
          <SessionPane
            shown={shown}
            viewingOld={viewingOld}
            draftMessage={actions.draft.message}
            draftRespond={actions.draft.respondText}
            caps={actions.caps}
            busy={actions.busy}
            onDraftMessage={(value) => actions.updateDraft({ message: value })}
            onDraftRespond={(value) => actions.updateDraft({ respondText: value })}
            onSend={() => void actions.sendMessage()}
            onRespond={(id) => void actions.respond(id)}
            onCancel={() => void actions.cancel()}
            onRetry={() => void actions.retry()}
          />
        </div>
        <div hidden={current !== 'review'} className="px-3 py-2 text-[12px] text-nim">
          <ReviewPane
            shown={shown}
            viewingOld={viewingOld}
            artifacts={actions.artifacts}
            draftComment={actions.draft.reviewComment}
            caps={actions.caps}
            busy={actions.busy}
            onDraftComment={(value) => actions.updateDraft({ reviewComment: value })}
            onAccept={() => void actions.accept()}
            onChanges={() => void actions.requestChanges()}
            onShowDiff={() => void actions.showDiff()}
          />
        </div>
        <div hidden={current !== 'history'} className="px-3 py-2 text-[12px] text-nim">
          <HistoryPane
            history={actions.history}
            latestId={latest?.id ?? null}
            viewingRunId={actions.viewingRunId}
            onViewRun={actions.viewRun}
          />
        </div>
        {archived ? (
          <div hidden={current !== 'archive'} className="px-3 py-2 text-[12px] text-nim">
            <p>该条目已归档。归档保留结果和历史，不等于发布成功。</p>
            <p className="mt-1 text-nim-muted">恢复会回到归档前的语义状态，不会自动执行。请用卡片菜单恢复。</p>
          </div>
        ) : null}
          </>
        ) : null}
      </div>
      {enabled && actions.note ? (
        <p className="shrink-0 border-t border-nim px-3 py-1.5 text-[11px] text-nim-muted" role="status">
          {actions.note}
        </p>
      ) : null}
    </aside>
  );
};

function SessionPane({
  shown,
  viewingOld,
  draftMessage,
  draftRespond,
  caps,
  busy,
  onDraftMessage,
  onDraftRespond,
  onSend,
  onRespond,
  onCancel,
  onRetry,
}: {
  shown: { id: string; status: string; deviceId?: string; attempt?: number; summary?: string; sessionId?: string | null; messages?: Array<{ id: string; role: string; text: string; at: string }>; inputRequests?: Array<{ id: string; prompt: string; answered?: boolean }> } | null;
  viewingOld: boolean;
  draftMessage: string;
  draftRespond: string;
  caps: Record<string, { allowed: boolean; reason?: string; code?: string }>;
  busy: boolean;
  onDraftMessage: (value: string) => void;
  onDraftRespond: (value: string) => void;
  onSend: () => void;
  onRespond: (id: string) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!shown) {
    return <p className="text-nim-muted">还没有执行记录。待办请用「开始模拟」，不要把保存当成启动。</p>;
  }
  const pending = (shown.inputRequests ?? []).filter((row) => !row.answered);
  const tools = (shown.messages ?? [])
    .filter((row) => row.role === 'tool' || row.role === 'system')
    .map((row) => ({ label: row.text, state: row.role === 'tool' ? 'succeeded' : row.role }));
  return (
    <div className="flex flex-col gap-3">
      {viewingOld ? (
        <p className="text-nim-muted">正在查看旧执行 {shown.id}，只读，不会改当前 run。</p>
      ) : null}
      <p>{runStatusLabel(shown.status)}{shown.deviceId ? ` · ${shown.deviceId}` : ''} · 尝试 {shown.attempt ?? 1}</p>
      {shown.summary ? <p className="text-nim-faint">{shown.summary}</p> : null}
      {shown.status === 'accepted' ? <p className="text-nim-muted">启动已接受，还不表示这次执行已经成功。</p> : null}
      {shown.sessionId ? <p className="text-nim-faint">会话 {shown.sessionId}（创建会话不等于开始执行）</p> : null}
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">工具活动</h3>
        {tools.length === 0 ? <p className="text-nim-muted">暂无工具活动。演示数据，不是真实 Agent 轨迹。</p> : (
          <ul>
            {tools.map((item, index) => (
              <li key={`${item.label}-${index}`}>{item.label} · {toolStateLabel(item.state)}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-label="当前 run 会话">
        {(shown.messages ?? []).map((msg) => (
          <article key={msg.id} className="rounded border border-nim bg-nim-secondary px-2 py-1.5">
            <div className="text-[11px] text-nim-faint">{msg.role} · {msg.at}</div>
            <div>{msg.text}</div>
          </article>
        ))}
      </section>
      {!viewingOld && pending.map((req) => (
        <div key={req.id} className="flex flex-col gap-1">
          <label htmlFor={`babel-respond-${req.id}`}>待答：{req.prompt}</label>
          <textarea
            id={`babel-respond-${req.id}`}
            className="min-h-16 rounded border border-nim bg-nim px-2 py-1 text-[12px] text-nim"
            value={draftRespond}
            onChange={(event) => onDraftRespond(event.target.value)}
          />
          <ActionButton
            label="提交回答"
            disabled={busy || !capabilityOf(caps, 'run.respond').allowed}
            reason={capabilityOf(caps, 'run.respond').reason}
            onClick={() => onRespond(req.id)}
          />
        </div>
      ))}
      {!viewingOld && shown.status !== 'succeeded' && shown.status !== 'failed' && shown.status !== 'cancelled' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="babel-run-message">补充消息（发给当前执行，不是任务讨论）</label>
          <textarea
            id="babel-run-message"
            className="min-h-16 rounded border border-nim bg-nim px-2 py-1 text-[12px] text-nim"
            value={draftMessage}
            onChange={(event) => onDraftMessage(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label="发送补充消息"
              disabled={busy || !capabilityOf(caps, 'run.message').allowed}
              reason={capabilityOf(caps, 'run.message').reason}
              onClick={onSend}
            />
            <ActionButton
              label="请求取消"
              disabled={busy || !capabilityOf(caps, 'run.cancel').allowed}
              reason={capabilityOf(caps, 'run.cancel').reason}
              onClick={onCancel}
            />
          </div>
        </div>
      ) : null}
      {!viewingOld && (shown.status === 'failed' || shown.status === 'cancelled') ? (
        <ActionButton
          label="重试执行"
          disabled={busy || !capabilityOf(caps, 'run.retry').allowed}
          reason={capabilityOf(caps, 'run.retry').reason}
          onClick={onRetry}
        />
      ) : null}
    </div>
  );
}

function ReviewPane({
  shown,
  viewingOld,
  artifacts,
  draftComment,
  caps,
  busy,
  onDraftComment,
  onAccept,
  onChanges,
  onShowDiff,
}: {
  shown: { status: string; diff?: { label?: string; files?: Array<{ path: string; additions: number; deletions: number; patch?: string }> } | null; verification?: Array<{ id: string; text: string; state: string; required?: boolean }>; review?: { decision?: string } | null } | null;
  viewingOld: boolean;
  artifacts: Array<{ name: string; kind?: string; available?: boolean }>;
  draftComment: string;
  caps: Record<string, { allowed: boolean; reason?: string; code?: string }>;
  busy: boolean;
  onDraftComment: (value: string) => void;
  onAccept: () => void;
  onChanges: () => void;
  onShowDiff: () => void;
}) {
  const files = shown?.diff?.files ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-nim-faint">演示数据。宿主没有可接的 run 差异组件，这里用同一套 token 的可读面板。</p>
      {shown?.diff?.label ? <p><strong>模拟基线</strong>：{shown.diff.label}</p> : null}
      {files.length === 0 ? (
        <p className="text-nim-muted">还没有模拟差异。差异绑定当前 run，不是真实 Git 提交。</p>
      ) : (
        files.map((file) => (
          <article key={file.path} className="rounded border border-nim bg-nim-secondary p-2">
            <strong>{file.path}</strong>
            <span className="text-nim-faint"> +{file.additions} / -{file.deletions}</span>
            {file.patch ? <pre className="mt-1 overflow-auto text-[11px]">{file.patch}</pre> : null}
          </article>
        ))
      )}
      <ActionButton label="查看差异" disabled={busy || !shown} onClick={onShowDiff} />
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">产物</h3>
        {artifacts.length === 0 ? <p className="text-nim-muted">没有产物。</p> : (
          <ul>
            {artifacts.map((item) => (
              <li key={item.name}>{item.name}{item.kind ? ` · ${item.kind}` : ''}{item.available === false ? ' · 不可用' : ''}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">验收项</h3>
        {(shown?.verification ?? []).length === 0 ? <p className="text-nim-muted">没有验收项。</p> : (
          <ul>
            {(shown?.verification ?? []).map((item) => (
              <li key={item.id}>
                {item.text} · {verificationLabel(item.state)}
                {item.required ? ' · 必需' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      {!viewingOld && (shown?.status === 'review_required' || shown?.status === 'verifying') ? (
        <>
          <label htmlFor="babel-review-comment">要求修改时的说明</label>
          <textarea
            id="babel-review-comment"
            className="min-h-16 rounded border border-nim bg-nim px-2 py-1 text-[12px] text-nim"
            value={draftComment}
            onChange={(event) => onDraftComment(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              primary
              label="验收完成"
              disabled={busy || !capabilityOf(caps, 'review.accept').allowed}
              reason={capabilityOf(caps, 'review.accept').reason}
              onClick={onAccept}
            />
            <ActionButton
              label="要求修改"
              disabled={busy || !capabilityOf(caps, 'review.request_changes').allowed}
              reason={capabilityOf(caps, 'review.request_changes').reason}
              onClick={onChanges}
            />
          </div>
        </>
      ) : (
        <p className="text-nim-faint">
          {shown?.review?.decision
            ? `审查决定：${shown.review.decision === 'accept' ? '已接受' : '要求修改'}`
            : '当前不在待审。approved 或进程退出都不能直接当成完成。'}
        </p>
      )}
    </div>
  );
}

function HistoryPane({
  history,
  latestId,
  viewingRunId,
  onViewRun,
}: {
  history: {
    comments: Array<{ id: string; authorId?: string; createdAt?: string; body: string }>;
    activity: Array<{ id: string; at?: string; actorId?: string; detail?: string }>;
    runs: Array<{ id: string; attempt?: number; status: string }>;
  } | null;
  latestId: string | null;
  viewingRunId: string | null;
  onViewRun: (runId: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">活动</h3>
        {(history?.activity ?? []).length === 0 ? <p className="text-nim-muted">还没有活动。</p> : (
          <ul>
            {(history?.activity ?? []).map((row) => (
              <li key={row.id}>{row.at} · {row.actorId} · {row.detail}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">讨论</h3>
        {(history?.comments ?? []).length === 0 ? <p className="text-nim-muted">还没有讨论。任务讨论请用原生详情，不要和执行补充消息混用。</p> : (
          (history?.comments ?? []).map((row) => (
            <article key={row.id} className="rounded border border-nim bg-nim-secondary px-2 py-1.5">
              <div className="text-[11px] text-nim-faint">{row.authorId} · {row.createdAt}</div>
              <div>{row.body}</div>
            </article>
          ))
        )}
      </section>
      <section>
        <h3 className="text-[11px] font-medium text-nim-faint">执行记录</h3>
        {(history?.runs ?? []).length === 0 ? <p className="text-nim-muted">还没有 run。</p> : (
          <ul className="flex flex-col gap-1">
            {(history?.runs ?? []).map((run) => {
              const current = latestId === run.id;
              const viewing = (viewingRunId ?? latestId) === run.id;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`min-h-8 rounded px-2 text-left ${viewing ? 'bg-nim-tertiary text-nim' : 'text-nim-muted hover:bg-nim-tertiary'}`}
                    onClick={() => onViewRun(current ? null : run.id)}
                  >
                    {run.id} · 尝试 {run.attempt ?? 1} · {runStatusLabel(run.status)}
                    {current ? ' · 当前' : ' · 只读查看'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-nim-faint">查看旧 run 只读，不会重启或替换当前执行。</p>
      </section>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  reason,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  primary?: boolean;
}) {
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={`inline-flex min-h-8 items-center rounded px-2 text-[12px] ${
          primary ? 'bg-[var(--nim-primary)] text-white' : 'border border-nim text-nim'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={disabled}
        title={reason}
        onClick={onClick}
      >
        {label}
      </button>
      {disabled && reason ? <span className="text-[11px] text-nim-faint">{reason}</span> : null}
    </span>
  );
}
