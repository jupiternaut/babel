import type { KeyboardEvent } from "react";
import type { Stage } from "../../contracts.ts";
import type { TaskCard } from "../api.ts";
import { STAGE_LABELS } from "../labels.ts";
import { STAGES } from "../types.ts";
import { TaskCardView } from "./TaskCardView.tsx";

export function Board({
  items,
  counts,
  selectedId,
  narrowStage,
  isNarrow,
  canCreate,
  createLabel,
  onSelect,
  onCreate,
  onOpenMenu,
  onDropStage,
  onMoveFocus,
}: {
  items: TaskCard[];
  counts: Record<Stage, number>;
  selectedId: string | null;
  narrowStage: Stage;
  isNarrow: boolean;
  canCreate: boolean;
  createLabel: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenMenu: (trackerId: string, el: HTMLElement) => void;
  onDropStage: (trackerId: string, stage: Stage) => void;
  onMoveFocus: (trackerId: string, key: string) => void;
}) {
  return (
    <div className="board" role="listbox" aria-label="执行看板">
      {STAGES.map((stage) => {
        const cards = items.filter((item) => item.stage === stage);
        const hidden = isNarrow && stage !== narrowStage;
        return (
          <section
            key={stage}
            className="column"
            data-hidden={hidden || undefined}
            aria-label={STAGE_LABELS[stage]}
            onDragOver={(event) => {
              event.preventDefault();
              event.currentTarget.classList.add("drop-active");
            }}
            onDragLeave={(event) => {
              event.currentTarget.classList.remove("drop-active");
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove("drop-active");
              const id = event.dataTransfer.getData("text/tracker-id");
              if (id) onDropStage(id, stage);
            }}
          >
            <div className="column-head">
              <h2>
                {STAGE_LABELS[stage]} <span className="count">{counts[stage] ?? cards.length}</span>
              </h2>
              {stage === "TODO" && canCreate ? (
                <button type="button" className="icon-btn" aria-label={createLabel} onClick={onCreate}>
                  +
                </button>
              ) : null}
            </div>
            <div className="column-body">
              {cards.length === 0 ? (
                <p className="empty">
                  {stage === "TODO"
                    ? "这一列还没有条目。可用列头加号或全局入口新建。"
                    : "这一列还没有条目。"}
                </p>
              ) : (
                cards.map((card) => (
                  <TaskCardView
                    key={card.trackerId}
                    card={card}
                    selected={selectedId === card.trackerId}
                    tabIndex={selectedId === card.trackerId || (!selectedId && card === cards[0]) ? 0 : -1}
                    onSelect={() => onSelect(card.trackerId)}
                    onOpenMenu={(el) => onOpenMenu(card.trackerId, el)}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(card.trackerId);
                      } else if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp" ||
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowRight" ||
                        event.key === "Home" ||
                        event.key === "End"
                      ) {
                        event.preventDefault();
                        onMoveFocus(card.trackerId, event.key);
                      }
                    }}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
