import {
  BabelError,
  DEFAULT_PROJECT_ID,
  DEMO_UNIMPLEMENTED_CODE,
  DEMO_UNIMPLEMENTED_MESSAGE,
  type Actor,
  type CommandResult,
  type TrackerRecord,
} from "../contracts.ts";
import { BabelHttpClient } from "./client.ts";
import { RunControlClient } from "./RunControlClient.ts";

export type Unsubscribe = () => void;

export interface DemoTrackerItem {
  id: string;
  projectId: string;
  type: string;
  title: string;
  status: string;
  archived: boolean;
  revision: number;
  description: string;
  fields: TrackerRecord["fields"];
  content: TrackerRecord["content"];
  system: TrackerRecord["system"];
}

export interface DemoTrackerSnapshot {
  items: DemoTrackerItem[];
  savedViews: Array<{ viewId: string; payload: string }>;
  presence: [];
  sync: {
    workspacePath: string;
    status: "connected" | "connecting" | "disconnected" | "error";
    projectId: string | null;
  };
}

export type DemoTrackerChange =
  | { type: "items-replaced"; items: DemoTrackerItem[] }
  | { type: "items-upserted"; items: DemoTrackerItem[] }
  | { type: "status"; sync: DemoTrackerSnapshot["sync"] }
  | { type: "mutation-rejected"; rejection: { itemId: string; code: string; message: string } };

export type DemoTrackerCommand =
  | { type: "list-items" }
  | { type: "refresh-items" }
  | { type: "create-item"; item: { id?: string; type: string; title: string; status?: string; description?: string } }
  | { type: "update-item"; input: { itemId: string; updates: Record<string, unknown>; expectedRevision?: number } }
  | { type: "archive-item"; itemId: string; archive: boolean }
  | { type: "add-comment"; itemId: string; body: string }
  | { type: "delete-item"; itemId: string };

/**
 * Aligns with upstream TrackerDataSource (snapshot/subscribe/command/status/dispose)
 * without importing Electron or collab-client. Same GUI workspace should share one instance.
 */
export class DemoTrackerDataSource {
  readonly client: BabelHttpClient;
  readonly runs: RunControlClient;
  private readonly projectId: string;
  private readonly listeners = new Set<(change: DemoTrackerChange) => void>();
  private watch: { close: () => void } | null = null;
  private sync: DemoTrackerSnapshot["sync"];

  constructor(options: { endpoint?: string; projectId?: string; actor?: Actor } = {}) {
    this.projectId = options.projectId ?? DEFAULT_PROJECT_ID;
    this.client = new BabelHttpClient({ endpoint: options.endpoint, actor: options.actor });
    this.runs = new RunControlClient(this.client);
    this.sync = { workspacePath: "demo://babel", status: "connecting", projectId: this.projectId };
  }

  status(): DemoTrackerSnapshot["sync"] {
    return this.sync;
  }

  async snapshot(): Promise<DemoTrackerSnapshot> {
    const listed = await this.client.query<{ items: Array<{ trackerId: string }> }>({
      name: "task.list",
      projectId: this.projectId,
      input: { types: "all", statusScope: "all", includeArchived: true },
    });
    const items: DemoTrackerItem[] = [];
    for (const card of listed.items ?? []) {
      const detail = await this.client.query<{ record: TrackerRecord }>({
        name: "task.get",
        projectId: this.projectId,
        input: { trackerId: card.trackerId },
      });
      items.push(toItem(detail.record));
    }
    const views = await this.client.query<{ views: Array<{ viewId: string; name: string; definition: unknown }> }>({
      name: "view.list",
      projectId: this.projectId,
    });
    this.sync = { ...this.sync, status: "connected" };
    return {
      items,
      savedViews: (views.views ?? []).map((view) => ({ viewId: view.viewId, payload: JSON.stringify(view) })),
      presence: [],
      sync: this.sync,
    };
  }

  subscribe(cb: (change: DemoTrackerChange) => void): Unsubscribe {
    this.listeners.add(cb);
    if (!this.watch) {
      this.watch = this.client.watchEvents(this.projectId, undefined, (event) => {
        if (!event.trackerId) return;
        void this.client.query<{ record: TrackerRecord }>({
          name: "task.get",
          projectId: this.projectId,
          input: { trackerId: event.trackerId },
        }).then((detail) => {
          const change: DemoTrackerChange = { type: "items-upserted", items: [toItem(detail.record)] };
          for (const listener of this.listeners) listener(change);
        }).catch(() => undefined);
      });
    }
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.watch) {
        this.watch.close();
        this.watch = null;
      }
    };
  }

  async command(command: DemoTrackerCommand): Promise<{ ok: boolean; result?: CommandResult; items?: DemoTrackerItem[] }> {
    if (command.type === "list-items" || command.type === "refresh-items") {
      const snap = await this.snapshot();
      return { ok: true, items: snap.items };
    }
    if (command.type === "delete-item") {
      return {
        ok: false,
        result: {
          code: DEMO_UNIMPLEMENTED_CODE,
          message: DEMO_UNIMPLEMENTED_MESSAGE,
        } as unknown as CommandResult,
      };
    }
    try {
      let result: CommandResult;
      if (command.type === "create-item") {
        result = await this.client.command({
          name: "task.create",
          projectId: this.projectId,
          input: {
            id: command.item.id,
            primaryType: command.item.type,
            title: command.item.title,
            status: command.item.status,
            description: command.item.description,
          },
        });
      } else if (command.type === "update-item") {
        result = await this.client.command({
          name: "task.update",
          projectId: this.projectId,
          input: { trackerId: command.input.itemId, ...command.input.updates },
          expectedRevision: command.input.expectedRevision,
        });
      } else if (command.type === "archive-item") {
        const current = await this.client.query<{ record: TrackerRecord }>({
          name: "task.get",
          projectId: this.projectId,
          input: { trackerId: command.itemId },
        });
        result = await this.client.command({
          name: command.archive ? "task.archive" : "task.restore",
          projectId: this.projectId,
          input: { trackerId: command.itemId },
          expectedRevision: current.record.revision,
        });
      } else if (command.type === "add-comment") {
        result = await this.client.command({
          name: "comment.add",
          projectId: this.projectId,
          input: { trackerId: command.itemId, body: command.body },
        });
      } else {
        throw new Error("unsupported");
      }
      return { ok: true, result };
    } catch (error) {
      const babel = error instanceof BabelError ? error : null;
      const message = error instanceof Error ? error.message : String(error);
      const itemId = "itemId" in command
        ? String((command as { itemId?: string }).itemId ?? "")
        : command.type === "update-item"
          ? command.input.itemId
          : "";
      const change: DemoTrackerChange = {
        type: "mutation-rejected",
        rejection: { itemId, code: babel?.code ?? "REJECTED", message },
      };
      for (const listener of this.listeners) listener(change);
      return {
        ok: false,
        result: {
          ok: false,
          code: babel?.code ?? "REJECTED",
          message,
        } as unknown as CommandResult,
      };
    }
  }

  dispose(): void {
    this.watch?.close();
    this.watch = null;
    this.listeners.clear();
    this.sync = { ...this.sync, status: "disconnected" };
  }
}

function toItem(record: TrackerRecord): DemoTrackerItem {
  return {
    id: record.id,
    projectId: record.projectId,
    type: record.primaryType,
    title: String(record.fields.title),
    status: String(record.fields.status),
    archived: record.archived,
    revision: record.revision,
    description: String(record.fields.description ?? ""),
    fields: record.fields,
    content: record.content,
    system: record.system,
  };
}
