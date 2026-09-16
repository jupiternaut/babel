import type { KeyboardEvent } from "react";
import type { TaskCard } from "../api.ts";
import { attentionText, runStatusLabel, statusLabel, typeLabel } from "../labels.ts";

export function NativeList({
  items,
  selectedId,
  onSelect,
  onOpenMenu,
}: {
  items: TaskCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenMenu: (trackerId: string, el: HTMLElement) => void;
}) {
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(items[index].trackerId);
      return;
    }
    const next =
      event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    onSelect(items[next].trackerId);
    document.getElementById(`row-${items[next].trackerId}`)?.focus();
  };

  return (
    <div className="native-list">
      {items.length === 0 ? (
        <p className="empty">当前筛选没有记录。可清除搜索或换一个类型。</p>
      ) : (
        <table>
          <caption className="live">原生类型列表。发布记录不是归档；已批准不是完成。</caption>
          <thead>
            <tr>
              <th>标题</th>
              <th>类型</th>
              <th>状态</th>
              <th>执行说明</th>
              <th>菜单</th>
            </tr>
          </thead>
          <tbody>
            {items.map((card, index) => (
              <tr
                key={card.trackerId}
                id={`row-${card.trackerId}`}
                tabIndex={selectedId === card.trackerId || (!selectedId && index === 0) ? 0 : -1}
                aria-selected={selectedId === card.trackerId}
                onClick={() => onSelect(card.trackerId)}
                onKeyDown={(event) => onRowKey(event, index)}
              >
                <td>{card.title}</td>
                <td>{typeLabel(card.primaryType)}</td>
                <td>{statusLabel(card.status)}</td>
                <td>
                  {card.primaryType === "release"
                    ? "发布记录，不是归档"
                    : card.status === "approved"
                      ? "已批准仍属运行语义，不是完成"
                      : attentionText(card.runStatus) ?? runStatusLabel(card.runStatus) ?? "未开始执行"}
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`打开 ${card.title} 的菜单`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenMenu(card.trackerId, event.currentTarget);
                    }}
                  >
                    ···
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
