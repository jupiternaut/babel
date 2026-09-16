import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AcceptanceItem,
  type DeviceRecord,
  type ExecutionBinding,
  type ProjectRecord,
  type RunRecord,
  type SavedView,
  type TrackerRecord,
  categoryOfStatus,
} from "../contracts.ts";
import { emptySnapshot, type Snapshot } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface DesignFixtures {
  schemaVersion: number;
  mode: string;
  demoLabel: string;
  fixedNow: string;
  projectId: string;
  devices: Array<{ id: string; label: string; displayStatus: string }>;
  baseRecords: Array<{
    trackerId: string;
    primaryType: string;
    title: string;
    body: string;
    revision: number;
    nativeStatusSymbol: string;
    archived: boolean;
    expectedStage: string;
    originLabel?: string;
    deviceId: string | null;
    latestRunId: string | null;
  }>;
  baseRuns: Array<{
    runId: string;
    trackerId: string;
    attempt: number;
    status: string;
    deviceId: string;
    endedAt: string | null;
    summary: string;
  }>;
  presentationData: {
    V02?: { acceptance?: string[] };
    V03?: { message?: string; toolActivities?: Array<{ label: string; state: string }>; diffSummary?: { files: number; additions: number; deletions: number } };
    V04?: { baseLabel?: string; changedFiles?: string[]; acceptance?: Array<{ label: string; state: string }> };
  };
}

export const SEMANTIC_DEMO_TRACKER_IDS = [
  "fixture-tracker-approved",
  "fixture-tracker-wont",
  "fixture-tracker-release",
  "fixture-tracker-dup-archived",
  "fixture-tracker-plan",
  "fixture-tracker-decision",
  "fixture-tracker-idea",
  "fixture-tracker-milestone",
  "fixture-tracker-readonly",
] as const;

export function loadDesignFixtures(explicitPath?: string): DesignFixtures {
  const file = explicitPath ?? path.resolve(here, "../../fixtures/demo-fixtures.json");
  return JSON.parse(readFileSync(file, "utf8")) as DesignFixtures;
}

function record(partial: Omit<TrackerRecord, "syncStatus" | "typeTags" | "content" | "system" | "orderKey"> & {
  typeTags?: string[];
  origin?: { kind: string; externalId?: string };
  readOnly?: boolean;
  documentPath?: string;
  createdAt: string;
  orderKey: string;
  acceptance?: AcceptanceItem[];
  dependsOn?: string[];
}): TrackerRecord {
  return {
    id: partial.id,
    projectId: partial.projectId,
    primaryType: partial.primaryType,
    typeTags: partial.typeTags ?? [partial.primaryType],
    issueKey: partial.issueKey,
    source: partial.source,
    sourceRef: partial.sourceRef,
    archived: partial.archived,
    syncStatus: "synced",
    content: { format: "markdown", markdown: String(partial.fields.description ?? "") },
    system: {
      workspace: partial.projectId,
      createdAt: partial.createdAt,
      updatedAt: partial.createdAt,
      origin: partial.origin,
      readOnly: partial.readOnly,
      documentPath: partial.documentPath,
      comments: [],
      activity: [],
      linkedSessions: [],
    },
    fields: {
      ...partial.fields,
      acceptance: partial.acceptance ?? partial.fields.acceptance ?? [],
      dependsOn: partial.dependsOn ?? partial.fields.dependsOn ?? [],
      blocks: partial.fields.blocks ?? [],
    },
    revision: partial.revision,
    orderKey: partial.orderKey,
  };
}

export function buildDemoSnapshot(design: DesignFixtures, profileWorkdir: string): Snapshot {
  const now = design.fixedNow;
  const snap = emptySnapshot(now);
  snap.projects = [
    { id: design.projectId, name: "巴别塔", workdir: profileWorkdir },
    { id: "fixture-project-research", name: "研究项目", workdir: path.join(path.dirname(profileWorkdir), "research") },
  ];
  snap.devices = design.devices.map((d): DeviceRecord => ({
    id: d.id,
    label: d.label,
    displayStatus: d.displayStatus,
    available: d.displayStatus.includes("在线"),
  }));

  const acceptPdf: AcceptanceItem[] = (design.presentationData.V02?.acceptance ?? []).map((text, i) => ({
    id: `acc-pdf-${i + 1}`,
    text,
    required: true,
  }));

  for (const [index, row] of design.baseRecords.entries()) {
    const origin = row.originLabel
      ? { kind: "google_tasks", externalId: `gt-${row.trackerId}` }
      : { kind: "manual" };
    const acceptance = row.trackerId === "fixture-tracker-pdf"
      ? acceptPdf
      : row.trackerId === "fixture-tracker-research"
        ? [{ id: "acc-research-1", text: "入口能打开原文件位置", required: true }]
        : row.trackerId === "fixture-tracker-sync"
          ? [
              { id: "acc-sync-1", text: "重复导入不会产生第二条记录", required: true },
              { id: "acc-sync-2", text: "分页恢复保留原 Tracker ID", required: true },
            ]
          : [{ id: "acc-default-1", text: "结果可核对", required: true }];
    snap.records.push(record({
      id: row.trackerId,
      projectId: design.projectId,
      primaryType: row.primaryType,
      source: row.originLabel ? "import" : "native",
      archived: row.archived,
      revision: row.revision,
      createdAt: now,
      orderKey: `o:${String((index + 1) * 10).padStart(6, "0")}`,
      origin,
      fields: {
        title: row.title,
        status: row.nativeStatusSymbol,
        description: row.body,
        priority: "normal",
        acceptance,
        dependsOn: [],
        blocks: [],
      },
    }));
    const cat = categoryOfStatus(row.nativeStatusSymbol);
    const outcome = row.archived || cat === "done" && row.expectedStage === "DONE" || row.expectedStage === "ARCHIVED"
      ? (row.expectedStage === "TODO" ? "not_started" : row.expectedStage === "RUNNING" ? "unresolved" : "succeeded")
      : row.expectedStage === "TODO" ? "not_started" : row.expectedStage === "DONE" || row.expectedStage === "ARCHIVED" ? "succeeded" : "unresolved";
    snap.bindings.push({
      projectId: design.projectId,
      trackerId: row.trackerId,
      targetDeviceId: row.deviceId,
      providerId: row.latestRunId ? "pi-sim" : null,
      latestRunId: row.latestRunId,
      completionPolicy: "verified_and_reviewed",
      revision: row.revision,
      archivedAt: row.archived ? now : null,
      outcome: outcome as ExecutionBinding["outcome"],
      restoreStage: row.archived ? "DONE" : null,
      executionEnabled: true,
    });
  }

  const v04 = design.presentationData.V04;
  const v03 = design.presentationData.V03;
  for (const run of design.baseRuns) {
    const succeeded = run.status === "succeeded";
    const executing = run.status === "executing";
    snap.runs.push({
      id: run.runId,
      projectId: design.projectId,
      taskId: run.trackerId,
      attempt: run.attempt,
      status: run.status as RunRecord["status"],
      deviceId: run.deviceId,
      providerId: "pi-sim",
      sessionId: `session-${run.runId}`,
      taskRevision: snap.records.find((r) => r.id === run.trackerId)?.revision ?? 1,
      inputSnapshotId: `snap-${run.runId}`,
      baseCommit: v04?.baseLabel ?? "demo-base-001",
      executionFence: 1,
      startedAt: "2026-09-14T06:20:00Z",
      endedAt: run.endedAt,
      lastEventSeq: 3,
      summary: run.summary,
      messages: [
        { id: `${run.runId}-m1`, role: "agent", text: executing ? (v03?.message ?? run.summary) : run.summary, at: "2026-09-14T06:25:00Z" },
      ],
      inputRequests: [],
      verification: succeeded
        ? (v04?.acceptance ?? []).map((a, i) => ({
            id: `ver-${run.runId}-${i}`,
            text: a.label,
            required: true,
            state: a.state === "passed" ? "passed" : "pending",
          }))
        : (snap.records.find((r) => r.id === run.trackerId)?.fields.acceptance ?? []).map((a) => ({
            ...a,
            state: executing ? "pending" : run.status === "failed" ? "failed" : "pending",
          })),
      diff: executing || succeeded
        ? {
            label: v04?.baseLabel ?? "模拟基线 demo-base-001（非 Git 提交）",
            files: (v04?.changedFiles ?? ["demo/google-tasks.ts"]).map((p, i) => ({
              path: p,
              additions: i === 0 ? 30 : 12,
              deletions: i === 0 ? 6 : 2,
              patch: `--- a/${p}\n+++ b/${p}\n@@ 模拟差异 @@\n+模拟新增行\n-模拟删除行\n`,
            })),
          }
        : null,
      review: succeeded ? { decision: "accept", at: run.endedAt ?? now, actorId: "demo-operator" } : null,
    });
  }

  const extras: TrackerRecord[] = [
    record({
      id: "fixture-tracker-approved",
      projectId: design.projectId,
      primaryType: "task",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000080",
      fields: { title: "语义：approved 不是完成", status: "approved", description: "审查通过但仍在运行列。", demoScene: "semantic", acceptance: [{ id: "acc-appr", text: "人工验收后才能完成", required: true }], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-wont",
      projectId: design.projectId,
      primaryType: "bug",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000090",
      fields: { title: "语义：wont-do 不是成功", status: "wont-do", description: "已终止，留在需处理。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-release",
      projectId: design.projectId,
      primaryType: "release",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000100",
      fields: { title: "v0.1 工作台预览", status: "released", description: "发布记录，不是归档。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-dup-archived",
      projectId: design.projectId,
      primaryType: "bug",
      source: "native",
      archived: true,
      revision: 2,
      createdAt: now,
      orderKey: "o:000110",
      fields: { title: "语义：归档保留 duplicate", status: "duplicate", description: "恢复后回到运行列需处理。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-plan",
      projectId: design.projectId,
      primaryType: "plan",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000120",
      fields: { title: "工作台分期计划", status: "ready-for-development", description: "计划正文保留，默认不自动执行。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-decision",
      projectId: design.projectId,
      primaryType: "decision",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000130",
      fields: { title: "采用原生 Tracker 权威", status: "decided", description: "决策记录。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-idea",
      projectId: design.projectId,
      primaryType: "idea",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000140",
      fields: { title: "终端对等入口", status: "accepted", description: "想法，不暗中执行。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-milestone",
      projectId: design.projectId,
      primaryType: "milestone",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000150",
      fields: { title: "M0 无 Key 原型", status: "active", description: "里程碑聚合，不是一条 Agent 进程。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-readonly",
      projectId: design.projectId,
      primaryType: "task",
      source: "frontmatter",
      sourceRef: "remote://demo/readonly.md",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000160",
      readOnly: true,
      documentPath: "remote://demo/readonly.md",
      fields: { title: "只读远端文件条目", status: "to-do", description: "三端写入返回同一只读原因。", demoScene: "semantic", acceptance: [], dependsOn: [], blocks: [] },
    }),
    record({
      id: "fixture-tracker-research-only",
      projectId: "fixture-project-research",
      primaryType: "task",
      source: "native",
      archived: false,
      revision: 1,
      createdAt: now,
      orderKey: "o:000010",
      fields: { title: "研究项目备忘", status: "to-do", description: "用于项目筛选，不与巴别塔记录串号。", acceptance: [{ id: "acc-res", text: "项目隔离", required: true }], dependsOn: [], blocks: [] },
    }),
  ];
  snap.records.push(...extras);
  for (const extra of extras) {
    const managed = extra.primaryType === "task" || extra.primaryType === "bug";
    snap.bindings.push({
      projectId: extra.projectId,
      trackerId: extra.id,
      targetDeviceId: null,
      providerId: null,
      latestRunId: null,
      completionPolicy: "verified_and_reviewed",
      revision: extra.revision,
      archivedAt: extra.archived ? now : null,
      outcome: extra.archived || extra.fields.status === "approved" || extra.fields.status === "wont-do" || extra.fields.status === "duplicate"
        ? "unresolved"
        : extra.fields.status === "released" || extra.fields.status === "decided"
          ? "succeeded"
          : "not_started",
      restoreStage: extra.archived ? "RUNNING" : null,
      executionEnabled: managed && extra.id !== "fixture-tracker-readonly",
    });
  }

  snap.views = [
    { viewId: "builtin:ready", name: "Ready", builtin: true, definition: { types: "executable", statusScope: "open", includeArchived: false, viewMode: "native-list" } },
    { viewId: "builtin:all", name: "全部", builtin: true, definition: { types: "all", statusScope: "all", includeArchived: true, viewMode: "native-list" } },
    { viewId: "builtin:execution", name: "执行看板", builtin: true, definition: { types: "executable", statusScope: "all", includeArchived: true, viewMode: "execution" } },
  ] satisfies SavedView[];

  return snap;
}

export function projectOf(snap: Snapshot, id: string): ProjectRecord {
  const found = snap.projects.find((p) => p.id === id);
  if (!found) throw new Error(`missing project ${id}`);
  return found;
}
