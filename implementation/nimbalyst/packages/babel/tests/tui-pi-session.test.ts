// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BabelError, DEFAULT_PROJECT_ID, type CommandResult } from "../src/contracts.ts";
import { BabelTui } from "../src/tui/app.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { createDemoServer } from "../src/server/http.ts";
import { command, openDomain, query, type TaskDetail } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const target = { workdir: "/tmp/babel-explicit-project", provider: "test-provider", model: "test-model" };
const enter = (tui: BabelTui) => tui.feed("\r");
const escape = (tui: BabelTui) => tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
const frame = (tui: BabelTui) => tui.inspect().frame.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

async function fixture(running = false, mode: "demo" | "local" = "local") {
  const { domain } = openDomain("off");
  const created = await command(domain, "task.create", { title: "Pi 绑定任务" });
  const started = running ? await command(domain, "run.start", { trackerId: created.trackerId }) : undefined;
  if (started) domain.store.transaction(data => {
    const run = data.runs.find(row => row.id === started.runId)!;
    run.sessionId = "pi-session-123";
    run.messages = [
      { id: "input", role: "user", text: "检查当前文件", at: new Date().toISOString() },
      { id: "output", role: "agent", text: "已读取真实输出样例", at: new Date().toISOString() },
    ];
  });
  const server = createDemoServer({ host: "127.0.0.1", port: 0, domain, serviceToken: "tui-pi-test-token" });
  await server.listen();
  const http = new TuiHttp({ endpoint: server.endpoint });
  const original = http.query.bind(http);
  const config = { target: { ...target } };
  vi.spyOn(http, "query").mockImplementation(async request => {
    const value = await original<Record<string, unknown>>(request);
    if (request.name === "task.get") {
      const detail = value as unknown as TaskDetail;
      if (detail.latestRun && mode === "local") Object.assign(detail.latestRun, { execution: { kind: "pi", ...config.target } });
      return { ...value, mode, executionTarget: { ...config.target } } as never;
    }
    return { ...value, mode } as never;
  });
  const tui = new BabelTui({ http, headless: true, cols: 160, rows: 42 });
  cleanups.push(async () => { tui.dispose(); await server.close(); });
  await tui.boot();
  tui.feed("/Pi 绑定任务\r");
  await vi.waitFor(() => expect(tui.inspect().selectedId).toBe(created.trackerId));
  await vi.waitFor(() => expect(frame(tui)).toContain("Pi 绑定任务"));
  return { tui, http, domain, config, trackerId: created.trackerId!, runId: started?.runId };
}

function accepted(trackerId: string): CommandResult {
  return { ok: true, mode: "demo", commandStatus: "accepted", settled: false, revision: 1,
    projectId: DEFAULT_PROJECT_ID, trackerId, runId: "run-test", correlationId: "command-test", result: {} };
}

describe("TUI local Pi confirmation and session integration (transport fixtures, no model calls)", () => {
  it("does not launch before confirmation or after dismissal, then sends the frozen target/revision once", async () => {
    const { tui, http, domain, trackerId, config } = await fixture();
    const revision = query<TaskDetail>(domain, "task.get", { trackerId }).record.revision;
    let release!: (result: CommandResult) => void;
    const send = vi.spyOn(http, "command").mockImplementation(() => new Promise(resolve => { release = resolve; }));
    expect(tui.inspect().serviceMode).toBe("local");
    tui.feed("s");
    expect(tui.inspect().overlay).toBe("start");
    for (const text of [trackerId, target.workdir, target.provider, target.model]) expect(frame(tui)).toContain(text);
    expect(send).not.toHaveBeenCalled();
    escape(tui);
    tui.feed("s");
    tui.feed("n");
    expect(send).not.toHaveBeenCalled();
    tui.feed("s");
    config.target = { ...target, model: "changed-server-model" };
    await command(domain, "task.update", { trackerId, markdown: "另一个客户端修改正文" });
    await tui.reconnectNow();
    enter(tui);
    enter(tui);
    escape(tui);
    expect(tui.inspect().overlay).toBe("start");
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: "run.start", projectId: DEFAULT_PROJECT_ID, expectedRevision: revision,
      input: { trackerId, executionTarget: target }, idempotencyKey: expect.stringMatching(/^tui-start-/),
    }));
    release(accepted(trackerId));
    await vi.waitFor(() => expect(tui.inspect().overlay).toBe("none"));
  });

  it("preserves the confirmation and idempotency key after an ambiguous transport error", async () => {
    const { tui, http, trackerId } = await fixture();
    const send = vi.spyOn(http, "command")
      .mockRejectedValueOnce(new BabelError("UNAVAILABLE", "连接中断"))
      .mockResolvedValueOnce(accepted(trackerId));
    tui.feed("s");
    enter(tui);
    await vi.waitFor(() => expect(tui.inspect().error).toContain("UNAVAILABLE"));
    expect(tui.inspect().overlay).toBe("start");
    enter(tui);
    await vi.waitFor(() => expect(tui.inspect().overlay).toBe("none"));
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  });

  it("retains failed user input and run identity, prevents duplicate sends, and exposes both sides of the session", async () => {
    const { tui, http, runId } = await fixture(true);
    tui.feed("S");
    expect(tui.inspect().overlay).toBe("session");
    for (const text of ["pi-session-123", target.workdir, `${target.provider}/${target.model}`, "检查当前文件", "已读取真实输出样例"]) {
      expect(frame(tui)).toContain(text);
    }
    tui.feed("m");
    tui.feed("请检查中文输入");
    let reject!: (error: Error) => void;
    const send = vi.spyOn(http, "command").mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    enter(tui);
    enter(tui);
    expect(send).toHaveBeenCalledOnce();
    reject(new BabelError("UNAVAILABLE", "连接中断"));
    await vi.waitFor(() => expect(tui.inspect().error).toContain("UNAVAILABLE"));
    expect(tui.inspect().overlay).toBe("message");
    expect(frame(tui)).toContain("请检查中文输入");
    send.mockResolvedValueOnce(accepted("unused"));
    enter(tui);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(send.mock.calls[0]![0]).toMatchObject({ name: "run.message", input: { runId, text: "请检查中文输入" } });
  });

  it("keeps local cancellation pending and never offers demo termination reconciliation", async () => {
    const { tui, http, domain, trackerId, runId } = await fixture(true);
    await command(domain, "run.cancel", { runId, hold: true });
    await tui.reconnectNow();
    expect(tui.inspect().menuItems.some(item => item.id === "reconcile")).toBe(false);
    const send = vi.spyOn(http, "command");
    tui.feed("v");
    expect(frame(tui)).toContain("人工检查本次 Pi 结果");
    escape(tui);
    expect(send).not.toHaveBeenCalled();
    expect(query<TaskDetail>(domain, "task.get", { trackerId }).latestRun?.status).toBe("cancel_requested");
  });

  it("keeps the log viewport while new output arrives and resumes following only on End", async () => {
    const { tui, domain, runId } = await fixture(true);
    domain.store.transaction(data => {
      const run = data.runs.find(row => row.id === runId)!;
      run.messages = Array.from({ length: 60 }, (_, i) => ({
        id: `log-${i}`, role: "agent" as const, text: `log-line-${i}`, at: new Date().toISOString(),
      }));
    });
    await tui.reconnectNow();
    tui.feed("S");
    expect(frame(tui)).toContain("log-line-59");
    tui.feedEvent({ type: "key", name: "pageup", raw: "\x1b[5~", ctrl: false, shift: false });
    const before = frame(tui);
    expect(before).toContain("log-line-49");
    expect(before).not.toContain("log-line-59");
    domain.store.transaction(data => {
      data.runs.find(row => row.id === runId)!.messages.push({
        id: "new-output", role: "agent", text: "\x1b[2Jnew-live-output", at: new Date().toISOString(),
      });
    });
    await tui.reconnectNow();
    expect(frame(tui)).toContain("log-line-49");
    expect(frame(tui)).not.toContain("new-live-output");
    tui.feedEvent({ type: "key", name: "end", raw: "\x1b[F", ctrl: false, shift: false });
    expect(frame(tui)).toContain("new-live-output");
    expect(tui.inspect().frame).not.toContain("\x1b[2J");
  });

  it("blocks local writes for readonly tasks and preserves input when the current run changes", async () => {
    const { tui, http, domain, trackerId, runId } = await fixture(true);
    const send = vi.spyOn(http, "command");
    tui.feed("m");
    tui.feed("旧会话草稿");
    domain.store.transaction(data => {
      const run = data.runs.find(row => row.id === runId)!;
      run.id = "replacement-run";
      data.bindings.find(row => row.trackerId === trackerId)!.latestRunId = run.id;
      data.records.find(row => row.id === trackerId)!.system.readOnly = true;
    });
    await tui.reconnectNow();
    enter(tui);
    expect(send).not.toHaveBeenCalled();
    expect(tui.inspect().overlay).toBe("message");
    expect(frame(tui)).toContain("旧会话草稿");
    expect(tui.inspect().error).toContain("PRECONDITION");
    escape(tui);
    tui.feed("s");
    expect(send).not.toHaveBeenCalled();
    expect(tui.inspect().error).toContain("READ_ONLY");
  });

  it("retains the existing one-key demo start", async () => {
    const { tui, http } = await fixture(false, "demo");
    const send = vi.spyOn(http, "command");
    tui.feed("s");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(tui.inspect().serviceMode).toBe("demo");
    expect(send.mock.calls[0]![0].input).not.toHaveProperty("executionTarget");
  });
});
