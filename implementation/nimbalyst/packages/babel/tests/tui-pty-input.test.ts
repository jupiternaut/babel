// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node-pty";
import { expect, it, vi } from "vitest";
import { createDemoServer } from "../src/server/http.ts";
import { command, openDomain } from "./helpers.ts";

it.skipIf(process.platform === "win32")("POSIX PTY: single Escape discards fields, keeps split input intact and restores terminal modes", async () => {
  const fixture = openDomain("off");
  const server = createDemoServer({ host: "127.0.0.1", port: 0, domain: fixture.domain, serviceToken: "pty-demo-test-token" });
  await server.listen();
  await command(fixture.domain, "task.create", { title: "终端取消输入验证" });
  const mutations = vi.spyOn(fixture.domain, "command");
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Positional arguments avoid interpreting paths as shell code. Compare the actual
  // terminal attributes around the child, not just its escape-sequence output.
  const terminal = spawn("/bin/sh", ["-c",
    'babel_tty_before=$(stty -g); "$@"; babel_tui_exit=$?; babel_tty_after=$(stty -g); ' +
    '[ "$babel_tty_before" = "$babel_tty_after" ] && printf "\\nBABEL_TTY_RESTORED\\n"; exit "$babel_tui_exit"',
    "babel-pty-test", process.execPath, "--import", "tsx", "src/tui/main.ts", "--endpoint", server.endpoint,
  ], { cwd, cols: 160, rows: 42, name: "xterm-256color",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fixture.profileDir, LANG: "en_US.UTF-8", TERM: "xterm-256color" } });
  let output = "";
  let exited = false;
  const data = terminal.onData(chunk => { output += chunk; });
  const exit = new Promise<number>(resolve => terminal.onExit(event => { exited = true; resolve(event.exitCode); }));
  const frame = () => output.slice(output.lastIndexOf("\x1b[H"));
  const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 6000, interval: 20 });
  try {
    await waitFor(() => expect(frame()).toContain("已连接"));
    terminal.write("/终端取消输入验证\r");
    await waitFor(() => {
      expect(frame()).toContain("[待办 1]");
      expect(frame()).toContain("终端取消输入验证");
      expect(frame()).toContain("执行 尚未执行");
    });
    terminal.write("F");
    await waitFor(() => expect(frame()).toContain("编辑字段"));
    terminal.write("\t\x1b[200~中文未保存\x1b[");
    await new Promise(resolve => setTimeout(resolve, 30));
    terminal.write("201~");
    await waitFor(() => expect(frame()).toContain("中文未保存"));
    terminal.write("\x1b");
    await waitFor(() => expect(frame()).not.toContain("编辑字段"));
    terminal.write("F");
    await waitFor(() => expect(frame()).toContain("编辑字段"));
    expect(frame()).not.toContain("中文未保存");
    terminal.write("\x1b");
    await waitFor(() => expect(frame()).not.toContain("编辑字段"));
    terminal.write("?");
    await waitFor(() => expect(frame()).toContain("演示数据 · 键盘"));
    terminal.write("\x1b");
    await new Promise(resolve => setTimeout(resolve, 20));
    terminal.write("[B");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(frame()).toContain("演示数据 · 键盘");
    terminal.write("\x1b");
    await waitFor(() => expect(frame()).not.toContain("演示数据 · 键盘"));
    terminal.resize(90, 30);
    terminal.write("q");
    await waitFor(() => expect(exited).toBe(true));
    expect(await exit).toBe(0);
    expect(output).toContain("BABEL_TTY_RESTORED");
    for (const mode of ["2004", "1006", "1002", "1000", "1049"]) expect(output).toContain(`\x1b[?${mode}l`);
    expect(output).toContain("\x1b[?25h");
    expect(mutations).not.toHaveBeenCalled();
  } finally {
    const evidence = process.env.BABEL_TUI_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(path.join(evidence, "pty.json"), JSON.stringify({ platform: process.platform, output, exited, mutations: mutations.mock.calls.length }, null, 2) + "\n");
    }
    if (!exited) terminal.kill();
    data.dispose();
    await server.close();
    fixture.dispose();
  }
}, 20000);
