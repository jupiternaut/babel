import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DemoTrackerDataSource } from "../src/adapters/DemoTrackerDataSource.ts";
import {
  BabelError,
  DEMO_UNIMPLEMENTED_CODE,
  DEMO_UNIMPLEMENTED_MESSAGE,
  type CommandName,
} from "../src/contracts.ts";
import { createDemoServer } from "../src/server/http.ts";
import { PROJECT, SRC_ROOT, command, expectCode, openDomain, query, type TaskDetail } from "./helpers.ts";

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

describe("unknown / unimplemented commands return structured failure", () => {
  it("DomainService rejects an unknown command without writing", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    const error = await expectCode(
      () => d.command({
        name: "task.delete" as CommandName,
        projectId: PROJECT,
        input: { trackerId: "fixture-tracker-pdf" },
      }),
      "USAGE",
    );
    expect(error.message).toMatch(/未知命令/);
    expect(d.store.data.cursor).toBe(cursor);
    expect(d.store.data.records.length).toBe(count);
    const events = d.eventsSince(PROJECT, cursor);
    expect(events).toHaveLength(0);
    const detail = query<TaskDetail>(d, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(detail.record.fields.title).toContain("PDF");
  });

  it("HTTP unknown command body is ok:false and has no side effects", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "lr04-unknown-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });
    const cursor = opened.domain.store.data.cursor;
    const response = await fetch(`${server.endpoint}/v2/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "task.delete",
        projectId: PROJECT,
        input: { trackerId: "fixture-tracker-pdf" },
      }),
    });
    expect(response.ok).toBe(false);
    const body = await response.json() as { ok?: boolean; code?: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("USAGE");
    expect(body.message).toMatch(/未知命令/);
    expect(opened.domain.store.data.cursor).toBe(cursor);
    const detail = query<TaskDetail>(opened.domain, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(detail.record.archived).toBe(false);
  });

  it("CLI unknown task verb prints ok:false and does not need 7780", async () => {
    const result = await spawnCli([
      "task",
      "delete",
      "--project",
      PROJECT,
      "--id",
      "fixture-tracker-pdf",
      "--json",
      "--endpoint",
      "http://127.0.0.1:1",
    ]);
    expect(result.code).not.toBe(0);
    const body = JSON.parse(result.stdout) as { ok?: boolean; code?: string; message?: string; mode?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("USAGE");
    expect(body.message).toMatch(/未知 task 动作/);
    expect(body.mode).toBe("demo");
  });

  it("DemoTrackerDataSource delete-item is UNAVAILABLE without mutating the domain", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "lr04-unimpl-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });
    const source = new DemoTrackerDataSource({ endpoint: server.endpoint, projectId: PROJECT });
    const denied = await source.command({ type: "delete-item", itemId: "fixture-tracker-pdf" });
    expect(denied.ok).toBe(false);
    expect((denied.result as { code?: string } | undefined)?.code).toBe(DEMO_UNIMPLEMENTED_CODE);
    expect((denied.result as { message?: string } | undefined)?.message).toBe(DEMO_UNIMPLEMENTED_MESSAGE);
    source.dispose();
    const detail = query<TaskDetail>(opened.domain, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(detail.record.id).toBe("fixture-tracker-pdf");
  });

  it("maps a thrown BabelError to the same ok:false shape the CLI prints", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const cursor = opened.domain.store.data.cursor;
    const count = opened.domain.store.data.records.length;
    try {
      await command(opened.domain, "task.create", { title: "   " });
      expect.fail("blank title should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      const babel = error as BabelError;
      const body = { ok: false as const, code: babel.code, message: babel.message, mode: "demo" as const };
      expect(body.ok).toBe(false);
      expect(body.code).toBe("VALIDATION");
    }
    expect(opened.domain.store.data.cursor).toBe(cursor);
    expect(opened.domain.store.data.records.length).toBe(count);
    const listed = query<{ items: Array<{ title: string }> }>(opened.domain, "task.list", {
      types: "all",
      includeSemantic: true,
      q: "空白标题不应出现",
    });
    expect(listed.items).toHaveLength(0);
  });
});
