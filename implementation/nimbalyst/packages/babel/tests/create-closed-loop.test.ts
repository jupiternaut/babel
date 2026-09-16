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
  type CommandResult,
} from "../src/contracts.ts";
import {
  PROJECT,
  command,
  openDomain,
  query,
  relatedEvents,
  type TaskDetail,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

async function startSharedHttp() {
  const opened = openDomain("off");
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "op02-create-loop-token",
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
  throw new Error("timed out waiting for create-loop state");
}

function assertDynamicId(id: string | null | undefined): asserts id is string {
  expect(id).toEqual(expect.any(String));
  expect(id).toBeTruthy();
  expect(id).toMatch(/^trk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(id!.startsWith("fixture-tracker-")).toBe(false);
}

function findListed(
  listed: TaskListResult,
  trackerId: string,
  title: string,
): TaskListResult["items"][number] | undefined {
  return listed.items.find((row) => row.trackerId === trackerId && row.title === title);
}

async function assertSharedIdentity(
  args: {
    domain: ReturnType<typeof openDomain>["domain"];
    endpoint: string;
    cli: CliHttp;
    tui: TuiHttp;
    trackerId: string;
    title: string;
    cursor: number | string;
    correlationId: string;
  },
): Promise<void> {
  const { domain, endpoint, cli, tui, trackerId, title, cursor, correlationId } = args;
  assertDynamicId(trackerId);

  const createdEvents = relatedEvents(domain, PROJECT, cursor, correlationId);
  expect(createdEvents.some((event) => (
    event.type === "task.updated"
    && event.trackerId === trackerId
    && event.payload.action === "create"
    && event.payload.title === title
  ))).toBe(true);

  const viaCliHttp = await cli.query<TaskDetail>({
    name: "task.get",
    projectId: PROJECT,
    input: { trackerId },
  });
  expect(viaCliHttp.mode).toBe("demo");
  expect(viaCliHttp.record.id).toBe(trackerId);
  expect(viaCliHttp.record.fields.title).toBe(title);

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
  const cliGet = JSON.parse(viaExecuteGet.stdout) as TaskDetail;
  expect(cliGet.mode).toBe("demo");
  expect(cliGet.record.id).toBe(trackerId);
  expect(cliGet.record.fields.title).toBe(title);

  const viaTuiGet = await tui.query<TaskDetail>({
    name: "task.get",
    projectId: PROJECT,
    input: { trackerId },
  });
  expect(viaTuiGet.mode).toBe("demo");
  expect(viaTuiGet.record.id).toBe(trackerId);
  expect(viaTuiGet.record.fields.title).toBe(title);
  expect(viaTuiGet.record.revision).toBe(viaCliHttp.record.revision);

  const viaCliList = await cli.query<TaskListResult>({
    name: "task.list",
    projectId: PROJECT,
    input: { types: "executable" },
  });
  expect(viaCliList.mode).toBe("demo");
  expect(findListed(viaCliList, trackerId, title)).toMatchObject({
    trackerId,
    title,
    primaryType: "task",
  });

  const viaExecuteList = await executeCli([
    "task",
    "list",
    "--project",
    PROJECT,
    "--types",
    "executable",
    "--endpoint",
    endpoint,
  ]);
  expect(viaExecuteList.exitCode).toBe(0);
  const cliList = JSON.parse(viaExecuteList.stdout) as TaskListResult;
  expect(cliList.mode).toBe("demo");
  expect(findListed(cliList, trackerId, title)).toMatchObject({ trackerId, title });

  const viaTuiList = await tui.query<TaskListResult>({
    name: "task.list",
    projectId: PROJECT,
    input: { types: "executable" },
  });
  expect(viaTuiList.mode).toBe("demo");
  expect(findListed(viaTuiList, trackerId, title)).toMatchObject({ trackerId, title });

  const domainList = query<TaskListResult>(domain, "task.list", { types: "executable" });
  expect(findListed(domainList, trackerId, title)).toMatchObject({ trackerId, title });
}

describe("create closed loop on one DomainService", () => {
  it("CLI task.create without an id is the same record for CliHttp, executeCli, TuiHttp, and executable list", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const health = await cli.health();
    expect(health.mode).toBe("demo");
    expect(health.ok).toBe(true);

    const title = `OP-02 CLI 新建 ${Date.now()}`;
    const cursor = domain.store.data.cursor;
    const created = await executeCli([
      "task",
      "create",
      "--project",
      PROJECT,
      "--name",
      title,
      "--endpoint",
      endpoint,
    ]);
    expect(created.exitCode).toBe(0);
    const body = JSON.parse(created.stdout) as CommandResult;
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("demo");
    expect(body.projectId).toBe(PROJECT);
    assertDynamicId(body.trackerId);

    await assertSharedIdentity({
      domain,
      endpoint,
      cli,
      tui,
      trackerId: body.trackerId,
      title,
      cursor,
      correlationId: body.correlationId,
    });
  });

  it("GUI create-item without an id shares the dynamic TrackerRecord with CLI and TUI queries", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const title = `OP-02 GUI 新建 ${Date.now()}`;
    const source = new DemoTrackerDataSource({
      endpoint,
      projectId: PROJECT,
      actor: { id: "op02-gui", kind: "gui", projectIds: [PROJECT] },
    });
    const sent = vi.spyOn(source.client, "command");
    const cursor = domain.store.data.cursor;
    const viaAdapter = await source.command({
      type: "create-item",
      item: { type: "task", title },
    });
    expect(viaAdapter.ok).toBe(true);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      name: "task.create",
      input: { title, primaryType: "task" },
    });
    expect(sent.mock.calls[0]?.[0].input.id == null).toBe(true);
    const createdId = viaAdapter.result?.trackerId;
    assertDynamicId(createdId);
    expect(viaAdapter.result?.projectId).toBe(PROJECT);
    source.dispose();

    await assertSharedIdentity({
      domain,
      endpoint,
      cli,
      tui,
      trackerId: createdId,
      title,
      cursor,
      correlationId: viaAdapter.result!.correlationId,
    });
  });

  it("TUI headless create selects the dynamic id and CLI/TUI queries see the same title (no ConPTY)", async () => {
    const { domain, endpoint, cli, tui: tuiHttp } = await startSharedHttp();
    const title = `OP-02 TUI 新建 ${Date.now()}`;
    const http = new TuiHttp({
      endpoint,
      actor: { ...DEMO_ACTOR, kind: "tui" },
    });
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

    const cursor = domain.store.data.cursor;
    tui.feed("n");
    expect(tui.inspect().overlay).toBe("create");
    tui.feed(title);
    tui.feedEvent({ type: "key", name: "ctrl-s", raw: "\x13", ctrl: true, shift: false });
    await waitUntil(() => {
      const selected = tui.inspect().selectedId;
      return Boolean(selected && !selected.startsWith("fixture-tracker-") && tui.inspect().overlay === "none");
    });

    const selectedId = tui.inspect().selectedId;
    assertDynamicId(selectedId);
    expect(tui.inspect().items.some((row) => row.trackerId === selectedId && row.title === title)).toBe(true);

    const created = query<TaskDetail>(domain, "task.get", { trackerId: selectedId });
    expect(created.record.fields.title).toBe(title);
    const events = domain.eventsSince(PROJECT, cursor);
    const createEvent = events.find((event) => (
      event.trackerId === selectedId
      && event.type === "task.updated"
      && event.payload.action === "create"
    ));
    expect(createEvent).toBeTruthy();

    await assertSharedIdentity({
      domain,
      endpoint,
      cli,
      tui: tuiHttp,
      trackerId: selectedId,
      title,
      cursor,
      correlationId: createEvent!.correlationId,
    });
  });

  it("direct task.create without id is not a fixture card and stays one record across actors", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp();
    const title = `OP-02 权威新建 ${Date.now()}`;
    const cursor = domain.store.data.cursor;
    const created = await command(domain, "task.create", {
      title,
      primaryType: "task",
    }, {
      actor: { id: "op02-gui", kind: "gui", projectIds: [PROJECT] },
    });
    expect(created.ok).toBe(true);
    assertDynamicId(created.trackerId);

    await assertSharedIdentity({
      domain,
      endpoint,
      cli,
      tui,
      trackerId: created.trackerId,
      title,
      cursor,
      correlationId: created.correlationId,
    });
  });
});
