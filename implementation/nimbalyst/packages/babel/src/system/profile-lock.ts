import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SystemError } from './types.ts';

// The OS releases this lease after process termination, including a crash.
// A diagnostic PID file must never be used to remove another process's lease.
export async function acquireProfileLock(profile: string): Promise<() => Promise<void>> {
  const canonical = path.resolve(profile);
  const hash = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const server = net.createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new SystemError('BUSY', '此 profile 的控制服务已运行，或互斥端点无法占用')));
    if (process.platform === 'win32') server.listen(`\\\\.\\pipe\\babel-system-${hash}`, resolve);
    else server.listen({ host: '127.0.0.1', port: 20000 + (parseInt(hash.slice(0, 8), 16) % 40000), exclusive: true }, resolve);
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
}
