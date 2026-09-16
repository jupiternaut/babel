import { afterEach, describe, expect, it } from "vitest";
import { OpsService, SyntheticHealthServer } from "../src/ops/index.ts";
import { PROJECT, command, openDomain, query, relatedEvents, type TaskDetail, type TaskListResult } from "./helpers.ts";

const sessions: Array<{ dispose: () => void | Promise<void> }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

function openOps() {
  const opened = openDomain("off");
  const server = new SyntheticHealthServer();
  const ops = new OpsService({ domain: opened.domain, projectId: PROJECT, probeTimeoutMs: 150 });
  const handle = {
    domain: opened.domain,
    ops,
    server,
    dispose: async () => {
      await server.close();
      opened.dispose();
    },
  };
  sessions.push(handle);
  return handle;
}

describe("ops health probe (synthetic HTTP)", () => {
  it("healthy probe emits ok and does not draft or persist a repair todo", async () => {
    const { domain, ops, server } = openOps();
    await server.start();
    const cursor = 0;
    const domainCursor = domain.store.data.cursor;

    const registered = await ops.command({
      name: "ops.service.register",
      projectId: PROJECT,
      input: { serviceId: "synth-ok", label: "合成健康服务", endpoint: server.url() },
    });
    expect(registered.ok).toBe(true);
    expect(registered.mode).toBe("demo");
    expect(registered.runId).toBeNull();

    const probed = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      input: { serviceId: "synth-ok" },
      correlationId: registered.correlationId,
    });
    expect(probed.result.observation).toMatchObject({ outcome: "ok", statusCode: 200, mode: "demo" });
    expect(probed.result.draft).toBeNull();
    expect(probed.result.autoExecute).toBe(false);

    const events = ops.eventsSince(cursor);
    expect(events.map((event) => event.type)).toEqual(["ops.service.registered", "ops.health.ok"]);
    expect(events.every((event) => event.mode === "demo")).toBe(true);

    const listed = ops.query({ name: "ops.repair.drafts", projectId: PROJECT });
    expect(listed.drafts).toEqual([]);
    expect(domain.eventsSince(PROJECT, domainCursor).some((event) => event.type === "task.updated")).toBe(false);
    const tasks = query<TaskListResult>(domain, "task.list", { types: "all", q: "合成健康服务" });
    expect(tasks.items).toHaveLength(0);
  });

  it("failed probe drafts a sourced repair todo; create persists via DomainService without starting a run", async () => {
    const { domain, ops, server } = openOps();
    await server.start();
    server.setBehavior("error", 503);
    const domainCursor = domain.store.data.cursor;

    await ops.command({
      name: "ops.service.register",
      projectId: PROJECT,
      input: { serviceId: "synth-wiki", label: "合成 Wiki", endpoint: server.url() },
    });
    const probed = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      correlationId: "corr-ops-fail",
      input: { serviceId: "synth-wiki" },
    });
    expect(probed.runId).toBeNull();
    expect(probed.result.persisted).toBe(false);
    const draft = probed.result.draft as { draftId: string; todo: { title: string; description: string }; provenance: { sourceKind: string; endpoint: string; outcome: string } };
    expect(draft.todo.title).toContain("合成 Wiki");
    expect(draft.provenance.sourceKind).toBe("ops.health");
    expect(draft.provenance.outcome).toBe("http_error");
    expect(draft.todo.description).toContain(draft.provenance.endpoint);

    const opsEvents = ops.eventsSince(0).filter((event) => event.correlationId === "corr-ops-fail");
    expect(opsEvents.map((event) => event.type)).toEqual(["ops.health.failed", "ops.repair.drafted"]);

    const beforeCreate = query<TaskListResult>(domain, "task.list", { types: "all", q: "合成 Wiki" });
    expect(beforeCreate.items).toHaveLength(0);

    const created = await ops.command({
      name: "ops.repair.create",
      projectId: PROJECT,
      correlationId: "corr-ops-create",
      input: { draftId: draft.draftId },
    });
    expect(created.ok).toBe(true);
    expect(created.trackerId).toBeTruthy();
    expect(created.runId).toBeNull();

    const domainEvents = relatedEvents(domain, PROJECT, domainCursor, created.correlationId);
    expect(domainEvents.some((event) => event.type === "task.updated" && event.payload.action === "create")).toBe(true);

    const listed = query<TaskListResult>(domain, "task.list", { types: "all", q: "合成 Wiki" });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.trackerId).toBe(created.trackerId);
    expect(listed.items[0]?.latestRunId).toBeNull();

    const detail = query<TaskDetail>(domain, "task.get", { trackerId: created.trackerId });
    expect(detail.record.fields.description).toContain("ops.health");
    expect(detail.record.fields.description).toContain("synth-wiki");
    expect(detail.binding.latestRunId).toBeNull();
    expect(detail.latestRun).toBeNull();

    const runs = query<{ runs: unknown[] }>(domain, "run.list", { trackerId: created.trackerId });
    expect(runs.runs).toHaveLength(0);

    const health = ops.query({ name: "ops.health.get", projectId: PROJECT, input: { serviceId: "synth-wiki" } });
    expect(health.observation).toMatchObject({ outcome: "http_error", statusCode: 503 });
    expect(health.autoExecute).toBe(false);
    expect(health.restartAttempted).toBe(false);
    expect((health.draft as { trackerId: string | null }).trackerId).toBe(created.trackerId);

    expect(server.listening).toBe(true);
    expect(server.requestCount).toBeGreaterThanOrEqual(1);
    const stillDown = await fetch(server.url());
    expect(stillDown.status).toBe(503);
  });

  it("timeout and unreachable outcomes draft repairs but never restart the fixture", async () => {
    const { ops, server } = openOps();
    await server.start();
    server.setBehavior("hang");
    await ops.command({
      name: "ops.service.register",
      projectId: PROJECT,
      input: { serviceId: "synth-hang", label: "合成挂起", endpoint: server.url() },
    });
    const timedOut = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      input: { serviceId: "synth-hang", timeoutMs: 80 },
    });
    expect((timedOut.result.observation as { outcome: string }).outcome).toBe("timeout");
    expect(timedOut.result.draft).toBeTruthy();
    expect(server.listening).toBe(true);

    const closedPort = new URL(server.url()).port;
    await server.close();
    await ops.command({
      name: "ops.service.register",
      projectId: PROJECT,
      input: { serviceId: "synth-gone", label: "合成已关", endpoint: `http://127.0.0.1:${closedPort}/health` },
    });
    const unreachable = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      input: { serviceId: "synth-gone" },
    });
    expect((unreachable.result.observation as { outcome: string }).outcome).toBe("unreachable");
    const drafts = ops.query({ name: "ops.repair.drafts", projectId: PROJECT });
    expect((drafts.drafts as unknown[]).length).toBe(2);
  });
});
