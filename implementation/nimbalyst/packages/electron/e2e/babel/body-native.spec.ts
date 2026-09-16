import { test, expect, chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const projectId = 'fixture-project-babel';
const endpoint = process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780';
async function api(route: string, name: string, input: Record<string, unknown>) {
  const response = await fetch(`${endpoint}/v2/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, projectId, input }),
  });
  const result = await response.json();
  expect(response.ok, JSON.stringify(result)).toBe(true);
  return result;
}

test('native body explicitly saves and preserves a conflicting draft across tasks', async ({}, info) => {
  test.setTimeout(90_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native Electron demo');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const workspace = process.env.BABEL_ACCEPTANCE_WORKSPACE;
  expect(workspace, 'Explicit isolated workspace required').toBeTruthy();
  const candidates = browser.contexts()[0].pages().filter(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='));
  let page = candidates[0];
  for (const candidate of candidates) {
    if (await candidate.getByTestId('babel-body-editor').count()) {
      const back = candidate.getByRole('button', { name: 'Back to tracker', exact: true });
      if (await back.isVisible()) await back.click();
    }
    if ((await candidate.locator('body').innerText()).includes(workspace!)) { page = candidate; break; }
  }
  expect(await page.locator('body').innerText(), 'Must be the isolated Babel workspace').toContain(workspace!);
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15_000);
  try {
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if (await tracker.getAttribute('aria-pressed') !== 'true') await tracker.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const attention = page.getByTestId('babel-attention-toggle');
    if (await attention.getAttribute('aria-pressed') === 'true') await attention.click();
    const initial = `原生正文验收-${Date.now()}`;
    const created = await api('command', 'task.create', { title: initial, markdown: '正文初稿' });
    const id = created.trackerId;
    const current = () => api('query', 'task.get', { trackerId: id });
    const todo = page.getByTestId('babel-stage-tab-TODO');
    if (await todo.isVisible()) await todo.click();
    const select = async (trackerId: string) => page.locator(`[data-tracker-id="${trackerId}"]`).getByRole('button').first().click();
    await select(id);
    const region = page.getByRole('region', { name: 'Babel 正文' });
    const body = region.locator('[contenteditable="true"]');
    await expect(body).toContainText('正文初稿');
    await body.fill('本地中文正文已编辑');
    const save = () => region.getByRole('button', { name: '保存正文', exact: true });
    await expect(save()).toBeEnabled();
    expect((await current()).record.content.markdown).toBe('正文初稿');
    await save().click();
    await expect.poll(async () => (await current()).record.content.markdown.trim()).toBe('本地中文正文已编辑');
    await expect(save()).toHaveCount(0);

    await body.fill('保留跨任务的中文草稿');
    const focus = page.getByTestId('tracker-content-focus-toggle');
    await focus.click();
    await expect(body).toContainText('保留跨任务的中文草稿');
    await page.getByRole('button', { name: 'Back to tracker', exact: true }).click();
    await expect(body).toContainText('保留跨任务的中文草稿');
    const other = await api('command', 'task.create', { title: `正文切换对照-${Date.now()}`, markdown: '另一任务正文' });
    await select(other.trackerId);
    await expect(body).toContainText('另一任务正文');
    await select(id);
    await expect(body).toContainText('保留跨任务的中文草稿');
    await api('command', 'task.update', { trackerId: id, markdown: '另一客户端写入的远端新正文' });
    await expect(region.getByRole('alert')).toContainText('正文版本已变化');
    await expect(body).toContainText('保留跨任务的中文草稿');
    await expect(save()).toBeDisabled();
    expect((await current()).record.content.markdown).toBe('另一客户端写入的远端新正文');
    await region.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('body-conflict-native.png') });
    await region.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
    await expect(save()).toBeEnabled();
    expect((await current()).record.content.markdown).toBe('另一客户端写入的远端新正文');
    await save().click();
    await expect.poll(async () => (await current()).record.content.markdown.trim()).toBe('保留跨任务的中文草稿');
    await expect(save()).toHaveCount(0);
    await body.fill('放弃这份草稿');
    await api('command', 'task.update', { trackerId: id, markdown: '最后采用远端正文' });
    await region.getByRole('button', { name: '采用远端正文', exact: true }).click();
    await expect(body).toContainText('最后采用远端正文');
    expect((await current()).binding.latestRunId).toBeNull();
    writeFileSync(info.outputPath('body-evidence.json'), JSON.stringify({
      trackerId: id, projectId, mode: 'demo', final: await current(),
      viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio, theme: document.documentElement.getAttribute('data-theme') })),
      verified: ['native-explicit-body-save', 'no-autosave', 'draft-survives-task-switch', 'draft-survives-content-focus-toggle', 'conflict-no-overwrite', 'explicit-rebase-before-save', 'choose-remote', 'no-run-started'],
      notVerified: ['independent acceptance session', 'real PTY', 'VoiceOver', 'full rich Markdown format coverage', 'full CAP-04'],
    }, null, 2));
  } finally { await browser.close(); }
});
