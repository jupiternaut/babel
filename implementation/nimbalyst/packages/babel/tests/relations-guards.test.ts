import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { command, openDomain, PROJECT, query, type TaskDetail } from "./helpers.ts";
const sessions: ReturnType<typeof openDomain>[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
});
async function setup() {
  const s = openDomain("off");
  sessions.push(s);
  const ids: string[] = [];
  for (const title of ["甲任务", "乙任务", "丙任务"])
    ids.push((await command(s.domain, "task.create", { title })).trackerId!);
  const read = (id: string) => query<TaskDetail>(s.domain, "task.get", { trackerId: id });
  const set = (
    id: string,
    input: Record<string, unknown>,
    revision = s.domain.store.data.records.find((row) => row.id === id)!.revision
  ) => command(s.domain, "relation.set", { trackerId: id, ...input }, { expectedRevision: revision });
  return { ...s, ids, read, set };
}
describe("atomic revisioned bidirectional dependencies", () => {
  it("updates both endpoints and streams, removes reverse edges, and keeps no-op revision stable", async () => {
    const {
      domain: d,
      ids: [a, b, c],
      read,
      set,
    } = await setup();
    const cursor = d.store.data.cursor;
    const saved = await set(a, { dependsOn: [b, b], blocks: [c] });
    expect(read(a).record.fields).toMatchObject({ dependsOn: [b], blocks: [c] });
    expect(read(b).record.fields.blocks).toEqual([a]);
    expect(read(c).record.fields.dependsOn).toEqual([a]);
    expect(saved.result.changedTrackerIds).toEqual(expect.arrayContaining([a, b, c]));
    for (const id of [a, b, c]) {
      expect(read(id).record.revision).toBe(2);
      expect(d.store.data.bindings.find((r) => r.trackerId === id)?.revision).toBe(2);
    }
    const events = d.eventsSince(PROJECT, cursor);
    expect(events.map((e) => e.trackerId).sort()).toEqual([a, b, c].sort());
    expect(events.every((e) => e.revision === 2 && e.correlationId === saved.correlationId)).toBe(true);
    const before = JSON.stringify(d.store.data);
    expect((await set(a, { dependsOn: [b], blocks: [c] })).result.changedTrackerIds).toEqual([]);
    expect(JSON.stringify(d.store.data)).toBe(before);
    await set(a, { blocks: [] });
    expect(read(c).record.fields.dependsOn).toEqual([]);
    expect(read(c).record.revision).toBe(3);
    expect(read(b).record.revision).toBe(2);
    await set(b, { blocks: [] });
    expect(read(a).record.fields.dependsOn).toEqual([]);
    expect(read(a).record.revision).toBe(4);
  });
  it("rejects stale reverse-endpoint writes and replays without duplicate events", async () => {
    const {
      domain: d,
      ids: [a, b],
      read,
      set,
    } = await setup();
    const result = await command(
      d,
      "relation.set",
      { trackerId: a, dependsOn: [b] },
      { expectedRevision: 1, idempotencyKey: "relation-once" }
    );
    const before = JSON.stringify(d.store.data);
    await expect(set(b, { blocks: [] }, 1)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const replay = await command(
      d,
      "relation.set",
      { trackerId: a, dependsOn: [b] },
      { expectedRevision: 1, idempotencyKey: "relation-once" }
    );
    expect(replay.commandStatus).toBe("replayed");
    expect(replay.correlationId).toBe(result.correlationId);
    expect(JSON.stringify(d.store.data)).toBe(before);
    expect(read(b).record.fields.blocks).toEqual([a]);
  });
  it("rejects cycles, self, missing and cross-project edges without partial memory/disk/events writes", async () => {
    const {
      domain: d,
      ids: [a, b, c],
      set,
    } = await setup();
    await set(a, { dependsOn: [b] });
    await set(b, { dependsOn: [c] });
    const foreign = d.store.data.records.find((r) => r.projectId !== PROJECT)!;
    // Legacy records may not yet have execution bindings; refusals must not create them.
    d.store.data.bindings = d.store.data.bindings.filter((r) => r.trackerId !== c);
    d.store.persist();
    for (const [id, patch, code] of [
      [c, { dependsOn: [a] }, "VALIDATION"],
      [a, { blocks: [b] }, "VALIDATION"],
      [a, { dependsOn: [a] }, "VALIDATION"],
      [a, { blocks: ["absent"] }, "NOT_FOUND"],
      [a, { dependsOn: [foreign.id] }, "NOT_FOUND"],
    ] as const) {
      const before = JSON.stringify(d.store.data),
        disk = readFileSync(d.store.file, "utf8");
      await expect(set(id, patch)).rejects.toMatchObject({ code });
      expect(JSON.stringify(d.store.data)).toBe(before);
      expect(readFileSync(d.store.file, "utf8")).toBe(disk);
    }
    await set(b, { dependsOn: [] });
    await set(c, { dependsOn: [a] });
  });
  it("protects readonly source and reverse additions/removals atomically", async () => {
    const {
      domain: d,
      ids: [a, b],
      set,
    } = await setup();
    await set(a, { blocks: [b] });
    d.store.data.records.find((r) => r.id === b)!.system.readOnly = true;
    d.store.persist();
    for (const [id, patch] of [
      [a, { blocks: [] }],
      [a, { dependsOn: [b] }],
      [b, { dependsOn: [] }],
    ] as const) {
      const before = JSON.stringify(d.store.data);
      await expect(set(id, patch)).rejects.toMatchObject({ code: "READ_ONLY" });
      expect(JSON.stringify(d.store.data)).toBe(before);
    }
  });
  it("requires positive integer revision and text-ID arrays", async () => {
    const {
      domain: d,
      ids: [a],
      read,
    } = await setup();
    for (const [patch, revision] of [
      [{ dependsOn: [] }, undefined],
      [{ blocks: [] }, 0],
      [{ blocks: [] }, 1.5],
      [{}, 1],
      [{ dependsOn: null }, 1],
      [{ blocks: "bad" }, 1],
      [{ dependsOn: [7] }, 1],
      [{ blocks: [""] }, 1],
    ] as const) {
      const before = JSON.stringify(d.store.data);
      await expect(
        command(d, "relation.set", { trackerId: a, ...patch }, { expectedRevision: revision })
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(JSON.stringify(d.store.data)).toBe(before);
    }
    expect(read(a).record.revision).toBe(1);
  });
});

it("rejects relation injection through creation or ordinary updates without creating partial records", async () => {
  const { domain: d, ids: [a, b] } = await setup();
  for (const input of [{ dependsOn: [b] }, { blocks: [b] }, { fields: { dependsOn: [b] } }, { fields: { blocks: [b] } }]) {
    for (const name of ["task.create", "task.update"] as const) {
      const before = JSON.stringify(d.store.data);
      await expect(command(d, name, { title: "旁路尝试", trackerId: a, ...input }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
      expect(JSON.stringify(d.store.data)).toBe(before);
    }
  }
});
