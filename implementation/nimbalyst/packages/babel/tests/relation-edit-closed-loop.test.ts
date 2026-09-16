// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BabelTui } from "../src/tui/app.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { createDemoServer } from "../src/server/http.ts";
import { command, openDomain, PROJECT, query, type TaskDetail } from "./helpers.ts";

const sessions: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (sessions.length) await sessions.pop()?.(); });
const key = (tui: BabelTui, name: string) => tui.feedEvent({ type: "key", name, raw: "", ctrl: name.startsWith("ctrl-"), shift: false });
async function waitUntil(pred: () => boolean) {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (pred()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for relation editor");
}
async function relationSession() {
  const opened = openDomain("off");
  const domain = opened.domain;
  const server = createDemoServer({ host: "127.0.0.1", port: 0, domain, serviceToken: "relation-editor-test" });
  await server.listen();
  sessions.push(async () => { await server.close(); await new Promise(resolve => setTimeout(resolve, 40)); opened.dispose(); });
  const created = await command(domain, "task.create", { title: "关系草稿目标", primaryType: "task" });
  const target = await command(domain, "task.create", { title: "决策依赖对象", primaryType: "decision" });
  const trackerId = created.trackerId!;
  const targetId = target.trackerId!;
  const revision = query<TaskDetail>(domain, "task.get", { trackerId }).record.revision;
  const http = new TuiHttp({ endpoint: server.endpoint });
  const tui = new BabelTui({ endpoint: server.endpoint, projectId: PROJECT, http, headless: true, cols: 170, rows: 44 });
  sessions.push(() => tui.dispose());
  await tui.boot();
  tui.feed("/关系草稿目标");
  key(tui, "enter");
  await waitUntil(() => tui.inspect().selectedId === trackerId);
  await waitUntil(() => {
    if (tui.inspect().overlay === "relation") return true;
    tui.feed("l");
    return tui.inspect().overlay === "relation";
  });
  return { domain, http, tui, trackerId, targetId, revision };
}

describe("TUI dependency draft safety through temporary HTTP", () => {
  it("keeps its captured revision and semantic target IDs, saves once, and freezes input while pending", async () => {
    const { domain, http, tui, trackerId, targetId, revision } = await relationSession();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = http.command.bind(http);
    const send = vi.spyOn(http, "command").mockImplementation(async request => { await pending; return original(request); });
    tui.feedEvent({ type: "paste", text: targetId });
    const cursor = domain.store.data.cursor;
    key(tui, "ctrl-s");
    key(tui, "ctrl-s");
    key(tui, "escape");
    tui.feed("must-not-change-draft");
    expect(send).toHaveBeenCalledTimes(1);
    expect(tui.inspect().overlay).toBe("relation");
    expect(tui.inspect().overlayRevision).toBe(revision);
    expect(tui.inspect().frame).toContain("正在保存");
    release();
    await waitUntil(() => tui.inspect().overlay === "none");
    expect(tui.inspect().error).toBeNull();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: "relation.set", projectId: PROJECT, expectedRevision: revision, input: { trackerId, dependsOn: [targetId], blocks: [] } }));
    const source = query<TaskDetail>(domain, "task.get", { trackerId });
    const target = query<TaskDetail>(domain, "task.get", { trackerId: targetId });
    expect(source.record.fields.dependsOn).toEqual([targetId]);
    expect(source.record.revision).toBe(revision + 1);
    expect(target.record.fields.blocks).toContain(trackerId);
    expect(target.record.primaryType).toBe("decision");
    expect(target.binding.executionEnabled).toBe(false);
    expect(domain.eventsSince(PROJECT, cursor).filter(event => event.trackerId === trackerId && event.type === "task.updated")).toHaveLength(1);
  });

  it("cancels a draft without writing, including the menu entry", async () => {
    const { domain, http, tui, trackerId, targetId, revision } = await relationSession();
    const send = vi.spyOn(http, "command");
    tui.feedEvent({ type: "paste", text: targetId });
    key(tui, "escape");
    expect(send).not.toHaveBeenCalled();
    expect(query<TaskDetail>(domain, "task.get", { trackerId }).record.revision).toBe(revision);
    tui.feed("o");
    const index = tui.inspect().menuItems.findIndex(item => item.id === "relation");
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) key(tui, "down");
    key(tui, "enter");
    expect(tui.inspect().overlay).toBe("relation");
    expect(tui.inspect().overlayRevision).toBe(revision);
    key(tui, "escape");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["READ_ONLY", "REVISION_CONFLICT", "cycle"])("retains the same dependency draft and version after %s refusal", async code => {
    const { domain, tui, trackerId, targetId, revision } = await relationSession();
    tui.feedEvent({ type: "paste", text: targetId });
    if (code === "READ_ONLY") domain.store.transaction(data => { data.records.find(record => record.id === targetId)!.system.readOnly = true; });
    else if (code === "REVISION_CONFLICT") await command(domain, "task.update", { trackerId, title: "远端已改" }, { expectedRevision: revision });
    else {
      key(tui, "tab");
      tui.feedEvent({ type: "paste", text: targetId });
    }
    const before = structuredClone(domain.store.data.records);
    const cursor = domain.store.data.cursor;
    key(tui, "ctrl-s");
    await waitUntil(() => Boolean(tui.inspect().error));
    if (code !== "cycle") expect(tui.inspect().error).toContain(code);
    expect(tui.inspect().overlay).toBe("relation");
    expect(tui.inspect().overlayRevision).toBe(revision);
    expect(tui.inspect().frame).toContain(targetId);
    expect(tui.inspect().frame).toContain(tui.inspect().error!);
    expect(domain.store.data.records).toEqual(before);
    expect(domain.eventsSince(PROJECT, cursor).filter(event => event.type === "task.updated")).toHaveLength(0);
    key(tui, "escape");
    expect(tui.inspect().overlay).toBe("none");
  });

  it("never retargets a dependency draft when refresh changes the selected record", async () => {
    const { domain, http, tui, trackerId, targetId, revision } = await relationSession();
    tui.feedEvent({ type: "paste", text: targetId });
    const other = await command(domain, "task.create", { title: "关系草稿目标另一个", primaryType: "task" });
    await command(domain, "task.update", { trackerId, title: "离开筛选" }, { expectedRevision: revision });
    await tui.reconnectNow();
    expect(tui.inspect().selectedId).toBe(other.trackerId);
    const before = structuredClone(domain.store.data.records);
    const send = vi.spyOn(http, "command");
    key(tui, "ctrl-s");
    await waitUntil(() => Boolean(tui.inspect().error) || tui.inspect().overlay === "none");
    expect(send.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: revision, input: { trackerId } });
    expect(tui.inspect().error).toContain("REVISION_CONFLICT");
    expect(tui.inspect().overlay).toBe("relation");
    expect(tui.inspect().frame).toContain(targetId);
    expect(domain.store.data.records).toEqual(before);
  });

  it("refuses entry for a readonly selected record", async () => {
    const { domain, http, tui, trackerId } = await relationSession();
    key(tui, "escape");
    domain.store.transaction(data => { data.records.find(record => record.id === trackerId)!.system.readOnly = true; });
    await tui.reconnectNow();
    const send = vi.spyOn(http, "command");
    tui.feed("l");
    expect(tui.inspect().overlay).toBe("none");
    expect(tui.inspect().error).toContain("READ_ONLY");
    expect(send).not.toHaveBeenCalled();
  });
});
