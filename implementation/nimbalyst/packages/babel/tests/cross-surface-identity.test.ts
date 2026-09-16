import { writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CliHttp } from "../src/cli/http.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { PROJECT, SRC_ROOT, command, openDomain, query, relatedEvents, type TaskDetail } from "./helpers.ts";
import { createDemoServer } from "../src/server/http.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

function spawnCli(args: string[], extraEnv: Record<string, string> = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const cli = path.join(SRC_ROOT, "cli", "main.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: path.dirname(SRC_ROOT),
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("cross-surface identity on one DomainService", () => {
  it("CLI actor command and TUI actor query share (projectId, trackerId)", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const created = await command(d, "task.create", {
      id: "cross-cli-tui-tracker",
      title: "跨端同一权威",
      primaryType: "task",
    }, {
      actor: { id: "lr04-cli", kind: "cli", projectIds: [PROJECT] },
    });
    expect(created.ok).toBe(true);
    expect(created.projectId).toBe(PROJECT);
    expect(created.trackerId).toBe("cross-cli-tui-tracker");
    const events = relatedEvents(d, PROJECT, cursor, created.correlationId);
    expect(events.some((event) => event.trackerId === "cross-cli-tui-tracker")).toBe(true);

    const fromTui = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId }, {
      actor: { id: "lr04-tui", kind: "tui", projectIds: [PROJECT] },
    });
    expect(fromTui.record.id).toBe(created.trackerId);
    expect(fromTui.record.projectId).toBe(PROJECT);
    expect(fromTui.record.fields.title).toBe("跨端同一权威");

    const fromGui = query<TaskDetail>(d, "task.get", { trackerId: created.trackerId }, {
      actor: { id: "lr04-gui", kind: "gui", projectIds: [PROJECT] },
    });
    expect(fromGui.record.id).toBe(fromTui.record.id);
    expect(fromGui.record.revision).toBe(fromTui.record.revision);
  });

  it("ephemeral HTTP: CLI client writes, TUI client reads the same record", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "lr04-cross-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });

    const cli = new CliHttp({ endpoint: server.endpoint });
    const tui = new TuiHttp({ endpoint: server.endpoint });
    const cursor = opened.domain.store.data.cursor;
    const created = await cli.command({
      name: "task.create",
      projectId: PROJECT,
      input: { id: "cross-http-tracker", title: "CLI HTTP 写入" },
    });
    expect(created.ok).toBe(true);
    expect(created.trackerId).toBe("cross-http-tracker");
    const events = opened.domain.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.trackerId === "cross-http-tracker" && event.type === "task.updated")).toBe(true);

    const detail = await tui.query<TaskDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(detail.record.id).toBe("cross-http-tracker");
    expect(detail.record.projectId).toBe(PROJECT);
    expect(detail.record.fields.title).toBe("CLI HTTP 写入");

    const listed = query<{ items: Array<{ trackerId: string; title: string }> }>(opened.domain, "task.list", {
      types: "all",
      q: "CLI HTTP 写入",
    });
    expect(listed.items.some((item) => item.trackerId === "cross-http-tracker")).toBe(true);
  });

  it("spawned CLI create then DomainService query on an ephemeral port", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "lr04-cli-spawn-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });
    const inputPath = path.join(opened.profileDir, "cli-create.json");
    writeFileSync(inputPath, `${JSON.stringify({ title: "进程 CLI 创建", id: "cross-spawn-tracker" })}\n`, "utf8");
    const cursor = opened.domain.store.data.cursor;
    const spawned = await spawnCli([
      "task",
      "create",
      "--project",
      PROJECT,
      "--input",
      inputPath,
      "--json",
      "--endpoint",
      server.endpoint,
    ]);
    expect(spawned.code).toBe(0);
    const created = JSON.parse(spawned.stdout) as { ok?: boolean; trackerId?: string; projectId?: string; correlationId?: string };
    expect(created.ok).toBe(true);
    expect(created.projectId).toBe(PROJECT);
    expect(created.trackerId).toBe("cross-spawn-tracker");
    const events = opened.domain.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.trackerId === created.trackerId && event.type === "task.updated")).toBe(true);
    const detail = query<TaskDetail>(opened.domain, "task.get", { trackerId: created.trackerId! });
    expect(detail.record.id).toBe("cross-spawn-tracker");
    expect(detail.record.fields.title).toBe("进程 CLI 创建");
  });
});
