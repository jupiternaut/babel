/** NB-01 positive / negative examples. Types stay in contracts.ts. */
export const POSITIVE_COMMANDS = [
  {
    name: "task.create",
    projectId: "fixture-project-babel",
    input: { title: "交叉创建", primaryType: "task", description: "GUI/TUI/CLI 同源" },
  },
  {
    name: "run.start",
    projectId: "fixture-project-babel",
    input: { trackerId: "fixture-tracker-pdf", deviceId: "fixture-device-ubuntu" },
    idempotencyKey: "start-pdf-1",
  },
  {
    name: "review.accept",
    projectId: "fixture-project-babel",
    input: { runId: "RUN_ID" },
    expectedRevision: 2,
  },
] as const;

export const NEGATIVE_COMMANDS = [
  { name: "task.update", why: "VALIDATION", input: { trackerId: "fixture-tracker-pdf", stage: "DONE" } },
  { name: "task.update", why: "READ_ONLY", input: { trackerId: "fixture-tracker-readonly", title: "x" } },
  { name: "task.update", why: "COMPLETION_GUARD", input: { trackerId: "fixture-tracker-pdf", status: "done" } },
  { name: "run.start", why: "RUN_ACTIVE", input: { trackerId: "fixture-tracker-sync" } },
  { name: "task.archive", why: "CANCEL_PENDING", note: "cancel_requested 时" },
  { name: "run.retry", why: "LOST_UNRECONCILED", note: "lost 未核对" },
  { name: "review.accept", why: "COMPLETION_GUARD", note: "actor.kind=hook" },
  { name: "events.watch", why: "UNAUTHORIZED_STREAM", note: "跨项目订阅" },
] as const;
