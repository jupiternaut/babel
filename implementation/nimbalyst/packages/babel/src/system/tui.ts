import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { InputDecoder, type KeyEvent } from '../tui/input.ts';
import { TtySession, terminalSize } from '../tui/tty.ts';
import { displayWidth, sliceByWidth } from '../tui/width.ts';
import { SystemClient } from './client.ts';
import { SystemError, type ConsoleCommand, type Operation, type ProcessInfo, type ResourceSnapshot, type ServiceDefinition, type ServiceSnapshot } from './types.ts';

type ServiceRow = { definition: ServiceDefinition; snapshot: ServiceSnapshot };
type Page = 'services' | 'processes' | 'logs' | 'history';
interface Hit { x: number; width: number; key: string; }
const safe = (text: unknown): string => String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
const bytes = (value: number): string => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;
const percent = (value: number | null): string => value === null ? '采样中/不可用' : `${value.toFixed(1)}%`;

/** The model is also used by terminal tests; every read/action goes to the live service. */
export class SystemTui {
  page: Page = 'services';
  services: ServiceRow[] = [];
  processes: ProcessInfo[] = [];
  operations: Operation[] = [];
  resources?: ResourceSnapshot;
  logs = '';
  selected = 0;
  scroll = 0;
  filter = '';
  editingFilter = false;
  help = false;
  status = '正在连接设备控制服务…';
  error = false;
  busy = false;
  polling = false;
  closed = false;
  confirmation?: ProcessInfo;
  serviceId?: string;
  private readonly abort = new AbortController();
  private actions: Hit[] = [];
  private tabs: Hit[] = [];
  private visibleOffset = 0;
  private visibleCount = 0;
  private cols = 100;
  private rows = 30;
  constructor(readonly client: Pick<SystemClient, 'query' | 'command'>, private readonly redraw: () => void = () => {}, private readonly quit: () => void = () => {}) {}

  stop(): void { this.closed = true; this.abort.abort(); }
  get serviceRows(): ServiceRow[] {
    const needle = this.filter.toLocaleLowerCase();
    return this.services.filter(row => `${row.definition.id} ${row.definition.label}`.toLocaleLowerCase().includes(needle));
  }
  get processRows(): ProcessInfo[] {
    const needle = this.filter.toLocaleLowerCase();
    return this.processes.filter(row => `${row.pid} ${row.name}`.toLocaleLowerCase().includes(needle));
  }
  private selectedService(): ServiceRow | undefined { return this.serviceRows[this.selected]; }
  private count(): number { return this.page === 'services' ? this.serviceRows.length : this.page === 'processes' ? this.processRows.length : 0; }
  private move(delta: number): void {
    if (this.page === 'logs' || this.page === 'history') this.scroll = Math.max(0, this.scroll + delta);
    else this.selected = Math.max(0, Math.min(this.count() - 1, this.selected + delta));
  }

  async refresh(): Promise<void> {
    if (this.closed || this.polling || this.busy) return;
    this.polling = true;
    const page = this.page;
    const selectedId = this.selectedService()?.definition.id;
    const selectedPid = this.processRows[this.selected]?.pid;
    const selectedStarted = this.processRows[this.selected]?.startedAt;
    const errors: string[] = [];
    const query = async (task: () => Promise<void>) => { try { await task(); } catch (error) { errors.push(error instanceof Error ? error.message : '请求失败'); } };
    try {
      await Promise.all([
        query(async () => { this.resources = await this.client.query<ResourceSnapshot>({ name: 'resources' }, this.abort.signal); }),
        query(async () => {
          if (page === 'services') {
            const data = await this.client.query<{ services: ServiceRow[] }>({ name: 'services' }, this.abort.signal);
            this.services = data.services;
            if (this.page === page && selectedId) { const index = this.serviceRows.findIndex(row => row.definition.id === selectedId); if (index >= 0) this.selected = index; }
          } else if (page === 'processes') {
            this.processes = await this.client.query<ProcessInfo[]>({ name: 'processes' }, this.abort.signal);
            if (this.page === page && selectedPid) { const index = this.processRows.findIndex(row => row.pid === selectedPid && row.startedAt === selectedStarted); if (index >= 0) this.selected = index; }
          } else if (page === 'history') this.operations = await this.client.query<Operation[]>({ name: 'operations', limit: 200 }, this.abort.signal);
          else if (this.serviceId) this.logs = (await this.client.query<{ text: string }>({ name: 'logs', serviceId: this.serviceId, limit: 500 }, this.abort.signal)).text;
        }),
      ]);
      if (!this.closed) {
        this.selected = Math.max(0, Math.min(this.selected, this.count() - 1));
        if (errors.length) { this.error = true; this.status = `刷新失败（显示上次成功快照）: ${errors.join('；')}`; }
        else if (!this.busy && (this.status.startsWith('正在连接') || this.status.startsWith('刷新失败'))) { this.error = false; this.status = '已连接；操作结果以历史记录为准'; }
      }
    } finally { this.polling = false; if (!this.closed) this.redraw(); }
  }

  private async command(command: Omit<ConsoleCommand, 'requestId'>): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.error = false;
    this.status = '操作执行中，请稍候…';
    this.redraw();
    try {
      const operation = await this.client.command({ ...command, requestId: randomUUID() }, this.abort.signal);
      this.error = operation.status !== 'succeeded';
      this.status = `${operation.status === 'succeeded' ? '成功' : '未成功'}: ${operation.action} ${operation.targetId} [${operation.status}] ${operation.error?.message ?? ''}`;
    } catch (error) { this.error = true; this.status = error instanceof Error ? error.message : '操作失败'; }
    finally { this.busy = false; if (!this.closed) { this.redraw(); await this.refresh(); } }
  }

  async handle(event: KeyEvent): Promise<void> {
    if (this.closed) return;
    if (event.type === 'key' && event.name === 'ctrl-c') { this.stop(); this.quit(); return; }
    if (event.type === 'paste') { if (this.editingFilter) { this.filter += safe(event.text); this.selected = 0; this.redraw(); } return; }
    if (event.type === 'mouse') {
      if (this.confirmation || this.help || this.editingFilter) return;
      if (event.kind === 'wheel') this.move(event.wheel * 3);
      else if (event.kind === 'down' && event.button === 0) {
        if (event.y === 5) { const hit = this.tabs.find(item => event.x >= item.x && event.x < item.x + item.width); if (hit) await this.handle({ type: 'text', text: hit.key }); }
        else if (event.y === this.rows - 1) { const hit = this.actions.find(item => event.x >= item.x && event.x < item.x + item.width); if (hit) await this.handle({ type: 'text', text: hit.key }); }
        else if (event.y >= 8 && event.y < 8 + this.visibleCount && this.count()) this.selected = Math.min(this.count() - 1, this.visibleOffset + event.y - 8);
      }
      this.redraw(); return;
    }
    const key = event.type === 'text' ? event.text : event.name;
    if (this.confirmation) {
      if (key === 'y' && !this.busy) { const target = this.confirmation; this.confirmation = undefined; await this.command({ name: 'process.terminate', process: { pid: target.pid, startedAt: target.startedAt }, force: false }); }
      else if (['n', 'escape', 'q'].includes(key)) this.confirmation = undefined;
      this.redraw(); return;
    }
    if (this.editingFilter) {
      if (key === 'enter' || key === 'escape') this.editingFilter = false;
      else if (key === 'backspace') this.filter = Array.from(this.filter).slice(0, -1).join('');
      else if (event.type === 'text') this.filter += safe(event.text);
      this.selected = 0; this.redraw(); return;
    }
    if (key === 'q') { this.stop(); this.quit(); return; }
    if (this.help) { this.help = false; this.redraw(); return; }
    if (key === '?' || key === 'f1') this.help = true;
    else if (key === '/') this.editingFilter = true;
    else if (['up', 'k', 'down', 'j', 'pageup', 'pagedown'].includes(key)) this.move(key === 'up' || key === 'k' ? -1 : key === 'pageup' ? -10 : key === 'pagedown' ? 10 : 1);
    else if (key === 'home') { this.selected = 0; this.scroll = 0; }
    else if (key === 'end') { this.selected = Math.max(0, this.count() - 1); this.scroll = Number.MAX_SAFE_INTEGER; }
    else if (['1', '2', '3', '4', 'tab', 'l', 'h'].includes(key)) {
      const pages: Page[] = ['services', 'processes', 'logs', 'history'];
      const next = key === 'tab' ? pages[(pages.indexOf(this.page) + 1) % pages.length] : key === 'l' ? 'logs' : key === 'h' ? 'history' : pages[Number(key) - 1];
      if (this.page === 'services') this.serviceId = this.selectedService()?.definition.id ?? this.serviceId;
      this.page = next; this.selected = 0; this.scroll = 0; this.filter = ''; await this.refresh();
    } else if (key === 'g') await this.refresh();
    else if (!this.busy && this.page === 'services') {
      const row = this.selectedService();
      if (row && ['s', 'x', 'r', 'a'].includes(key)) {
        if (key === 'a' && row.snapshot.autostart.enabled === null) { this.error = true; this.status = '无法切换未知自启状态；请先检查服务配置/权限'; }
        else await this.command({ name: key === 'a' ? 'service.autostart' : key === 's' ? 'service.start' : key === 'x' ? 'service.stop' : 'service.restart', serviceId: row.definition.id, ...(key === 'a' ? { enabled: !row.snapshot.autostart.enabled } : {}) });
      }
    } else if (!this.busy && this.page === 'processes' && key === 'x') {
      const target = this.processRows[this.selected];
      if (target) this.confirmation = { ...target };
    }
    this.redraw();
  }

  render(cols: number, rows: number): string {
    this.cols = Math.max(1, cols); this.rows = Math.max(1, rows);
    const width = Math.max(1, cols - 1);
    if (cols < 45 || rows < 14) return '\x1b[H\x1b[2J' + sliceByWidth('设备控制台：请扩大终端至 45×14；q 退出', width);
    const resource = this.resources;
    const memory = resource?.memory;
    const tabItems = [['1', '服务'], ['2', '进程'], ['3', '日志'], ['4', '历史']];
    let tabLine = ''; this.tabs = [];
    for (const [key, label] of tabItems) { const text = `[${key} ${label}] `; this.tabs.push({ x: displayWidth(tabLine) + 1, width: displayWidth(text), key }); tabLine += text; }
    const lines = [
      `Babel 设备控制台 | ${resource ? `${resource.hostname} / ${resource.platform}` : '连接中'} | ${this.busy ? '执行操作中' : '实时采样'}`,
      resource ? `CPU ${percent(resource.cpuPercent)} | 内存 ${bytes(memory!.usedBytes)} / ${bytes(memory!.totalBytes)} | 运行 ${(resource.uptimeSeconds / 3600).toFixed(1)} h` : '资源数据尚未取得',
      resource ? `磁盘 ${resource.disks.map(disk => `${disk.name} 可用 ${bytes(disk.freeBytes)} / ${bytes(disk.totalBytes)}`).join(' | ') || '不可用'}` : '',
      `采样 ${resource?.sampledAt ?? '—'} ${resource?.warnings.join('；') ?? ''}`,
      tabLine + ` 当前: ${{ services: '服务', processes: '进程', logs: '日志', history: '历史' }[this.page]}`,
      `筛选: ${this.filter || '全部'}${this.editingFilter ? '（输入中文/文本，Enter 完成）' : '  / 输入筛选'}`,
    ];
    let content: string[] = [];
    if (this.help) {
      lines.push('帮助（任意键返回）');
      content = ['1 服务 / 2 进程 / 3 日志 / 4 历史；Tab 切页', '↑↓ 或 j/k 选择；鼠标点击行；滚轮/PgUp/PgDn 滚动', '服务: s 启动，x 停止，r 重启，a 切换自启', '进程: x 请求终止；显示 PID 与启动时间后 y 确认', '日志使用当前选中服务；历史包含失败原因', '/ 筛选（支持中文）；g 刷新；? 帮助', 'q 或 Ctrl+C 退出，仅恢复终端，不停止服务', '连接失败保留上次快照，并显示错误；不会伪报成功'];
    } else if (this.confirmation) {
      lines.push('确认终止进程');
      content = [`名称: ${this.confirmation.name}`, `PID: ${this.confirmation.pid}`, `启动时间: ${this.confirmation.startedAt}`, '按 y 确认 / n 或 Esc 取消（使用精确身份，防止 PID 重用）'];
    } else if (this.page === 'services') {
      lines.push('  服务 / 当前状态 / 自启触发方式 / 健康');
      content = this.serviceRows.map((row, i) => `${i === this.selected ? '>' : ' '} ${row.definition.label} (${row.definition.id}) | ${row.snapshot.state} | ${row.snapshot.autostart.enabled === null ? '?' : row.snapshot.autostart.enabled ? '开' : '关'} ${row.snapshot.autostart.trigger} | ${row.snapshot.health}${row.snapshot.message ? ` | ${row.snapshot.message}` : ''}`);
    } else if (this.page === 'processes') {
      lines.push('  PID / 名称 / CPU / 内存 / 启动时间');
      content = this.processRows.map((row, i) => `${i === this.selected ? '>' : ' '} ${row.pid} ${row.name} | ${percent(row.cpuPercent)} | ${bytes(row.memoryBytes)} | ${row.startedAt}`);
    } else if (this.page === 'logs') {
      lines.push(`日志: ${this.serviceId ?? '请先在服务页选中一个服务'}`);
      content = this.logs.split(/\r?\n/);
    } else {
      lines.push('操作历史 / 结果 / 错误');
      content = this.operations.map(row => `${row.requestedAt} ${row.action} ${row.targetId} ${row.status}${row.error ? ` | ${row.error.code}: ${row.error.message}` : ''}`);
    }
    const available = Math.max(1, rows - 10);
    this.visibleOffset = this.help || this.confirmation ? 0 : this.count() ? Math.max(0, this.selected - available + 1) : Math.min(this.scroll, Math.max(0, content.length - available));
    if (!this.count()) this.scroll = this.visibleOffset;
    this.visibleCount = Math.min(available, content.length - this.visibleOffset);
    lines.push(...content.slice(this.visibleOffset, this.visibleOffset + available));
    if (!content.length) lines.push('暂无数据');
    while (lines.length < rows - 3) lines.push('');
    lines.push(`${this.error ? '错误' : '状态'}: ${this.status}`);
    const actionItems = this.page === 'services' ? [['s', '启动'], ['x', '停止'], ['r', '重启'], ['a', '自启'], ['l', '日志']] : this.page === 'processes' ? [['x', '终止进程']] : [['g', '刷新']];
    actionItems.push(['?', '帮助'], ['q', '退出']);
    let actionLine = ''; this.actions = [];
    for (const [key, label] of actionItems) { const text = `[${key} ${label}] `; this.actions.push({ x: displayWidth(actionLine) + 1, width: displayWidth(text), key }); actionLine += text; }
    lines.push(actionLine, `${this.visibleOffset + 1}–${Math.min(content.length, this.visibleOffset + available)} / ${content.length}  ↑↓选择/滚动  g 刷新`);
    return '\x1b[H' + lines.slice(0, rows).map((line, i) => `\x1b[${i + 1};1H\x1b[2K${sliceByWidth(safe(line), width)}`).join('');
  }
}

export async function runSystemTui(client: SystemClient): Promise<number> {
  if (!stdin.isTTY || !stdout.isTTY) throw new SystemError('NOT_TTY', '设备控制台需要交互终端；可使用 system resources/services 等 CLI 命令');
  let finish!: () => void;
  const done = new Promise<void>(resolveDone => { finish = resolveDone; });
  const tty = new TtySession(() => { app.stop(); finish(); });
  const render = () => { if (!app.closed) { const size = terminalSize(); tty.write(app.render(size.cols, size.rows)); } };
  const app = new SystemTui(client, render, finish);
  let decoder = new InputDecoder();
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const handle = (event: KeyEvent) => { void app.handle(event).catch(error => { app.error = true; app.status = error instanceof Error ? error.message : '交互失败'; render(); }); };
  const input = (chunk: string) => {
    if (escapeTimer) { clearTimeout(escapeTimer); escapeTimer = undefined; }
    // A lone Escape has no terminator; defer briefly to allow fragmented CSI sequences.
    const events = decoder.push(chunk);
    for (const event of events) handle(event);
    if (chunk === '\x1b') escapeTimer = setTimeout(() => { decoder = new InputDecoder(); handle({ type: 'key', name: 'escape', raw: '\x1b', ctrl: false, shift: false }); }, 35);
  };
  const poll = async () => { await app.refresh(); if (!app.closed) pollTimer = setTimeout(() => { void poll(); }, 2000); };
  try {
    tty.enter(); stdin.on('data', input); stdout.on('resize', render); render(); void poll(); await done;
    return 0;
  } finally {
    app.stop(); if (pollTimer) clearTimeout(pollTimer); if (escapeTimer) clearTimeout(escapeTimer);
    stdin.off('data', input); stdout.off('resize', render); tty.restore(); stdin.pause();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void import('./cli.ts').then(({ runSystemCli }) => runSystemCli(['tui', ...process.argv.slice(2)])).then(code => { process.exitCode = code; });
}
