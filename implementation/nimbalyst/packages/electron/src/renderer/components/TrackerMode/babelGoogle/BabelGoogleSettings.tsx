import React from 'react';
import { projectGoogleTasksView, type GoogleTasksViewInput } from './babelGoogleProjection';

export type BabelGoogleSettingsProps = GoogleTasksViewInput;

/**
 * Read-only Google Tasks settings. Demo / unconnected only.
 * Does not start OAuth, read user tokens, or claim a real sync.
 */
export const BabelGoogleSettings: React.FC<BabelGoogleSettingsProps> = (props) => {
  const view = projectGoogleTasksView(props);

  return (
    <section
      className="flex min-h-0 flex-col border-b border-nim px-1.5 py-2"
      data-testid="babel-google-settings"
      data-access-label={view.accessLabel}
      data-real-sync={view.realSync ? 'true' : 'false'}
      data-oauth-started={view.oauthStarted ? 'true' : 'false'}
    >
      <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        Google Tasks
      </h3>

      <p className="px-2 text-[12px] text-nim" data-testid="babel-google-access">
        {view.demoLabel}
        <span className="ms-2 text-[10px] text-nim-faint">{view.accessLabel}</span>
      </p>
      <p className="px-2 pt-0.5 text-[11px] text-nim-muted">{view.connectionNote}</p>

      <dl className="mt-2 flex flex-col gap-1 px-2 text-[11px] text-nim-muted">
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>同步状态</dt>
          <dd className="text-nim" data-testid="babel-google-sync">
            {view.syncLabel}
          </dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>轮询间隔</dt>
          <dd className="text-nim" data-testid="babel-google-poll">
            {view.pollIntervalSeconds} 秒
          </dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>重叠窗口</dt>
          <dd className="text-nim">{view.overlapWindowSeconds} 秒</dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>待处理冲突</dt>
          <dd className="text-nim" data-testid="babel-google-conflicts">
            {view.conflictCount}
          </dd>
        </div>
      </dl>
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">{view.syncNote}</p>
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">
        60 秒轮询是规格说明，本面板不启动真实轮询。
      </p>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        选定列表
      </h4>
      {view.selectedTasklistId ? (
        <p
          className="min-h-8 px-2 text-[12px] text-nim"
          data-testid="babel-google-list"
        >
          <span className="break-words">{view.selectedTasklistTitle || view.selectedTasklistId}</span>
          <span className="ms-2 text-[10px] text-nim-faint">{view.accessLabel}</span>
        </p>
      ) : (
        <p className="px-2 text-[11px] text-nim-muted" role="status" data-testid="babel-google-list-empty">
          未选择任务列表。
        </p>
      )}
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">{view.selectedListNote}</p>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        导入规则
      </h4>
      <ul className="flex flex-col gap-1 px-2">
        {view.ruleNotes.map((note) => (
          <li key={note} className="min-h-8 text-[11px] text-nim-muted">{note}</li>
        ))}
      </ul>
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">{view.conflictNote}</p>

      {view.errors.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 px-2" data-testid="babel-google-errors" role="alert">
          {view.errors.map((error, index) => (
            <li key={`${error.code}-${index}`} className="text-[11px] text-nim-muted">
              {error.code}：{error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
