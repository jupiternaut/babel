import type { Stage } from "../contracts.ts";

export type ViewMode = "execution" | "native-list";

export type NavKey =
  | { kind: "board" }
  | { kind: "ready" }
  | { kind: "all" }
  | { kind: "type"; type: string }
  | { kind: "view"; viewId: string };

export interface TrackerDraft {
  title: string;
  description: string;
  priority: string;
  owner: string;
  acceptanceText: string;
  dependsOnText: string;
  comment: string;
  message: string;
  respondText: string;
  reviewComment: string;
  startSummary: string;
  baseRevision: number;
}

export interface Notice {
  code: string;
  message: string;
  tone: "error" | "info";
}

export const STAGES: Stage[] = ["TODO", "RUNNING", "DONE", "ARCHIVED"];
