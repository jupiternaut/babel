import type { KeyboardEvent } from "react";
import type { TaskCard } from "../api.ts";
import { attentionText, runStatusLabel, statusLabel, typeLabel } from "../labels.ts";

export function cardAux(card: TaskCard): string {
  const attention = attentionText(card.runStatus);
  if (attention) return attention;
  const run = runStatusLabel(card.runStatus);
  if (run) return run;
  if (card.status === "approved") return statusLabel(card.status);
  return `${typeLabel(card.primaryType)} · ${statusLabel(card.status)}`;
}

export function TaskCardView({
  card,
  selected,
  tabIndex,
  onSelect,
  onOpenMenu,
  onKeyDown,
}: {
  card: TaskCard;
  selected: boolean;
  tabIndex: number;
  onSelect: () => void;
  onOpenMenu: (el: HTMLElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      id={`card-${card.trackerId}`}
      className="card"
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      draggable
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/tracker-id", card.trackerId);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="card-title">{card.title}</div>
      <div className="card-aux">{cardAux(card)}</div>
      <button
        type="button"
        className="icon-btn card-menu-btn"
        aria-label={`打开 ${card.title} 的菜单`}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          onOpenMenu(event.currentTarget);
        }}
      >
        ···
      </button>
    </div>
  );
}
