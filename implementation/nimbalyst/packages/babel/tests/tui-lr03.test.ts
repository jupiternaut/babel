import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID, DEMO_ACTOR } from "../src/contracts.ts";
import { createDemoServer } from "../src/server/http.ts";
import { BabelTui } from "../src/tui/app.ts";
import { TuiHttp } from "../src/tui/http.ts";
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

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  delete process.env.BABEL_SERVICE_TOKEN;
  while (sessions.length) await sessions.pop()?.dispose();
});

async function waitUntil(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for TUI state");
}

async function startHeadless() {
  const opened = openDomain("off");
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "lr03-tui-token",
  });
  await server.listen();
  const http = new TuiHttp({
    endpoint: server.endpoint,
    actor: { ...DEMO_ACTOR, kind: "tui" },
  });
  const tui = new BabelTui({
    endpoint: server.endpoint,
    projectId: PROJECT,
    http,
    headless: true,
    cols: 120,
    rows: 40,
  });
  sessions.push({
    dispose: async () => {
      tui.dispose();
      await server.close();
    },
  });
  await tui.boot();
  return { tui, http, domain: opened.domain, endpoint: server.endpoint };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

describe("TUI LR-03 discoverable entries", () => {
  it("cannot start the old selection while a new search is loading", async () => {
    const { tui, domain } = await startHeadless();
    const before = domain.store.data.runs.length;
    tui.feed('/不存在的新搜索\rs');
    await waitUntil(() => tui.inspect().items.length === 0);
    expect(domain.store.data.runs.length).toBe(before);
    expect(tui.inspect().selectedRunId).toBeNull();
  });
  it("exposes Chinese menu labels and keyboard/mouse paths for Ready/views/hooks", async () => {
    const { tui } = await startHeadless();
    const labels = tui.inspect().menuItems.map((item) => item.label).join("\n");
    expect(labels).toContain("查看就绪");
    expect(labels).toContain("已保存视图");
    expect(labels).toContain("设置依赖关系");
    expect(labels).toContain("上移");
    expect(labels).toContain("Hook 与投递");

    tui.feed("o");
    expect(tui.inspect().overlay).toBe("menu");
    const readyIdx = tui.inspect().menuItems.findIndex((item) => item.id === "ready");
    const hit = tui.inspect().hits.find((row) => row.action === "menuitem" && row.id === String(readyIdx));
    expect(hit).toBeTruthy();
    tui.feedEvent({
      type: "mouse",
      kind: "down",
      button: 0,
      x: (hit?.x ?? 0) + 1,
      y: (hit?.y ?? 0) + 1,
      wheel: 0,
    });
    await waitUntil(() => tui.inspect().overlay === "ready");
    expect(stripAnsi(tui.inspect().frame)).toContain("依赖已满足");

    tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
    tui.feed("w");
    await waitUntil(() => tui.inspect().overlay === "views");
    expect(stripAnsi(tui.inspect().frame)).toContain("已保存视图");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().overlay === "none" && Boolean(tui.inspect().viewId));
    expect(tui.inspect().viewId).toBeTruthy();
  });

  it("saves a Chinese view name and applies ready.list / relation.set / task.reorder", async () => {
    const { tui, domain } = await startHeadless();
    tui.feed("w");
    await waitUntil(() => tui.inspect().overlay === "views");
    tui.feed("s");
    expect(tui.inspect().overlay).toBe("viewsave");
    tui.feed("缺陷筛选");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().overlay === "none" && !tui.inspect().error);
    const views = query<{ views: Array<{ name: string }> }>(domain, "view.list");
    expect(views.views.some((row) => row.name === "缺陷筛选")).toBe(true);

    const selected = tui.inspect().selectedId;
    expect(selected).toBeTruthy();
    const other = selected === "fixture-tracker-pdf" ? "fixture-tracker-research" : "fixture-tracker-pdf";
    tui.feed("l");
    await waitUntil(() => tui.inspect().overlay === "relation");
    tui.feed(other);
    tui.feed("\x13");
    await waitUntil(() => tui.inspect().overlay === "none");
    const rec = query<TaskDetail>(domain, "task.get", { trackerId: selected! });
    expect(rec.record.fields.dependsOn).toContain(other);

    const stageItems = tui.inspect().items.filter((row) => row.trackerId === selected);
    expect(stageItems.length).toBeGreaterThan(0);
    tui.feed("i");
    await waitUntil(() => !tui.inspect().status.includes("正在"));
    const after = query<TaskDetail>(domain, "task.get", { trackerId: selected! });
    expect(after.record.revision).toBeGreaterThanOrEqual(rec.record.revision);
  });

  it("lists hooks and shows a structured PERMISSION error when register has no service token", async () => {
    const { tui } = await startHeadless();
    tui.feed("g");
    await waitUntil(() => tui.inspect().overlay === "hooks");
    expect(stripAnsi(tui.inspect().frame)).toMatch(/Hook/);
    expect(tui.inspect().canRegisterHook).toBe(true);
    tui.feed("n");
    await waitUntil(() => tui.inspect().overlay === "hookregister");
    tui.feed("tui-anon-hook");
    tui.feed("\x13");
    await waitUntil(() => (tui.inspect().error ?? "").includes("PERMISSION"));
    expect(tui.inspect().error).toMatch(/^PERMISSION:/);
  });

  it("retries an observe delivery from the Hook overlay without starting a new run", async () => {
    const { tui, domain } = await startHeadless();
    await command(domain, "hook.register", hookInput({
      hookId: "tui-observe-fail",
      phase: "observe",
      script: "observe-fail.mjs",
    }));
    const created = await command(domain, "task.create", { title: "TUI 观察失败" });
    await waitOutboxAttempted(domain);
    const before = query<HookList>(domain, "hook.list");
    const failed = before.outbox.find((row) => row.hookId === "tui-observe-fail");
    expect(failed).toBeTruthy();
    const runCount = domain.store.data.runs.length;
    const revision = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId! }).record.revision;

    tui.feed("g");
    await waitUntil(() => tui.inspect().overlay === "hooks");
    tui.feedEvent({ type: "key", name: "tab", raw: "\t", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().overlayTab === "outbox");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().overlay === "none");
    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId! });
    expect(after.record.revision).toBe(revision);
    expect(domain.store.data.runs.length).toBe(runCount);
  });

  it("keeps the same run across resize and reconnect", async () => {
    const { tui, http } = await startHeadless();
    const trackerId = tui.inspect().selectedId;
    expect(trackerId).toBeTruthy();
    const started = await http.command({
      name: "run.start",
      projectId: PROJECT,
      input: { trackerId },
      idempotencyKey: `tui-lr03-${Date.now()}`,
    });
    expect(started.runId).toBeTruthy();
    const listed = await http.query<{ runs: Array<{ id: string }> }>({
      name: "run.list",
      projectId: PROJECT,
      input: { trackerId },
    });
    await tui.reconnectNow();
    expect(tui.inspect().selectedId).toBe(trackerId);
    expect(tui.inspect().selectedRunId).toBe(started.runId);
    expect(tui.inspect().connected).toBe(true);

    tui.resize(80, 24);
    const narrow = stripAnsi(tui.inspect().frame);
    expect(narrow).toContain("就绪");
    expect(tui.inspect().cols).toBe(80);
    tui.resize(120, 40);
    expect(stripAnsi(tui.inspect().frame)).toContain("Hook");
    expect(tui.inspect().selectedRunId).toBe(started.runId);

    await tui.reconnectNow();
    const again = await http.query<{ runs: Array<{ id: string }> }>({
      name: "run.list",
      projectId: PROJECT,
      input: { trackerId },
    });
    expect(again.runs.map((row) => row.id).sort()).toEqual(listed.runs.map((row) => row.id).sort());
    expect(tui.inspect().selectedRunId).toBe(started.runId);
  });
});
