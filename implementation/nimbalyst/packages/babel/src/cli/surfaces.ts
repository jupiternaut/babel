import { BabelError } from "../contracts.ts";
import {
  DEFAULT_OVERLAP_WINDOW_MS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  GoogleTasksImporter,
  MemoryGoogleTasksHttp,
  SYNTHETIC_ACCOUNT_ID,
  SyntheticGoogleTasksAuth,
  refuseUserOAuthTokens,
} from "../connectors/google-tasks/index.ts";
import { SAMPLE_PDF, locateBilingual, type PdfAnchor } from "../gateway/pdf-anchors.ts";
import { SyntheticNodeHost } from "../nodes/index.ts";
import { NODES_SCRATCH_ROOT } from "../nodes/paths.ts";
import { OpsService } from "../ops/index.ts";
import { readInputJson, type CliFlags } from "./parse.ts";

export const SURFACE_RESOURCES = ["google-tasks", "node", "ops", "pdf"] as const;

export type SurfaceResource = (typeof SURFACE_RESOURCES)[number];

export const SURFACE_COMMANDS = [
  "google-tasks status",
  "google-tasks pull",
  "node list",
  "ops health",
  "pdf locate",
] as const;

const GOOGLE_POLL_INTERVAL_SECONDS = DEFAULT_POLL_INTERVAL_SECONDS;
const GOOGLE_OVERLAP_WINDOW_SECONDS = Math.floor(DEFAULT_OVERLAP_WINDOW_MS / 1000);

export function isSurfaceResource(resource: string): resource is SurfaceResource {
  return (SURFACE_RESOURCES as readonly string[]).includes(resource);
}

export async function dispatchSurface(flags: CliFlags): Promise<Record<string, unknown>> {
  const [resource, action] = flags.rest;
  if (!resource || !isSurfaceResource(resource)) {
    throw new BabelError("USAGE", "未知后续入口");
  }
  const input = flags.inputPath ? await readOptionalInput(flags.inputPath) : {};
  const verb = action ?? defaultVerb(resource);

  if (resource === "google-tasks") {
    if (verb === "status" || verb === "get") {
      return googleTasksStatus();
    }
    if (verb === "pull" || verb === "try-pull" || verb === "try_pull") {
      const tasklistId = firstString(flags.tasklist, input.tasklistId, input.tasklist);
      if (!tasklistId) {
        throw new BabelError("USAGE", "google-tasks pull 需要 --tasklist");
      }
      return googleTasksTryPull(tasklistId);
    }
    throw new BabelError("USAGE", `未知 google-tasks 动作 ${verb}`);
  }

  if (resource === "node") {
    if (verb === "list" || verb === "get") {
      return nodeList();
    }
    throw new BabelError("USAGE", `未知 node 动作 ${verb}`);
  }

  if (resource === "ops") {
    if (verb === "health" || verb === "get") {
      const serviceId = firstString(flags.service, input.serviceId);
      return opsHealth(serviceId);
    }
    throw new BabelError("USAGE", `未知 ops 动作 ${verb}`);
  }

  if (resource === "pdf") {
    if (verb !== "locate") {
      throw new BabelError("USAGE", action ? `未知 pdf 动作 ${verb}` : "pdf locate 需要 --quote");
    }
    const quote = firstString(flags.quote, flags.text, input.quote);
    if (!quote) {
      throw new BabelError("USAGE", "pdf locate 需要 --quote");
    }
    return pdfLocate(quote);
  }

  throw new BabelError("USAGE", `未知命令 ${resource}`);
}

function defaultVerb(resource: SurfaceResource): string {
  switch (resource) {
    case "google-tasks":
      return "status";
    case "node":
      return "list";
    case "ops":
      return "health";
    case "pdf":
      return "locate";
  }
}

export function googleTasksStatus(): Record<string, unknown> {
  const auth = new SyntheticGoogleTasksAuth();
  const session = auth.currentSession();
  const refused = refuseUserOAuthTokens();
  const connected = Boolean(session?.authorized) && !session?.reauthRequired;
  return {
    ok: true,
    name: "google-tasks.status",
    mode: "demo",
    settled: true,
    realSync: false,
    oauthStarted: false,
    pulled: false,
    access: connected ? "演示" : "未接入",
    syncLabel: connected ? "演示" : "未接入",
    syncNote: connected
      ? "合成会话仅用于演示。不是真实 Google 同步成功。"
      : "没有真账号。未接入 Google Tasks，不显示同步成功。",
    connectionNote: "演示数据。TUI/CLI 只查询合成状态，不会打开外部图形窗口，也不读取用户 OAuth token。",
    pollIntervalSeconds: GOOGLE_POLL_INTERVAL_SECONDS,
    overlapWindowSeconds: GOOGLE_OVERLAP_WINDOW_SECONDS,
    usedUserToken: refused.usedUserToken,
    refuseReason: refused.reason,
    loginStart: {
      kind: "synthetic",
      oauthStarted: false,
      authorizationUrl: null,
    },
    session: session
      ? {
          mode: session.mode,
          accountId: session.accountId,
          authorized: session.authorized,
          reauthRequired: session.reauthRequired,
          usedUserToken: session.usedUserToken,
        }
      : null,
    accountId: session?.accountId ?? null,
  };
}

export async function googleTasksTryPull(tasklistId: string): Promise<Record<string, unknown>> {
  if (!tasklistId.trim()) {
    throw new BabelError("USAGE", "google-tasks pull 需要 --tasklist");
  }
  const status = googleTasksStatus();
  const auth = new SyntheticGoogleTasksAuth();
  const http = new MemoryGoogleTasksHttp({
    accountId: SYNTHETIC_ACCOUNT_ID,
    pages: {},
  });
  const importer = new GoogleTasksImporter(http, auth);
  const sync = await importer.pull({
    tasklistId: tasklistId.trim(),
    local: [],
  });
  return {
    ok: true,
    name: "google-tasks.pull",
    mode: "demo",
    settled: true,
    realSync: false,
    oauthStarted: false,
    pulled: false,
    access: "未接入",
    tasklistId: tasklistId.trim(),
    selectedListNote: "未选择真实列表。没有真账号时不会导入，也不会创建 Google 列表。",
    note: "试拉走合成内存页。没有真账号，不会同步成功。",
    pollIntervalSeconds: GOOGLE_POLL_INTERVAL_SECONDS,
    overlapWindowSeconds: GOOGLE_OVERLAP_WINDOW_SECONDS,
    usedUserToken: false,
    loginStart: status.loginStart,
    sync: {
      mode: sync.mode,
      realSync: sync.realSync,
      ok: sync.ok,
      reauthRequired: sync.reauthRequired,
      error: sync.error ?? "未接入",
      imported: sync.imported,
      skipped: sync.skipped,
      conflicts: sync.conflicts,
      pagesFetched: sync.pagesFetched,
      pagesPersisted: sync.pagesPersisted,
    },
  };
}

export function nodeList(): Record<string, unknown> {
  try {
    const host = new SyntheticNodeHost({
      isolationRoot: `${NODES_SCRATCH_ROOT}/lr-16-surfaces`,
    });
    const listed = host.query("node.list");
    return {
      ok: true,
      name: "node.list",
      settled: true,
      access: "未接入",
      connected: false,
      note: "合成节点列表。未接真机，不扫描局域网，也不打开外部图形窗口。",
      ...listed,
      realMachine: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法列出合成节点";
    throw new BabelError("UNAVAILABLE", message);
  }
}

export function opsHealth(serviceId?: string): Record<string, unknown> {
  const ops = new OpsService();
  const queried = ops.query({
    name: "ops.health.get",
    input: serviceId ? { serviceId } : {},
  });
  return {
    ...queried,
    ok: true,
    name: "ops.health.get",
    settled: true,
    mode: "demo",
    access: "未接入",
    connected: false,
    note: "运维健康说明（演示）。未登记真实服务，探测不会自动执行或重启。",
    autoExecute: false,
    restartAttempted: false,
    probed: false,
    serviceId: serviceId ?? null,
  };
}

export function pdfLocate(quote: string): Record<string, unknown> {
  const trimmed = quote.trim();
  if (!trimmed) {
    throw new BabelError("USAGE", "pdf locate 需要 --quote");
  }
  const anchor = locateBilingual(SAMPLE_PDF, trimmed);
  return {
    ok: true,
    name: "pdf.locate",
    settled: true,
    mode: "demo",
    found: Boolean(anchor),
    liveTranslation: false,
    source: "test-fixture",
    documentId: SAMPLE_PDF.documentId,
    revision: SAMPLE_PDF.revision,
    quote: trimmed,
    anchor: anchor ? serializeAnchor(anchor) : null,
    note: anchor
      ? "命中本地演示样本。这是测试锚点，不是真实译文，也不打开外部阅读器。"
      : "本地样本中没有这段文字。不是真实译文，也不表示定位成功。",
  };
}

function serializeAnchor(anchor: PdfAnchor): PdfAnchor {
  return {
    documentId: anchor.documentId,
    revision: anchor.revision,
    page: anchor.page,
    paragraphId: anchor.paragraphId,
    quote: anchor.quote,
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function readOptionalInput(inputPath: string): Promise<Record<string, unknown>> {
  return readInputJson(inputPath);
}
