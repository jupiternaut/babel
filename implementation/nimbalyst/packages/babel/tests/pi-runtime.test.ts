// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalPiRuntime, type PiObservation } from "../src/pi/runtime.ts";

const roots: string[] = [], runtimes: LocalPiRuntime[] = [];
const unconfirmedShutdown = new Set<LocalPiRuntime>();
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async runtime => {
    try { await runtime.dispose(); } catch (error) { if (!unconfirmedShutdown.delete(runtime)) throw error; }
  }));
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(model = "no-model-execution") {
  const root = mkdtempSync(path.join(tmpdir(), "babel-pi-runtime-test-")); roots.push(root);
  const workdir = path.join(root, "work"), agentDir = path.join(root, "agent"), sessionDir = path.join(root, "sessions");
  mkdirSync(workdir); mkdirSync(agentDir);
  const runtime = new LocalPiRuntime({ executable: fileURLToPath(new URL("./fixtures/pi-runtime-double.mjs", import.meta.url)),
    agentDir, sessionDir, provider: "protocol-double", model });
  runtimes.push(runtime);
  const events: PiObservation[] = [];
  return { runtime, events, root, workdir, agentDir, sessionDir,
    start: (prompt: string, runId = "run-1") => runtime.start({ runId, prompt, workdir }, event => events.push(event)),
    commands: () => readFileSync(path.join(workdir, "fixture-commands.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)),
    fixture: () => JSON.parse(readFileSync(path.join(workdir, "fixture-start.json"), "utf8")) };
}

describe.skipIf(process.platform === "win32")("LocalPiRuntime (protocol subprocess double, no model calls)", () => {
  it("isolates credentials, binds an explicit session, streams stable messages/tools and waits for settled state", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture-secret"); vi.stubEnv("NODE_OPTIONS", "--throw-deprecation");
    const s = setup(); await s.start("stream");
    await vi.waitFor(() => expect(s.events).toContainEqual({ type: "idle" }));
    expect(s.events[0]).toMatchObject({ type: "session", sessionId: "protocol-double-session" });
    const fixture = s.fixture();
    expect(fixture.env.ANTHROPIC_API_KEY).toBeUndefined(); expect(fixture.env.NODE_OPTIONS).toBeUndefined();
    expect(fixture.env.PI_CODING_AGENT_DIR).toBe(realpathSync(s.agentDir));
    expect(fixture.env.PI_OFFLINE).toBe("1");
    expect(fixture.env.HOME).toContain(realpathSync(s.sessionDir));
    expect(fixture.argv).toEqual(expect.arrayContaining(["--no-extensions", "--no-skills", "--no-prompt-templates", "--offline"]));
    expect(s.commands().map(c => c.type)).toEqual(["get_state", "set_auto_retry", "prompt", "get_state"]);
    expect(s.commands()[1].enabled).toBe(false);
    const messages = s.events.filter((e): e is Extract<PiObservation, { type: "message" }> => e.type === "message" && e.role === "agent");
    expect(new Set(messages.map(e => e.id)).size).toBe(1);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "你好", replace: false }),
      expect.objectContaining({ text: " Pi", replace: false }),
      expect.objectContaining({ text: "你好 Pi 完整", replace: true }),
    ]));
    expect(s.events).toContainEqual(expect.objectContaining({ type: "tool.started", toolCallId: "call-1", name: "bash" }));
    expect(s.events).toContainEqual(expect.objectContaining({ type: "tool.finished", toolCallId: "call-1", isError: false }));
    expect(s.events.filter((e): e is Extract<PiObservation, { type: "message" }> => e.type === "message" && e.role === "tool").map(e => e.text)).toEqual(["partial", "complete"]);
    expect(s.runtime.isActive("run-1")).toBe(true);
    await s.runtime.message("run-1", "busy");
    await s.runtime.message("run-1", "finish");
    await vi.waitFor(() => expect(s.events.filter(e => e.type === "idle")).toHaveLength(2));
    expect(s.commands().filter(c => c.message).map(c => c.type)).toEqual(["prompt", "prompt", "steer"]);
    await expect(s.start("stream")).rejects.toThrow(/already/);
    await s.runtime.cancel("run-1");
    expect(s.events.at(-1)).toEqual({ type: "stopped" });
    expect(() => process.kill(fixture.pid, 0)).toThrow();
    expect(s.runtime.isActive("run-1")).toBe(false);
  });

  it("never treats acknowledgement or low-level agent_end as completion, and never idles after errors", async () => {
    const busy = setup(); await busy.start("end-without-settled");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(busy.events.some(e => e.type === "idle")).toBe(false);
    const failure = setup(); await failure.start("error");
    await vi.waitFor(() => expect(failure.events).toContainEqual({ type: "failed", message: "provider fixture error" }));
    expect(failure.events.some(e => e.type === "idle")).toBe(false);
    const rejected = setup(); await expect(rejected.start("reject")).rejects.toMatchObject({ code: "REJECTED" });
    expect(rejected.events).toContainEqual({ type: "failed", message: "fixture rejected" });
  });

  it("reports lost on disconnect without respawning or retrying and retains cancellation ownership", async () => {
    const s = setup(); await s.start("disconnect");
    await vi.waitFor(() => expect(s.events.some(e => e.type === "lost")).toBe(true));
    await expect(s.runtime.message("run-1", "never replay")).rejects.toThrow();
    expect(s.commands().filter(c => c.type === "prompt")).toHaveLength(1);
    expect(s.events.some(e => e.type === "stopped" || e.type === "idle")).toBe(false);
    unconfirmedShutdown.add(s.runtime);
    await expect(s.runtime.cancel("run-1")).rejects.toThrow(/tool shutdown is unconfirmed/);
    expect(s.events.some(e => e.type === "stopped")).toBe(false);
    expect(() => process.kill(-s.fixture().pid, 0)).toThrow();
  });

  it("rejects retry overrides and unsafe run identifiers before launching a subprocess", async () => {
    const s = setup();
    await expect(s.start("never sent", "../escape")).rejects.toThrow(/safe identifier/);
    mkdirSync(path.join(s.workdir, ".pi"));
    writeFileSync(path.join(s.workdir, ".pi", "settings.json"), JSON.stringify({ retry: { enabled: true } }));
    await expect(s.start("never sent")).rejects.toThrow(/automatic retry/);
    expect(() => s.fixture()).toThrow();
    expect(s.runtime.isActive("run-1")).toBe(false);
  });

  it("rejects a mismatched handshake before any prompt and never replays a timed-out prompt", async () => {
    const invalid = setup("invalid-state");
    await expect(invalid.start("never sent")).rejects.toMatchObject({ code: "PROTOCOL" });
    expect(invalid.commands().map(c => c.type)).toEqual(["get_state"]);
    expect(invalid.events.some(e => e.type === "session")).toBe(false);
    const timeout = setup();
    await expect(timeout.start("timeout")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(timeout.commands().filter(c => c.type === "prompt")).toHaveLength(1);
    expect(timeout.events.filter(e => e.type === "lost")).toHaveLength(1);
    expect(timeout.events.some(e => e.type === "idle" || e.type === "stopped")).toBe(false);
  }, 20000);

  it("confirms the owned group is gone even when abort is acknowledged and descendants ignore termination", async () => {
    const s = setup(); await s.start("descendant");
    let descendant = 0;
    await vi.waitFor(() => { descendant = JSON.parse(readFileSync(path.join(s.workdir, "fixture-descendant.json"), "utf8")).pid; expect(descendant).toBeGreaterThan(0); });
    const pid = s.fixture().pid;
    await s.runtime.cancel("run-1");
    expect(() => process.kill(-pid, 0)).toThrow();
    expect(() => process.kill(descendant, 0)).toThrow();
    expect(s.events.at(-1)).toEqual({ type: "stopped" });
  });
});
