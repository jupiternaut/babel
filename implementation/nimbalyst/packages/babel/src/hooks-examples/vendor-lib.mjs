#!/usr/bin/env node
/**
 * Shared Codex/Pi vendor-hook adaptation. Vendor config stays here, not in core.
 * Adapting a vendor "finished" event is an observation, never a DONE/review.accept.
 */

export const MAX_CAUSATION_HOPS = 8;
export const VENDOR_CODEX = "codex";
export const VENDOR_PI = "pi";
export const CODEX_VERSIONS = Object.freeze(["codex.hook.v1"]);
export const PI_VERSIONS = Object.freeze(["pi.agent.v1"]);

const SECRET_KEYS = new Set([
  "apiKey",
  "api_key",
  "token",
  "authorization",
  "password",
  "secret",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "PI_API_KEY",
]);

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8") || "{}";
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("不是合法 JSON"), { code: "VALIDATION" });
  }
}

export function parseArg(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  if (next == null || next.startsWith("--")) return true;
  const asNumber = Number(next);
  return Number.isFinite(asNumber) ? asNumber : next;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
}

export function stripSecrets(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = stripSecrets(item, depth + 1);
  }
  return out;
}

export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isBabelEnvelope(input) {
  return Boolean(
    input
    && typeof input === "object"
    && typeof input.type === "string"
    && (input.schemaVersion === 1 || input.eventId)
    && !input.eventVersion
    && !input.vendorEventVersion,
  );
}

export function causationChainOf(input) {
  const raw = input.causationChain ?? input.payload?.causationChain;
  const chain = Array.isArray(raw) ? raw.map(String) : [];
  if (typeof input.causationId === "string" && input.causationId && !chain.includes(input.causationId)) {
    chain.push(input.causationId);
  }
  return chain;
}

export function rejectCausal(input, outgoingType) {
  const eventId = typeof input.eventId === "string" ? input.eventId : "";
  const chain = causationChainOf(input);
  if (eventId && (input.causationId === eventId || chain.includes(eventId))) {
    return {
      ok: false,
      code: "CAUSAL_LOOP",
      message: "因果链出现自引用，拒绝以免递归",
      businessComplete: false,
    };
  }
  if (chain.length > MAX_CAUSATION_HOPS) {
    return {
      ok: false,
      code: "CAUSAL_LIMIT",
      message: `因果链超过 ${MAX_CAUSATION_HOPS} 跳`,
      businessComplete: false,
    };
  }
  const types = Array.isArray(input.causationTypes) ? input.causationTypes.map(String) : [];
  if (outgoingType && types.filter((type) => type === outgoingType).length >= 2) {
    return {
      ok: false,
      code: "CAUSAL_LOOP",
      message: "同类事件在因果链中重复出现，拒绝以免递归",
      businessComplete: false,
    };
  }
  const source = asRecord(input.source);
  if (outgoingType && input.type === outgoingType && source.vendor && types.includes(outgoingType)) {
    return {
      ok: false,
      code: "CAUSAL_LOOP",
      message: "适配器不得把已适配的同类事件再生成一遍",
      businessComplete: false,
    };
  }
  return null;
}

export function rejectUnauthorized(input) {
  const projectId = input.projectId ?? input.payload?.projectId ?? null;
  const actor = asRecord(input.actor);
  const projectIds = Array.isArray(actor.projectIds) ? actor.projectIds.map(String) : null;
  if (projectIds && projectId && !projectIds.includes(String(projectId))) {
    return {
      ok: false,
      code: "PERMISSION",
      message: "无权访问该项目",
      businessComplete: false,
      details: { projectId },
    };
  }
  if (input.subscribe === true && !projectId) {
    return {
      ok: false,
      code: "UNAUTHORIZED_STREAM",
      message: "事件流必须指定 projectId",
      businessComplete: false,
    };
  }
  return null;
}

export function rejectVersion(input, vendor, supported) {
  const version = String(input.eventVersion ?? input.vendorEventVersion ?? "");
  if (!version) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "缺少 eventVersion",
      businessComplete: false,
    };
  }
  if (!supported.includes(version)) {
    return {
      ok: false,
      code: "UNKNOWN_VERSION",
      message: `不支持的 ${vendor} 事件版本：${version}`,
      businessComplete: false,
      details: { eventVersion: version, supported },
    };
  }
  return null;
}

function resultFromVendorStatus(status) {
  const value = String(status ?? "").toLowerCase();
  if (["failed", "error", "fail", "exited-nonzero"].includes(value)) return "failed";
  if (["cancelled", "canceled", "cancel"].includes(value)) return "cancelled";
  if (["lost", "disconnected"].includes(value)) return "lost";
  if (["succeeded", "success", "completed", "complete", "ok", "exited"].includes(value)) return "succeeded";
  return "unknown";
}

export function observationEvent(partial) {
  const projectId = partial.projectId ?? null;
  const trackerId = partial.trackerId ?? partial.taskId ?? null;
  const runId = partial.runId ?? null;
  return {
    schemaVersion: 1,
    eventId: partial.eventId ?? null,
    projectId,
    trackerId,
    taskId: trackerId,
    runId,
    type: partial.type,
    streamId: partial.streamId ?? (runId ? `run:${runId}` : trackerId ? `task:${projectId}:${trackerId}` : `project:${projectId ?? "none"}`),
    seq: partial.seq ?? null,
    cursor: partial.cursor ?? null,
    revision: partial.revision ?? null,
    occurredAt: partial.occurredAt ?? null,
    correlationId: partial.correlationId ?? null,
    causationId: partial.causationId ?? null,
    mode: partial.mode ?? "demo",
    payload: stripSecrets(asRecord(partial.payload)),
  };
}

export function adaptSuccess({ vendor, eventVersion, rawType, event, notes }) {
  return {
    ok: true,
    adapted: true,
    observationOnly: true,
    businessComplete: false,
    source: {
      vendor,
      eventVersion,
      rawType,
      adapter: vendor === VENDOR_CODEX ? "vendor-codex.mjs" : "vendor-pi.mjs",
    },
    event: observationEvent(event),
    notes: notes ?? "厂商 finished/completed 只是观察，不能代替权威查询或验收",
  };
}

export function timedOutResult(reason) {
  return {
    ok: false,
    timedOut: true,
    code: "HOOK_TIMEOUT",
    message: reason ?? "厂商适配超时",
    businessComplete: false,
  };
}

export function writeResult(result, exitCode) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(exitCode);
}

export async function runVendorMain({ vendor, supportedVersions, mapVendor }) {
  const timeoutMs = Number(parseArg("timeout-ms", 0)) || 0;
  const sleepMs = Number(parseArg("sleep-ms", 0)) || 0;
  const work = (async () => {
    if (sleepMs > 0) {
      if (timeoutMs > 0 && sleepMs >= timeoutMs) {
        return timedOutResult(`厂商适配超时：sleep ${sleepMs}ms >= timeout ${timeoutMs}ms`);
      }
      await sleep(sleepMs);
    }
    const input = stripSecrets(asRecord(await readStdinJson()));
    const unauthorized = rejectUnauthorized(input);
    if (unauthorized) return unauthorized;
    if (isBabelEnvelope(input)) {
      const outgoingType = String(input.type);
      const causal = rejectCausal(input, outgoingType);
      if (causal) return causal;
      return {
        ok: true,
        adapted: false,
        passthrough: true,
        observationOnly: true,
        businessComplete: false,
        source: {
          vendor,
          eventVersion: "babel.event.v1",
          rawType: outgoingType,
          adapter: vendor === VENDOR_CODEX ? "vendor-codex.mjs" : "vendor-pi.mjs",
        },
        event: observationEvent(input),
        notes: "已是 Babel 事件：观察投递，不能当作业务完成",
      };
    }
    const versionError = rejectVersion(input, vendor, supportedVersions);
    if (versionError) return versionError;
    const mapped = mapVendor(input);
    if (!mapped.ok) return { ...mapped, businessComplete: false };
    const causal = rejectCausal(input, mapped.event.type);
    if (causal) return causal;
    return adaptSuccess({
      vendor,
      eventVersion: String(input.eventVersion ?? input.vendorEventVersion),
      rawType: mapped.rawType,
      event: mapped.event,
    });
  })();

  if (timeoutMs > 0 && sleepMs <= 0) {
    const raced = await Promise.race([
      work,
      sleep(timeoutMs).then(() => timedOutResult(`厂商适配超时：${timeoutMs}ms`)),
    ]);
    finish(raced);
    return;
  }
  finish(await work);
}

function finish(result) {
  if (result.timedOut) writeResult(result, 8);
  if (result.ok) writeResult(result, 0);
  const code = result.code === "PERMISSION" || result.code === "UNAUTHORIZED_STREAM" ? 5 : 2;
  writeResult(result, code);
}

export function mapFinishedObservation(input, rawType, extraPayload = {}) {
  const status = input.status ?? input.exitCode ?? input.payload?.status ?? input.payload?.result;
  return {
    type: "run.finished",
    eventId: input.eventId ?? null,
    projectId: input.projectId ?? input.payload?.projectId ?? null,
    trackerId: input.trackerId ?? input.taskId ?? input.payload?.trackerId ?? null,
    runId: input.runId ?? input.sessionId ?? input.session_id ?? input.payload?.runId ?? null,
    streamId: input.streamId ?? null,
    seq: input.seq ?? null,
    cursor: input.cursor ?? null,
    revision: input.revision ?? null,
    occurredAt: input.occurredAt ?? input.at ?? null,
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    mode: input.mode ?? "demo",
    payload: {
      vendorResult: resultFromVendorStatus(status),
      vendorRawType: rawType,
      businessComplete: false,
      ...extraPayload,
    },
  };
}
