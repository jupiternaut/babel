import { test, expect, chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { writeFileSync } from 'node:fs';

const exec = promisify(execFile);
const projectId = 'fixture-project-babel';
const endpoint = process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780';
const cwd = path.resolve('packages/babel');
const loadModule = createRequire(path.resolve('package.json'));
async function cli(...args: string[]) {
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args,
    '--project', projectId, '--endpoint', endpoint, '--json'], { cwd });
  return JSON.parse(stdout);
}

test('native fields, real PTY and CLI share revisions and retain conflicting GUI drafts', async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native demo');
  const workspace = process.env.BABEL_ACCEPTANCE_WORKSPACE;
  expect(workspace, 'Explicit isolated workspace required').toBeTruthy();
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const candidates = browser.contexts()[0].pages().filter(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='));
  let page = candidates[0];
  for (const candidate of candidates) {
    if ((await candidate.locator('body').innerText()).includes(workspace!)) { page = candidate; break; }
  }
  expect(await page.locator('body').innerText()).toContain(workspace!);
  page.setDefaultTimeout(15_000);
  const pty = loadModule('node-pty');
  let terminal: ReturnType<typeof pty.spawn> | undefined;
  let output = '';
  let history = '';
  try {
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if (await tracker.getAttribute('aria-pressed') !== 'true') await tracker.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const attention = page.getByTestId('babel-attention-toggle');
    if (await attention.getAttribute('aria-pressed') === 'true') await attention.click();
    const title = `原生字段复验-${Date.now()}`;
    const created = await cli('task', 'create', '--name', title);
    const id = created.trackerId;
    const read = () => cli('task', 'get', '--id', id);
    const todo = page.getByTestId('babel-stage-tab-TODO');
    if (await todo.isVisible()) await todo.click();
    await page.locator(`[data-tracker-id="${id}"]`).getByRole('button').first().click();
    const owner = page.getByTestId('babel-owner-field').locator('input');
    await owner.fill('界面负责人');
    await page.getByTestId('tracker-detail-field-pill-priority').click();
    await page.getByRole('option').filter({ has: page.getByText('High', { exact: true }) }).click();
    const tags = page.getByTestId('tracker-detail-tags').locator('input');
    await tags.fill('玻璃界面');
    await tags.press('Enter');
    expect((await read()).record.fields.owner || '').toBe('');
    await page.getByTestId('babel-fields-save').click();
    await expect.poll(async () => (await read()).record.fields.owner).toBe('界面负责人');
    const guiSaved = await read();
    expect(guiSaved.record.fields).toMatchObject({ priority: 'high', tags: ['玻璃界面'] });
    await expect(page.getByTestId('babel-fields-save')).toHaveCount(0);

    terminal = pty.spawn(process.execPath, ['--import', 'tsx', 'src/tui/main.ts', '--project', projectId, '--endpoint', endpoint],
      { cwd, cols: 160, rows: 44, name: 'xterm-256color', env: { ...process.env }, ...(process.platform === 'win32' ? { useConpty: true } : {}) });
    terminal.onData((data: string) => { output += data; history += data; });
    await expect.poll(() => output).toContain('演示');
    terminal.write('/' + title + '\r');
    await expect.poll(() => output).toContain('负责人 界面负责人');
    output = '';
    terminal.write('F');
    await expect.poll(() => output).toContain('编辑字段');
    terminal.write('\x7f'.repeat(4) + 'critical\t' + '\x7f'.repeat('界面负责人'.length) + '终端负责人\t' + '\x7f'.repeat('玻璃界面'.length) + '终端复验，中文标签');
    terminal.write('\x13\x13');
    await expect.poll(async () => (await read()).record.fields.owner).toBe('终端负责人');
    const tuiSaved = await read();
    expect(tuiSaved.record.revision).toBe(guiSaved.record.revision + 1);
    expect(tuiSaved.record.fields).toMatchObject({ priority: 'critical', tags: ['终端复验', '中文标签'] });
    await expect(owner).toHaveValue('终端负责人');
    await owner.fill('冲突中的本地负责人');
    const patchFile = info.outputPath('remote-fields.json');
    writeFileSync(patchFile, JSON.stringify({ owner: '远端负责人' }));
    await cli('task', 'update', '--id', id, '--input', patchFile, '--expected-revision', String(tuiSaved.record.revision));
    await expect(page.getByTestId('babel-fields-conflict')).toContainText('远端负责人');
    await expect(owner).toHaveValue('冲突中的本地负责人');
    await expect(page.getByTestId('babel-fields-save')).toBeDisabled();
    await page.getByTestId('babel-fields-conflict').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('fields-conflict-native.png') });
    await page.getByTestId('babel-fields-continue').click();
    expect((await read()).record.fields.owner).toBe('远端负责人');
    await page.getByTestId('babel-fields-save').click();
    await expect.poll(async () => (await read()).record.fields.owner).toBe('冲突中的本地负责人');
    const final = await read();
    expect(final.binding.latestRunId).toBeNull();
    expect(final.record.fields.priority).toBe('critical');
    expect(final.record.fields.tags).toEqual(['终端复验', '中文标签']);
    terminal.write('q');
    await expect.poll(() => history).toContain('\x1b[?1049l');
    writeFileSync(info.outputPath('fields-evidence.json'), JSON.stringify({
      projectId, trackerId: id, mode: 'demo', guiSaved, tuiSaved, final,
      verified: ['native-explicit-three-field-save', 'CLI-readback', 'real-PTY-field-edit', 'duplicate-save-once', 'GUI-updates-from-PTY', 'GUI-conflict-draft-preserved', 'explicit-rebase', 'only-changed-fields-written', 'terminal-alternate-screen-restored', 'no-run-started'],
      notVerified: ['independent acceptance session', 'full CAP-04/16', 'all platform/theme/accessibility combinations'],
    }, null, 2));
  } finally {
    writeFileSync(info.outputPath('fields-pty.txt'), history);
    terminal?.kill();
    await browser.close();
  }
});
