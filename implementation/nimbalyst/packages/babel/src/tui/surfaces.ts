import type { KeyEvent } from "./input.ts";
import {
  googleTasksStatus,
  nodeList,
  opsHealth,
  pdfLocate,
} from "../cli/surfaces.ts";

export const SURFACE_SAMPLE_QUOTE = "巴别塔演示样本";

export type SurfaceId =
  | "google-tasks"
  | "google-tasks-pull"
  | "nodes"
  | "ops-health"
  | "pdf-locate";

export interface SurfaceMenuItem {
  id: SurfaceId;
  label: string;
  shortcut?: string;
}

export interface SurfaceOverlay {
  kind: "surface";
  id: SurfaceId;
  title: string;
  lines: string[];
  footer: string;
  quote?: string;
}

export const SURFACE_MENU_ITEMS: SurfaceMenuItem[] = [
  { id: "google-tasks", label: "x  查看 Google Tasks 状态（未接入/演示）", shortcut: "x" },
  { id: "google-tasks-pull", label: "   阅读试拉说明（合成，不真同步）" },
  { id: "nodes", label: "z  列出合成节点", shortcut: "z" },
  { id: "ops-health", label: "b  阅读运维健康说明（演示）", shortcut: "b" },
  { id: "pdf-locate", label: "f  定位本地 PDF 样本", shortcut: "f" },
];

export function isSurfaceMenuId(id: string): id is SurfaceId {
  return SURFACE_MENU_ITEMS.some((item) => item.id === id);
}

export function surfaceShortcutId(text: string): SurfaceId | undefined {
  return SURFACE_MENU_ITEMS.find((item) => item.shortcut === text)?.id;
}

export function firstSurfaceMenuIndex(menuItems: Array<{ id: string }>): number {
  const index = menuItems.findIndex((item) => isSurfaceMenuId(item.id));
  return index >= 0 ? index : 0;
}

export function surfaceHelpLines(): string[] {
  return [
    "x Google Tasks  z 合成节点  b 运维说明  f 本地 PDF",
    "后续入口均为未接入/演示，不会打开外部图形窗口。",
  ];
}

export function openSurface(id: SurfaceId, quote = SURFACE_SAMPLE_QUOTE): SurfaceOverlay {
  if (id === "google-tasks") {
    return overlayOf("google-tasks", "Google Tasks 状态", formatRecord(googleTasksStatus()), "Esc 关闭");
  }
  if (id === "google-tasks-pull") {
    return overlayOf(
      "google-tasks-pull",
      "Google Tasks 试拉说明",
      [
        "试拉走合成内存页。没有真账号，不会同步成功。",
        "CLI：babel google-tasks pull --tasklist <id> --json",
        "缺 --tasklist 时返回 USAGE。未选择列表时不会导入全部任务。",
        "轮询间隔 60 秒，重叠窗口 120 秒，只作说明，不启动真实同步。",
        "oauthStarted=false  usedUserToken=false  realSync=false",
        "当前访问：未接入",
      ],
      "Esc 关闭",
    );
  }
  if (id === "nodes") {
    return overlayOf("nodes", "合成节点", formatRecord(nodeList()), "Esc 关闭");
  }
  if (id === "ops-health") {
    return overlayOf("ops-health", "运维健康说明", formatRecord(opsHealth()), "Esc 关闭");
  }
  return pdfOverlay(quote);
}

export function handleSurfaceKey(ev: KeyEvent, overlay: SurfaceOverlay): SurfaceOverlay {
  if (overlay.id !== "pdf-locate") return overlay;
  let quote = overlay.quote ?? "";
  if (ev.type === "key" && ev.name === "backspace") {
    quote = quote.slice(0, -1);
    return pdfOverlay(quote);
  }
  if (ev.type === "text") quote += ev.text;
  if (ev.type === "paste") quote += ev.text;
  if (ev.type === "key" && (ev.name === "enter" || ev.name === "ctrl-s")) {
    return pdfOverlay(quote);
  }
  if (ev.type === "text" || ev.type === "paste") {
    return {
      ...overlay,
      quote,
      lines: [`摘录 ${quote}`, ...overlay.lines.slice(1)],
    };
  }
  return overlay;
}

function pdfOverlay(quote: string): SurfaceOverlay {
  const trimmed = quote.trim();
  if (!trimmed) {
    return {
      kind: "surface",
      id: "pdf-locate",
      title: "定位本地 PDF 样本",
      lines: ["摘录 （空）", "USAGE: 需要摘录才能定位本地样本。"],
      footer: "输入摘录后 Enter 定位  Esc 关闭",
      quote,
    };
  }
  return {
    kind: "surface",
    id: "pdf-locate",
    title: "定位本地 PDF 样本",
    lines: [`摘录 ${quote}`, ...formatRecord(pdfLocate(trimmed))],
    footer: "输入摘录后 Enter 定位  Esc 关闭",
    quote,
  };
}

function overlayOf(id: SurfaceId, title: string, lines: string[], footer: string): SurfaceOverlay {
  return { kind: "surface", id, title, lines, footer };
}

function formatRecord(value: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const pick = [
    "access",
    "syncLabel",
    "syncNote",
    "connectionNote",
    "note",
    "mode",
    "realSync",
    "realMachine",
    "oauthStarted",
    "pulled",
    "probed",
    "found",
    "liveTranslation",
    "source",
    "documentId",
    "autoExecute",
  ];
  for (const key of pick) {
    if (value[key] !== undefined) {
      lines.push(`${labelOf(key)} ${stringify(value[key])}`);
    }
  }
  if (Array.isArray(value.snapshots)) {
    lines.push(value.snapshots.length ? `节点 ${value.snapshots.length} 台（合成）` : "当前没有登记合成节点");
  }
  if (value.anchor && typeof value.anchor === "object") {
    const anchor = value.anchor as { page?: number; paragraphId?: string };
    lines.push(`锚点 第${anchor.page ?? "?"}页 ${anchor.paragraphId ?? ""}`);
  }
  return lines;
}

function labelOf(key: string): string {
  switch (key) {
    case "access":
      return "访问";
    case "syncLabel":
      return "同步";
    case "syncNote":
      return "说明";
    case "connectionNote":
      return "连接";
    case "note":
      return "备注";
    case "mode":
      return "模式";
    case "realSync":
      return "真实同步";
    case "realMachine":
      return "真机";
    case "oauthStarted":
      return "已开 OAuth";
    case "pulled":
      return "已拉取";
    case "probed":
      return "已探测";
    case "found":
      return "命中";
    case "liveTranslation":
      return "真实译文";
    case "source":
      return "来源";
    case "documentId":
      return "文档";
    case "autoExecute":
      return "自动执行";
    default:
      return key;
  }
}

function stringify(value: unknown): string {
  if (value === true) return "是";
  if (value === false) return "否";
  if (value == null) return "无";
  if (value === "demo") return "演示";
  if (value === "synthetic") return "合成";
  return String(value);
}
