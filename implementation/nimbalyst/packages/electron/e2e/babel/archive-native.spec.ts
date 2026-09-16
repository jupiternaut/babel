import { test, expect, chromium } from '@playwright/test';

test('native context menu preserves records; restore and archive round-trip', async ({}, info) => {
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires isolated native Electron demo');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('workspace-manager'))!;
  page.setDefaultTimeout(15000);
  const task = async () => (await fetch(`${process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780'}/v2/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'task.get', projectId: 'fixture-project-babel', input: { trackerId: 'fixture-tracker-layout' } }),
  })).json();
  try {
    await page.keyboard.press('Control+t');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    await page.setViewportSize({ width: 1800, height: 1000 });
    await expect(page.getByTestId('babel-execution-board')).toHaveAttribute('data-layout', 'columns');
    await page.screenshot({ path: info.outputPath('native-wide.png') });
    const card = page.locator('[data-tracker-id="fixture-tracker-layout"]');
    const before = await task();
    await card.click({ button: 'right' });
    expect((await task()).record.revision).toBe(before.record.revision);
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: '恢复', exact: true }).click();
    await expect.poll(async () => (await task()).record.archived).toBe(false);
    await page.getByTestId('babel-card-menu-fixture-tracker-layout').click();
    await page.getByRole('menuitem', { name: '归档', exact: true }).click();
    await expect.poll(async () => (await task()).record.archived).toBe(true);
    expect((await task()).binding.latestRunId).toBe(before.binding.latestRunId);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: info.outputPath('native-light.png') });
    await page.setViewportSize({ width: 850, height: 800 });
    await expect(page.getByTestId('babel-execution-board')).toHaveAttribute('data-layout', 'stage-list');
    await page.screenshot({ path: info.outputPath('native-narrow.png') });
  } finally {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await browser.close();
  }
});
