import type { ConnectorConflict } from "./contracts.ts";

export interface GoogleTaskPage {
  items: Array<{ id: string; title: string; status: "needsAction" | "completed"; updated: string; deleted?: boolean }>;
  nextPageToken?: string;
}

export interface ImportedTask {
  externalId: string;
  title: string;
  completed: boolean;
  updated: string;
}

/** Synthetic Google Tasks client. Does not read user OAuth tokens. */
export class SyntheticGoogleTasksConnector {
  constructor(private readonly pages: GoogleTaskPage[]) {}

  async listAll(overlapUpdatedMin?: string): Promise<ImportedTask[]> {
    const seen = new Set<string>();
    const imported: ImportedTask[] = [];
    for (const page of this.pages) {
      for (const item of page.items) {
        if (overlapUpdatedMin && item.updated < overlapUpdatedMin) continue;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        imported.push({
          externalId: item.id,
          title: item.title,
          completed: item.status === "completed",
          updated: item.updated,
        });
      }
    }
    return imported;
  }

  conflictsAgainst(local: Array<{ externalId: string; title: string; completed: boolean }>, remote: ImportedTask[]): ConnectorConflict[] {
    const conflicts: ConnectorConflict[] = [];
    const localById = new Map(local.map((row) => [row.externalId, row]));
    for (const item of remote) {
      const current = localById.get(item.externalId);
      if (current && current.title !== item.title) {
        conflicts.push({
          connector: "google-tasks",
          externalId: item.externalId,
          reason: "field_mismatch",
        });
      }
      if (item.completed && current && !current.completed) {
        conflicts.push({
          connector: "google-tasks",
          externalId: item.externalId,
          reason: "external_completed",
        });
      }
    }
    return conflicts;
  }
}
