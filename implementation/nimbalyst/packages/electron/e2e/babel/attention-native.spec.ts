import { test, expect, chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const projectId = 'fixture-project-babel';
const endpoint = process.env.BABEL_ENDPOINT || 'http://127.0.0.1:7780';
async function request(route: 'query' | 'command', name: string, input: Record<string, unknown>) {
  const response = await fetch(`${endpoint}/v2/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, projectId, input }),
  });
  const body = await response.json();
  expect(response.ok, JSON.stringify(body)).toBe(true);
  return body;
}

test('native attention follows authoritative states, scope and same-record selection', async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!process.env.BABEL_ACCEPTANCE_CDP, 'Requires an explicitly isolated native Electron demo');
  const browser = await chromium.connectOverCDP(process.env.BABEL_ACCEPTANCE_CDP!);
  const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://localhost:') && !p.url().includes('mode='))!;
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15_000);
  const created: Array<{ trackerId: string; runId: string; title: string }> = [];
  try {
    await page.keyboard.press('Escape');
    const dismiss = page.getByRole('button', { name: 'Not now', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const tracker = page.getByRole('button', { name: /Tracker \(/ });
    if (await tracker.getAttribute('aria-pressed') !== 'true') await tracker.click();
    const sidebar = page.getByRole('button', { name: 'Show Tracker sidebar', exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.getByRole('button', { name: '执行视图', exact: true }).click();
    const toggle = page.getByTestId('babel-attention-toggle');
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();

    for (const scenario of ['waiting_input', 'review_required', 'verification_failed', 'lost']) {
      const title = `关注验收-${scenario}-${Date.now()}`;
      const record = await request('command', 'task.create', { title, primaryType: 'task' });
      const run = await request('command', 'run.start', { trackerId: record.trackerId });
      await request('command', 'demo.inject', { runId: run.runId, scenario });
      created.push({ trackerId: record.trackerId, runId: run.runId, title });
      await expect(page.getByTestId(`babel-attention-${record.trackerId}`)).toContainText(title);
    }
    const waiting = created[0];
    const row = page.getByTestId(`babel-attention-${waiting.trackerId}`);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('babel-execution-detail')).toContainText(waiting.title);
    await expect(page.locator(`[data-tracker-id="${waiting.trackerId}"]`)).toBeVisible();
    expect((await request('query', 'task.get', { trackerId: waiting.trackerId })).latestRun.id).toBe(waiting.runId);
    await expect(row.locator('time')).toHaveAttribute('datetime', /T/);

    // An unrelated update must not add a TODO card to the attention-filtered board.
    const quiet = await request('command', 'task.create', { title: `普通待办-${Date.now()}` });
    await request('command', 'task.update', { trackerId: quiet.trackerId, title: '普通待办已更新' });
    await expect(page.locator(`[data-tracker-id="${quiet.trackerId}"]`)).toHaveCount(0);

    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/cli/main.ts',
      'task', 'list', '--attention-only', '--project', projectId, '--endpoint', endpoint, '--json'],
    { cwd: path.resolve('packages/babel') });
    const cli = JSON.parse(stdout);
    for (const item of created) expect(cli.items.some((card: { trackerId: string }) => card.trackerId === item.trackerId)).toBe(true);
    expect(cli.items.some((card: { trackerId: string }) => card.trackerId === quiet.trackerId)).toBe(false);

    const samples: Array<{ correlationId: string; requestToVisibleUpperBoundMs: number }> = [];
    for (let i = 0; i < 30; i++) {
      const title = `关注更新 ${i + 1} · 中文任务`;
      // The request starts before commit: this is a conservative latency upper bound,
      // not the fixture's logical occurredAt clock or a GPU/frame benchmark.
      const start = performance.now();
      const result = await request('command', 'task.update', { trackerId: waiting.trackerId, title });
      await expect(row).toContainText(title);
      samples.push({ correlationId: result.correlationId, requestToVisibleUpperBoundMs: performance.now() - start });
    }
    const ordered = samples.map(s => s.requestToVisibleUpperBoundMs).sort((a, b) => a - b);
    const p95UpperBoundMs = ordered[Math.ceil(ordered.length * .95) - 1];
    writeFileSync(info.outputPath('attention-evidence.json'), JSON.stringify({
      projectId, mode: 'demo', created, quietId: quiet.trackerId, samples, p95UpperBoundMs,
      method: 'HTTP command issuance before durable commit to matching native DOM; conservative upper bound including request transport and locator observation.',
    }, null, 2));
    expect(p95UpperBoundMs).toBeLessThanOrEqual(2000);
    await page.screenshot({ path: info.outputPath('attention-native.png') });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await browser.close();
  }
});
