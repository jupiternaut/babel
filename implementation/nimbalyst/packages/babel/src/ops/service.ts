import { randomUUID } from "node:crypto";
import type { DomainService } from "../core/domain.ts";
import { BabelError, DEFAULT_PROJECT_ID } from "../contracts.ts";
import { SyntheticChatSource, type ChatMessageSource } from "./chat-adapter.ts";
import { buildRepairDraft, probeHttp } from "./health.ts";
import { buildChatDraft } from "./inbox.ts";
import { persistTodoInput } from "./persist.ts";
import {
  CHAT_ADAPTER_ID,
  CHAT_VENDOR,
  OPS_MODE,
  type ChatAdapterInfo,
  type ChatDraft,
  type ChatMessage,
  type HealthObservation,
  type OpsCommandName,
  type OpsCommandRequest,
  type OpsCommandResult,
  type OpsEvent,
  type OpsQueryName,
  type OpsQueryRequest,
  type RegisteredService,
  type RepairDraft,
} from "./types.ts";

const COMMANDS = new Set<OpsCommandName>([
  "ops.service.register",
  "ops.health.probe",
  "ops.repair.create",
  "ops.repair.execute",
  "ops.service.restart",
  "chat.inbox.ingest",
  "chat.inbox.preview",
  "chat.inbox.confirm",
  "chat.inbox.reject",
]);

export interface OpsServiceOptions {
  domain?: DomainService;
  projectId?: string;
  chatSource?: ChatMessageSource;
  now?: () => string;
  fetchImpl?: typeof fetch;
  probeTimeoutMs?: number;
}

export class OpsService {
  readonly projectId: string;
  private readonly domain?: DomainService;
  private readonly chatSource: ChatMessageSource;
  private readonly nowFn?: () => string;
  private readonly fetchImpl?: typeof fetch;
  private readonly probeTimeoutMs: number;
  private readonly services = new Map<string, RegisteredService>();
  private readonly observations = new Map<string, HealthObservation>();
  private readonly repairDrafts = new Map<string, RepairDraft>();
  private readonly chatDrafts = new Map<string, ChatDraft>();
  private readonly inbox: ChatMessage[] = [];
  private readonly events: OpsEvent[] = [];
  private readonly idempotency = new Map<string, OpsCommandResult>();
  private cursor = 0;

  constructor(options: OpsServiceOptions = {}) {
    this.domain = options.domain;
    this.projectId = options.projectId ?? DEFAULT_PROJECT_ID;
    this.chatSource = options.chatSource ?? new SyntheticChatSource();
    this.nowFn = options.now;
    this.fetchImpl = options.fetchImpl;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 250;
  }

  eventsSince(cursor = 0): OpsEvent[] {
    return this.events.filter((event) => event.cursor > cursor).map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async command(request: OpsCommandRequest): Promise<OpsCommandResult> {
    if (!COMMANDS.has(request.name)) {
      throw new BabelError("USAGE", `未知运维命令：${String(request.name)}`);
    }
    const projectId = request.projectId || this.projectId;
    if (!projectId) throw new BabelError("USAGE", "缺少 projectId");
    if (projectId !== this.projectId) {
      throw new BabelError("PERMISSION", "无权访问该项目的运维命名空间", { projectId });
    }
    if (request.idempotencyKey) {
      const replayed = this.idempotency.get(`${request.name}:${request.idempotencyKey}`);
      if (replayed) return { ...replayed, commandStatus: "replayed" };
    }
    const correlationId = request.correlationId ?? `corr-${randomUUID()}`;
    const result = await this.dispatch(request, projectId, correlationId);
    if (request.idempotencyKey) this.idempotency.set(`${request.name}:${request.idempotencyKey}`, result);
    return result;
  }

  query(request: OpsQueryRequest): Record<string, unknown> {
    const projectId = request.projectId ?? this.projectId;
    if (projectId !== this.projectId) {
      throw new BabelError("PERMISSION", "无权访问该项目的运维命名空间", { projectId });
    }
    const input = request.input ?? {};
    switch (request.name as OpsQueryName) {
      case "ops.service.list":
        return {
          mode: OPS_MODE,
          services: [...this.services.values()].map((row) => ({ ...row })),
        };
      case "ops.health.get": {
        const serviceId = input.serviceId != null ? String(input.serviceId) : "";
        const observation = serviceId ? this.observations.get(serviceId) ?? null : null;
        const draft = observation
          ? [...this.repairDrafts.values()].find((row) => row.provenance.serviceId === serviceId) ?? null
          : null;
        return {
          mode: OPS_MODE,
          service: serviceId ? this.services.get(serviceId) ?? null : null,
          observation,
          draft,
          autoExecute: false,
          restartAttempted: false,
        };
      }
      case "ops.repair.drafts":
        return {
          mode: OPS_MODE,
          drafts: [...this.repairDrafts.values()].map((row) => ({ ...row, todo: { ...row.todo }, provenance: { ...row.provenance } })),
        };
      case "chat.inbox.list":
        return {
          mode: OPS_MODE,
          messages: this.inbox.map((row) => ({ ...row })),
          drafts: [...this.chatDrafts.values()].map((row) => ({ ...row })),
        };
      case "chat.inbox.draft.get": {
        const draftId = input.draftId != null ? String(input.draftId) : "";
        const messageId = input.messageId != null ? String(input.messageId) : "";
        const draft = draftId
          ? this.chatDrafts.get(draftId) ?? null
          : [...this.chatDrafts.values()].find((row) => row.provenance.messageId === messageId) ?? null;
        return { mode: OPS_MODE, draft };
      }
      case "chat.adapter.info":
        return {
          mode: OPS_MODE,
          adapterId: CHAT_ADAPTER_ID,
          vendor: CHAT_VENDOR,
          selectedVendor: null,
          element: false,
          fluxer: false,
          deployedChatServer: false,
          contract: "neutral-synthetic",
        } satisfies ChatAdapterInfo;
      case "ops.events.list": {
        const after = Number(input.cursor ?? 0);
        return { mode: OPS_MODE, cursor: this.cursor, events: this.eventsSince(after) };
      }
      default:
        throw new BabelError("USAGE", `未知运维查询：${String(request.name)}`);
    }
  }

  private async dispatch(request: OpsCommandRequest, projectId: string, correlationId: string): Promise<OpsCommandResult> {
    const input = request.input ?? {};
    switch (request.name) {
      case "ops.service.register":
        return this.registerService(projectId, input, correlationId);
      case "ops.health.probe":
        return this.probeService(projectId, input, correlationId);
      case "ops.repair.create":
        return this.createRepair(projectId, input, correlationId);
      case "ops.repair.execute":
        throw new BabelError("PRECONDITION", "修复待办须经正常启动流程，运维探测不会代为执行");
      case "ops.service.restart":
        throw new BabelError("PRECONDITION", "不允许自动重启登记服务");
      case "chat.inbox.ingest":
        return this.ingestChat(projectId, input, correlationId);
      case "chat.inbox.preview":
        return this.previewChat(projectId, input, correlationId);
      case "chat.inbox.confirm":
        return this.confirmChat(projectId, input, correlationId);
      case "chat.inbox.reject":
        return this.rejectChat(projectId, input, correlationId);
    }
  }

  private registerService(projectId: string, input: Record<string, unknown>, correlationId: string): OpsCommandResult {
    const serviceId = str(input.serviceId ?? input.id);
    const endpoint = str(input.endpoint ?? input.url);
    const label = String(input.label ?? serviceId);
    if (!/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(endpoint) && !/^https?:\/\/localhost(?::\d+)?(?:\/|$)/i.test(endpoint)) {
      throw new BabelError("VALIDATION", "健康探测只接受本机回环合成端点", { endpoint });
    }
    const service: RegisteredService = {
      serviceId,
      label,
      endpoint,
      kind: "synthetic-http",
      projectId,
    };
    this.services.set(serviceId, service);
    this.emit(projectId, "ops.service.registered", correlationId, serviceId, { service });
    return this.ok(projectId, correlationId, null, { service });
  }

  private async probeService(projectId: string, input: Record<string, unknown>, correlationId: string): Promise<OpsCommandResult> {
    const serviceId = str(input.serviceId ?? input.id);
    const service = this.services.get(serviceId);
    if (!service) throw new BabelError("NOT_FOUND", "没有这条登记服务", { serviceId });
    const observation = await probeHttp(service.endpoint, {
      timeoutMs: Number(input.timeoutMs ?? this.probeTimeoutMs),
      now: this.nowFn,
      fetchImpl: this.fetchImpl,
    });
    observation.serviceId = service.serviceId;
    this.observations.set(service.serviceId, observation);
    const eventType = observation.outcome === "ok" ? "ops.health.ok" : "ops.health.failed";
    this.emit(projectId, eventType, correlationId, null, { observation, autoExecute: false, restartAttempted: false });
    let draft: RepairDraft | null = null;
    if (observation.outcome !== "ok") {
      draft = buildRepairDraft(service, observation);
      const existing = this.repairDrafts.get(draft.draftId);
      if (existing?.trackerId) draft.trackerId = existing.trackerId;
      this.repairDrafts.set(draft.draftId, draft);
      this.emit(projectId, "ops.repair.drafted", correlationId, draft.trackerId, {
        draftId: draft.draftId,
        todo: draft.todo,
        provenance: draft.provenance,
        autoExecute: false,
      });
      if (input.persistRepair === true) {
        return this.createRepair(projectId, { draftId: draft.draftId }, correlationId);
      }
    }
    return this.ok(projectId, correlationId, draft?.trackerId ?? null, {
      observation,
      draft,
      autoExecute: false,
      restartAttempted: false,
      persisted: false,
    });
  }

  private async createRepair(projectId: string, input: Record<string, unknown>, correlationId: string): Promise<OpsCommandResult> {
    const draftId = input.draftId != null ? String(input.draftId) : "";
    const serviceId = input.serviceId != null ? String(input.serviceId) : "";
    const draft = draftId
      ? this.repairDrafts.get(draftId)
      : [...this.repairDrafts.values()].find((row) => row.provenance.serviceId === serviceId);
    if (!draft) throw new BabelError("NOT_FOUND", "没有这条修复待办草稿", { draftId, serviceId });
    if (!this.domain) {
      return this.ok(projectId, correlationId, null, { draft, persisted: false, reason: "todo-input-only" });
    }
    const created = await persistTodoInput(this.domain, projectId, draft.todo, `ops-repair:${draft.provenance.fingerprint}`, correlationId);
    draft.trackerId = created.trackerId;
    this.repairDrafts.set(draft.draftId, draft);
    this.emit(projectId, "ops.repair.created", correlationId, created.trackerId, {
      draftId: draft.draftId,
      trackerId: created.trackerId,
      provenance: draft.provenance,
      autoExecute: false,
      runId: null,
    });
    return this.ok(projectId, correlationId, created.trackerId, {
      draft,
      persisted: true,
      revision: created.revision,
      domainCorrelationId: created.correlationId,
      autoExecute: false,
      runId: null,
    }, created.revision);
  }

  private ingestChat(projectId: string, input: Record<string, unknown>, correlationId: string): OpsCommandResult {
    const roomId = input.roomId != null ? String(input.roomId) : undefined;
    const pushed = Array.isArray(input.messages) ? input.messages.map((row) => asMessage(row)) : this.chatSource.listMessages(roomId);
    const accepted: ChatMessage[] = [];
    for (const message of pushed) {
      if (this.inbox.some((row) => row.messageId === message.messageId)) continue;
      this.inbox.push(message);
      accepted.push(message);
      this.emit(projectId, "chat.message.ingested", correlationId, null, { message, savedTodo: false });
    }
    return this.ok(projectId, correlationId, null, { accepted, savedTodo: false, runId: null });
  }

  private previewChat(projectId: string, input: Record<string, unknown>, correlationId: string): OpsCommandResult {
    const messageId = str(input.messageId ?? input.id);
    const message = this.inbox.find((row) => row.messageId === messageId);
    if (!message) throw new BabelError("NOT_FOUND", "收件箱里没有这条消息", { messageId });
    const existing = [...this.chatDrafts.values()].find((row) => row.provenance.messageId === messageId);
    const draft = existing ?? buildChatDraft(message);
    this.chatDrafts.set(draft.draftId, draft);
    this.emit(projectId, "chat.todo.previewed", correlationId, draft.trackerId, {
      draftId: draft.draftId,
      todo: draft.todo,
      provenance: draft.provenance,
      confirmed: draft.confirmed,
    });
    return this.ok(projectId, correlationId, draft.trackerId, { draft, saved: Boolean(draft.trackerId) });
  }

  private async confirmChat(projectId: string, input: Record<string, unknown>, correlationId: string): Promise<OpsCommandResult> {
    if (input.confirmed !== true) {
      throw new BabelError("PRECONDITION", "用户未确认，消息不会保存为待办");
    }
    const draft = this.requireChatDraft(input);
    if (draft.rejected) throw new BabelError("PRECONDITION", "该草稿已被拒绝，不会保存为待办");
    if (draft.trackerId) {
      return this.ok(projectId, correlationId, draft.trackerId, { draft, persisted: true, replayed: true, runId: null });
    }
    if (!this.domain) {
      draft.confirmed = true;
      this.chatDrafts.set(draft.draftId, draft);
      return this.ok(projectId, correlationId, null, { draft, persisted: false, reason: "todo-input-only" });
    }
    const created = await persistTodoInput(this.domain, projectId, draft.todo, `chat-inbox:${draft.provenance.fingerprint}`, correlationId);
    draft.confirmed = true;
    draft.trackerId = created.trackerId;
    this.chatDrafts.set(draft.draftId, draft);
    this.emit(projectId, "chat.todo.saved", correlationId, created.trackerId, {
      draftId: draft.draftId,
      trackerId: created.trackerId,
      provenance: draft.provenance,
      confirmedBy: input.confirmedBy != null ? String(input.confirmedBy) : null,
      runId: null,
    });
    return this.ok(projectId, correlationId, created.trackerId, {
      draft,
      persisted: true,
      revision: created.revision,
      runId: null,
    }, created.revision);
  }

  private rejectChat(projectId: string, input: Record<string, unknown>, correlationId: string): OpsCommandResult {
    const draft = this.requireChatDraft(input);
    if (draft.trackerId) throw new BabelError("PRECONDITION", "待办已保存，不能再拒绝该草稿");
    draft.rejected = true;
    this.chatDrafts.set(draft.draftId, draft);
    this.emit(projectId, "chat.todo.rejected", correlationId, null, { draftId: draft.draftId, messageId: draft.provenance.messageId });
    return this.ok(projectId, correlationId, null, { draft, persisted: false });
  }

  private requireChatDraft(input: Record<string, unknown>): ChatDraft {
    const draftId = input.draftId != null ? String(input.draftId) : "";
    const messageId = input.messageId != null ? String(input.messageId) : "";
    const draft = draftId
      ? this.chatDrafts.get(draftId)
      : [...this.chatDrafts.values()].find((row) => row.provenance.messageId === messageId);
    if (!draft) throw new BabelError("NOT_FOUND", "没有这条聊天待办草稿", { draftId, messageId });
    return draft;
  }

  private emit(
    projectId: string,
    type: string,
    correlationId: string,
    trackerId: string | null,
    payload: Record<string, unknown>,
  ): OpsEvent {
    this.cursor += 1;
    const event: OpsEvent = {
      eventId: `evt-${randomUUID()}`,
      type,
      cursor: this.cursor,
      correlationId,
      projectId,
      trackerId,
      occurredAt: this.nowFn?.() ?? new Date().toISOString(),
      mode: OPS_MODE,
      payload,
    };
    this.events.push(event);
    return event;
  }

  private ok(
    projectId: string,
    correlationId: string,
    trackerId: string | null,
    result: Record<string, unknown>,
    revision: number | null = null,
  ): OpsCommandResult {
    return {
      ok: true,
      commandStatus: "accepted",
      settled: true,
      revision,
      projectId,
      trackerId,
      runId: null,
      correlationId,
      mode: OPS_MODE,
      result,
    };
  }
}

function str(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) throw new BabelError("VALIDATION", "缺少必填字段");
  return text;
}

function asMessage(value: unknown): ChatMessage {
  if (!value || typeof value !== "object") throw new BabelError("VALIDATION", "消息格式无效");
  const row = value as Record<string, unknown>;
  return {
    messageId: str(row.messageId ?? row.id),
    roomId: String(row.roomId ?? "synthetic-room"),
    authorId: String(row.authorId ?? "synthetic-author"),
    text: String(row.text ?? row.body ?? ""),
    sentAt: String(row.sentAt ?? new Date().toISOString()),
  };
}
