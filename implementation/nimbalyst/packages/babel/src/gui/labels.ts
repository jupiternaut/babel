import type { RunStatus, Stage } from "../contracts.ts";
import { NATIVE_TYPES } from "../contracts.ts";

export const TYPE_LABELS: Record<string, string> = {
  plan: "计划",
  decision: "决策",
  bug: "缺陷",
  task: "任务",
  idea: "想法",
  milestone: "里程碑",
  release: "发布",
};

export const STAGE_LABELS: Record<Stage, string> = {
  TODO: "待办",
  RUNNING: "运行",
  DONE: "完成",
  ARCHIVED: "归档",
};

export const CREATE_LABELS: Record<string, string> = {
  plan: "新建计划",
  decision: "新建决策",
  bug: "新建缺陷",
  task: "新建任务",
  idea: "新建想法",
  milestone: "新建里程碑",
  release: "新发布",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function createLabel(type: string): string {
  return CREATE_LABELS[type] ?? `新建${typeLabel(type)}`;
}

export function statusLabel(status: string): string {
  const value = String(status ?? "").trim().toLowerCase();
  const table: Record<string, string> = {
    done: "已完成",
    completed: "已完成",
    complete: "已完成",
    closed: "已关闭",
    resolved: "已解决",
    released: "已发布",
    shipped: "已发布",
    implemented: "已实现",
    decided: "已决定",
    fixed: "已修复",
    cancelled: "已取消",
    canceled: "已取消",
    rejected: "已拒绝",
    declined: "已拒绝",
    abandoned: "已放弃",
    obsolete: "已过时",
    superseded: "已被取代",
    duplicate: "重复项",
    "wont-do": "已取消",
    "wont-fix": "不修复",
    "in-progress": "进行中",
    "in-development": "开发中",
    "in-review": "待审查",
    "changes-requested": "要求修改",
    approved: "已批准（运行中，不是完成）",
    blocked: "已阻塞",
    active: "进行中",
    "to-do": "待办",
    todo: "待办",
    open: "未开始",
    planned: "已计划",
    ready: "就绪",
    "ready-for-development": "可开发",
    draft: "草稿",
    new: "新建",
    backlog: "待整理",
    proposed: "已提议",
    triage: "分拣中",
    accepted: "已采纳（不是执行）",
  };
  return table[value] ?? status;
}

export function runStatusLabel(status: RunStatus | null | undefined): string | null {
  if (!status) return null;
  const table: Record<RunStatus, string> = {
    requested: "已请求，尚未接受",
    accepted: "已接受，尚未完成",
    executing: "执行中",
    waiting_input: "等待输入",
    verifying: "验证中",
    review_required: "待验收",
    succeeded: "已成功",
    failed: "失败",
    cancel_requested: "取消尚未确认",
    cancelled: "已取消",
    lost: "失联（尚未核对）",
  };
  return table[status];
}

export function attentionText(status: RunStatus | null | undefined): string | null {
  if (status === "waiting_input") return "等待输入";
  if (status === "failed") return "失败";
  if (status === "lost") return "失联";
  if (status === "cancel_requested") return "取消尚未确认";
  return null;
}

export function verificationLabel(state: string): string {
  const table: Record<string, string> = {
    pending: "待验证",
    passed: "已通过",
    failed: "未通过",
    skipped: "已跳过",
    waived: "已豁免",
  };
  return table[state] ?? state;
}

export const NATIVE_TYPE_IDS = [...NATIVE_TYPES];

export const INJECT_SCENARIOS = [
  { id: "waiting_input", label: "等待输入" },
  { id: "verification_failed", label: "验证失败" },
  { id: "lost", label: "失联" },
  { id: "cancel_unconfirmed", label: "取消尚未确认" },
  { id: "message_disorder", label: "消息乱序" },
  { id: "review_required", label: "待验收" },
  { id: "disconnect", label: "演示断线（服务端继续）" },
] as const;
