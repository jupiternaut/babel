import { afterEach, describe, expect, it } from "vitest";
import { BabelError } from "../src/contracts.ts";
import { OpsService, SyntheticHealthServer } from "../src/ops/index.ts";
import { PROJECT, openDomain, query, type TaskListResult } from "./helpers.ts";

const sessions: Array<{ dispose: () => void | Promise<void> }> = [];

afterEach(async () => {
  while (sessions.length) await sessions.pop()?.dispose();
});

describe("ops repair guards", () => {
  it("rejects restart and execute; persistRepair is idempotent and still does not start a run", async () => {
    const opened = openDomain("off");
    const server = new SyntheticHealthServer();
    const ops = new OpsService({ domain: opened.domain, projectId: PROJECT });
    sessions.push({
      dispose: async () => {
        await server.close();
        opened.dispose();
      },
    });
    await server.start();
    server.setBehavior("error", 500);
    await ops.command({
      name: "ops.service.register",
      projectId: PROJECT,
      input: { serviceId: "synth-gitlab", label: "合成 GitLab", endpoint: server.url() },
    });

    await expect(ops.command({ name: "ops.service.restart", projectId: PROJECT, input: { serviceId: "synth-gitlab" } })).rejects.toMatchObject({
      code: "PRECONDITION",
    } satisfies Partial<BabelError>);
    await expect(ops.command({ name: "ops.repair.execute", projectId: PROJECT, input: { serviceId: "synth-gitlab" } })).rejects.toMatchObject({
      code: "PRECONDITION",
    });

    const first = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      idempotencyKey: "probe-persist-1",
      input: { serviceId: "synth-gitlab", persistRepair: true },
    });
    expect(first.trackerId).toBeTruthy();
    expect(first.runId).toBeNull();
    expect(first.result.autoExecute).toBe(false);

    const second = await ops.command({
      name: "ops.health.probe",
      projectId: PROJECT,
      idempotencyKey: "probe-persist-1",
      input: { serviceId: "synth-gitlab", persistRepair: true },
    });
    expect(second.commandStatus).toBe("replayed");
    expect(second.trackerId).toBe(first.trackerId);

    const replayCreate = await ops.command({
      name: "ops.repair.create",
      projectId: PROJECT,
      input: { serviceId: "synth-gitlab" },
    });
    expect(replayCreate.trackerId).toBe(first.trackerId);

    const listed = query<TaskListResult>(opened.domain, "task.list", { types: "all", q: "合成 GitLab" });
    expect(listed.items).toHaveLength(1);
    const runs = query<{ runs: unknown[] }>(opened.domain, "run.list", { trackerId: first.trackerId });
    expect(runs.runs).toHaveLength(0);
    expect(server.listening).toBe(true);
  });

  it("refuses a non-loopback endpoint and a foreign project", async () => {
    const opened = openDomain("off");
    const ops = new OpsService({ domain: opened.domain, projectId: PROJECT });
    sessions.push({ dispose: () => opened.dispose() });
    await expect(
      ops.command({
        name: "ops.service.register",
        projectId: PROJECT,
        input: { serviceId: "remote", label: "远程", endpoint: "http://example.com/health" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      ops.command({
        name: "ops.service.register",
        projectId: "fixture-project-research",
        input: { serviceId: "other", label: "其他项目", endpoint: "http://127.0.0.1:9/health" },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION" });
    const listed = ops.query({ name: "ops.service.list", projectId: PROJECT });
    expect(listed.services).toEqual([]);
  });
});
