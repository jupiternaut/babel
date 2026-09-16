// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BabelTui } from "../src/tui/app.ts";
import { InputDecoder } from "../src/tui/input.ts";
import { helpLines } from "../src/tui/render.ts";
import { displayWidth } from "../src/tui/width.ts";

describe("TUI input and Chinese width", () => {
  it("decodes Chinese text without splitting a wide glyph", () => {
    const decoder = new InputDecoder();
    const events = decoder.push("就绪筛选");
    expect(events.map((ev) => ev.type === "text" ? ev.text : "")).toEqual(["就", "绪", "筛", "选"]);
    expect(displayWidth("就绪")).toBe(4);
  });

  it("decodes SGR mouse clicks and wheel", () => {
    const decoder = new InputDecoder();
    const click = decoder.push("\x1b[<0;12;4M");
    expect(click).toEqual([
      { type: "mouse", kind: "down", button: 0, x: 12, y: 4, wheel: 0 },
    ]);
    const wheel = decoder.push("\x1b[<64;8;8M");
    expect(wheel[0]).toMatchObject({ type: "mouse", kind: "wheel" });
  });

  it("keeps Chinese labels in the help overlay", () => {
    const lines = helpLines().join("\n");
    expect(lines).toContain("就绪");
    expect(lines).toContain("视图");
    expect(lines).toContain("关系");
    expect(lines).toContain("Hook");
    expect(lines).toContain("排序");
  });
});

describe("TUI fragmented input and standalone Escape", () => {
  it.each([
    ["\x1b[A", { type: "key", name: "up" }],
    ["\x1bOP", { type: "key", name: "f1" }],
    ["\x1b[<0;12;4M", { type: "mouse", kind: "down", x: 12, y: 4 }],
    ["\x1b[M ,$", { type: "mouse", kind: "down", x: 12, y: 4 }],
    ["\x1b[200~中文\x1b[200~正文\x1b[201~", { type: "paste", text: "中文\x1b[200~正文" }],
  ] as const)("retains every split of %j without treating it as Escape", (sequence, expected) => {
    for (let split = 1; split < sequence.length; split++) {
      const decoder = new InputDecoder();
      expect(decoder.push(sequence.slice(0, split))).toEqual([]);
      expect(decoder.push(sequence.slice(split))).toEqual([expect.objectContaining(expected)]);
    }
  });

  it("expires only a standalone Escape, never paste content or an incomplete sequence", () => {
    const decoder = new InputDecoder();
    expect(decoder.push("\x1b")).toEqual([]);
    expect(decoder.flushEscape()).toEqual([expect.objectContaining({ type: "key", name: "escape" })]);
    expect(decoder.flushEscape()).toEqual([]);
    decoder.push("\x1b[");
    expect(decoder.flushEscape()).toEqual([]);
    expect(decoder.push("B")).toEqual([expect.objectContaining({ name: "down" })]);
    decoder.push("\x1b[200~\x1b");
    expect(decoder.flushEscape()).toEqual([]);
    expect(decoder.push("[201~")).toEqual([{ type: "paste", text: "" }]);
  });

  it("dismisses with one Escape, cancels the timeout for a continued sequence and on disposal", () => {
    vi.useFakeTimers();
    const tui = new BabelTui({ headless: true });
    try {
      tui.feed("?");
      tui.feed("\x1b");
      expect(tui.inspect().overlay).toBe("help");
      vi.advanceTimersByTime(150);
      expect(tui.inspect().overlay).toBe("none");
      tui.feed("?");
      tui.feed("\x1b");
      vi.advanceTimersByTime(20);
      tui.feed("[B");
      vi.advanceTimersByTime(150);
      expect(tui.inspect().overlay).toBe("help");
      tui.feed("\x1b");
      tui.dispose();
      vi.advanceTimersByTime(150);
      expect(tui.inspect().overlay).toBe("help");
    } finally {
      tui.dispose();
      vi.useRealTimers();
    }
  });
});
