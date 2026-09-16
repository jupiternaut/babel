import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PiRpcClient, PiRpcError } from "./rpc-client.ts";

/** Starts a new, empty Pi process for a read-only protocol check. Never attaches to
 * user sessions, inherits credentials, or sends prompts/tools. Not a run launcher.
 */
export async function probePi(executable: string, timeoutMs = 15000) {
  if (!path.isAbsolute(executable) || !statSync(executable).isFile()) {
    throw new Error("Pi executable must be an absolute file path");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error("Pi probe timeout must be between 1 and 60000 ms");
  }
  const resolvedExecutable = realpathSync(executable);
  const root = mkdtempSync(path.join(tmpdir(), "babel-pi-probe-"));
  const home = path.join(root, "home"), cwd = path.join(root, "workspace");
  mkdirSync(home);
  mkdirSync(cwd);
  const env: NodeJS.ProcessEnv = {
    HOME: home, USERPROFILE: home,
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    PI_CODING_AGENT_DIR: path.join(root, "agent"),
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"),
    APPDATA: path.join(root, "appdata"), LOCALAPPDATA: path.join(root, "localappdata"),
    TMPDIR: root, TMP: root, TEMP: root,
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  };
  if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const child = spawn(executable, [
    "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "--offline",
  ], { cwd, env, stdio: "pipe", windowsHide: true, shell: false });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let hasClosed = false;
  void closed.then(() => { hasClosed = true; });
  let stderrBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
  const eventTypes: string[] = [];
  const client = new PiRpcClient({
    input: child.stdin, output: child.stdout, timeoutMs,
    onEvent: (event) => { if (eventTypes.length < 100) eventTypes.push(String(event.type)); },
  });
  child.on("error", (error) => client.disconnect(new PiRpcError("DISCONNECTED", error.message)));
  // These streams are owned here, including late shutdown errors after detaching RPC.
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  try {
    const stateResponse = await client.request({ type: "get_state" });
    const messagesResponse = await client.request({ type: "get_messages" });
    const state = asRecord(stateResponse.data);
    const messages = asRecord(messagesResponse.data);
    if (!state || typeof state.sessionId !== "string" || !state.sessionId
      || state.isStreaming !== false || state.messageCount !== 0
      || !messages || !Array.isArray(messages.messages) || messages.messages.length !== 0) {
      throw new PiRpcError("PROTOCOL", "Pi probe did not return an empty, idle session");
    }
    return {
      ok: true, mode: "pi-rpc-probe", protocolConnected: true,
      modelExecutionVerified: false, taskIntegrationVerified: false,
      executable: resolvedExecutable, pid: child.pid, sessionId: state.sessionId,
      isStreaming: state.isStreaming, messageCount: state.messageCount,
      requests: ["get_state", "get_messages"], eventTypes, stderrBytes,
      credentials: "isolated-empty-profile", shutdownConfirmed: true,
    };
  } finally {
    client.disconnect();
    await stopProbe(child, closed, () => hasClosed);
    rmSync(root, { recursive: true, force: true });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

async function waitClosed(closed: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function stopProbe(child: ChildProcessWithoutNullStreams, closed: Promise<void>, hasClosed: () => boolean) {
  if (hasClosed()) return;
  child.stdin.end();
  if (await waitClosed(closed, 1000)) return;
  child.kill("SIGTERM");
  if (await waitClosed(closed, 1000)) return;
  child.kill("SIGKILL");
  if (!await waitClosed(closed, 2000)) {
    throw new Error(`Pi probe process ${child.pid} shutdown not confirmed; temporary profile retained`);
  }
}
