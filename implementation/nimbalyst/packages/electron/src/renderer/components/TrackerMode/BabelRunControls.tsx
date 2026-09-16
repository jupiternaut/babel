import React from 'react';
import type { BabelDemoTrackerDataSource } from '../../services/BabelDemoTrackerDataSource';
import { capabilityOf, useBabelRunActions } from './babelWorkbench/useBabelRunActions';

interface BabelRunControlsProps {
  trackerId: string;
  dataSource: BabelDemoTrackerDataSource;
  layout?: 'panel' | 'toolbar';
}

export const BabelRunControls: React.FC<BabelRunControlsProps> = ({
  trackerId,
  dataSource,
  layout = 'panel',
}) => {
  const actions = useBabelRunActions(trackerId, dataSource);
  return <BabelRunActionBar actions={actions} trackerId={trackerId} layout={layout} />;
};

export function BabelRunActionBar({
  actions,
  trackerId,
  layout = 'panel',
}: {
  actions: ReturnType<typeof useBabelRunActions>;
  trackerId: string;
  layout?: 'panel' | 'toolbar';
}) {
  const startCap = capabilityOf(actions.caps, 'run.start');
  const cancelCap = capabilityOf(actions.caps, 'run.cancel');
  const acceptCap = capabilityOf(actions.caps, 'review.accept');
  const startDisabled = actions.busy || Boolean(actions.detail?.readOnly) || !startCap.allowed;
  const startReason = actions.detail?.readOnly
    ? '只读远端文件条目不可写入'
    : startCap.allowed ? null : (startCap.reason ?? startCap.code ?? null);
  const acceptDisabled = actions.busy || !actions.detail?.bindingRunId || !acceptCap.allowed;
  const stacked = layout === 'panel';

  return (
    <div
      className={stacked
        ? 'flex flex-col gap-2 text-[12px] text-nim'
        : 'flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-nim-muted'}
      data-testid="babel-run-controls"
    >
      <p className="text-[11px] text-nim-muted">
        演示执行 · {trackerId}
        {actions.detail?.stage ? ` · ${actions.detail.stage}` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded bg-[var(--nim-primary)] px-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={startDisabled}
          title={startReason ?? undefined}
          onClick={() => void actions.start()}
        >
          开始模拟
        </button>
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded border border-nim px-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actions.busy || !actions.detail?.bindingRunId || !cancelCap.allowed}
          title={cancelCap.reason}
          onClick={() => void actions.cancel()}
        >
          取消
        </button>
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded border border-nim px-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actions.busy || !actions.detail?.bindingRunId}
          onClick={() => void actions.showDiff()}
        >
          查看差异
        </button>
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded border border-nim px-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={acceptDisabled}
          title={acceptCap.reason}
          onClick={() => void actions.accept()}
        >
          验收完成
        </button>
      </div>
      {startDisabled && startReason ? (
        <span className="text-[11px] text-nim-faint">{startReason}</span>
      ) : null}
      {acceptDisabled && acceptCap.reason ? (
        <span className="text-[11px] text-nim-faint">{acceptCap.reason}</span>
      ) : null}
      {actions.note ? <span className="text-[11px] text-nim-faint">{actions.note}</span> : null}
    </div>
  );
}
