import { test, expect, chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const endpoint = process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780';
const projectId = 'fixture-project-babel';

async function listed(statusScope: string, q = '') {
  const response = await fetch(`${endpoint}/v2/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'task.list', projectId, input: { types: 'executable', statusScope, q } }),
  });
  expect(response.ok).toBe(true);
  const body = await response.json();
  return body.items.map((item: { trackerId: string }) => item.trackerId).sort() as string[];
}

test('native execution board and toolbar apply the same status and search scope', async ({}, info) => {
  test.setTimeout(60_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native Electron demo');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='))!;
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15_000);
  const results: unknown[] = [];
  try {
    await page.keyboard.press('Escape');
    const welcome = page.getByRole('heading', { name: 'Welcome to Nimbalyst', exact: true });
    if (await welcome.isVisible()) { await welcome.click(); await page.keyboard.press('Escape'); }
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.getByTestId('tracker-surface-execution').click();
    const close = page.getByRole('button', { name: '关闭详情', exact: true });
    if (await close.isVisible()) await close.click();
    const attention = page.getByTestId('babel-attention-toggle');
    if (await attention.getAttribute('aria-pressed') === 'true') await attention.click();
    await page.setViewportSize({ width: 1800, height: 1000 });
    const search = page.getByRole('combobox', { name: 'Search or filter tracker items' });
    await search.fill('');
    const board = page.getByTestId('babel-execution-board');
    await expect(board).toHaveAttribute('data-layout', 'columns');
    const ids = () => board.locator('[data-tracker-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-tracker-id')!).sort());
    const all = await listed('all');
    for (const scope of ['open', 'closed', 'all']) {
      await page.getByTestId(`tracker-status-scope-${scope}`).click();
      const expected = await listed(scope);
      await expect.poll(ids).toEqual(expected);
      await expect(page.getByTestId('tracker-view-item-count')).toHaveText(scope === 'all' ? `${expected.length} total` : `${expected.length} ${scope} of ${all.length}`);
      results.push({ scope, trackerIds: expected });
    }
    await search.fill('关注更新');
    const searched = await listed('all', '关注更新');
    expect(searched.length).toBeGreaterThan(0);
    await expect.poll(ids).toEqual(searched);
    await expect(page.getByTestId('tracker-view-item-count')).toHaveText(`${searched.length} total`);
    await page.screenshot({ path: info.outputPath('filters-native.png') });
    writeFileSync(info.outputPath('filters-evidence.json'), JSON.stringify({ projectId, mode: 'demo', results, search: { q: '关注更新', trackerIds: searched } }, null, 2));
  } finally {
    const search = page.getByRole('combobox', { name: 'Search or filter tracker items' });
    await search.fill('');
    await search.press('Escape');
    await page.getByTestId('tracker-status-scope-all').click();
    await page.setViewportSize({ width: 1400, height: 900 });
    await browser.close();
  }
});
