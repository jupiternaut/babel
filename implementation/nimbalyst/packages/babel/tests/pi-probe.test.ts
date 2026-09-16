// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCli } from "../src/cli/run.ts";
import { probePi } from "../src/pi/probe.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(body: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "babel-pi-double-"));
  roots.push(root);
  const file = path.join(root, "protocol-double.mjs");
  writeFileSync(file, "#!/usr/bin/env node\n" + body);
  chmodSync(file, 0o700);
  return file;
}

describe("Pi probe CLI", () => {
  it("rejects missing/unknown parameters without launching or connecting to demo", async () => {
    for (const args of [[], ["start"], ["probe"], ["probe", "--executable"],
      ["probe", "--executable", "/unused", "--timeout", "NaN"],
      ["probe", "--executable", "/unused", "--provider", "not-authorized"]]) {
      const result = await executeCli(["pi", ...args]);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, mode: "pi-rpc-probe", code: "USAGE" });
      expect(result.exitCode).not.toBe(0);
    }
  });

  // POSIX executable fixtures: Windows uses a different executable format.
  it.skipIf(process.platform === "win32")("checks only an empty isolated session and confirms child exit", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-sentinel-not-a-real-key");
    vi.stubEnv("NODE_OPTIONS", "--throw-deprecation");
    const file = executable(`
      import { createInterface } from 'node:readline';
      if (process.env.ANTHROPIC_API_KEY || process.env.NODE_OPTIONS
        || !process.env.PI_CODING_AGENT_DIR.includes('babel-pi-probe-')
        || process.env.PI_OFFLINE !== '1'
        || !process.argv.includes('--no-extensions') || !process.argv.includes('--no-context-files')) process.exit(17);
      const types = [];
      createInterface({ input: process.stdin }).on('line', (line) => {
        const cmd = JSON.parse(line); types.push(cmd.type);
        if (!['get_state', 'get_messages'].includes(cmd.type)) process.exit(18);
        const data = cmd.type === 'get_state'
          ? {sessionId:'protocol-double-only', isStreaming:false, messageCount:0}
          : {messages:[]};
        process.stdout.write(JSON.stringify({type:'response', id:cmd.id, command:cmd.type, success:true, data})+'\\n');
      });
    `);
    const result = await executeCli(["pi", "probe", "--executable", file, "--json"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toMatchObject({ mode: "pi-rpc-probe", protocolConnected: true, shutdownConfirmed: true,
      requests: ["get_state", "get_messages"], modelExecutionVerified: false, taskIntegrationVerified: false });
    expect(() => process.kill(data.pid, 0)).toThrow();
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("test-sentinel");
  });

  it.skipIf(process.platform === "win32")("fails on invalid state, process launch error, and timeout; no retries", async () => {
    const invalid = executable(`
      import { createInterface } from 'node:readline';
      createInterface({ input:process.stdin }).on('line', line => {
        const c=JSON.parse(line);
        process.stdout.write(JSON.stringify({type:'response', id:c.id, command:c.type, success:true,
          data:c.type==='get_state'?{sessionId:'bad',isStreaming:true,messageCount:1}:{messages:[]}})+'\\n');
      });
    `);
    await expect(probePi(invalid)).rejects.toMatchObject({ code: "PROTOCOL" });
    const hanging = executable("process.stdin.resume();");
    await expect(probePi(hanging, 25)).rejects.toMatchObject({ code: "TIMEOUT" });
    const badInterpreter = executable("");
    writeFileSync(badInterpreter, "#!/babel-nonexistent-interpreter\n");
    const failed = await executeCli(["pi", "probe", "--executable", badInterpreter]);
    expect(JSON.parse(failed.stdout)).toMatchObject({ ok: false, code: "UNAVAILABLE", mode: "pi-rpc-probe" });
  });
});
