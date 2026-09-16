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

test('native title editing saves through the shared service and preserves a conflicting draft', async ({}, info) => {
  test.setTimeout(90_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native Electron demo');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='))!;
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
    const initial = `原生标题验收-${Date.now()}`;
    const created = await api('command', 'task.create', { title: initial });
    const id = created.trackerId;
    const current = () => api('query', 'task.get', { trackerId: id });
    const todo = page.getByTestId('babel-stage-tab-TODO');
    if (await todo.isVisible()) await todo.click();
    await page.locator(`[data-tracker-id="${id}"]`).getByText(initial, { exact: true }).click();
    const title = page.getByPlaceholder('Item title...', { exact: true });
    await expect(title).toHaveValue(initial);
    await title.fill('原生编辑中文标题');
    await page.getByTestId('babel-title-save').click();
    await expect.poll(async () => (await current()).record.fields.title).toBe('原生编辑中文标题');

    await api('command', 'task.update', { trackerId: id, title: '其他客户端已修改标题' });
    await expect(title).toHaveValue('其他客户端已修改标题');
    await title.fill('尚未保存的本地草稿');
    const other = await api('command', 'task.create', { title: `标题草稿切换对照-${Date.now()}` });
    await page.locator(`[data-tracker-id="${other.trackerId}"]`).getByRole('button').first().click();
    await expect(title).not.toHaveValue('尚未保存的本地草稿');
    await page.locator(`[data-tracker-id="${id}"]`).getByRole('button').first().click();
    await expect(title).toHaveValue('尚未保存的本地草稿');
    await api('command', 'task.update', { trackerId: id, title: '远端新版本应保留' });
    await expect(title).toHaveValue('尚未保存的本地草稿');
    // A stale draft must neither silently rebase nor overwrite the other client.
    const save = page.getByTestId('babel-title-save');
    await expect(page.getByTestId('babel-title-conflict')).toContainText('远端新版本应保留');
    await expect(save).toBeDisabled();
    expect((await current()).record.fields.title).toBe('远端新版本应保留');
    await page.screenshot({ path: info.outputPath('title-conflict-native.png') });
    await page.getByTestId('babel-title-use-remote').click();
    await expect(title).toHaveValue('远端新版本应保留');
    expect((await current()).binding.latestRunId).toBeNull();
    writeFileSync(info.outputPath('title-evidence.json'), JSON.stringify({
      trackerId: id, projectId, mode: 'demo', final: await current(),
      verified: ['native-save-to-shared-service', 'clean-title-updates', 'dirty-draft-preserved', 'draft-survives-task-switch', 'conflict-no-overwrite', 'choose-remote', 'no-run-started'],
    }, null, 2));
  } finally {
    await browser.close();
  }
});
