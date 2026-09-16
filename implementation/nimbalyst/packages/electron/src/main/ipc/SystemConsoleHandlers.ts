import { app, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { safeHandle } from "../utils/ipcRegistry";
import {
  SystemConsoleBridge,
  type SystemReply,
} from "../services/SystemConsoleBridge";
import { systemConsoleElevationCommand } from "../services/systemConsoleElevation";

export function registerSystemConsoleHandlers(): void {
  // bootstrap's dynamic import places main handlers in out/main/chunks in production.
  const mainDirectory =
    basename(__dirname) === "chunks" ? dirname(__dirname) : __dirname;
  const serverDirectory = app.isPackaged
    ? mainDirectory.replace(/app\.asar([\\/])/, "app.asar.unpacked$1")
    : mainDirectory;
  const profile =
    process.env.BABEL_SYSTEM_PROFILE ||
    (process.platform === "win32"
      ? "D:\\BabelData\\system"
      : join(homedir(), ".local/state/babel-system"));
  const bridge = new SystemConsoleBridge({
    token: () => readFile(join(profile, "service.token"), "utf8"),
    request: fetch,
    elevate:
      process.platform === "win32"
        ? async () => {
            const script = systemConsoleElevationCommand(
              process.execPath,
              join(serverDirectory, "systemServer.js"),
              profile,
              join(serverDirectory, "platform-windows.ps1")
            );
            await new Promise<void>((resolve, reject) => {
              const child = spawn(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-NonInteractive",
                  "-EncodedCommand",
                  Buffer.from(script, "utf16le").toString("base64"),
                ],
                { windowsHide: true, stdio: "ignore" }
              );
              child.once("error", reject);
              child.once("exit", (code) =>
                code === 0
                  ? resolve()
                  : reject(
                      new Error(
                        "Administrator request cancelled or failed. Retry to reconnect normally."
                      )
                    )
              );
            });
          }
        : undefined,
    launch: async () => {
      await mkdir(profile, { recursive: true });
      const log = openSync(join(profile, "server.log"), "a");
      try {
        // A separate bundled entry runs independently of workspace windows, including in packaged apps.
        const child = spawn(
          process.execPath,
          [join(serverDirectory, "systemServer.js")],
          {
            detached: true,
            windowsHide: true,
            stdio: ["ignore", log, log],
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              BABEL_SYSTEM_PROFILE: profile,
              BABEL_SYSTEM_PORT: "7782",
              BABEL_SYSTEM_WINDOWS_SCRIPT: join(
                serverDirectory,
                "platform-windows.ps1"
              ),
            },
          }
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } finally {
        closeSync(log);
      }
    },
  });
  const requests = new Map<string, AbortController>();
  const attached = new Set<number>();
  const authorize = (event: IpcMainInvokeEvent) => {
    if (
      !BrowserWindow.fromWebContents(event.sender) ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Untrusted console sender");
    const frameUrl = new URL(event.senderFrame.url);
    const devUrl = !app.isPackaged
      ? process.env.ELECTRON_RENDERER_URL ||
        (process.env.NODE_ENV === "development"
          ? `http://localhost:${process.env.VITE_PORT || "5273"}`
          : undefined)
      : undefined;
    const rendererUrl = new URL(
      devUrl ||
        pathToFileURL(join(mainDirectory, "../renderer/index.html")).href
    );
    if (
      frameUrl.origin !== rendererUrl.origin ||
      frameUrl.protocol !== rendererUrl.protocol ||
      frameUrl.host !== rendererUrl.host ||
      frameUrl.pathname !== rendererUrl.pathname
    )
      throw new Error("Untrusted console page");
    if (!attached.has(event.sender.id)) {
      attached.add(event.sender.id);
      event.sender.once("destroyed", () => {
        for (const [key, controller] of requests)
          if (key.startsWith(`${event.sender.id}:`)) {
            controller.abort();
            requests.delete(key);
          }
        attached.delete(event.sender.id);
      });
    }
  };
  const failure = (error: unknown): SystemReply => ({
    ok: false,
    error: {
      code: "CONSOLE_CONNECTION",
      message:
        error instanceof Error ? error.message : "System service unavailable",
    },
  });
  safeHandle("system-console:connect", async (event) => {
    try {
      authorize(event);
      return await bridge.connect();
    } catch (error) {
      return failure(error);
    }
  });
  let elevating = false;
  safeHandle("system-console:elevate", async (event) => {
    let owned = false;
    try {
      authorize(event);
      if (elevating) throw new Error("Administrator request already pending");
      elevating = true;
      owned = true;
      return await bridge.elevate();
    } catch (error) {
      return failure(error);
    } finally {
      if (owned) elevating = false;
    }
  });
  for (const kind of ["query", "command"] as const)
    safeHandle(
      `system-console:${kind}`,
      async (event, id: unknown, payload: unknown) => {
        let key: string | undefined;
        let registered = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          authorize(event);
          if (typeof id !== "string" || !/^[\w.-]{1,128}$/.test(id))
            throw new Error("Invalid request identifier");
          key = `${event.sender.id}:${id}`;
          if (requests.has(key)) throw new Error("Duplicate active request");
          const controller = new AbortController();
          requests.set(key, controller);
          registered = true;
          timer = setTimeout(
            () => controller.abort(),
            kind === "command" ? 120000 : 30000
          );
          return await bridge.request(kind, payload, controller.signal);
        } catch (error) {
          return failure(error);
        } finally {
          if (timer) clearTimeout(timer);
          if (key && registered) requests.delete(key);
        }
      }
    );
  safeHandle("system-console:cancel", (event, id: string) => {
    authorize(event);
    requests.get(`${event.sender.id}:${id}`)?.abort();
  });
}
