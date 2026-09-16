import type { Stage } from "../contracts.ts";
import { STAGE_LABEL, STAGE_ORDER, runStatusText, typeText } from "./labels.ts";
import { displayWidth, padWidth, sliceByWidth, wrapByWidth } from "./width.ts";

export interface TuiCard {
  trackerId: string;
  title: string;
  description: string;
  primaryType: string;
  status: string;
  stage: Stage;
  revision: number;
  latestRunId: string | null;
  runStatus: string | null;
  lastUpdatedAt: string | null;
  attention: boolean;
  archived?: boolean;
  readOnly?: boolean;
}

export interface FrameModel {
  cols: number;
  rows: number;
  projectName: string;
  typeFilter: string;
  deviceLabel: string;
  connected: boolean;
  lastSync: string;
  query: string;
  mode: "board" | "prompt";
  promptLabel?: string;
  promptValue?: string;
  statusLine: string;
  selectedId: string | null;
  tab: "detail" | "session" | "diff" | "history";
  cards: TuiCard[];
  detailLines: string[];
}

const HELP = "j/k 移动  Enter 详情  n 新建  e 编辑  s 开始  m 消息  c 取消  a 归档  r 恢复  v 验收  d 差异  h 历史  / 搜索  ? 帮助  q 退出";

export function renderFrame(model: FrameModel): string {
  const cols = Math.max(40, model.cols);
  const rows = Math.max(12, model.rows);
  const lines: string[] = [];
  const banner = ` 巴别塔 TUI  ·  演示数据  ·  ${model.connected ? "已连接" : "断线（缓存）"}  ·  ${model.lastSync}`;
  lines.push(inverse(padWidth(banner, cols)));
  lines.push(padWidth(` 项目 ${model.projectName}   类型 ${typeText(model.typeFilter)}   设备 ${model.deviceLabel}   /${model.query || ""}`, cols));

  const bodyRows = rows - 5;
  if (cols < 100) {
    lines.push(...renderNarrow(model, cols, bodyRows));
  } else {
    lines.push(...renderBoard(model, cols, bodyRows));
  }

  while (lines.length < rows - 2) lines.push(padWidth("", cols));
  if (model.mode === "prompt") {
    lines.push(padWidth(` ${model.promptLabel ?? ""}`, cols));
    lines.push(inverse(padWidth(` > ${model.promptValue ?? ""}`, cols)));
  } else {
    lines.push(padWidth(` ${model.statusLine}`, cols));
    lines.push(dim(padWidth(` ${HELP}`, cols)));
  }
  return `\x1b[H\x1b[J${lines.slice(0, rows).join("\r\n")}`;
}

function renderBoard(model: FrameModel, cols: number, bodyRows: number): string[] {
  const detailWidth = Math.min(42, Math.max(28, Math.floor(cols * 0.32)));
  const boardWidth = cols - detailWidth - 1;
  const colW = Math.max(16, Math.floor(boardWidth / 4));
  const header = STAGE_ORDER.map((stage) => {
    const count = model.cards.filter((card) => card.stage === stage).length;
    return padWidth(`${STAGE_LABEL[stage]} ${count}`, colW);
  }).join("");
  const out = [padWidth(header + "│" + padWidth("详情", detailWidth), cols)];
  const columns = STAGE_ORDER.map((stage) => model.cards.filter((card) => card.stage === stage));
  const cardRows = Math.max(1, bodyRows - 1);
  for (let row = 0; row < cardRows; row += 1) {
    let line = "";
    for (const col of columns) {
      const card = col[row];
      line += card ? cardCell(card, colW, model.selectedId === card.trackerId) : padWidth("", colW);
    }
    const detail = model.detailLines[row] ?? "";
    out.push(padWidth(line + "│" + padWidth(detail, detailWidth), cols));
  }
  return out;
}

function renderNarrow(model: FrameModel, cols: number, bodyRows: number): string[] {
  const stages = STAGE_ORDER;
  const selected = model.cards.find((card) => card.trackerId === model.selectedId);
  const stage = selected?.stage ?? "TODO";
  const list = model.cards.filter((card) => card.stage === stage);
  const out = [padWidth(` 阶段 ${STAGE_LABEL[stage]}  ←/→ 切换   ${list.length} 条`, cols)];
  const listH = Math.max(3, Math.floor(bodyRows * 0.45));
  for (let i = 0; i < listH; i += 1) {
    const card = list[i];
    out.push(card ? cardCell(card, cols, model.selectedId === card.trackerId) : padWidth("", cols));
  }
  out.push(padWidth("─".repeat(Math.max(1, cols)), cols));
  const remain = bodyRows - listH - 2;
  for (let i = 0; i < remain; i += 1) {
    out.push(padWidth(model.detailLines[i] ?? "", cols));
  }
  return out;
}

function cardCell(card: TuiCard, width: number, selected: boolean): string {
  const mark = selected ? ">" : " ";
  const attn = card.runStatus ? ` ${runStatusText(card.runStatus as never)}` : "";
  const attnW = displayWidth(attn);
  const text = `${mark}${sliceByWidth(card.title, Math.max(1, width - 1 - attnW))}${attn}`;
  return selected ? inverse(padWidth(text, width)) : padWidth(text, width);
}

export function detailLines(card: TuiCard | undefined, extra: string[], width: number): string[] {
  if (!card) return wrapByWidth("未选中记录。", width);
  const head = [
    card.title,
    `${typeText(card.primaryType)} · ${card.status} · ${STAGE_LABEL[card.stage]} · rev ${card.revision}`,
    runStatusText(card.runStatus as never),
    `最后更新 ${card.lastUpdatedAt ?? "暂无记录"}`,
    card.description,
    ...extra,
  ];
  return wrapByWidth(head.filter(Boolean).join("\n"), width, 40);
}

function inverse(text: string): string {
  return `\x1b[7m${text}\x1b[27m`;
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`;
}

export const CYAN = "\x1b[36m";
export const DIM = "\x1b[2m";
export const GRN = "\x1b[32m";
export const RED = "\x1b[31m";
export const RST = "\x1b[0m";
export const INV = "\x1b[7m";
export const YEL = "\x1b[33m";

export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  id?: string;
}

export function hitAt(hits: HitRegion[], x: number, y: number): HitRegion | undefined {
  return hits.find((h) => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h);
}

export function cell(text: string, width: number, style = ""): string {
  return style + padWidth(text, width) + (style ? RST : "");
}

export function drawBox(title: string, body: string[], width: number, height: number, footer: string): string[] {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  lines.push("┌" + padWidth(sliceByWidth(` ${title} `, inner), inner) + "┐");
  const room = Math.max(1, height - 3);
  const padded = [...body];
  while (padded.length < room) padded.push("");
  for (let i = 0; i < room; i++) {
    lines.push("│" + padWidth(padded[i] ?? "", inner) + "│");
  }
  lines.push("└" + padWidth(sliceByWidth(footer, inner), inner) + "┘");
  return lines;
}

export function overlayOn(base: string[], box: string[], cols: number, rows: number): string[] {
  const h = box.length;
  const w = displayWidth(box[0] ?? "");
  const top = Math.max(1, Math.floor((rows - h) / 2));
  const left = Math.max(0, Math.floor((cols - w) / 2));
  const out = base.map((line) => line);
  for (let i = 0; i < box.length; i++) {
    const y = top + i;
    if (y < 0 || y >= out.length) continue;
    const raw = (out[y] ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    const leftPart = sliceByWidth(raw, left);
    const boxLine = box[i] ?? "";
    const remain = Math.max(0, cols - left - displayWidth(boxLine));
    out[y] = padWidth(padWidth(leftPart, left) + boxLine, left + displayWidth(boxLine) + remain);
    void remain;
  }
  return out;
}

export function helpLines(): string[] {
  return [
    "演示数据 · 键盘",
    "j/k 或方向  移动    Enter 选中/菜单    Esc 关闭",
    "n 新建  e 编辑  s 开始模拟  m 发消息/回答",
    "c 取消  a 归档  r 恢复  v 验收  o 操作菜单",
    "y 就绪  w 视图  l 关系  u/i 排序  g Hook",
    "x Google Tasks  z 合成节点  b 运维说明  f 本地 PDF（未接入/演示）",
    "d 差异  h 历史  / 搜索  1-4 阶段  p 项目  t 类型",
    "! 只看需要关注/全部任务（保留项目、类型、设备和搜索）",
    "鼠标单击选中，滚轮滚动。拖拽请改用菜单。",
    "状态用文字：等待输入、取消待确认、失联未核对。",
    "Ctrl+S 保存编辑。q 退出（恢复终端，不取消 run）。",
  ];
}

export function footerLine(cols: number, status: string, error: string | null, narrow: boolean): string {
  const keys = narrow
    ? "j/k 移动  Enter 菜单  ! 关注  y 就绪  w 视图  g Hook  ? 帮助  q 退出"
    : "j/k 移动  Enter 菜单  ! 关注  y 就绪  w 视图  g Hook  x/z/b/f 后续  ? 帮助  q 退出";
  const note = error ? ` ${error}` : status ? ` ${status}` : "";
  return padWidth(sliceByWidth(keys + note, cols), cols);
}

export function stageTabs(counts: Record<Stage, number>, current: Stage, width: number): string {
  const parts = STAGE_ORDER.map((stage) => {
    const label = `${STAGE_LABEL[stage]} ${counts[stage] ?? 0}`;
    return stage === current ? `[${label}]` : ` ${label} `;
  });
  return padWidth(parts.join(" "), width);
}

export function splitCardLines(card: TuiCard, width: number, selected: boolean): string[] {
  return [cardCell(card, width, selected)];
}

export type CardView = TuiCard;
