// @vitest-environment node
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { PiRpcClient, PiRpcError } from "../src/pi/rpc-client.ts";

const clients: PiRpcClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); });

function connection(timeoutMs = 500) {
  const input = new PassThrough();
  const output = new PassThrough();
  const events: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  input.on("data", (data) => sent.push(JSON.parse(String(data))));
  const client = new PiRpcClient({ input, output, timeoutMs, onEvent: (event) => events.push(event) });
  clients.push(client);
  const reply = (index: number, data: unknown, success = true) => output.write(JSON.stringify({
    type: "response", id: sent[index].id, command: sent[index].type, success, data,
    ...(!success ? { error: "request rejected" } : {}),
  }) + "\n");
  return { client, input, output, events, sent, reply };
}

describe("Pi RPC transport (protocol doubles, not model execution)", () => {
  it("correlates out-of-order replies and preserves fragmented UTF-8 / Unicode separators", async () => {
    const c = connection();
    const state = c.client.request({ type: "get_state" });
    const messages = c.client.request({ type: "get_messages" });
    const text = "中文\u2028仍是一条\u2029消息";
    const line = Buffer.from(JSON.stringify({ type: "message_update", text }) + "\r\n");
    const split = line.indexOf(Buffer.from("中")) + 1;
    c.output.write(line.subarray(0, split));
    c.output.write(line.subarray(split));
    c.reply(1, { messages: [text] });
    c.reply(0, { sessionId: "pi-session", isStreaming: false });
    expect((await state).data).toEqual({ sessionId: "pi-session", isStreaming: false });
    expect((await messages).data).toEqual({ messages: [text] });
    expect(c.events).toEqual([{ type: "message_update", text }]);
  });

  it("keeps prompt/abort acceptance separate from agent_end and ignores late replies", async () => {
    const c = connection(25);
    const prompt = c.client.request({ type: "prompt", message: "change a file" });
    c.reply(0, undefined);
    expect((await prompt).success).toBe(true);
    expect(c.events).toEqual([]);
    const abort = c.client.request({ type: "abort" });
    c.reply(1, undefined);
    await abort;
    expect(c.events).toEqual([]);
    c.output.write('{"type":"agent_end","messages":[]}\n');
    expect(c.events.map((event) => event.type)).toEqual(["agent_end"]);
    await expect(c.client.request({ type: "prompt", message: "timeout is ambiguous" })).rejects.toMatchObject({ code: "TIMEOUT" });
    c.reply(2, undefined);
    expect(c.sent).toHaveLength(3); // No timeout retry or synthetic completion.
  });

  it("rejects command errors without dropping the connection", async () => {
    const c = connection();
    const rejected = c.client.request({ type: "prompt", message: "busy" });
    c.reply(0, undefined, false);
    await expect(rejected).rejects.toMatchObject({ code: "REJECTED", message: "request rejected" });
    const state = c.client.request({ type: "get_state" });
    c.reply(1, { isStreaming: true });
    expect((await state).data).toEqual({ isStreaming: true });
  });

  it.each(["not json\n", "[]\n", '{"type":"response","id":"x","success":"yes"}\n'])
    ("fails closed on invalid protocol: %s", async (line) => {
      const c = connection();
      const pending = c.client.request({ type: "get_state" });
      c.output.write(line);
      await expect(pending).rejects.toBeInstanceOf(PiRpcError);
      await expect(c.client.request({ type: "get_state" })).rejects.toMatchObject({ code: "PROTOCOL" });
    });

  it("rejects mismatched responses and oversized records", async () => {
    const c = connection();
    const pending = c.client.request({ type: "get_state" });
    c.output.write(JSON.stringify({ type: "response", id: c.sent[0].id, command: "abort", success: true }) + "\n");
    await expect(pending).rejects.toMatchObject({ code: "PROTOCOL" });
    const input = new PassThrough(), output = new PassThrough();
    const client = new PiRpcClient({ input, output, maxRecordBytes: 32 });
    clients.push(client);
    const oversized = client.request({ type: "get_state" });
    output.write("x".repeat(33));
    await expect(oversized).rejects.toMatchObject({ code: "PROTOCOL" });
  });

  it("rejects all pending requests on disconnect without claiming Pi has stopped", async () => {
    const c = connection();
    const a = c.client.request({ type: "get_state" });
    const b = c.client.request({ type: "get_messages" });
    c.client.disconnect();
    await expect(a).rejects.toMatchObject({ code: "DISCONNECTED" });
    await expect(b).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(c.events).toEqual([]);
    expect(c.output.listenerCount("data")).toBe(0);
  });

  it("reports EOF and write failure promptly, including an unfinished UTF-8 record", async () => {
    const c = connection();
    const request = c.client.request({ type: "get_messages" });
    c.output.write(Buffer.from([0xe4, 0xb8]));
    c.output.end();
    await expect(request).rejects.toMatchObject({ code: "PROTOCOL" });
    const broken = connection();
    broken.input.end();
    await expect(broken.client.request({ type: "get_state" })).rejects.toMatchObject({ code: "DISCONNECTED" });
  });
});
