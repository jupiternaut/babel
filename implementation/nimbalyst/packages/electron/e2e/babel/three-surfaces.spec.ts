import { test, expect, chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const exec = promisify(execFile);
const project = 'fixture-project-babel';
const endpoint = process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780';
const cwd = path.resolve('packages/babel');
const loadModule = createRequire(path.resolve('package.json'));

async function cli(...args: string[]) {
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args,
    '--project', project, '--endpoint', endpoint, '--json'], { cwd, windowsHide: true });
  return JSON.parse(stdout);
}
async function query(name: string, input: Record<string, unknown> = {}) {
  const response = await fetch(`${endpoint}/v2/query`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, projectId: project, input }) });
  return response.json();
}

test('native host, CLI and real ConPTY share task identity and lifecycle', async ({}, info) => {
  test.setTimeout(180_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated running Electron instance and demo service');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => p.url().includes('5273'))!;
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15_000);
  const pty = loadModule('node-pty');
  let terminal: ReturnType<typeof pty.spawn> | undefined;
  let output = '';
  const suffix = Date.now();
  const title = `验收中文任务-${suffix}`;
  try {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    if (await page.getByTestId('babel-stage-tab-TODO').count()) await page.getByTestId('babel-stage-tab-TODO').click();
    await page.getByTestId('babel-execution-create-todo').click();
    await page.getByPlaceholder('New task...').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    let id = '';
    await expect.poll(async () => {
      const listed = await query('task.list', { q: title, types: 'all', statusScope: 'all' });
      id = listed.items[0]?.trackerId || '';
      return id;
    }).not.toBe('');
    await expect(page.locator(`[data-tracker-id="${id}"]`)).toContainText(title);
    const detail = await cli('task', 'get', '--id', id);
    expect(detail.record.fields.title).toBe(title);

    terminal = pty.spawn(process.execPath, ['--import', 'tsx', 'src/tui/main.ts', '--project', project, '--endpoint', endpoint],
      { cwd, cols: 220, rows: 48, name: 'xterm-256color', env: { ...process.env }, useConpty: true });
    terminal.onData((data: string) => { output += data; });
    await expect.poll(() => output, { timeout: 15000 }).toContain('演示');
    terminal.write('/');
    terminal.write(title);
    output = '';
    terminal.write('\r');
    await expect.poll(() => output).toContain('任务 · TODO · rev 1');
    expect(output).toContain(title);
    terminal.write('s');
    let runId = '';
    await expect.poll(async () => {
      const task = await cli('task', 'get', '--id', id);
      runId = task.binding.latestRunId || '';
      return runId;
    }).not.toBe('');
    await expect.poll(() => output).toContain(runId);
    await expect.poll(async () => (await query('run.show', { runId })).run.status, { timeout: 30000 }).toBe('review_required');
    const narrow = page.getByTestId('babel-stage-tab-RUNNING');
    if (await narrow.count()) await narrow.click();
    await page.locator(`[data-tracker-id="${id}"]`).getByText(title, { exact: true }).click();
    await page.getByTestId('babel-detail-tab-history').click();
    await expect(page.getByTestId('babel-execution-detail')).toContainText(runId);
    await page.getByRole('button', { name: '验收完成', exact: true }).click();
    await expect.poll(async () => (await cli('task', 'get', '--id', id)).stage).toBe('DONE');
    await expect.poll(() => output).toContain('完成');
    await page.getByRole('button', { name: '原生', exact: true }).click();
    await page.getByRole('button', { name: 'All', exact: true }).last().click();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();

    // Closing the GUI must not terminate a still-active run owned by the service.
    const input = info.outputPath('create.json');
    writeFileSync(input, JSON.stringify({ title: `窗口关闭验收-${suffix}`, primaryType: 'task' }));
    const created = await cli('task', 'create', '--input', input);
    const started = await cli('run', 'start', '--task', created.trackerId, '--idempotency-key', `close-${suffix}`);
    expect(started.settled).toBe(false);
    expect(['requested', 'accepted', 'executing', 'verifying']).toContain((await query('run.show', { runId: started.runId })).run.status);
    await page.screenshot({ path: info.outputPath('native-host.png') });
    await page.evaluate(() => window.close());
    await expect.poll(async () => (await cli('run', 'show', '--id', started.runId)).run.status, { timeout: 30000 }).toBe('review_required');
    terminal.resize(90, 30);
    terminal.write('/');
    for (const _ of title) terminal.write('\x7f');
    terminal.write(`窗口关闭验收-${suffix}`); output = ''; terminal.write('\r');
    await expect.poll(() => output).toContain('待验收');
    terminal.write('v');
    await expect.poll(() => output).toContain('验收这次模拟结果');
    terminal.write('\r');
    await expect.poll(async () => (await cli('task', 'get', '--id', created.trackerId)).stage).toBe('DONE');
    terminal.write('q');
    writeFileSync(info.outputPath('identity.json'), JSON.stringify({ project, trackerId: id, runId, survivesWindowCloseRun: started.runId }, null, 2));
  } finally {
    writeFileSync(info.outputPath('conpty.txt'), output);
    terminal?.kill();
    await browser.close();
  }
});
