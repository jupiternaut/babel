import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoTrackerDataSource } from "../src/adapters/DemoTrackerDataSource.ts";
import { executeCli } from "../src/cli/run.ts";
import { CliHttp } from "../src/cli/http.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { BabelTui } from "../src/tui/app.ts";
import { createDemoServer } from "../src/server/http.ts";
import {
  DEFAULT_PROJECT_ID,
  DEMO_ACTOR,
  EXIT_BY_CODE,
  type CommandRequest,
  type CommandResult,
} from "../src/contracts.ts";
import {
  PROJECT,
  command,
  expectCode,
  openDomain,
  query,
  relatedEvents,
  type TaskDetail,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

type EditDetail = TaskDetail & {
  record: TaskDetail["record"] & {
    content?: { markdown?: string };
    fields: TaskDetail["record"]["fields"] & { description?: string };
  };
};

async function startSharedHttp() {
  const opened = openDomain("off");
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "op03-edit-loop-token",
  });
  await server.listen();
  expect(server.port).not.toBe(7780);
  expect(server.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  sessions.push({
    dispose: async () => {
      await server.close();
      await new Promise((resolve) => setTimeout(resolve, 40));
      opened.dispose();
    },
  });
  return {
    domain: opened.domain,
    endpoint: server.endpoint,
    cli: new CliHttp({ endpoint: server.endpoint }),
    tui: new TuiHttp({ endpoint: server.endpoint }),
  };
}

async function waitUntil(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for edit-loop state");
}

function assertDynamicId(id: string | null | undefined): asserts id is string {
  expect(id).toEqual(expect.any(String));
  expect(id).toBeTruthy();
  expect(id).toMatch(/^trk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(id!.startsWith("fixture-tracker-")).toBe(false);
}

async function createEditable(domain: ReturnType<typeof openDomain>["domain"], title: string, description = "原文") {
  const created = await command(domain, "task.create", {
    title,
    description,
    primaryType: "task",
  });
  expect(created.ok).toBe(true);
  assertDynamicId(created.trackerId);
  const before = query<EditDetail>(domain, "task.get", { trackerId: created.trackerId });
  return {
    created,
    before,
    trackerId: created.trackerId!,
    expectedRevision: before.record.revision,
    title: before.record.fields.title,
    description: String(before.record.fields.description ?? ""),
  };
}

async function assertSharedEdit(args: {
  domain: ReturnType<typeof openDomain>["domain"];
  endpoint: string;
  cli: CliHttp;
  tui: TuiHttp;
  trackerId: string;
  title: string;
  description: string;
  revision: number;
  cursor: number | string;
  correlationId: string;
}): Promise<void> {
  const { domain, endpoint, cli, tui, trackerId, title, description, revision, cursor, correlationId } = args;
  assertDynamicId(trackerId);

  const updatedEvents = relatedEvents(domain, PROJECT, cursor, correlationId);
  expect(updatedEvents.some((event) => (
    event.type === "task.updated"
    && event.trackerId === trackerId
    && event.payload.action === "update"
    && event.revision === revision
  ))).toBe(true);

  const viaCliHttp = await cli.query<EditDetail>({
    name: "task.get",
    projectId: PROJECT,
    input: { trackerId },
  });
  expect(viaCliHttp.mode).toBe("demo");
  expect(viaCliHttp.record.id).toBe(trackerId);
  expect(viaCliHttp.record.revision).toBe(revision);
  expect(viaCliHttp.record.fields.title).toBe(title);
  expect(viaCliHttp.record.fields.description).toBe(description);
  expect(viaCliHttp.record.content?.markdown ?? viaCliHttp.record.fields.description).toBe(description);

  const viaExecuteGet = await executeCli([
    "task",
    "get",
    "--project",
    PROJECT,
    "--id",
    trackerId,
    "--endpoint",
    endpoint,
  ]);
  expect(viaExecuteGet.exitCode).toBe(0);
  const cliGet = JSON.parse(viaExecuteGet.stdout) as EditDetail;
  expect(cliGet.mode).toBe("demo");
  expect(cliGet.record.id).toBe(trackerId);
  expect(cliGet.record.revision).toBe(revision);
  expect(cliGet.record.fields.title).toBe(title);
  expect(cliGet.record.fields.description).toBe(description);

  const viaTuiGet = await tui.query<EditDetail>({
    name: "task.get",
    projectId: PROJECT,
    input: { trackerId },
  });
  expect(viaTuiGet.mode).toBe("demo");
  expect(viaTuiGet.record.id).toBe(trackerId);
  expect(viaTuiGet.record.revision).toBe(revision);
  expect(viaTuiGet.record.fields.title).toBe(title);
  expect(viaTuiGet.record.fields.description).toBe(description);

  const authority = query<EditDetail>(domain, "task.get", { trackerId });
  expect(authority.record.id).toBe(trackerId);
  expect(authority.record.revision).toBe(revision);
  expect(authority.record.fields.title).toBe(title);
  expect(authority.record.fields.description).toBe(description);
}

function snapshotRecord(detail: EditDetail) {
  return {
    revision: detail.record.revision,
    title: detail.record.fields.title,
    description: detail.record.fields.description,
    markdown: detail.record.content?.markdown ?? detail.record.fields.description,
    archived: detail.record.archived,
  };
}

describe("edit revision closed loop on one DomainService", () => {
  it("CLI task.update with current revision is the same title/revision for CLI and TUI task.get", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const health = await cli.health();
    expect(health.mode).toBe("demo");
    expect(health.ok).toBe(true);

    const seedTitle = `OP-03 CLI 原文 ${Date.now()}`;
    const nextTitle = `OP-03 CLI 已改标题 ${Date.now()}`;
    const { trackerId, expectedRevision, description } = await createEditable(domain, seedTitle);
    const cursor = domain.store.data.cursor;
    const updated = await executeCli([
      "task",
      "update",
      "--project",
      PROJECT,
      "--id",
      trackerId,
      "--name",
      nextTitle,
      "--expected-revision",
      String(expectedRevision),
      "--endpoint",
      endpoint,
    ]);
    expect(updated.exitCode).toBe(0);
    const body = JSON.parse(updated.stdout) as CommandResult;
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("demo");
    expect(body.trackerId).toBe(trackerId);
    expect(body.revision).toBe(expectedRevision + 1);

    await assertSharedEdit({
      domain,
      endpoint,
      cli,
      tui,
      trackerId,
      title: nextTitle,
      description,
      revision: body.revision!,
      cursor,
      correlationId: body.correlationId,
    });
  });

  it("GUI update-item with current revision shares markdown/revision with CLI and TUI", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const seedTitle = `OP-03 GUI 原文 ${Date.now()}`;
    const nextBody = `OP-03 GUI 已改正文 ${Date.now()}`;
    const { trackerId, expectedRevision } = await createEditable(domain, seedTitle, "GUI 原文");
    const source = new DemoTrackerDataSource({
      endpoint,
      projectId: PROJECT,
      actor: { id: "op03-gui", kind: "gui", projectIds: [PROJECT] },
    });
    const sent = vi.spyOn(source.client, "command");
    const cursor = domain.store.data.cursor;
    const viaAdapter = await source.command({
      type: "update-item",
      input: {
        itemId: trackerId,
        updates: { markdown: nextBody },
        expectedRevision,
      },
    });
    expect(viaAdapter.ok).toBe(true);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      name: "task.update",
      expectedRevision,
      input: { trackerId, markdown: nextBody },
    });
    source.dispose();

    await assertSharedEdit({
      domain,
      endpoint,
      cli,
      tui,
      trackerId,
      title: seedTitle,
      description: nextBody,
      revision: expectedRevision + 1,
      cursor,
      correlationId: viaAdapter.result!.correlationId,
    });
  });

  it("TUI headless edit sends the selected record revision (no ConPTY)", async () => {
    const { domain, endpoint, cli, tui: tuiHttp } = await startSharedHttp();
    const seedTitle = `OP-03 TUI ${Date.now()}`;
    const nextTitle = `OP-03 TUI 已改 ${Date.now()}`;
    const { trackerId, expectedRevision, description } = await createEditable(domain, seedTitle);
    const http = new TuiHttp({
      endpoint,
      actor: { ...DEMO_ACTOR, kind: "tui" },
    });
    const sent: CommandRequest[] = [];
    const original = http.command.bind(http);
    http.command = async (request) => {
      sent.push(request);
      return original(request);
    };
    const tui = new BabelTui({
      endpoint,
      projectId: DEFAULT_PROJECT_ID,
      http,
      headless: true,
      cols: 120,
      rows: 40,
    });
    sessions.push({ dispose: () => tui.dispose() });
    await tui.boot();
    tui.feed("/");
    tui.feed(seedTitle);
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().selectedId === trackerId);
    await waitUntil(() => {
      if (tui.inspect().overlay === "edit") return true;
      tui.feed("e");
      return tui.inspect().overlay === "edit";
    });
    expect(tui.inspect().overlayRevision).toBe(expectedRevision);
    for (let i = 0; i < seedTitle.length; i += 1) {
      tui.feedEvent({ type: "key", name: "backspace", raw: "\x7f", ctrl: false, shift: false });
    }
    tui.feed(nextTitle);
    const cursor = domain.store.data.cursor;
    tui.feedEvent({ type: "key", name: "ctrl-s", raw: "\x13", ctrl: true, shift: false });
    await waitUntil(() => sent.some((row) => row.name === "task.update"));
    const updateReq = sent.find((row) => row.name === "task.update");
    expect(updateReq?.expectedRevision).toBe(expectedRevision);
    expect(updateReq?.input.trackerId).toBe(trackerId);
    expect(updateReq?.input.title).toBe(nextTitle);
    await waitUntil(() => tui.inspect().overlay === "none" && !tui.inspect().error);
    const after = query<EditDetail>(domain, "task.get", { trackerId });
    expect(after.record.fields.title).toBe(nextTitle);
    expect(after.record.revision).toBe(expectedRevision + 1);
    const updateEvent = domain.eventsSince(PROJECT, cursor).find((event) => (
      event.trackerId === trackerId
      && event.type === "task.updated"
      && event.payload.action === "update"
    ));
    expect(updateEvent?.correlationId).toBeTruthy();

    await assertSharedEdit({
      domain,
      endpoint,
      cli,
      tui: tuiHttp,
      trackerId,
      title: nextTitle,
      description,
      revision: after.record.revision,
      cursor,
      correlationId: updateEvent!.correlationId,
    });
  });

  it("rejects stale expectedRevision without changing the record or emitting task.updated", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const seedTitle = `OP-03 冲突原文 ${Date.now()}`;
    const { trackerId, expectedRevision, before } = await createEditable(domain, seedTitle, "冲突前正文");
    const stale = expectedRevision - 1;
    const cursor = domain.store.data.cursor;
    const snapshot = snapshotRecord(before);

    await expectCode(
      () => command(domain, "task.update", {
        trackerId,
        title: "不应写入",
        markdown: "不应写入正文",
      }, { expectedRevision: stale }),
      "REVISION_CONFLICT",
    );
    const afterDomain = query<EditDetail>(domain, "task.get", { trackerId });
    expect(snapshotRecord(afterDomain)).toEqual(snapshot);
    expect(domain.eventsSince(PROJECT, cursor).some((event) => (
      event.type === "task.updated" && event.payload.action === "update"
    ))).toBe(false);

    const cliStale = await executeCli([
      "task",
      "update",
      "--project",
      PROJECT,
      "--id",
      trackerId,
      "--name",
      "CLI 不应写入",
      "--expected-revision",
      String(stale),
      "--endpoint",
      endpoint,
    ]);
    expect(cliStale.exitCode).toBe(EXIT_BY_CODE.REVISION_CONFLICT);
    const cliBody = JSON.parse(cliStale.stdout) as { ok?: boolean; code?: string; mode?: string };
    expect(cliBody.ok).toBe(false);
    expect(cliBody.code).toBe("REVISION_CONFLICT");
    expect(cliBody.mode).toBe("demo");

    const source = new DemoTrackerDataSource({
      endpoint,
      projectId: PROJECT,
      actor: { id: "op03-gui", kind: "gui", projectIds: [PROJECT] },
    });
    const viaAdapter = await source.command({
      type: "update-item",
      input: {
        itemId: trackerId,
        updates: { title: "GUI 不应写入" },
        expectedRevision: stale,
      },
    });
    expect(viaAdapter.ok).toBe(false);
    expect((viaAdapter.result as { code?: string } | undefined)?.code).toBe("REVISION_CONFLICT");
    source.dispose();

    const still = query<EditDetail>(domain, "task.get", { trackerId });
    expect(snapshotRecord(still)).toEqual(snapshot);
    expect(domain.eventsSince(PROJECT, cursor).some((event) => (
      event.type === "task.updated" && event.payload.action === "update"
    ))).toBe(false);

    const viaCliHttp = await cli.query<EditDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId },
    });
    const viaTui = await tui.query<EditDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId },
    });
    expect(viaCliHttp.record.id).toBe(trackerId);
    expect(viaTui.record.id).toBe(trackerId);
    expect(viaCliHttp.record.revision).toBe(expectedRevision);
    expect(viaTui.record.revision).toBe(expectedRevision);
    expect(viaCliHttp.record.fields.title).toBe(seedTitle);
    expect(viaTui.record.fields.title).toBe(seedTitle);
  });
});
