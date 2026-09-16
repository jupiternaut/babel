import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  openDomain,
  query,
  type TaskListResult,
} from "./helpers.ts";

const sessions: Array<{ dispose: () => void }> = [];

afterEach(() => {
  while (sessions.length) sessions.pop()?.dispose();
});

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

describe("LR-17 persist cost probe (not a product SLO)", () => {
  it("measures 500 in-process creates when the 20-card probe stays cheap; 10000 events stay 未测", async () => {
    const opened = openDomain("off");
    sessions.push(opened);
    const d = opened.domain;
    const rssBefore = rssMb();
    const recordCountBefore = d.store.data.records.length;
    const eventCountBefore = d.store.data.events.length;

    const probeN = 20;
    const probeStart = performance.now();
    for (let i = 0; i < probeN; i += 1) {
      const created = await command(d, "task.create", { title: `LR17 探针 ${String(i).padStart(3, "0")}` });
      expect(created.ok).toBe(true);
    }
    const probeMs = performance.now() - probeStart;
    const perCreateMs = probeMs / probeN;
    const estimate500Ms = perCreateMs * 500;

    const probeListStart = performance.now();
    const probeListed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "LR17 探针" });
    const probeListMs = performance.now() - probeListStart;
    expect(probeListed.items.length).toBe(probeN);

    const cheap = estimate500Ms <= 3500 && probeMs <= 400;
    let cards500: "measured" | "未测" = "未测";
    let create500Ms = 0;
    let list500Ms = 0;
    let events500Ms = 0;
    let eventsReturned = 0;
    let cards500Reason = `探针 ${probeN} 张 ${Math.round(probeMs)}ms（约 ${perCreateMs.toFixed(1)}ms/张），外推 500 张约 ${Math.round(estimate500Ms)}ms。超过廉价阈值，不放宽超时去跑 500。`;

    if (cheap) {
      const remainStart = performance.now();
      for (let i = probeN; i < 500; i += 1) {
        const created = await command(d, "task.create", { title: `LR17 探针 ${String(i).padStart(3, "0")}` });
        expect(created.ok).toBe(true);
      }
      create500Ms = probeMs + (performance.now() - remainStart);
      const listStart = performance.now();
      const listed = query<TaskListResult>(d, "task.list", { types: "all", includeSemantic: true, q: "LR17 探针" });
      list500Ms = performance.now() - listStart;
      expect(listed.items.length).toBe(500);
      expect(d.store.data.records.length).toBe(recordCountBefore + 500);

      const evStart = performance.now();
      const events = query<{ events: unknown[] }>(d, "events.list", { cursor: 0, limit: 200 });
      events500Ms = performance.now() - evStart;
      eventsReturned = events.events.length;
      expect(eventsReturned).toBeGreaterThan(0);
      expect(eventsReturned).toBeLessThanOrEqual(200);

      cards500 = "measured";
      cards500Reason = `FileStore 每次命令 pretty-print 落盘。探针 ${Math.round(probeMs)}ms；500 张 create ${Math.round(create500Ms)}ms，task.list ${Math.round(list500Ms * 10) / 10}ms，events.list(limit=200) ${Math.round(events500Ms * 10) / 10}ms。默认 5s 超时，未放宽。`;
    }

    const record = {
      condition: "DomainService FileStore persist() after every command; temp profile; simulate=off; default vitest 5s; no timeout bump",
      probeCards: probeN,
      probeCreateMs: Math.round(probeMs),
      perCreateMs: Math.round(perCreateMs * 10) / 10,
      probeListMs: Math.round(probeListMs * 10) / 10,
      estimate500CreateMs: Math.round(estimate500Ms),
      cards500,
      create500Ms: cards500 === "measured" ? Math.round(create500Ms) : null,
      list500Ms: cards500 === "measured" ? Math.round(list500Ms * 10) / 10 : null,
      eventsListMs: cards500 === "measured" ? Math.round(events500Ms * 10) / 10 : null,
      eventsListReturned: cards500 === "measured" ? eventsReturned : null,
      storeEventCount: d.store.data.events.length,
      eventDelta: d.store.data.events.length - eventCountBefore,
      rssBeforeMb: rssBefore,
      rssAfterMb: rssMb(),
      cards500Reason,
      events10000: "未测",
      events10000Reason: `未测 1 万条写入。当前 store 事件 ${d.store.data.events.length} 条（含 fixture）。events.list 默认 limit=200。未造假批量插入，也未放宽超时灌库。`,
    };

    expect(probeListed.mode).toBe("demo");
    expect(record.events10000).toBe("未测");
    console.log(`LR17_PERF ${JSON.stringify(record)}`);
    expect(record.probeCards, JSON.stringify(record)).toBe(20);
    if (cheap) {
      expect(cards500).toBe("measured");
      expect(create500Ms).toBeGreaterThan(0);
      expect(create500Ms).toBeLessThan(5000);
    }
  });
});
