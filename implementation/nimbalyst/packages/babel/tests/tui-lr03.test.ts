import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_ID, DEMO_ACTOR, type BabelEvent } from "../src/contracts.ts";
import type { TaskCard } from "../src/core/domain.ts";
import { executeCli } from "../src/cli/run.ts";
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
  it("filters attention through the shared projection, preserves four stages and replays events without duplicate cards", async () => {
    const { tui, http, domain, endpoint } = await startHeadless();
    for (const scenario of ["waiting_input", "verification_failed", "lost", "review_required"]) {
      const created = await command(domain, "task.create", { title: `WD02 ${scenario}` });
      const started = await command(domain, "run.start", { trackerId: created.trackerId });
      for (let step = 0; step < (scenario === "verification_failed" || scenario === "review_required" ? 3 : 1); step++) {
        await command(domain, "demo.inject", { runId: started.runId, scenario });
      }
    }
    let deliver: (event: BabelEvent) => void = () => { throw new Error("subscription not started"); };
    vi.spyOn(http, "watchEvents").mockImplementation((_project, _cursor, onEvent) => {
      deliver = onEvent;
      return { close() {} };
    });
    await tui.reconnectNow();
    const initialRunCount = domain.store.data.runs.length;
    tui.feed("!s");
    await waitUntil(() => tui.inspect().items.length === 4);
    expect(domain.store.data.runs.length).toBe(initialRunCount);
    expect(tui.inspect().items.every((card) => card.attention)).toBe(true);
    expect(tui.inspect().hits.filter((hit) => hit.action === "stage").map((hit) => hit.id)).toEqual(["TODO", "RUNNING", "DONE", "ARCHIVED"]);
    const cli = await executeCli(["task", "list", "--project", PROJECT, "--endpoint", endpoint, "--attention-only"]);
    expect(cli.exitCode).toBe(0);
    const authoritative = JSON.parse(cli.stdout) as { items: TaskCard[] };
    expect(tui.inspect().items).toEqual(authoritative.items);
    const selected = authoritative.items.find((card) => card.trackerId === tui.inspect().selectedId)!;
    tui.resize(80, 40);
    expect(stripAnsi(tui.inspect().frame)).toContain(`最后更新 ${selected.lastUpdatedAt}`);
    expect(stripAnsi(tui.inspect().frame)).toContain("需要关注");

    const extra = await command(domain, "task.create", { title: "WD02 重复投递" });
    const started = await command(domain, "run.start", { trackerId: extra.trackerId });
    await command(domain, "demo.inject", { runId: started.runId, scenario: "waiting_input" });
    const event = domain.store.data.events.at(-1)!;
    deliver(event);
    deliver(event);
    await waitUntil(() => tui.inspect().items.length === 5);
    expect(tui.inspect().items.filter((card) => card.trackerId === extra.trackerId)).toHaveLength(1);
    expect(new Set(tui.inspect().items.map((card) => card.trackerId)).size).toBe(5);
    tui.feed("/WD02 waiting_input\r");
    await waitUntil(() => tui.inspect().items.length === 1);
    expect(tui.inspect().items[0]?.title).toBe("WD02 waiting_input");
    tui.feed("/不存在\r");
    await waitUntil(() => tui.inspect().items.length === 0);
    expect(tui.inspect().selectedId).toBeNull();
  });

  it("offers an attention mouse entry and restores the full board when toggled off", async () => {
    const { tui } = await startHeadless();
    const count = tui.inspect().items.length;
    const hit = tui.inspect().hits.find((row) => row.action === "attention");
    expect(hit).toBeTruthy();
    tui.feedEvent({ type: "mouse", kind: "down", button: 0, x: hit!.x + 1, y: hit!.y + 1, wheel: 0 });
    await waitUntil(() => tui.inspect().items.length === 0);
    expect(tui.inspect().menuItems.find((item) => item.id === "attention")?.label).toContain("显示全部任务");
    tui.feed("!");
    await waitUntil(() => tui.inspect().items.length === count);
    expect(tui.inspect().menuItems.find((item) => item.id === "attention")?.label).toContain("只看需要关注");
  });

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
