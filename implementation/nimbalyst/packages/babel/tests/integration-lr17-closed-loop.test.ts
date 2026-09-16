import { afterEach, describe, expect, it } from "vitest";
import { CliHttp } from "../src/cli/http.ts";
import { TuiHttp } from "../src/tui/http.ts";
import { createDemoServer } from "../src/server/http.ts";
import type { CommandName } from "../src/contracts.ts";
import {
  PROJECT,
  command,
  openDomain,
  query,
  relatedEvents,
  type RunShow,
  type TaskDetail,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

async function startSharedHttp(simulate: "off" | "sync" = "sync") {
  const opened = openDomain(simulate);
  const server = createDemoServer({
    host: "127.0.0.1",
    port: 0,
    domain: opened.domain,
    serviceToken: "lr17-closed-loop-token",
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

describe("LR-17 joint closed loop on one DomainService and ephemeral HTTP", () => {
  it("create → update → simulated run.start → review.accept → archive → restore; restore does not start a run", async () => {
    const { domain, cli, tui } = await startSharedHttp("sync");
    const health = await cli.health();
    expect(health.mode).toBe("demo");

    const createCursor = domain.store.data.cursor;
    const created = await cli.command({
      name: "task.create",
      projectId: PROJECT,
      input: {
        id: "lr17-closed-loop",
        title: "联合回归闭环",
        description: "初稿",
        primaryType: "task",
      },
    });
    expect(created.ok).toBe(true);
    expect(created.mode).toBe("demo");
    expect(created.commandStatus).toBe("accepted");
    expect(created.settled).toBe(true);
    expect(created.trackerId).toBe("lr17-closed-loop");
    expect(relatedEvents(domain, PROJECT, createCursor, created.correlationId).some(
      (event) => event.type === "task.updated" && event.payload.action === "create" && event.trackerId === "lr17-closed-loop",
    )).toBe(true);
    const createdDetail = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(createdDetail.mode).toBe("demo");
    expect(createdDetail.record.id).toBe("lr17-closed-loop");
    expect(createdDetail.record.fields.title).toBe("联合回归闭环");
    expect(createdDetail.stage).toBe("TODO");
    expect(createdDetail.binding.latestRunId).toBeNull();

    const updateCursor = domain.store.data.cursor;
    const updated = await command(domain, "task.update", {
      trackerId: created.trackerId,
      title: "联合回归闭环已改",
      description: "修订正文",
    }, { expectedRevision: created.revision ?? undefined });
    expect(updated.ok).toBe(true);
    expect(relatedEvents(domain, PROJECT, updateCursor, updated.correlationId).some(
      (event) => event.type === "task.updated" && event.payload.action === "update",
    )).toBe(true);
    const viaTui = await tui.query<TaskDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(viaTui.record.id).toBe(created.trackerId);
    expect(viaTui.record.fields.title).toBe("联合回归闭环已改");
    expect(viaTui.record.fields.description).toBe("修订正文");
    expect(viaTui.record.revision).toBe(updated.revision);

    const startCursor = domain.store.data.cursor;
    const started = await cli.command({
      name: "run.start",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(started.ok).toBe(true);
    expect(started.settled).toBe(false);
    expect(started.runId).toBeTruthy();
    const startEvents = domain.eventsSince(PROJECT, startCursor);
    expect(startEvents.some((event) => event.type === "run.accepted" && event.runId === started.runId)).toBe(true);
    expect(startEvents.some((event) => event.type === "run.started" && event.runId === started.runId)).toBe(true);
    const shown = query<RunShow>(domain, "run.show", { runId: started.runId });
    expect(shown.mode).toBe("demo");
    expect(shown.run.status).toBe("review_required");
    expect(shown.run.status).not.toBe("succeeded");
    const running = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(running.binding.latestRunId).toBe(started.runId);
    expect(running.stage).not.toBe("DONE");

    const acceptCursor = domain.store.data.cursor;
    const accepted = await cli.command({
      name: "review.accept",
      projectId: PROJECT,
      input: { runId: started.runId },
    });
    expect(accepted.ok).toBe(true);
    expect(relatedEvents(domain, PROJECT, acceptCursor, accepted.correlationId).some(
      (event) => event.type === "run.finished" && event.payload.result === "succeeded",
    )).toBe(true);
    const done = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(done.stage).toBe("DONE");
    expect(done.binding.outcome).toBe("succeeded");
    const acceptedShow = await tui.query<RunShow>({
      name: "run.show",
      projectId: PROJECT,
      input: { runId: started.runId },
    });
    expect(acceptedShow.run.status).toBe("succeeded");

    const beforeRuns = query<{ runs: Array<{ id: string }> }>(domain, "run.list", { trackerId: created.trackerId });
    expect(beforeRuns.runs.map((row) => row.id)).toEqual([started.runId]);

    const archiveCursor = domain.store.data.cursor;
    const archived = await cli.command({
      name: "task.archive",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(archived.ok).toBe(true);
    expect(relatedEvents(domain, PROJECT, archiveCursor, archived.correlationId).some(
      (event) => event.type === "task.archived",
    )).toBe(true);
    const archivedDetail = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(archivedDetail.record.archived).toBe(true);
    expect(archivedDetail.stage).toBe("ARCHIVED");
    expect(archivedDetail.binding.latestRunId).toBe(started.runId);

    const restoreCursor = domain.store.data.cursor;
    const restored = await cli.command({
      name: "task.restore",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(restored.ok).toBe(true);
    expect(restored.result.started).toBe(false);
    const restoreEvents = relatedEvents(domain, PROJECT, restoreCursor, restored.correlationId);
    expect(restoreEvents.some((event) => event.payload.action === "restore" && event.payload.started === false)).toBe(true);
    expect(restoreEvents.some((event) => event.type === "run.accepted" || event.type === "run.started")).toBe(false);

    const after = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(after.record.id).toBe("lr17-closed-loop");
    expect(after.record.archived).toBe(false);
    expect(after.record.fields.title).toBe("联合回归闭环已改");
    expect(after.binding.latestRunId).toBe(started.runId);
    expect(after.stage).toBe("DONE");
    const afterHttp = await tui.query<TaskDetail>({
      name: "task.get",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect(afterHttp.record.revision).toBe(after.record.revision);
    expect(afterHttp.binding.latestRunId).toBe(started.runId);
    const afterRuns = query<{ runs: Array<{ id: string; status: string }> }>(domain, "run.list", {
      trackerId: created.trackerId,
    });
    expect(afterRuns.runs.map((row) => row.id)).toEqual(beforeRuns.runs.map((row) => row.id));
    expect(afterRuns.runs).toHaveLength(1);
    expect(afterRuns.runs[0]?.status).toBe("succeeded");
  });

  it("HTTP query after restore matches DomainService and does not emit a new run.start", async () => {
    const { domain, cli } = await startSharedHttp("sync");
    const created = await command(domain, "task.create", { title: "HTTP 恢复对照" });
    const started = await command(domain, "run.start", { trackerId: created.trackerId });
    await command(domain, "review.accept", { runId: started.runId });
    await command(domain, "task.archive", { trackerId: created.trackerId });
    const restoreCursor = domain.store.data.cursor;
    const restored = await cli.command({
      name: "task.restore",
      projectId: PROJECT,
      input: { trackerId: created.trackerId },
    });
    expect((restored.result as { started?: boolean }).started).toBe(false);
    const events = domain.eventsSince(PROJECT, restoreCursor);
    expect(events.some((event) => event.type === "run.accepted" || event.type === "run.started")).toBe(false);
    const listed = await cli.query<{ items: Array<{ trackerId: string; archived: boolean; latestRunId: string | null }> }>({
      name: "task.list",
      projectId: PROJECT,
      input: { types: "all", includeSemantic: true, q: "HTTP 恢复对照" },
    });
    const row = listed.items.find((item) => item.trackerId === created.trackerId);
    expect(row?.archived).toBe(false);
    expect(row?.latestRunId).toBe(started.runId);
  });
});

describe("LR-17 HTTP unknown command on the same ephemeral server", () => {
  it("returns ok:false for an unknown command and leaves cursor/records unchanged", async () => {
    const { domain, endpoint } = await startSharedHttp("off");
    const cursor = domain.store.data.cursor;
    const count = domain.store.data.records.length;
    const response = await fetch(`${endpoint}/v2/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "task.delete" as CommandName,
        projectId: PROJECT,
        input: { trackerId: "fixture-tracker-pdf" },
      }),
    });
    expect(response.ok).toBe(false);
    const body = await response.json() as { ok?: boolean; code?: string; message?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("USAGE");
    expect(body.message).toMatch(/未知命令/);
    expect(domain.store.data.cursor).toBe(cursor);
    expect(domain.store.data.records.length).toBe(count);
    expect(domain.eventsSince(PROJECT, cursor)).toHaveLength(0);
    const detail = query<TaskDetail>(domain, "task.get", { trackerId: "fixture-tracker-pdf" });
    expect(detail.record.archived).toBe(false);
    expect(detail.record.fields.title).toContain("PDF");
  });
});
