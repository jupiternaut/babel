import type { RunStatus, Stage } from "../contracts.ts";

export const STAGE_ORDER: Stage[] = ["TODO", "RUNNING", "DONE", "ARCHIVED"];

export const STAGE_LABEL: Record<Stage, string> = {
  TODO: "待办",
  RUNNING: "进行",
  DONE: "完成",
  ARCHIVED: "归档",
};

export function attentionFilterText(enabled: boolean): string {
  return enabled ? "需要关注" : "全部任务";
}

export const TYPE_LABEL: Record<string, string> = {
  executable: "可执行",
  all: "全部类型",
  task: "任务",
  bug: "缺陷",
  plan: "计划",
  decision: "决策",
  idea: "想法",
  milestone: "里程碑",
  release: "发布",
};

export function runStatusText(status: RunStatus | null | undefined): string {
  if (!status) return "尚未执行";
  switch (status) {
    case "waiting_input":
      return "等待输入";
    case "cancel_requested":
      return "取消待确认";
    case "lost":
      return "失联未核对";
    case "review_required":
      return "待验收";
    case "executing":
      return "执行中";
    case "verifying":
      return "验证中";
    case "requested":
    case "accepted":
      return "已接受（未完成）";
    case "succeeded":
      return "已成功";
    case "failed":
      return "已失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function typeText(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
