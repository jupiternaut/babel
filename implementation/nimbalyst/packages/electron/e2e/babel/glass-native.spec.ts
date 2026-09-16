import { test, expect, chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('native glass preserves input and releases menus across accessibility changes', async ({}, info) => {
  test.setTimeout(60_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native Electron instance');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='))!;
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15_000);
  const cdp = await page.context().newCDPSession(page);
  const requested = process.env.BABEL_GLASS_EXPECTED || 'frosted';
  try {
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if (await tracker.getAttribute('aria-pressed') !== 'true') await tracker.click();
    const showSidebar = page.getByRole('button', { name: 'Show Tracker sidebar', exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const closeDetail = page.getByRole('button', { name: '关闭详情', exact: true });
    if (await closeDetail.isVisible()) await closeDetail.click();
    const surface = page.locator('.babel-nav-glass');
    await expect(surface).toHaveAttribute('data-glass-mode', requested);
    const snapshot = async () => page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('.babel-nav-glass')!;
      const optics = surface.querySelector<HTMLElement>('[data-liquid-glass]');
      return {
        theme: document.documentElement.dataset.theme,
        viewport: [innerWidth, innerHeight],
        requested: surface.dataset.glassMode,
        strategy: optics?.dataset.glassStrategy,
        reason: optics?.dataset.glassReason,
        bounds: optics?.getBoundingClientRect().toJSON(),
        filterMapsReady: [...(optics?.querySelectorAll('feImage') || [])].some(n => Boolean(n.getAttribute('href'))),
        appliedFilters: [...(optics?.querySelectorAll('div') || [])].map(n => getComputedStyle(n).backdropFilter).filter(v => v.includes('url(')),
        backdrop: getComputedStyle(surface.querySelector('.babel-glass-surface-backdrop')!).backdropFilter,
        menus: document.querySelectorAll('[data-testid="babel-execution-card-menu"]').length,
        filters: document.querySelectorAll('svg.liquid-glass-filter filter').length,
        canvases: surface.querySelectorAll('canvas').length,
      };
    });
    const before = await snapshot();
    if (requested === 'refractive') {
      await expect(surface.locator('[data-liquid-glass]')).toHaveAttribute('data-glass-strategy', 'svg');
      expect(before.canvases).toBe(0);
    }
    await page.screenshot({ path: info.outputPath('workbench.png') });
    await surface.screenshot({ path: info.outputPath('surface.png') });

    const search = page.getByRole('combobox', { name: 'Search or filter tracker items' });
    await search.fill('中文草稿校验');
    await search.focus();
    for (const features of [
      [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      [{ name: 'forced-colors', value: 'active' }],
    ]) {
      await cdp.send('Emulation.setEmulatedMedia', { features });
      await expect(surface).toHaveAttribute('data-glass-mode', 'static');
      await expect(surface.locator('[data-liquid-glass]')).toHaveCount(0);
      await expect(search).toHaveValue('中文草稿校验');
      await expect(search).toBeFocused();
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await expect(surface).toHaveAttribute('data-glass-mode', requested);
    await search.fill('');
    await search.press('Escape');
    const todo = page.getByTestId('babel-stage-tab-TODO');
    if (await todo.isVisible()) await todo.click();
    const trigger = page.getByTestId('babel-card-menu-fixture-tracker-pdf');
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await trigger.click();
      await expect(page.getByRole('menu')).toBeVisible();
      if (i === 0) await page.screenshot({ path: info.outputPath('menu.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      durations.push(performance.now() - start);
    }
    const after = await snapshot();
    expect(after.filters).toBe(before.filters);
    expect(after.canvases).toBe(before.canvases);
    expect(after.menus).toBe(0);
    writeFileSync(info.outputPath('materials.json'), JSON.stringify({ before, after, menuCycles: 20, menuRoundTripMs: durations }, null, 2));
  } finally {
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.detach();
    await browser.close();
  }
});
