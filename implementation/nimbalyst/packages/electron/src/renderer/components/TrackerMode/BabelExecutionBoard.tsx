import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { TrackerIdentity } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { TrackerBoardCard } from '@nimbalyst/collab-client/trackers-ui';
import {
  BABEL_EXECUTION_STAGE_LABEL,
  BABEL_EXECUTION_STAGES,
  deriveHostExecutionStage,
  hostArchiveGuard,
  type BabelExecutionStage,
} from './babelExecutionStage';
import { boardLayoutMode } from './babelWorkbench/babelScope';
import './babelWorkbench/BabelWorkbench.css';

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
  const triggerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const locatedItemRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedItemId) { locatedItemRef.current = null; return; }
    if (locatedItemRef.current === selectedItemId) return;
    const selected = items.find((item) => item.id === selectedItemId);
    if (selected) {
      setActiveStage(deriveHostExecutionStage(selected));
      locatedItemRef.current = selectedItemId;
    }
  }, [items, selectedItemId]);

  const closeMenu = React.useCallback((restoreFocus = true) => {
    const trigger = triggerRef.current;
    setMenu(null);
    triggerRef.current = null;
    if (restoreFocus) trigger?.focus();
  }, []);

  const floating = useFloating({
    open: Boolean(menu),
    onOpenChange: (open, _event, reason) => {
      if (!open) closeMenu(reason !== 'outside-press' && reason !== 'focus-out');
    },
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  const dismiss = useDismiss(floating.context);
  const role = useRole(floating.context, { role: 'menu' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

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

  const openMenu = (event: React.MouseEvent | React.KeyboardEvent, item: TrackerRecord) => {
    event.preventDefault();
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>('button, [tabindex="0"]')
      ?? event.currentTarget as HTMLElement;
    triggerRef.current = target;
    floating.refs.setReference(target);
    if (event.type === 'contextmenu' && 'clientX' in event) {
      const { clientX: x, clientY: y } = event;
      floating.refs.setPositionReference({
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
        contextElement: target,
      });
    } else {
      floating.refs.setPositionReference(target);
    }
    setMenu({ item });
  };

  const archiveGuard = menu ? hostArchiveGuard(menu.item) : { allowed: true };
  const archiveLabel = menu?.item.archived ? '恢复' : '归档';
  const archiveDisabled = Boolean(menu && !menu.item.archived && !archiveGuard.allowed);

  const renderCard = (item: TrackerRecord, stage: BabelExecutionStage, index: number) => (
    <div
      key={item.id}
      className={`babel-execution-card ${item.id === selectedItemId ? 'is-selected' : ''}`}
      data-tracker-id={item.id}
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
        className="babel-card-menu-trigger inline-flex h-8 w-8 items-center justify-center rounded"
        aria-label={`打开 ${item.fields.title ?? item.id} 的菜单`}
        aria-haspopup="menu"
        aria-expanded={menu?.item.id === item.id}
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
      className="babel-execution-column flex min-h-0 min-w-[220px] flex-1 flex-col overflow-hidden"
      data-stage={stage}
      data-testid={`babel-execution-column-${stage}`}
    >
      <header className="babel-column-header flex shrink-0 items-center justify-between gap-2">
        <h2 className="babel-column-heading text-nim">
          <span className="babel-stage-mark" aria-hidden="true" />
          {BABEL_EXECUTION_STAGE_LABEL[stage]}
          <span className="babel-stage-count">{grouped[stage].length}</span>
        </h2>
        {stage === 'TODO' && canCreateInTodo ? (
          <button
            type="button"
            className="babel-primary-button inline-flex h-8 items-center rounded-md px-2 text-[12px]"
            aria-label="在待办列新建"
            data-testid="babel-execution-create-todo"
            onClick={onCreateInTodo}
          >
            新建
          </button>
        ) : null}
      </header>
      <div className="babel-column-cards min-h-0 flex-1 overflow-auto">
        {grouped[stage].map((item, index) => renderCard(item, stage, index))}
      </div>
    </section>
  );

  return (
    <div
      ref={rootRef}
      className="babel-workbench babel-execution-board flex h-full min-h-0 flex-col"
      data-testid="babel-execution-board"
      data-layout={layout}
      onKeyDown={(event) => {
        if (menu || !canCreateInTodo || !onCreateInTodo) return;
        if (event.key !== 'n' && event.key !== 'N') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        onCreateInTodo();
      }}
    >
      <div className="babel-board-context shrink-0">
        <span className="babel-demo-badge">演示数据</span>
        <span>{items.length} 条记录</span>
        <span className="babel-board-hint">卡片菜单可归档或恢复</span>
        {scopeNote ? <span className="babel-board-scope-note" role="status">{scopeNote}</span> : null}
      </div>
      {layout === 'stage-list' ? (
        <div className="babel-stage-list flex min-h-0 flex-1 flex-col" data-testid="babel-execution-stage-list">
          <div className="babel-stage-tabs flex shrink-0 overflow-x-auto" role="tablist" aria-label="执行阶段">
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
        <div className="babel-board-columns grid min-h-0 flex-1 overflow-auto">
          {BABEL_EXECUTION_STAGES.map((stage) => renderColumn(stage))}
        </div>
      )}
      {menu ? (
        <FloatingPortal>
          <FloatingFocusManager
            context={floating.context}
            modal={false}
            initialFocus={archiveDisabled ? floating.refs.floating : 0}
            returnFocus={false}
          >
            <div
              ref={floating.refs.setFloating}
              {...getFloatingProps()}
              tabIndex={-1}
              aria-label="卡片操作"
              className="babel-workbench babel-card-menu"
              style={floating.floatingStyles}
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
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </div>
  );
};
