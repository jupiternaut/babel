import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { PiRpcClient, PiRpcError } from "./rpc-client.ts";

export type PiObservation =
  | { type: "session"; sessionId: string; sessionFile: string }
  // Stable id per message; replace:true is an authoritative full snapshot,
  // replace:false (or absent) appends text. Tool partial results are snapshots.
  | { type: "message"; id: string; role: "agent" | "system" | "tool"; text: string; replace?: boolean }
  | { type: "tool.started" | "tool.finished"; toolCallId: string; name: string; details?: unknown; isError?: boolean }
  | { type: "idle" }
  | { type: "failed" | "lost"; message: string }
  | { type: "stopped" };

export interface LocalPiRuntimeOptions {
  executable: string;
  /** Explicit, dedicated Babel Pi profile. Pi persists disabled retry here. */
  agentDir: string;
  provider: string;
  model: string;
  sessionDir: string;
}

interface RunningPi {
  child: ChildProcessWithoutNullStreams;
  client: PiRpcClient;
  observe: (event: PiObservation) => void;
  hasClosed: boolean;
  groupGone: boolean;
  stopping?: Promise<void>;
  stoppingRequested: boolean;
  stopped: boolean;
  failed: boolean;
  lost: boolean;
  busy: boolean;
  promptSent: boolean;
  activity: number;
  messageSequence: number;
  messageId?: string;
  sessionFile: string;
}

/** Owns only processes this instance starts. No implicit reconnect, replay or
 * resurrection from session files. Pi owns model calls, tools and their policy.
 * Idle means settled for review/follow-up, never accepted/completed by Babel.
 */
export class LocalPiRuntime {
  private readonly runs = new Map<string, RunningPi>();
  private disposed = false;

  constructor(private readonly options: LocalPiRuntimeOptions) {
    if (process.platform === "win32") throw new Error("Local Pi process-group control requires the pending Windows adapter");
    for (const [name, value] of Object.entries(options)) {
      if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error(`Pi ${name} must be explicit and non-empty`);
    }
    for (const key of ["executable", "agentDir", "sessionDir"] as const) {
      if (!path.isAbsolute(options[key])) throw new Error(`Pi ${key} must be an absolute path`);
    }
    if (!statSync(options.executable).isFile()) throw new Error("Pi executable must be a file");
    if (!statSync(options.agentDir).isDirectory()) throw new Error("Pi agentDir must be an explicitly configured directory");
    const defaultAgentDir = path.join(homedir(), ".pi", "agent");
    if (existsSync(defaultAgentDir) && realpathSync(options.agentDir) === realpathSync(defaultAgentDir)) {
      throw new Error("Pi requires a dedicated Babel agentDir; the default user Pi profile is not allowed");
    }
  }

  async start(input: { runId: string; workdir: string; prompt: string }, observe: (event: PiObservation) => void): Promise<void> {
    if (this.disposed) throw new Error("Pi runtime is disposed");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.runId)) throw new Error("Pi runId must be a safe identifier");
    if (this.runs.has(input.runId)) throw new Error("Pi run already exists; it will not be replayed");
    if (!input.prompt.trim()) throw new Error("Pi prompt must not be empty");
    if (!path.isAbsolute(input.workdir) || !statSync(input.workdir).isDirectory()) throw new Error("Pi workdir must be an absolute directory");
    const workdir = realpathSync(input.workdir);
    const projectSettings = path.join(workdir, ".pi", "settings.json");
    if (existsSync(projectSettings)) {
      const settings = record(JSON.parse(readFileSync(projectSettings, "utf8")));
      if (record(settings?.retry)?.enabled === true) {
        throw new Error("Pi project settings enable automatic retry; disable that override before starting a Babel run");
      }
    }
    mkdirSync(this.options.sessionDir, { recursive: true, mode: 0o700 });
    const sessionDir = realpathSync(this.options.sessionDir);
    const sessionFile = path.join(sessionDir, `${input.runId}.jsonl`);
    if (existsSync(sessionFile)) throw new Error("Pi session already exists; automatic resume is disabled");
    // Exclusive directory prevents two instances racing before Pi saves a record.
    const home = path.join(sessionDir, `${input.runId}.home`);
    mkdirSync(home, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = {
      HOME: home, USERPROFILE: home,
      PATH: [path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
      PI_CODING_AGENT_DIR: realpathSync(this.options.agentDir),
      XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"),
      TMPDIR: home, TMP: home, TEMP: home,
      PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
    };
    const child = spawn(this.options.executable, [
      "--mode", "rpc", "--provider", this.options.provider, "--model", this.options.model,
      "--session", sessionFile, "--session-dir", sessionDir,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--offline",
    ], { cwd: workdir, env, detached: true, stdio: "pipe", shell: false });
    // Drain stderr without interpreting it as a session event or execution proof.
    child.stderr.on("data", () => {});
    child.stderr.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    const run: RunningPi = {
      child, observe, hasClosed: false, groupGone: false, stoppingRequested: false,
      stopped: false, failed: false, lost: false, busy: false, promptSent: false, activity: 0, messageSequence: 0, sessionFile,
      client: new PiRpcClient({ input: child.stdin, output: child.stdout,
        onEvent: event => this.onEvent(input.runId, event),
        onDisconnect: error => this.failure(input.runId, error),
      }),
    };
    this.runs.set(input.runId, run);
    child.on("error", error => run.client.disconnect(new PiRpcError("DISCONNECTED", error.message)));
    child.once("close", () => {
      run.hasClosed = true;
      this.groupExists(run);
      if (!run.stoppingRequested) this.failure(input.runId, new PiRpcError("DISCONNECTED", "Pi process closed; session must be reconciled explicitly"));
    });
    try {
      const response = await run.client.request({ type: "get_state" });
      const state = record(response.data), model = record(state?.model);
      if (!state || typeof state.sessionId !== "string" || !state.sessionId
        || state.sessionFile !== sessionFile || state.isStreaming !== false
        || state.isCompacting !== false || state.pendingMessageCount !== 0 || state.messageCount !== 0
        || model?.provider !== this.options.provider || model?.id !== this.options.model) {
        throw new PiRpcError("PROTOCOL", "Pi did not confirm the requested empty session and provider/model");
      }
      this.assertUsable(run);
      run.observe({ type: "session", sessionId: state.sessionId, sessionFile });
      await run.client.request({ type: "set_auto_retry", enabled: false });
      this.assertUsable(run);
      run.busy = true; run.promptSent = true; run.activity++;
      await run.client.request({ type: "prompt", message: input.prompt });
    } catch (error) {
      this.failure(input.runId, error);
      throw error;
    }
  }

  async message(runId: string, text: string): Promise<void> {
    const run = this.getRun(runId);
    this.assertUsable(run);
    if (!text.trim()) throw new Error("Pi message must not be empty");
    const busy = run.busy;
    run.busy = true; run.activity++;
    try { await run.client.request({ type: busy ? "steer" : "prompt", message: text }); }
    catch (error) { this.failure(runId, error); throw error; }
  }

  isActive(runId: string): boolean {
    const run = this.runs.get(runId);
    return !!run && !run.stopped && this.groupExists(run);
  }

  async cancel(runId: string): Promise<void> {
    const run = this.getRun(runId);
    if (run.stopped) return;
    if (run.stopping) return run.stopping;
    run.stoppingRequested = true;
    run.stopping = this.stop(run).then(() => {
      run.stopped = true; run.busy = false;
      run.observe({ type: "stopped" });
    }).catch(error => {
      run.stoppingRequested = false;
      this.failure(runId, new PiRpcError("DISCONNECTED", error instanceof Error ? error.message : String(error)));
      throw error;
    }).finally(() => { run.stopping = undefined; });
    return run.stopping;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const results = await Promise.allSettled([...this.runs.keys()].map(runId => this.cancel(runId)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new Error(`Pi shutdown was not confirmed for every owned process group: ${failures.map(result => String(result.reason)).join("; ")}`);
  }

  private getRun(runId: string): RunningPi {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Pi run is not owned by this runtime");
    return run;
  }

  private assertUsable(run: RunningPi): void {
    if (this.disposed || run.stopped || run.stoppingRequested || run.hasClosed || run.failed || run.lost) {
      throw new Error("Pi session is unavailable; no automatic restart or replay was attempted");
    }
  }

  private failure(runId: string, error: unknown): void {
    const run = this.runs.get(runId);
    if (!run || run.stoppingRequested || run.stopped || run.failed || run.lost) return;
    const uncertain = error instanceof PiRpcError && error.code !== "REJECTED";
    run.lost = uncertain; run.failed = !uncertain;
    run.observe({ type: uncertain ? "lost" : "failed", message: error instanceof Error ? error.message : String(error) });
  }

  private onEvent(runId: string, event: Record<string, unknown>): void {
    const run = this.getRun(runId);
    if (run.stoppingRequested || run.stopped || run.lost || run.failed) return;
    const message = record(event.message);
    if (event.type === "agent_start") { run.busy = true; run.activity++; }
    if (event.type === "message_start" && message?.role === "assistant") {
      run.messageId = `${runId}:assistant:${++run.messageSequence}`;
    }
    if (event.type === "message_update") {
      const delta = record(event.assistantMessageEvent);
      if (delta?.type === "text_delta" && typeof delta.delta === "string") {
        run.messageId ??= `${runId}:assistant:${++run.messageSequence}`;
        run.observe({ type: "message", id: run.messageId, role: "agent", text: delta.delta, replace: false });
      }
    }
    if (event.type === "message_end" && message?.role === "assistant") {
      run.messageId ??= `${runId}:assistant:${++run.messageSequence}`;
      run.observe({ type: "message", id: run.messageId, role: "agent", text: messageText(message), replace: true });
      run.messageId = undefined;
      this.checkAssistantError(runId, message);
    }
    if (["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(String(event.type))
      && typeof event.toolCallId === "string" && typeof event.toolName === "string") {
      if (event.type === "tool_execution_start") {
        run.observe({ type: "tool.started", toolCallId: event.toolCallId, name: event.toolName, details: event.args });
      } else {
        const result = record(event.type === "tool_execution_end" ? event.result : event.partialResult);
        run.observe({ type: "message", id: `${runId}:tool:${event.toolCallId}`, role: "tool", text: messageText(result), replace: true });
        if (event.type === "tool_execution_end") run.observe({ type: "tool.finished", toolCallId: event.toolCallId,
          name: event.toolName, details: event.result, isError: event.isError === true });
      }
    }
    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      for (const item of event.messages) this.checkAssistantError(runId, record(item));
    }
    if (event.type === "error" || event.type === "extension_error") {
      this.failure(runId, new Error(typeof event.message === "string" ? event.message : String(event.error ?? "Pi execution error")));
    }
    if (event.type === "auto_retry_start" || event.type === "summarization_retry_scheduled" || event.willRetry === true) {
      this.failure(runId, new PiRpcError("PROTOCOL", "Pi reported an unexpected automatic retry; execution state requires reconciliation"));
    }
    // Low-level agent_end does not guarantee queued/compaction work has settled.
    if (event.type === "agent_settled" && !run.failed) void this.checkIdle(runId);
  }

  private checkAssistantError(runId: string, message?: Record<string, unknown>): void {
    if (message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
      this.failure(runId, new Error(typeof message.errorMessage === "string" ? message.errorMessage : `Pi assistant ${message.stopReason}`));
    }
  }

  private async checkIdle(runId: string): Promise<void> {
    const run = this.getRun(runId), activity = run.activity;
    try {
      const state = record((await run.client.request({ type: "get_state" })).data);
      if (run.failed || run.lost || run.stoppingRequested || run.stopped || activity !== run.activity) return;
      if (state?.sessionFile !== run.sessionFile || typeof state.isStreaming !== "boolean"
        || typeof state.isCompacting !== "boolean" || !Number.isSafeInteger(state.pendingMessageCount)) {
        throw new PiRpcError("PROTOCOL", "Pi returned invalid settlement state");
      }
      if (!state.isStreaming && !state.isCompacting && state.pendingMessageCount === 0 && run.busy) {
        run.busy = false; run.observe({ type: "idle" });
      }
    } catch (error) { this.failure(runId, error); }
  }

  private groupExists(run: RunningPi): boolean {
    if (run.groupGone || !run.child.pid) return false;
    try { process.kill(-run.child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") { run.groupGone = true; return false; }
      throw error;
    }
  }

  private signal(run: RunningPi, signal: NodeJS.Signals): void {
    if (!this.groupExists(run) || !run.child.pid) return;
    try { process.kill(-run.child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }

  private async stop(run: RunningPi): Promise<void> {
    // Abort acknowledgement is not proof of tool/process exit. Bound the wait,
    // then terminate only the detached group created by this runtime.
    let abortConfirmed = false;
    await bounded(run.client.request({ type: "abort" }).then(() => { abortConfirmed = true; }).catch(() => {}), 3000);
    run.client.disconnect();
    run.child.stdin.end();
    this.signal(run, "SIGTERM");
    if (!await this.waitGone(run, 1000)) {
      this.signal(run, "SIGKILL");
      if (!await this.waitGone(run, 2000)) throw new Error("Pi owned process group shutdown could not be confirmed");
    }
    // Pi's bash tool creates its own detached groups. Only its awaited abort
    // confirms tool cleanup; killing Pi's group after losing RPC cannot prove it.
    if (run.promptSent && !abortConfirmed) throw new Error("Pi process group stopped, but detached tool shutdown is unconfirmed after lost abort acknowledgement");
  }

  private async waitGone(run: RunningPi, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (!this.groupExists(run) && run.hasClosed) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    return !this.groupExists(run) && run.hasClosed;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function messageText(message?: Record<string, unknown>): string {
  return Array.isArray(message?.content)
    ? message.content.flatMap(item => { const block = record(item); return block?.type === "text" && typeof block.text === "string" ? [block.text] : []; }).join("\n")
    : typeof message?.content === "string" ? message.content : "";
}
async function bounded(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
}
