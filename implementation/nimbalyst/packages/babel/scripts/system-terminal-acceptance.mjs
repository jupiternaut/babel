// Real Windows ConPTY acceptance. Uses only a new isolated profile and its own Node fixture.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import pty from 'node-pty';
import { SystemClient } from '../src/system/client.ts';
import { runSystemCli } from '../src/system/cli.ts';
import { codeWidth } from '../src/tui/width.ts';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = path.resolve(process.argv[2] ?? 'D:/Projects/babel-nimbalyst-data/acceptance/system-console-20260916/terminal');
const evidence = path.join(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
const profile = path.join(evidence, 'isolated-profile');
const endpoint = 'http://127.0.0.1:7783';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(label, predicate, timeout = 90000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await predicate(); if (value) return value; } catch (error) { last = error; } await delay(350); }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}
const report = { startedAt: new Date().toISOString(), backend: 'node-pty 1.1.0 / Windows ConPTY', profile, endpoint, steps: [], cleanup: {} };
async function step(name, work) { const start = Date.now(); const result = await work(); report.steps.push({ name, passed: true, durationMs: Date.now() - start, result }); console.log(`PASS ${name}`); return result; }

// Interpret cursor/erase operations from ConPTY for text evidence; preserve the raw stream too.
class Screen {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.x = 0; this.y = 0; this.pending = ''; this.clear(); }
  clear() { this.cells = Array.from({ length: this.rows }, () => Array(this.cols).fill(' ')); }
  resize(cols, rows) { this.cols = cols; this.rows = rows; this.clear(); this.x = 0; this.y = 0; }
  push(chunk) {
    this.pending += chunk;
    while (this.pending.length) {
      if (this.pending[0] === '\x1b') {
        const csi = this.pending.match(/^\x1b\[([0-?]*)([ -/]*)([@-~])/);
        if (csi) {
          this.pending = this.pending.slice(csi[0].length); const code = csi[3]; const p = csi[1].split(';').map(v => Number(v || 0)); const n = p[0] || 1;
          if (['H', 'f'].includes(code)) { this.y = Math.max(0, (p[0] || 1) - 1); this.x = Math.max(0, (p[1] || 1) - 1); }
          else if (code === 'A') this.y = Math.max(0, this.y - n);
          else if (code === 'B') this.y = Math.min(this.rows - 1, this.y + n);
          else if (code === 'C') this.x = Math.min(this.cols - 1, this.x + n);
          else if (code === 'D') this.x = Math.max(0, this.x - n);
          else if (code === 'G') this.x = n - 1;
          else if (code === 'd') this.y = n - 1;
          else if (code === 'J' && [2, 3].includes(p[0])) this.clear();
          else if (code === 'K' && this.cells[this.y]) { const a = p[0] === 1 || p[0] === 2 ? 0 : this.x; const b = p[0] === 1 ? this.x + 1 : this.cols; this.cells[this.y].fill(' ', a, b); }
          else if (code === 'X' && this.cells[this.y]) this.cells[this.y].fill(' ', this.x, this.x + n);
          continue;
        }
        if (this.pending.startsWith('\x1b]')) { const osc = this.pending.match(/^\x1b\][\s\S]*?(?:\x07|\x1b\\)/); if (!osc) return; this.pending = this.pending.slice(osc[0].length); continue; }
        if (this.pending.length < 2 || this.pending[1] === '[') return;
        this.pending = this.pending.slice(2); continue;
      }
      const ch = Array.from(this.pending)[0]; this.pending = this.pending.slice(ch.length);
      if (ch === '\r') { this.x = 0; continue; }
      if (ch === '\n') { this.y++; if (this.y >= this.rows) { this.cells.shift(); this.cells.push(Array(this.cols).fill(' ')); this.y = this.rows - 1; } continue; }
      if (ch === '\b') { this.x = Math.max(0, this.x - 1); continue; }
      const width = codeWidth(ch.codePointAt(0)); if (!width) continue;
      if (this.x >= this.cols) { this.x = 0; this.y = Math.min(this.rows - 1, this.y + 1); }
      if (this.cells[this.y]) { this.cells[this.y][this.x] = ch; if (width === 2) this.cells[this.y][this.x + 1] = ''; } this.x += width;
    }
  }
  text() { return this.cells.map(row => row.join('').trimEnd()).join('\n'); }
}
let server;
let client;
let serverLog = '';
const sessions = [];
async function saveTerminal(session, label) {
  await writeFile(path.join(evidence, `${label}.txt`), session.screen.text());
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = session.screen.text().split('\n');
  await writeFile(path.join(evidence, `${label}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${session.screen.cols * 9 + 32}" height="${session.screen.rows * 21 + 40}"><rect width="100%" height="100%" fill="#11151b"/><g fill="#dce5ec" font-size="15" font-family="Consolas,Microsoft YaHei,monospace">${lines.map((line, i) => `<text x="16" y="${26 + i * 21}" xml:space="preserve">${escape(line)}</text>`).join('')}</g></svg>`);
}
function terminal(name) {
  const terminalProcess = pty.spawn(process.execPath, ['--import', 'tsx', 'src/system/cli.ts', 'tui', '--profile', profile, '--endpoint', endpoint], { name: 'xterm-256color', cwd, cols: 110, rows: 28, env: { ...process.env, BABEL_SYSTEM_PROFILE: profile }, useConpty: true });
  const session = { name, pty: terminalProcess, raw: '', screen: new Screen(110, 28), exit: undefined };
  sessions.push(session);
  terminalProcess.onData(data => { session.raw += data; session.screen.push(data); });
  terminalProcess.onExit(event => { session.exit = event; });
  return session;
}
const service = async () => (await client.query({ name: 'service', serviceId: 'terminal-fixture' })).snapshot;
const command = name => client.command({ name, serviceId: 'terminal-fixture', requestId: randomUUID() });
try {
  if (process.platform !== 'win32') throw new Error('This acceptance requires Windows ConPTY');
  const portProbe = net.createServer();
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(7783, '127.0.0.1', resolve); });
  await new Promise(resolve => portProbe.close(resolve));
  await mkdir(profile, { recursive: true });
  const worker = path.join(profile, 'fixture-worker.cjs');
  await writeFile(worker, 'console.log("终端验收进程启动 pid=" + process.pid); setInterval(() => console.log("中文心跳 " + new Date().toISOString()), 1000);\n');
  await writeFile(path.join(profile, 'catalog.json'), JSON.stringify({ version: 1, services: [{ id: 'terminal-fixture', label: '终端验收服务', kind: 'managed-process', target: 'terminal-fixture', executable: process.execPath, args: [worker], cwd: profile }] }, null, 2));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/system/main.ts'], { cwd, env: { ...process.env, BABEL_SYSTEM_PROFILE: profile, BABEL_SYSTEM_PORT: '7783' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { serverLog += data; }); server.stderr.on('data', data => { serverLog += data; });
  await waitFor('isolated service listening', () => serverLog.includes('listening on'));
  client = new SystemClient({ profile, endpoint });
  await step('isolated real adapter initially stopped', async () => { const snapshot = await service(); if (snapshot.state !== 'stopped') throw new Error(JSON.stringify(snapshot)); return snapshot; });
  const first = terminal('first-session');
  await step('ConPTY renders Chinese services and actual resources', async () => {
    await waitFor('service text', () => first.screen.text().includes('终端验收服务') && first.screen.text().includes('CPU'));
    await saveTerminal(first, '01-initial-services');
    return { pid: first.pty.pid, cols: 110, rows: 28, rawModeAndAlternateScreen: first.raw.includes('\x1b[?1049h') };
  });
  await step('keyboard starts real fixture process', async () => {
    first.pty.write('s'); const snapshot = await waitFor('running fixture', async () => { const state = await service(); return state.state === 'running' ? state : undefined; });
    await waitFor('start success rendered', () => first.screen.text().includes('成功: service.start'));
    await saveTerminal(first, '02-running'); return snapshot;
  });
  await step('mouse selects logs tab and renders real Chinese log', async () => {
    first.pty.write('\x1b[<0;20;5M\x1b[<0;20;5m');
    await waitFor('logs view', () => first.screen.text().includes('中文心跳'));
    await saveTerminal(first, '03-mouse-logs'); return { mouse: 'SGR down/up at x20 y5', logSource: 'real fixture stdout' };
  });
  await step('resize and help remain usable', async () => {
    first.screen.resize(72, 20); first.pty.resize(72, 20); first.pty.write('?');
    await waitFor('help', () => first.screen.text().includes('帮助（任意键返回）'));
    await saveTerminal(first, '04-resized-help'); first.pty.write(' '); await delay(300);
    return { cols: 72, rows: 20 };
  });
  await step('q exits and leaves managed process alive', async () => {
    first.pty.write('q'); await waitFor('first terminal exit', () => first.exit);
    const snapshot = await service(); if (snapshot.state !== 'running') throw new Error('q stopped background process');
    return { terminalExit: first.exit, background: snapshot, leaveAlternateScreen: first.raw.includes('\x1b[?1049l'), showCursor: first.raw.includes('\x1b[?25h') };
  });
  const second = terminal('second-session');
  await waitFor('second services', () => second.screen.text().includes('终端验收服务'));
  await step('mouse stops fixture and keyboard restarts it', async () => {
    second.pty.write('\x1b[<0;12;27M\x1b[<0;12;27m');
    const stopped = await waitFor('mouse stopped', async () => { const state = await service(); return state.state === 'stopped' ? state : undefined; });
    await waitFor('stop success', () => second.screen.text().includes('成功: service.stop'));
    await saveTerminal(second, '05-mouse-stopped'); second.pty.write('s');
    const running = await waitFor('second start', async () => { const state = await service(); return state.state === 'running' ? state : undefined; });
    await waitFor('start success', () => second.screen.text().includes('成功: service.start'));
    const pid = running.processes[0].pid;
    second.pty.write('r'); const restarted = await waitFor('new PID after restart', async () => { const state = await service(); return state.state === 'running' && state.processes[0]?.pid !== pid ? state : undefined; });
    await waitFor('restart success', () => second.screen.text().includes('成功: service.restart')); await saveTerminal(second, '06-restarted');
    return { stopped, running, restarted };
  });
  await step('unsupported autostart shows error without success', async () => {
    second.pty.write('a'); await waitFor('autostart error', () => second.screen.text().includes('无法切换未知自启状态')); await saveTerminal(second, '07-autostart-error'); return { renderedError: true };
  });
  await step('process identity confirmation cancels safely', async () => {
    const snapshot = await service(); const pid = snapshot.processes[0].pid;
    second.pty.write('2'); await waitFor('process list', () => second.screen.text().includes('PID / 名称'));
    second.pty.write('/' + pid + '\r'); await waitFor('filtered fixture', () => second.screen.text().includes(`> ${pid} `));
    second.pty.write('x'); await waitFor('confirmation', () => second.screen.text().includes('确认终止进程'));
    await saveTerminal(second, '08-process-confirmation'); second.pty.write('n');
    if ((await service()).state !== 'running') throw new Error('cancel terminated process');
    return { selectedPid: pid, startedAt: snapshot.processes[0].startedAt, cancelled: true };
  });
  await step('confirmed process termination affects only fixture identity', async () => {
    const before = await service(); second.pty.write('x');
    await waitFor('second confirmation', () => second.screen.text().includes('确认终止进程'));
    second.pty.write('y');
    const stopped = await waitFor('confirmed process terminated', async () => { const state = await service(); return state.state === 'stopped' ? state : undefined; });
    await waitFor('terminate success', () => second.screen.text().includes('成功: process.terminate'));
    await saveTerminal(second, '08b-process-terminated'); second.pty.write('1');
    await waitFor('service page', () => second.screen.text().includes('终端验收服务')); second.pty.write('s');
    const running = await waitFor('fixture restarted after terminate', async () => { const state = await service(); return state.state === 'running' ? state : undefined; });
    await waitFor('start success after termination', () => second.screen.text().includes('成功: service.start'));
    return { terminated: before.processes[0], stopped, running };
  });
  await step('history and Ctrl+C exit retain background process', async () => {
    second.pty.write('4'); await waitFor('operation history', () => second.screen.text().includes('service.restart'));
    await saveTerminal(second, '09-history'); second.pty.write('\x03'); await waitFor('second exit', () => second.exit);
    const snapshot = await service(); if (snapshot.state !== 'running') throw new Error('Ctrl+C stopped background process');
    return { terminalExit: second.exit, background: snapshot, leaveAlternateScreen: second.raw.includes('\x1b[?1049l') };
  });
  await step('CLI stable request ID retries without repeating real restart', async () => {
    const requestId = 'terminal-acceptance-retry';
    const cli = async action => {
      let output = '';
      const exitCode = await runSystemCli([action, 'terminal-fixture', '--profile', profile, '--endpoint', endpoint, '--request-id', requestId], { stdout: { write(text) { output += text; } }, stderr: { write() {} } });
      return { exitCode, response: JSON.parse(output) };
    };
    const first = await cli('restart'); const firstSnapshot = await service();
    const retried = await cli('restart'); const retrySnapshot = await service();
    const conflict = await cli('stop');
    const matching = (await client.query({ name: 'operations', limit: 100 })).filter(op => op.requestId === requestId);
    if (first.exitCode || retried.exitCode || first.response.result.id !== retried.response.result.id || firstSnapshot.processes[0].pid !== retrySnapshot.processes[0].pid || matching.length !== 1 || !conflict.exitCode || conflict.response.error.code !== 'CONFLICT') throw new Error('Idempotency contract failed');
    return { first, retried, firstSnapshot, retrySnapshot, rejectedDifferentCommand: conflict, operationCount: matching.length };
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = { message: error.message, stack: error.stack }; console.error(error);
  for (const session of sessions) await saveTerminal(session, `${session.name}-failure`).catch(() => {});
} finally {
  for (const session of sessions) { if (!session.exit) { session.pty.write('\x03'); await delay(500); if (!session.exit) session.pty.kill(); } await writeFile(path.join(evidence, `${session.name}.ansi`), session.raw); }
  if (client) {
    try {
      const snapshot = await service();
      if (snapshot.state === 'running') report.cleanup.stopOperation = await command('service.stop');
      report.cleanup.finalService = await service();
      report.cleanup.noFixtureProcess = report.cleanup.finalService.state === 'stopped';
      await writeFile(path.join(evidence, 'operations.json'), JSON.stringify(await client.query({ name: 'operations', limit: 100 }), null, 2));
      await writeFile(path.join(evidence, 'events.json'), JSON.stringify(await client.query({ name: 'events', limit: 100 }), null, 2));
      const token = (await readFile(path.join(profile, 'service.token'), 'utf8')).trim();
      const response = await fetch(endpoint + '/v1/shutdown', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      report.cleanup.shutdown = await response.json();
    } catch (error) { report.cleanup.error = error.message; report.passed = false; }
  }
  if (server) { await waitFor('isolated controller exit', () => server.exitCode !== null, 15000).catch(() => server.kill()); report.cleanup.serverExitCode = server.exitCode; }
  report.finishedAt = new Date().toISOString();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'controller.log'), serverLog);
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(evidenceRoot, 'latest-run.txt'), evidence + '\n');
  // ConPTY's native host can retain handles after both terminal exit events.
  // All owned workers/controller have been shut down before exiting this driver.
  process.stdout.write(JSON.stringify({ passed: report.passed, evidence, cleanup: report.cleanup }) + '\n', () => process.exit(report.passed ? 0 : 1));
}
