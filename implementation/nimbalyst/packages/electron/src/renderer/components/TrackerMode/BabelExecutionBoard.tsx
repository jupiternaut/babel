import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TrackerIdentity } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { TrackerBoardCard } from '@nimbalyst/collab-client/trackers-ui';
import {
  BABEL_EXECUTION_STAGE_LABEL,
  BABEL_EXECUTION_STAGES,
  deriveHostExecutionStage,
  hostArchiveGuard,
  type BabelExecutionStage,
} from './babelExecutionStage';
import { boardLayoutMode } from './babelWorkbench/babelScope';

interface BabelExecutionBoardProps {
  items: TrackerRecord[];
  selectedItemId?: string | null;
  onItemSelect?: (itemId: string) => void;
  onOpenDocument?: (itemId: string) => void;
  onArchiveItems?: (itemIds: string[], archive: boolean) => void;
  onCreateInTodo?: () => void;
  canCreateInTodo?: boolean;
  currentIdentity?: TrackerIdentity | null;
  scopeNote?: string;
}

interface CardMenuState {
  item: TrackerRecord;
  x: number;
  y: number;
}

export const BabelExecutionBoard: React.FC<BabelExecutionBoardProps> = ({
  items,
  selectedItemId,
  onItemSelect,
  onOpenDocument,
  onArchiveItems,
  onCreateInTodo,
  canCreateInTodo,
  currentIdentity,
  scopeNote,
}) => {
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [layout, setLayout] = useState<'columns' | 'stage-list'>('columns');
  const [activeStage, setActiveStage] = useState<BabelExecutionStage>('TODO');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  const grouped = useMemo(() => {
    const next: Record<BabelExecutionStage, TrackerRecord[]> = {
      TODO: [],
      RUNNING: [],
      DONE: [],
      ARCHIVED: [],
    };
    for (const item of items) {
      next[deriveHostExecutionStage(item)].push(item);
    }
    return next;
  }, [items]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth;
      setLayout(boardLayoutMode(width));
    });
    observer.observe(node);
    setLayout(boardLayoutMode(node.clientWidth));
    return () => observer.disconnect();
  }, []);

  const closeMenu = (restoreFocus = true) => {
    const trigger = triggerRef.current;
    setMenu(null);
    triggerRef.current = null;
    if (restoreFocus) trigger?.focus();
  };

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus();
  }, [menu]);

  const openMenu = (event: React.MouseEvent | React.KeyboardEvent, item: TrackerRecord) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    triggerRef.current = target;
    const point = 'clientX' in event
      ? { x: event.clientX, y: event.clientY }
      : (() => {
        const box = target.getBoundingClientRect();
        return { x: box.left + 8, y: box.bottom };
      })();
    setMenu({ item, ...point });
  };

  const archiveGuard = menu ? hostArchiveGuard(menu.item) : { allowed: true };
  const archiveLabel = menu?.item.archived ? '恢复' : '归档';
  const archiveDisabled = Boolean(menu && !menu.item.archived && !archiveGuard.allowed);

  const renderCard = (item: TrackerRecord, stage: BabelExecutionStage, index: number) => (
    <div
      key={item.id}
      className="mb-1.5 flex items-start gap-1"
      data-tracker-id={item.id}
      ref={(node) => {
        if (node) cardRefs.current.set(item.id, node);
        else cardRefs.current.delete(item.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          openMenu(event, item);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <TrackerBoardCard
          item={item}
          columnKey={stage}
          cardIndex={index}
          selected={false}
          highlighted={item.id === selectedItemId}
          dragging={false}
          onSelect={(_event, next) => onItemSelect?.(next.id)}
          onToggleSelected={() => undefined}
          onOpenDocument={onOpenDocument}
          onContextMenu={(event, next) => openMenu(event, next)}
          currentIdentity={currentIdentity}
        />
      </div>
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-nim text-nim-muted hover:bg-nim-tertiary"
        aria-label={`打开 ${item.fields.title ?? item.id} 的菜单`}
        aria-haspopup="menu"
        data-testid={`babel-card-menu-${item.id}`}
        onClick={(event) => openMenu(event, item)}
      >
        ···
      </button>
    </div>
  );

  const renderColumn = (stage: BabelExecutionStage) => (
    <section
      key={stage}
      className="flex min-h-0 min-w-[220px] flex-1 flex-col overflow-hidden rounded-md border border-nim bg-nim-secondary"
      data-testid={`babel-execution-column-${stage}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
        <h2 className="text-[12px] font-medium text-nim">
          {BABEL_EXECUTION_STAGE_LABEL[stage]}
          <span className="ml-1 text-nim-faint">{grouped[stage].length}</span>
        </h2>
        {stage === 'TODO' && canCreateInTodo ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded bg-[var(--nim-primary)] px-2 text-[11px] text-white"
            aria-label="在待办列新建"
            data-testid="babel-execution-create-todo"
            onClick={onCreateInTodo}
          >
            新建
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {grouped[stage].map((item, index) => renderCard(item, stage, index))}
      </div>
    </section>
  );

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col bg-nim"
      data-testid="babel-execution-board"
      data-layout={layout}
      onKeyDown={(event) => {
        if (!canCreateInTodo || !onCreateInTodo) return;
        if (event.key !== 'n' && event.key !== 'N') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        onCreateInTodo();
      }}
    >
      <div className="shrink-0 border-b border-nim px-3 py-1.5 text-[11px] text-nim-muted">
        演示数据 · 执行视图与原生 Trackers 共用同一条 TrackerRecord。没有拖拽时请用卡片菜单归档或恢复。
        {scopeNote ? <span className="block text-nim-faint" role="status">{scopeNote}</span> : null}
      </div>
      {layout === 'stage-list' ? (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="babel-execution-stage-list">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-nim px-2 py-1" role="tablist" aria-label="执行阶段">
            {BABEL_EXECUTION_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                role="tab"
                aria-selected={activeStage === stage}
                className={`min-h-8 rounded px-2 text-[12px] ${
                  activeStage === stage ? 'bg-nim-tertiary text-nim' : 'text-nim-muted hover:bg-nim-tertiary'
                }`}
                onClick={() => setActiveStage(stage)}
                data-testid={`babel-stage-tab-${stage}`}
              >
                {BABEL_EXECUTION_STAGE_LABEL[stage]}
                <span className="ml-1 text-nim-faint">{grouped[stage].length}</span>
              </button>
            ))}
          </div>
          {renderColumn(activeStage)}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-auto p-2">
          {BABEL_EXECUTION_STAGES.map((stage) => renderColumn(stage))}
        </div>
      )}
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="卡片操作"
          className="fixed z-50 min-w-[180px] rounded-md border border-nim bg-nim-secondary py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          data-testid="babel-execution-card-menu"
        >
          <button
            type="button"
            role="menuitem"
            className="flex min-h-8 w-full items-center px-3 text-left text-[12px] text-nim hover:bg-nim-tertiary focus-visible:bg-nim-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={archiveDisabled}
            title={archiveDisabled ? archiveGuard.reason : undefined}
            onClick={() => {
              if (archiveDisabled) return;
              onArchiveItems?.([menu.item.id], !menu.item.archived);
              closeMenu(true);
            }}
          >
            {archiveLabel}
          </button>
          {archiveDisabled && archiveGuard.reason ? (
            <div role="status" className="px-3 py-1 text-[11px] text-nim-muted">
              {archiveGuard.reason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
