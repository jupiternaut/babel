import { describe, expect, it } from "vitest";
import { executeCli } from "../src/cli/run.ts";
import {
  googleTasksStatus,
  nodeList,
  opsHealth,
  pdfLocate,
} from "../src/cli/surfaces.ts";
import { openSurface } from "../src/tui/surfaces.ts";

const ANSI = /\x1b\[/;

function parseStdout(text: string): Record<string, unknown> {
  expect(text).not.toMatch(ANSI);
  return JSON.parse(text.trim()) as Record<string, unknown>;
}

describe("LR-17 subsequent CLI entries match imported surface queries", () => {
  it("google-tasks status keeps realSync=false on CLI JSON and imported query", async () => {
    const imported = googleTasksStatus();
    expect(imported.ok).toBe(true);
    expect(imported.name).toBe("google-tasks.status");
    expect(imported.realSync).toBe(false);
    expect(imported.oauthStarted).toBe(false);
    expect(imported.pulled).toBe(false);
    expect(imported.usedUserToken).toBe(false);

    const cli = await executeCli(["google-tasks", "status", "--json"]);
    expect(cli.exitCode).toBe(0);
    const body = parseStdout(cli.stdout);
    expect(body.ok).toBe(true);
    expect(body.name).toBe(imported.name);
    expect(body.realSync).toBe(false);
    expect(body.oauthStarted).toBe(false);
    expect(body.pulled).toBe(false);
    expect(body.usedUserToken).toBe(false);
    expect(body.access).toBe(imported.access);
    expect(body.mode).toBe("demo");

    const overlay = openSurface("google-tasks");
    expect(overlay.lines.some((line) => line.includes("真实同步") && line.includes("否"))).toBe(true);
    expect(overlay.lines.some((line) => line.includes("已开 OAuth") && line.includes("否"))).toBe(true);
  });

  it("node list keeps realMachine=false on CLI JSON and imported query", async () => {
    const imported = nodeList();
    expect(imported.ok).toBe(true);
    expect(imported.name).toBe("node.list");
    expect(imported.realMachine).toBe(false);
    expect(imported.mode).toBe("synthetic");

    const cli = await executeCli(["node", "list", "--json"]);
    expect(cli.exitCode).toBe(0);
    const body = parseStdout(cli.stdout);
    expect(body.name).toBe("node.list");
    expect(body.realMachine).toBe(false);
    expect(body.mode).toBe("synthetic");
    expect(body.access).toBe(imported.access);
    expect(Array.isArray(body.snapshots)).toBe(true);

    const overlay = openSurface("nodes");
    expect(overlay.lines.some((line) => line.includes("真机") && line.includes("否"))).toBe(true);
  });

  it("ops health is demo, not probed, and does not claim a live machine", async () => {
    const imported = opsHealth();
    expect(imported.ok).toBe(true);
    expect(imported.name).toBe("ops.health.get");
    expect(imported.mode).toBe("demo");
    expect(imported.probed).toBe(false);
    expect(imported.autoExecute).toBe(false);
    expect(imported.restartAttempted).toBe(false);
    expect(imported.realMachine).toBeUndefined();

    const cli = await executeCli(["ops", "health", "--json"]);
    expect(cli.exitCode).toBe(0);
    const body = parseStdout(cli.stdout);
    expect(body.name).toBe("ops.health.get");
    expect(body.mode).toBe("demo");
    expect(body.probed).toBe(false);
    expect(body.autoExecute).toBe(false);
    expect(body.restartAttempted).toBe(false);
    expect(body.realSync).toBeUndefined();
    expect(body.liveTranslation).toBeUndefined();

    const overlay = openSurface("ops-health");
    expect(overlay.lines.some((line) => line.includes("已探测") && line.includes("否"))).toBe(true);
  });

  it("pdf locate keeps liveTranslation=false for hit and miss", async () => {
    const hitImported = pdfLocate("巴别塔演示样本");
    expect(hitImported.found).toBe(true);
    expect(hitImported.liveTranslation).toBe(false);
    expect(hitImported.source).toBe("test-fixture");

    const hitCli = await executeCli(["pdf", "locate", "--quote", "巴别塔演示样本", "--json"]);
    expect(hitCli.exitCode).toBe(0);
    const hit = parseStdout(hitCli.stdout);
    expect(hit.found).toBe(true);
    expect(hit.liveTranslation).toBe(false);
    expect(hit.name).toBe("pdf.locate");
    expect(hit.source).toBe(hitImported.source);

    const missImported = pdfLocate("这段文字不在样本里");
    expect(missImported.found).toBe(false);
    expect(missImported.liveTranslation).toBe(false);

    const missCli = await executeCli(["pdf", "locate", "--quote", "这段文字不在样本里", "--json"]);
    expect(missCli.exitCode).toBe(0);
    const miss = parseStdout(missCli.stdout);
    expect(miss.found).toBe(false);
    expect(miss.liveTranslation).toBe(false);
    expect(String(miss.note)).toContain("不是真实译文");

    const overlay = openSurface("pdf-locate", "巴别塔演示样本");
    expect(overlay.lines.some((line) => line.includes("真实译文") && line.includes("否"))).toBe(true);
  });
});
