import { spawn } from "node:child_process";
import type { CommandName, CommandRequest, HookConfig } from "../contracts.ts";

export interface BeforeHookResult {
  allow: boolean;
  reason?: string;
  timedOut?: boolean;
}

export function runBeforeHook(hook: HookConfig, request: CommandRequest): Promise<BeforeHookResult> {
  const payload = {
    phase: "beforeCommand",
    hookId: hook.hookId,
    command: request.name,
    projectId: request.projectId,
    input: request.input,
    expectedRevision: request.expectedRevision,
    correlationId: request.correlationId,
    mode: "demo",
  };
  return runProcess(hook, payload).then((res) => {
    if (res.timedOut) return { allow: false, reason: `必需校验超时：${hook.hookId}`, timedOut: true };
    if (res.code !== 0) return { allow: false, reason: res.stderr || `Hook 退出码 ${res.code}` };
    try {
      const parsed = JSON.parse(res.stdout || "{}") as { allow?: boolean; reason?: string };
      if (parsed.allow === false) return { allow: false, reason: parsed.reason || "Hook 拒绝" };
      return { allow: true };
    } catch {
      return { allow: false, reason: "Hook 未返回合法 JSON" };
    }
  });
}

export function runObserveHook(hook: HookConfig, event: unknown): Promise<{ ok: boolean; error?: string; timedOut?: boolean }> {
  return runProcess(hook, event).then((res) => {
    if (res.timedOut) return { ok: false, error: "observe timeout", timedOut: true };
    if (res.code !== 0) return { ok: false, error: res.stderr || `exit ${res.code}` };
    return { ok: true };
  });
}

function runProcess(hook: HookConfig, payload: unknown): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(hook.executable, hook.argv, {
      cwd: hook.cwd,
      env: filteredEnv(hook.envAllow),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, hook.timeoutMs);
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut: false });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function filteredEnv(allow: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, BABEL_MODE: "demo" };
  for (const key of allow) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export function matchesCommand(hook: HookConfig, name: CommandName): boolean {
  return !hook.commands || hook.commands.length === 0 || hook.commands.includes(name);
}
