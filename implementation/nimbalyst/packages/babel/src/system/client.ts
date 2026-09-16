import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { SystemError, type ConsoleCommand, type ConsoleQuery, type Operation } from './types.ts';

export interface SystemClientOptions { profile?: string; endpoint?: string; timeoutMs?: number; }

/** Credentials are profile-local and are never forwarded through redirects. */
export class SystemClient {
  readonly endpoint: string;
  readonly profile: string;
  constructor(private readonly options: SystemClientOptions) {
    const profile = options.profile ?? process.env.BABEL_SYSTEM_PROFILE ?? (process.platform === 'win32' ? 'D:\\BabelData\\system' : resolve(homedir(), '.local/state/babel-system'));
    if (!profile?.trim()) throw new SystemError('USAGE', '必须指定 --profile 或 BABEL_SYSTEM_PROFILE');
    this.profile = resolve(profile);
    let endpoint: URL;
    try { endpoint = new URL(options.endpoint ?? 'http://127.0.0.1:7782'); }
    catch { throw new SystemError('USAGE', 'endpoint 必须为本机 HTTP 地址'); }
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
      || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
      throw new SystemError('USAGE', 'endpoint 仅支持 http://127.0.0.1:端口 或 http://localhost:端口');
    }
    this.endpoint = endpoint.origin;
  }

  query<T>(query: ConsoleQuery, signal?: AbortSignal): Promise<T> { return this.request('/v1/query', query, signal); }
  command(command: ConsoleCommand, signal?: AbortSignal): Promise<Operation> { return this.request('/v1/command', command, signal); }

  private async request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let token: string;
    try { token = (await readFile(resolve(this.profile, 'service.token'), 'utf8')).trim(); }
    catch { throw new SystemError('AUTH', '无法读取所选 profile 的 service.token；请先启动设备控制服务'); }
    if (!token || /[\r\n]/.test(token)) throw new SystemError('AUTH', '所选 profile 的 service.token 无效');
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 120_000);
    let response: Response;
    try {
      response = await fetch(this.endpoint + path, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new SystemError(signal?.aborted ? 'CANCELLED' : timeout.aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        signal?.aborted ? '请求已取消' : timeout.aborted ? '请求超时；请查历史确认操作结果' : '无法连接设备控制服务');
    }
    let envelope: { ok?: boolean; result?: T; error?: { code?: string; message?: string } };
    try { envelope = await response.json() as typeof envelope; }
    catch { throw new SystemError('PROTOCOL', '设备控制服务返回了无效 JSON'); }
    if (!envelope || envelope.ok !== true || !response.ok) {
      const message = String(envelope?.error?.message ?? `设备控制服务 HTTP ${response.status}`).split(token).join('[redacted]');
      throw new SystemError(String(envelope?.error?.code ?? 'UNAVAILABLE').split(token).join('[redacted]'), message);
    }
    if (!('result' in envelope)) throw new SystemError('PROTOCOL', '设备控制响应缺少 result');
    // Operations can contain adapter errors too; credentials must not escape via a reflected message.
    return JSON.parse(JSON.stringify(envelope.result), (_key, value: unknown) =>
      typeof value === 'string' ? value.split(token).join('[redacted]') : value) as T;
  }
}
