import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ID, runNeedsAttention, type RunStatus, type Stage } from "../src/contracts.ts";
import { type DomainService, type TaskCard } from "../src/core/domain.ts";
import { executeCli } from "../src/cli/run.ts";
import { createDemoServer } from "../src/server/http.ts";
import { command, openDomain, query } from "./helpers.ts";

type TaskList = { items: TaskCard[]; counts: Record<Stage, number> };
const PROJECT = DEFAULT_PROJECT_ID;
const sessions: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.();
});

async function attentionTask(
  domain: DomainService,
  scenario: string,
  primaryType = "task",
  projectId = PROJECT,
) {
  const created = await command(domain, "task.create", { title: `WD02 ${scenario}`, primaryType }, { projectId });
  const started = await command(domain, "run.start", { trackerId: created.trackerId }, { projectId });
  const steps = scenario === "verification_failed" || scenario === "review_required" ? 3 : 1;
  for (let step = 0; step < steps; step++) {
    await command(domain, "demo.inject", { runId: started.runId, scenario }, { projectId });
  }
  return { trackerId: created.trackerId!, runId: started.runId! };
}

async function fourAttentionTasks(domain: DomainService) {
  return Promise.all([
    attentionTask(domain, "waiting_input", "bug"),
    attentionTask(domain, "verification_failed"),
    attentionTask(domain, "lost"),
    attentionTask(domain, "review_required"),
  ]);
}

describe("WD02 authoritative attention projection", () => {
  it("recognizes exactly waiting input, failed, lost and review required", () => {
    const statuses: RunStatus[] = ["requested", "accepted", "executing", "waiting_input", "verifying", "review_required", "succeeded", "failed", "cancel_requested", "cancelled", "lost"];
    expect(statuses.filter(runNeedsAttention).sort()).toEqual(["failed", "lost", "review_required", "waiting_input"]);
  });

  it("keeps four stages, excludes archived runs, and uses the latest run event time", async () => {
    const opened = openDomain("off");
    sessions.push(opened.dispose);
    const tasks = await fourAttentionTasks(opened.domain);
    const listed = query<TaskList>(opened.domain, "task.list", { attentionOnly: true, includeArchived: true });
    expect(listed.items.map((card) => card.trackerId).sort()).toEqual(tasks.map((task) => task.trackerId).sort());
    expect(listed.counts).toEqual({ TODO: 0, RUNNING: 4, DONE: 0, ARCHIVED: 0 });
    for (const card of listed.items) {
      const lastEvent = opened.domain.store.data.events.filter((event) => event.projectId === PROJECT && event.trackerId === card.trackerId && event.runId === card.latestRunId).at(-1);
      expect(card.attention).toBe(true);
      expect(card.lastUpdatedAt).toBe(lastEvent?.occurredAt);
      expect(card.lastUpdatedAt).toBeTruthy();
    }
    const failed = tasks[1]!;
    await command(opened.domain, "task.archive", { trackerId: failed.trackerId });
    const afterArchive = query<TaskList>(opened.domain, "task.list", { attentionOnly: true, includeArchived: true });
    expect(afterArchive.items).toHaveLength(3);
    expect(afterArchive.items.some((card) => card.trackerId === failed.trackerId)).toBe(false);
    const archived = query<TaskList>(opened.domain, "task.list", { includeArchived: true }).items.find((card) => card.trackerId === failed.trackerId);
    expect(archived).toMatchObject({ stage: "ARCHIVED", attention: false });
  });

  it("intersects attention with project, type, device, search and saved view scope", async () => {
    const opened = openDomain("off");
    sessions.push(opened.dispose);
    const tasks = await fourAttentionTasks(opened.domain);
    const otherProject = "fixture-project-research";
    const other = await attentionTask(opened.domain, "waiting_input", "bug", otherProject);
    const scoped = { attentionOnly: true, types: ["bug"], deviceId: "fixture-device-ubuntu", q: "waiting_input" };
    expect(query<TaskList>(opened.domain, "task.list", scoped).items.map((card) => card.trackerId)).toEqual([tasks[0]!.trackerId]);
    expect(query<TaskList>(opened.domain, "task.list", { ...scoped, deviceId: "unselected-device" }).items).toEqual([]);
    expect(query<TaskList>(opened.domain, "task.list", { ...scoped, q: "absent" }).items).toEqual([]);
    expect(query<TaskList>(opened.domain, "task.list", scoped, { projectId: otherProject }).items.map((card) => card.trackerId)).toEqual([other.trackerId]);
    await command(opened.domain, "view.save", { viewId: "wd02-bugs", name: "待答缺陷", definition: { types: ["bug"], q: "waiting_input", deviceId: "fixture-device-ubuntu" } });
    expect(query<TaskList>(opened.domain, "task.list", { attentionOnly: true, viewId: "wd02-bugs" }).items.map((card) => card.trackerId)).toEqual([tasks[0]!.trackerId]);
  });

  it("CLI --attention-only returns the same projection and preserves existing scope flags", async () => {
    const opened = openDomain("off");
    const server = createDemoServer({ host: "127.0.0.1", port: 0, domain: opened.domain, serviceToken: "wd02-attention-token" });
    await server.listen();
    sessions.push(async () => { await server.close(); opened.dispose(); });
    const tasks = await fourAttentionTasks(opened.domain);
    const base = ["task", "list", "--project", PROJECT, "--endpoint", server.endpoint, "--json"];
    const result = await executeCli([...base, "--attention-only"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const listed = JSON.parse(result.stdout) as TaskList;
    expect(listed).toEqual(query<TaskList>(opened.domain, "task.list", { attentionOnly: true }));
    expect(listed.counts).toEqual({ TODO: 0, RUNNING: 4, DONE: 0, ARCHIVED: 0 });
    const scoped = await executeCli([...base, "--attention-only", "--types", "bug", "--device", "fixture-device-ubuntu"]);
    expect(scoped.exitCode).toBe(0);
    expect((JSON.parse(scoped.stdout) as TaskList).items.map((card) => card.trackerId)).toEqual([tasks[0]!.trackerId]);
    const all = await executeCli(base);
    expect((JSON.parse(all.stdout) as TaskList).items.length).toBeGreaterThan(4);
  });
});
