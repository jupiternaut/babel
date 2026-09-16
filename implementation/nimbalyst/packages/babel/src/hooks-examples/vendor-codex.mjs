#!/usr/bin/env node
/**
 * Codex vendor-hook adapter. Not a live Codex connection.
 * Supported envelope: eventVersion = "codex.hook.v1".
 * session.completed / item.completed / turn.completed map to observations only.
 */
import { CODEX_VERSIONS, VENDOR_CODEX, mapFinishedObservation, runVendorMain } from "./vendor-lib.mjs";

const FINISHED_TYPES = new Set([
  "session.completed",
  "item.completed",
  "turn.completed",
  "thread.completed",
  "agent-turn-complete",
  "task_complete",
]);

const STARTED_TYPES = new Set([
  "session.created",
  "session.started",
  "thread.started",
  "turn.started",
]);

export function mapCodexEvent(input) {
  const rawType = String(input.type ?? input.event ?? input.kind ?? "");
  if (!rawType) {
    return { ok: false, code: "VALIDATION", message: "Codex 事件缺少 type" };
  }
  if (FINISHED_TYPES.has(rawType)) {
    return {
      ok: true,
      rawType,
      event: mapFinishedObservation(input, rawType, {
        sessionId: input.sessionId ?? input.session_id ?? null,
        itemId: input.itemId ?? input.item?.id ?? null,
      }),
    };
  }
  if (STARTED_TYPES.has(rawType)) {
    return {
      ok: true,
      rawType,
      event: {
        ...mapFinishedObservation(input, rawType),
        type: "run.started",
        payload: {
          vendorRawType: rawType,
          businessComplete: false,
          sessionId: input.sessionId ?? input.session_id ?? null,
        },
      },
    };
  }
  if (rawType === "agent_message" || rawType === "item.updated") {
    return {
      ok: true,
      rawType,
      event: {
        ...mapFinishedObservation(input, rawType),
        type: "message.delta",
        payload: {
          vendorRawType: rawType,
          businessComplete: false,
          text: input.text ?? input.item?.text ?? input.payload?.text ?? "",
        },
      },
    };
  }
  return { ok: false, code: "VALIDATION", message: `未识别的 Codex 事件类型：${rawType}` };
}

const invoked = process.argv[1] && String(process.argv[1]).replace(/\\/g, "/").includes("vendor-codex");
if (invoked) {
  await runVendorMain({
    vendor: VENDOR_CODEX,
    supportedVersions: CODEX_VERSIONS,
    mapVendor: mapCodexEvent,
  });
}
