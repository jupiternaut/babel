import type {
  TrackerDataChange,
  TrackerDataCommand,
  TrackerDataCommandResult,
  TrackerDataSnapshot,
  TrackerDataSource,
  TrackerItem,
  TrackerSyncState,
} from '@nimbalyst/collab-client/trackers';
import { babelDemoEndpoint, babelDemoProjectId } from './babelDemoWorkspace';
import {
  BABEL_DEMO_UNIMPLEMENTED_CODE,
  BABEL_DEMO_UNIMPLEMENTED_MESSAGE,
  BabelHostCommandError,
  unimplementedCommandError,
} from './babelDemoErrors';

type BabelRecord = {
  id: string;
  projectId: string;
  primaryType: string;
  typeTags?: string[];
  source?: TrackerItem['source'];
  archived: boolean;
  syncStatus?: TrackerItem['syncStatus'];
  content?: unknown;
  revision?: number;
  system: {
    workspace: string;
    createdAt: string;
    updatedAt: string;
    documentPath?: string;
    linkedSessions?: string[];
    readOnly?: boolean;
  };
  fields: Record<string, unknown>;
};

type BabelBinding = {
  trackerId: string;
  outcome?: string;
  executionEnabled?: boolean;
  latestRunId?: string | null;
  archivedAt?: string | null;
};

type BabelDetail = {
  record: BabelRecord;
  binding?: BabelBinding;
  stage?: string;
  latestRun?: { id: string; status: string } | null;
};

type CapabilityMap = Record<string, { allowed: boolean; reason?: string; code?: string }>;

/**
 * Host TrackerDataSource over the isolated Babel demo HTTP service.
 * Card IDs stay TrackerRecord.id. Writes never go to real IPC/MCP.
 */
export class BabelDemoTrackerDataSource implements TrackerDataSource {
  readonly kind = 'babel-demo' as const;
  readonly workspacePath: string;
  readonly projectId: string;
  readonly endpoint: string;
  private readonly listeners = new Set<(change: TrackerDataChange) => void>();
  private watch: EventSource | null = null;
  private disposed = false;
  private syncState: TrackerSyncState;

  constructor(options: { workspacePath: string; endpoint?: string; projectId?: string }) {
    this.workspacePath = options.workspacePath;
    this.endpoint = (options.endpoint ?? babelDemoEndpoint()).replace(/\/$/, '');
    this.projectId = options.projectId ?? babelDemoProjectId();
    this.syncState = {
      workspacePath: options.workspacePath,
      status: 'connecting',
      projectId: this.projectId,
    };
  }

  status(): TrackerSyncState {
    return this.syncState;
  }

  async snapshot(): Promise<TrackerDataSnapshot> {
    this.assertActive();
    const listed = await this.query<{
      items: Array<{ trackerId: string }>;
      views?: Array<{ viewId: string; name: string; definition: unknown }>;
    }>('task.list', { types: 'all', statusScope: 'all', includeArchived: true });
    const items: TrackerItem[] = [];
    for (const card of listed.items ?? []) {
      const detail = await this.query<BabelDetail>('task.get', { trackerId: card.trackerId });
      items.push(toTrackerItem(detail, this.workspacePath));
    }
    const views = await this.query<{ views: Array<{ viewId: string; name: string; definition: unknown }> }>('view.list');
    this.syncState = { ...this.syncState, status: 'connected' };
    return {
      items,
      savedViews: (views.views ?? []).map((view) => ({
        viewId: view.viewId,
        payload: JSON.stringify(view),
      })),
      presence: [],
      sync: this.syncState,
    };
  }

  subscribe(cb: (change: TrackerDataChange) => void): () => void {
    this.assertActive();
    this.listeners.add(cb);
    this.ensureWatch();
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) this.closeWatch();
    };
  }

  async command(command: TrackerDataCommand): Promise<TrackerDataCommandResult> {
    this.assertActive();
    try {
      if (command.type === 'list-items' || command.type === 'refresh-items') {
        const snapshot = await this.snapshot();
        this.emit({ type: 'items-replaced', items: snapshot.items });
        return { ok: true, items: snapshot.items, savedViews: snapshot.savedViews };
      }
      if (command.type === 'create-item') {
        const result = await this.postCommand('task.create', {
          id: command.item.id,
          primaryType: command.item.type,
          title: command.item.title,
          status: command.item.status,
          description: command.item.description,
          priority: command.item.priority,
        });
        await this.emitUpsert(String(result.trackerId ?? command.item.id));
        return { ok: true, result };
      }
      if (command.type === 'update-item') {
        const input = command.input as {
          itemId: string;
          updates: Record<string, unknown>;
          expectedRevision?: number;
        };
        const expectedRevision = input.expectedRevision ?? revisionFromUpdates(input.updates);
        const updates = editableUpdates(input.updates, expectedRevision);
        const result = await this.postCommand(
          'task.update',
          { trackerId: input.itemId, ...updates },
          undefined,
          expectedRevision,
        );
        await this.emitUpsert(input.itemId);
        return { ok: true, result };
      }
      if (command.type === 'update-items') {
        // Reject malformed patches before the first write; remote conflicts remain per-entry.
        const entries = command.input.entries.map(entry => {
          const patch = { ...(entry.storeUpdates ?? {}), ...(entry.fileUpdates ?? {}) };
          const expectedRevision = revisionFromUpdates(patch);
          return { itemId: entry.itemId, expectedRevision, updates: editableUpdates(patch, expectedRevision) };
        });
        for (const entry of entries) {
          await this.postCommand(
            'task.update',
            { trackerId: entry.itemId, ...entry.updates },
            undefined,
            entry.expectedRevision,
          );
          await this.emitUpsert(entry.itemId);
        }
        return { ok: true };
      }
      if (command.type === 'archive-item') {
        const current = await this.getTask(command.itemId);
        const result = await this.postCommand(
          command.archive ? 'task.archive' : 'task.restore',
          { trackerId: command.itemId },
          undefined,
          current.record.revision,
        );
        await this.emitUpsert(command.itemId);
        return { ok: true, result };
      }
      if (command.type === 'add-comment') {
        const result = await this.postCommand('comment.add', {
          trackerId: command.itemId,
          body: command.body,
        });
        await this.emitUpsert(command.itemId);
        return { ok: true, result };
      }
      if (command.type === 'update-item-content') {
        if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision! < 1) {
          throw new BabelHostCommandError('VALIDATION', '正文保存需要有效的记录版本，请先刷新后再提交');
        }
        const content = command.content;
        const markdown = typeof content === 'string'
          ? content
          : content && typeof content === 'object' && !Array.isArray(content) && 'markdown' in content
            ? content.markdown
            : undefined;
        if (typeof markdown !== 'string') {
          throw new BabelHostCommandError('VALIDATION', '正文仅支持 Markdown 文本，无法保存此编辑器格式');
        }
        const result = await this.postCommand('task.update', {
          trackerId: command.itemId,
          markdown,
        }, undefined, command.expectedRevision);
        await this.emitUpsert(command.itemId);
        return { ok: true, result };
      }
      if (command.type === 'share-saved-view') {
        const parsed = JSON.parse(command.savedView.payload) as { name?: string; definition?: unknown };
        const result = await this.postCommand('view.save', {
          viewId: command.savedView.viewId,
          name: parsed.name ?? command.savedView.viewId,
          definition: parsed.definition ?? {},
        });
        return { ok: true, result };
      }
      if (
        command.type === 'unshare-saved-view'
        || command.type === 'delete-item'
        || command.type === 'update-comment'
        || command.type === 'reconnect'
      ) {
        throw unimplementedCommandError(command.type);
      }
      throw unimplementedCommandError('unknown-command');
    } catch (error) {
      if (error instanceof BabelHostCommandError) {
        this.emitRejection(commandTypeItemId(command), error);
      }
      throw error;
    }
  }

  async setRelations(
    itemId: string,
    updates: { dependsOn?: string[]; blocks?: string[] },
    expectedRevision: number,
  ): Promise<Record<string, unknown>> {
    this.assertActive();
    try {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new BabelHostCommandError('VALIDATION', '关系保存需要有效的记录版本，请先刷新后再提交');
      }
      const entries = updates && typeof updates === 'object' && !Array.isArray(updates)
        ? Object.entries(updates) : [];
      if (entries.length === 0 || entries.some(([key, value]) =>
        !['dependsOn', 'blocks'].includes(key) || !Array.isArray(value)
        || value.some(id => typeof id !== 'string' || id.trim().length === 0))) {
        throw new BabelHostCommandError('VALIDATION', '关系仅支持依赖与阻塞的记录 ID 列表');
      }
      const result = await this.postCommand('relation.set', { trackerId: itemId, ...updates }, undefined, expectedRevision);
      const payload = result.result as { changedTrackerIds: string[] };
      for (const trackerId of new Set(payload.changedTrackerIds)) await this.emitUpsert(trackerId);
      return result;
    } catch (error) {
      if (error instanceof BabelHostCommandError) this.emitRejection(itemId, error);
      throw error;
    }
  }

  async startRun(trackerId: string, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.postCommand('run.start', { trackerId }, idempotencyKey);
  }

  async cancelRun(runId: string): Promise<Record<string, unknown>> {
    return this.postCommand('run.cancel', { runId });
  }

  async getTask(trackerId: string): Promise<BabelDetail> {
    return this.query<BabelDetail>('task.get', { trackerId });
  }

  async getCapabilities(trackerId?: string): Promise<{ actions: CapabilityMap }> {
    return this.query<{ actions: CapabilityMap }>('capabilities.get', trackerId ? { trackerId } : {});
  }

  async queryRaw<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    return this.query<T>(name, input);
  }

  async postRaw(name: string, input: Record<string, unknown>, expectedRevision?: number): Promise<Record<string, unknown>> {
    return this.postCommand(name, input, undefined, expectedRevision);
  }

  async getDiff(runId: string): Promise<Record<string, unknown>> {
    return this.query<Record<string, unknown>>('diff.get', { runId });
  }

  async acceptReview(runId: string, expectedRevision?: number): Promise<Record<string, unknown>> {
    return this.postCommand('review.accept', { runId }, undefined, expectedRevision);
  }

  dispose(): void {
    this.disposed = true;
    this.closeWatch();
    this.listeners.clear();
    this.syncState = { ...this.syncState, status: 'disconnected' };
  }

  private emit(change: TrackerDataChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private emitRejection(itemId: string, error: BabelHostCommandError): void {
    this.emit({
      type: 'mutation-rejected',
      rejection: {
        workspacePath: this.workspacePath,
        itemId,
        code: error.code as never,
        message: error.message,
      },
    });
  }

  private async emitUpsert(trackerId: string): Promise<void> {
    const detail = await this.query<BabelDetail>('task.get', { trackerId });
    this.emit({ type: 'items-upserted', items: [toTrackerItem(detail, this.workspacePath)] });
  }

  private ensureWatch(): void {
    if (this.watch || typeof EventSource === 'undefined') return;
    const url = new URL(`${this.endpoint}/v2/events`);
    url.searchParams.set('projectId', this.projectId);
    const source = new EventSource(url);
    source.addEventListener('babel', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as { trackerId?: string };
        if (parsed.trackerId) void this.emitUpsert(parsed.trackerId);
      } catch {
        // ignore malformed frames
      }
    });
    source.onerror = () => {
      this.syncState = { ...this.syncState, status: 'error' };
      this.emit({ type: 'status', sync: this.syncState });
    };
    this.watch = source;
  }

  private closeWatch(): void {
    this.watch?.close();
    this.watch = null;
  }

  private async query<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('/v2/query', { name, projectId: this.projectId, input });
  }

  private async postCommand(
    name: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    expectedRevision?: number,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/v2/command', {
      name,
      projectId: this.projectId,
      input,
      idempotencyKey,
      expectedRevision,
    }, idempotencyKey);
  }

  private async request<T>(pathname: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await fetch(`${this.endpoint}${pathname}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const parsed = await response.json() as { ok?: boolean; code?: string; message?: string };
    if (parsed && parsed.ok === false) {
      throw new BabelHostCommandError(
        parsed.code ?? BABEL_DEMO_UNIMPLEMENTED_CODE,
        parsed.message ?? parsed.code ?? BABEL_DEMO_UNIMPLEMENTED_MESSAGE,
      );
    }
    return parsed as T;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('BabelDemoTrackerDataSource is disposed');
  }
}

function toTrackerItem(detail: BabelDetail, workspacePath: string): TrackerItem {
  const record = detail.record;
  const stage = detail.stage ?? (record.archived ? 'ARCHIVED' : 'TODO');
  return {
    id: record.id,
    type: record.primaryType,
    typeTags: record.typeTags ?? [record.primaryType],
    title: String(record.fields.title ?? ''),
    description: String(record.fields.description ?? ''),
    status: String(record.fields.status ?? 'to-do') as TrackerItem['status'],
    priority: typeof record.fields.priority === 'string' ? record.fields.priority as TrackerItem['priority'] : undefined,
    owner: typeof record.fields.owner === 'string' ? record.fields.owner : undefined,
    tags: Array.isArray(record.fields.tags) && record.fields.tags.every(tag => typeof tag === 'string')
      ? [...record.fields.tags] : undefined,
    workspace: record.system.workspace || workspacePath,
    module: record.system.documentPath ?? `babel:${record.projectId}/${record.id}`,
    lastIndexed: new Date(record.system.updatedAt),
    archived: record.archived,
    content: record.content,
    source: record.source ?? 'native',
    created: record.system.createdAt,
    updated: record.system.updatedAt,
    linkedSessions: record.system.linkedSessions,
    syncStatus: record.syncStatus ?? 'local',
    customFields: {
      projectId: record.projectId,
      revision: record.revision,
      babelReadOnly: record.system.readOnly === true,
      babelStage: stage,
      babelOutcome: detail.binding?.outcome,
      babelRunId: detail.binding?.latestRunId ?? null,
      babelRunStatus: detail.latestRun?.status ?? null,
      executionEnabled: detail.binding?.executionEnabled ?? false,
      demoScene: record.fields.demoScene,
      dependsOn: record.fields.dependsOn,
      blocks: record.fields.blocks,
    },
  };
}

function withoutHostMeta(updates: Record<string, unknown>): Record<string, unknown> {
  const next = { ...updates };
  delete next.revision;
  delete next.expectedRevision;
  delete next.babelReadOnly;
  delete next.babelStage;
  delete next.babelOutcome;
  delete next.babelRunId;
  delete next.babelRunStatus;
  delete next.projectId;
  delete next.demoScene;
  delete next.executionEnabled;
  return next;
}

function editableUpdates(updates: Record<string, unknown>, expectedRevision?: number): Record<string, unknown> {
  const patch = withoutHostMeta(updates);
  const supported = new Set(['title', 'description', 'markdown', 'priority', 'owner', 'tags', 'acceptance', 'status']);
  if (Object.keys(patch).some(key => !supported.has(key))) {
    throw unimplementedCommandError('update-item-field');
  }
  if (['priority', 'owner', 'tags'].some(key => Object.prototype.hasOwnProperty.call(patch, key))
    && (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 1)) {
    throw new BabelHostCommandError('VALIDATION', '字段保存需要有效的记录版本，请先刷新后再提交');
  }
  return patch;
}

function revisionFromUpdates(updates: Record<string, unknown>): number | undefined {
  const value = updates.revision ?? updates.expectedRevision;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function commandTypeItemId(command: TrackerDataCommand): string {
  if ('itemId' in command && typeof command.itemId === 'string') return command.itemId;
  if (command.type === 'update-item') return command.input.itemId;
  if (command.type === 'create-item') return command.item.id;
  return '';
}
