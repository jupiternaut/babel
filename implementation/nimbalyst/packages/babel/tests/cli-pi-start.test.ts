// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCli } from "../src/cli/run.ts";
import { CliHttp } from "../src/cli/http.ts";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const target = { workdir: "/explicit/project", provider: "explicit-provider", model: "explicit-model" };
function input(value: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "babel-pi-cli-test-")); directories.push(dir);
  const file = path.join(dir, "start.json"); writeFileSync(file, JSON.stringify(value)); return file;
}
function transport(mode: "demo" | "local") {
  vi.spyOn(CliHttp.prototype, "query").mockResolvedValue({ mode, executionTarget: target });
  return vi.spyOn(CliHttp.prototype, "command").mockResolvedValue({ ok: true, mode: "demo", commandStatus: "accepted", settled: false,
    revision: 2, projectId: "project", trackerId: "task", runId: "run", correlationId: "test", result: {} });
}
const args = ["run", "start", "--project", "project", "--task", "task"];
describe("CLI explicit local Pi start", () => {
  it.each([
    { flags: [] },
    { flags: ["--expected-revision", "2"] },
    { flags: ["--expected-revision", "2", "--idempotency-key", "one-intent"] },
  ])("never copies the server target into an unconfirmed start: $flags", async ({ flags }) => {
    const send = transport("local");
    const result = await executeCli([...args, ...flags]);
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "USAGE", mode: "local" });
    expect(send).not.toHaveBeenCalled();
  });

  it("passes only the caller-confirmed target with its frozen revision and key", async () => {
    const send = transport("local");
    const result = await executeCli([...args, "--expected-revision", "2", "--idempotency-key", "one-intent", "--input", input({ executionTarget: target })]);
    expect(result.exitCode).toBe(0);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      name: "run.start", projectId: "project", input: { trackerId: "task", executionTarget: target },
      expectedRevision: 2, idempotencyKey: "one-intent",
    });
    expect(JSON.parse(result.stdout).settled).toBe(false);
  });

  it("rejects incomplete local target fields and retains demo start compatibility", async () => {
    const send = transport("local");
    const rejected = await executeCli([...args, "--expected-revision", "2", "--idempotency-key", "one-intent", "--input", input({ executionTarget: { workdir: target.workdir } })]);
    expect(rejected.exitCode).not.toBe(0);
    expect(send).not.toHaveBeenCalled();
    vi.mocked(CliHttp.prototype.query).mockResolvedValue({ mode: "demo" });
    expect((await executeCli(args)).exitCode).toBe(0);
    expect(send.mock.calls[0]![0].input).toEqual({ trackerId: "task" });
  });
});
