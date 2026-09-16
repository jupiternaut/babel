import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { SystemClient, type SystemClientOptions } from './client.ts';
import { SystemError, type ConsoleCommand, type ConsoleQuery } from './types.ts';

export const SYSTEM_HELP = `babel system <命令> [--profile <目录>] [--endpoint http://127.0.0.1:7782]
resources | processes | services | service ID | logs ID [--limit N] | history [--limit N] | events [--after N]
start ID | stop ID | restart ID | autostart ID on|off | terminate PID STARTED_AT [--force]
写命令可加 --request-id ID；重试同一请求时复用 ID，允许 1–128 个字母、数字、点、下划线或连字符。
tui（交互设备控制台）
所有 CLI 响应为 JSON。退出码: 0 成功, 1 操作失败, 2 参数错误, 3 认证失败, 4 连接/协议错误, 11 非交互终端。
profile 可通过 BABEL_SYSTEM_PROFILE 指定；默认 Windows D:\\BabelData\\system，其他平台 ~/.local/state/babel-system。terminate 要求 processes 返回的 startedAt。`;

export interface SystemArgs extends SystemClientOptions { words: string[]; help: boolean; limit?: number; after?: number; requestId?: string; force: boolean; }
export function parseSystemArgs(argv: string[]): SystemArgs {
  const out: SystemArgs = { words: [], help: false, force: false };
  const args = argv[0] === 'system' ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--json') continue;
    else if (/^--(profile|endpoint|limit|after|request-id)(=|$)/.test(arg)) {
      const equal = arg.indexOf('=');
      const key = arg.slice(2, equal < 0 ? undefined : equal);
      const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
      if (!value || value.startsWith('--')) throw new SystemError('USAGE', `缺少 --${key} 值`);
      if (key === 'request-id') {
        if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new SystemError('USAGE', '--request-id 必须为 1–128 个字母、数字、点、下划线或连字符，且不能为保留名称');
        out.requestId = value;
      } else if (key === 'after') {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new SystemError('USAGE', '--after 必须为非负整数');
        out.after = Number(value);
      } else if (key === 'limit') {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) throw new SystemError('USAGE', '--limit 必须为 1–1000');
        out.limit = Number(value);
      } else if (key === 'profile') out.profile = value;
      else out.endpoint = value;
    } else if (arg.startsWith('-')) throw new SystemError('USAGE', '未知 system 选项');
    else out.words.push(arg);
  }
  return out;
}

export function systemRequest(args: SystemArgs): ConsoleQuery | ConsoleCommand {
  const [name, id, value] = args.words;
  const requireWords = (count: number) => { if (args.words.length !== count) throw new SystemError('USAGE', '命令参数不正确；使用 system --help 查看用法'); };
  const requestId = () => args.requestId ?? randomUUID();
  if (args.requestId && !['start', 'stop', 'restart', 'autostart', 'terminate'].includes(name)) throw new SystemError('USAGE', '--request-id 仅适用于写命令');
  if (args.force && name !== 'terminate') throw new SystemError('USAGE', '--force 仅适用于 terminate');
  if (args.after !== undefined && name !== 'events') throw new SystemError('USAGE', '--after 仅适用于 events');
  if (args.limit !== undefined && !['logs', 'history', 'events'].includes(name)) throw new SystemError('USAGE', '--limit 仅适用于 logs/history/events');
  if (['resources', 'processes', 'services', 'history', 'events'].includes(name)) {
    requireWords(1); return { name: name === 'history' ? 'operations' : name as ConsoleQuery['name'], ...(args.limit ? { limit: args.limit } : {}), ...(args.after !== undefined ? { after: args.after } : {}) };
  }
  if (name === 'logs' || name === 'service') { requireWords(2); return { name, serviceId: id, ...(args.limit ? { limit: args.limit } : {}) }; }
  if (name === 'start' || name === 'stop' || name === 'restart') { requireWords(2); return { name: `service.${name}`, serviceId: id, requestId: requestId() }; }
  if (name === 'autostart') {
    requireWords(3);
    if (value !== 'on' && value !== 'off') throw new SystemError('USAGE', 'autostart 必须指定 on 或 off');
    return { name: 'service.autostart', serviceId: id, enabled: value === 'on', requestId: requestId() };
  }
  if (name === 'terminate') {
    requireWords(3);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !value.trim()) throw new SystemError('USAGE', 'terminate 需要有效 PID 和精确 startedAt');
    return { name: 'process.terminate', process: { pid: Number(id), startedAt: value }, force: args.force, requestId: requestId() };
  }
  throw new SystemError('USAGE', '未知 system 命令；使用 system --help 查看用法');
}

export async function runSystemCli(argv: string[], io: { stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } } = process): Promise<number> {
  let submittedRequestId: string | undefined;
  try {
    const args = parseSystemArgs(argv);
    if (args.help) { io.stdout.write(JSON.stringify({ ok: true, result: { help: SYSTEM_HELP } }) + '\n'); return 0; }
    if (args.words[0] === 'tui') {
      if (args.words.length !== 1 || args.force || args.limit || args.after !== undefined || args.requestId) throw new SystemError('USAGE', 'tui 参数不正确');
      const { runSystemTui } = await import('./tui.ts');
      return await runSystemTui(new SystemClient(args));
    }
    const request = systemRequest(args);
    const client = new SystemClient(args);
    if ('requestId' in request) {
      submittedRequestId = request.requestId;
      const operation = await client.command(request);
      const success = operation.status === 'succeeded';
      io.stdout.write(JSON.stringify({ ok: success, result: operation, ...(!success ? { error: operation.error ?? { code: 'OPERATION_INCOMPLETE', message: `操作状态 ${operation.status}；请查历史` } } : {}) }) + '\n');
      return success ? 0 : 1;
    }
    io.stdout.write(JSON.stringify({ ok: true, result: await client.query(request) }) + '\n');
    return 0;
  } catch (error) {
    const failure = error instanceof SystemError ? error : new SystemError('UNAVAILABLE', '设备控制命令未完成');
    const exitCode = failure.code === 'USAGE' ? 2 : ['AUTH', 'UNAUTHORIZED', 'FORBIDDEN', 'PERMISSION'].includes(failure.code) ? 3 : failure.code === 'NOT_TTY' ? 11 : 4;
    io.stdout.write(JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message }, exitCode, ...(submittedRequestId ? { requestId: submittedRequestId } : {}) }) + '\n');
    return exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runSystemCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
