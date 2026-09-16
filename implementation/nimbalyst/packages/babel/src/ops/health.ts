import { createHash, randomUUID } from "node:crypto";
import type { HealthObservation, HealthOutcome, RegisteredService, RepairDraft, RepairProvenance, TodoInput } from "./types.ts";

const BODY_LIMIT = 240;

export interface ProbeHttpOptions {
  timeoutMs?: number;
  now?: () => string;
  fetchImpl?: typeof fetch;
}

export async function probeHttp(endpoint: string, options: ProbeHttpOptions = {}): Promise<HealthObservation> {
  const timeoutMs = options.timeoutMs ?? 250;
  const fetchImpl = options.fetchImpl ?? fetch;
  const observedAt = options.now?.() ?? new Date().toISOString();
  const probeId = `probe-${randomUUID()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { method: "GET", signal: controller.signal, redirect: "manual" });
    const raw = await response.text().catch(() => "");
    const bodyExcerpt = raw.trim() ? raw.replace(/\s+/g, " ").slice(0, BODY_LIMIT) : null;
    const outcome: HealthOutcome = response.ok ? "ok" : "http_error";
    return {
      probeId,
      serviceId: "",
      endpoint,
      observedAt,
      outcome,
      statusCode: response.status,
      bodyExcerpt,
      error: outcome === "ok" ? null : `HTTP ${response.status}`,
      mode: "demo",
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    const aborted = name === "AbortError" || /aborted|timeout/i.test(message);
    return {
      probeId,
      serviceId: "",
      endpoint,
      observedAt,
      outcome: aborted ? "timeout" : "unreachable",
      statusCode: null,
      bodyExcerpt: null,
      error: aborted ? `timeout after ${timeoutMs}ms` : message,
      mode: "demo",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function fingerprintOf(serviceId: string, observation: Pick<HealthObservation, "outcome" | "endpoint" | "statusCode">): string {
  return createHash("sha256")
    .update(`${serviceId}|${observation.outcome}|${observation.endpoint}|${observation.statusCode ?? ""}`)
    .digest("hex")
    .slice(0, 24);
}

export function buildRepairDraft(service: RegisteredService, observation: HealthObservation): RepairDraft {
  const provenance: RepairProvenance = {
    sourceKind: "ops.health",
    serviceId: service.serviceId,
    serviceLabel: service.label,
    probeId: observation.probeId,
    endpoint: observation.endpoint,
    observedAt: observation.observedAt,
    outcome: observation.outcome,
    statusCode: observation.statusCode,
    bodyExcerpt: observation.bodyExcerpt,
    error: observation.error,
    fingerprint: fingerprintOf(service.serviceId, observation),
  };
  return {
    draftId: `draft-ops-${provenance.fingerprint}`,
    kind: "ops.repair",
    todo: repairTodoInput(provenance),
    provenance,
    persistReady: true,
    autoExecute: false,
    restartService: false,
    trackerId: null,
  };
}

export function repairTodoInput(provenance: RepairProvenance): TodoInput {
  const status = provenance.statusCode != null ? String(provenance.statusCode) : provenance.outcome;
  return {
    title: `修复：${provenance.serviceLabel} 健康探测失败`,
    primaryType: "task",
    id: `trk-ops-${provenance.fingerprint}`,
    description: [
      `登记服务「${provenance.serviceLabel}」探测失败，需要人工处理。`,
      "",
      "## 出处",
      "",
      `- 来源：ops.health`,
      `- 服务：${provenance.serviceId}`,
      `- 探测：${provenance.probeId}`,
      `- 端点：${provenance.endpoint}`,
      `- 结果：${provenance.outcome}`,
      `- 状态：${status}`,
      `- 观测时间：${provenance.observedAt}`,
      provenance.error ? `- 错误：${provenance.error}` : null,
      provenance.bodyExcerpt ? `- 响应摘录：${provenance.bodyExcerpt}` : null,
      "",
      "探测失败只生成待办，不自动执行，也不重启用户服务。",
    ].filter((line) => line != null).join("\n"),
  };
}
