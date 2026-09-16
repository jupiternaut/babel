import React, { useEffect, useMemo, useRef } from 'react';
import type { LexicalEditor } from 'lexical';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { NimbalystEditor } from '@nimbalyst/runtime/editor/NimbalystEditor';
import type { EditorConfig } from '@nimbalyst/runtime/editor/EditorConfig';
import type { BabelDemoTrackerDataSource } from '../../../services/BabelDemoTrackerDataSource';
import { useBabelBodyDraft } from './useBabelBodyDraft';

interface Props {
  item: TrackerRecord;
  source: BabelDemoTrackerDataSource;
  editable: boolean;
  focusActive?: boolean;
  onEditorReady?: (editor: LexicalEditor | null) => void;
}

/** The host's rich editor, backed exclusively by the shared Babel write route. */
export function BabelBodyEditor({ item, source, editable, focusActive = false, onEditorReady }: Props) {
  const body = useBabelBodyDraft(item, source, editable);
  return <section className={`flex flex-col gap-2 min-w-0 ${focusActive ? 'flex-1 min-h-0' : ''}`} aria-label="Babel 正文" data-testid="babel-body-editor">
    <div className={`tracker-content-editor bg-nim overflow-hidden ${focusActive ? 'flex-1 min-h-0' : 'min-h-[200px] border border-nim rounded'}`}>
      <BodySurface key={JSON.stringify([body.key, body.editorBase, body.epoch])} initialContent={body.value}
        editable={body.writable && !body.saving} focusActive={focusActive} onChange={body.change} onEditorReady={onEditorReady} />
    </div>
    {!body.writable && <p className="m-0 text-xs text-nim-muted">正文只读；已有草稿保留在当前会话。</p>}
    {body.conflict && <div role="alert" className="rounded border border-nim p-2 text-xs text-nim-muted space-y-2">
      <p className="m-0">正文版本已变化，草稿已保留。查看远端正文后选择如何继续。</p>
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans" aria-label="当前远端正文">{body.remote || '（空正文）'}</pre>
      {body.error && <p className="m-0">{body.error.code}: {body.error.message}</p>}
      <p className="m-0">继续编辑会采用当前版本号；再次保存将用草稿替换正文。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary" onClick={body.continueEditing}>继续编辑草稿</button>
        <button type="button" className="rounded border border-nim px-2 py-1 hover:bg-nim-tertiary" onClick={body.useRemote}>采用远端正文</button>
      </div>
    </div>}
    {body.error && !body.conflict && <p role="alert" className="m-0 text-xs text-nim-warning">{body.error.code}: {body.error.message}</p>}
    {body.dirty && <div className="flex flex-wrap items-center gap-2 text-xs text-nim-muted">
      <button type="button" className="rounded border border-nim px-2 py-1 text-nim hover:bg-nim-tertiary disabled:opacity-50" disabled={!body.canSave} onClick={() => void body.save()}>{body.saving ? '保存中…' : '保存正文'}</button>
      {!body.conflict && <button type="button" className="rounded px-2 py-1 hover:bg-nim-tertiary disabled:opacity-50" disabled={body.saving} onClick={body.useRemote}>撤销正文修改</button>}
      <span role="status">{body.saving ? '正在保存' : '正文草稿未保存'}</span>
    </div>}
  </section>;
}

function BodySurface({ initialContent, editable, focusActive, onChange, onEditorReady }: {
  initialContent: string; editable: boolean; focusActive: boolean;
  onChange: (value: string) => void; onEditorReady?: (editor: LexicalEditor | null) => void;
}) {
  // NimbalystEditor rebuilds when initialContent/editable change. Freeze its seed
  // for this mounted draft; toggle editability directly to preserve text/cursor.
  const seed = useRef(initialContent);
  const initiallyEditable = useRef(editable);
  const getContent = useRef<(() => string) | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const callbacks = useRef({ onChange, onEditorReady, editable });
  callbacks.current = { onChange, onEditorReady, editable };
  useEffect(() => { editorRef.current?.setEditable(editable); }, [editable]);
  useEffect(() => () => callbacks.current.onEditorReady?.(null), []);
  const config = useMemo((): EditorConfig => ({
    isRichText: true, editable: initiallyEditable.current, showToolbar: false, forceFloatingToolbar: focusActive,
    isCodeHighlighted: true, hasLinkAttributes: true, markdownOnly: true, initialContent: seed.current,
    onGetContent: (getter) => { getContent.current = getter; },
    onDirtyChange: (dirty) => { if (dirty && callbacks.current.editable && getContent.current) callbacks.current.onChange(getContent.current()); },
    onEditorReady: (editor) => {
      editorRef.current = editor;
      editor.setEditable(callbacks.current.editable);
      callbacks.current.onEditorReady?.(editor);
    },
  // Freeze the editable seed as well; the effect above handles later changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [focusActive]);
  return <NimbalystEditor config={config} />;
}
