import { appendFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EventRecord, WorkerEvent } from "../gateway/contracts.ts";
import type { GatewaySqliteStore } from "../gateway/sqlite-store.ts";
import { assertIsolatedPath } from "./paths.ts";

export function streamIdForRun(runId: string): string {
  return `worker:${runId}`;
}

export function persistWorkerEvent(
  store: GatewaySqliteStore,
  event: WorkerEvent,
  meta: { projectId: string; trackerId: string; correlationId?: string },
): EventRecord {
  const record = store.appendEvent({
    eventId: `wevt-${randomUUID()}`,
    projectId: meta.projectId,
    trackerId: meta.trackerId,
    runId: event.runId,
    type: `worker.${event.kind}`,
    streamId: streamIdForRun(event.runId),
    payloadJson: JSON.stringify(event),
    occurredAt: event.at,
    correlationId: meta.correlationId ?? null,
  });
  return record;
}

export function appendWorktreeJournal(worktree: string, event: WorkerEvent): void {
  const file = path.join(assertIsolatedPath(worktree, "worktree"), "execution-journal.jsonl");
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

export function eventsFromStore(store: GatewaySqliteStore, runId: string, cursor = 0): {
  records: EventRecord[];
  events: WorkerEvent[];
} {
  const records = store.listEventsSince(cursor).filter((row) => row.runId === runId && row.streamId === streamIdForRun(runId));
  return {
    records,
    events: records.map((row) => JSON.parse(row.payloadJson) as WorkerEvent),
  };
}
