import {
  BabelError,
  DEFAULT_ENDPOINT,
  DEFAULT_PROJECT_ID,
  type Actor,
  type BabelEvent,
  type CommandName,
  type CommandResult,
  type DeviceRecord,
  type ErrorCode,
  type ExecutionBinding,
  type Outcome,
  type ProjectRecord,
  type QueryName,
  type RunRecord,
  type RunStatus,
  type SavedView,
  type Stage,
  type TrackerActivity,
  type TrackerComment,
  type TrackerRecord,
} from "../contracts.ts";

export const GUI_ACTOR: Actor = {
  id: "demo-gui",
  kind: "gui",
  projectIds: ["fixture-project-babel", "fixture-project-research"],
};

export const GUI_DEFAULT_PROJECT = DEFAULT_PROJECT_ID;

export interface TaskCard {
  projectId: string;
  trackerId: string;
  title: string;
  description: string;
  primaryType: string;
  status: string;
  stage: Stage;
  outcome: Outcome;
  archived: boolean;
  revision: number;
  orderKey: string;
  latestRunId: string | null;
  runStatus: RunStatus | null;
  deviceId: string | null;
  attention: boolean;
  originKind?: string;
  executionEnabled: boolean;
  readOnly: boolean;
  priority?: string;
}

export interface ActionCapability {
  allowed: boolean;
  reason?: string;
  code?: string;
}

export interface TaskListResult {
  mode: "demo";
  demoLabel: string;
  cursor: number;
  counts: Record<Stage, number>;
  items: TaskCard[];
}

export interface TaskDetail {
  mode: "demo";
  demoLabel?: string;
  record: TrackerRecord;
  binding: ExecutionBinding;
  stage: Stage;
  latestRun: RunRecord | null;
  runs: RunRecord[];
  card: TaskCard;
}

export interface CapabilitiesResult {
  mode: "demo";
  protocolVersion?: string;
  disabledNote?: string;
  actions: Record<string, ActionCapability>;
  trackerId: string | null;
  runId: string | null;
}

export interface SchemaType {
  id: string;
  label: string;
  executable: boolean;
}

export interface ApiErrorBody {
  ok: false;
  code: ErrorCode | string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export function endpoint(): string {
  const raw = import.meta.env.VITE_BABEL_ENDPOINT ?? DEFAULT_ENDPOINT;
  return String(raw).replace(/\/$/, "");
}

function actorHeaders(idempotencyKey?: string): HeadersInit {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-actor-id": GUI_ACTOR.id,
    "x-actor-kind": GUI_ACTOR.kind,
    "x-actor-projects": GUI_ACTOR.projectIds.join(","),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BabelError("VALIDATION", "服务返回的不是合法 JSON", { status: res.status }, true);
  }
}

function throwIfError(parsed: unknown): void {
  if (parsed && typeof parsed === "object" && (parsed as ApiErrorBody).ok === false && (parsed as ApiErrorBody).code) {
    const body = parsed as ApiErrorBody;
    throw new BabelError(
      body.code as ErrorCode,
      body.message || "请求失败",
      body.details ?? {},
      Boolean(body.retryable),
    );
  }
}

async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const url = endpoint() + path;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: actorHeaders(idempotencyKey),
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new BabelError("UNAVAILABLE", `无法连接演示服务 ${endpoint()}`, { cause: String(error) }, true);
  }
  const parsed = await parseBody(res);
  throwIfError(parsed);
  if (!res.ok) {
    throw new BabelError("UNAVAILABLE", `演示服务返回 ${res.status}`, { status: res.status }, res.status >= 500);
  }
  return parsed as T;
}

export async function health(): Promise<Record<string, unknown>> {
  return request("GET", "/v2/health");
}

export async function command(
  name: CommandName,
  projectId: string,
  input: Record<string, unknown>,
  options: { expectedRevision?: number; idempotencyKey?: string; correlationId?: string } = {},
): Promise<CommandResult> {
  return request<CommandResult>(
    "POST",
    "/v2/command",
    {
      name,
      projectId,
      input,
      expectedRevision: options.expectedRevision,
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
      actor: GUI_ACTOR,
    },
    options.idempotencyKey,
  );
}

export async function query<T = unknown>(
  name: QueryName,
  projectId: string | undefined,
  input: Record<string, unknown> = {},
): Promise<T> {
  return request<T>("POST", "/v2/query", {
    name,
    projectId,
    input,
    actor: GUI_ACTOR,
  });
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function formatApiError(error: unknown): { code: string; message: string } {
  if (error instanceof BabelError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "UNAVAILABLE", message: error.message };
  }
  return { code: "UNAVAILABLE", message: "请求失败" };
}

export interface EventWatch {
  close: () => void;
}

export function watchEvents(
  projectId: string,
  cursor: string | undefined,
  handlers: {
    onEvent: (event: BabelEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  },
): EventWatch {
  const control = { closed: false, abort: new AbortController() };

  const run = async () => {
    const url = new URL(`${endpoint()}/v2/events`);
    url.searchParams.set("projectId", projectId);
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "x-actor-id": GUI_ACTOR.id,
          "x-actor-kind": GUI_ACTOR.kind,
          "x-actor-projects": GUI_ACTOR.projectIds.join(","),
          ...(cursor ? { "last-event-id": cursor } : {}),
        },
        signal: control.abort.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.();
        return;
      }
      handlers.onOpen?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!control.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          try {
            handlers.onEvent(JSON.parse(dataLine.slice(6)) as BabelEvent);
          } catch {
            // ignore malformed frames
          }
        }
      }
      if (!control.closed) handlers.onError?.();
    } catch {
      if (!control.closed) handlers.onError?.();
    }
  };

  void run();
  return {
    close() {
      control.closed = true;
      control.abort.abort();
    },
  };
}

export async function listTasks(
  projectId: string,
  input: Record<string, unknown>,
): Promise<TaskListResult> {
  return query<TaskListResult>("task.list", projectId, input);
}

export async function listReady(projectId: string): Promise<{ mode: "demo"; items: TaskCard[] }> {
  return query("ready.list", projectId, {});
}

export async function getTask(projectId: string, trackerId: string): Promise<TaskDetail> {
  return query<TaskDetail>("task.get", projectId, { trackerId });
}

export async function getCapabilities(
  projectId: string,
  input: { trackerId?: string; runId?: string },
): Promise<CapabilitiesResult> {
  return query<CapabilitiesResult>("capabilities.get", projectId, input);
}

export async function listProjects(): Promise<{ mode: "demo"; projects: ProjectRecord[] }> {
  return query("project.list", undefined, {});
}

export async function listDevices(projectId: string): Promise<{ mode: "demo"; devices: Array<DeviceRecord & { demo?: true }> }> {
  return query("device.list", projectId, {});
}

export async function listViews(projectId: string): Promise<{ mode: "demo"; views: SavedView[] }> {
  return query("view.list", projectId, {});
}

export async function listSchemaTypes(): Promise<{ mode: "demo"; types: SchemaType[]; views?: SavedView[] }> {
  return query("schema.types", undefined, {});
}

export async function showRun(projectId: string, runId: string): Promise<{ mode: "demo"; run: RunRecord; artifacts?: unknown[] }> {
  return query("run.show", projectId, { runId });
}

export async function getDiff(projectId: string, runId: string): Promise<{ mode: "demo"; runId: string; diff: RunRecord["diff"] }> {
  return query("diff.get", projectId, { runId });
}

export async function getHistory(
  projectId: string,
  trackerId: string,
): Promise<{
  mode: "demo";
  trackerId: string;
  comments: NonNullable<TrackerRecord["system"]["comments"]>;
  activity: NonNullable<TrackerRecord["system"]["activity"]>;
  runs: RunRecord[];
}> {
  return query("history.get", projectId, { trackerId });
}

export type {
  BabelEvent,
  CommandName,
  CommandResult,
  DeviceRecord,
  ProjectRecord,
  RunRecord,
  SavedView,
  Stage,
  TrackerActivity,
  TrackerComment,
  TrackerRecord,
};
