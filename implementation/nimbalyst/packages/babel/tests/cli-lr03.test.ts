import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID, EXIT_BY_CODE } from "../src/contracts.ts";
import { executeCli } from "../src/cli/run.ts";
import { HELP_JSON, HELP_TEXT } from "../src/cli/help.ts";
import { parseArgv } from "../src/cli/parse.ts";
import { createDemoServer } from "../src/server/http.ts";
import {
  command,
  hookInput,
  openDomain,
  query,
  waitOutboxAttempted,
  type HookList,
  type TaskDetail,
} from "./helpers.ts";

const PROJECT = DEFAULT_PROJECT_ID;
const ANSI = /\x1b\[/;

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  delete process.env.BABEL_SERVICE_TOKEN;
  while (sessions.length) await sessions.pop()?.dispose();
});

async function startServer() {
  const opened = openDomain("off");
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "lr03-cli-token",
  });
  await server.listen();
  sessions.push({
    dispose: async () => {
      await server.close();
      opened.dispose();
    },
  });
  return { server, domain: opened.domain, endpoint: server.endpoint };
}

function parseStdout(text: string): Record<string, unknown> {
  expect(text).not.toMatch(ANSI);
  return JSON.parse(text.trim()) as Record<string, unknown>;
}

describe("CLI LR-03 usage and help", () => {
  it("prints JSON help without ANSI and lists new commands", async () => {
    const result = await executeCli(["--help", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(ANSI);
    const body = parseStdout(result.stdout);
    expect(body.commands).toEqual(HELP_JSON.commands);
    expect(HELP_JSON.commands).toEqual(expect.arrayContaining([
      "view save",
      "relation set",
      "hook list",
      "hook register",
      "hook retry",
      "task reorder",
    ]));
    expect(HELP_TEXT).not.toMatch(ANSI);
    expect(HELP_TEXT).toContain("babel view save");
    expect(HELP_TEXT).toContain("babel relation set");
    expect(HELP_TEXT).toContain("babel hook list");
    expect(HELP_TEXT).toContain("babel task reorder");
  });

  it("rejects missing arguments with USAGE JSON on stdout", async () => {
    const cases = [
      ["view", "save"],
      ["view", "save", "--project", PROJECT],
      ["relation", "set", "--project", PROJECT],
      ["relation", "set", "--project", PROJECT, "--id", "fixture-tracker-pdf"],
      ["task", "reorder", "--project", PROJECT, "--id", "fixture-tracker-pdf"],
      ["hook", "list"],
      ["hook", "register", "--project", PROJECT],
      ["hook", "retry", "--project", PROJECT],
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

  it("parses the new flags", () => {
    const flags = parseArgv([
      "relation", "set",
      "--project", PROJECT,
      "--id", "a",
      "--depends-on", "b,c",
      "--blocks", "d",
      "--name", "缺陷",
      "--before", "x",
      "--after", "y",
      "--delivery", "del-1",
      "--phase", "observe",
      "--hook-id", "h1",
      "--view-id", "v1",
      "--executable", "node",
    ]);
    expect(flags.dependsOn).toBe("b,c");
    expect(flags.blocks).toBe("d");
    expect(flags.name).toBe("缺陷");
    expect(flags.before).toBe("x");
    expect(flags.delivery).toBe("del-1");
    expect(flags.hookId).toBe("h1");
  });
});

describe("CLI LR-03 command/query against demo HTTP", () => {
  it("saves a view, sets relations, reorders, and lists hooks", async () => {
    const { endpoint, domain } = await startServer();
    const common = ["--project", PROJECT, "--endpoint", endpoint];

    const saved = await executeCli(["view", "save", ...common, "--name", "缺陷筛选"]);
    expect(saved.exitCode).toBe(0);
    const savedBody = parseStdout(saved.stdout);
    expect(savedBody.ok).toBe(true);
    expect(savedBody.mode).toBe("demo");
    const views = query<{ views: Array<{ name: string }> }>(domain, "view.list");
    expect(views.views.some((row) => row.name === "缺陷筛选")).toBe(true);

    const related = await executeCli([
      "relation", "set", ...common,
      "--id", "fixture-tracker-pdf",
      "--depends-on", "fixture-tracker-research",
    ]);
    expect(related.exitCode).toBe(0);
    const pdf = query<TaskDetail>(domain, "task.get", { trackerId: "fixture-tracker-pdf" });
    const research = query<TaskDetail>(domain, "task.get", { trackerId: "fixture-tracker-research" });
    expect(pdf.record.fields.dependsOn).toContain("fixture-tracker-research");
    expect(research.record.fields.blocks).toContain("fixture-tracker-pdf");

    const moved = await executeCli([
      "task", "reorder", ...common,
      "--id", "fixture-tracker-pdf",
      "--before", "fixture-tracker-research",
    ]);
    expect(moved.exitCode).toBe(0);
    const movedBody = parseStdout(moved.stdout) as { result?: { orderKey?: string } };
    expect(movedBody.result?.orderKey).toBeTruthy();

    const hooks = await executeCli(["hook", "list", ...common]);
    expect(hooks.exitCode).toBe(0);
    const hookBody = parseStdout(hooks.stdout);
    expect(hookBody.mode).toBe("demo");
    expect(Array.isArray(hookBody.hooks)).toBe(true);
    expect(Array.isArray(hookBody.outbox)).toBe(true);
    expect(Array.isArray(hookBody.deliveries)).toBe(true);
  });

  it("rejects hook.register without a service token and accepts with one", async () => {
    const { endpoint, domain } = await startServer();
    const denied = await executeCli([
      "hook", "register",
      "--project", PROJECT,
      "--endpoint", endpoint,
      "--hook-id", "cli-anon",
      "--phase", "observe",
      "--executable", "node",
    ]);
    expect(denied.exitCode).toBe(EXIT_BY_CODE.PERMISSION);
    const deniedBody = parseStdout(denied.stdout);
    expect(deniedBody.code).toBe("PERMISSION");
    expect(deniedBody.ok).toBe(false);
    expect(domain.store.data.hookConfigs.some((row) => row.hookId === "cli-anon")).toBe(false);

    process.env.BABEL_SERVICE_TOKEN = "lr03-cli-token";
    const allowed = await executeCli([
      "hook", "register",
      "--project", PROJECT,
      "--endpoint", endpoint,
      "--hook-id", "cli-trusted",
      "--phase", "observe",
      "--executable", "node",
    ]);
    expect(allowed.exitCode).toBe(0);
    expect(parseStdout(allowed.stdout).ok).toBe(true);
    expect(domain.store.data.hookConfigs.some((row) => row.hookId === "cli-trusted")).toBe(true);
  });

  it("retries a failed observe delivery without rerunning the command", async () => {
    const { endpoint, domain } = await startServer();
    await command(domain, "hook.register", hookInput({
      hookId: "cli-observe-fail",
      phase: "observe",
      script: "observe-fail.mjs",
    }));
    const created = await command(domain, "task.create", { title: "CLI 观察失败仍应存在" });
    await waitOutboxAttempted(domain);
    const before = query<HookList>(domain, "hook.list");
    const failed = before.outbox.find((row) => row.hookId === "cli-observe-fail");
    expect(failed).toBeTruthy();
    const revision = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId! }).record.revision;

    const retried = await executeCli([
      "hook", "retry",
      "--project", PROJECT,
      "--endpoint", endpoint,
      "--delivery", failed!.deliveryId,
    ]);
    expect(retried.exitCode).toBe(0);
    const body = parseStdout(retried.stdout) as { result?: { reranCommand?: boolean } };
    expect(body.result?.reranCommand).toBe(false);
    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId! });
    expect(after.record.revision).toBe(revision);
    expect(after.record.fields.title).toBe("CLI 观察失败仍应存在");
  });
});

describe("CAP-10 CLI reconciliation against demo HTTP", () => {
  it.each(["lost", "cancel_unconfirmed"] as const)("rejects a stale revision for %s without changing the run", async scenario => {
    const { endpoint, domain } = await startServer();
    const created = await command(domain, "task.create", { title: "CLI 核对版本" });
    await command(domain, "demo.inject", { trackerId: created.trackerId, scenario });
    const initial = structuredClone(query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId }));
    await command(domain, "task.update", { trackerId: created.trackerId, title: "另一端已更新" });
    const before = structuredClone(query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId }));
    const cursor = domain.store.data.cursor;

    const rejected = await executeCli([
      "run", "reconcile", "--project", PROJECT, "--endpoint", endpoint,
      "--id", initial.latestRun!.id, "--resolution", "cancelled",
      "--expected-revision", String(initial.record.revision), "--idempotency-key", "stale-reconcile",
    ]);

    expect(rejected.exitCode).toBe(EXIT_BY_CODE.REVISION_CONFLICT);
    expect(parseStdout(rejected.stdout)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId })).toEqual(before);
    expect(domain.eventsSince(PROJECT, cursor)).toEqual([]);
  });

  it.each(["lost", "cancel_unconfirmed"] as const)("replays %s reconciliation with the same key without a second transition", async scenario => {
    const { endpoint, domain } = await startServer();
    const created = await command(domain, "task.create", { title: "CLI 核对重试" });
    await command(domain, "demo.inject", { trackerId: created.trackerId, scenario });
    const before = structuredClone(query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId }));
    const cursor = domain.store.data.cursor;
    const resolution = scenario === "lost" ? "failed" : "cancelled";
    const argv = [
      "run", "reconcile", "--project", PROJECT, "--endpoint", endpoint,
      "--id", before.latestRun!.id, "--resolution", resolution,
      "--expected-revision", String(before.record.revision), "--idempotency-key", "reconcile-once",
    ];

    const accepted = await executeCli(argv);
    const replayed = await executeCli(argv);

    expect(accepted.exitCode).toBe(0);
    expect(replayed.exitCode).toBe(0);
    const original = parseStdout(accepted.stdout);
    expect(original.commandStatus).toBe("accepted");
    expect(parseStdout(replayed.stdout)).toEqual({ ...original, commandStatus: "replayed" });
    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(after.latestRun).toMatchObject({ id: before.latestRun!.id, status: resolution });
    expect(after.record.revision).toBe(before.record.revision + 1);
    expect(after.runs).toHaveLength(before.runs.length);
    expect(after.binding.outcome).toBe("unresolved");
    expect(after.stage).not.toBe("DONE");
    expect(domain.eventsSince(PROJECT, cursor).filter(event => event.type === "run.finished")).toHaveLength(1);
  });
});


describe("CLI basic field patches", () => {
  it("writes Unicode fields from JSON once, reads them back, and rejects stale or malformed patches without events", async () => {
    const { endpoint, domain } = await startServer();
    const dir = mkdtempSync(path.join(tmpdir(), "babel-cli-fields-"));
    sessions.push({ dispose: () => rmSync(dir, { recursive: true, force: true }) });
    const inputPath = path.join(dir, "fields.json");
    const created = await command(domain, "task.create", { title: "CLI 字段" });
    const trackerId = created.trackerId!;
    const revision = query<TaskDetail>(domain, "task.get", { trackerId }).record.revision;
    writeFileSync(inputPath, JSON.stringify({ owner: "产品同事", priority: "high", tags: ["玻璃界面", "待验收"] }));
    const args = ["task", "update", "--endpoint", endpoint, "--project", PROJECT, "--id", trackerId, "--input", inputPath, "--expected-revision", String(revision), "--idempotency-key", "cli-fields-once"];
    const cursor = domain.store.data.cursor;
    const first = await executeCli(args);
    const replay = await executeCli(args);
    expect(first.exitCode).toBe(0);
    expect(replay.exitCode).toBe(0);
    expect(first.stdout).not.toMatch(ANSI);
    expect(JSON.parse(replay.stdout).commandStatus).toBe("replayed");
    const get = await executeCli(["task", "get", "--endpoint", endpoint, "--project", PROJECT, "--id", trackerId]);
    expect(get.exitCode).toBe(0);
    expect(JSON.parse(get.stdout).record.fields).toMatchObject({ owner: "产品同事", priority: "high", tags: ["玻璃界面", "待验收"] });
    expect(domain.eventsSince(PROJECT, cursor).filter(e => e.type === "task.updated")).toHaveLength(1);
    const before = structuredClone(query<TaskDetail>(domain, "task.get", { trackerId }));
    const beforeReject = domain.store.data.cursor;
    const stale = await executeCli(args.slice(0, -2));
    expect(stale.exitCode).toBe(EXIT_BY_CODE.REVISION_CONFLICT);
    writeFileSync(inputPath, JSON.stringify({ owner: "不能部分写入", tags: [7] }));
    const invalidArgs = args.slice(0, -2);
    invalidArgs[invalidArgs.length - 1] = String(before.record.revision);
    const invalid = await executeCli(invalidArgs);
    expect(invalid.exitCode).toBe(EXIT_BY_CODE.VALIDATION);
    expect(query<TaskDetail>(domain, "task.get", { trackerId }).record).toEqual(before.record);
    expect(domain.eventsSince(PROJECT, beforeReject)).toHaveLength(0);
  });
});
