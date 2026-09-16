import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProfileDir, loadOrCreateServiceToken } from "../src/server/auth.ts";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("fresh profile startup", () => {
  it("creates missing profile directories before writing service.token", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "babel-profile-parent-"));
    temps.push(parent);
    const profileDir = path.join(parent, "brand-new-profile");
    expect(existsSync(profileDir)).toBe(false);
    const token = loadOrCreateServiceToken(profileDir);
    expect(token.length).toBeGreaterThan(10);
    expect(existsSync(path.join(profileDir, "service.token"))).toBe(true);
    expect(existsSync(path.join(profileDir, "state"))).toBe(true);
    expect(existsSync(path.join(profileDir, "workspaces", "babel"))).toBe(true);
    expect(readFileSync(path.join(profileDir, "service.token"), "utf8").trim()).toBe(token);
  });

  it("ensureProfileDir is idempotent", () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), "babel-profile-ensure-"));
    temps.push(profileDir);
    expect(ensureProfileDir(profileDir)).toBe(profileDir);
    expect(ensureProfileDir(profileDir)).toBe(profileDir);
    expect(existsSync(path.join(profileDir, "hooks"))).toBe(true);
  });
});
