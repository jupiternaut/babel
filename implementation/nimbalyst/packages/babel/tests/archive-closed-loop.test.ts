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

async function startSharedHttp(simulate: "off" | "sync" = "off") {
  const opened = openDomain(simulate);
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "op01-archive-loop-token",
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
  throw new Error("timed out waiting for archive-loop state");
}

describe("archive closed loop on one DomainService", () => {
  it("GUI archive with current revision is archived=true for CLI and TUI on the same trackerId", async () => {
    const { domain, endpoint, cli, tui } = await startSharedHttp("off");
    const health = await cli.health();
    expect(health.mode).toBe("demo");
    expect(health.ok).toBe(true);

    const created = await command(domain, "task.create", {
      id: "op01-archive-loop",
      title: "GUI 归档闭环",
      primaryType: "task",
    });
    expect(created.ok).toBe(true);
    const before = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(before.record.archived).toBe(false);

    const cursor = domain.store.data.cursor;
    const archived = await domain.command({
      name: "task.archive",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
      expectedRevision: before.record.revision,
      actor: { id: "op01-gui", kind: "gui", projectIds: [PROJECT] },
    });
    expect(archived.ok).toBe(true);
    expect(archived.mode).toBe("demo");
    expect(relatedEvents(domain, PROJECT, cursor, archived.correlationId).some(
      (event) => event.type === "task.archived" && event.trackerId === created.trackerId,
    )).toBe(true);

    const adapterCreated = await command(domain, "task.create", {
      id: "op01-adapter-archive",
      title: "适配器归档带 revision",
    });
    const source = new DemoTrackerDataSource({
      endpoint,
      projectId: PROJECT,
      actor: { id: "op01-gui", kind: "gui", projectIds: [PROJECT] },
    });
    const sent = vi.spyOn(source.client, "command");
    const viaAdapter = await source.command({
      type: "archive-item",
      itemId: adapterCreated.trackerId!,
      archive: true,
    });
    expect(viaAdapter.ok).toBe(true);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      name: "task.archive",
      expectedRevision: adapterCreated.revision,
    });
    const adapterAfter = query<TaskDetail>(domain, "task.get", { trackerId: adapterCreated.trackerId });
    expect(adapterAfter.record.archived).toBe(true);
    expect(adapterAfter.stage).toBe("ARCHIVED");
    source.dispose();

    const viaCliHttp = await cli.query<TaskDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(viaCliHttp.mode).toBe("demo");
    expect(viaCliHttp.record.id).toBe("op01-archive-loop");
    expect(viaCliHttp.record.archived).toBe(true);
    expect(viaCliHttp.stage).toBe("ARCHIVED");

    const viaExecute = await executeCli([
      "task",
      "get",
      "--project",
      PROJECT,
      "--id",
      created.trackerId!,
      "--endpoint",
      endpoint,
    ]);
    expect(viaExecute.exitCode).toBe(0);
    const cliBody = JSON.parse(viaExecute.stdout) as TaskDetail;
    expect(cliBody.mode).toBe("demo");
    expect(cliBody.record.id).toBe("op01-archive-loop");
    expect(cliBody.record.archived).toBe(true);
    expect(cliBody.stage).toBe("ARCHIVED");

    const viaTui = await tui.query<TaskDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(viaTui.mode).toBe("demo");
    expect(viaTui.record.id).toBe(cliBody.record.id);
    expect(viaTui.record.archived).toBe(true);
    expect(viaTui.stage).toBe("ARCHIVED");
    expect(viaTui.record.revision).toBe(viaCliHttp.record.revision);
  });

  it("rejects stale expectedRevision on archive and restore without changing the record", async () => {
    const { domain, endpoint } = await startSharedHttp("off");
    const created = await command(domain, "task.create", {
      id: "op01-revision-guard",
      title: "旧 revision 必须拒绝",
    });
    const before = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    const stale = before.record.revision - 1;
    const cursor = domain.store.data.cursor;

    await expectCode(
      () => command(domain, "task.archive", { trackerId: created.trackerId }, { expectedRevision: stale }),
      "REVISION_CONFLICT",
    );
    const afterStaleArchive = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(afterStaleArchive.record.revision).toBe(before.record.revision);
    expect(afterStaleArchive.record.archived).toBe(false);
    expect(domain.eventsSince(PROJECT, cursor).some((event) => event.type === "task.archived")).toBe(false);

    const cliStale = await executeCli([
      "task",
      "archive",
      "--project",
      PROJECT,
      "--id",
      created.trackerId!,
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
    const stillOpen = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(stillOpen.record.revision).toBe(before.record.revision);
    expect(stillOpen.record.archived).toBe(false);

    const archived = await command(domain, "task.archive", { trackerId: created.trackerId }, {
      expectedRevision: stillOpen.record.revision,
    });
    expect(archived.ok).toBe(true);
    const archivedDetail = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(archivedDetail.record.archived).toBe(true);
    const archivedRevision = archivedDetail.record.revision;

    await expectCode(
      () => command(domain, "task.restore", { trackerId: created.trackerId }, {
        expectedRevision: archivedRevision - 1,
      }),
      "REVISION_CONFLICT",
    );
    const afterStaleRestore = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(afterStaleRestore.record.revision).toBe(archivedRevision);
    expect(afterStaleRestore.record.archived).toBe(true);

    const cliRestore = await executeCli([
      "task",
      "restore",
      "--project",
      PROJECT,
      "--id",
      created.trackerId!,
      "--expected-revision",
      String(archivedRevision - 1),
      "--endpoint",
      endpoint,
    ]);
    expect(cliRestore.exitCode).toBe(EXIT_BY_CODE.REVISION_CONFLICT);
    expect((JSON.parse(cliRestore.stdout) as { code?: string }).code).toBe("REVISION_CONFLICT");
    const stillArchived = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(stillArchived.record.revision).toBe(archivedRevision);
    expect(stillArchived.record.archived).toBe(true);
  });

  it("restore after a finished run keeps latestRunId and run.list ids and does not start a run", async () => {
    const { domain, cli } = await startSharedHttp("sync");
    const health = await cli.health();
    expect(health.mode).toBe("demo");

    const created = await command(domain, "task.create", {
      id: "op01-history-restore",
      title: "归档后保留执行历史",
    });
    const started = await command(domain, "run.start", { trackerId: created.trackerId });
    expect(started.runId).toBeTruthy();
    const accepted = await command(domain, "review.accept", { runId: started.runId });
    expect(accepted.ok).toBe(true);

    const before = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    const beforeRuns = query<{ runs: Array<{ id: string }> }>(domain, "run.list", {
      trackerId: created.trackerId,
    });
    expect(before.binding.latestRunId).toBe(started.runId);
    expect(beforeRuns.runs.map((row) => row.id)).toEqual([started.runId]);

    const archived = await command(domain, "task.archive", { trackerId: created.trackerId }, {
      expectedRevision: before.record.revision,
    });
    expect(archived.ok).toBe(true);
    const archivedDetail = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(archivedDetail.record.archived).toBe(true);
    expect(archivedDetail.stage).toBe("ARCHIVED");
    expect(archivedDetail.binding.latestRunId).toBe(started.runId);

    const restoreCursor = domain.store.data.cursor;
    const restored = await command(domain, "task.restore", { trackerId: created.trackerId }, {
      expectedRevision: archivedDetail.record.revision,
    });
    expect(restored.ok).toBe(true);
    expect(restored.result.started).toBe(false);
    const restoreEvents = relatedEvents(domain, PROJECT, restoreCursor, restored.correlationId);
    expect(restoreEvents.some((event) => event.payload.action === "restore" && event.payload.started === false)).toBe(true);
    expect(restoreEvents.some((event) => event.type === "run.started" || event.type === "run.accepted")).toBe(false);
    expect(domain.eventsSince(PROJECT, restoreCursor).some((event) => event.type === "run.started")).toBe(false);

    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(after.record.archived).toBe(false);
    expect(after.binding.latestRunId).toBe(started.runId);
    const afterRuns = query<{ runs: Array<{ id: string }> }>(domain, "run.list", {
      trackerId: created.trackerId,
    });
    expect(afterRuns.runs.map((row) => row.id)).toEqual(beforeRuns.runs.map((row) => row.id));
    expect(after.mode).toBe("demo");
  });

  it("TUI confirm archive sends the selected record revision (headless, no ConPTY)", async () => {
    const { domain, endpoint } = await startSharedHttp("off");
    const created = await command(domain, "task.create", {
      id: "op01-tui-archive-rev",
      title: "op01-tui-archive-rev",
    });
    const before = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
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
    tui.feed("op01-tui-archive-rev");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => tui.inspect().selectedId === created.trackerId);
    tui.feed("a");
    expect(tui.inspect().overlay).toBe("confirm");
    tui.feedEvent({ type: "key", name: "enter", raw: "\r", ctrl: false, shift: false });
    await waitUntil(() => sent.some((row) => row.name === "task.archive"));
    const archiveReq = sent.find((row) => row.name === "task.archive");
    expect(archiveReq?.expectedRevision).toBe(before.record.revision);
    await waitUntil(() => query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId }).record.archived);
    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(after.record.archived).toBe(true);
    expect(after.stage).toBe("ARCHIVED");
  });
});
