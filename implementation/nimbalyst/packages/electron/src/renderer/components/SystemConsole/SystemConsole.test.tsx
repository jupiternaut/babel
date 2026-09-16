// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SystemConsole } from "./SystemConsole";
import { connectConsole, consoleRequest } from "./client";

vi.mock("./client", () => ({
  connectConsole: vi.fn(),
  consoleRequest: vi.fn(),
}));
const service = {
  definition: {
    id: "worker",
    label: "Worker",
    kind: "managed-process",
    target: "worker",
  },
  snapshot: {
    id: "worker",
    state: "running",
    autostart: { enabled: false, trigger: "login" },
    processes: [],
    sampledAt: "2026-09-16T12:00:00Z",
    health: "not-configured",
  },
};
const processInfo = {
  pid: 123,
  name: "worker.exe",
  startedAt: "2026-09-16T12:00:00Z",
  cpuPercent: null,
  memoryBytes: 1048576,
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.mocked(connectConsole).mockResolvedValue(undefined);
  vi.mocked(consoleRequest).mockImplementation(
    async (kind, payload): Promise<any> => {
      if (kind === "command")
        return {
          id: "op",
          status: "succeeded",
          action: payload.name,
          targetId: "worker",
          requestedAt: "2026-09-16T12:00:00Z",
        };
      switch (payload.name) {
        case "resources":
          return {
            hostname: "fixture",
            platform: "test",
            sampledAt: new Date().toISOString(),
            cpuPercent: null,
            memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50 },
            disks: [],
            uptimeSeconds: 50,
            warnings: [],
          };
        case "services":
          return { services: [service] };
        case "processes":
          return [processInfo];
        case "operations":
          return [];
        case "logs":
          return { text: "fixture log" };
        default:
          throw new Error("Unexpected request");
      }
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("system console interactions", () => {
  it("keeps run state and autostart independent and disables duplicate actions in flight", async () => {
    render(<SystemConsole isOpen onClose={() => {}} />);
    await screen.findByRole("switch", { name: "Worker 自启动" });
    expect(
      screen
        .getByRole("button", { name: "启动" })
        .hasAttribute("disabled")
    ).toBe(true);
    let finish!: (value: any) => void;
    vi.mocked(consoleRequest).mockImplementationOnce(
      () =>
        new Promise<any>((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(consoleRequest).toHaveBeenLastCalledWith(
      "command",
      expect.objectContaining({
        name: "service.autostart",
        enabled: true,
        serviceId: "worker",
      }),
      expect.any(AbortSignal)
    );
    expect(
      screen
        .getByRole("button", { name: "停止" })
        .hasAttribute("disabled")
    ).toBe(true);
    finish({ id: "op", status: "succeeded" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "停止" })
          .hasAttribute("disabled")
      ).toBe(false)
    );
  });
  it("requires process identity acknowledgement and sends the original start time", async () => {
    render(<SystemConsole isOpen onClose={() => {}} />);
    await screen.findByRole("switch");
    fireEvent.click(screen.getByRole("button", { name: "进程" }));
    fireEvent.click(screen.getByRole("button", { name: "终止" }));
    const confirmation = screen.getByRole("alertdialog");
    expect(
      within(confirmation)
        .getByRole("button", { name: "确认终止" })
        .hasAttribute("disabled")
    ).toBe(true);
    fireEvent.click(
      within(confirmation).getByLabelText("我已核对这个进程的 PID 和启动时间")
    );
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "确认终止" })
    );
    await waitFor(() =>
      expect(consoleRequest).toHaveBeenCalledWith(
        "command",
        expect.objectContaining({
          name: "process.terminate",
          process: { pid: 123, startedAt: processInfo.startedAt },
          force: false,
        }),
        expect.any(AbortSignal)
      )
    );
  });
  it("aborts outstanding detail reads when the workspace is closed", async () => {
    const view = render(<SystemConsole isOpen onClose={() => {}} />);
    await screen.findByRole("switch");
    let signal: AbortSignal | undefined;
    vi.mocked(consoleRequest).mockImplementationOnce((_kind, _payload, s) => {
      signal = s;
      return new Promise(() => {});
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Worker" })
    );
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("shows connection failure with a retry and no invented rows", async () => {
    vi.mocked(connectConsole).mockRejectedValue(
      new Error("Connection refused")
    );
    render(<SystemConsole isOpen onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Connection refused"
    );
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新 / 重试" }));
    await waitFor(() => expect(connectConsole).toHaveBeenCalledTimes(2));
  });
  it("pauses polling while hidden and fetches shared backend state on return", async () => {
    vi.useFakeTimers();
    await act(async () => {
      render(<SystemConsole isOpen onClose={() => {}} />);
    });
    const initial = vi.mocked(consoleRequest).mock.calls.length;
    expect(initial).toBe(4);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(consoleRequest).toHaveBeenCalledTimes(initial);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(consoleRequest).toHaveBeenCalledTimes(initial + 4);
  });
});
