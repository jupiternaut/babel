import { afterEach, describe, expect, it } from "vitest";
import { BabelError } from "../src/contracts.ts";
import type { GatewayIdentity } from "../src/gateway/contracts.ts";
import {
  PROJECT,
  command,
  expectCode,
  openDomain,
  query,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

const STRANGER = { id: "fault-stranger", kind: "cli" as const, projectIds: ["fixture-project-research"] };

describe("production contract: unauthorized command and stream", () => {
  it("rejects a foreign-project create and query shows no new item", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const cursor = d.store.data.cursor;
    const count = d.store.data.records.length;
    await expectCode(
      () => command(d, "task.create", { title: "越权合同创建" }, { actor: STRANGER }),
      "PERMISSION",
    );
    expect(d.eventsSince(PROJECT, cursor)).toHaveLength(0);
    expect(d.store.data.records.length).toBe(count);
    const listed = query<TaskListResult>(d, "task.list", {
      types: "all",
      includeSemantic: true,
      q: "越权合同创建",
    });
    expect(listed.items).toHaveLength(0);
  });

  it("eventsSince uses UNAUTHORIZED_STREAM; events.list uses PERMISSION", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const created = await command(d, "task.create", { title: "授权侧可见" });
    try {
      d.eventsSince(PROJECT, 0, STRANGER);
      expect.fail("cross-project stream should be unauthorized");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect((error as BabelError).code).toBe("UNAUTHORIZED_STREAM");
    }
    try {
      d.query({
        name: "events.list",
        projectId: PROJECT,
        input: { cursor: "0" },
        actor: STRANGER,
      });
      expect.fail("events.list should require project access");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect((error as BabelError).code).toBe("PERMISSION");
    }
    const listed = query<TaskListResult>(d, "task.list", { types: "all", q: "授权侧可见" });
    expect(listed.items.map((row) => row.trackerId)).toContain(created.trackerId);
  });

  it("GatewayIdentity.projectIds is the production access list, not vendor config", () => {
    const identity: GatewayIdentity = {
      actorId: "cli-1",
      kind: "cli",
      projectIds: [PROJECT],
      roles: ["operator"],
    };
    expect(identity.projectIds).toEqual([PROJECT]);
    expect(identity).not.toHaveProperty("apiKey");
    expect(["human", "cli", "tui", "gui", "hook", "system", "worker"]).toContain(identity.kind);
  });
});
