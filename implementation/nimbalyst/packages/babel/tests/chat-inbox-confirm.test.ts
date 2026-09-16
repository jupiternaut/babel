import { afterEach, describe, expect, it } from "vitest";
import { OpsService, SyntheticChatSource } from "../src/ops/index.ts";
import { PROJECT, openDomain, query, relatedEvents, type TaskDetail, type TaskListResult } from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

const MESSAGE = {
  messageId: "msg-deploy-window",
  roomId: "room-synth",
  authorId: "alice",
  text: "请核对下周的部署窗口，不要直接上线。",
  sentAt: "2026-09-14T16:00:00.000Z",
};

function openInbox() {
  const opened = openDomain("off");
  const source = new SyntheticChatSource([MESSAGE]);
  const ops = new OpsService({ domain: opened.domain, projectId: PROJECT, chatSource: source });
  sessions.push(opened);
  return { domain: opened.domain, ops, source };
}

describe("chat inbox confirm-to-save", () => {
  it("ingest and preview leave DomainService unchanged until the user confirms", async () => {
    const { domain, ops } = openInbox();
    const domainCursor = domain.store.data.cursor;

    const ingested = await ops.command({
      name: "chat.inbox.ingest",
      projectId: PROJECT,
      correlationId: "corr-chat-ingest",
      input: { roomId: "room-synth" },
    });
    expect(ingested.ok).toBe(true);
    expect(ingested.trackerId).toBeNull();
    expect(ingested.runId).toBeNull();
    expect(ingested.result.savedTodo).toBe(false);

    const ingestEvents = ops.eventsSince(0).filter((event) => event.correlationId === "corr-chat-ingest");
    expect(ingestEvents.map((event) => event.type)).toEqual(["chat.message.ingested"]);
    expect(ingestEvents[0]?.payload.savedTodo).toBe(false);

    const inbox = ops.query({ name: "chat.inbox.list", projectId: PROJECT });
    expect(inbox.messages).toEqual([expect.objectContaining({ messageId: MESSAGE.messageId, text: MESSAGE.text })]);

    const previewed = await ops.command({
      name: "chat.inbox.preview",
      projectId: PROJECT,
      correlationId: "corr-chat-preview",
      input: { messageId: MESSAGE.messageId },
    });
    const draft = previewed.result.draft as { draftId: string; confirmed: boolean; todo: { description: string }; provenance: { sourceKind: string; adapterId: string; vendor: string } };
    expect(draft.confirmed).toBe(false);
    expect(draft.provenance.sourceKind).toBe("chat");
    expect(draft.provenance.adapterId).toBe("synthetic");
    expect(draft.provenance.vendor).toBe("none");
    expect(draft.todo.description).toContain(MESSAGE.messageId);
    expect(draft.todo.description).toContain("未选定 Element/Fluxer");

    expect(ops.eventsSince(0).some((event) => event.type === "chat.todo.previewed")).toBe(true);
    expect(domain.eventsSince(PROJECT, domainCursor)).toHaveLength(0);
    const pending = query<TaskListResult>(domain, "task.list", { types: "all", q: "部署窗口" });
    expect(pending.items).toHaveLength(0);
  });

  it("confirm persists one sourced todo; reject and missing confirm do not", async () => {
    const { domain, ops } = openInbox();
    await ops.command({ name: "chat.inbox.ingest", projectId: PROJECT, input: { messages: [MESSAGE] } });
    const previewed = await ops.command({
      name: "chat.inbox.preview",
      projectId: PROJECT,
      input: { messageId: MESSAGE.messageId },
    });
    const draftId = (previewed.result.draft as { draftId: string }).draftId;
    const domainCursor = domain.store.data.cursor;

    await expect(
      ops.command({
        name: "chat.inbox.confirm",
        projectId: PROJECT,
        input: { draftId, confirmed: false },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(query<TaskListResult>(domain, "task.list", { types: "all", q: "部署窗口" }).items).toHaveLength(0);

    const confirmed = await ops.command({
      name: "chat.inbox.confirm",
      projectId: PROJECT,
      correlationId: "corr-chat-save",
      input: { draftId, confirmed: true, confirmedBy: "demo-operator" },
    });
    expect(confirmed.trackerId).toBeTruthy();
    expect(confirmed.runId).toBeNull();

    const savedEvents = ops.eventsSince(0).filter((event) => event.type === "chat.todo.saved");
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0]?.payload.trackerId).toBe(confirmed.trackerId);
    expect(savedEvents[0]?.payload.runId).toBeNull();

    const domainEvents = relatedEvents(domain, PROJECT, domainCursor, confirmed.correlationId);
    expect(domainEvents.some((event) => event.type === "task.updated")).toBe(true);

    const listed = query<TaskListResult>(domain, "task.list", { types: "all", q: "部署窗口" });
    expect(listed.items).toHaveLength(1);
    const detail = query<TaskDetail>(domain, "task.get", { trackerId: confirmed.trackerId });
    expect(detail.record.fields.description).toContain("msg-deploy-window");
    expect(detail.record.fields.description).toContain("synthetic");
    expect(detail.binding.latestRunId).toBeNull();
    expect(query<{ runs: unknown[] }>(domain, "run.list", { trackerId: confirmed.trackerId }).runs).toHaveLength(0);

    const again = await ops.command({
      name: "chat.inbox.confirm",
      projectId: PROJECT,
      input: { draftId, confirmed: true },
    });
    expect(again.trackerId).toBe(confirmed.trackerId);
    expect(query<TaskListResult>(domain, "task.list", { types: "all", q: "部署窗口" }).items).toHaveLength(1);

    const other = {
      messageId: "msg-reject",
      roomId: "room-synth",
      authorId: "bob",
      text: "这条不应落库",
      sentAt: "2026-09-14T16:05:00.000Z",
    };
    await ops.command({ name: "chat.inbox.ingest", projectId: PROJECT, input: { messages: [other] } });
    const rejectedPreview = await ops.command({
      name: "chat.inbox.preview",
      projectId: PROJECT,
      input: { messageId: other.messageId },
    });
    await ops.command({
      name: "chat.inbox.reject",
      projectId: PROJECT,
      input: { draftId: (rejectedPreview.result.draft as { draftId: string }).draftId },
    });
    await expect(
      ops.command({
        name: "chat.inbox.confirm",
        projectId: PROJECT,
        input: { messageId: other.messageId, confirmed: true },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(query<TaskListResult>(domain, "task.list", { types: "all", q: "不应落库" }).items).toHaveLength(0);
    expect(ops.eventsSince(0).some((event) => event.type === "chat.todo.rejected")).toBe(true);
  });
});
