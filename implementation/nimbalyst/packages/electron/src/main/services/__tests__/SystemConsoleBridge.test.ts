// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  SystemConsoleBridge,
  validateSystemPayload,
} from "../SystemConsoleBridge";

describe("restricted system console bridge", () => {
  it("rejects arbitrary URLs, shell payloads and incomplete process identities before transport", () => {
    expect(() =>
      validateSystemPayload("query", {
        name: "resources",
        url: "https://example.com",
      })
    ).toThrow();
    expect(() =>
      validateSystemPayload("command", {
        name: "shell",
        requestId: "test",
        command: "whoami",
      })
    ).toThrow();
    expect(() =>
      validateSystemPayload("command", {
        name: "process.terminate",
        requestId: "test",
        process: { pid: 4 },
      })
    ).toThrow();
    expect(
      validateSystemPayload("command", {
        name: "process.terminate",
        requestId: "test",
        process: { pid: 44, startedAt: "2026-09-16T12:00:00Z" },
        force: false,
      })
    ).toBeDefined();
  });
  it("keeps authentication in the main process and never follows redirects", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: [] }))
      );
    const bridge = new SystemConsoleBridge({
      token: async () => "private-token",
      request,
      launch: async () => {},
    });
    expect(
      await bridge.request(
        "query",
        { name: "processes" },
        new AbortController().signal
      )
    ).toEqual({ ok: true, result: [] });
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:7782/v1/query",
      expect.objectContaining({
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer private-token",
        },
      })
    );
  });
  it("only launches on explicit connect and coalesces simultaneous opens", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: [] }))
      );
    const launch = vi.fn().mockResolvedValue(undefined);
    const bridge = new SystemConsoleBridge({
      token: async () => "secret",
      request,
      launch,
      delay: async () => {},
    });
    await Promise.all([bridge.connect(), bridge.connect()]);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it("does not elevate when the running backend refuses shutdown", async () => {
    const elevate = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "BUSY", message: "Operation active" },
          }),
          { status: 409 }
        )
      );
    const bridge = new SystemConsoleBridge({
      token: async () => "secret",
      request,
      launch: vi.fn(),
      elevate,
    });
    expect(await bridge.elevate()).toEqual({
      ok: false,
      error: { code: "BUSY", message: "Operation active" },
    });
    expect(elevate).not.toHaveBeenCalled();
  });
});
