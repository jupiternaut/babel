import { BabelError, EXIT_BY_CODE } from "../contracts.ts";
import type { CliIo } from "../cli/run.ts";
import { probePi } from "./probe.ts";

export async function runPiCli(argv: string[], io: CliIo): Promise<number> {
  try {
    let executable: string | undefined;
    let timeout = 15000;
    if (argv[0] !== "probe") throw new BabelError("USAGE", "使用 babel pi probe --executable <Pi 可执行文件绝对路径> [--timeout 毫秒] --json");
    const seen = new Set<string>();
    for (let i = 1; i < argv.length; i++) {
      const option = argv[i];
      if (seen.has(option)) throw new BabelError("USAGE", `重复参数: ${option}`);
      seen.add(option);
      if (option === "--json") continue;
      if (option !== "--executable" && option !== "--timeout") throw new BabelError("USAGE", `未知参数: ${option}`);
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new BabelError("USAGE", `缺少 ${option} 参数`);
      if (option === "--executable") executable = value;
      else timeout = Number(value);
    }
    if (!executable) throw new BabelError("USAGE", "缺少 --executable；只检测明确指定的 Pi，不使用已有账号或会话");
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) throw new BabelError("USAGE", "--timeout 必须是 1～60000 毫秒的整数");
    io.stdout.write(JSON.stringify(await probePi(executable, timeout)) + "\n");
    return 0;
  } catch (error) {
    const code = error instanceof BabelError ? error.code : "UNAVAILABLE";
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = EXIT_BY_CODE[code];
    io.stdout.write(JSON.stringify({ ok: false, mode: "pi-rpc-probe", code, message, exitCode,
      modelExecutionVerified: false, taskIntegrationVerified: false }) + "\n");
    io.stderr.write(`${code}: ${message}\n`);
    return exitCode;
  }
}
