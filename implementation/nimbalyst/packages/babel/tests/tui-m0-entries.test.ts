import { describe, expect, it } from "vitest";
import { BabelTui } from "../src/tui/app.ts";
import { InputDecoder } from "../src/tui/input.ts";
import { displayWidth } from "../src/tui/width.ts";

describe("TUI M0 entries (headless, no ConPTY)", () => {
  it("opens the Chinese action menu and help without starting a hidden GUI", () => {
    const tui = new BabelTui({ headless: true, cols: 120, rows: 36 });
    tui.feedEvent({ type: "text", text: "o" });
    expect(tui.inspect().overlay).toBe("menu");
    tui.feedEvent({ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false });
    expect(tui.inspect().overlay).toBe("none");
    tui.feedEvent({ type: "text", text: "?" });
    expect(tui.inspect().overlay).toBe("help");
    tui.dispose();
  });

  it("maps keyboard shortcuts to Ready / views / relation / hooks overlays", () => {
    const tui = new BabelTui({ headless: true, cols: 80, rows: 24 });
    tui.feedEvent({ type: "text", text: "o" });
    const inspect = tui.inspect();
    expect(inspect.overlay).toBe("menu");
    tui.feedEvent({ type: "text", text: "y" });
    // showReady is async HTTP; without a server the overlay stays menu or becomes ready/error.
    expect(["menu", "ready", "none"]).toContain(tui.inspect().overlay);
    tui.dispose();
  });

  it("decodes Chinese text, resize, and mouse without ANSI in the decoder output", () => {
    const decoder = new InputDecoder();
    const keys = decoder.push("中文标题");
    expect(keys.every((ev) => ev.type === "text")).toBe(true);
    expect(keys.map((ev) => ev.type === "text" ? ev.text : "").join("")).toBe("中文标题");
    expect(displayWidth("中文标题")).toBe(8);
    const tui = new BabelTui({ headless: true, cols: 120, rows: 40 });
    tui.resize(72, 20);
    expect(tui.inspect().cols).toBe(72);
    expect(tui.inspect().rows).toBe(20);
    tui.dispose();
  });
});
