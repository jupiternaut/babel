/** Slower, isolated simulation for native GUI-close lifecycle acceptance. */
import path from 'node:path';
import { DomainService } from '../src/core/domain.ts';
import { createDemoServer } from '../src/server/http.ts';
import { ensureProfileDir, loadOrCreateServiceToken } from '../src/server/auth.ts';

if (!process.env.BABEL_PROFILE) throw new Error('Set BABEL_PROFILE to a fresh acceptance directory');
const profileDir = ensureProfileDir(path.resolve(process.env.BABEL_PROFILE));
const domain = new DomainService({ profileDir, simulate: 'async', stepMs: 3000 });
const server = createDemoServer({ domain, serviceToken: loadOrCreateServiceToken(profileDir), port: Number(process.env.BABEL_PORT || 7780) });
await server.listen();
process.stderr.write(`Babel isolated acceptance server: ${server.endpoint}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void server.close().then(() => process.exit(0)); });
}
