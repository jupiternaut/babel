import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createSystemAdapter } from './platform.ts';
import { SystemConsoleService } from './service.ts';
import { createSystemServer } from './http.ts';
import { SystemError, type ServiceDefinition } from './types.ts';
import { acquireProfileLock } from './profile-lock.ts';
import { SystemHooks, type SystemHooksConfig } from './hooks.ts';
import type { ConsoleEvent } from './types.ts';

async function main() {
  const profileDir = path.resolve(process.env.BABEL_SYSTEM_PROFILE || (process.platform === 'win32' ? 'D:\\BabelData\\system' : path.join(os.homedir(), '.local/state/babel-system')));
  mkdirSync(profileDir, { recursive: true });
  // POSIX file modes alone do not protect bearer credentials on Windows.
  if (process.platform === 'win32') {
    const current = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = current.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) throw new SystemError('PERMISSION', '无法确认当前用户以保护控制目录');
    execFileSync('icacls.exe', [profileDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' });
  }
  const releaseLease = await acquireProfileLock(profileDir);
  const lock = path.join(profileDir, 'server.lock');
  writeFileSync(lock, String(process.pid), { mode: 0o600 });
  const release = () => { if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); };
  process.once('exit', release);
  try {
    const tokenFile = path.join(profileDir, 'service.token');
    if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    const token = readFileSync(tokenFile, 'utf8').trim();
    const configFile = path.join(profileDir, 'catalog.json');
    if (!existsSync(configFile)) writeFileSync(configFile, JSON.stringify({ version: 1, services: [] }, null, 2), { flag: 'wx', mode: 0o600 });
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { version: number; services: ServiceDefinition[]; hooks?: SystemHooksConfig };
    if (config.version !== 1) throw new SystemError('CONFIG', 'catalog.json 版本不支持');
    const port = Number(process.env.BABEL_SYSTEM_PORT || 7782);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SystemError('CONFIG', '端口无效');
    const hooks = new SystemHooks(profileDir, config.hooks ?? {});
    const service = new SystemConsoleService({ profileDir, services: config.services, adapter: createSystemAdapter(profileDir), beforeCommand: hooks.before });
    const server = createSystemServer({ service, token, port, onShutdown: () => { hooks.stop(); process.exit(0); } });
    await server.listen();
    hooks.start(async after => await service.query({ name: 'events', after }) as ConsoleEvent[]);
    process.stderr.write(`System console listening on ${server.endpoint}; profile ${profileDir}\n`);
    let closing = false;
    const close = () => { if (closing) return; closing = true; hooks.stop(); void server.close().then(() => process.exit(0)); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  } catch (error) { release(); await releaseLease(); throw error; }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
