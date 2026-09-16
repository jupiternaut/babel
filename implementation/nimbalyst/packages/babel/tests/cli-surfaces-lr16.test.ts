import { describe, expect, it } from "vitest";
import { EXIT_BY_CODE } from "../src/contracts.ts";
import { executeCli } from "../src/cli/run.ts";
import { HELP_JSON, HELP_TEXT } from "../src/cli/help.ts";
import { parseArgv } from "../src/cli/parse.ts";
import { SURFACE_COMMANDS } from "../src/cli/surfaces.ts";

const ANSI = /\x1b\[/;

function parseStdout(text: string): Record<string, unknown> {
  expect(text).not.toMatch(ANSI);
  return JSON.parse(text.trim()) as Record<string, unknown>;
}

describe("CLI LR-16 surface help and USAGE", () => {
  it("lists subsequent surface commands in JSON and text help", async () => {
    const result = await executeCli(["--help", "--json"]);
    expect(result.exitCode).toBe(0);
    const body = parseStdout(result.stdout);
    expect(body.commands).toEqual(HELP_JSON.commands);
    expect(HELP_JSON.commands).toEqual(expect.arrayContaining([...SURFACE_COMMANDS]));
    expect(HELP_TEXT).toContain("babel google-tasks status");
    expect(HELP_TEXT).toContain("babel google-tasks pull");
    expect(HELP_TEXT).toContain("babel node list");
    expect(HELP_TEXT).toContain("babel ops health");
    expect(HELP_TEXT).toContain("babel pdf locate");
    expect(HELP_TEXT).toContain("未接入");
  });

  it("rejects missing surface arguments with USAGE JSON on stdout", async () => {
    const cases = [
      ["google-tasks", "pull"],
      ["google-tasks", "pull", "--tasklist"],
      ["pdf"],
      ["pdf", "locate"],
      ["pdf", "locate", "--quote"],
      ["google-tasks", "sync"],
      ["node", "ssh"],
      ["ops", "restart"],
    ];
    for (const argv of cases) {
      const result = await executeCli(argv);
      expect(result.exitCode, argv.join(" ")).toBe(EXIT_BY_CODE.USAGE);
      const body = parseStdout(result.stdout);
      expect(body.ok).toBe(false);
      expect(body.code).toBe("USAGE");
      expect(body.mode).toBe("demo");
      expect(result.stderr).toContain("缺少或无效的参数");
    }
  });

  it("parses surface flags without rewriting M0 flags", () => {
    const flags = parseArgv([
      "pdf", "locate",
      "--quote", "巴别塔演示样本",
      "--tasklist", "list-demo",
      "--service", "svc-demo",
      "--project", "proj-demo",
    ]);
    expect(flags.quote).toBe("巴别塔演示样本");
    expect(flags.tasklist).toBe("list-demo");
    expect(flags.service).toBe("svc-demo");
    expect(flags.project).toBe("proj-demo");
    expect(flags.rest).toEqual(["pdf", "locate"]);
  });
});

describe("CLI LR-16 surface queries", () => {
  it("reports Google Tasks as 未接入 and never claims a real sync", async () => {
    const status = await executeCli(["google-tasks", "status", "--json"]);
    expect(status.exitCode).toBe(0);
    const body = parseStdout(status.stdout);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("google-tasks.status");
    expect(body.mode).toBe("demo");
    expect(body.access).toBe("未接入");
    expect(body.realSync).toBe(false);
    expect(body.oauthStarted).toBe(false);
    expect(body.pulled).toBe(false);
    expect(body.usedUserToken).toBe(false);
    expect(body.syncLabel).toBe("未接入");
    expect(String(body.syncNote)).toContain("未接入");
    expect(String(body.syncNote)).toContain("不显示同步成功");
  });

  it("describes a try-pull without fabricating success", async () => {
    const pulled = await executeCli(["google-tasks", "pull", "--tasklist", "synthetic-list", "--json"]);
    expect(pulled.exitCode).toBe(0);
    const body = parseStdout(pulled.stdout) as {
      note?: string;
      pulled?: boolean;
      realSync?: boolean;
      access?: string;
      sync?: { ok?: boolean; realSync?: boolean; error?: string };
    };
    expect(body.access).toBe("未接入");
    expect(body.realSync).toBe(false);
    expect(body.pulled).toBe(false);
    expect(body.sync?.ok).toBe(false);
    expect(body.sync?.realSync).toBe(false);
    expect(body.sync?.error).toMatch(/重新登录|未接入/);
    expect(String(body.note)).toContain("不会同步成功");
  });

  it("lists synthetic nodes without claiming a real machine", async () => {
    const listed = await executeCli(["node", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    const body = parseStdout(listed.stdout) as { name?: string; mode?: string; access?: string; note?: string; snapshots?: unknown[]; realMachine?: boolean };
    expect(body.name).toBe("node.list");
    expect(body.mode).toBe("synthetic");
    expect(body.realMachine).toBe(false);
    expect(body.access).toBe("未接入");
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(String(body.note)).toMatch(/合成|未接真机/);
  });

  it("explains ops health as demo and not connected", async () => {
    const health = await executeCli(["ops", "health", "--json"]);
    expect(health.exitCode).toBe(0);
    const body = parseStdout(health.stdout);
    expect(body.name).toBe("ops.health.get");
    expect(body.mode).toBe("demo");
    expect(body.access).toBe("未接入");
    expect(body.autoExecute).toBe(false);
    expect(body.restartAttempted).toBe(false);
    expect(body.probed).toBe(false);
    expect(String(body.note)).toContain("演示");
  });

  it("locates a local PDF sample and rejects unknown quotes without fake success", async () => {
    const found = await executeCli(["pdf", "locate", "--quote", "巴别塔演示样本", "--json"]);
    expect(found.exitCode).toBe(0);
    const hit = parseStdout(found.stdout) as { name?: string; mode?: string; source?: string; found?: boolean; liveTranslation?: boolean; anchor?: { paragraphId?: string } };
    expect(hit.name).toBe("pdf.locate");
    expect(hit.mode).toBe("demo");
    expect(hit.found).toBe(true);
    expect(hit.liveTranslation).toBe(false);
    expect(hit.source).toBe("test-fixture");
    expect(hit.anchor?.paragraphId).toBe("p-1");

    const missed = await executeCli(["pdf", "locate", "--quote", "这段文字不在样本里", "--json"]);
    expect(missed.exitCode).toBe(0);
    const miss = parseStdout(missed.stdout);
    expect(miss.found).toBe(false);
    expect(miss.liveTranslation).toBe(false);
    expect(String(miss.note)).toContain("不是真实译文");
  });
});
