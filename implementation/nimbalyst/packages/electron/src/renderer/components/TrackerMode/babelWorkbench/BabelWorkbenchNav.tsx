import React from 'react';
import type { TrackerStatusScope } from '../../../store/atoms/trackers';
import type { BabelDeviceRow, BabelNavQuery, BabelProjectRow } from './useBabelNavQuery';
import { BabelGlassSurface } from './BabelGlassSurface';
import { BabelAttention, type BabelAttentionProps } from './BabelAttention';
import './BabelWorkbench.css';

export interface BabelWorkbenchNavProps extends BabelAttentionProps {
  workspaceLabel: string;
  query: BabelNavQuery;
  projectId: string;
  deviceId: string | null;
  statusScope: TrackerStatusScope;
  onProjectSelect: (projectId: string) => void;
  onDeviceSelect: (deviceId: string | null) => void;
  onStatusScopeChange: (scope: TrackerStatusScope) => void;
  onOpenFiles?: () => void;
}

const btn = (active: boolean) =>
  `babel-nav-button flex w-full items-center justify-between gap-2 text-left text-[12px] ${
    active ? 'is-active' : ''
  }`;

export const BabelWorkbenchNav: React.FC<BabelWorkbenchNavProps> = ({
  workspaceLabel,
  query,
  projectId,
  deviceId,
  statusScope,
  onProjectSelect,
  onDeviceSelect,
  onStatusScopeChange,
  onOpenFiles,
  attentionOnly,
  onAttentionChange,
  selectedItemId,
  onAttentionSelect,
}) => {
  const unavailable = query.connection === 'unavailable';

  return (
    <nav className="babel-workbench-nav flex min-h-0 flex-col" aria-label="执行工作区" data-testid="babel-workbench-nav">
      <NavGroup title="工作区">
        <BabelGlassSurface className="babel-nav-glass">
          <button type="button" className={btn(!attentionOnly)} aria-current={!attentionOnly ? 'page' : undefined} onClick={() => onAttentionChange?.(false)}>
            <span>任务看板</span>
            {!attentionOnly ? <span className="text-[10px] text-nim-faint">当前</span> : null}
          </button>
        </BabelGlassSurface>
        <button
          type="button"
          className={btn(false)}
          disabled={!onOpenFiles}
          title={onOpenFiles ? undefined : '请从宿主顶栏切换到文件视图'}
          onClick={onOpenFiles}
        >
          <span>项目文件</span>
          {onOpenFiles ? null : <span className="text-[10px] text-nim-faint">未接入此侧栏</span>}
        </button>
        <DisabledRow label="Agent 会话" reason="从宿主顶栏打开，不在此侧栏启动" />
        <DisabledRow label="知识与 PDF" reason="未接入（M0）" />
        <p className="babel-workspace-label px-2 pt-1">{workspaceLabel}</p>
      </NavGroup>

      <BabelAttention listed={query.listed} stale={unavailable} attentionOnly={attentionOnly}
        onAttentionChange={onAttentionChange} selectedItemId={selectedItemId} onAttentionSelect={onAttentionSelect} />

      <NavGroup title="项目">
        {unavailable ? (
          <p className="px-2 text-[11px] text-nim-muted" role="status">项目列表未接入</p>
        ) : null}
        {query.projects.map((project: BabelProjectRow) => (
          <button
            key={project.id}
            type="button"
            className={btn(project.id === projectId)}
            disabled={Boolean(query.boundProjectId && project.id !== query.boundProjectId)}
            title={query.boundProjectId && project.id !== query.boundProjectId ? '请在此项目对应的工作区打开；当前工作区尚未绑定此项目。' : undefined}
            aria-current={project.id === projectId ? 'true' : undefined}
            onClick={() => onProjectSelect(project.id)}
            data-testid={`babel-nav-project-${project.id}`}
          >
            <span className="min-w-0 truncate">{project.name}</span>
            <span className="shrink-0 text-[10px] text-nim-faint">{query.boundProjectId && project.id !== query.boundProjectId ? '未绑定工作区' : '演示'}</span>
          </button>
        ))}
        {!unavailable && query.projects.length === 0 ? (
          <p className="px-2 text-[11px] text-nim-muted">没有可查询的项目。</p>
        ) : null}
      </NavGroup>

      <NavGroup title="设备">
        <button
          type="button"
          className={btn(deviceId === null)}
          aria-current={deviceId === null ? 'true' : undefined}
          onClick={() => onDeviceSelect(null)}
          data-testid="babel-nav-device-all"
        >
          <span>全部设备</span>
          <span className="text-[10px] text-nim-faint">含未分配</span>
        </button>
        {unavailable ? (
          <p className="px-2 text-[11px] text-nim-muted" role="status">设备列表未接入，不显示在线</p>
        ) : null}
        {query.devices.map((device: BabelDeviceRow) => (
          <button
            key={device.id}
            type="button"
            className={btn(device.id === deviceId)}
            aria-current={device.id === deviceId ? 'true' : undefined}
            onClick={() => onDeviceSelect(device.id)}
            data-testid={`babel-nav-device-${device.id}`}
          >
            <span className="min-w-0 truncate">{device.label}</span>
            <span className="shrink-0 text-[10px] text-nim-faint">
              {device.displayStatus}
              {device.activeRuns > 0 ? ` · ${device.activeRuns}` : ''}
            </span>
          </button>
        ))}
        <p className="babel-nav-note px-2 pt-1">数字为当前项目的未终止执行数。</p>
      </NavGroup>

      <NavGroup title="Open / Closed">
        {([
          ['open', 'Open'],
          ['all', 'All'],
          ['closed', 'Closed'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={btn(statusScope === value)}
            aria-pressed={statusScope === value}
            onClick={() => onStatusScopeChange(value)}
            data-testid={`babel-nav-status-${value}`}
          >
            {label}
          </button>
        ))}
      </NavGroup>
    </nav>
  );
};

export const BabelWorkbenchFooter: React.FC<{
  query: BabelNavQuery;
}> = ({ query }) => (
  <div className="babel-workbench-footer shrink-0 text-[11px] text-nim-muted" data-testid="babel-workbench-footer">
    <p className="font-medium text-nim">{query.demoLabel || '演示数据'}</p>
    <p>{query.connection === 'demo' ? '演示服务已连接' : query.connection === 'unavailable' ? '演示服务未接入' : '未连接演示服务'}</p>
    {query.connectionNote ? <p className="text-nim-faint">{query.connectionNote}</p> : null}
  </div>
);

export const BabelWorkbenchExtras: React.FC = () => (
  <div data-testid="babel-workbench-extras">
    <NavGroup title="集成">
      <DisabledRow label="Google Tasks" reason="未接入（M0）" />
      <DisabledRow label="Pi" reason="未接入（M0）" />
    </NavGroup>
    <NavGroup title="运维">
      <DisabledRow label="GitLab" reason="未接入（M0）" />
      <DisabledRow label="MediaWiki" reason="未接入（M0）" />
      <DisabledRow label="Hook 管理" reason="未接入（M0）" />
    </NavGroup>
  </div>
);

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="babel-nav-group">
      <h3 className="babel-nav-group-title">{title}</h3>
      <div className="babel-nav-items">{children}</div>
    </section>
  );
}

function DisabledRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="babel-nav-disabled flex min-h-8 text-[12px] text-nim-muted">
      <span>{label}</span>
      <span className="text-[10px] text-nim-faint">{reason}</span>
    </div>
  );
}
