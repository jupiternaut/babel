import { randomUUID } from "node:crypto";
import type { WorkerEvent, WorkerLease } from "./contracts.ts";
import type { GatewaySqliteStore } from "./sqlite-store.ts";

/** Protocol-level stand-in. Not a real Pi and must not be labeled as one. */
export class ProtocolDoubleWorker {
  readonly workerId: string;
  readonly protocol = "protocol-double" as const;
  private readonly events: WorkerEvent[] = [];

  constructor(workerId = `double-${randomUUID()}`) {
    this.workerId = workerId;
  }

  start(store: GatewaySqliteStore, input: Omit<WorkerLease, "leaseId" | "workerId" | "protocol" | "startedAt">): WorkerLease {
    const lease = store.acquireLease({
      ...input,
      leaseId: `lease-${randomUUID()}`,
      workerId: this.workerId,
      protocol: this.protocol,
      startedAt: new Date().toISOString(),
    });
    this.events.push({
      kind: "log",
      runId: lease.runId,
      at: lease.startedAt,
      payload: { message: "protocol-double accepted; not a real Pi" },
    });
    return lease;
  }

  reconnect(store: GatewaySqliteStore, lease: WorkerLease): WorkerLease {
    try {
      return this.start(store, lease);
    } catch (error) {
      if (error instanceof Error && error.name === "RUN_ACTIVE") {
        this.events.push({
          kind: "log",
          runId: lease.runId,
          at: new Date().toISOString(),
          payload: { message: "reconnect reused existing lease; did not start a second execution" },
        });
        return lease;
      }
      throw error;
    }
  }

  cancel(store: GatewaySqliteStore, runId: string): WorkerEvent {
    const at = new Date().toISOString();
    store.releaseLease(runId, at);
    const event: WorkerEvent = { kind: "cancel_ack", runId, at, payload: { confirmed: true } };
    this.events.push(event);
    return event;
  }

  listEvents(runId: string): WorkerEvent[] {
    return this.events.filter((event) => event.runId === runId);
  }
}
