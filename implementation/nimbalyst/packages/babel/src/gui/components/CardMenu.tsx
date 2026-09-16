import { useEffect, useRef, useState } from "react";
import type { ActionCapability } from "../api.ts";
import type { TaskCard } from "../api.ts";

export interface MenuAction {
  id: string;
  label: string;
  disabled?: boolean;
  reason?: string;
}

export function cardMenuActions(
  card: TaskCard,
  caps: Record<string, ActionCapability>,
  connected: boolean,
): MenuAction[] {
  const offline = !connected ? "已断线，执行操作已禁用" : undefined;
  const cap = (name: string): { disabled: boolean; reason?: string } => {
    if (!connected) return { disabled: true, reason: offline };
    const item = caps[name];
    if (item && item.allowed === false) return { disabled: true, reason: item.reason };
    return { disabled: false };
  };
  const items: MenuAction[] = [{ id: "open", label: "打开详情" }];
  if (card.stage === "TODO") {
    const start = cap("run.start");
    items.push({ id: "start", label: "开始模拟", ...start });
  }
  if (card.runStatus === "review_required" || card.runStatus === "verifying") {
    const accept = cap("review.accept");
    items.push({ id: "accept", label: "接受结果", ...accept });
    items.push({ id: "changes", label: "要求修改", ...cap("review.request_changes") });
  }
  if (card.latestRunId && (card.runStatus === "executing" || card.runStatus === "accepted" || card.runStatus === "waiting_input")) {
    items.push({ id: "cancel", label: "请求取消", ...cap("run.cancel") });
  }
  if (card.runStatus === "lost" || card.runStatus === "cancel_requested") {
    items.push({ id: "reconcile", label: "核对并标记结束", ...cap("run.reconcile") });
  }
  if (card.stage === "RUNNING" && (card.runStatus === "failed" || card.runStatus === "cancelled")) {
    items.push({ id: "retry", label: "重试执行", ...cap("run.retry") });
  }
  if (card.stage !== "ARCHIVED") {
    items.push({ id: "archive", label: "归档", ...cap("task.archive") });
  } else {
    items.push({ id: "restore", label: "恢复（不自动执行）", ...cap("task.restore") });
  }
  return items;
}

export function CardMenu({
  x,
  y,
  actions,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
    first?.focus();
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ insetInlineStart: x, top: y }}
      onKeyDown={(event) => {
        const enabled = actions.map((a, i) => ({ a, i })).filter((row) => !row.a.disabled);
        if (!enabled.length) return;
        const pos = Math.max(0, enabled.findIndex((row) => row.i === index));
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const next = enabled[(pos + 1) % enabled.length];
          setIndex(next.i);
          (ref.current?.querySelectorAll("button")[next.i] as HTMLButtonElement | undefined)?.focus();
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          const next = enabled[(pos - 1 + enabled.length) % enabled.length];
          setIndex(next.i);
          (ref.current?.querySelectorAll("button")[next.i] as HTMLButtonElement | undefined)?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          title={action.reason}
          onClick={() => {
            if (action.disabled) return;
            onAction(action.id);
          }}
        >
          {action.label}
          {action.disabled && action.reason ? <span className="nav-sub"> · {action.reason}</span> : null}
        </button>
      ))}
    </div>
  );
}
