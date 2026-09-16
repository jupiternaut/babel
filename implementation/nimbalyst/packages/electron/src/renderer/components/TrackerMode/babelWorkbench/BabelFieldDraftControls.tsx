import React from 'react';
import type { useBabelFieldDraft } from './useBabelFieldDraft';

export function BabelFieldDraftControls({ fields }: { fields: ReturnType<typeof useBabelFieldDraft> }) {
  return <section className="babel-field-draft-controls min-w-0 space-y-2 text-xs text-nim-muted" aria-label="Babel 字段保存">
    <p className="m-0">优先级、负责人和标签需显式保存；依赖与阻塞在关系区单独保存，状态、类型标签及其他字段暂为只读。</p>
    {!fields.writable && <p className="m-0">字段只读；已有草稿保留在当前会话。</p>}
    {!fields.validRevision && <p className="m-0" role="alert">缺少有效版本号，字段暂不可编辑或保存。</p>}
    {fields.conflict && <div role="alert" data-testid="babel-fields-conflict" className="rounded border border-nim p-2 space-y-2">
      <p className="m-0">字段版本已变化，草稿已保留。请查看当前远端值后选择如何继续。</p>
      <dl className="m-0 break-words" aria-label="当前远端字段">
        {fields.changedFields.map((field) => <div key={field}><dt className="font-medium">{{ priority: '优先级', owner: '负责人', tags: '标签' }[field] ?? field}</dt>
          <dd className="m-0 whitespace-pre-wrap">{Array.isArray(fields.remote[field]) ? (fields.remote[field] as string[]).join('、') || '（空）' : String(fields.remote[field] ?? '') || '（空）'}</dd></div>)}
      </dl>
      {fields.error && <p className="m-0">{fields.error.code}: {fields.error.message}</p>}
      <p className="m-0">继续编辑会采用当前版本号；再次保存仅替换已修改的字段。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="babel-fields-continue" disabled={!fields.writable || !fields.validRevision} className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary disabled:opacity-50" onClick={fields.continueEditing}>继续编辑字段草稿</button>
        <button type="button" data-testid="babel-fields-use-remote" className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary" onClick={fields.useRemote}>采用远端字段</button>
      </div>
    </div>}
    {fields.error && !fields.conflict && <p role="alert" className="m-0 text-nim-warning">{fields.error.code}: {fields.error.message}</p>}
    {fields.dirty && <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-testid="babel-fields-save" className="rounded border border-nim px-2 py-1 text-nim hover:bg-nim-tertiary disabled:opacity-50" disabled={!fields.canSave} onClick={() => void fields.save()}>{fields.saving ? '保存中…' : '保存字段'}</button>
      {!fields.conflict && <button type="button" className="rounded px-2 py-1 hover:bg-nim-tertiary disabled:opacity-50" disabled={fields.saving} onClick={fields.useRemote}>撤销字段修改</button>}
    </div>}
    <span role="status">{fields.dirty ? fields.saving ? '正在保存字段' : '字段草稿未保存' : ''}</span>
  </section>;
}
