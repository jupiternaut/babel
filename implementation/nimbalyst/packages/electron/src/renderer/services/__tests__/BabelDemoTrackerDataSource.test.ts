import { afterEach, describe, expect, it, vi } from 'vitest';
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
