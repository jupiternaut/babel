import React from 'react';
import { attentionCards, type TaskListCard } from './babelScope';
import { runStatusLabel } from './babelRunLabels';

export interface BabelAttentionProps {
  attentionOnly?: boolean;
  onAttentionChange?: (enabled: boolean) => void;
  selectedItemId?: string | null;
  onAttentionSelect?: (id: string) => void;
}

export function BabelAttention({
  listed, stale, attentionOnly, onAttentionChange, selectedItemId, onAttentionSelect,
}: BabelAttentionProps & { listed: TaskListCard[] | null; stale: boolean }) {
  const cards = attentionCards(listed ?? []);
  return (
    <section className="babel-attention babel-nav-group" aria-label="需要关注">
      <button
        type="button"
        className={`babel-nav-button flex w-full items-center justify-between text-left text-[12px] ${attentionOnly ? 'is-active' : ''}`}
        aria-pressed={Boolean(attentionOnly)}
        onClick={() => onAttentionChange?.(!attentionOnly)}
        data-testid="babel-attention-toggle"
      >
        <span>需要关注</span>
        <span className="babel-attention-count">{listed ? cards.length : '—'}</span>
      </button>
      <p className="px-2 pt-1 text-[11px] text-nim-muted">
        {stale ? '上次快照 · 状态可能已过期' : '当前项目与设备 · 等待、异常与待验收'}
      </p>
      {attentionOnly && listed ? (
        <ul className="babel-attention-list mt-2 space-y-1" aria-label="需要关注的任务">
          {cards.map((card) => (
            <li key={card.trackerId}>
              <button
                type="button"
                className={`babel-attention-item w-full rounded-lg px-2 py-2 text-left ${selectedItemId === card.trackerId ? 'bg-nim-selected' : 'hover:bg-nim-hover'}`}
                aria-current={selectedItemId === card.trackerId ? 'true' : undefined}
                onClick={() => onAttentionSelect?.(card.trackerId)}
                data-testid={`babel-attention-${card.trackerId}`}
              >
                <span className="block line-clamp-2 text-[12px] text-nim">{card.title || card.trackerId}</span>
                <span className="block text-[11px] text-nim-muted">{runStatusLabel(card.runStatus ?? '')}</span>
                <span className="block text-[11px] text-nim-muted">
                  更新：{card.lastUpdatedAt && Number.isFinite(Date.parse(card.lastUpdatedAt))
                    ? <time dateTime={card.lastUpdatedAt} title={card.lastUpdatedAt}>{new Date(card.lastUpdatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                    : '未知'}
                </span>
              </button>
            </li>
          ))}
          {cards.length === 0 ? <li className="px-2 py-2 text-[12px] text-nim-muted">当前范围没有需要关注的任务。</li> : null}
        </ul>
      ) : null}
    </section>
  );
}
