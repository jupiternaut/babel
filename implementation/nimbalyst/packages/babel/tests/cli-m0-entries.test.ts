import { describe, expect, it } from "vitest";
import { executeCli } from "../src/cli/run.ts";
import { parseArgv } from "../src/cli/parse.ts";
import { HELP_TEXT } from "../src/cli/help.ts";

function usageBody(stdout: string): { ok: false; code: string; exitCode: number } {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as { ok: false; code: string; exitCode: number };
}

describe("CLI M0 entries (USAGE, no HTTP)", () => {
  it("prints structured USAGE JSON on stdout and leaves ANSI out of stdout", async () => {
    const missingProject = await executeCli(["view", "save", "--name", "演示视图"]);
    expect(missingProject.exitCode).toBe(2);
    const body = usageBody(missingProject.stdout);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("USAGE");
    expect(body.exitCode).toBe(2);
    expect(missingProject.stdout).not.toMatch(/\x1b\[/);
    expect(missingProject.stderr).toContain("缺少或无效的参数");
  });

  it("requires name for view.save, relation fields, hook identity, and reorder anchors", async () => {
    const cases: Array<{ argv: string[]; fragment: string }> = [
      { argv: ["view", "save", "--project", "proj-demo"], fragment: "view.save" },
      { argv: ["relation", "set", "--project", "proj-demo", "--id", "trk-1"], fragment: "relation.set" },
      { argv: ["hook", "register", "--project", "proj-demo"], fragment: "hook.register" },
      { argv: ["hook", "retry", "--project", "proj-demo"], fragment: "hook.retry" },
      { argv: ["task", "reorder", "--project", "proj-demo", "--id", "trk-1"], fragment: "task.reorder" },
    ];
    for (const row of cases) {
      const result = await executeCli(row.argv);
      expect(result.exitCode, row.fragment).toBe(2);
      expect(result.stdout).toContain(row.fragment);
      expect(result.stdout).not.toMatch(/\x1b\[/);
    }
  });

  it("parses the new flags used by those entries", () => {
    const flags = parseArgv([
      "relation", "set",
      "--project", "proj-demo",
      "--id", "trk-1",
      "--depends-on", "a,b",
      "--blocks", "c",
      "--before", "trk-before",
      "--view-id", "view-1",
      "--hook-id", "hook-observe",
      "--phase", "observe",
    ]);
    expect(flags.project).toBe("proj-demo");
    expect(flags.dependsOn).toBe("a,b");
    expect(flags.blocks).toBe("c");
    expect(flags.before).toBe("trk-before");
    expect(flags.viewId).toBe("view-1");
    expect(flags.hookId).toBe("hook-observe");
    expect(flags.phase).toBe("observe");
  });

  it("documents the M0 verbs in help text", () => {
    expect(HELP_TEXT).toContain("view save");
    expect(HELP_TEXT).toContain("relation set");
    expect(HELP_TEXT).toContain("hook register");
    expect(HELP_TEXT).toContain("hook retry");
    expect(HELP_TEXT).toContain("task reorder");
    expect(HELP_TEXT).toContain("ready");
  });
});
