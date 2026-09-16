// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackerDataCommand, TrackerDataChange } from '@nimbalyst/collab-client/trackers';
import { createDemoServer } from '../../../../../babel/src/server/http.ts';
import { executeCli } from '../../../../../babel/src/cli/run.ts';
import { command, openDomain, PROJECT } from '../../../../../babel/tests/helpers.ts';
import { BabelDemoTrackerDataSource } from '../BabelDemoTrackerDataSource';
import { BABEL_DEMO_UNIMPLEMENTED_CODE, BABEL_DEMO_UNIMPLEMENTED_MESSAGE } from '../babelDemoErrors';

describe('unimplemented demo commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects delete/update-comment/unknown commands with the same reason', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const source = new BabelDemoTrackerDataSource({
      workspacePath: 'D:/Projects/babel-nimbalyst-data/demo-profile/workspaces/babel',
    });
    for (const type of ['delete-item', 'update-comment', 'reconnect'] as const) {
      try {
        await source.command({ type, itemId: 'x', commentId: 'c' } as never);
        expect.fail(`${type} should not succeed`);
      } catch (error) {
        expect(error).toMatchObject({
          code: BABEL_DEMO_UNIMPLEMENTED_CODE,
          message: BABEL_DEMO_UNIMPLEMENTED_MESSAGE,
        });
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    source.dispose();
  });

  it('sends the current record revision with archive and restore', async () => {
    const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
      const pathname = String(url);
      if (pathname.includes('/v2/query')) {
        return {
          json: async () => ({
            record: { id: 'trk-archive', revision: 7, fields: {}, system: {} },
          }),
        };
      }
      return { json: async () => ({ ok: true, trackerId: 'trk-archive' }) };
    });
    vi.stubGlobal('fetch', fetchSpy);
    const source = new BabelDemoTrackerDataSource({
      workspacePath: 'D:/Projects/babel-nimbalyst-data/demo-profile/workspaces/babel',
    });
    await source.command({ type: 'archive-item', itemId: 'trk-archive', archive: true });
    const archiveCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/v2/command'));
    expect(archiveCall).toBeTruthy();
    const archiveBody = JSON.parse(String((archiveCall?.[1] as RequestInit | undefined)?.body));
    expect(archiveBody.name).toBe('task.archive');
    expect(archiveBody.expectedRevision).toBe(7);
    fetchSpy.mockClear();
    await source.command({ type: 'archive-item', itemId: 'trk-archive', archive: false });
    const restoreCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/v2/command'));
    expect(restoreCall).toBeTruthy();
    const restoreBody = JSON.parse(String((restoreCall?.[1] as RequestInit | undefined)?.body));
    expect(restoreBody.name).toBe('task.restore');
    expect(restoreBody.expectedRevision).toBe(7);
    source.dispose();
  });
});


describe('demo Markdown body writes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, null, 0, -1, 1.5, Infinity, NaN, '7', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid body revision %s before transport', async expectedRevision => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const source = new BabelDemoTrackerDataSource({ workspacePath: '/isolated/babel' });
      try {
        await expect(source.command({
          type: 'update-item-content', itemId: 'body', content: '正文', expectedRevision,
        } as TrackerDataCommand)).rejects.toMatchObject({ code: 'VALIDATION' });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        source.dispose();
      }
    },
  );

  it.each([null, undefined, 7, {}, { markdown: 7 }, { root: { children: [] } }, ['正文']].map(content => ({ content })))(
    'rejects unsupported body structures before transport: $content', async ({ content }) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const source = new BabelDemoTrackerDataSource({ workspacePath: '/isolated/babel' });
      try {
        await expect(source.command({
          type: 'update-item-content', itemId: 'body', content, expectedRevision: 7,
        })).rejects.toMatchObject({ code: 'VALIDATION' });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        source.dispose();
      }
    },
  );

  it('never writes projected read-only metadata through single or batch field updates', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      json: async () => ({ ok: true, record: { id: 'body', fields: {}, system: {} } }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const source = new BabelDemoTrackerDataSource({ workspacePath: '/isolated/babel' });
    try {
      await source.command({
        type: 'update-item', input: { itemId: 'body', updates: { title: '字段编辑', babelReadOnly: false } },
      });
      await source.command({
        type: 'update-items', input: { entries: [{ itemId: 'body', storeUpdates: { title: '批量编辑', babelReadOnly: true } }] },
      });
      const requests = fetchSpy.mock.calls.filter(([url]) => url.endsWith('/v2/command'));
      expect(requests).toHaveLength(2);
      for (const [, init] of requests) {
        const request = JSON.parse(String(init?.body));
        expect(request.input).not.toHaveProperty('babelReadOnly');
        expect(request.input.title).toMatch(/编辑$/);
      }
    } finally {
      source.dispose();
    }
  });

  it('preserves a revision conflict without emitting an item upsert or fetching newer content', async () => {
    const fetchSpy = vi.fn(async () => ({
      json: async () => ({ ok: false, code: 'REVISION_CONFLICT', message: '记录已更新' }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const source = new BabelDemoTrackerDataSource({ workspacePath: '/isolated/babel' });
    const changes: TrackerDataChange[] = [];
    source.subscribe(change => changes.push(change));
    try {
      await expect(source.command({
        type: 'update-item-content', itemId: 'body', content: '草稿', expectedRevision: 7,
      })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(changes).toEqual([expect.objectContaining({
        type: 'mutation-rejected',
        rejection: expect.objectContaining({ itemId: 'body', code: 'REVISION_CONFLICT' }),
      })]);
    } finally {
      source.dispose();
    }
  });

  it('round-trips rich Chinese Markdown and empty content over HTTP, rejecting stale and read-only writes', async () => {
    const opened = openDomain('off');
    const server = createDemoServer({ host: '127.0.0.1', port: 0, domain: opened.domain, serviceToken: 'body-test' });
    await server.listen();
    const source = new BabelDemoTrackerDataSource({
      workspacePath: '/isolated/babel', endpoint: server.endpoint, projectId: PROJECT,
    });
    const changes: TrackerDataChange[] = [];
    source.subscribe(change => changes.push(change));
    try {
      const created = await command(opened.domain, 'task.create', { title: '正文跨端核验' });
      const trackerId = created.trackerId!;
      const initial = await source.getTask(trackerId);
      const markdown = '# 中文标题\n\n- [ ] 保留 **粗体** 与 [链接](https://example.com)\n\n```ts\nconst 消息 = "正文";\n```\n';
      const cursor = opened.domain.store.data.cursor;
      await source.command({
        type: 'update-item-content', itemId: trackerId,
        content: { markdown }, expectedRevision: initial.record.revision,
      });
      const saved = await source.getTask(trackerId);
      expect(saved.record.content).toEqual({ format: 'markdown', markdown });
      expect(saved.record.fields.description).toBe(markdown);
      expect(saved.record.revision).toBe(initial.record.revision! + 1);
      expect(opened.domain.eventsSince(PROJECT, cursor)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'task.updated', trackerId, revision: saved.record.revision }),
      ]));
      expect(changes).toEqual([expect.objectContaining({
        type: 'items-upserted', items: [expect.objectContaining({ id: trackerId, content: saved.record.content })],
      })]);
      const cli = await executeCli(['task', 'get', '--id', trackerId, '--project', PROJECT, '--endpoint', server.endpoint]);
      expect(cli.exitCode).toBe(0);
      expect(JSON.parse(cli.stdout).record.content).toEqual(saved.record.content);

      changes.length = 0;
      const beforeConflict = opened.domain.store.data.cursor;
      await expect(source.command({
        type: 'update-item-content', itemId: trackerId,
        content: '旧草稿', expectedRevision: initial.record.revision,
      })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect((await source.getTask(trackerId)).record).toEqual(saved.record);
      expect(opened.domain.eventsSince(PROJECT, beforeConflict)).toEqual([]);
      expect(changes.some(change => change.type === 'items-upserted')).toBe(false);

      await source.command({
        type: 'update-item-content', itemId: trackerId, content: '', expectedRevision: saved.record.revision,
      });
      expect((await source.getTask(trackerId)).record.content).toEqual({ format: 'markdown', markdown: '' });
      const readOnly = opened.domain.store.data.records.find(record => record.system.readOnly)!;
      expect(readOnly).toBeDefined();
      // The host list excludes semantic demo scenes; expose this fixture without changing its read-only policy.
      readOnly.fields.demoScene = 'body-projection';
      const snapshot = await source.snapshot();
      expect(snapshot.items.find(item => item.id === readOnly.id)?.customFields?.babelReadOnly).toBe(true);
      expect(snapshot.items.find(item => item.id === trackerId)?.customFields?.babelReadOnly).toBe(false);
      const beforeReadOnly = opened.domain.store.data.cursor;
      changes.length = 0;
      await expect(source.command({
        type: 'update-item-content', itemId: readOnly.id, content: '禁止覆盖', expectedRevision: readOnly.revision,
      })).rejects.toMatchObject({ code: 'READ_ONLY' });
      expect(opened.domain.eventsSince(PROJECT, beforeReadOnly)).toEqual([]);
      expect(changes.some(change => change.type === 'items-upserted')).toBe(false);
    } finally {
      source.dispose();
      await server.close();
      opened.dispose();
    }
  });
});
