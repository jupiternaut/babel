import { afterEach, describe, expect, it } from "vitest";
import { OpsService, SyntheticChatSource } from "../src/ops/index.ts";
import { PROJECT, openDomain } from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("chat inbox adapter contract", () => {
  it("exposes a neutral synthetic adapter and does not select Element or Fluxer", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const source = new SyntheticChatSource();
    expect(source.adapterId).toBe("synthetic");
    expect(source.vendor).toBe("none");
    const ops = new OpsService({ domain: opened.domain, projectId: PROJECT, chatSource: source });

    const info = ops.query({ name: "chat.adapter.info", projectId: PROJECT });
    expect(info).toMatchObject({
      mode: "demo",
      adapterId: "synthetic",
      vendor: "none",
      selectedVendor: null,
      element: false,
      fluxer: false,
      deployedChatServer: false,
      contract: "neutral-synthetic",
    });

    const ingested = await ops.command({
      name: "chat.inbox.ingest",
      projectId: PROJECT,
      correlationId: "corr-chat-empty",
      input: { roomId: "missing-room" },
    });
    expect(ingested.result.accepted).toEqual([]);
    const events = ops.query({ name: "ops.events.list", projectId: PROJECT, input: { cursor: 0 } });
    expect((events.events as Array<{ type: string }>).some((event) => event.type === "chat.todo.saved")).toBe(false);
    expect(ops.query({ name: "chat.inbox.list", projectId: PROJECT }).messages).toEqual([]);
  });

  it("dedupes the same synthetic message id on a second ingest", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const ops = new OpsService({ domain: opened.domain, projectId: PROJECT });
    const message = {
      messageId: "msg-dup",
      roomId: "room-synth",
      authorId: "cara",
      text: "重复投递",
      sentAt: "2026-09-14T16:10:00.000Z",
    };
    await ops.command({ name: "chat.inbox.ingest", projectId: PROJECT, input: { messages: [message] } });
    const second = await ops.command({
      name: "chat.inbox.ingest",
      projectId: PROJECT,
      correlationId: "corr-chat-dup",
      input: { messages: [message] },
    });
    expect(second.result.accepted).toEqual([]);
    const listed = ops.query({ name: "chat.inbox.list", projectId: PROJECT });
    expect(listed.messages).toHaveLength(1);
    const ingestEvents = ops.eventsSince(0).filter((event) => event.type === "chat.message.ingested");
    expect(ingestEvents).toHaveLength(1);
  });
});
