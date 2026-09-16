import { stdin, stdout } from "node:process";
import {
  BabelError,
  DEFAULT_PROJECT_ID,
  DEMO_ACTOR,
  NATIVE_TYPES,
  type BabelEvent,
  type CommandName,
  type DeviceRecord,
  type ProjectRecord,
  type RunRecord,
  type SavedView,
  type Stage,
  type TrackerRecord,
} from "../contracts.ts";
import { TuiHttp } from "./http.ts";
import { InputDecoder, type KeyEvent } from "./input.ts";
import { STAGE_LABEL, STAGE_ORDER, attentionFilterText, runStatusText, typeText } from "./labels.ts";
import {
  CYAN,
  DIM,
  GRN,
  RED,
  RST,
  cell,
  drawBox,
  footerLine,
  helpLines,
  hitAt,
  overlayOn,
  splitCardLines,
  stageTabs,
  type CardView,
  type HitRegion,
} from "./render.ts";
import { terminalSize, TtySession } from "./tty.ts";
import { displayWidth, padWidth, sliceByWidth, wrapByWidth } from "./width.ts";
import {
  SURFACE_MENU_ITEMS,
  firstSurfaceMenuIndex,
  handleSurfaceKey,
  isSurfaceMenuId,
  openSurface,
  surfaceHelpLines,
  surfaceShortcutId,
  type SurfaceOverlay,
} from "./surfaces.ts";

interface TaskCard extends CardView {
  deviceId: string | null;
  executionEnabled: boolean;
  archived?: boolean;
  readOnly?: boolean;
}

interface Detail {
  record: TrackerRecord;
  stage: Stage;
  latestRun: RunRecord | null;
  card: TaskCard;
}

type ActionCapability = { allowed: boolean; reason?: string; code?: string };

interface HookRow {
  hookId: string;
  phase: string;
}

interface OutboxRow {
  deliveryId: string;
  hookId: string;
  status: string;
  attempts: number;
  lastError?: string;
}

interface DeliveryRow {
  deliveryId: string;
  hookId?: string;
  ok: boolean;
  error?: string;
}

type Overlay =
  | { kind: "none" }
  | { kind: "help" }
  | { kind: "menu"; index: number }
  | { kind: "edit"; title: string; body: string; field: "title" | "body"; revision: number; projectId: string; trackerId: string; saving: boolean }
  | { kind: "fields"; priority: string; owner: string; tags: string; field: "priority" | "owner" | "tags"; revision: number; projectId: string; trackerId: string; saving: boolean }
  | { kind: "create"; title: string; body: string; field: "title" | "body" }
  | { kind: "message"; text: string; respondId?: string }
  | { kind: "search" }
  | { kind: "confirm"; action: "archive" | "cancel" | "restore" | "accept" | "changes" }
  | { kind: "reconcile"; projectId: string; trackerId: string; runId: string; title: string; revision: number; status: "lost" | "cancel_requested"; resolution: "cancelled" | "failed" }
  | { kind: "diff"; text: string }
  | { kind: "history"; text: string }
  | { kind: "ready"; index: number; items: TaskCard[] }
  | { kind: "views"; index: number; views: SavedView[] }
  | { kind: "viewsave"; name: string }
  | { kind: "relation"; field: "dependsOn" | "blocks"; dependsOn: string; blocks: string }
  | {
    kind: "hooks";
    tab: "hooks" | "outbox";
    index: number;
    hooks: HookRow[];
    outbox: OutboxRow[];
    deliveries: DeliveryRow[];
    canRegister: boolean;
    canRetry: boolean;
  }
  | { kind: "hookregister"; field: "hookId" | "phase" | "executable"; hookId: string; phase: string; executable: string }
  | SurfaceOverlay;

export interface TuiInspect {
  overlay: Overlay["kind"];
  overlayIndex?: number;
  overlayTab?: string;
  overlayRevision?: number;
  selectedId: string | null;
  selectedRunId: string | null;
  viewId: string | null;
  projectId: string;
  connected: boolean;
  status: string;
  error: string | null;
  cursor: string;
  items: TaskCard[];
  menuItems: Array<{ id: string; label: string }>;
  hits: HitRegion[];
  frame: string;
  cols: number;
  rows: number;
  canRegisterHook: boolean;
  canRetryDelivery: boolean;
  surfaceId?: string;
  surfaceLines?: string[];
}

const TYPE_CYCLE = ["executable", "all", ...NATIVE_TYPES];

export interface TuiOptions {
  endpoint?: string;
  projectId?: string;
  profile?: string;
  http?: TuiHttp;
  headless?: boolean;
  cols?: number;
  rows?: number;
}

export class BabelTui {
  private readonly http: TuiHttp;
  private readonly tty = new TtySession(() => this.quit());
  private readonly decoder = new InputDecoder();
  private projectId: string;
  private projects: ProjectRecord[] = [];
  private devices: DeviceRecord[] = [];
  private deviceFilter: string | null = null;
  private typeFilter = "executable";
  private attentionOnly = false;
  private stage: Stage = "TODO";
  private selectedId: string | null = null;
  private selectedRunId: string | null = null;
  private items: TaskCard[] = [];
  private counts: Record<Stage, number> = { TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 };
  private detail: Detail | null = null;
  private cursor = "0";
  private connected = false;
  private status = "正在连接演示服务…";
  private error: string | null = null;
  private overlay: Overlay = { kind: "none" };
  private search = "";
  private listScroll = 0;
  private detailScroll = 0;
  private running = false;
  private watch: { close: () => void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hits: HitRegion[] = [];
  private dirty = true;
  private readonly profileHint?: string;
  private readonly headless: boolean;
  private viewId: string | null = null;
  private caps: Record<string, ActionCapability> = {};
  private viewport: { cols: number; rows: number };
  private lastFrame = "";

  constructor(options: TuiOptions = {}) {
    this.http = options.http ?? new TuiHttp({
      endpoint: options.endpoint,
      actor: { ...DEMO_ACTOR, kind: "tui" },
    });
    this.projectId = options.projectId ?? DEFAULT_PROJECT_ID;
    this.profileHint = options.profile;
    this.headless = Boolean(options.headless);
    this.viewport = {
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
    };
  }

  async boot(): Promise<void> {
    this.running = true;
    await this.loadAll();
    this.paint();
  }

  feed(raw: string): void {
    for (const ev of this.decoder.push(raw)) this.handleEvent(ev);
    this.paint();
  }

  feedEvent(ev: KeyEvent): void {
    this.handleEvent(ev);
    this.paint();
  }

  resize(cols: number, rows: number): void {
    this.viewport = { cols, rows };
    this.dirty = true;
    this.paint();
  }

  async reconnectNow(): Promise<void> {
    await this.reconnect();
  }

  dispose(): void {
    this.running = false;
    this.watch?.close();
    this.watch = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (!this.headless) this.tty.restore();
  }

  inspect(): TuiInspect {
    if (this.dirty && this.running) this.paint();
    const overlay = this.overlay;
    return {
      overlay: overlay.kind,
      overlayIndex: "index" in overlay ? overlay.index : undefined,
      overlayTab: overlay.kind === "hooks" ? overlay.tab : undefined,
      overlayRevision: (overlay.kind === "edit" || overlay.kind === "fields") ? overlay.revision : undefined,
      selectedId: this.selectedId,
      selectedRunId: this.selectedRunId,
      viewId: this.viewId,
      projectId: this.projectId,
      connected: this.connected,
      status: this.status,
      error: this.error,
      cursor: this.cursor,
      items: this.items,
      menuItems: this.menuItems(),
      hits: this.hits,
      frame: this.lastFrame,
      cols: this.size().cols,
      rows: this.size().rows,
      canRegisterHook: this.actionAllowed("hook.register"),
      canRetryDelivery: this.actionAllowed("hook.retry_delivery"),
      surfaceId: overlay.kind === "surface" ? overlay.id : undefined,
      surfaceLines: overlay.kind === "surface" ? overlay.lines : undefined,
    };
  }

  async run(): Promise<void> {
    this.tty.enter();
    this.running = true;
    stdin.on("data", (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const ev of this.decoder.push(text)) this.handleEvent(ev);
      this.paint();
    });
    stdout.on("resize", () => {
      this.dirty = true;
      this.paint();
    });
    await this.loadAll();
    this.subscribe();
    this.paint();
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (!this.running) {
          clearInterval(tick);
          resolve();
        } else if (this.dirty) {
          this.paint();
        }
      }, 80);
    });
  }

  private quit(): void {
    this.dispose();
  }

  private size(): { cols: number; rows: number } {
    if (this.headless) return this.viewport;
    const live = terminalSize();
    return {
      cols: live.cols || this.viewport.cols,
      rows: live.rows || this.viewport.rows,
    };
  }

  private setCursorVisible(show: boolean): void {
    if (!this.headless) this.tty.showCursor(show);
  }

  private actionAllowed(name: CommandName): boolean {
    return this.caps[name]?.allowed !== false;
  }

  private actionDenied(name: CommandName): string {
    const cap = this.caps[name];
    if (cap && !cap.allowed) {
      return `${cap.code ?? "PERMISSION"}: ${cap.reason ?? "当前不可用"}`;
    }
    return `${name} 当前不可用`;
  }

  private async loadAll(): Promise<void> {
    try {
      const [projects, devices, list] = await Promise.all([
        this.http.query<{ projects: ProjectRecord[] }>({ name: "project.list" }),
        this.http.query<{ devices: DeviceRecord[] }>({ name: "device.list", projectId: this.projectId }),
        this.http.query<{ items: TaskCard[]; counts: Record<Stage, number>; cursor: string }>({
          name: "task.list",
          projectId: this.projectId,
          input: this.listInput(),
        }),
      ]);
      this.projects = projects.projects;
      this.devices = devices.devices;
      this.items = list.items;
      this.counts = list.counts;
      this.cursor = String(list.cursor ?? this.cursor);
      this.connected = true;
      this.error = null;
      this.status = this.profileHint
        ? `演示数据 · profile ${this.profileHint} 仅作提示，已连接 ${this.http.endpoint}`
        : `演示数据 · ${this.http.endpoint}`;
      this.ensureSelection();
      await this.refreshDetail();
      await this.refreshCaps();
    } catch (error) {
      this.connected = false;
      this.error = error instanceof BabelError ? `${error.code}: ${error.message}` : "无法连接演示服务";
      this.status = "已断线，将重拉快照与游标，不会新开 run";
    }
    this.dirty = true;
  }

  private listInput(): Record<string, unknown> {
    const input: Record<string, unknown> = {
      includeArchived: true,
      q: this.search,
    };
    if (this.viewId) input.viewId = this.viewId;
    if (this.typeFilter === "all") {
      input.types = "all";
      input.includeSemantic = true;
    } else if (this.typeFilter === "executable") {
      input.types = "executable";
    } else {
      input.types = [this.typeFilter];
      input.includeSemantic = true;
    }
    if (this.deviceFilter) input.deviceId = this.deviceFilter;
    if (this.attentionOnly) input.attentionOnly = true;
    return input;
  }

  private async refreshCaps(): Promise<void> {
    try {
      const data = await this.http.query<{ actions?: Record<string, ActionCapability> }>({
        name: "capabilities.get",
        projectId: this.projectId,
        input: {
          ...(this.selectedId ? { trackerId: this.selectedId } : {}),
          ...(this.selectedRunId ? { runId: this.selectedRunId } : {}),
        },
      });
      this.caps = data.actions ?? {};
    } catch {
      // 保留上次能力快照
    }
  }

  private ensureSelection(): void {
    if (this.selectedId && this.items.some((row) => row.trackerId === this.selectedId)) return;
    const inStage = this.items.filter((row) => row.stage === this.stage);
    const fallback = inStage[0] ?? this.items[0];
    this.selectedId = fallback?.trackerId ?? null;
    this.selectedRunId = fallback?.latestRunId ?? null;
  }

  private async refreshDetail(): Promise<void> {
    if (!this.selectedId) {
      this.detail = null;
      return;
    }
    try {
      this.detail = await this.http.query<Detail>({
        name: "task.get",
        projectId: this.projectId,
        input: { trackerId: this.selectedId },
      });
      this.selectedRunId = this.detail.latestRun?.id ?? this.detail.card.latestRunId ?? null;
    } catch (error) {
      if (error instanceof BabelError && error.code === "NOT_FOUND") {
        this.detail = null;
        return;
      }
      this.error = error instanceof BabelError ? `${error.code}: ${error.message}` : String(error);
    }
  }

  private subscribe(): void {
    this.watch?.close();
    this.watch = this.http.watchEvents(this.projectId, this.cursor, (event) => this.onEvent(event), (error) => {
      this.connected = false;
      this.status = "事件流中断，重拉快照后恢复同一项目/记录";
      if (error instanceof BabelError) this.error = `${error.code}: ${error.message}`;
      this.scheduleReconnect();
      this.dirty = true;
    });
    this.connected = true;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.running) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, 800);
  }

  private async reconnect(): Promise<void> {
    if (!this.running) return;
    await this.loadAll();
    this.subscribe();
    this.paint();
  }

  private onEvent(event: BabelEvent): void {
    this.cursor = event.cursor || this.cursor;
    this.connected = true;
    if (this.overlay.kind === "edit" || this.overlay.kind === "create" || this.overlay.kind === "message" || this.overlay.kind === "search") {
      void this.refreshQuiet();
      return;
    }
    void this.refreshQuiet();
  }

  private async refreshQuiet(): Promise<void> {
    const projectId = this.projectId;
    const input = this.listInput();
    try {
      const list = await this.http.query<{ items: TaskCard[]; counts: Record<Stage, number>; cursor: string }>({
        name: "task.list",
        projectId,
        input,
      });
      if (projectId !== this.projectId || JSON.stringify(input) !== JSON.stringify(this.listInput())) return;
      this.items = list.items;
      this.counts = list.counts;
      if (list.cursor) this.cursor = String(list.cursor);
      this.ensureSelection();
      await this.refreshDetail();
      this.dirty = true;
    } catch {
      this.connected = false;
    }
  }

  private handleEvent(ev: KeyEvent): void {
    if (ev.type === "key" && (ev.name === "ctrl-c" || ev.name === "q") && this.overlay.kind === "none") {
      this.quit();
      return;
    }
    if (ev.type === "mouse") {
      this.handleMouse(ev);
      return;
    }
    if (this.overlay.kind !== "none" && this.overlay.kind !== "search") {
      this.handleOverlay(ev);
      return;
    }
    if (this.overlay.kind === "search") {
      this.handleSearch(ev);
      return;
    }
    if (ev.type === "key") this.handleBoardKey(ev.name);
    if (ev.type === "text") {
      if (ev.text === "?") this.overlay = { kind: "help" };
      else if (ev.text === "!") void this.toggleAttention();
      else if (ev.text === "/") this.overlay = { kind: "search" };
      else if (ev.text === "j") this.move(1);
      else if (ev.text === "k") this.move(-1);
      else if (ev.text === "n") this.beginCreate();
      else if (ev.text === "e") this.beginEdit();
      else if (ev.text === "F") this.beginFields();
      else if (ev.text === "s") void this.startRun();
      else if (ev.text === "m") this.beginMessage();
      else if (ev.text === "c") this.overlay = { kind: "confirm", action: "cancel" };
      else if (ev.text === "a") this.overlay = { kind: "confirm", action: "archive" };
      else if (ev.text === "r") this.overlay = { kind: "confirm", action: "restore" };
      else if (ev.text === "v") this.overlay = { kind: "confirm", action: "accept" };
      else if (ev.text === "d") void this.showDiff();
      else if (ev.text === "h") void this.showHistory();
      else if (ev.text === "o") this.overlay = { kind: "menu", index: 0 };
      else if (ev.text === "p") void this.cycleProject();
      else if (ev.text === "t") void this.cycleType();
      else if (ev.text === "y") void this.showReady();
      else if (ev.text === "w") void this.showViews();
      else if (ev.text === "l") void this.beginRelation();
      else if (ev.text === "u") void this.reorderSelected(-1);
      else if (ev.text === "i") void this.reorderSelected(1);
      else if (ev.text === "g") void this.showHooks();
      else if (surfaceShortcutId(ev.text)) this.overlay = openSurface(surfaceShortcutId(ev.text)!);
      else if (ev.text === "1") this.setStage("TODO");
      else if (ev.text === "2") this.setStage("RUNNING");
      else if (ev.text === "3") this.setStage("DONE");
      else if (ev.text === "4") this.setStage("ARCHIVED");
      else if (ev.text === "q") this.quit();
    }
    this.dirty = true;
  }

  private handleBoardKey(name: string): void {
    if (name === "up") this.move(-1);
    else if (name === "down") this.move(1);
    else if (name === "left") this.shiftStage(-1);
    else if (name === "right") this.shiftStage(1);
    else if (name === "enter") this.overlay = { kind: "menu", index: 0 };
    else if (name === "escape") this.error = null;
    else if (name === "pageup") this.move(-5);
    else if (name === "pagedown") this.move(5);
    this.dirty = true;
  }

  private handleSearch(ev: KeyEvent): void {
    if (ev.type === "key" && (ev.name === "escape" || ev.name === "enter")) {
      this.overlay = { kind: "none" };
      // A quick Enter + action must never target the pre-search selection.
      this.selectedId = null;
      this.selectedRunId = null;
      this.detail = null;
      this.caps = {};
      void this.refreshQuiet();
      return;
    }
    if (ev.type === "key" && ev.name === "backspace") {
      this.search = this.search.slice(0, -1);
    }
    if (ev.type === "text") this.search += ev.text;
    if (ev.type === "paste") this.search += ev.text;
    this.dirty = true;
  }

  private handleOverlay(ev: KeyEvent): void {
    const o = this.overlay;
    if ((o.kind === "edit" || o.kind === "fields") && o.saving) return;
    if (ev.type === "key" && ev.name === "escape") {
      this.overlay = { kind: "none" };
      this.setCursorVisible(false);
      this.dirty = true;
      return;
    }
    if (o.kind === "help" && ((ev.type === "key" && (ev.name === "enter" || ev.name === "q")) || (ev.type === "text" && (ev.text === "q" || ev.text === "?")))) {
      this.overlay = { kind: "none" };
      return;
    }
    if (o.kind === "menu") {
      const items = this.menuItems();
      if (ev.type === "key" && ev.name === "up") o.index = (o.index + items.length - 1) % items.length;
      if (ev.type === "key" && ev.name === "down") o.index = (o.index + 1) % items.length;
      if (ev.type === "text" && ev.text === "k") o.index = (o.index + items.length - 1) % items.length;
      if (ev.type === "text" && ev.text === "j") o.index = (o.index + 1) % items.length;
      if ((ev.type === "key" && ev.name === "enter") || (ev.type === "text" && ev.text === "\r")) {
        void this.runMenu(items[o.index]?.id ?? "");
      }
      this.dirty = true;
      return;
    }
    if (o.kind === "confirm") {
      if ((ev.type === "key" && ev.name === "enter") || (ev.type === "text" && (ev.text === "y" || ev.text === "Y"))) {
        void this.runConfirm(o.action);
      }
      if (ev.type === "text" && (ev.text === "n" || ev.text === "N")) this.overlay = { kind: "none" };
      this.dirty = true;
      return;
    }
    if (o.kind === "reconcile") {
      if (ev.type === "key" && (ev.name === "tab" || ev.name === "left" || ev.name === "right")) {
        o.resolution = o.resolution === "cancelled" ? "failed" : "cancelled";
      } else if ((ev.type === "key" && ev.name === "enter") || (ev.type === "text" && (ev.text === "y" || ev.text === "Y"))) {
        void this.confirmReconcile(o);
      } else if (ev.type === "text" && (ev.text === "n" || ev.text === "N")) this.overlay = { kind: "none" };
      this.dirty = true;
      return;
    }
    if (o.kind === "ready" || o.kind === "views" || o.kind === "hooks") {
      this.handleListOverlay(ev, o);
      return;
    }
    if (o.kind === "viewsave") {
      if (ev.type === "key" && ev.name === "ctrl-s") {
        void this.saveView(o.name);
        return;
      }
      if (ev.type === "key" && ev.name === "enter") {
        void this.saveView(o.name);
        return;
      }
      if (ev.type === "key" && ev.name === "backspace") o.name = o.name.slice(0, -1);
      if (ev.type === "text") o.name += ev.text;
      if (ev.type === "paste") o.name += ev.text;
      this.dirty = true;
      return;
    }
    if (o.kind === "fields") {
      this.setCursorVisible(true);
      if (ev.type === "key" && ev.name === "ctrl-s") {
        void this.saveFields(o);
        return;
      }
      if (ev.type === "key" && (ev.name === "tab" || ev.name === "enter")) {
        o.field = o.field === "priority" ? "owner" : o.field === "owner" ? "tags" : "priority";
      } else if (ev.type === "key" && ev.name === "backspace") {
        o[o.field] = Array.from(o[o.field]).slice(0, -1).join("");
      } else if (ev.type === "text" || ev.type === "paste") {
        o[o.field] += ev.text.replace(/[\r\n]/g, " ");
      }
      this.dirty = true;
      return;
    }
    if (o.kind === "relation") {
      this.setCursorVisible(true);
      if (ev.type === "key" && ev.name === "ctrl-s") {
        void this.saveRelation();
        return;
      }
      if (ev.type === "key" && ev.name === "tab") {
        o.field = o.field === "dependsOn" ? "blocks" : "dependsOn";
      }
      if (ev.type === "key" && ev.name === "backspace") {
        if (o.field === "dependsOn") o.dependsOn = o.dependsOn.slice(0, -1);
        else o.blocks = o.blocks.slice(0, -1);
      }
      if (ev.type === "text") {
        if (o.field === "dependsOn") o.dependsOn += ev.text;
        else o.blocks += ev.text;
      }
      if (ev.type === "paste") {
        if (o.field === "dependsOn") o.dependsOn += ev.text;
        else o.blocks += ev.text;
      }
      this.dirty = true;
      return;
    }
    if (o.kind === "surface") {
      this.overlay = handleSurfaceKey(ev, o);
      this.dirty = true;
      return;
    }
    if (o.kind === "hookregister") {
      this.setCursorVisible(true);
      if (ev.type === "key" && ev.name === "ctrl-s") {
        void this.submitHookRegister();
        return;
      }
      if (ev.type === "key" && ev.name === "tab") {
        o.field = o.field === "hookId" ? "phase" : o.field === "phase" ? "executable" : "hookId";
      }
      if (ev.type === "key" && ev.name === "enter" && o.field === "phase") {
        o.phase = o.phase === "beforeCommand" ? "observe" : "beforeCommand";
        this.dirty = true;
        return;
      }
      if (ev.type === "key" && ev.name === "backspace") {
        if (o.field === "hookId") o.hookId = o.hookId.slice(0, -1);
        else if (o.field === "executable") o.executable = o.executable.slice(0, -1);
      }
      if (ev.type === "text") {
        if (o.field === "hookId") o.hookId += ev.text;
        else if (o.field === "executable") o.executable += ev.text;
      }
      if (ev.type === "paste") {
        if (o.field === "hookId") o.hookId += ev.text;
        else if (o.field === "executable") o.executable += ev.text;
      }
      this.dirty = true;
      return;
    }
    if (o.kind === "edit" || o.kind === "create" || o.kind === "message") {
      this.setCursorVisible(true);
      if (ev.type === "key" && ev.name === "ctrl-s") {
        void this.saveOverlay();
        return;
      }
      if (ev.type === "key" && ev.name === "tab") {
        if (o.kind === "edit" || o.kind === "create") o.field = o.field === "title" ? "body" : "title";
      }
      if (ev.type === "key" && ev.name === "enter") {
        if (o.kind === "message") {
          void this.saveOverlay();
          return;
        }
        if (o.field === "title") o.field = "body";
        else this.appendOverlayText("\n");
      }
      if (ev.type === "key" && ev.name === "backspace") this.backspaceOverlay();
      if (ev.type === "text") this.appendOverlayText(ev.text);
      if (ev.type === "paste") this.appendOverlayText(ev.text);
      this.dirty = true;
    }
  }

  private handleListOverlay(ev: KeyEvent, o: Extract<Overlay, { kind: "ready" | "views" | "hooks" }>): void {
    const count = o.kind === "ready"
      ? o.items.length
      : o.kind === "views"
        ? o.views.length
        : o.tab === "hooks" ? o.hooks.length : o.outbox.length;
    const len = Math.max(1, count);
    if (ev.type === "key" && ev.name === "up" || (ev.type === "text" && ev.text === "k")) {
      o.index = (o.index + len - 1) % len;
    }
    if (ev.type === "key" && ev.name === "down" || (ev.type === "text" && ev.text === "j")) {
      o.index = (o.index + 1) % len;
    }
    if (o.kind === "hooks" && ev.type === "key" && ev.name === "tab") {
      o.tab = o.tab === "hooks" ? "outbox" : "hooks";
      o.index = 0;
    }
    if (o.kind === "hooks" && ev.type === "text" && ev.text === "n") {
      void this.beginHookRegister();
      return;
    }
    if ((ev.type === "key" && ev.name === "enter") || (ev.type === "text" && ev.text === "\r")) {
      if (o.kind === "ready") void this.pickReady(o.items[o.index]);
      if (o.kind === "views") void this.applyView(o.views[o.index]);
      if (o.kind === "hooks" && o.tab === "outbox") void this.retryDelivery(o.outbox[o.index]);
    }
    if (o.kind === "views" && ev.type === "text" && ev.text === "s") {
      this.beginViewSave();
    }
    this.dirty = true;
  }

  private appendOverlayText(text: string): void {
    const o = this.overlay;
    if (o.kind === "edit" || o.kind === "create") {
      if (o.field === "title") o.title += text.replace(/\n/g, " ");
      else o.body += text;
    }
    if (o.kind === "message") o.text += text;
  }

  private backspaceOverlay(): void {
    const o = this.overlay;
    if (o.kind === "edit" || o.kind === "create") {
      if (o.field === "title") o.title = o.title.slice(0, -1);
      else o.body = o.body.slice(0, -1);
    }
    if (o.kind === "message") o.text = o.text.slice(0, -1);
  }

  private handleMouse(ev: Extract<KeyEvent, { type: "mouse" }>): void {
    const x = ev.x - 1;
    const y = ev.y - 1;
    ev = { ...ev, x, y };
    if (ev.kind === "wheel") {
      if (this.overlay.kind === "none") this.move(ev.wheel);
      return;
    }
    if (ev.kind !== "down") return;
    if (this.overlay.kind !== "none" && this.overlay.kind !== "search") {
      if (this.overlay.kind === "menu") {
        const items = this.menuItems();
        const hit = hitAt(this.hits, ev.x, ev.y);
        if (hit?.action === "menu" && hit.id) void this.runMenu(hit.id);
        else if (hit?.action === "menuitem" && hit.id) {
          const idx = Number(hit.id);
          if (items[idx]) void this.runMenu(items[idx].id);
        }
      } else if (this.overlay.kind === "ready" || this.overlay.kind === "views" || this.overlay.kind === "hooks") {
        const hit = hitAt(this.hits, ev.x, ev.y);
        if (hit?.action === "menuitem" && hit.id) {
          const idx = Number(hit.id);
          if (this.overlay.kind === "ready") void this.pickReady(this.overlay.items[idx]);
          if (this.overlay.kind === "views") void this.applyView(this.overlay.views[idx]);
          if (this.overlay.kind === "hooks" && this.overlay.tab === "outbox") {
            void this.retryDelivery(this.overlay.outbox[idx]);
          }
        }
      }
      return;
    }
    const hit = hitAt(this.hits, ev.x, ev.y);
    if (!hit) return;
    if (hit.action === "ready") void this.showReady();
    if (hit.action === "views") void this.showViews();
    if (hit.action === "hooks") void this.showHooks();
    if (hit.action === "surfaces") {
      this.overlay = { kind: "menu", index: firstSurfaceMenuIndex(this.menuItems()) };
    }
    if (hit.action === "card" && hit.id) {
      this.selectedId = hit.id;
      const card = this.items.find((row) => row.trackerId === hit.id);
      if (card) this.stage = card.stage;
      void this.refreshDetail();
    }
    if (hit.action === "stage" && hit.id) this.setStage(hit.id as Stage);
    if (hit.action === "project") void this.cycleProject();
    if (hit.action === "type") void this.cycleType();
    if (hit.action === "attention") void this.toggleAttention();
    if (hit.action === "device") this.cycleDevice();
    this.dirty = true;
  }

  private visibleCards(): TaskCard[] {
    return this.items.filter((row) => row.stage === this.stage);
  }

  private move(delta: number): void {
    const list = this.visibleCards();
    if (list.length === 0) return;
    const idx = Math.max(0, list.findIndex((row) => row.trackerId === this.selectedId));
    const next = list[(idx + delta + list.length * 8) % list.length];
    if (!next) return;
    this.selectedId = next.trackerId;
    this.selectedRunId = next.latestRunId;
    void this.refreshDetail();
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    const list = this.visibleCards();
    if (list.length && !list.some((row) => row.trackerId === this.selectedId)) {
      this.selectedId = list[0]?.trackerId ?? this.selectedId;
      void this.refreshDetail();
    }
  }

  private shiftStage(delta: number): void {
    const i = STAGE_ORDER.indexOf(this.stage);
    this.setStage(STAGE_ORDER[(i + delta + STAGE_ORDER.length) % STAGE_ORDER.length] ?? "TODO");
  }

  private async cycleProject(): Promise<void> {
    if (this.projects.length === 0) return;
    const i = this.projects.findIndex((row) => row.id === this.projectId);
    const next = this.projects[(i + 1) % this.projects.length];
    if (!next) return;
    this.projectId = next.id;
    this.selectedId = null;
    this.watch?.close();
    await this.loadAll();
    this.subscribe();
  }

  private async cycleType(): Promise<void> {
    const i = TYPE_CYCLE.indexOf(this.typeFilter);
    this.typeFilter = TYPE_CYCLE[(i + 1) % TYPE_CYCLE.length] ?? "executable";
    this.viewId = null;
    await this.refreshQuiet();
  }

  private cycleDevice(): void {
    const ids = [null, ...this.devices.map((row) => row.id)];
    const i = ids.indexOf(this.deviceFilter);
    this.deviceFilter = ids[(i + 1) % ids.length] ?? null;
    void this.refreshQuiet();
  }

  private async toggleAttention(): Promise<void> {
    this.attentionOnly = !this.attentionOnly;
    this.selectedId = null;
    this.selectedRunId = null;
    this.detail = null;
    this.caps = {};
    this.items = [];
    this.counts = { TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 };
    await this.refreshQuiet();
    const selected = this.items.find((card) => card.trackerId === this.selectedId);
    if (selected) this.stage = selected.stage;
    this.dirty = true;
  }

  private beginCreate(): void {
    this.overlay = { kind: "create", title: "", body: "", field: "title" };
    this.setCursorVisible(true);
  }

  private beginEdit(): void {
    const rec = this.detail?.record;
    if (!rec) {
      this.error = "没有选中记录";
      return;
    }
    this.overlay = {
      kind: "edit",
      projectId: this.projectId,
      trackerId: rec.id,
      saving: false,
      title: String(rec.fields.title ?? ""),
      body: String(rec.fields.description ?? rec.content.markdown ?? ""),
      field: "title",
      revision: rec.revision,
    };
    this.setCursorVisible(true);
  }

  private beginFields(): void {
    const rec = this.detail?.record;
    if (!rec) {
      this.error = "没有选中记录";
      return;
    }
    if (rec.system.readOnly) {
      this.error = "READ_ONLY: 当前记录只读，无法编辑字段";
      return;
    }
    this.error = null;
    this.overlay = {
      kind: "fields", projectId: this.projectId, trackerId: rec.id,
      revision: rec.revision, saving: false, field: "priority",
      priority: String(rec.fields.priority ?? ""), owner: String(rec.fields.owner ?? ""),
      tags: Array.isArray(rec.fields.tags) ? rec.fields.tags.join(", ") : "",
    };
    this.setCursorVisible(true);
  }

  private async saveFields(o: Extract<Overlay, { kind: "fields" }>): Promise<void> {
    if (o.saving) return;
    if (o.projectId !== this.projectId) {
      this.error = "PRECONDITION: 所属项目已改变，本次未保存；请复制草稿后重新选择原任务";
      return;
    }
    if (!Number.isFinite(o.revision)) {
      this.error = "USAGE: 保存需要当前 revision";
      return;
    }
    o.saving = true;
    this.setCursorVisible(false);
    const saved = await this.command("task.update", {
      trackerId: o.trackerId, priority: o.priority, owner: o.owner,
      tags: o.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
    }, o.revision);
    o.saving = false;
    if (saved) this.overlay = { kind: "none" };
    else this.setCursorVisible(true);
    this.dirty = true;
  }

  private beginMessage(): void {
    const run = this.detail?.latestRun;
    const pending = run?.inputRequests.find((row) => !row.answered);
    this.overlay = { kind: "message", text: "", respondId: pending?.id };
    this.setCursorVisible(true);
  }

  private menuItems(): Array<{ id: string; label: string }> {
    const run = this.detail?.latestRun;
    const items = [
      { id: "edit", label: "e  编辑标题和正文" },
      { id: "fields", label: "F  编辑优先级、负责人和标签" },
      { id: "create", label: "n  新建条目" },
      { id: "start", label: "s  开始模拟" },
      { id: "message", label: run?.status === "waiting_input" ? "m  回答待答请求" : "m  发送消息" },
      { id: "cancel", label: "c  取消执行" },
      ...(run?.status === "lost" || run?.status === "cancel_requested"
        ? [{ id: "reconcile", label: `   终止核对（${runStatusText(run.status)}）` }] : []),
      { id: "archive", label: "a  归档" },
      { id: "restore", label: "r  恢复（不自动重跑）" },
      { id: "accept", label: "v  验收" },
      { id: "changes", label: "   要求修改" },
      { id: "diff", label: "d  查看差异" },
      { id: "history", label: "h  查看历史" },
      { id: "attention", label: this.attentionOnly ? "!  显示全部任务" : "!  只看需要关注" },
      { id: "ready", label: "y  查看就绪" },
      { id: "views", label: "w  已保存视图" },
      { id: "viewsave", label: "   保存当前筛选为视图" },
      { id: "relation", label: "l  设置依赖关系" },
      { id: "reorder-up", label: "u  上移（列内排序）" },
      { id: "reorder-down", label: "i  下移（列内排序）" },
      { id: "hooks", label: "g  Hook 与投递" },
      ...SURFACE_MENU_ITEMS,
    ];
    return items;
  }

  private async runMenu(id: string): Promise<void> {
    this.overlay = { kind: "none" };
    if (id === "edit") this.beginEdit();
    else if (id === "fields") this.beginFields();
    else if (id === "create") this.beginCreate();
    else if (id === "start") await this.startRun();
    else if (id === "message") this.beginMessage();
    else if (id === "cancel") this.overlay = { kind: "confirm", action: "cancel" };
    else if (id === "archive") this.overlay = { kind: "confirm", action: "archive" };
    else if (id === "restore") this.overlay = { kind: "confirm", action: "restore" };
    else if (id === "accept") this.overlay = { kind: "confirm", action: "accept" };
    else if (id === "changes") this.overlay = { kind: "confirm", action: "changes" };
    else if (id === "diff") await this.showDiff();
    else if (id === "history") await this.showHistory();
    else if (id === "attention") await this.toggleAttention();
    else if (id === "ready") await this.showReady();
    else if (id === "views") await this.showViews();
    else if (id === "viewsave") this.beginViewSave();
    else if (id === "relation") this.beginRelation();
    else if (id === "reorder-up") await this.reorderSelected(-1);
    else if (id === "reorder-down") await this.reorderSelected(1);
    else if (id === "hooks") await this.showHooks();
    else if (isSurfaceMenuId(id)) this.overlay = openSurface(id);
    else if (id === "reconcile") this.beginReconcile();
    this.dirty = true;
  }

  private beginReconcile(): void {
    const record = this.detail?.record;
    const run = this.detail?.latestRun;
    if (!record || !run || record.id !== this.selectedId || run.id !== this.selectedRunId
      || (run.status !== "lost" && run.status !== "cancel_requested")) {
      this.error = "PRECONDITION: 只有失联或取消待确认的执行需要核对";
      return;
    }
    if (!this.actionAllowed("run.reconcile")) {
      this.error = this.actionDenied("run.reconcile");
      return;
    }
    this.overlay = {
      kind: "reconcile", projectId: this.projectId, trackerId: record.id, runId: run.id,
      title: record.fields.title, revision: record.revision, status: run.status, resolution: "cancelled",
    };
  }

  private async confirmReconcile(target: Extract<Overlay, { kind: "reconcile" }>): Promise<void> {
    this.overlay = { kind: "none" };
    if (target.projectId !== this.projectId || target.trackerId !== this.selectedId || target.runId !== this.selectedRunId) {
      this.error = "PRECONDITION: 核对目标已改变，请重新选择执行";
      return;
    }
    await this.command("run.reconcile", {
      trackerId: target.trackerId, runId: target.runId, resolution: target.resolution,
    }, target.revision);
  }

  private async runConfirm(action: "archive" | "cancel" | "restore" | "accept" | "changes"): Promise<void> {
    this.overlay = { kind: "none" };
    if (action === "archive" && this.selectedId) {
      await this.command("task.archive", { trackerId: this.selectedId }, this.detail?.record.revision);
    } else if (action === "restore" && this.selectedId) {
      await this.command("task.restore", { trackerId: this.selectedId }, this.detail?.record.revision);
    } else if (action === "cancel" && this.selectedRunId) {
      await this.command("run.cancel", { runId: this.selectedRunId });
    } else if (action === "accept" && this.selectedRunId && this.detail) {
      await this.command("review.accept", { runId: this.selectedRunId }, this.detail.record.revision);
    } else if (action === "changes" && this.selectedRunId) {
      await this.command("review.request_changes", { runId: this.selectedRunId, comment: "TUI 要求修改" });
    }
  }

  private async saveOverlay(): Promise<void> {
    const o = this.overlay;
    this.setCursorVisible(false);
    if (o.kind === "create") {
      if (!o.title.trim()) {
        this.error = "USAGE: 标题不能为空";
        return;
      }
      await this.command("task.create", {
        title: o.title.trim(),
        ...(o.body.trim() ? { description: o.body } : {}),
        primaryType: this.typeFilter === "executable" || this.typeFilter === "all" ? "task" : this.typeFilter,
      });
    } else if (o.kind === "edit") {
      if (o.saving) return;
      if (o.projectId !== this.projectId) {
        this.error = "PRECONDITION: 所属项目已改变，本次未保存；请复制草稿后重新选择原任务";
        this.setCursorVisible(true);
        return;
      }
      if (!Number.isFinite(o.revision)) {
        this.error = "USAGE: 保存需要当前 revision";
        return;
      }
      o.saving = true;
      const saved = await this.command("task.update", {
        trackerId: o.trackerId,
        title: o.title,
        markdown: o.body,
      }, o.revision);
      o.saving = false;
      if (!saved) {
        this.setCursorVisible(true);
        return;
      }
    } else if (o.kind === "message" && this.selectedRunId) {
      if (o.respondId) {
        await this.command("run.respond", { runId: this.selectedRunId, requestId: o.respondId, text: o.text });
      } else {
        await this.command("run.message", { runId: this.selectedRunId, text: o.text });
      }
    }
    this.overlay = { kind: "none" };
    this.dirty = true;
  }

  private async startRun(): Promise<void> {
    if (!this.selectedId) return;
    await this.command("run.start", {
      trackerId: this.selectedId,
      ...(this.deviceFilter ? { deviceId: this.deviceFilter } : {}),
    }, this.detail?.record.revision, `tui-start-${this.selectedId}-${Date.now()}`);
  }

  private async showDiff(): Promise<void> {
    if (!this.selectedRunId) {
      this.error = "没有可查看的 run";
      return;
    }
    try {
      const data = await this.http.query<{ diff: { files: Array<{ path: string; additions: number; deletions: number; patch: string }>; label: string } | null }>({
        name: "diff.get",
        projectId: this.projectId,
        input: { runId: this.selectedRunId },
      });
      const files = data.diff?.files ?? [];
      const text = files.length
        ? files.map((file) => `${file.path} +${file.additions} -${file.deletions}\n${file.patch}`).join("\n")
        : "当前没有差异";
      this.overlay = { kind: "diff", text };
    } catch (error) {
      this.noteError(error);
    }
  }

  private async showHistory(): Promise<void> {
    if (!this.selectedId) return;
    try {
      const data = await this.http.query<{
        comments: Array<{ body: string; createdAt: string }>;
        activity: Array<{ at: string; detail: string }>;
        runs: Array<{ id: string; status: string; attempt: number }>;
      }>({
        name: "history.get",
        projectId: this.projectId,
        input: { trackerId: this.selectedId },
      });
      const lines = [
        ...data.activity.map((row) => `${row.at} ${row.detail}`),
        ...data.comments.map((row) => `讨论 ${row.createdAt} ${row.body}`),
        ...data.runs.map((row) => `run ${row.id} 第${row.attempt}次 ${runStatusText(row.status as never)}`),
      ];
      this.overlay = { kind: "history", text: lines.join("\n") || "没有历史" };
    } catch (error) {
      this.noteError(error);
    }
  }

  private async showReady(): Promise<void> {
    try {
      const data = await this.http.query<{ items: TaskCard[] }>({
        name: "ready.list",
        projectId: this.projectId,
      });
      this.overlay = { kind: "ready", index: 0, items: data.items ?? [] };
    } catch (error) {
      this.noteError(error);
    }
    this.dirty = true;
  }

  private async pickReady(item: TaskCard | undefined): Promise<void> {
    if (!item) return;
    this.selectedId = item.trackerId;
    this.selectedRunId = item.latestRunId;
    this.stage = item.stage;
    this.overlay = { kind: "none" };
    await this.refreshDetail();
    this.dirty = true;
  }

  private async showViews(): Promise<void> {
    try {
      const data = await this.http.query<{ views: SavedView[] }>({
        name: "view.list",
        projectId: this.projectId,
      });
      this.overlay = { kind: "views", index: 0, views: data.views ?? [] };
    } catch (error) {
      this.noteError(error);
    }
    this.dirty = true;
  }

  private async applyView(view: SavedView | undefined): Promise<void> {
    if (!view) return;
    this.viewId = view.viewId;
    this.overlay = { kind: "none" };
    this.status = `已应用视图 ${view.name}`;
    await this.refreshQuiet();
  }

  private beginViewSave(): void {
    this.overlay = { kind: "viewsave", name: "" };
    this.setCursorVisible(true);
    this.dirty = true;
  }

  private async saveView(name: string): Promise<void> {
    this.setCursorVisible(false);
    if (!name.trim()) {
      this.error = "USAGE: 视图名称不能为空";
      return;
    }
    await this.command("view.save", {
      name: name.trim(),
      definition: {
        types: this.typeFilter === "all" || this.typeFilter === "executable" ? this.typeFilter : [this.typeFilter],
        includeArchived: true,
        includeSemantic: this.typeFilter === "all" || !["executable", "task", "bug"].includes(this.typeFilter),
        deviceId: this.deviceFilter,
        q: this.search || undefined,
      },
    });
    this.overlay = { kind: "none" };
  }

  private beginRelation(): void {
    if (!this.actionAllowed("relation.set")) {
      this.error = this.actionDenied("relation.set");
      this.overlay = { kind: "none" };
      return;
    }
    const rec = this.detail?.record;
    if (!rec) {
      this.error = "没有选中记录";
      return;
    }
    this.overlay = {
      kind: "relation",
      field: "dependsOn",
      dependsOn: (rec.fields.dependsOn ?? []).join(", "),
      blocks: (rec.fields.blocks ?? []).join(", "),
    };
    this.setCursorVisible(true);
    this.dirty = true;
  }

  private async saveRelation(): Promise<void> {
    const o = this.overlay;
    if (o.kind !== "relation" || !this.selectedId) return;
    this.setCursorVisible(false);
    const split = (raw: string) => raw.split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean);
    await this.command("relation.set", {
      trackerId: this.selectedId,
      dependsOn: split(o.dependsOn),
      blocks: split(o.blocks),
    }, this.detail?.record.revision);
    this.overlay = { kind: "none" };
  }

  private async reorderSelected(delta: -1 | 1): Promise<void> {
    if (!this.actionAllowed("task.reorder")) {
      this.error = this.actionDenied("task.reorder");
      return;
    }
    const list = this.visibleCards();
    const idx = list.findIndex((row) => row.trackerId === this.selectedId);
    if (idx < 0 || !this.selectedId) {
      this.error = "没有可排序的选中记录";
      return;
    }
    const neighbor = list[idx + delta];
    if (!neighbor) {
      this.error = delta < 0 ? "已经在列首，不能再上移" : "已经在列尾，不能再下移";
      return;
    }
    await this.command("task.reorder", {
      trackerId: this.selectedId,
      ...(delta < 0 ? { afterId: neighbor.trackerId } : { beforeId: neighbor.trackerId }),
    }, this.detail?.record.revision);
  }

  private async showHooks(): Promise<void> {
    await this.refreshCaps();
    try {
      const data = await this.http.query<{ hooks: HookRow[]; outbox: OutboxRow[]; deliveries: DeliveryRow[] }>({
        name: "hook.list",
        projectId: this.projectId,
      });
      this.overlay = {
        kind: "hooks",
        tab: "hooks",
        index: 0,
        hooks: data.hooks ?? [],
        outbox: data.outbox ?? [],
        deliveries: data.deliveries ?? [],
        canRegister: this.actionAllowed("hook.register"),
        canRetry: this.actionAllowed("hook.retry_delivery"),
      };
    } catch (error) {
      this.noteError(error);
    }
    this.dirty = true;
  }

  private beginHookRegister(): void {
    if (!this.actionAllowed("hook.register")) {
      this.error = this.actionDenied("hook.register");
      return;
    }
    this.overlay = {
      kind: "hookregister",
      field: "hookId",
      hookId: "",
      phase: "observe",
      executable: "node",
    };
    this.setCursorVisible(true);
    this.dirty = true;
  }

  private async submitHookRegister(): Promise<void> {
    const o = this.overlay;
    if (o.kind !== "hookregister") return;
    this.setCursorVisible(false);
    if (!o.hookId.trim() || !o.phase.trim() || !o.executable.trim()) {
      this.error = "USAGE: hookId、phase、executable 不能为空";
      return;
    }
    await this.command("hook.register", {
      hookId: o.hookId.trim(),
      phase: o.phase,
      executable: o.executable.trim(),
      argv: [],
    });
    this.overlay = { kind: "none" };
  }

  private async retryDelivery(row: OutboxRow | undefined): Promise<void> {
    if (!row) return;
    if (!this.actionAllowed("hook.retry_delivery")) {
      this.error = this.actionDenied("hook.retry_delivery");
      return;
    }
    await this.command("hook.retry_delivery", { deliveryId: row.deliveryId });
    this.overlay = { kind: "none" };
  }

  private async command(name: Parameters<TuiHttp["command"]>[0]["name"], input: Record<string, unknown>, expectedRevision?: number, idempotencyKey?: string): Promise<boolean> {
    try {
      const result = await this.http.command({
        name,
        projectId: this.projectId,
        input,
        expectedRevision,
        idempotencyKey,
      });
      this.error = null;
      this.status = result.settled
        ? `命令已提交 · revision ${result.revision ?? "-"}`
        : `命令已接受，run 未完成 settled=false runId=${result.runId ?? "-"}`;
      if (result.trackerId) this.selectedId = result.trackerId;
      if (result.runId) this.selectedRunId = result.runId;
      await this.refreshQuiet();
      if (result.trackerId) this.selectedId = result.trackerId;
      return true;
    } catch (error) {
      this.noteError(error);
      return false;
    } finally {
      this.dirty = true;
    }
  }

  private noteError(error: unknown): void {
    if (error instanceof BabelError) {
      this.error = `${error.code}: ${error.message}`;
      if (error.code === "REVISION_CONFLICT") {
        this.status = "REVISION_CONFLICT 记录已被更新，请先同步后再保存";
        void this.refreshDetail();
      }
    } else {
      this.error = "请求失败";
    }
  }

  private paint(): void {
    if (!this.running) return;
    const { cols, rows } = this.size();
    const narrow = cols < 100;
    const hits: HitRegion[] = [];
    const lines: string[] = [];
    const project = this.projects.find((row) => row.id === this.projectId);
    const device = this.devices.find((row) => row.id === this.deviceFilter);
    const header = this.drawHeader(cols, project?.name ?? this.projectId, device?.label ?? "全部", hits);
    lines.push(header);
    lines.push(cell(stageTabs(this.counts, this.stage, cols), cols));
    this.addStageHits(hits, 1, cols);

    const footer = footerLine(cols, this.search && this.overlay.kind === "search" ? `搜索: ${this.search}` : this.status, this.error, narrow);
    const bodyRows = Math.max(4, rows - 3);
    const body = narrow ? this.drawNarrow(cols, bodyRows, hits) : this.drawWide(cols, bodyRows, hits);
    lines.push(...body);
    while (lines.length < rows - 1) lines.push(cell("", cols));
    lines[rows - 1] = footer;
    while (lines.length < rows) lines.push(cell("", cols));
    const painted = this.applyOverlay(lines.slice(0, rows), cols, rows, hits);
    this.hits = hits;
    this.lastFrame = painted.join("\n");
    if (!this.headless) {
      this.tty.write(`\x1b[H${painted.map((line) => `\x1b[2K${line}`).join("\r\n")}\x1b[J`);
    }
    this.dirty = false;
  }

  private drawHeader(cols: number, projectName: string, deviceLabel: string, hits: HitRegion[]): string {
    const connText = this.connected ? "已连接" : "已断线";
    const viewLabel = this.viewId ? this.viewId : "默认";
    const parts = [
      { action: "demo", label: "演示数据" },
      { action: "project", label: `项目:${projectName}` },
      { action: "type", label: `类型:${typeText(this.typeFilter)}` },
      { action: "attention", label: attentionFilterText(this.attentionOnly) },
      { action: "device", label: `设备:${deviceLabel}` },
      { action: "views", label: `视图:${viewLabel}` },
      { action: "ready", label: "就绪" },
      { action: "hooks", label: "Hook" },
      { action: "surfaces", label: "后续" },
    ];
    let x = 0;
    const labels: string[] = [];
    for (const part of parts) {
      const w = displayWidth(part.label);
      hits.push({ x, y: 0, w, h: 1, action: part.action });
      labels.push(part.label);
      x += w + 2;
    }
    const left = labels.join("  ");
    const clipped = padWidth(sliceByWidth(`${left}  ${connText}`, cols), cols);
    const styled = this.connected
      ? `${CYAN}演示数据${RST}${clipped.slice("演示数据".length)}`.replace(connText, `${GRN}${connText}${RST}`)
      : `${CYAN}演示数据${RST}${clipped.slice("演示数据".length)}`.replace(connText, `${RED}${connText}${RST}`);
    return styled;
  }

  private addStageHits(hits: HitRegion[], y: number, cols: number): void {
    let x = 1;
    for (const stage of STAGE_ORDER) {
      const label = `${STAGE_LABEL[stage]} ${this.counts[stage] ?? 0}`;
      const w = displayWidth(label) + 2;
      hits.push({ x, y, w: Math.min(w, cols - x), h: 1, action: "stage", id: stage });
      x += w + 1;
    }
  }

  private drawNarrow(cols: number, rows: number, hits: HitRegion[]): string[] {
    const listH = Math.max(3, Math.floor(rows * 0.55));
    const detailH = rows - listH;
    const cards = this.visibleCards();
    const lines: string[] = [];
    let idx = cards.findIndex((row) => row.trackerId === this.selectedId);
    if (idx < 0) idx = 0;
    const start = Math.max(0, idx - Math.floor(listH / 4));
    let y = 2;
    for (let i = start; i < cards.length && lines.length + 2 <= listH; i++) {
      const card = cards[i];
      if (!card) continue;
      const selected = card.trackerId === this.selectedId;
      lines.push(...splitCardLines(card, cols, selected));
      hits.push({ x: 1, y, w: cols, h: 1, action: "card", id: card.trackerId });
      y += 1;
    }
    while (lines.length < listH) lines.push(cell("", cols));
    lines.push(...this.drawDetailPane(cols, detailH));
    return lines.slice(0, rows);
  }

  private drawWide(cols: number, rows: number, hits: HitRegion[]): string[] {
    const detailW = Math.max(28, Math.min(42, Math.floor(cols * 0.32)));
    const boardW = cols - detailW - 1;
    const colW = Math.max(12, Math.floor(boardW / 4));
    const lines: string[] = [];
    const colLines: string[][] = STAGE_ORDER.map((stage) => {
      const cards = this.items.filter((row) => row.stage === stage);
      const out: string[] = [cell(`${STAGE_LABEL[stage]} ${this.counts[stage] ?? 0}`, colW, DIM)];
      for (const card of cards) {
        out.push(...splitCardLines(card, colW, card.trackerId === this.selectedId));
      }
      return out;
    });
    const detail = this.drawDetailPane(detailW, rows);
    for (let r = 0; r < rows; r++) {
      let row = "";
      let x = 1;
      for (let c = 0; c < 4; c++) {
        const stage = STAGE_ORDER[c] ?? "TODO";
        const chunk = colLines[c]?.[r] ?? cell("", colW);
        row += chunk + " ";
        const cards = this.items.filter((item) => item.stage === stage);
        let cy = 1;
        for (const card of cards) {
          if (r === cy) {
            hits.push({ x, y: r + 2, w: colW, h: 1, action: "card", id: card.trackerId });
          }
          cy += 1;
        }
        x += colW + 1;
      }
      row += (detail[r] ?? cell("", detailW));
      lines.push(row);
    }
    return lines;
  }

  private drawDetailPane(width: number, height: number): string[] {
    const rec = this.detail?.record;
    const run = this.detail?.latestRun;
    if (!rec) return Array.from({ length: height }, () => cell("未选中记录", width, DIM));
    const pending = run?.inputRequests.find((row) => !row.answered);
    const body = [
      rec.fields.title,
      `${typeText(rec.primaryType)} · ${this.detail?.stage} · rev ${rec.revision}`,
      `状态 ${rec.fields.status}${rec.system.readOnly ? " · 只读" : ""}`,
      `优先级 ${rec.fields.priority || "未设置"}  负责人 ${rec.fields.owner || "未分配"}`,
      `标签 ${(Array.isArray(rec.fields.tags) ? rec.fields.tags : []).join(", ") || "无"}`,
      `最后更新 ${this.detail?.card.lastUpdatedAt ?? "暂无记录"}`,
      run ? `执行 ${runStatusText(run.status)} ${run.id}` : "执行 尚未执行",
      pending ? `待答 ${pending.prompt}` : "",
      `依赖 ${(rec.fields.dependsOn ?? []).join(", ") || "无"}`,
      `阻塞 ${(rec.fields.blocks ?? []).join(", ") || "无"}`,
      rec.archived ? "已归档，恢复不自动重跑" : "",
      "",
      String(rec.fields.description ?? ""),
    ].filter((row, i, arr) => row || arr[i - 1]);
    const wrapped = wrapByWidth(body.join("\n"), width, height);
    while (wrapped.length < height) wrapped.push("");
    return wrapped.slice(0, height).map((row) => cell(row, width));
  }

  private applyOverlay(base: string[], cols: number, rows: number, hits: HitRegion[]): string[] {
    const o = this.overlay;
    if (o.kind === "none") return base;
    const w = Math.min(cols - 2, Math.max(40, Math.floor(cols * 0.7)));
    const h = Math.min(rows - 2, o.kind === "help" || o.kind === "hooks" || o.kind === "menu" || o.kind === "surface" ? 22 : 16);
    let title = "";
    let body: string[] = [];
    let footer = "Esc 关闭";
    let listCount = 0;
    if (o.kind === "help") {
      title = "帮助";
      body = [...helpLines(), ...surfaceHelpLines()];
    } else if (o.kind === "menu") {
      title = "操作菜单（替代拖拽）";
      body = this.menuItems().map((item, i) => (i === o.index ? `> ${item.label}` : `  ${item.label}`));
      footer = "j/k 移动  Enter 执行  Esc 关闭";
    } else if (o.kind === "fields") {
      title = `编辑字段 · revision ${o.revision}`;
      body = [
        `记录 ${o.trackerId}`,
        `${o.field === "priority" ? ">" : " "}优先级 ${o.priority}`,
        `${o.field === "owner" ? ">" : " "}负责人 ${o.owner || "（空值清除）"}`,
        `${o.field === "tags" ? ">" : " "}标签 ${o.tags || "（空值清除）"}`,
        "标签用逗号分隔；优先级保留自定义值。",
        this.error || "",
      ];
      footer = o.saving ? "正在保存，请稍候" : "Tab 切换  Ctrl+S 保存  Esc 取消（丢弃草稿）";
    } else if (o.kind === "edit" || o.kind === "create") {
      title = o.kind === "edit" ? `编辑 · revision ${o.kind === "edit" ? o.revision : ""}` : "新建";
      const markT = o.field === "title" ? ">" : " ";
      const markB = o.field === "body" ? ">" : " ";
      body = [`${markT}标题 ${o.title}`, `${markB}正文`, ...wrapByWidth(o.body, w - 4, 8)];
      footer = o.kind === "edit" && o.saving ? "正在保存，请稍候" : "Tab 切换  Ctrl+S 保存  Esc 取消（丢弃草稿）";
    } else if (o.kind === "message") {
      title = o.respondId ? "回答待答请求" : "发送消息";
      body = wrapByWidth(o.text || "（输入后 Enter 或 Ctrl+S 发送）", w - 4, 8);
      footer = "Enter/Ctrl+S 发送  Esc 取消";
    } else if (o.kind === "confirm") {
      title = "确认";
      body = [confirmText(o.action), "Enter 确认  n 取消"];
    } else if (o.kind === "reconcile") {
      title = "核对演示执行";
      body = [
        "取消请求或失联不代表执行已停止。",
        "此处仅记录人工核对结果，不检测真实 Worker。",
        `项目 ${o.projectId}`,
        ...wrapByWidth(`条目 ${o.title}`, w - 4, 2),
        `Tracker ${o.trackerId}`,
        `run ${o.runId}`,
        `状态 ${runStatusText(o.status)} · revision ${o.revision}`,
        `结果 ${o.resolution === "cancelled" ? "已取消" : "失败"}`,
        "仅在你已确认该演示执行终止后提交。",
      ];
      footer = "Tab 切换结果  Enter 确认  n/Esc 取消";
    } else if (o.kind === "diff" || o.kind === "history") {
      title = o.kind === "diff" ? "差异" : "历史";
      body = wrapByWidth(o.text, w - 4, h - 3);
    } else if (o.kind === "ready") {
      title = "就绪（依赖已满足）";
      body = o.items.length
        ? o.items.map((item, i) => `${i === o.index ? ">" : " "} ${item.title}  ${item.trackerId}`)
        : ["当前没有就绪条目"];
      listCount = o.items.length;
      footer = "j/k 移动  Enter 选中  Esc 关闭";
    } else if (o.kind === "views") {
      title = "已保存视图";
      body = o.views.length
        ? o.views.map((view, i) => `${i === o.index ? ">" : " "} ${view.name}  ${view.viewId}${view.builtin ? " · 内置" : ""}`)
        : ["没有已保存视图"];
      listCount = o.views.length;
      footer = "j/k 移动  Enter 应用  s 另存  Esc 关闭";
    } else if (o.kind === "viewsave") {
      title = "保存当前筛选为视图";
      body = [`名称 ${o.name || "（输入中文名称后 Enter 保存）"}`];
      footer = "Enter/Ctrl+S 保存  Esc 取消";
    } else if (o.kind === "relation") {
      title = "设置依赖关系";
      const markD = o.field === "dependsOn" ? ">" : " ";
      const markB = o.field === "blocks" ? ">" : " ";
      body = [
        `${markD}依赖 dependsOn ${o.dependsOn}`,
        `${markB}阻塞 blocks ${o.blocks}`,
        "用逗号分隔 trackerId，保存走 relation.set",
      ];
      footer = "Tab 切换  Ctrl+S 保存  Esc 取消";
    } else if (o.kind === "hooks") {
      title = o.tab === "hooks" ? "Hook 配置" : "观察 Hook 投递";
      if (o.tab === "hooks") {
        body = o.hooks.length
          ? o.hooks.map((hook, i) => `${i === o.index ? ">" : " "} ${hook.hookId}  ${hook.phase}`)
          : ["没有已登记 Hook"];
        listCount = o.hooks.length;
      } else {
        body = o.outbox.length
          ? o.outbox.map((row, i) => `${i === o.index ? ">" : " "} ${row.deliveryId}  ${row.hookId}  ${row.status}${row.lastError ? `  ${row.lastError}` : ""}`)
          : ["没有投递记录"];
        if (o.deliveries.length) {
          body.push("", "投递日志");
          body.push(...o.deliveries.slice(0, 4).map((row) => `  ${row.deliveryId} ${row.ok ? "成功" : "失败"}${row.error ? ` ${row.error}` : ""}`));
        }
        listCount = o.outbox.length;
      }
      const extra = [
        o.canRegister ? "n 登记 Hook" : "登记 Hook 当前不可用",
        o.canRetry ? "投递列表 Enter 重试（不重跑原命令）" : "重试投递当前不可用",
      ].join("  ");
      footer = `Tab 切换列表  ${extra}  Esc 关闭`;
    } else if (o.kind === "hookregister") {
      title = "登记 Hook";
      const mark = (field: typeof o.field) => (o.field === field ? ">" : " ");
      body = [
        `${mark("hookId")}hookId ${o.hookId}`,
        `${mark("phase")}phase ${o.phase}（Enter 切换）`,
        `${mark("executable")}executable ${o.executable}`,
        "登记需要服务令牌；失败会显示错误码。",
      ];
      footer = "Tab 切换  Ctrl+S 提交  Esc 取消";
    } else if (o.kind === "surface") {
      title = o.title;
      body = o.lines;
      footer = o.footer;
    } else if (o.kind === "search") {
      return base;
    }
    const box = drawBox(title, body, w, h, footer);
    if (o.kind === "menu" || o.kind === "ready" || o.kind === "views" || o.kind === "hooks") {
      const top = Math.max(1, Math.floor((rows - box.length) / 2));
      const left = Math.max(0, Math.floor((cols - w) / 2));
      const count = o.kind === "menu" ? this.menuItems().length : listCount;
      for (let i = 0; i < count; i++) {
        hits.push({ x: left + 1, y: top + 1 + i, w: w - 2, h: 1, action: "menuitem", id: String(i) });
      }
    }
    return overlayOn(base, box, cols, rows);
  }
}

function confirmText(action: string): string {
  switch (action) {
    case "archive":
      return "归档这条记录？历史会保留。";
    case "restore":
      return "恢复到归档前状态？不会自动重跑。";
    case "cancel":
      return "请求取消当前执行？取消待确认前不能重试。";
    case "accept":
      return "验收这次模拟结果？";
    case "changes":
      return "要求修改并结束这次执行为失败？";
    default:
      return "确认？";
  }
}
