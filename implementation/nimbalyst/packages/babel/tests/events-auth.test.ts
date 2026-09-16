import { afterEach, describe, expect, it } from "vitest";
import { BabelError } from "../src/contracts.ts";
import type { DomainService } from "../src/core/domain.ts";
import { PROJECT, command, openDomain, query } from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

function domain(): DomainService {
  const opened = openDomain("off");
  sessions.push(opened);
  return opened.domain;
}

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

describe("CAP-17/19 event stream auth and cursor", () => {
  it("rejects eventsSince when actor cannot access the project", () => {
    const d = domain();
    try {
      d.eventsSince(PROJECT, 0, { id: "stranger", kind: "cli", projectIds: ["fixture-project-research"] });
      expect.fail("cross-project stream should be unauthorized");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect((error as BabelError).code).toBe("UNAUTHORIZED_STREAM");
    }
  });

  it("rejects events.list query with PERMISSION for a foreign project actor", () => {
    const d = domain();
    try {
      d.query({
        name: "events.list",
        projectId: PROJECT,
        input: { cursor: "0" },
        actor: { id: "stranger", kind: "cli", projectIds: ["fixture-project-research"] },
      });
      expect.fail("events.list should require project access");
    } catch (error) {
      expect(error).toBeInstanceOf(BabelError);
      expect((error as BabelError).code).toBe("PERMISSION");
    }
  });

  it("resumes from cursor and keeps mode=demo", async () => {
    const d = domain();
    const first = await command(d, "task.create", { title: "游标前" });
    const cursor = d.store.data.cursor;
    const second = await command(d, "task.create", { title: "游标后" });
    const resumed = d.eventsSince(PROJECT, cursor);
    expect(resumed.every((event) => event.mode === "demo")).toBe(true);
    expect(resumed.some((event) => event.correlationId === first.correlationId)).toBe(false);
    expect(resumed.some((event) => event.correlationId === second.correlationId)).toBe(true);
    const listed = query<{ mode: string; events: Array<{ eventId: string; mode: string }> }>(d, "events.list", {
      cursor: String(cursor),
    });
    expect(listed.mode).toBe("demo");
    expect(listed.events.every((event) => event.mode === "demo")).toBe(true);
  });

  it("does not leak research-project events into babel stream", async () => {
    const d = domain();
    const cursor = d.store.data.cursor;
    await command(d, "task.create", { title: "研究侧创建" }, {
      projectId: "fixture-project-research",
      actor: { id: "demo-operator", kind: "cli", projectIds: [PROJECT, "fixture-project-research"] },
    });
    const babelEvents = d.eventsSince(PROJECT, cursor);
    expect(babelEvents.every((event) => !event.projectId || event.projectId === PROJECT)).toBe(true);
  });
});

describe("CAP-18 disconnect inject is snapshot-only", () => {
  it("emits device.snapshot and does not stop an existing run", async () => {
    const d = domain();
    const started = await command(d, "run.start", { trackerId: "fixture-tracker-pdf" });
    const cursor = d.store.data.cursor;
    const injected = await command(d, "demo.inject", {
      scenario: "disconnect",
      trackerId: "fixture-tracker-pdf",
      runId: started.runId,
    });
    expect(injected.ok).toBe(true);
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.some((event) => event.type === "device.snapshot" && event.payload.injected === "disconnect")).toBe(true);
    const shown = query<{ run: { status: string } }>(d, "run.show", { runId: started.runId });
    expect(shown.run.status).not.toBe("cancelled");
  });
});
