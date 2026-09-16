// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { BabelHostCommandError } from '../../../services/babelDemoErrors';
import { BabelBodyEditor } from '../babelWorkbench/BabelBodyEditor';

// Exercise the explicit-save boundary with the editor's real callback contract.
vi.mock('@nimbalyst/runtime/editor/NimbalystEditor', () => ({ NimbalystEditor: ({ config }: any) => {
  const [value, setValue] = React.useState(config.initialContent);
  const valueRef = React.useRef(value);
  const [editable, setEditable] = React.useState(config.editable);
  React.useEffect(() => { config.onEditorReady({ setEditable }); }, [config]);
  config.onGetContent(() => valueRef.current);
  return <textarea aria-label="正文编辑器" value={value} disabled={!editable} onChange={(event) => {
    valueRef.current = event.target.value;
    setValue(event.target.value);
    config.onDirtyChange(true);
  }} />;
} }));
let scope = 0;
beforeEach(() => { scope++; });
function record(content = '原始正文', revision = 1, id = 'a', readOnly = false): TrackerRecord {
  return { id, primaryType: 'task', fields: { revision }, content, source: 'native', system: { readOnly } } as unknown as TrackerRecord;
}
function source(command = vi.fn().mockResolvedValue({ ok: true }), projectId = 'project', endpoint = `http://localhost:${9000 + scope}`) {
  return { kind: 'babel-demo', endpoint, projectId, command } as any;
}
const body = () => screen.getByRole('textbox', { name: '正文编辑器' }) as HTMLTextAreaElement;
const save = () => screen.getByRole('button', { name: '保存正文' }) as HTMLButtonElement;

describe('Babel body draft and explicit save', () => {
  it('does not autosave, freezes revision, preserves dirty text on remote updates, then explicitly rebases', async () => {
    const ds = source();
    const view = render(<BabelBodyEditor item={record()} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '# 我的中文草稿\n正文' } });
    expect(ds.command).not.toHaveBeenCalled();
    view.rerender(<BabelBodyEditor item={record('CLI 正文', 2)} source={ds} editable />);
    expect(body().value).toBe('# 我的中文草稿\n正文');
    expect(save().disabled).toBe(true);
    screen.getByText('CLI 正文');
    fireEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }));
    expect(ds.command).not.toHaveBeenCalled();
    ds.command.mockImplementationOnce(async () => {
      view.rerender(<BabelBodyEditor item={record('# 我的中文草稿\n正文', 3)} source={ds} editable />);
    });
    fireEvent.click(save());
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存正文' })).toBeNull());
    expect(ds.command).toHaveBeenCalledExactlyOnceWith({ type: 'update-item-content', itemId: 'a', content: '# 我的中文草稿\n正文', expectedRevision: 2 });
    expect(body().value).toBe('# 我的中文草稿\n正文');
  });

  it('discards a draft even when remote content never changed', () => {
    const ds = source();
    render(<BabelBodyEditor item={record()} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '丢弃这份草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '撤销正文修改' }));
    expect(body().value).toBe('原始正文');
    expect(ds.command).not.toHaveBeenCalled();
  });

  it('preserves drafts across unmount, isolates endpoint/project/item, and explicitly adopts remote', () => {
    const ds = source();
    const view = render(<BabelBodyEditor item={record()} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '仅 A 的草稿' } });
    view.rerender(<BabelBodyEditor item={record('B 正文', 1, 'b')} source={ds} editable />);
    expect(body().value).toBe('B 正文');
    view.rerender(<BabelBodyEditor item={record('另一项目')} source={source(ds.command, 'other')} editable />);
    expect(body().value).toBe('另一项目');
    view.rerender(<BabelBodyEditor item={record('另一服务')} source={source(ds.command, 'project', 'http://localhost:1')} editable />);
    expect(body().value).toBe('另一服务');
    view.unmount();
    render(<BabelBodyEditor item={record('远端更新', 2)} source={ds} editable />);
    expect(body().value).toBe('仅 A 的草稿');
    fireEvent.click(screen.getByRole('button', { name: '采用远端正文' }));
    expect(body().value).toBe('远端更新');
    expect(ds.command).not.toHaveBeenCalled();
  });

  it('retains failed drafts and prevents duplicates across remounts or cross-task completion', async () => {
    let reject!: (reason: unknown) => void;
    const ds = source(vi.fn(() => new Promise((_resolve, fail) => { reject = fail; })));
    let view = render(<BabelBodyEditor item={record()} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '等待保存' } });
    fireEvent.click(save());
    view.unmount();
    view = render(<BabelBodyEditor item={record()} source={ds} editable />);
    expect(screen.getByRole('button', { name: '保存中…' }).hasAttribute('disabled')).toBe(true);
    expect(ds.command).toHaveBeenCalledTimes(1);
    view.rerender(<BabelBodyEditor item={record('B 正文', 1, 'b')} source={ds} editable />);
    await act(async () => reject(new BabelHostCommandError('REVISION_CONFLICT', '版本冲突')));
    expect(body().value).toBe('B 正文');
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<BabelBodyEditor item={record()} source={ds} editable />);
    expect(body().value).toBe('等待保存');
    expect(save().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('REVISION_CONFLICT');
  });

  it('allows intentional empty markdown and blocks readonly/missing revision, retaining existing drafts', async () => {
    const ds = source(vi.fn().mockRejectedValue(new BabelHostCommandError('READ_ONLY', '只读')));
    const view = render(<BabelBodyEditor item={record()} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('READ_ONLY'));
    expect(ds.command).toHaveBeenCalledExactlyOnceWith({ type: 'update-item-content', itemId: 'a', content: '', expectedRevision: 1 });
    view.rerender(<BabelBodyEditor item={record('原始正文', 1, 'a', true)} source={ds} editable />);
    expect(body().value).toBe('');
    expect(save().disabled).toBe(true);
    expect(body().disabled).toBe(true);
    view.rerender(<BabelBodyEditor item={record('无版本', Number.NaN, 'missing')} source={ds} editable />);
    fireEvent.change(body(), { target: { value: '不能写' } });
    expect(save().disabled).toBe(true);
  });
});
