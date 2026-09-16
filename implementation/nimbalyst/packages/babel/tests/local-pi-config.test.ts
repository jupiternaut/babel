import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadLocalPiConfig } from "../src/server/local-config.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("requires explicit model and dedicated profile without default account discovery", () => {
  const profile = realpathSync(mkdtempSync(path.join(tmpdir(), "babel-local-config-")));
  dirs.push(profile);
  const file = path.join(profile, "config.json");
  const config = { projectId: "p", name: "P", workdir: profile, executable: process.execPath, agentDir: path.join(profile, "pi-agent"), provider: "protocol", model: "no-model" };
  writeFileSync(file, JSON.stringify(config));
  expect(loadLocalPiConfig(file, profile)).toMatchObject({ project: { id: "p", workdir: profile }, provider: "protocol", model: "no-model" });
  writeFileSync(file, JSON.stringify({ ...config, model: "" }));
  expect(() => loadLocalPiConfig(file, profile)).toThrow("model");
  writeFileSync(file, JSON.stringify({ ...config, agentDir: profile }));
  expect(() => loadLocalPiConfig(file, profile)).toThrow("独立");
});

it("rejects symlinking the dedicated auth directory to another profile", () => {
  const profile = realpathSync(mkdtempSync(path.join(tmpdir(), "babel-local-link-")));
  dirs.push(profile);
  const other = path.join(profile, "other"); mkdirSync(other);
  symlinkSync(other, path.join(profile, "pi-agent"));
  const file = path.join(profile, "config.json");
  writeFileSync(file, JSON.stringify({ projectId: "p", name: "P", workdir: profile, executable: process.execPath, agentDir: path.join(profile, "pi-agent"), provider: "protocol", model: "no-model" }));
  expect(() => loadLocalPiConfig(file, profile)).toThrow("不能复用或链接");
});
