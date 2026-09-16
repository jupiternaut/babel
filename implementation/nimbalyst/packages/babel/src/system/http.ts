import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { SystemConsoleService } from './service.ts';
import { SystemError, type ConsoleCommand, type ConsoleQuery } from './types.ts';

export function createSystemServer(options: { service: SystemConsoleService; token: string; port?: number; onShutdown?: () => void }) {
  if (options.token.length < 32) throw new SystemError('CONFIG', '控制服务令牌太短');
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  let port = options.port ?? 7782;
  let closing = false;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      if (closing) throw new SystemError('BUSY', '控制服务正在关闭');
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin) throw new SystemError('PERMISSION', '仅接受本机受信客户端，不接受网页跨源调用');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/v1/health') return json(res, 200, { ok: true, mode: 'system', protocolVersion: 1 });
      const header = req.headers.authorization;
      const supplied = Buffer.from(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '');
      const expected = Buffer.from(options.token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new SystemError('PERMISSION', '控制服务鉴权失败');
      if (req.method === 'POST' && url.pathname === '/v1/shutdown') {
        if (options.service.isBusy) throw new SystemError('BUSY', '操作尚未结束，不能关闭控制服务');
        closing = true;
        json(res, 200, { ok: true, result: { shuttingDown: true } });
        server.close(() => options.onShutdown?.());
        return;
      }
      if (req.method !== 'POST' || !['/v1/query', '/v1/command'].includes(url.pathname)) return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new SystemError('VALIDATION', '请求需要 application/json');
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new SystemError('VALIDATION', '请求超过 32 KiB'); chunks.push(Buffer.from(chunk)); }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SystemError('VALIDATION', 'JSON 格式无效'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SystemError('VALIDATION', '请求必须是 JSON 对象');
      if (closing) throw new SystemError('BUSY', '控制服务正在关闭');
      const result = url.pathname === '/v1/query' ? await options.service.query(body as ConsoleQuery) : await options.service.command(body as ConsoleCommand);
      json(res, 200, { ok: true, result });
    } catch (error) {
      const code = error instanceof SystemError ? error.code : 'SYSTEM_ERROR';
      json(res, code === 'PERMISSION' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'VALIDATION' ? 400 : 500,
        { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
  }
  return {
    get endpoint() { return `http://127.0.0.1:${port}`; },
    listen(): Promise<void> { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { const addr = server.address(); if (typeof addr === 'object' && addr) port = addr.port; resolve(); }); }); },
    close(): Promise<void> { return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
