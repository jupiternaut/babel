// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), readFile: vi.fn(), fetch: vi.fn(),
  fromWebContents: vi.fn(), activeWorkspace: vi.fn(),
}));
vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: { fromWebContents: mocks.fromWebContents } }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) }));
vi.mock('../../window/windowState', () => ({ getWindowIdForWindow: () => 1, resolveActiveWorkspacePathForWindowId: mocks.activeWorkspace }));
import { registerBabelLocalHandlers } from '../BabelLocalHandlers';
function event(url = 'http://localhost:5273/') {
  const mainFrame = { url };
  return { senderFrame: mainFrame, sender: { mainFrame, isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() } };
}
const body = { name: 'run.start', projectId: 'local-project', input: { trackerId: 'a' }, expectedRevision: 3 };
const call = (sender = event(), workspace = '/tmp/pi-work', payload: unknown = body) => mocks.handlers.get('babel-local:command')!(sender, workspace, payload);
beforeEach(() => {
  vi.resetAllMocks(); mocks.handlers.clear();
  for (const [name, value] of Object.entries({ BABEL_MODE: 'local', BABEL_PROFILE: '/tmp/pi-profile', BABEL_ENDPOINT: 'http://127.0.0.1:7783', BABEL_PROJECT_ID: 'local-project', BABEL_DEMO_WORKSPACE: '/tmp/pi-work', ELECTRON_RENDERER_URL: 'http://localhost:5273/' })) vi.stubEnv(name, value);
  mocks.fromWebContents.mockReturnValue({}); mocks.activeWorkspace.mockReturnValue('/tmp/pi-work');
  mocks.readFile.mockResolvedValue('private-token\n');
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, runId: 'run-a' }) });
  vi.stubGlobal('fetch', mocks.fetch); registerBabelLocalHandlers();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('authenticates only in main and fixes the request URL and project', async () => {
  expect(await call()).toEqual({ ok: true, runId: 'run-a' });
  expect(mocks.readFile).toHaveBeenCalledWith('/tmp/pi-profile/service.token', 'utf8');
  expect(mocks.fetch).toHaveBeenCalledWith('http://127.0.0.1:7783/v2/command', expect.objectContaining({
    method: 'POST', redirect: 'error', headers: expect.objectContaining({ 'x-babel-service-token': 'private-token' }), body: JSON.stringify(body),
  }));
});
it('rejects foreign page, subframe, workspace and project before reading credentials', async () => {
  const subframe = event(); subframe.senderFrame = { url: subframe.senderFrame.url };
  for (const args of [[event('http://localhost:5273/foreign'), '/tmp/pi-work', body], [subframe, '/tmp/pi-work', body], [event(), '/tmp/other', body], [event(), '/tmp/pi-work', { ...body, projectId: 'other' }], [event(), '/tmp/pi-work', { ...body, actor: { role: 'admin' } }]] as const) {
    expect((await call(args[0], args[1], args[2])).ok).toBe(false);
  }
  mocks.activeWorkspace.mockReturnValue('/tmp/another-active-workspace');
  expect((await call()).ok).toBe(false);
  expect(mocks.readFile).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
});
it.each(['https://example.com', 'http://127.0.0.1:7783/redirect', 'http://user:pass@127.0.0.1:7783'])('rejects untrusted endpoint configuration %s', async (endpoint) => {
  vi.stubEnv('BABEL_ENDPOINT', endpoint); registerBabelLocalHandlers();
  expect((await call()).ok).toBe(false); expect(mocks.readFile).not.toHaveBeenCalled();
});
it('does not enable the local bridge in demo mode', async () => {
  vi.stubEnv('BABEL_MODE', 'demo'); registerBabelLocalHandlers();
  expect((await call()).ok).toBe(false); expect(mocks.readFile).not.toHaveBeenCalled();
});
