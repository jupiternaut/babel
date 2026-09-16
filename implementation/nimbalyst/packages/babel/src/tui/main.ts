import { stdin, stdout } from "node:process";
import {
  BabelError,
  DEFAULT_ENDPOINT,
  EXIT_BY_CODE,
} from "../contracts.ts";
import { BabelTui } from "./app.ts";

function parseTuiArgv(argv: string[]): { endpoint?: string; projectId?: string; profile?: string; help: boolean } {
  const out = { help: false } as { endpoint?: string; projectId?: string; profile?: string; help: boolean };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--help" || token === "-h") out.help = true;
    else if (token === "--endpoint") out.endpoint = argv[++i];
    else if (token === "--project") out.projectId = argv[++i];
    else if (token === "--profile") out.profile = argv[++i];
    else if (token.startsWith("--endpoint=")) out.endpoint = token.slice(11);
    else if (token.startsWith("--project=")) out.projectId = token.slice(10);
    else if (token.startsWith("--profile=")) out.profile = token.slice(10);
    else if (token === "--json") continue;
    else throw new BabelError("USAGE", `TUI 未知参数 ${token}`);
  }
  return out;
}

function writeNotTty(): never {
  const error = new BabelError(
    "NOT_TTY",
    "TUI 需要交互终端。请改用 CLI：npx tsx src/cli/main.ts --help",
    { stdin: Boolean(stdin.isTTY), stdout: Boolean(stdout.isTTY) },
  );
  const body = {
    ok: false,
    code: error.code,
    message: error.message,
    retryable: false,
    details: error.details,
    exitCode: EXIT_BY_CODE.NOT_TTY,
    mode: "demo",
  };
  process.stdout.write(`${JSON.stringify(body)}\n`);
  process.stderr.write(`${error.message}\n`);
  process.exit(EXIT_BY_CODE.NOT_TTY);
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseTuiArgv>;
  try {
    args = parseTuiArgv(process.argv.slice(2));
  } catch (error) {
    const babel = error instanceof BabelError ? error : new BabelError("USAGE", String(error));
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: babel.code,
      message: babel.message,
      retryable: false,
      details: babel.details,
      exitCode: EXIT_BY_CODE[babel.code],
      mode: "demo",
    })}\n`);
    process.exit(EXIT_BY_CODE[babel.code]);
  }
  if (args.help) {
    process.stderr.write(`babel TUI — 演示数据，连接 ${args.endpoint ?? process.env.BABEL_ENDPOINT ?? DEFAULT_ENDPOINT}
选项: --project --endpoint --profile
非 TTY 会返回 NOT_TTY（退出 11），请改用 CLI。
键位: j/k 移动  Enter 菜单  n 新建  e 编辑  s 开始  m 消息  y 就绪  w 视图  l 关系  u/i 排序  g Hook  c 取消  a 归档  r 恢复  v 验收  d 差异  h 历史  / 搜索  ? 帮助  q 退出
`);
    process.exit(0);
  }
  if (!stdin.isTTY || !stdout.isTTY) writeNotTty();
  const app = new BabelTui({
    endpoint: args.endpoint,
    projectId: args.projectId,
    profile: args.profile,
  });
  try {
    await app.run();
    process.exit(0);
  } catch (error) {
    if (error instanceof BabelError && error.code === "NOT_TTY") writeNotTty();
    const babel = error instanceof BabelError ? error : new BabelError("UNAVAILABLE", error instanceof Error ? error.message : "TUI 退出", {}, true);
    process.stderr.write(`${babel.code}: ${babel.message}\n`);
    process.exit(EXIT_BY_CODE[babel.code] ?? 1);
  }
}

void main();
