import React from 'react';
import { projectDeviceConnectionView, type DeviceConnectionInput } from './babelDeviceProjection';

export type BabelConnectionSettingsProps = DeviceConnectionInput;

/**
 * Read-only connection settings. Renders a projection of existing queries.
 * Does not keep local filter or device state; selected ids come from props.
 */
export const BabelConnectionSettings: React.FC<BabelConnectionSettingsProps> = (props) => {
  const view = projectDeviceConnectionView(props);

  return (
    <section
      className="flex min-h-0 flex-col border-b border-nim px-1.5 py-2"
      data-testid="babel-connection-settings"
      data-access-label={view.accessLabel}
      data-real-monitor={view.realMonitor ? 'true' : 'false'}
    >
      <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        连接设置
      </h3>

      <p className="px-2 text-[12px] text-nim" data-testid="babel-connection-access">
        {view.demoLabel}
        <span className="ms-2 text-[10px] text-nim-faint">{view.accessLabel}</span>
      </p>
      <p className="px-2 pt-0.5 text-[11px] text-nim-muted">{view.connectionNote}</p>

      <dl className="mt-2 flex flex-col gap-1 px-2 text-[11px] text-nim-muted">
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>采集周期</dt>
          <dd className="text-nim" data-testid="babel-connection-interval">
            {view.collectionIntervalSeconds} 秒
          </dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>过期阈值</dt>
          <dd className="text-nim">{view.staleAfterSeconds} 秒未成功采集</dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>快照 freshness</dt>
          <dd className="text-nim" data-testid="babel-connection-freshness">
            {view.freshnessLabel}
          </dd>
        </div>
      </dl>
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">{view.freshnessNote}</p>
      <p className="px-2 pt-1 text-[11px] text-nim-faint">
        手动刷新只重新查询当前客户端，不改变其他客户端的 60 秒调度。本面板不启动真机采集。
      </p>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        能力分层
      </h4>
      <ul className="flex flex-col gap-1">
        {view.layers.map((layer) => (
          <li
            key={layer.id}
            className="flex min-h-8 flex-col justify-center px-2 text-[12px]"
            data-testid={`babel-connection-layer-${layer.id}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-nim">{layer.title}</span>
              <span className="text-[10px] text-nim-faint">{layer.label}</span>
            </div>
            <p className="text-[11px] text-nim-muted">{layer.note}</p>
          </li>
        ))}
      </ul>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        项目
      </h4>
      {view.emptyProjects ? (
        <p className="px-2 text-[11px] text-nim-muted" role="status">{view.emptyProjects}</p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {view.projects.map((project) => (
          <li
            key={project.id}
            className={`flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-[12px] ${
              project.selected ? 'bg-nim-active text-nim' : 'text-nim-muted'
            }`}
            aria-current={project.selected ? 'true' : undefined}
            data-testid={`babel-connection-project-${project.id}`}
          >
            <span className="min-w-0 break-words">{project.name}</span>
            <span className="shrink-0 text-[10px] text-nim-faint">{project.accessLabel}</span>
          </li>
        ))}
      </ul>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        设备
      </h4>
      {view.emptyDevices ? (
        <p className="px-2 text-[11px] text-nim-muted" role="status">{view.emptyDevices}</p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {view.devices.map((device) => (
          <li
            key={device.id}
            className={`flex min-h-8 flex-col justify-center rounded-md px-2 py-1 text-[12px] ${
              device.selected ? 'bg-nim-active text-nim' : 'text-nim-muted'
            }`}
            aria-current={device.selected ? 'true' : undefined}
            data-testid={`babel-connection-device-${device.id}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 break-words text-nim">{device.label}</span>
              <span className="shrink-0 text-[10px] text-nim-faint">
                {device.accessLabel}
                {device.displayStatus ? ` · ${device.displayStatus}` : ''}
                {device.activeRuns > 0 ? ` · ${device.activeRuns}` : ''}
              </span>
            </div>
            <p className="text-[11px] text-nim-faint">{device.availabilityNote}</p>
          </li>
        ))}
      </ul>
      <p className="px-2 pt-1 text-[11px] text-nim-faint">
        数字是当前项目上未终止的 run，不是 CPU 或在线探测。合成节点不是真机在线。
      </p>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        过滤
      </h4>
      <p className="px-2 text-[11px] text-nim-muted" data-testid="babel-connection-filter">
        {view.filter.explanation}
      </p>

      {view.lost ? (
        <p className="px-2 pt-2 text-[11px] text-nim-muted" data-testid="babel-connection-lost" role="status">
          {view.lost.label}。{view.lost.note}
        </p>
      ) : null}

      {view.capabilityNotes.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 px-2" data-testid="babel-connection-capabilities">
          {view.capabilityNotes.map((note) => (
            <li key={note.action} className="text-[11px] text-nim-muted">
              {note.action}：{note.text}
            </li>
          ))}
        </ul>
      ) : null}

      {view.errors.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 px-2" data-testid="babel-connection-errors" role="alert">
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
