import { describe, expect, it } from "vitest";
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
