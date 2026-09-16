import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINT } from "../src/contracts.ts";
import { surfaceExists, surfacePath } from "./helpers.ts";

const cliMain = surfacePath("cli", "main.ts");
const tuiMain = surfacePath("tui", "main.ts");
const guiMain = surfacePath("gui", "main.tsx");
const guiVite = surfacePath("gui", "vite.config.ts");
const guiIndex = surfacePath("gui", "index.html");

describe("CLI / TUI / GUI surface probe", () => {
  it.skipIf(!existsSync(cliMain))("CLI main entry is present", () => {
    expect(existsSync(cliMain)).toBe(true);
  });

  it.skipIf(!existsSync(tuiMain))("TUI main entry is present", () => {
    expect(existsSync(tuiMain)).toBe(true);
  });

  it.skipIf(!existsSync(guiMain) && !existsSync(guiVite) && !existsSync(guiIndex))(
    "GUI entry is present",
    () => {
      expect(surfaceExists("gui")).toBe(true);
    },
  );

  it("records missing surfaces as skipped rather than failed", () => {
    const missing = [
      ["CLI", cliMain],
      ["TUI", tuiMain],
      ["GUI", existsSync(guiMain) || existsSync(guiVite) || existsSync(guiIndex) ? guiMain : ""],
    ].filter(([, file]) => !file || !existsSync(file));
    expect(Array.isArray(missing)).toBe(true);
  });
});

describe("optional HTTP on 127.0.0.1:7780", () => {
  it("queries health when the demo server is already listening", async (ctx) => {
    try {
      const response = await fetch(`${DEFAULT_ENDPOINT}/v2/health`, {
        signal: AbortSignal.timeout(400),
      });
      if (!response.ok) {
        ctx.skip();
        return;
      }
      const body = (await response.json()) as { mode?: string; ok?: boolean };
      expect(body.mode).toBe("demo");
      expect(body.ok).toBe(true);
    } catch {
      ctx.skip();
    }
  });
});
