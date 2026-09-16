// @vitest-environment node
import { expect, it } from 'vitest';
import { createSystemServer } from '../src/system/http.ts';
import type { SystemConsoleService } from '../src/system/service.ts';
import { request as rawRequest } from 'node:http';

it('does not expose resources or execute a command to unauthenticated or browser-origin requests', async () => {
  let calls = 0;
  const service = { query: async () => { calls++; return []; }, command: async () => { calls++; return {}; } } as unknown as SystemConsoleService;
  const token = 'x'.repeat(64);
  const server = createSystemServer({ service, token, port: 0 }); await server.listen();
  try {
    const request = (headers: Record<string, string>, body = '{"name":"processes"}', route = '/v1/query') => fetch(server.endpoint + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    expect((await request({})).status).toBe(403);
    expect((await request({ authorization: `Bearer ${token}`, origin: 'http://evil.test' })).status).toBe(403);
    const rebound = await new Promise<number | undefined>((resolve, reject) => {
      const req = rawRequest(server.endpoint + '/v1/query', { method: 'POST', headers: { host: 'evil.test', authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end('{"name":"processes"}');
    });
    expect(rebound).toBe(403);
    expect(calls).toBe(0);
    expect((await request({ authorization: `Bearer ${token}` })).status).toBe(200);
    expect(calls).toBe(1);
    expect((await request({ authorization: `Bearer ${token}` }, 'null')).status).toBe(400);
    expect((await request({ authorization: `Bearer ${token}`, 'content-type': 'text/plain' })).status).toBe(400);
    expect(calls).toBe(1);
  } finally { await server.close(); }
});
