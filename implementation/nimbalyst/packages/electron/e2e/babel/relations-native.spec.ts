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
  const { stdout } = await exec(
    process.execPath,
    ['--import', 'tsx', 'src/cli/main.ts', ...args, '--project', projectId, '--endpoint', endpoint, '--json'],
    { cwd }
  );
  return JSON.parse(stdout);
}
test('native dependency drafts, reverse revisions, cycles and real PTY removals share one authority', async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires isolated native demo');
  const workspace = process.env.BABEL_ACCEPTANCE_WORKSPACE;
  expect(workspace).toBeTruthy();
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const candidates = browser
    .contexts()[0]
    .pages()
    .filter((p) => p.url().startsWith('http://localhost:') && !p.url().includes('mode='));
  let page = candidates[0];
  for (const candidate of candidates)
    if ((await candidate.locator('body').innerText()).includes(workspace!)) {
      page = candidate;
      break;
    }
  expect(await page.locator('body').innerText()).toContain(workspace!);
  page.setDefaultTimeout(15000);
  const pty = loadModule('node-pty');
  let terminal: ReturnType<typeof pty.spawn> | undefined;
  let output = '',
    history = '';
  try {
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if ((await tracker.getAttribute('aria-pressed')) !== 'true') await tracker.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const attention = page.getByTestId('babel-attention-toggle');
    if ((await attention.getAttribute('aria-pressed')) === 'true') await attention.click();
    const stamp = Date.now();
    const titles = ['关系甲', '关系乙', '关系丙'].map((v) => `${v}-${stamp}`);
    const ids: string[] = [];
    for (const title of titles) ids.push((await cli('task', 'create', '--name', title)).trackerId);
    const [a, b, c] = ids;
    const read = (id: string) => cli('task', 'get', '--id', id);
    async function select(id: string) {
      const todo = page.getByTestId('babel-stage-tab-TODO');
      if (await todo.isVisible()) await todo.click();
      await page.locator(`[data-tracker-id="${id}"]`).getByRole('button').first().click();
    }
    async function addDependency(id: string) {
      await page.getByTestId('tracker-detail-field-pill-dependsOn').click();
      const editor = page.getByTestId('relationship-field-dependsOn');
      await editor.getByRole('button', { name: 'Add link', exact: true }).click();
      const input = editor.getByRole('combobox');
      await input.fill(id);
      await input.press('Enter');
      await input.press('Escape');
      await expect(editor.getByRole('button', { name: 'Add link', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
    }
    await select(a);
    await addDependency(b);
    expect((await read(a)).record.fields.dependsOn).toEqual([]);
    await page.getByTestId('babel-relations-save').click();
    await expect.poll(async () => (await read(a)).record.fields.dependsOn).toEqual([b]);
    expect((await read(b)).record.fields.blocks).toEqual([a]);
    expect((await read(b)).record.revision).toBe(2);
    const guiSaved = await Promise.all(ids.map(read));
    await addDependency(c);
    const patch = info.outputPath('clear-relations.json');
    writeFileSync(patch, JSON.stringify({ dependsOn: [] }));
    await cli(
      'relation',
      'set',
      '--id',
      a,
      '--input',
      patch,
      '--expected-revision',
      String(guiSaved[0].record.revision)
    );
    await expect(page.getByTestId('babel-relations-conflict')).toBeVisible();
    await expect(page.getByTestId('babel-relations-save')).toBeDisabled();
    await page.getByTestId('babel-relations-conflict').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('relations-conflict-native.png') });
    await page.getByTestId('babel-relations-continue').click();
    expect((await read(a)).record.fields.dependsOn).toEqual([]);
    await page.getByTestId('babel-relations-save').click();
    await expect.poll(async () => (await read(a)).record.fields.dependsOn).toEqual([b, c]);
    await select(b);
    await addDependency(a);
    const beforeCycle = await Promise.all(ids.map(read));
    await page.getByTestId('babel-relations-save').click();
    await expect(page.getByRole('alert').filter({ hasText: '循环' })).toBeVisible();
    expect(await Promise.all(ids.map(read))).toEqual(beforeCycle);
    await page.getByRole('button', { name: '撤销关系修改', exact: true }).click();
    terminal = pty.spawn(
      process.execPath,
      ['--import', 'tsx', 'src/tui/main.ts', '--project', projectId, '--endpoint', endpoint],
      { cwd, cols: 160, rows: 44, name: 'xterm-256color', env: { ...process.env } }
    );
    terminal.onData((data: string) => {
      output += data;
      history += data;
    });
    await expect.poll(() => output).toContain('演示');
    terminal.write('/' + titles[1] + '\r');
    await expect.poll(() => output).toContain(`阻塞 ${a.slice(0, 20)}`);
    output = '';
    terminal.write('l');
    await expect.poll(() => output).toContain('设置依赖关系');
    terminal.write('\t' + '\x7f'.repeat(a.length) + '\x13\x13');
    await expect.poll(async () => (await read(b)).record.fields.blocks).toEqual([]);
    expect((await read(b)).record.revision).toBe(beforeCycle[1].record.revision + 1);
    expect((await read(a)).record.fields.dependsOn).toEqual([c]);
    await select(a);
    await expect(page.getByTestId('tracker-detail-field-pill-dependsOn')).toContainText(titles[2]);
    const tuiSaved = await Promise.all(ids.map(read));
    output = '';
    terminal.write('/' + '\x7f'.repeat(titles[1].length) + titles[2] + '\r');
    await expect.poll(() => output).toContain(`阻塞 ${a.slice(0, 20)}`);
    output = '';
    terminal.write('l');
    await expect.poll(() => output).toContain('设置依赖关系');
    terminal.write(a + '\x13');
    await expect.poll(() => output).toContain('循环');
    expect(await Promise.all(ids.map(read))).toEqual(tuiSaved);
    output = '';
    terminal.write('\x1b');
    await expect.poll(() => output).toContain('q 退出');
    terminal.write('q');
    await expect.poll(() => history).toContain('\x1b[?1049l');
    expect(tuiSaved.every((detail) => detail.binding.latestRunId === null)).toBe(true);
    writeFileSync(
      info.outputPath('relations-evidence.json'),
      JSON.stringify(
        {
          projectId,
          trackerIds: ids,
          mode: 'demo',
          guiSaved,
          beforeCycle,
          tuiSaved,
          verified: [
            'native-explicit-save',
            'reverse-fields-and-revisions',
            'native-picker-keyboard-focus',
            'GUI-conflict-draft-rebase',
            'GUI-cycle-rejection',
            'real-PTY-reverse-removal',
            'duplicate-save-once',
            'GUI-refresh-after-PTY',
            'real-PTY-cycle-draft-preserved',
            'terminal-restored',
            'no-run-started',
          ],
          notVerified: [
            'independent acceptance',
            'arbitrary relationship types',
            'all platform/theme/IME/VoiceOver combinations',
          ],
        },
        null,
        2
      )
    );
  } finally {
    writeFileSync(info.outputPath('relations-pty.txt'), history);
    terminal?.kill();
    await browser.close();
  }
});
