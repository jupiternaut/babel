// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';

vi.mock('@nimbalyst/collab-client/trackers-ui', () => ({
  TrackerBoardCard: ({ item, onSelect, onContextMenu }: {
    item: TrackerRecord;
    onSelect: (event: React.MouseEvent, item: TrackerRecord) => void;
    onContextMenu: (event: React.MouseEvent, item: TrackerRecord) => void;
  }) => (
    <button
      type="button"
      data-testid={`card-${item.id}`}
      onClick={(event) => onSelect(event, item)}
      onContextMenu={(event) => onContextMenu(event, item)}
    >
      {String(item.fields.title)}
    </button>
  ),
}));

import { BabelExecutionBoard } from '../BabelExecutionBoard';

const record = (status = 'succeeded'): TrackerRecord => ({
  id: 'glass-menu-task',
  primaryType: 'task',
  typeTags: ['task'],
  source: 'native',
  archived: false,
  syncStatus: 'synced',
  content: { format: 'markdown', markdown: '' },
  system: { workspace: 'demo', createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z' },
  fields: { title: '检查玻璃菜单', status: 'done', babelRunStatus: status, babelStage: 'DONE' },
});

afterEach(cleanup);

describe('Babel execution card menu', () => {
  it('locates a newly selected attention item in its existing stage on a narrow board', async () => {
    const item = record('executing');
    item.fields.babelStage = 'RUNNING';
    const { rerender } = render(<BabelExecutionBoard items={[item]} />);
    expect(screen.queryByTestId('card-glass-menu-task')).toBeNull();
    rerender(<BabelExecutionBoard items={[item]} selectedItemId={item.id} />);
    await waitFor(() => expect(screen.getByTestId('card-glass-menu-task')).toBeDefined());
    // An explicit stage switch must survive unrelated metadata refreshes.
    fireEvent.click(screen.getByTestId('babel-stage-tab-TODO'));
    rerender(<BabelExecutionBoard items={[{ ...item }]} selectedItemId={item.id} />);
    expect(screen.queryByTestId('card-glass-menu-task')).toBeNull();
  });
  it('portals outside the frosted board and returns focus to the keyboard trigger', async () => {
    render(<BabelExecutionBoard items={[record()]} />);
    fireEvent.click(screen.getByTestId('babel-stage-tab-DONE'));
    const card = screen.getByTestId('card-glass-menu-task');
    card.focus();
    fireEvent.keyDown(card, { key: 'F10', shiftKey: true });

    const menu = await screen.findByRole('menu', { name: '卡片操作' });
    expect(screen.getByTestId('babel-execution-board').contains(menu)).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '归档' })));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it('preserves the archive guard and lets a blocked menu close with Escape', async () => {
    const archive = vi.fn();
    render(<BabelExecutionBoard items={[record('executing')]} onArchiveItems={archive} />);
    fireEvent.click(screen.getByTestId('babel-stage-tab-DONE'));
    const trigger = screen.getByTestId('babel-card-menu-glass-menu-task');
    trigger.focus();
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    const action = screen.getByRole('menuitem', { name: '归档' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(archive).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(menu));
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('dispatches archive once and never treats menu input as the board create shortcut', async () => {
    const archive = vi.fn();
    const create = vi.fn();
    render(<BabelExecutionBoard items={[record()]} onArchiveItems={archive} onCreateInTodo={create} canCreateInTodo />);
    fireEvent.click(screen.getByTestId('babel-stage-tab-DONE'));
    const trigger = screen.getByTestId('babel-card-menu-glass-menu-task');
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'n' });
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: '归档' }));
    expect(archive).toHaveBeenCalledExactlyOnceWith(['glass-menu-task'], true);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses on an outside press without taking focus from the new target', async () => {
    render(<><BabelExecutionBoard items={[record()]} /><button type="button">其他操作</button></>);
    fireEvent.click(screen.getByTestId('babel-stage-tab-DONE'));
    fireEvent.click(screen.getByTestId('babel-card-menu-glass-menu-task'));
    await screen.findByRole('menu');
    const outside = screen.getByRole('button', { name: '其他操作' });
    fireEvent.pointerDown(outside);
    outside.focus();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(outside);
  });
});
