import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DomainService, type SimulateMode } from "../src/core/domain.ts";
import {
  BabelError,
  DEFAULT_PROJECT_ID,
  SERVICE_ACTOR,
  type Actor,
  type BabelEvent,
  type CommandName,
  type CommandRequest,
  type ErrorCode,
} from "../src/contracts.ts";

export const PROJECT = DEFAULT_PROJECT_ID;

export const EXAMPLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/hooks-examples",
);

export const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

export function surfacePath(...parts: string[]): string {
  return path.join(SRC_ROOT, ...parts);
}

export function surfaceExists(...parts: string[]): boolean {
  return existsSync(surfacePath(...parts));
}

export function openDomain(simulate: SimulateMode = "off"): {
  domain: DomainService;
  profileDir: string;
  dispose: () => void;
} {
  const profileDir = mkdtempSync(path.join(tmpdir(), "babel-m0-"));
  const domain = new DomainService({ profileDir, simulate });
  return {
    domain,
    profileDir,
    dispose() {
      domain.dispose();
      rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

export function writeProfileHook(
  profileDir: string,
  fileName: string,
  hook: Record<string, unknown>,
): void {
  const dir = path.join(profileDir, "hooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), `${JSON.stringify(hook, null, 2)}\n`, "utf8");
}

export function hookInput(partial: {
  hookId: string;
  phase: "beforeCommand" | "observe";
  script: string;
  commands?: CommandName[];
  timeoutMs?: number;
  required?: boolean;
}): Record<string, unknown> {
  return {
    hookId: partial.hookId,
    phase: partial.phase,
    commands: partial.commands,
    executable: "node",
    argv: [path.join(EXAMPLES_DIR, partial.script)],
    cwd: EXAMPLES_DIR,
    timeoutMs: partial.timeoutMs ?? 2000,
    required: partial.required ?? true,
    envAllow: [],
  };
}

export async function expectCode(fn: () => Promise<unknown>, code: ErrorCode): Promise<BabelError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof BabelError && error.code === code) return error;
    throw error;
  }
  throw new Error(`expected ${code} but the command succeeded`);
}

export function relatedEvents(
  domain: DomainService,
  projectId: string,
  cursor: number | string,
  correlationId: string,
  actor?: Actor,
): BabelEvent[] {
  return domain.eventsSince(projectId, cursor, actor).filter((event) => event.correlationId === correlationId);
}

export async function waitOutboxAttempted(domain: DomainService, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = domain.store.data.outbox;
    if (rows.length > 0 && rows.every((row) => row.attempts > 0 || row.status !== "pending")) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("outbox deliveries were not attempted in time");
}

export async function command(
  domain: DomainService,
  name: CommandName,
  input: Record<string, unknown>,
  extra: Partial<CommandRequest> = {},
) {
  return domain.command({
    name,
    projectId: extra.projectId ?? PROJECT,
    input,
    expectedRevision: extra.expectedRevision,
    idempotencyKey: extra.idempotencyKey,
    correlationId: extra.correlationId,
    actor: extra.actor ?? (name === "hook.register" ? SERVICE_ACTOR : undefined),
  });
}

export function query<T>(
  domain: DomainService,
  name: CommandRequest["name"] | Parameters<DomainService["query"]>[0]["name"],
  input: Record<string, unknown> = {},
  extra: { projectId?: string; actor?: Actor } = {},
): T {
  return domain.query({
    name: name as Parameters<DomainService["query"]>[0]["name"],
    projectId: extra.projectId ?? PROJECT,
    input,
    actor: extra.actor,
  }) as T;
}

export type TaskListResult = {
  mode: string;
  demoLabel?: string;
  items: Array<{
    trackerId: string;
    title: string;
    stage: string;
    status: string;
    primaryType: string;
    archived: boolean;
    revision: number;
    latestRunId: string | null;
  }>;
  counts: Record<string, number>;
};

export type TaskDetail = {
  mode: string;
  record: {
    id: string;
    projectId?: string;
    revision: number;
    archived: boolean;
    primaryType: string;
    fields: { title: string; status: string; description: string; dependsOn: string[]; blocks: string[] };
  };
  binding: { trackerId?: string; latestRunId: string | null; outcome: string; executionEnabled: boolean };
  stage: string;
  latestRun: { id: string; status: string } | null;
  runs: Array<{ id: string; status: string }>;
  card: { stage: string };
};

export type RunShow = {
  mode: string;
  run: {
    id: string;
    status: string;
    taskId: string;
    messages: unknown[];
    verification: Array<{ state: string; required: boolean }>;
    diff: { files: Array<{ path: string }> } | null;
  };
};

export type HookList = {
  mode: string;
  hooks: Array<{ hookId: string; phase: string }>;
  outbox: Array<{
    deliveryId: string;
    eventId: string;
    hookId: string;
    attempts: number;
    status: string;
    lastError?: string;
  }>;
  deliveries: Array<{ deliveryId: string; hookId?: string; ok: boolean; error?: string }>;
};
