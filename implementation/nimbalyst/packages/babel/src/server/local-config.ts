import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { ProjectRecord } from "../contracts.ts";

export interface LocalPiConfig {
  project: ProjectRecord;
  executable: string;
  agentDir: string;
  provider: string;
  model: string;
  sessionDir: string;
}

/** Explicit, private, dedicated configuration. Never discover or copy user auth. */
export function loadLocalPiConfig(file: string, profileDir: string): LocalPiConfig {
  if (!path.isAbsolute(file) || !path.isAbsolute(profileDir)) throw new Error("本地配置与 profile 必须使用绝对路径");
  const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  for (const key of ["projectId", "name", "workdir", "executable", "agentDir", "provider", "model"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw new Error(`本地配置缺少 ${key}`);
  }
  const { projectId, name, workdir, executable, agentDir, provider, model } = config as Record<string, string>;
  for (const value of [workdir, executable, agentDir]) if (!path.isAbsolute(value)) throw new Error("执行路径必须是绝对路径");
  if (!statSync(workdir).isDirectory() || !statSync(executable).isFile()) throw new Error("工作目录或 Pi 可执行文件无效");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const expectedAgentDir = path.join(realpathSync(profileDir), "pi-agent");
  if (path.resolve(agentDir) !== expectedAgentDir || (existsSync(agentDir) && realpathSync(agentDir) !== expectedAgentDir)) {
    throw new Error("agentDir 必须是此 profile 下独立的 pi-agent 目录，不能复用或链接默认 Pi 配置");
  }
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  return { project: { id: projectId, name, workdir: realpathSync(workdir) }, executable: realpathSync(executable),
    agentDir, provider, model, sessionDir: path.join(realpathSync(profileDir), "pi-sessions") };
}
