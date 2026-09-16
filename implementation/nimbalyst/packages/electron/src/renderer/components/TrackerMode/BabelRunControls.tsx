import React, { useState } from 'react';
import { FloatingFocusManager, FloatingPortal, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
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
  const local = actions.mode === 'local';
  const historical = Boolean(actions.viewingRunId && actions.viewingRunId !== actions.detail?.bindingRunId);
  const [confirmation, setConfirmation] = useState<{ message: string; submit: () => Promise<void> } | null>(null);
  const { refs, context } = useFloating({ open: Boolean(confirmation), onOpenChange: (open) => { if (!open) setConfirmation(null); } });
  const dismiss = useDismiss(context, { outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);
  const target = actions.detail?.executionTarget;
  const startCap = capabilityOf(actions.caps, 'run.start');
  const cancelCap = capabilityOf(actions.caps, 'run.cancel');
  const acceptCap = capabilityOf(actions.caps, 'review.accept');
  const startDisabled = actions.busy || historical || Boolean(actions.detail?.readOnly) || !startCap.allowed || (local && (!target || !Number.isInteger(actions.detail?.revision)));
  const startReason = historical ? '旧执行只读，请先返回当前执行'
    : local && (!target || !Number.isInteger(actions.detail?.revision)) ? '执行目录、模型或任务版本尚未确认'
    : actions.detail?.readOnly
    ? '只读远端文件条目不可写入'
    : startCap.allowed ? null : (startCap.reason ?? startCap.code ?? null);
  const acceptDisabled = actions.busy || historical || !actions.detail?.bindingRunId || !acceptCap.allowed;
  const stacked = layout === 'panel';

  return (
    <div
      className={stacked
        ? 'flex flex-col gap-2 text-[12px] text-nim'
        : 'flex shrink-0 flex-wrap items-center gap-2 text-[11px] text-nim-muted'}
      data-testid="babel-run-controls"
    >
      <p className="text-[11px] text-nim-muted">
        {local ? '本机 Pi 执行' : '演示执行'} · {trackerId}
        {actions.detail?.stage ? ` · ${actions.detail.stage}` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={refs.setReference}
          type="button"
          className="inline-flex min-h-8 items-center rounded bg-[var(--nim-primary)] px-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={startDisabled}
          title={startReason ?? undefined}
          {...getReferenceProps({ onClick: () => {
            if (!local) { void actions.start(); return; }
            if (!target || !actions.detail) return;
            setConfirmation({
              message: `任务：${actions.detail.title}\n工作目录：${target.workdir}\n提供方：${target.provider}\n模型：${target.model}\nPi 将在此目录执行任务并可能修改文件，模型调用可能产生用量。`,
              submit: actions.start,
            });
          } })}
        >
          {local ? '开始执行' : '开始模拟'}
        </button>
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded border border-nim px-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actions.busy || historical || !actions.detail?.bindingRunId || !cancelCap.allowed}
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
      {confirmation ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal outsideElementsInert>
            <div className="babel-workbench babel-reconcile-dialog babel-start-dialog" ref={refs.setFloating} {...getFloatingProps({ 'aria-label': '确认开始 Pi 执行' })}>
              <ConfirmDialog
                isOpen
                title="确认开始 Pi 执行"
                message={confirmation.message}
                confirmLabel="确认开始执行"
                cancelLabel="返回"
                onCancel={() => setConfirmation(null)}
                onConfirm={() => { setConfirmation(null); void confirmation.submit(); }}
              />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
      {actions.note ? <span className="text-[11px] text-nim-faint">{actions.note}</span> : null}
    </div>
  );
}
