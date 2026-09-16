import { test, expect, chromium, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// One serial spec against an explicitly started, isolated native instance.
// The executable guard below is mandatory: this test never authorizes a model call.
test.describe.configure({ mode: 'serial' });
const exec = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const cwd = path.join(source, 'packages/babel');
const loadModule = createRequire(path.join(source, 'package.json'));
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

type Run = {
  id: string;
  status: string;
  sessionId: string | null;
  execution?: { kind: string; workdir: string; provider: string; model: string };
  messages: Array<{ role: string; text: string }>;
  verification: unknown[];
  review: unknown;
  diff: unknown;
};
type Task = {
  mode: string;
  stage: string;
  executionTarget: { workdir: string; provider: string; model: string };
  record: { id: string; revision: number; fields: { title: string } };
  binding: { latestRunId: string | null };
  latestRun: Run | null;
};

async function exactWorkspacePage(pages: Page[], workspace: string): Promise<Page> {
  const matches: Page[] = [];
  for (const page of pages) {
    const url = new URL(page.url());
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.searchParams.has('mode')) continue;
    const match = await page.evaluate(expected => {
      // Require an exact workspace value; never fall back to the first window.
      const tagged = [...document.querySelectorAll('[title], [data-workspace-path]')]
        .some(node => node.getAttribute('title') === expected || node.getAttribute('data-workspace-path') === expected);
      const text = [...document.querySelectorAll('body *')]
        .some(node => node.children.length === 0 && node.textContent?.trim() === expected);
      return tagged || text;
    }, workspace);
    if (match) matches.push(page);
  }
  expect(matches, `Exactly one native window must identify workspace ${workspace}`).toHaveLength(1);
  return matches[0]!;
}

test('local Pi protocol double: native start, real PTY session, CLI identity and confirmed stop', async ({}, info) => {
  test.setTimeout(180_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native local-mode Electron instance');
  const required = (name: string) => {
    const value = process.env[name];
    expect(value, `${name} must be explicitly set for the protocol-double test`).toBeTruthy();
    return value!;
  };
  const cdp = required('BABEL_ACCEPTANCE_CDP');
  const endpoint = required('BABEL_ENDPOINT');
  const projectId = required('BABEL_PROJECT_ID');
  const workspace = realpathSync(required('BABEL_ACCEPTANCE_WORKSPACE'));
  const profile = realpathSync(required('BABEL_PROFILE'));
  const config = JSON.parse(readFileSync(required('BABEL_LOCAL_PI_CONFIG'), 'utf8')) as {
    projectId: string; workdir: string; executable: string; agentDir: string; provider: string; model: string;
  };
  for (const address of [cdp, endpoint]) {
    const url = new URL(address);
    expect(url.protocol).toBe('http:');
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  }
  expect(projectId).toBe('pi-protocol-validation');
  expect(config.projectId).toBe(projectId);
  expect(realpathSync(config.executable)).toBe(realpathSync(path.join(cwd, 'tests/fixtures/pi-runtime-double.mjs')));
  expect(realpathSync(config.workdir)).toBe(workspace);
  expect(realpathSync(config.agentDir)).toBe(realpathSync(path.join(profile, 'pi-agent')));
  const token = readFileSync(path.join(profile, 'service.token'), 'utf8').trim();
  expect(Boolean(token), 'Dedicated service token must exist').toBe(true);
  const childEnv = { ...process.env, BABEL_SERVICE_TOKEN: token };
  const redact = (text: string) => text.split(token).join('[redacted]');
  async function cli<T = Record<string, unknown>>(...args: string[]): Promise<T> {
    try {
      const { stdout } = await exec(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args,
        '--project', projectId, '--endpoint', endpoint, '--json'], { cwd, env: childEnv, windowsHide: true });
      return JSON.parse(stdout) as T;
    } catch (error) {
      const failed = error as { message?: string; stderr?: string; stdout?: string };
      throw new Error(redact([failed.message, failed.stderr, failed.stdout].filter(Boolean).join('\n')));
    }
  }
  const browser = await chromium.connectOverCDP(cdp);
  const pty = loadModule('node-pty');
  let terminal: ReturnType<typeof pty.spawn> | undefined;
  let output = '';
  let history = '';
  let page: Page | undefined;
  let previousTheme: string | undefined;
  let id = '';
  let runId = '';
  let read: (() => Promise<Task>) | undefined;
  try {
    page = await exactWorkspacePage(browser.contexts().flatMap(context => context.pages()), workspace);
    page.setDefaultTimeout(15_000);
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if (await tracker.getAttribute('aria-pressed') !== 'true') await tracker.click();
    const sidebar = page.getByRole('button', { name: 'Show Tracker sidebar', exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const attention = page.getByTestId('babel-attention-toggle');
    if (await attention.getAttribute('aria-pressed') === 'true') await attention.click();
    await page.setViewportSize({ width: 1500, height: 1000 });
    const todo = page.getByTestId('babel-stage-tab-TODO');
    if (await todo.isVisible()) await todo.click();

    const title = `Pi 协议测试（不调用模型）-${Date.now()}`;
    await page.getByTestId('babel-execution-create-todo').click();
    await page.getByPlaceholder('New task...').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(async () => {
      const listed = await cli<{ mode: string; items: Array<{ trackerId: string; title: string }> }>('task', 'list');
      expect(listed.mode).toBe('local');
      const exact = listed.items.filter(item => item.title === title);
      expect(exact.length).toBeLessThanOrEqual(1);
      id = exact[0]?.trackerId || '';
      return id;
    }).not.toBe('');
    read = () => cli<Task>('task', 'get', '--id', id);
    const initial = await read();
    expect(initial.record.fields.title).toBe(title);
    expect(initial.mode).toBe('local');
    expect(initial.executionTarget).toEqual({ workdir: workspace, provider: config.provider, model: config.model });
    expect(initial.latestRun).toBeNull();
    await page.locator(`[data-tracker-id="${id}"]`).getByRole('button').first().click();
    const detail = page.getByTestId('babel-execution-detail');
    await expect(detail).toContainText('本机 Pi');
    const controls = detail.getByTestId('babel-run-controls');
    const start = controls.getByRole('button', { name: '开始执行', exact: true });
    await start.click();
    const confirmation = page.getByRole('dialog', { name: '确认开始 Pi 执行', exact: true });
    for (const text of [title, workspace, config.provider, config.model]) await expect(confirmation).toContainText(text);
    expect((await read()).latestRun).toBeNull();
    await confirmation.getByRole('button', { name: '返回', exact: true }).click();
    expect((await read()).latestRun).toBeNull();
    await start.click();
    await confirmation.getByRole('button', { name: '确认开始执行', exact: true }).click();
    await expect.poll(async () => {
      const task = await read!();
      runId = task.latestRun?.id || '';
      return task.latestRun?.status;
    }).toBe('executing');
    const started = await read();
    const sessionId = started.latestRun!.sessionId!;
    expect(sessionId).toBe('protocol-double-session');
    expect(started.latestRun!.execution).toMatchObject({ kind: 'pi', ...initial.executionTarget });
    expect(started.binding.latestRunId).toBe(runId);
    await page.getByTestId('babel-detail-tab-session').click();
    await expect(detail).toContainText(sessionId);
    await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi');

    terminal = pty.spawn(process.execPath, ['--import', 'tsx', 'src/tui/main.ts', '--project', projectId, '--endpoint', endpoint],
      { cwd, cols: 220, rows: 48, name: 'xterm-256color', env: childEnv });
    terminal.onData((data: string) => { output += data; history += data; });
    await expect.poll(() => stripAnsi(output)).toContain('本地 Pi');
    output = '';
    terminal.write('/' + title + '\r');
    await expect.poll(() => stripAnsi(output)).toContain(title);
    output = '';
    terminal.write('F');
    await expect.poll(() => stripAnsi(output)).toContain(`记录 ${id}`);
    output = '';
    // The terminal decoder waits for another byte to disambiguate bare Escape.
    terminal.write('\x1b ');
    await expect.poll(() => stripAnsi(output)).toContain('S 查看会话输入与输出');
    output = '';
    terminal.write('S');
    for (const identity of [runId, sessionId, workspace, `${config.provider}/${config.model}`, '你好 Pi']) {
      await expect.poll(() => stripAnsi(output)).toContain(identity);
    }
    const shown = await cli<{ mode: string; run: Run }>('run', 'show', '--id', runId);
    expect(shown.mode).toBe('local');
    expect(shown.run.id).toBe(runId);
    expect(shown.run.sessionId).toBe(sessionId);

    previousTheme = await page.evaluate(() => (window as unknown as { electronAPI: { getTheme(): Promise<string> } }).electronAPI.getTheme());
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => (window as unknown as { electronAPI: { setTheme(value: string): Promise<void> } }).electronAPI.setTheme(value), theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.screenshot({ path: info.outputPath(`pi-protocol-${theme}.png`) });
    }

    output = '';
    terminal.write('m');
    await expect.poll(() => stripAnsi(output)).toContain('发送消息');
    terminal.write('finish\r');
    await expect.poll(async () => (await read!()).latestRun?.status).toBe('review_required');
    const settled = await read();
    expect(settled.latestRun!.messages.some(message => message.role === 'user' && message.text === 'finish')).toBe(true);
    await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi 完整');
    await expect(controls.getByRole('button', { name: '验收完成', exact: true })).toBeDisabled();
    expect(settled.stage).not.toBe('DONE');
    expect(settled.latestRun!.verification).toEqual([]);
    expect(settled.latestRun!.diff).toBeNull();
    expect(settled.latestRun!.review).toBeNull();
    await detail.getByRole('button', { name: '请求取消', exact: true }).click();
    await expect.poll(async () => (await read!()).latestRun?.status).toBe('cancelled');
    const stopped = await read();
    expect(stopped.stage).not.toBe('DONE');
    expect(stopped.latestRun!.id).toBe(runId);
    expect(stopped.latestRun!.sessionId).toBe(sessionId);
    expect(stopped.latestRun!.review).toBeNull();
    await expect.poll(() => stripAnsi(output)).toContain('已取消');
    terminal.write('q');
    await expect.poll(() => history).toContain('\x1b[?1049l');
    writeFileSync(info.outputPath('pi-protocol-identity.json'), JSON.stringify({
      mode: 'local', evidenceKind: 'native-and-real-PTY-with-RPC-protocol-double', modelExecutionVerified: false,
      projectId, trackerId: id, runId, sessionId, workspace,
      initial, started, settled, stopped,
      verified: ['native-create', 'cancel-start-confirmation-does-not-launch', 'native-confirmed-target', 'streamed-output',
        'real-PTY-task-run-session-identity', 'PTY-message-to-same-run', 'authenticated-CLI-readback', 'native-confirmed-stop',
        'no-fake-DONE-or-verification', 'light-dark-native-screenshots', 'PTY-alternate-screen-restored'],
      notVerified: ['real-provider-or-model-call', 'real-tool-edit', 'real-diff-and-test-evidence', 'independent-acceptance-session'],
    }, null, 2));
  } finally {
    writeFileSync(info.outputPath('pi-protocol-pty.txt'), redact(history));
    terminal?.kill();
    // Stop only the run created here if an assertion interrupted the flow.
    if (runId && read) {
      try {
        const task = await read();
        if (['requested', 'accepted', 'executing', 'review_required', 'cancel_requested'].includes(task.latestRun?.status || '')) {
          await cli('run', 'cancel', '--id', runId, '--idempotency-key', `cleanup-${runId}`);
        }
      } catch (error) {
        writeFileSync(info.outputPath('pi-protocol-cleanup-error.txt'), redact(String(error)));
      }
    }
    if (page && previousTheme) {
      await page.evaluate(value => (window as unknown as { electronAPI: { setTheme(value: string): Promise<void> } }).electronAPI.setTheme(value), previousTheme);
    }
    await browser.close();
  }
});
