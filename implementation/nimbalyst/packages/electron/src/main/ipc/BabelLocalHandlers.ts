import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeHandle } from '../utils/ipcRegistry';
import { getWindowIdForWindow, resolveActiveWorkspacePathForWindowId } from '../window/windowState';

/** Local Pi credentials stay in main; only the configured workspace can use this bridge. */
export function registerBabelLocalHandlers(): void {
  const mode = process.env.BABEL_MODE;
  const profile = process.env.BABEL_PROFILE;
  const endpoint = process.env.BABEL_ENDPOINT;
  const projectId = process.env.BABEL_PROJECT_ID;
  const workspace = process.env.BABEL_DEMO_WORKSPACE;
  const mainDirectory = basename(__dirname) === 'chunks' ? dirname(__dirname) : __dirname;
  const authorize = (event: IpcMainInvokeEvent, requestedWorkspace: unknown) => {
    if (mode !== 'local' || !profile || !isAbsolute(profile) || !workspace || !isAbsolute(workspace) || !projectId || !endpoint) {
      throw new Error('本机 Pi 服务配置不完整');
    }
    const serverUrl = new URL(endpoint);
    if (serverUrl.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(serverUrl.hostname)
      || serverUrl.username || serverUrl.password || serverUrl.pathname !== '/' || serverUrl.search || serverUrl.hash) {
      throw new Error('本机 Pi 仅允许固定的回环服务地址');
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted Pi sender');
    const frameUrl = new URL(event.senderFrame.url);
    const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL
      || (process.env.NODE_ENV === 'development' ? `http://localhost:${process.env.VITE_PORT || '5273'}` : undefined) : undefined;
    const rendererUrl = new URL(devUrl || pathToFileURL(join(mainDirectory, '../renderer/index.html')).href);
    if (frameUrl.origin !== rendererUrl.origin || frameUrl.protocol !== rendererUrl.protocol
      || frameUrl.host !== rendererUrl.host || frameUrl.pathname !== rendererUrl.pathname) throw new Error('Untrusted Pi page');
    const activeWorkspace = resolveActiveWorkspacePathForWindowId(getWindowIdForWindow(window));
    if (typeof requestedWorkspace !== 'string' || resolve(requestedWorkspace) !== resolve(workspace)
      || !activeWorkspace || resolve(activeWorkspace) !== resolve(workspace)) throw new Error('Pi workspace mismatch');
    return serverUrl.origin;
  };
  for (const kind of ['query', 'command'] as const) {
    safeHandle(`babel-local:${kind}`, async (event, requestedWorkspace: unknown, payload: unknown) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      const abort = () => controller.abort();
      try {
        const origin = authorize(event, requestedWorkspace);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Pi request');
        const body = payload as Record<string, unknown>;
        if (body.projectId !== projectId || typeof body.name !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(body.name)
          || Object.keys(body).some(key => !['name', 'projectId', 'input', 'idempotencyKey', 'expectedRevision'].includes(key))) {
          throw new Error('Invalid Pi request scope');
        }
        if (body.name.startsWith('demo.') || body.name.startsWith('ops.')) throw new Error('Unsupported local Pi operation');
        const token = (await readFile(join(profile!, 'service.token'), 'utf8')).trim();
        if (!token || /[\r\n]/.test(token)) throw new Error('Pi service token unavailable');
        // Recheck scope after reading disk: a window may have switched workspace.
        authorize(event, requestedWorkspace);
        if (event.sender.isDestroyed()) throw new Error('Pi renderer closed');
        event.sender.once('destroyed', abort);
        timer = setTimeout(abort, 30_000);
        const response = await fetch(`${origin}/v2/${kind}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/json', 'x-babel-service-token': token },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok && result?.ok !== false) throw new Error('Pi service request failed');
        return result;
      } catch (error) {
        return { ok: false, code: 'BABEL_LOCAL_CONNECTION', message: error instanceof Error ? error.message : 'Pi service unavailable' };
      } finally {
        if (timer) clearTimeout(timer);
        event.sender.removeListener('destroyed', abort);
      }
    });
  }
}
