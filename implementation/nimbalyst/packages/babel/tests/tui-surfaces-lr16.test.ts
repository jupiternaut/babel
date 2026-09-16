import { afterEach, describe, expect, it } from "vitest";
import { DEMO_ACTOR, DEFAULT_PROJECT_ID } from "../src/contracts.ts";
import { createDemoServer } from "../src/server/http.ts";
import { BabelTui } from "../src/tui/app.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { SURFACE_MENU_ITEMS, SURFACE_SAMPLE_QUOTE } from "../src/tui/surfaces.ts";
import { openDomain } from "./helpers.ts";

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function headlessTui(cols = 120, rows = 40): BabelTui {
  const tui = new BabelTui({ headless: true, cols, rows });
  sessions.push({ dispose: () => tui.dispose() });
  return tui;
}

async function startHeadless() {
  const opened = openDomain("off");
  const server = createDemoServer({ serviceToken: "isolated-test-only",
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
  });
  await server.listen();
  const http = new TuiHttp({
    endpoint: server.endpoint,
    actor: { ...DEMO_ACTOR, kind: "tui" },
  });
  const tui = new BabelTui({
    endpoint: server.endpoint,
    projectId: DEFAULT_PROJECT_ID,
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
  return tui;
}

describe("TUI LR-16 discoverable subsequent surfaces", () => {
  it("exposes Chinese menu items for Google Tasks, nodes, ops, and PDF", () => {
    const tui = headlessTui();
    const labels = tui.inspect().menuItems.map((item) => item.label);
    expect(labels.join("\n")).toContain("查看 Google Tasks 状态（未接入/演示）");
    expect(labels.join("\n")).toContain("阅读试拉说明");
    expect(labels.join("\n")).toContain("列出合成节点");
    expect(labels.join("\n")).toContain("阅读运维健康说明（演示）");
    expect(labels.join("\n")).toContain("定位本地 PDF 样本");
    for (const item of SURFACE_MENU_ITEMS) {
      expect(tui.inspect().menuItems.some((row) => row.id === item.id)).toBe(true);
    }
  });

  it("opens Google Tasks and node overlays from the keyboard without a GUI window", () => {
    const tui = headlessTui();
    tui.feed("x");
    expect(tui.inspect().overlay).toBe("surface");
    expect(tui.inspect().surfaceId).toBe("google-tasks");
    const google = (tui.inspect().surfaceLines ?? []).join("\n");
    expect(google).toContain("未接入");
    expect(google).toContain("演示");
    expect(google).toMatch(/真实同步 否|realSync/);

    tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
    tui.feed("z");
    expect(tui.inspect().surfaceId).toBe("nodes");
    const nodes = (tui.inspect().surfaceLines ?? []).join("\n");
    expect(nodes).toMatch(/合成|未接入/);
    expect(nodes).toMatch(/真机 否|realMachine/);
  });

  it("opens ops health and locates the local PDF sample", () => {
    const tui = headlessTui();
    tui.feed("b");
    expect(tui.inspect().surfaceId).toBe("ops-health");
    const ops = (tui.inspect().surfaceLines ?? []).join("\n");
    expect(ops).toContain("未接入");
    expect(ops).toContain("演示");
    expect(ops).toMatch(/自动执行 否/);

    tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
    tui.feed("f");
    expect(tui.inspect().surfaceId).toBe("pdf-locate");
    const pdf = (tui.inspect().surfaceLines ?? []).join("\n");
    expect(pdf).toContain(SURFACE_SAMPLE_QUOTE);
    expect(pdf).toMatch(/命中 是/);
    expect(pdf).toMatch(/真实译文 否/);
    expect(pdf).toContain("test-fixture");
  });

  it("reaches Google Tasks from the operation menu and shows try-pull as 未接入", () => {
    const tui = headlessTui();
    tui.feed("o");
    expect(tui.inspect().overlay).toBe("menu");
    const idx = tui.inspect().menuItems.findIndex((item) => item.id === "google-tasks-pull");
    expect(idx).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < idx; i++) tui.feed("j");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    expect(tui.inspect().overlay).toBe("surface");
    expect(tui.inspect().surfaceId).toBe("google-tasks-pull");
    expect((tui.inspect().surfaceLines ?? []).join("\n")).toContain("不会同步成功");
    expect((tui.inspect().surfaceLines ?? []).join("\n")).toContain("未接入");
  });

  it("shows USAGE when the PDF excerpt is cleared", () => {
    const tui = headlessTui();
    tui.feed("f");
    const length = SURFACE_SAMPLE_QUOTE.length;
    for (let i = 0; i < length; i++) {
      tui.feedEvent({ type: "key", name: "backspace", raw: "\x7f", ctrl: false, shift: false });
    }
    expect((tui.inspect().surfaceLines ?? []).join("\n")).toContain("USAGE");
  });

  it("paints 后续 / help / surface text after boot and keeps the overlay across resize", async () => {
    const tui = await startHeadless();
    expect(tui.inspect().hits.some((hit) => hit.action === "surfaces")).toBe(true);
    expect(stripAnsi(tui.inspect().frame)).toContain("后续");

    tui.feedEvent({ type: "text", text: "?" });
    expect(tui.inspect().overlay).toBe("help");
    expect(stripAnsi(tui.inspect().frame)).toContain("Google Tasks");
    expect(stripAnsi(tui.inspect().frame)).toContain("未接入/演示");

    tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
    tui.feed("x");
    expect(tui.inspect().surfaceId).toBe("google-tasks");
    expect(stripAnsi(tui.inspect().frame)).toContain("未接入");
    tui.resize(80, 24);
    expect(tui.inspect().cols).toBe(80);
    expect(tui.inspect().surfaceId).toBe("google-tasks");
    expect(stripAnsi(tui.inspect().frame)).toContain("未接入");
  });
});
