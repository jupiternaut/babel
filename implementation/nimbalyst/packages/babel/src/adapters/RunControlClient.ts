import type { CommandResult } from "../contracts.ts";
import { BabelHttpClient } from "./client.ts";

export interface StartRunInput {
  projectId: string;
  trackerId: string;
  deviceId?: string;
  providerId?: string;
  summary?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
}

/** Execution commands. Creating a session is not a start. */
export class RunControlClient {
  constructor(private readonly client: BabelHttpClient) {}

  start(input: StartRunInput): Promise<CommandResult> {
    return this.client.command({
      name: "run.start",
      projectId: input.projectId,
      input: {
        trackerId: input.trackerId,
        deviceId: input.deviceId,
        providerId: input.providerId,
        summary: input.summary,
      },
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    });
  }

  message(projectId: string, runId: string, text: string, clientMessageId?: string): Promise<CommandResult> {
    return this.client.command({
      name: "run.message",
      projectId,
      input: { runId, text, clientMessageId },
    });
  }

  respond(projectId: string, runId: string, requestId: string, text: string): Promise<CommandResult> {
    return this.client.command({
      name: "run.respond",
      projectId,
      input: { runId, requestId, text },
    });
  }

  cancel(projectId: string, runId: string, hold = false): Promise<CommandResult> {
    return this.client.command({
      name: "run.cancel",
      projectId,
      input: { runId, hold },
    });
  }

  reconcile(projectId: string, runId: string, resolution: "cancelled" | "failed" = "cancelled"): Promise<CommandResult> {
    return this.client.command({
      name: "run.reconcile",
      projectId,
      input: { runId, resolution },
    });
  }

  retry(projectId: string, trackerId: string, runId?: string, idempotencyKey?: string): Promise<CommandResult> {
    return this.client.command({
      name: "run.retry",
      projectId,
      input: { trackerId, runId },
      idempotencyKey,
    });
  }

  accept(projectId: string, runId: string, expectedRevision?: number): Promise<CommandResult> {
    return this.client.command({
      name: "review.accept",
      projectId,
      input: { runId },
      expectedRevision,
    });
  }

  requestChanges(projectId: string, runId: string, comment?: string): Promise<CommandResult> {
    return this.client.command({
      name: "review.request_changes",
      projectId,
      input: { runId, comment },
    });
  }
}
