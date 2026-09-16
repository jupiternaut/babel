import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ACTIVE_RUN,
  BabelError,
  DEMO_ACTOR,
  DEFAULT_PROJECT_ID,
  NATIVE_TYPES,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  TERMINAL_RUN,
  categoryOfStatus,
  deriveStage,
  isExecutableType,
  runNeedsAttention,
  type Actor,
  type BabelEvent,
  type CommandName,
  type CommandRequest,
  type CommandResult,
  type CompletionPolicy,
  type DeviceRecord,
  type ExecutionBinding,
  type HookConfig,
  type Outcome,
  type QueryName,
  type QueryRequest,
  type RunRecord,
  type RunStatus,
  type SavedView,
  type Stage,
  type TrackerRecord,
} from "../contracts.ts";
import { buildDemoSnapshot, loadDesignFixtures, SEMANTIC_DEMO_TRACKER_IDS, type DesignFixtures } from "./fixtures.ts";
import { matchesCommand, runBeforeHook, runObserveHook } from "./hooks.ts";
import { hashPayload, nextOrderKey, uid } from "./ids.ts";
import { FileStore, type OutboxItem, type Snapshot } from "./store.ts";

export type SimulateMode = "async" | "sync" | "off";

export interface DomainOptions {
  profileDir: string;
  fixturesPath?: string;
  workdir?: string;
  simulate?: SimulateMode;
  stepMs?: number;
  now?: () => string;
}

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
  lastUpdatedAt: string | null;
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

const FORBIDDEN_FIELD_KEYS = new Set(["stage", "outcome", "run.status", "runStatus"]);

const HTTP_OK_COMMANDS: CommandName[] = [
  "task.create",
  "task.update",
  "task.reorder",
  "task.archive",
  "task.restore",
  "run.start",
  "run.message",
  "run.respond",
  "run.cancel",
  "run.reconcile",
  "run.retry",
  "review.accept",
  "review.request_changes",
  "comment.add",
  "relation.set",
  "view.save",
  "demo.reset",
  "demo.inject",
  "hook.register",
  "hook.retry_delivery",
];

export class DomainService {
  readonly store: FileStore;
  readonly profileDir: string;
  readonly fixtures: DesignFixtures;
  readonly workdir: string;
  readonly simulate: SimulateMode;
  readonly stepMs: number;
  private readonly nowFn?: () => string;
  private readonly listeners = new Set<(event: BabelEvent) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly inflight = new Map<string, { hash: string; promise: Promise<CommandResult> }>();
  private pumping = false;
  private disposed = false;

  constructor(options: DomainOptions) {
    this.profileDir = options.profileDir;
    this.workdir = options.workdir ?? path.join(options.profileDir, "workspaces", "babel");
    this.fixtures = loadDesignFixtures(options.fixturesPath);
    this.simulate = options.simulate ?? (process.env.BABEL_SIMULATE as SimulateMode) ?? "async";
    this.stepMs = options.stepMs ?? 280;
    this.nowFn = options.now;
    this.store = new FileStore(options.profileDir);
    if (this.store.data.records.length === 0) {
      this.replaceSnapshot(buildDemoSnapshot(this.fixtures, this.workdir));
    } else {
      this.migrateSemanticSceneFlags();
    }
    this.ingestProfileHooks();
    this.resumeSimulations();
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  onEvent(listener: (event: BabelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  eventsSince(projectId: string | null, cursor: string | number | undefined, actor?: Actor): BabelEvent[] {
    this.assertProjectAccess(projectId, actor, true);
    const after = Number(cursor ?? 0);
    return this.store.data.events.filter((event) => {
      if (event.cursor && Number(event.cursor) <= after) return false;
      if (projectId && event.projectId && event.projectId !== projectId) return false;
      return true;
    });
  }

  async command(request: CommandRequest): Promise<CommandResult> {
    this.assertActive();
    const actor = normalizeActor(request.actor);
    if (!HTTP_OK_COMMANDS.includes(request.name)) {
      throw new BabelError("USAGE", `未知命令：${String(request.name)}`);
    }
    this.assertProjectAccess(request.projectId, actor, false);
    if (!request.idempotencyKey) {
      return this.executeAuthorizedCommand(request, actor);
    }
    const key = idemKey(actor, request);
    const hash = hashPayload(request.input);
    const replayed = this.replayIdempotency(request, actor);
    if (replayed) return replayed;
    const pending = this.inflight.get(key);
    if (pending) {
      if (pending.hash !== hash) {
        throw new BabelError("IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同负载", {
          idempotencyKey: request.idempotencyKey,
        });
      }
      return pending.promise;
    }
    const promise = this.executeAuthorizedCommand(request, actor);
    this.inflight.set(key, { hash, promise });
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async executeAuthorizedCommand(request: CommandRequest, actor: Actor): Promise<CommandResult> {
    const hooks = this.store.data.hookConfigs.filter((hook) => hook.phase === "beforeCommand" && matchesCommand(hook, request.name));
    for (const hook of hooks) {
      const verdict = await runBeforeHook(hook, request);
      this.assertActive();
      if (verdict.timedOut) {
        throw new BabelError("HOOK_TIMEOUT", verdict.reason ?? "必需校验超时", { hookId: hook.hookId });
      }
      if (!verdict.allow) {
        throw new BabelError("HOOK_DENIED", verdict.reason ?? "Hook 拒绝提交", { hookId: hook.hookId });
      }
    }

    const result = this.store.transaction((data) => {
      if (request.idempotencyKey) {
        const key = idemKey(actor, request);
        const row = data.idempotency.find((item) => item.key === key);
        const hash = hashPayload(request.input);
        if (row) {
          if (row.payloadHash !== hash) {
            throw new BabelError("IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同负载", {
              idempotencyKey: request.idempotencyKey,
            });
          }
          return JSON.parse(row.resultJson) as CommandResult;
        }
      }
      const dispatched = this.dispatchCommand(data, request, actor);
      if (request.idempotencyKey) {
        data.idempotency.push({
          key: idemKey(actor, request),
          actorId: actor.id,
          projectId: request.projectId,
          command: request.name,
          payloadHash: hashPayload(request.input),
          resultJson: JSON.stringify({ ...dispatched, commandStatus: "replayed" }),
        });
      }
      return dispatched;
    });
    void this.pumpOutbox();
    if (request.name === "run.start" || request.name === "run.retry") {
      const runId = result.runId;
      if (runId) this.scheduleSimulation(runId, "default");
    }
    return result;
  }

  query(request: QueryRequest): unknown {
    const actor = normalizeActor(request.actor);
    const projectId = request.projectId;
    if (request.name !== "project.list" && request.name !== "schema.types" && request.name !== "capabilities.get") {
      this.assertProjectAccess(projectId, actor, false);
    } else if (projectId) {
      this.assertProjectAccess(projectId, actor, false);
    }
    return this.dispatchQuery(this.store.data, request, actor);
  }

  snapshot(projectId?: string, actor?: Actor): Snapshot {
    this.assertProjectAccess(projectId ?? DEFAULT_PROJECT_ID, actor, false);
    const data = this.store.data;
    if (!projectId) return data;
    return {
      ...data,
      records: data.records.filter((row) => row.projectId === projectId),
      bindings: data.bindings.filter((row) => row.projectId === projectId),
      runs: data.runs.filter((row) => row.projectId === projectId),
      events: data.events.filter((row) => !row.projectId || row.projectId === projectId),
    };
  }

  health(): Record<string, unknown> {
    return {
      ok: true,
      mode: "demo",
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: SCHEMA_VERSION,
      demoLabel: this.fixtures.demoLabel,
      clock: this.store.data.clock,
      cursor: this.store.data.cursor,
    };
  }

  /** Test / inject helper: advance one simulated run step immediately. */
  advanceRun(runId: string, scenario: InjectScenario = "default"): void {
    this.assertActive();
    this.store.transaction((data) => this.simulateOnce(data, runId, scenario));
    void this.pumpOutbox();
  }

  private replaceSnapshot(next: Snapshot): void {
    this.store.data = next;
    this.store.persist();
  }

  private ingestProfileHooks(): void {
    const dir = path.join(this.profileDir, "hooks");
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((name) => name.endsWith(".hook.json"));
    this.store.transaction((data) => {
      for (const file of files) {
        try {
          const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as HookConfig;
          if (!parsed.hookId) continue;
          const existing = data.hookConfigs.findIndex((row) => row.hookId === parsed.hookId);
          const row: HookConfig = {
            ...parsed,
            cwd: parsed.cwd || dir,
            argv: parsed.argv ?? [],
            timeoutMs: parsed.timeoutMs ?? 2000,
            required: parsed.required !== false,
            envAllow: parsed.envAllow ?? [],
          };
          if (existing >= 0) data.hookConfigs[existing] = row;
          else data.hookConfigs.push(row);
        } catch {
          // ignore malformed profile hooks; tests register via command
        }
      }
    });
  }

  private resumeSimulations(): void {
    if (this.simulate === "off") return;
    const accepted = new Map(this.store.data.events
      .filter((event) => event.type === "run.accepted" && event.runId)
      .map((event) => [event.runId, event]));
    for (const run of this.store.data.runs) {
      // The accepted event and progress are persisted with the run. Presentation
      // fixtures have no accepted event and must not start moving on reload.
      const event = accepted.get(run.id);
      if (event?.projectId === run.projectId && event.trackerId === run.taskId
        && (run.status === "accepted" || run.status === "executing" || run.status === "verifying")) {
        this.scheduleSimulation(run.id, "default");
      }
    }
  }

  private replayIdempotency(request: CommandRequest, actor: Actor): CommandResult | null {
    if (!request.idempotencyKey) return null;
    const key = idemKey(actor, request);
    const row = this.store.data.idempotency.find((item) => item.key === key);
    if (!row) return null;
    const hash = hashPayload(request.input);
    if (row.payloadHash !== hash) {
      throw new BabelError("IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同负载", {
        idempotencyKey: request.idempotencyKey,
      });
    }
    return JSON.parse(row.resultJson) as CommandResult;
  }

  private assertProjectAccess(projectId: string | null | undefined, actor: Actor | undefined, stream: boolean): void {
    if (!projectId) {
      if (stream) throw new BabelError("UNAUTHORIZED_STREAM", "事件流必须指定 projectId");
      throw new BabelError("USAGE", "缺少 projectId");
    }
    const who = normalizeActor(actor);
    if (!who.projectIds.includes(projectId)) {
      throw new BabelError(stream ? "UNAUTHORIZED_STREAM" : "PERMISSION", "无权访问该项目", { projectId });
    }
  }

  private dispatchCommand(data: Snapshot, request: CommandRequest, actor: Actor): CommandResult {
    const correlationId = request.correlationId ?? uid("corr");
    const ctx: CmdCtx = { data, request, actor, correlationId };
    switch (request.name) {
      case "task.create":
        return this.cmdCreate(ctx);
      case "task.update":
        return this.cmdUpdate(ctx);
      case "task.reorder":
        return this.cmdReorder(ctx);
      case "task.archive":
        return this.cmdArchive(ctx);
      case "task.restore":
        return this.cmdRestore(ctx);
      case "run.start":
        return this.cmdStart(ctx);
      case "run.message":
        return this.cmdMessage(ctx);
      case "run.respond":
        return this.cmdRespond(ctx);
      case "run.cancel":
        return this.cmdCancel(ctx);
      case "run.reconcile":
        return this.cmdReconcile(ctx);
      case "run.retry":
        return this.cmdRetry(ctx);
      case "review.accept":
        return this.cmdReviewAccept(ctx);
      case "review.request_changes":
        return this.cmdReviewChanges(ctx);
      case "comment.add":
        return this.cmdComment(ctx);
      case "relation.set":
        return this.cmdRelation(ctx);
      case "view.save":
        return this.cmdViewSave(ctx);
      case "demo.reset":
        return this.cmdReset(ctx);
      case "demo.inject":
        return this.cmdInject(ctx);
      case "hook.register":
        return this.cmdHookRegister(ctx);
      case "hook.retry_delivery":
        return this.cmdHookRetry(ctx);
      default:
        throw new BabelError("USAGE", `未实现命令：${request.name}`);
    }
  }

  private dispatchQuery(data: Snapshot, request: QueryRequest, actor: Actor): unknown {
    const input = request.input ?? {};
    const projectId = request.projectId ?? DEFAULT_PROJECT_ID;
    switch (request.name as QueryName) {
      case "project.list":
        return { mode: "demo", projects: data.projects.filter((row) => actor.projectIds.includes(row.id)) };
      case "schema.types":
        return {
          mode: "demo",
          types: NATIVE_TYPES.map((id) => ({ id, label: typeLabel(id), executable: isExecutableType(id) })),
          statusScopes: ["open", "closed", "all"],
          views: data.views,
        };
      case "device.list":
        return { mode: "demo", devices: data.devices.map(annotateDevice) };
      case "view.list":
        return { mode: "demo", views: data.views };
      case "hook.list":
        return {
          mode: "demo",
          hooks: data.hookConfigs,
          outbox: data.outbox,
          deliveries: data.hookDeliveries,
        };
      case "capabilities.get":
        return this.queryCapabilities(data, projectId, input);
      case "task.get": {
        const trackerId = str(input.trackerId ?? input.id);
        const found = this.requireRecord(data, projectId, trackerId);
        return this.detailOf(data, found.record, found.binding);
      }
      case "task.list":
        return this.queryTaskList(data, projectId, input);
      case "ready.list":
        return { mode: "demo", items: this.readyItems(data, projectId) };
      case "run.show": {
        const run = this.requireRun(data, projectId, str(input.runId ?? input.id));
        return { mode: "demo", run, artifacts: artifactsOf(run) };
      }
      case "run.list": {
        const trackerId = input.trackerId ? str(input.trackerId) : undefined;
        const runs = data.runs
          .filter((row) => row.projectId === projectId && (!trackerId || row.taskId === trackerId))
          .sort((a, b) => a.attempt - b.attempt);
        return { mode: "demo", runs };
      }
      case "diff.get": {
        const run = this.requireRun(data, projectId, str(input.runId ?? input.id));
        return { mode: "demo", runId: run.id, diff: run.diff };
      }
      case "artifact.list": {
        const run = this.requireRun(data, projectId, str(input.runId ?? input.id));
        return { mode: "demo", runId: run.id, artifacts: artifactsOf(run) };
      }
      case "events.list": {
        const cursor = input.cursor != null ? String(input.cursor) : undefined;
        const limit = Number(input.limit ?? 200);
        return {
          mode: "demo",
          cursor: data.cursor,
          events: this.eventsSince(projectId, cursor, actor).slice(0, limit),
        };
      }
      case "history.get": {
        const trackerId = str(input.trackerId ?? input.id);
        const found = this.requireRecord(data, projectId, trackerId);
        const runs = data.runs.filter((row) => row.projectId === projectId && row.taskId === trackerId);
        return {
          mode: "demo",
          trackerId,
          comments: found.record.system.comments ?? [],
          activity: found.record.system.activity ?? [],
          runs,
        };
      }
      default:
        throw new BabelError("USAGE", `未知查询：${String(request.name)}`);
    }
  }

  private cmdCreate(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const title = str(request.input.title);
    if (!title.trim()) throw new BabelError("VALIDATION", "标题不能为空");
    const primaryType = String(request.input.primaryType ?? "task");
    const requestedId = request.input.id != null && String(request.input.id).trim()
      ? String(request.input.id)
      : uid("trk");
    if (data.records.some((row) => row.projectId === request.projectId && row.id === requestedId)) {
      throw new BabelError("CONFLICT", "该 TrackerRecord.id 已存在", { trackerId: requestedId });
    }
    const source = request.input.source === "inline" || request.input.source === "frontmatter" || request.input.source === "import"
      ? request.input.source
      : "native";
    const extraFields = request.input.fields && typeof request.input.fields === "object" && !Array.isArray(request.input.fields)
      ? { ...(request.input.fields as Record<string, unknown>) }
      : {};
    const markdown = String(request.input.description ?? request.input.markdown ?? extraFields.description ?? "");
    const record: TrackerRecord = {
      id: requestedId,
      projectId: request.projectId,
      primaryType,
      typeTags: Array.isArray(request.input.typeTags) ? request.input.typeTags.map(String) : [primaryType],
      source,
      archived: false,
      syncStatus: "local",
      content: { format: "markdown", markdown },
      system: {
        workspace: request.projectId,
        createdAt: this.now(data),
        updatedAt: this.now(data),
        comments: [],
        activity: [],
        linkedSessions: [],
        origin: { kind: "manual" },
        documentPath: request.input.documentPath ? String(request.input.documentPath) : undefined,
      },
      fields: {
        ...extraFields,
        title,
        status: String(request.input.status ?? extraFields.status ?? "to-do"),
        description: String(request.input.description ?? extraFields.description ?? ""),
        priority: request.input.priority ? String(request.input.priority) : extraFields.priority ? String(extraFields.priority) : "normal",
        owner: request.input.owner ? String(request.input.owner) : extraFields.owner ? String(extraFields.owner) : undefined,
        acceptance: Array.isArray(request.input.acceptance) ? request.input.acceptance as TrackerRecord["fields"]["acceptance"] : [],
        dependsOn: Array.isArray(request.input.dependsOn) ? request.input.dependsOn.map(String) : [],
        blocks: Array.isArray(extraFields.blocks) ? extraFields.blocks.map(String) : [],
      },
      revision: 1,
      orderKey: nextOrderKey(data.records.filter((row) => row.projectId === request.projectId).map((row) => row.orderKey)),
    };
    const enabled = Boolean(request.input.executionEnabled ?? isExecutableType(primaryType));
    const binding: ExecutionBinding = {
      projectId: request.projectId,
      trackerId: record.id,
      targetDeviceId: request.input.deviceId ? String(request.input.deviceId) : null,
      providerId: null,
      latestRunId: null,
      completionPolicy: "verified_and_reviewed",
      revision: 1,
      archivedAt: null,
      outcome: "not_started",
      restoreStage: null,
      executionEnabled: enabled,
    };
    data.records.push(record);
    data.bindings.push(binding);
    this.touch(record, data, actor, "created", "创建条目");
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: null,
      revision: record.revision,
      correlationId,
      payload: { action: "create", title, primaryType },
    });
    return this.ok(request, correlationId, record, null, { record, binding, stage: deriveStage(record, binding) });
  }

  private cmdUpdate(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    this.assertRevision(record, request.expectedRevision);
    this.forbidLifecyclePatches(request.input);
    if (request.input.title != null) record.fields.title = String(request.input.title);
    if (request.input.description != null) {
      record.fields.description = String(request.input.description);
      record.content.markdown = String(request.input.description);
    }
    if (request.input.markdown != null) {
      record.content.markdown = String(request.input.markdown);
      if (request.input.description == null) record.fields.description = String(request.input.markdown);
    }
    if (request.input.priority != null) record.fields.priority = String(request.input.priority);
    if (request.input.owner != null) record.fields.owner = String(request.input.owner);
    if (Array.isArray(request.input.acceptance)) {
      record.fields.acceptance = request.input.acceptance as TrackerRecord["fields"]["acceptance"];
    }
    if (request.input.status != null) {
      const next = String(request.input.status);
      this.assertStatusWrite(record, binding, next);
      record.fields.status = next;
    }
    record.revision += 1;
    binding.revision = record.revision;
    record.system.updatedAt = this.now(data);
    this.touch(record, data, actor, "updated", "更新字段");
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: binding.latestRunId,
      revision: record.revision,
      correlationId,
      payload: { action: "update" },
    });
    return this.ok(request, correlationId, record, binding.latestRunId, { record, binding, stage: deriveStage(record, binding) });
  }

  private cmdReorder(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    const siblings = data.records.filter((row) => row.projectId === request.projectId).sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    const beforeId = request.input.beforeId != null ? String(request.input.beforeId) : null;
    const afterId = request.input.afterId != null ? String(request.input.afterId) : null;
    const before = beforeId ? siblings.find((row) => row.id === beforeId) : undefined;
    const after = afterId ? siblings.find((row) => row.id === afterId) : undefined;
    record.orderKey = orderBetween(before?.orderKey, after?.orderKey, siblings.map((row) => row.orderKey));
    record.revision += 1;
    binding.revision = record.revision;
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: null,
      revision: record.revision,
      correlationId,
      payload: { action: "reorder", orderKey: record.orderKey },
    });
    return this.ok(request, correlationId, record, null, { orderKey: record.orderKey, revision: record.revision });
  }

  private cmdArchive(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    this.assertRevision(record, request.expectedRevision);
    this.assertNoCancelOrLost(data, binding);
    const latest = binding.latestRunId ? data.runs.find((row) => row.id === binding.latestRunId) : undefined;
    if (latest && ACTIVE_RUN.has(latest.status) && latest.status !== "review_required") {
      throw new BabelError("PRECONDITION", "进行中的执行不能归档，请先结束或取消", { runId: latest.id, status: latest.status });
    }
    binding.restoreStage = deriveStage(record, binding);
    record.archived = true;
    binding.archivedAt = this.now(data);
    record.revision += 1;
    binding.revision = record.revision;
    this.touch(record, data, actor, "archived", "归档");
    this.emit(data, {
      type: "task.archived",
      projectId: request.projectId,
      trackerId: record.id,
      runId: binding.latestRunId,
      revision: record.revision,
      correlationId,
      payload: { restoreStage: binding.restoreStage },
    });
    return this.ok(request, correlationId, record, binding.latestRunId, { record, binding, stage: deriveStage(record, binding) });
  }

  private cmdRestore(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    this.assertRevision(record, request.expectedRevision);
    if (!record.archived && !binding.archivedAt) throw new BabelError("PRECONDITION", "该条目未归档");
    record.archived = false;
    binding.archivedAt = null;
    record.revision += 1;
    binding.revision = record.revision;
    this.touch(record, data, actor, "restored", "恢复，不自动执行");
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: binding.latestRunId,
      revision: record.revision,
      correlationId,
      payload: { action: "restore", restoreStage: binding.restoreStage, started: false },
    });
    return this.ok(request, correlationId, record, binding.latestRunId, {
      record,
      binding,
      stage: deriveStage(record, binding),
      started: false,
    });
  }

  private cmdStart(ctx: CmdCtx): CommandResult {
    return this.startNewRun(ctx, undefined);
  }

  private cmdRetry(ctx: CmdCtx): CommandResult {
    const trackerId = str(ctx.request.input.trackerId ?? ctx.request.input.id ?? "");
    const previousId = ctx.request.input.runId ? String(ctx.request.input.runId) : undefined;
    const { binding } = this.requireRecord(ctx.data, ctx.request.projectId, trackerId || this.runTaskId(ctx.data, previousId));
    const previous = previousId
      ? this.requireRun(ctx.data, ctx.request.projectId, previousId)
      : binding.latestRunId
        ? this.requireRun(ctx.data, ctx.request.projectId, binding.latestRunId)
        : undefined;
    if (previous && !TERMINAL_RUN.has(previous.status)) {
      throw new BabelError("RUN_ACTIVE", "当前执行尚未终止，不能重试", { runId: previous.id, status: previous.status });
    }
    return this.startNewRun(ctx, previous);
  }

  private startNewRun(ctx: CmdCtx, previous: RunRecord | undefined): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id ?? previous?.taskId);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    this.assertRevision(record, request.expectedRevision);
    if (record.archived || binding.archivedAt) throw new BabelError("PRECONDITION", "已归档条目不能启动执行");
    if (!binding.executionEnabled && !isExecutableType(record.primaryType, binding.executionEnabled)) {
      throw new BabelError("PRECONDITION", "该类型默认不可执行", { primaryType: record.primaryType });
    }
    this.assertNoCancelOrLost(data, binding);
    const active = data.runs.find((row) => row.projectId === request.projectId && row.taskId === record.id && !TERMINAL_RUN.has(row.status));
    if (active) throw new BabelError("RUN_ACTIVE", "同一条目至多一个未终止执行", { runId: active.id, status: active.status });
    const deviceId = String(request.input.deviceId ?? binding.targetDeviceId ?? "fixture-device-ubuntu");
    const device = data.devices.find((row) => row.id === deviceId);
    if (device && !device.available) {
      throw new BabelError("UNAVAILABLE", "目标设备当前不可用（演示离线）", { deviceId, displayStatus: device.displayStatus });
    }
    const now = this.now(data);
    const run: RunRecord = {
      id: uid("run"),
      projectId: request.projectId,
      taskId: record.id,
      attempt: previous ? previous.attempt + 1 : data.runs.filter((row) => row.taskId === record.id).length + 1,
      status: "accepted",
      deviceId,
      providerId: String(request.input.providerId ?? "pi-sim"),
      sessionId: null,
      taskRevision: record.revision,
      inputSnapshotId: uid("snap"),
      baseCommit: "demo-base-001",
      executionFence: (previous?.executionFence ?? 0) + 1,
      startedAt: now,
      endedAt: null,
      lastEventSeq: 0,
      summary: String(request.input.summary ?? "模拟执行已接受，尚未完成"),
      messages: [],
      inputRequests: [],
      verification: (record.fields.acceptance ?? []).map((item) => ({ ...item, state: "pending" as const })),
      diff: null,
      review: null,
    };
    data.runs.push(run);
    binding.latestRunId = run.id;
    binding.targetDeviceId = deviceId;
    binding.providerId = run.providerId;
    binding.outcome = "unresolved";
    record.fields.status = "in-progress";
    record.revision += 1;
    binding.revision = record.revision;
    this.touch(record, data, actor, "run-accepted", `执行已接受 ${run.id}`);
    this.emit(data, {
      type: "run.accepted",
      projectId: request.projectId,
      trackerId: record.id,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { attempt: run.attempt, deviceId, sessionCreated: false },
    });
    if (this.simulate === "sync") this.driveToReview(data, run.id, "default");
    return this.ok(request, correlationId, record, run.id, {
      run,
      settled: false,
      commandMeans: "accepted_not_finished",
    }, false);
  }

  private cmdMessage(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    if (TERMINAL_RUN.has(run.status)) throw new BabelError("PRECONDITION", "已结束的执行只能查看，不能再发送运行消息");
    const text = str(request.input.text);
    const clientMessageId = request.input.clientMessageId ? String(request.input.clientMessageId) : undefined;
    if (clientMessageId && run.messages.some((row) => row.clientMessageId === clientMessageId)) {
      return this.ok(request, correlationId, this.requireRecord(data, request.projectId, run.taskId).record, run.id, { replayed: true, run });
    }
    const message = { id: uid("msg"), role: "user" as const, text, at: this.now(data), clientMessageId };
    run.messages.push(message);
    this.emit(data, {
      type: "message.delta",
      projectId: request.projectId,
      trackerId: run.taskId,
      runId: run.id,
      revision: null,
      correlationId,
      payload: { message },
    });
    return this.ok(request, correlationId, this.requireRecord(data, request.projectId, run.taskId).record, run.id, { message, run }, false);
  }

  private cmdRespond(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    const requestId = str(request.input.requestId ?? request.input.inputRequestId);
    const pending = run.inputRequests.find((row) => row.id === requestId);
    if (!pending) throw new BabelError("NOT_FOUND", "没有这条待答请求", { requestId });
    if (pending.answered) throw new BabelError("PRECONDITION", "该请求已经回答");
    pending.answered = true;
    pending.answer = String(request.input.text ?? request.input.answer ?? "");
    run.messages.push({
      id: uid("msg"),
      role: "user",
      text: pending.answer,
      at: this.now(data),
      inputRequestId: requestId,
    });
    if (run.status === "waiting_input") {
      // A prompt can interrupt before session creation or after the tools finish.
      // Continue from committed progress instead of replaying a completed step.
      const toolsFinished = data.events.some((event) => event.runId === run.id
        && event.projectId === run.projectId && event.trackerId === run.taskId && event.type === "tool.finished");
      run.status = toolsFinished ? "verifying" : run.sessionId ? "executing" : "accepted";
    }
    this.emit(data, {
      type: "message.delta",
      projectId: request.projectId,
      trackerId: run.taskId,
      runId: run.id,
      revision: null,
      correlationId,
      payload: { inputRequestId: requestId, answered: true },
    });
    this.scheduleSimulation(run.id, "after-respond");
    return this.ok(request, correlationId, this.requireRecord(data, request.projectId, run.taskId).record, run.id, { run }, false);
  }

  private cmdCancel(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    if (TERMINAL_RUN.has(run.status)) throw new BabelError("PRECONDITION", "执行已经结束");
    run.status = "cancel_requested";
    this.emit(data, {
      type: "run.finished",
      projectId: request.projectId,
      trackerId: run.taskId,
      runId: run.id,
      revision: null,
      correlationId,
      payload: { result: "cancel_requested", stopped: false },
    });
    if (this.simulate !== "off" && request.input.hold !== true) {
      this.later(() => {
        this.store.transaction((snap) => this.finishCancel(snap, run.id, correlationId));
        void this.pumpOutbox();
      }, this.stepMs);
    }
    return this.ok(request, correlationId, this.requireRecord(data, request.projectId, run.taskId).record, run.id, {
      run,
      stopped: false,
    }, false);
  }

  private cmdReconcile(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    const { record, binding } = this.requireRecord(data, request.projectId, run.taskId);
    this.assertWritable(record);
    this.assertRevision(record, request.expectedRevision);
    if (run.status !== "lost" && run.status !== "cancel_requested") {
      throw new BabelError("PRECONDITION", "只有失联或取消待确认的执行需要核对", { status: run.status });
    }
    const resolution = String(request.input.resolution ?? "cancelled") as RunStatus;
    if (resolution !== "cancelled" && resolution !== "failed") {
      throw new BabelError("VALIDATION", "核对结果只能是 cancelled 或 failed");
    }
    run.status = resolution;
    run.endedAt = this.now(data);
    run.summary = resolution === "cancelled" ? "模拟：核对后标记为已取消" : "模拟：核对后标记为失败";
    binding.outcome = "unresolved";
    record.fields.status = resolution === "cancelled" ? "wont-do" : "in-progress";
    record.revision += 1;
    this.emit(data, {
      type: "run.finished",
      projectId: request.projectId,
      trackerId: run.taskId,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { result: resolution, reconciled: true },
    });
    return this.ok(request, correlationId, record, run.id, { run, binding });
  }

  private cmdReviewAccept(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    if (actor.kind === "hook") {
      throw new BabelError("COMPLETION_GUARD", "Hook 不能代替人工验收");
    }
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    const { record, binding } = this.requireRecord(data, request.projectId, run.taskId);
    this.assertRevision(record, request.expectedRevision);
    if (run.status !== "review_required" && run.status !== "verifying") {
      throw new BabelError("PRECONDITION", "当前不在待审状态", { status: run.status });
    }
    const required = run.verification.filter((item) => item.required);
    const blocked = required.filter((item) => item.state !== "passed" && item.state !== "waived");
    if (binding.completionPolicy === "verified_and_reviewed" && blocked.length) {
      throw new BabelError("COMPLETION_GUARD", "必需验收项尚未通过或豁免", { pending: blocked.map((item) => item.id) });
    }
    run.status = "succeeded";
    run.endedAt = this.now(data);
    run.review = { decision: "accept", at: run.endedAt, actorId: actor.id };
    run.summary = "模拟：验证和人工验收通过";
    binding.outcome = "succeeded";
    record.fields.status = "done";
    record.revision += 1;
    binding.revision = record.revision;
    this.touch(record, data, actor, "accepted", "人工接受结果");
    this.emit(data, {
      type: "run.finished",
      projectId: request.projectId,
      trackerId: record.id,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { result: "succeeded", reviewedBy: actor.id },
    });
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { action: "completed", outcome: "succeeded" },
    });
    return this.ok(request, correlationId, record, run.id, { run, binding, stage: deriveStage(record, binding) });
  }

  private cmdReviewChanges(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const run = this.requireRun(data, request.projectId, str(request.input.runId ?? request.input.id));
    const { record, binding } = this.requireRecord(data, request.projectId, run.taskId);
    run.status = "failed";
    run.endedAt = this.now(data);
    run.review = { decision: "request_changes", at: run.endedAt, actorId: actor.id };
    run.summary = String(request.input.comment ?? "模拟：要求修改，未完成");
    binding.outcome = "unresolved";
    record.fields.status = "changes-requested";
    record.revision += 1;
    this.emit(data, {
      type: "run.finished",
      projectId: request.projectId,
      trackerId: record.id,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { result: "failed", decision: "request_changes" },
    });
    return this.ok(request, correlationId, record, run.id, { run, binding, stage: deriveStage(record, binding) });
  }

  private cmdComment(ctx: CmdCtx): CommandResult {
    const { data, request, actor, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    const comment = {
      id: uid("cmt"),
      body: str(request.input.body ?? request.input.text),
      createdAt: this.now(data),
      authorId: actor.id,
    };
    record.system.comments = [...(record.system.comments ?? []), comment];
    record.revision += 1;
    binding.revision = record.revision;
    this.touch(record, data, actor, "comment", "添加讨论");
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: null,
      revision: record.revision,
      correlationId,
      payload: { action: "comment", commentId: comment.id },
    });
    return this.ok(request, correlationId, record, null, { comment, record });
  }

  private cmdRelation(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const trackerId = str(request.input.trackerId ?? request.input.id);
    const { record, binding } = this.requireRecord(data, request.projectId, trackerId);
    this.assertWritable(record);
    const prevDepends = [...record.fields.dependsOn];
    if (Array.isArray(request.input.dependsOn)) record.fields.dependsOn = request.input.dependsOn.map(String);
    if (Array.isArray(request.input.blocks)) record.fields.blocks = request.input.blocks.map(String);
    this.syncReverseRelations(data, record, prevDepends);
    record.revision += 1;
    binding.revision = record.revision;
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: record.id,
      runId: null,
      revision: record.revision,
      correlationId,
      payload: { action: "relation", dependsOn: record.fields.dependsOn, blocks: record.fields.blocks },
    });
    return this.ok(request, correlationId, record, null, { record });
  }

  private cmdViewSave(ctx: CmdCtx): CommandResult {
    const { data, request, correlationId } = ctx;
    const name = str(request.input.name);
    const viewId = String(request.input.viewId ?? uid("view"));
    const definition = (request.input.definition ?? {}) as SavedView["definition"];
    const existing = data.views.find((row) => row.viewId === viewId);
    const view: SavedView = { viewId, name, builtin: existing?.builtin ?? false, definition };
    if (existing) Object.assign(existing, view);
    else data.views.push(view);
    this.emit(data, {
      type: "task.updated",
      projectId: request.projectId,
      trackerId: null,
      runId: null,
      revision: null,
      correlationId,
      payload: { action: "view.save", viewId },
    });
    return okBare(request, correlationId, { view });
  }

  private cmdReset(ctx: CmdCtx): CommandResult {
    const next = buildDemoSnapshot(this.fixtures, this.workdir);
    next.hookConfigs = ctx.data.hookConfigs;
    Object.assign(ctx.data, next);
    this.emit(ctx.data, {
      type: "task.updated",
      projectId: ctx.request.projectId,
      trackerId: null,
      runId: null,
      revision: null,
      correlationId: ctx.correlationId,
      payload: { action: "demo.reset" },
    });
    return okBare(ctx.request, ctx.correlationId, { reset: true, mode: "demo" });
  }

  private cmdInject(ctx: CmdCtx): CommandResult {
    const scenario = String(ctx.request.input.scenario ?? "") as InjectScenario;
    const allowed: InjectScenario[] = [
      "waiting_input",
      "verification_failed",
      "lost",
      "cancel_unconfirmed",
      "message_disorder",
      "review_required",
      "disconnect",
    ];
    if (!allowed.includes(scenario)) {
      throw new BabelError("VALIDATION", "未知注入场景", { scenario });
    }
    let runId = ctx.request.input.runId ? String(ctx.request.input.runId) : undefined;
    const trackerId = ctx.request.input.trackerId ? String(ctx.request.input.trackerId) : undefined;
    if (!runId && trackerId) {
      runId = this.requireRecord(ctx.data, ctx.request.projectId, trackerId).binding.latestRunId ?? undefined;
    }
    if (!runId && scenario !== "disconnect") {
      const started = this.startNewRun(ctx, undefined);
      runId = started.runId ?? undefined;
    }
    if (scenario === "disconnect") {
      this.emit(ctx.data, {
        type: "device.snapshot",
        projectId: ctx.request.projectId,
        trackerId: trackerId ?? null,
        runId: runId ?? null,
        revision: null,
        correlationId: ctx.correlationId,
        payload: { injected: "disconnect", note: "仅演示断线；服务端 run 继续" },
      });
      return okBare(ctx.request, ctx.correlationId, { scenario, persisted: true });
    }
    if (!runId) throw new BabelError("NOT_FOUND", "没有可注入的 run");
    this.simulateOnce(ctx.data, runId, scenario);
    return this.ok(ctx.request, ctx.correlationId, this.requireRecord(ctx.data, ctx.request.projectId, this.requireRun(ctx.data, ctx.request.projectId, runId).taskId).record, runId, {
      scenario,
      run: this.requireRun(ctx.data, ctx.request.projectId, runId),
    }, false);
  }

  private cmdHookRegister(ctx: CmdCtx): CommandResult {
    if (ctx.actor.kind !== "system") {
      throw new BabelError("PERMISSION", "登记可执行进程 Hook 需要服务令牌", {
        hookId: ctx.request.input.hookId ?? null,
      });
    }
    const input = ctx.request.input as Partial<HookConfig>;
    if (!input.hookId || !input.phase || !input.executable) {
      throw new BabelError("VALIDATION", "hookId、phase、executable 必填");
    }
    const hook: HookConfig = {
      hookId: String(input.hookId),
      phase: input.phase,
      commands: input.commands,
      executable: String(input.executable),
      argv: input.argv ?? [],
      cwd: String(input.cwd ?? path.join(this.profileDir, "hooks")),
      timeoutMs: Number(input.timeoutMs ?? 2000),
      required: input.required !== false,
      envAllow: input.envAllow ?? [],
    };
    const index = ctx.data.hookConfigs.findIndex((row) => row.hookId === hook.hookId);
    if (index >= 0) ctx.data.hookConfigs[index] = hook;
    else ctx.data.hookConfigs.push(hook);
    return okBare(ctx.request, ctx.correlationId, { hook });
  }

  private cmdHookRetry(ctx: CmdCtx): CommandResult {
    const deliveryId = str(ctx.request.input.deliveryId);
    const item = ctx.data.outbox.find((row) => row.deliveryId === deliveryId);
    if (!item) throw new BabelError("NOT_FOUND", "没有这条投递", { deliveryId });
    item.status = "pending";
    item.nextRetryAt = this.now(ctx.data);
    item.lastError = undefined;
    return okBare(ctx.request, ctx.correlationId, { outbox: item, reranCommand: false });
  }

  private queryTaskList(data: Snapshot, projectId: string, input: Record<string, unknown>): unknown {
    const view = input.viewId ? data.views.find((row) => row.viewId === String(input.viewId)) : undefined;
    const def = view?.definition ?? {};
    const types = (input.types ?? def.types ?? "executable") as string[] | "all" | "executable";
    const statusScope = String(input.statusScope ?? def.statusScope ?? "all") as "open" | "closed" | "all";
    const includeArchived = Boolean(input.includeArchived ?? def.includeArchived ?? true);
    const includeSemantic = Boolean(input.includeSemantic ?? def.includeSemantic ?? false);
    const deviceId = input.deviceId != null ? (input.deviceId === "" ? null : String(input.deviceId)) : def.deviceId;
    const q = String(input.q ?? def.q ?? "").trim().toLowerCase();
    const stageFilter = input.stage ? String(input.stage) as Stage : undefined;
    const latestEvents = this.latestRunEvents(data);
    const items = data.records
      .filter((record) => record.projectId === projectId)
      .filter((record) => includeSemantic || record.fields.demoScene !== "semantic")
      .map((record) => this.cardOf(data, record, latestEvents))
      .filter((card) => {
        if (!includeArchived && card.archived) return false;
        if (input.attentionOnly === true && (card.archived || !card.attention)) return false;
        if (types === "executable" && !isExecutableType(card.primaryType, card.executionEnabled)) return false;
        if (Array.isArray(types) && !types.includes(card.primaryType)) return false;
        if (statusScope !== "all") {
          const cat = categoryOfStatus(card.status);
          const closed = cat === "done" || cat === "cancelled";
          if (statusScope === "open" && (closed || card.archived)) return false;
          if (statusScope === "closed" && !closed && !card.archived) return false;
        }
        if (deviceId && card.deviceId !== deviceId) return false;
        if (stageFilter && card.stage !== stageFilter) return false;
        if (q) {
          const blob = `${card.title} ${card.description} ${card.trackerId}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.orderKey.localeCompare(b.orderKey));
    const counts = { TODO: 0, RUNNING: 0, DONE: 0, ARCHIVED: 0 };
    for (const card of items) counts[card.stage] += 1;
    return {
      mode: "demo",
      demoLabel: this.fixtures.demoLabel,
      cursor: data.cursor,
      counts,
      items,
    };
  }

  private queryCapabilities(data: Snapshot, projectId: string, input: Record<string, unknown>): unknown {
    const trackerId = input.trackerId ? String(input.trackerId) : undefined;
    const runId = input.runId ? String(input.runId) : undefined;
    const actions: Record<string, ActionCapability> = {};
    const names: CommandName[] = HTTP_OK_COMMANDS;
    for (const name of names) {
      actions[name] = { allowed: true };
    }
    if (trackerId) {
      try {
        const { record, binding } = this.requireRecord(data, projectId, trackerId);
        if (record.system.readOnly) {
          for (const name of ["task.update", "task.archive", "run.start", "comment.add", "relation.set"] as CommandName[]) {
            actions[name] = { allowed: false, reason: "只读远端文件条目不可写入", code: "READ_ONLY" };
          }
        }
        if (record.archived) {
          actions["run.start"] = { allowed: false, reason: "已归档条目不能启动", code: "PRECONDITION" };
        }
        const latest = binding.latestRunId ? data.runs.find((row) => row.id === binding.latestRunId) : undefined;
        if (latest && !TERMINAL_RUN.has(latest.status)) {
          actions["run.start"] = { allowed: false, reason: "已有未终止执行", code: "RUN_ACTIVE" };
          actions["run.retry"] = { allowed: false, reason: "未终止不能重试", code: "RUN_ACTIVE" };
        }
        if (latest && ACTIVE_RUN.has(latest.status) && latest.status !== "review_required") {
          actions["task.archive"] = { allowed: false, reason: "进行中的执行不能归档，请先结束或取消", code: "PRECONDITION" };
        }
        if (latest?.status === "cancel_requested") {
          actions["task.archive"] = { allowed: false, reason: "取消尚未确认，不能归档", code: "CANCEL_PENDING" };
          actions["run.retry"] = { allowed: false, reason: "取消尚未确认，不能重试", code: "CANCEL_PENDING" };
        }
        if (latest?.status === "lost") {
          actions["run.start"] = { allowed: false, reason: "失联尚未核对", code: "LOST_UNRECONCILED" };
          actions["run.retry"] = { allowed: false, reason: "失联尚未核对", code: "LOST_UNRECONCILED" };
          actions["task.archive"] = { allowed: false, reason: "失联执行尚未核对，不能归档", code: "LOST_UNRECONCILED" };
        }
        if (latest && latest.status !== "review_required" && latest.status !== "verifying") {
          actions["review.accept"] = { allowed: false, reason: "当前不在待审", code: "PRECONDITION" };
        }
      } catch (error) {
        if (error instanceof BabelError) {
          actions["task.update"] = { allowed: false, reason: error.message, code: error.code };
        }
      }
    }
    if (runId) {
      const run = data.runs.find((row) => row.id === runId);
      if (run && TERMINAL_RUN.has(run.status)) {
        actions["run.message"] = { allowed: false, reason: "已结束的执行不能再发送运行消息", code: "PRECONDITION" };
        actions["run.cancel"] = { allowed: false, reason: "执行已经结束", code: "PRECONDITION" };
      }
    }
    if (trackerId || runId) {
      try {
        let run = runId ? this.requireRun(data, projectId, runId) : undefined;
        const { record, binding } = this.requireRecord(data, projectId, trackerId ?? run!.taskId);
        this.assertWritable(record);
        run ??= binding.latestRunId ? this.requireRun(data, projectId, binding.latestRunId) : undefined;
        if (!run || run.taskId !== record.id || (run.status !== "lost" && run.status !== "cancel_requested")) {
          throw new BabelError("PRECONDITION", "只有失联或取消待确认的执行需要核对");
        }
      } catch (error) {
        if (error instanceof BabelError) {
          actions["run.reconcile"] = { allowed: false, reason: error.message, code: error.code };
        } else {
          throw error;
        }
      }
    }
    return {
      mode: "demo",
      protocolVersion: PROTOCOL_VERSION,
      disabledNote: "禁用表示该动作当前不可用或未在本阶段适配，不表示三端功能已经等价完成",
      actions,
      trackerId: trackerId ?? null,
      runId: runId ?? null,
    };
  }

  private readyItems(data: Snapshot, projectId: string): TaskCard[] {
    const latestEvents = this.latestRunEvents(data);
    return data.records
      .filter((record) => record.projectId === projectId && !record.archived)
      .map((record) => this.cardOf(data, record, latestEvents))
      .filter((card) => {
        const cat = categoryOfStatus(card.status);
        if (cat === "done" || cat === "cancelled") return false;
        const record = data.records.find((row) => row.id === card.trackerId);
        const deps = record?.fields.dependsOn ?? [];
        return deps.every((id) => {
          const dep = data.records.find((row) => row.id === id);
          if (!dep) return false;
          const depCat = categoryOfStatus(String(dep.fields.status));
          return depCat === "done" || depCat === "cancelled" || dep.archived;
        });
      });
  }

  private latestRunEvents(data: Snapshot): Map<string, BabelEvent> {
    const latest = new Map<string, BabelEvent>();
    for (const event of data.events) {
      if (!event.runId) continue;
      const key = JSON.stringify([event.projectId, event.trackerId, event.runId]);
      const previous = latest.get(key);
      if (!previous || event.seq > previous.seq) latest.set(key, event);
    }
    return latest;
  }

  private cardOf(data: Snapshot, record: TrackerRecord, latestEvents = this.latestRunEvents(data)): TaskCard {
    const binding = data.bindings.find((row) => row.projectId === record.projectId && row.trackerId === record.id);
    const run = binding?.latestRunId ? data.runs.find((row) => row.id === binding.latestRunId) : undefined;
    const stage = deriveStage(record, binding);
    return {
      projectId: record.projectId,
      trackerId: record.id,
      title: String(record.fields.title),
      description: String(record.fields.description ?? ""),
      primaryType: record.primaryType,
      status: String(record.fields.status),
      stage,
      outcome: binding?.outcome ?? "not_started",
      archived: record.archived,
      revision: record.revision,
      orderKey: record.orderKey,
      latestRunId: binding?.latestRunId ?? null,
      runStatus: run?.status ?? null,
      lastUpdatedAt: run
        ? latestEvents.get(JSON.stringify([run.projectId, run.taskId, run.id]))?.occurredAt ?? run.endedAt ?? run.startedAt
        : record.system.updatedAt ?? null,
      deviceId: binding?.targetDeviceId ?? run?.deviceId ?? null,
      attention: !record.archived && run ? runNeedsAttention(run.status) : false,
      originKind: record.system.origin?.kind,
      executionEnabled: Boolean(binding?.executionEnabled),
      readOnly: Boolean(record.system.readOnly),
      priority: record.fields.priority ? String(record.fields.priority) : undefined,
    };
  }

  private detailOf(data: Snapshot, record: TrackerRecord, binding: ExecutionBinding): unknown {
    const runs = data.runs.filter((row) => row.projectId === record.projectId && row.taskId === record.id);
    const latest = binding.latestRunId ? runs.find((row) => row.id === binding.latestRunId) : undefined;
    return {
      mode: "demo",
      demoLabel: this.fixtures.demoLabel,
      record,
      binding,
      stage: deriveStage(record, binding),
      latestRun: latest ?? null,
      runs,
      card: this.cardOf(data, record),
    };
  }

  private requireRecord(data: Snapshot, projectId: string, trackerId: string): { record: TrackerRecord; binding: ExecutionBinding } {
    const record = data.records.find((row) => row.projectId === projectId && row.id === trackerId);
    if (!record) throw new BabelError("NOT_FOUND", "找不到这条 Tracker 记录", { projectId, trackerId });
    let binding = data.bindings.find((row) => row.projectId === projectId && row.trackerId === trackerId);
    if (!binding) {
      binding = {
        projectId,
        trackerId,
        targetDeviceId: null,
        providerId: null,
        latestRunId: null,
        completionPolicy: "verified_and_reviewed" satisfies CompletionPolicy,
        revision: record.revision,
        archivedAt: record.archived ? record.system.updatedAt : null,
        outcome: "not_started",
        restoreStage: null,
        executionEnabled: isExecutableType(record.primaryType),
      };
      data.bindings.push(binding);
    }
    return { record, binding };
  }

  private requireRun(data: Snapshot, projectId: string, runId: string): RunRecord {
    const run = data.runs.find((row) => row.id === runId);
    if (!run || run.projectId !== projectId) throw new BabelError("NOT_FOUND", "找不到这次执行", { projectId, runId });
    return run;
  }

  private runTaskId(data: Snapshot, runId: string | undefined): string {
    if (!runId) throw new BabelError("USAGE", "缺少 trackerId 或 runId");
    const run = data.runs.find((row) => row.id === runId);
    if (!run) throw new BabelError("NOT_FOUND", "找不到这次执行", { runId });
    return run.taskId;
  }

  private migrateSemanticSceneFlags(): void {
    let changed = false;
    const semantic = new Set<string>(SEMANTIC_DEMO_TRACKER_IDS);
    for (const record of this.store.data.records) {
      if (semantic.has(record.id) && record.fields.demoScene !== "semantic") {
        record.fields.demoScene = "semantic";
        changed = true;
      }
    }
    if (changed) this.store.persist();
  }

  private assertWritable(record: TrackerRecord): void {
    if (record.system.readOnly) {
      throw new BabelError("READ_ONLY", "只读远端文件条目不可写入", { trackerId: record.id });
    }
  }

  private assertRevision(record: TrackerRecord, expected?: number): void {
    if (expected == null) return;
    if (expected !== record.revision) {
      throw new BabelError("REVISION_CONFLICT", "记录已被更新，请先同步后再提交", {
        expectedRevision: expected,
        actualRevision: record.revision,
      });
    }
  }

  private forbidLifecyclePatches(input: Record<string, unknown>): void {
    for (const key of Object.keys(input)) {
      if (FORBIDDEN_FIELD_KEYS.has(key) || key === "stage" || key === "outcome") {
        throw new BabelError("VALIDATION", "普通字段更新不能写入 stage/outcome/run.status", { key });
      }
    }
    if (input.fields && typeof input.fields === "object") {
      this.forbidLifecyclePatches(input.fields as Record<string, unknown>);
    }
  }

  private assertStatusWrite(record: TrackerRecord, binding: ExecutionBinding, next: string): void {
    const cat = categoryOfStatus(next);
    if (binding.executionEnabled && cat === "done" && binding.outcome !== "succeeded") {
      throw new BabelError("COMPLETION_GUARD", "受管执行不能直接标为完成，需验证并通过验收", {
        trackerId: record.id,
        status: next,
      });
    }
  }

  private assertNoCancelOrLost(data: Snapshot, binding: ExecutionBinding): void {
    const latest = binding.latestRunId ? data.runs.find((row) => row.id === binding.latestRunId) : undefined;
    if (latest?.status === "cancel_requested") {
      throw new BabelError("CANCEL_PENDING", "取消尚未确认，不能重试或归档", { runId: latest.id });
    }
    if (latest?.status === "lost") {
      throw new BabelError("LOST_UNRECONCILED", "失联执行尚未核对，不能当作已停止或重新启动", { runId: latest.id });
    }
  }

  private syncReverseRelations(data: Snapshot, record: TrackerRecord, previousDepends: string[]): void {
    for (const oldId of previousDepends) {
      if (record.fields.dependsOn.includes(oldId)) continue;
      const other = data.records.find((row) => row.id === oldId && row.projectId === record.projectId);
      if (other) other.fields.blocks = other.fields.blocks.filter((id) => id !== record.id);
    }
    for (const depId of record.fields.dependsOn) {
      const other = data.records.find((row) => row.id === depId && row.projectId === record.projectId);
      if (other && !other.fields.blocks.includes(record.id)) other.fields.blocks.push(record.id);
    }
    for (const blockId of record.fields.blocks) {
      const other = data.records.find((row) => row.id === blockId && row.projectId === record.projectId);
      if (other && !other.fields.dependsOn.includes(record.id)) other.fields.dependsOn.push(record.id);
    }
  }

  private scheduleSimulation(runId: string, scenario: InjectScenario): void {
    if (this.simulate === "off") return;
    if (this.simulate === "sync") {
      this.store.transaction((data) => this.driveToReview(data, runId, scenario));
      void this.pumpOutbox();
      return;
    }
    this.later(() => {
      try {
        this.store.transaction((data) => this.simulateOnce(data, runId, scenario));
        void this.pumpOutbox();
        const run = this.store.data.runs.find((row) => row.id === runId);
        if (run && (run.status === "accepted" || run.status === "executing" || run.status === "verifying")) {
          this.scheduleSimulation(runId, scenario === "after-respond" ? "default" : scenario);
        }
      } catch {
        // simulation is best-effort for demo
      }
    }, this.stepMs);
  }

  private driveToReview(data: Snapshot, runId: string, scenario: InjectScenario): void {
    for (let i = 0; i < 8; i += 1) {
      const run = data.runs.find((row) => row.id === runId);
      if (!run) return;
      if (run.status === "review_required" || TERMINAL_RUN.has(run.status) || run.status === "waiting_input" || run.status === "lost" || run.status === "cancel_requested") {
        return;
      }
      this.simulateOnce(data, runId, scenario);
    }
  }

  private simulateOnce(data: Snapshot, runId: string, scenario: InjectScenario): void {
    const run = data.runs.find((row) => row.id === runId);
    if (!run) return;
    const { record, binding } = this.requireRecord(data, run.projectId, run.taskId);
    const v03 = this.fixtures.presentationData.V03;
    const v04 = this.fixtures.presentationData.V04;

    if (scenario === "lost") {
      run.status = "lost";
      run.summary = "模拟：执行失联，尚未核对";
      this.emit(data, {
        type: "run.finished",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: record.revision,
        correlationId: uid("corr"),
        payload: { result: "lost", stopped: false },
      });
      return;
    }
    if (scenario === "cancel_unconfirmed") {
      run.status = "cancel_requested";
      this.emit(data, {
        type: "run.finished",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { result: "cancel_requested", stopped: false },
      });
      return;
    }
    if (scenario === "waiting_input" && run.status !== "waiting_input") {
      const req = { id: uid("in"), prompt: "模拟：请确认同步范围后继续", answered: false };
      run.inputRequests.push(req);
      run.status = "waiting_input";
      this.emit(data, {
        type: "input.requested",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { inputRequest: req },
      });
      return;
    }
    if (scenario === "message_disorder") {
      run.messages.push({ id: uid("msg"), role: "agent", text: "模拟乱序消息 B（后发生）", at: this.now(data) });
      this.emit(data, {
        type: "message.delta",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { disorder: true, label: "B" },
      });
      run.messages.push({ id: uid("msg"), role: "agent", text: "模拟乱序消息 A（先发生，后投递）", at: this.now(data) });
      this.emit(data, {
        type: "message.delta",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { disorder: true, label: "A" },
      });
      return;
    }

    if (run.status === "accepted") {
      run.status = "executing";
      run.sessionId = `session-${run.id}`;
      run.messages.push({
        id: uid("msg"),
        role: "agent",
        text: v03?.message ?? "模拟：已开始处理。",
        at: this.now(data),
      });
      this.emit(data, {
        type: "run.started",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: record.revision,
        correlationId: uid("corr"),
        payload: { sessionId: run.sessionId, note: "创建会话不等于开始执行；此处已真正开始模拟" },
      });
      this.emit(data, {
        type: "message.delta",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { role: "agent" },
      });
      return;
    }

    if (run.status === "executing") {
      const tools = v03?.toolActivities ?? [
        { label: "读取上下文", state: "succeeded" },
        { label: "模拟处理", state: "executing" },
      ];
      const pending = tools.find((item) => item.state === "executing") ?? tools[tools.length - 1];
      this.emit(data, {
        type: "tool.started",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { tool: pending },
      });
      this.emit(data, {
        type: "tool.finished",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: null,
        correlationId: uid("corr"),
        payload: { tool: { ...pending, state: "succeeded" } },
      });
      run.diff = {
        label: v04?.baseLabel ?? "模拟基线 demo-base-001（非 Git 提交）",
        files: (v04?.changedFiles ?? ["demo/work.ts"]).map((file, index) => ({
          path: file,
          additions: index === 0 ? 30 : 12,
          deletions: index === 0 ? 6 : 2,
          patch: `--- a/${file}\n+++ b/${file}\n@@ 模拟差异 @@\n+模拟新增行\n-模拟删除行\n`,
        })),
      };
      run.status = "verifying";
      return;
    }

    if (run.status === "verifying" || scenario === "review_required" || scenario === "verification_failed") {
      if (scenario === "verification_failed") {
        run.verification = run.verification.map((item, index) => ({
          ...item,
          state: index === 0 ? "failed" : "pending",
        }));
        run.status = "failed";
        run.endedAt = this.now(data);
        run.summary = "模拟：验证失败，不能进入完成";
        binding.outcome = "unresolved";
        record.fields.status = "in-progress";
        record.revision += 1;
        this.emit(data, {
          type: "verification.updated",
          projectId: run.projectId,
          trackerId: run.taskId,
          runId: run.id,
          revision: record.revision,
          correlationId: uid("corr"),
          payload: { verification: run.verification },
        });
        this.emit(data, {
          type: "run.finished",
          projectId: run.projectId,
          trackerId: run.taskId,
          runId: run.id,
          revision: record.revision,
          correlationId: uid("corr"),
          payload: { result: "failed" },
        });
        return;
      }
      run.verification = run.verification.map((item) => ({ ...item, state: "passed" as const }));
      run.status = "review_required";
      run.summary = "模拟验证通过，待验收";
      record.fields.status = "in-review";
      record.revision += 1;
      binding.revision = record.revision;
      this.emit(data, {
        type: "verification.updated",
        projectId: run.projectId,
        trackerId: run.taskId,
        runId: run.id,
        revision: record.revision,
        correlationId: uid("corr"),
        payload: { verification: run.verification },
      });
      return;
    }
  }

  private finishCancel(data: Snapshot, runId: string, correlationId: string): void {
    const run = data.runs.find((row) => row.id === runId);
    if (!run || run.status !== "cancel_requested") return;
    run.status = "cancelled";
    run.endedAt = this.now(data);
    run.summary = "模拟：取消已确认";
    const { record, binding } = this.requireRecord(data, run.projectId, run.taskId);
    binding.outcome = "unresolved";
    record.fields.status = "wont-do";
    record.revision += 1;
    this.emit(data, {
      type: "run.finished",
      projectId: run.projectId,
      trackerId: run.taskId,
      runId: run.id,
      revision: record.revision,
      correlationId,
      payload: { result: "cancelled", stopped: true },
    });
  }

  private emit(data: Snapshot, partial: {
    type: string;
    projectId: string | null;
    trackerId: string | null;
    runId: string | null;
    revision: number | null;
    correlationId: string;
    payload: Record<string, unknown>;
  }): BabelEvent {
    const streamId = partial.runId
      ? `run:${partial.runId}`
      : partial.trackerId
        ? `task:${partial.projectId}:${partial.trackerId}`
        : `project:${partial.projectId ?? "none"}`;
    data.seqByStream[streamId] = (data.seqByStream[streamId] ?? 0) + 1;
    data.cursor += 1;
    const event: BabelEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventId: uid("evt"),
      projectId: partial.projectId,
      trackerId: partial.trackerId,
      taskId: partial.trackerId,
      runId: partial.runId,
      type: partial.type,
      streamId,
      seq: data.seqByStream[streamId],
      cursor: String(data.cursor),
      revision: partial.revision,
      occurredAt: this.now(data),
      correlationId: partial.correlationId,
      causationId: null,
      mode: "demo",
      payload: partial.payload,
    };
    data.events.push(event);
    if (partial.runId) {
      const run = data.runs.find((row) => row.id === partial.runId);
      if (run) run.lastEventSeq = event.seq;
    }
    for (const hook of data.hookConfigs.filter((row) => row.phase === "observe")) {
      data.outbox.push({
        deliveryId: uid("dlv"),
        eventId: event.eventId,
        hookId: hook.hookId,
        attempts: 0,
        maxAttempts: 3,
        nextRetryAt: event.occurredAt,
        status: "pending",
      });
    }
    queueMicrotask(() => {
      for (const listener of this.listeners) listener(event);
    });
    return event;
  }

  private async pumpOutbox(): Promise<void> {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      const pending = this.store.data.outbox.filter((row) => row.status === "pending");
      for (const item of pending) {
        if (this.disposed) break;
        await this.deliver(item);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async deliver(item: OutboxItem): Promise<void> {
    if (this.disposed) return;
    const hook = this.store.data.hookConfigs.find((row) => row.hookId === item.hookId);
    const event = this.store.data.events.find((row) => row.eventId === item.eventId);
    if (!hook || !event) {
      this.store.transaction((data) => {
        const row = data.outbox.find((entry) => entry.deliveryId === item.deliveryId);
        if (row) {
          row.status = "failed";
          row.lastError = "hook or event missing";
        }
      });
      return;
    }
    const result = await runObserveHook(hook, event);
    // The external process may finish after shutdown. Leave delivery pending
    // for a new service instance instead of writing through a disposed store.
    if (this.disposed) return;
    this.store.transaction((data) => {
      const row = data.outbox.find((entry) => entry.deliveryId === item.deliveryId);
      if (!row) return;
      row.attempts += 1;
      if (result.ok) {
        row.status = "delivered";
        data.hookDeliveries.push({
          deliveryId: row.deliveryId,
          eventId: row.eventId,
          hookId: row.hookId,
          at: this.now(data),
          ok: true,
        });
        return;
      }
      row.lastError = result.error;
      data.hookDeliveries.push({
        deliveryId: row.deliveryId,
        eventId: row.eventId,
        hookId: row.hookId,
        at: this.now(data),
        ok: false,
        error: result.error,
      });
      if (row.attempts >= row.maxAttempts) row.status = "failed";
      else row.nextRetryAt = this.now(data);
    });
  }

  private touch(record: TrackerRecord, data: Snapshot, actor: Actor, kind: string, detail: string): void {
    record.system.activity = [
      ...(record.system.activity ?? []),
      { id: uid("act"), at: this.now(data), actorId: actor.id, kind, detail },
    ];
  }

  private ok(
    request: CommandRequest,
    correlationId: string,
    record: TrackerRecord,
    runId: string | null,
    result: Record<string, unknown>,
    settled = true,
  ): CommandResult {
    return {
      ok: true,
      commandStatus: "accepted",
      settled,
      revision: record.revision,
      projectId: request.projectId,
      trackerId: record.id,
      runId,
      correlationId,
      mode: "demo",
      result,
    };
  }

  private now(data: Snapshot): string {
    if (this.nowFn) return this.nowFn();
    const next = new Date(Date.parse(data.clock) + 1000).toISOString();
    data.clock = next;
    return next;
  }

  private later(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(timer);
  }

  private assertActive(): void {
    if (this.disposed) throw new BabelError("UNAVAILABLE", "服务已关闭");
  }
}

export type InjectScenario =
  | "default"
  | "after-respond"
  | "waiting_input"
  | "verification_failed"
  | "lost"
  | "cancel_unconfirmed"
  | "message_disorder"
  | "review_required"
  | "disconnect";

interface CmdCtx {
  data: Snapshot;
  request: CommandRequest;
  actor: Actor;
  correlationId: string;
}

function normalizeActor(actor?: Actor): Actor {
  if (!actor) return { ...DEMO_ACTOR };
  return {
    id: actor.id || DEMO_ACTOR.id,
    kind: actor.kind || "cli",
    projectIds: actor.projectIds?.length ? actor.projectIds : DEMO_ACTOR.projectIds,
  };
}

function idemKey(actor: Actor, request: CommandRequest): string {
  return `${actor.id}:${request.projectId}:${request.name}:${request.idempotencyKey}`;
}

function str(value: unknown): string {
  if (value == null || value === "") throw new BabelError("USAGE", "缺少必需参数");
  return String(value);
}

function orderBetween(before: string | undefined, after: string | undefined, existing: string[]): string {
  const num = (key: string) => Number(String(key).split(":")[1] ?? key) || 0;
  if (before && after) {
    const mid = Math.floor((num(before) + num(after)) / 2);
    const candidate = `o:${String(mid).padStart(6, "0")}`;
    if (!existing.includes(candidate) && mid !== num(before) && mid !== num(after)) return candidate;
  }
  if (after && !before) {
    const n = Math.max(0, num(after) - 5);
    const candidate = `o:${String(n).padStart(6, "0")}`;
    if (!existing.includes(candidate)) return candidate;
  }
  if (before && !after) {
    return nextOrderKey(existing);
  }
  return nextOrderKey(existing);
}

function artifactsOf(run: RunRecord): Array<{ id: string; name: string; kind: string; available: boolean }> {
  return (run.diff?.files ?? []).map((file) => ({
    id: `art-${run.id}-${file.path}`,
    name: file.path,
    kind: "diff",
    available: true,
  }));
}

function annotateDevice(device: DeviceRecord): DeviceRecord & { demo: true } {
  return { ...device, demo: true };
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    plan: "计划",
    decision: "决策",
    bug: "缺陷",
    task: "任务",
    idea: "想法",
    milestone: "里程碑",
    release: "发布",
  };
  return labels[type] ?? type;
}

function okBare(request: CommandRequest, correlationId: string, result: Record<string, unknown>): CommandResult {
  return {
    ok: true,
    commandStatus: "accepted",
    settled: true,
    revision: null,
    projectId: request.projectId,
    trackerId: null,
    runId: null,
    correlationId,
    mode: "demo",
    result,
  };
}
