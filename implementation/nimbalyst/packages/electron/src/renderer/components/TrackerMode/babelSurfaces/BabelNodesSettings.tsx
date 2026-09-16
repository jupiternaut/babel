import React from 'react';
import { projectNodesSurface, type OfflineSurfacesInput } from './babelSurfaceProjection';

export type BabelNodesSettingsProps = OfflineSurfacesInput;

/**
 * Read-only node / SFTP notes. Demo or unconnected only.
 * Does not scan the LAN, open SSH, or claim a real machine is online.
 */
export const BabelNodesSettings: React.FC<BabelNodesSettingsProps> = (props) => {
  const view = projectNodesSurface(props);

  return (
    <section
      className="flex min-h-0 flex-col border-b border-nim px-1.5 py-2"
      data-testid="babel-nodes-settings"
      data-access-label={view.accessLabel}
      data-real-machine={view.realMachine ? 'true' : 'false'}
      data-real-ssh={view.realSsh ? 'true' : 'false'}
    >
      <h3 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        节点
      </h3>

      <p className="px-2 text-[12px] text-nim" data-testid="babel-nodes-access">
        {view.demoLabel}
        <span className="ms-2 text-[10px] text-nim-faint">{view.accessLabel}</span>
      </p>
      <p className="px-2 pt-0.5 text-[11px] text-nim-muted">{view.connectionNote}</p>

      <dl className="mt-2 flex flex-col gap-1 px-2 text-[11px] text-nim-muted">
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>快照 freshness</dt>
          <dd className="text-nim" data-testid="babel-nodes-freshness">
            {view.freshnessLabel}
          </dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>平台</dt>
          <dd className="text-nim">{view.platform || '未指定'}</dd>
        </div>
        <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-2">
          <dt>只读引用</dt>
          <dd className="text-nim">{view.attachedResourceCount}</dd>
        </div>
      </dl>
      <p className="px-2 pt-0.5 text-[11px] text-nim-faint">{view.freshnessNote}</p>

      <h4 className="mb-0.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-nim-faint">
        能力分层
      </h4>
      <ul className="flex flex-col gap-1">
        {view.layers.map((layer) => (
          <li
            key={layer.id}
            className="flex min-h-8 flex-col justify-center px-2 text-[12px]"
            data-testid={`babel-nodes-layer-${layer.id}`}
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
        规则
      </h4>
      <ul className="flex flex-col gap-1 px-2">
        {view.ruleNotes.map((note) => (
          <li key={note} className="min-h-8 text-[11px] text-nim-muted">{note}</li>
        ))}
      </ul>

      {view.errors.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 px-2" data-testid="babel-nodes-errors" role="alert">
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
