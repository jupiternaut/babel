// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  request: vi.fn(),
  connect: vi.fn(),
  elevate: vi.fn(),
  fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));
vi.mock("../../utils/ipcRegistry", () => ({
  safeHandle: (name: string, handler: (...args: any[]) => any) =>
    mocks.handlers.set(name, handler),
}));
vi.mock("../../services/SystemConsoleBridge", () => ({
  SystemConsoleBridge: class {
    request = mocks.request;
    connect = mocks.connect;
    elevate = mocks.elevate;
  },
}));
import { registerSystemConsoleHandlers } from "../SystemConsoleHandlers";

function event(id: number, url = "http://localhost:5273/") {
  const mainFrame = { url };
  return { senderFrame: mainFrame, sender: { id, mainFrame, once: vi.fn() } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5273");
  mocks.fromWebContents.mockReturnValue({});
  registerSystemConsoleHandlers();
});
afterEach(() => vi.unstubAllEnvs());

describe("console IPC ownership", () => {
  it.each([
    "data:/D:/Nimbalyst/out/renderer/index.html",
    "file://foreign-host/D:/Nimbalyst/out/renderer/index.html",
  ])("rejects opaque-origin page impersonation: %s", async (url) => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "file:///D:/Nimbalyst/out/renderer/index.html");
    mocks.connect.mockResolvedValue({ ok: true, result: {} });
    const reply = await mocks.handlers.get("system-console:connect")!(event(1, url));
    expect(reply.ok).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("accepts the configured local renderer with window-specific query and fragment", async () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "file:///D:/Nimbalyst/out/renderer/index.html");
    mocks.connect.mockResolvedValue({ ok: true, result: {} });
    const reply = await mocks.handlers.get("system-console:connect")!(event(1, "file:///D:/Nimbalyst/out/renderer/index.html?theme=dark#workspace"));
    expect(reply.ok).toBe(true);
    expect(mocks.connect).toHaveBeenCalledOnce();
  });
  it("rejects foreign pages and subframes before any privileged bridge call", async () => {
    for (const url of [
      "https://example.com/",
      "http://localhost:8888/",
      "http://localhost:5273/foreign.html",
    ]) {
      expect(
        (await mocks.handlers.get("system-console:connect")!(event(1, url))).ok
      ).toBe(false);
    }
    const frame = event(1);
    frame.senderFrame = { url: frame.senderFrame.url };
    expect(
      (await mocks.handlers.get("system-console:connect")!(frame)).ok
    ).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("scopes cancellation to the originating renderer and preserves the first duplicate request", async () => {
    let captured: AbortSignal | undefined;
    mocks.request.mockImplementation((_kind, _payload, signal) => {
      captured = signal;
      return new Promise((resolve) =>
        signal.addEventListener("abort", () =>
          resolve({ ok: false, error: { code: "CANCELLED" } })
        )
      );
    });
    const sender = event(1);
    const pending = mocks.handlers.get("system-console:query")!(
      sender,
      "read",
      { name: "resources" }
    );
    expect(
      (
        await mocks.handlers.get("system-console:query")!(sender, "read", {
          name: "resources",
        })
      ).ok
    ).toBe(false);
    mocks.handlers.get("system-console:cancel")!(event(2), "read");
    expect(captured?.aborted).toBe(false);
    mocks.handlers.get("system-console:cancel")!(sender, "read");
    expect(captured?.aborted).toBe(true);
    await pending;
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
