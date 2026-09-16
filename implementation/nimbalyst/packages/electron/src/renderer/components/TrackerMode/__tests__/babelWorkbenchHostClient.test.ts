import { afterEach, describe, expect, it, vi } from 'vitest';
import { babelHostCommand, babelHostQuery } from '../babelWorkbench/babelHostClient';
import { BabelHostCommandError } from '../../../services/babelDemoErrors';

describe('babel host client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts project.list and task.list with the selected projectId', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      json: async () => ({ mode: 'demo', projects: [], items: [] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const host = { endpoint: 'http://127.0.0.1:7780', projectId: 'fixture-project-babel' };
    await babelHostQuery(host, 'project.list');
    await babelHostQuery(host, 'task.list', { deviceId: 'fixture-device-ubuntu' }, 'fixture-project-research');
    const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies[0]).toMatchObject({
      name: 'project.list',
      projectId: 'fixture-project-babel',
    });
    expect(bodies[1]).toMatchObject({
      name: 'task.list',
      projectId: 'fixture-project-research',
      input: { deviceId: 'fixture-device-ubuntu' },
    });
    expect(String(fetchSpy.mock.calls[0][0])).toBe('http://127.0.0.1:7780/v2/query');
  });

  it('throws BabelHostCommandError without inventing success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ok: false, code: 'UNAVAILABLE', message: '演示服务未接入' }),
    })));
    await expect(babelHostCommand(
      { endpoint: 'http://127.0.0.1:7780', projectId: 'fixture-project-babel' },
      'run.message',
      { runId: 'r1', text: 'hi' },
    )).rejects.toBeInstanceOf(BabelHostCommandError);
  });
});
