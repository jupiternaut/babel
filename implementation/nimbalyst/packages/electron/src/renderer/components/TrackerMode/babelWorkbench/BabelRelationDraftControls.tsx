import React from 'react';
import { normalizeRelationshipValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerRelationships';
import type { RelationshipCandidate } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/RelationshipFieldEditor';
import type { useBabelRelationDraft } from './useBabelRelationDraft';

export function BabelRelationDraftControls({ relations, candidates }: { relations: ReturnType<typeof useBabelRelationDraft>; candidates: Map<string, RelationshipCandidate[]> }) {
  return <section className="babel-relation-draft-controls min-w-0 space-y-2 text-xs text-nim-muted" aria-label="Babel 关系保存">
    <p className="m-0">依赖与阻塞关系需单独保存；保存时同时更新双方。其他关系暂为只读。</p>
    {!relations.writable && <p className="m-0">关系只读；已有草稿保留在当前会话。</p>}
    {!relations.validRevision && <p className="m-0" role="alert">缺少有效版本号，关系暂不可编辑或保存。</p>}
    {relations.conflict && <div role="alert" data-testid="babel-relations-conflict" className="rounded border border-nim p-2 space-y-2">
      <p className="m-0">关系版本已变化，草稿已保留。请查看当前远端值后选择如何继续。</p>
      <dl className="m-0 break-words select-text" aria-label="当前远端关系">
        {relations.changedFields.map((field) => <div key={field}><dt className="font-medium">{{ dependsOn: '依赖', blocks: '阻塞' }[field] ?? field}</dt>
          <dd className="m-0 whitespace-pre-wrap">{normalizeRelationshipValue(relations.remote[field]).map(link => { const candidate = candidates.get(field)?.find(value => value.itemId === link.itemId); return `${candidate?.title ?? link.title ?? link.itemId} (${link.itemId})`; }).join('、') || '（空）'}</dd></div>)}
      </dl>
      {relations.error && <p className="m-0">{relations.error.code}: {relations.error.message}</p>}
      <p className="m-0">继续编辑会采用当前版本号；再次保存仅替换已修改的关系。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="babel-relations-continue" disabled={!relations.writable || !relations.validRevision} className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary disabled:opacity-50" onClick={relations.continueEditing}>继续编辑关系草稿</button>
        <button type="button" data-testid="babel-relations-use-remote" className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary" onClick={relations.useRemote}>采用远端关系</button>
      </div>
    </div>}
    {relations.error && !relations.conflict && <p role="alert" className="m-0 text-nim-warning">{relations.error.code}: {relations.error.message}</p>}
    {relations.dirty && <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-testid="babel-relations-save" className="rounded border border-nim px-2 py-1 text-nim hover:bg-nim-tertiary disabled:opacity-50" disabled={!relations.canSave} onClick={() => void relations.save()}>{relations.saving ? '保存中…' : '保存关系'}</button>
      {!relations.conflict && <button type="button" className="rounded px-2 py-1 hover:bg-nim-tertiary disabled:opacity-50" disabled={relations.saving} onClick={relations.useRemote}>撤销关系修改</button>}
    </div>}
    <span role="status">{relations.dirty ? relations.saving ? '正在保存关系' : '关系草稿未保存' : ''}</span>
  </section>;
}
