#!/usr/bin/env node
/**
 * Pi vendor-hook adapter. Not a live Pi / Worker connection.
 * Supported envelope: eventVersion = "pi.agent.v1".
 * WorkerEvent kinds (exited/lost/tool/...) map to observations only.
 */
import { PI_VERSIONS, VENDOR_PI, mapFinishedObservation, runVendorMain } from "./vendor-lib.mjs";

const FINISHED_KINDS = new Set(["run.finished", "session.end", "exited", "exit"]);
const LOST_KINDS = new Set(["lost"]);
const TOOL_KINDS = new Set(["tool", "tool.done", "tool.finished"]);
const MESSAGE_KINDS = new Set(["message", "log"]);
const DIFF_KINDS = new Set(["diff"]);
const ARTIFACT_KINDS = new Set(["artifact"]);
const CANCEL_KINDS = new Set(["cancel_ack"]);

export function mapPiEvent(input) {
  const rawType = String(input.kind ?? input.type ?? input.event ?? "");
  if (!rawType) {
    return { ok: false, code: "VALIDATION", message: "Pi 事件缺少 kind/type" };
  }
  const base = mapFinishedObservation(input, rawType, {
    protocol: input.protocol ?? "pi",
    workerId: input.workerId ?? null,
  });
  if (FINISHED_KINDS.has(rawType)) {
    return { ok: true, rawType, event: base };
  }
  if (LOST_KINDS.has(rawType)) {
    return {
      ok: true,
      rawType,
      event: {
        ...base,
        payload: { ...base.payload, vendorResult: "lost", stopped: false, businessComplete: false },
      },
    };
  }
  if (TOOL_KINDS.has(rawType)) {
    return {
      ok: true,
      rawType,
      event: { ...base, type: "tool.finished", payload: { ...base.payload, tool: input.tool ?? input.payload?.tool ?? null } },
    };
  }
  if (MESSAGE_KINDS.has(rawType)) {
    return {
      ok: true,
      rawType,
      event: {
        ...base,
        type: "message.delta",
        payload: { ...base.payload, text: input.text ?? input.payload?.text ?? input.payload?.message ?? "" },
      },
    };
  }
  if (DIFF_KINDS.has(rawType)) {
    return { ok: true, rawType, event: { ...base, type: "diff.updated" } };
  }
  if (ARTIFACT_KINDS.has(rawType)) {
    return { ok: true, rawType, event: { ...base, type: "artifact.added" } };
  }
  if (CANCEL_KINDS.has(rawType)) {
    return { ok: true, rawType, event: { ...base, type: "run.cancel_ack", payload: { ...base.payload, stopped: false } } };
  }
  return { ok: false, code: "VALIDATION", message: `未识别的 Pi 事件类型：${rawType}` };
}

const invoked = process.argv[1] && String(process.argv[1]).replace(/\\/g, "/").includes("vendor-pi");
if (invoked) {
  await runVendorMain({
    vendor: VENDOR_PI,
    supportedVersions: PI_VERSIONS,
    mapVendor: mapPiEvent,
  });
}
