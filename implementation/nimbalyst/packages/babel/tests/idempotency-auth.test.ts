import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BabelHttpClient } from "../src/adapters/client.ts";
import { DemoTrackerDataSource } from "../src/adapters/DemoTrackerDataSource.ts";
import { DEFAULT_PROJECT_ID } from "../src/contracts.ts";
import { createDemoServer } from "../src/server/http.ts";
import {
  EXAMPLES_DIR,
  PROJECT,
  command,
  expectCode,
  hookInput,
  openDomain,
  query,
  type TaskDetail,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("concurrent idempotency", () => {
  it("replays the same trackerId when two creates share a key during an async hook", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const slow = path.join(opened.profileDir, "slow-allow.mjs");
    writeFileSync(slow, `
await new Promise((resolve) => setTimeout(resolve, 60));
process.stdout.write(JSON.stringify({ allow: true }) + "\\n");
`, "utf8");
    await command(opened.domain, "hook.register", {
      hookId: "tmp-slow-allow",
      phase: "beforeCommand",
      commands: ["task.create"],
      executable: "node",
      argv: [slow],
      cwd: opened.profileDir,
      timeoutMs: 2000,
      required: true,
      envAllow: [],
    });
    const before = opened.domain.store.data.records.length;
    const [first, second] = await Promise.all([
      command(opened.domain, "task.create", { title: "并发幂等" }, { idempotencyKey: "dup-create-1" }),
      command(opened.domain, "task.create", { title: "并发幂等" }, { idempotencyKey: "dup-create-1" }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.trackerId).toBe(first.trackerId);
    expect(opened.domain.store.data.records.length).toBe(before + 1);
    const listed = query<TaskListResult>(opened.domain, "task.list", { types: "all", q: "并发幂等" });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.trackerId).toBe(first.trackerId);
  });

  it("rejects the same in-flight key with a different payload", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const slow = path.join(opened.profileDir, "slow-allow.mjs");
    writeFileSync(slow, `
await new Promise((resolve) => setTimeout(resolve, 60));
process.stdout.write(JSON.stringify({ allow: true }) + "\\n");
`, "utf8");
    await command(opened.domain, "hook.register", {
      hookId: "tmp-slow-conflict",
      phase: "beforeCommand",
      commands: ["task.create"],
      executable: "node",
      argv: [slow],
      cwd: opened.profileDir,
      timeoutMs: 2000,
      required: true,
      envAllow: [],
    });
    const pending = command(opened.domain, "task.create", { title: "第一份" }, { idempotencyKey: "dup-conflict-1" });
    await expectCode(
      () => command(opened.domain, "task.create", { title: "另一份" }, { idempotencyKey: "dup-conflict-1" }),
      "IDEMPOTENCY_CONFLICT",
    );
    const first = await pending;
    expect(first.ok).toBe(true);
  });
});

describe("HTTP hook register trust boundary", () => {
  it("rejects anonymous hook.register and accepts a service token", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "test-service-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });

    const denied = await fetch(`${server.endpoint}/v2/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "hook.register",
        projectId: PROJECT,
        input: hookInput({
          hookId: "http-anon",
          phase: "beforeCommand",
          script: "allow.mjs",
          commands: ["task.create"],
        }),
      }),
    });
    expect(denied.status).toBe(403);
    const deniedBody = await denied.json() as { code?: string };
    expect(deniedBody.code).toBe("PERMISSION");
    expect(opened.domain.store.data.hookConfigs.some((row) => row.hookId === "http-anon")).toBe(false);

    const allowed = await fetch(`${server.endpoint}/v2/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-service-token",
      },
      body: JSON.stringify({
        name: "hook.register",
        projectId: PROJECT,
        input: hookInput({
          hookId: "http-trusted",
          phase: "beforeCommand",
          script: "allow.mjs",
          commands: ["task.create"],
        }),
      }),
    });
    expect(allowed.ok).toBe(true);
    expect(opened.domain.store.data.hookConfigs.some((row) => row.hookId === "http-trusted")).toBe(true);
  });

  it("does not reflect a foreign Origin", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "test-service-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });
    const preflight = await fetch(`${server.endpoint}/v2/health`, {
      method: "OPTIONS",
      headers: { origin: "https://example.invalid" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(preflight.headers.get("access-control-allow-origin")).not.toBe("https://example.invalid");
  });
});

describe("same record identity across clients", () => {
  it("keeps the caller-supplied TrackerRecord.id on create", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const created = await command(opened.domain, "task.create", {
      id: "host-tracker-keep-id",
      title: "宿主传入 ID",
      primaryType: "task",
    });
    expect(created.trackerId).toBe("host-tracker-keep-id");
    const detail = query<TaskDetail>(opened.domain, "task.get", { trackerId: "host-tracker-keep-id" });
    expect(detail.record.id).toBe("host-tracker-keep-id");
    expect(detail.record.projectId).toBe(PROJECT);
    expect(detail.binding.trackerId).toBe("host-tracker-keep-id");
  });

  it("HTTP create then query returns the same (projectId, trackerId)", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({
      host: "127.0.0.1",
      port: 0,
      domain: opened.domain,
      serviceToken: "test-service-token",
    });
    await server.listen();
    sessions.push({
      dispose() {
        void server.close();
        opened.dispose();
      },
    });
    const client = new BabelHttpClient({ endpoint: server.endpoint });
    const created = await client.command({
      name: "task.create",
      projectId: DEFAULT_PROJECT_ID,
      input: { title: "跨端同一记录", id: "cross-surface-tracker" },
    });
    const detail = await client.query<TaskDetail>({
      name: "task.get",
      projectId: DEFAULT_PROJECT_ID,
      input: { trackerId: created.trackerId },
    });
    expect(created.projectId).toBe(DEFAULT_PROJECT_ID);
    expect(created.trackerId).toBe("cross-surface-tracker");
    expect(detail.record.id).toBe("cross-surface-tracker");
    expect(detail.record.projectId).toBe(DEFAULT_PROJECT_ID);

    const source = new DemoTrackerDataSource({ endpoint: server.endpoint, projectId: DEFAULT_PROJECT_ID });
    const snap = await source.snapshot();
    expect(snap.items.some((item) => item.id === "cross-surface-tracker")).toBe(true);
    source.dispose();
  });
});

void EXAMPLES_DIR;
