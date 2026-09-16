import { googleTaskIdentity } from "./identity.ts";
import type {
  GoogleTaskItem,
  GoogleTaskPage,
  GoogleTasksHttpClient,
  ListTasksFailure,
  ListTasksRequest,
  ListTasksResult,
  NormalizedRemoteTask,
} from "./types.ts";

export interface MemoryHttpFailure {
  status: 401 | 429 | 500;
  remaining?: number;
  retryAfterMs?: number;
  message?: string;
}

export interface MemoryGoogleTasksHttpOptions {
  pages: Record<string, GoogleTaskPage>;
  failOnToken?: Record<string, MemoryHttpFailure>;
  accountId: string;
  defaultTasklistId?: string;
}

export function normalizeRemoteTask(
  item: GoogleTaskItem,
  accountId: string,
  tasklistId: string,
): NormalizedRemoteTask {
  return {
    identity: googleTaskIdentity(accountId, tasklistId, item.id),
    accountId,
    tasklistId,
    taskId: item.id,
    title: item.title,
    notes: item.notes ?? "",
    completed: item.status === "completed",
    deleted: Boolean(item.deleted),
    hidden: Boolean(item.hidden),
    updated: item.updated,
    etag: item.etag,
  };
}

export function dedupeByIdentity(items: NormalizedRemoteTask[]): NormalizedRemoteTask[] {
  const byId = new Map<string, NormalizedRemoteTask>();
  for (const item of items) {
    const current = byId.get(item.identity);
    if (!current || item.updated > current.updated) {
      byId.set(item.identity, item);
    }
  }
  return [...byId.values()];
}

export class MemoryGoogleTasksHttp implements GoogleTasksHttpClient {
  private readonly pages: Record<string, GoogleTaskPage>;
  private readonly failOnToken: Record<string, MemoryHttpFailure>;

  constructor(private readonly options: MemoryGoogleTasksHttpOptions) {
    this.pages = options.pages;
    this.failOnToken = { ...(options.failOnToken ?? {}) };
  }

  async listTasks(request: ListTasksRequest): Promise<ListTasksResult> {
    const token = request.pageToken ?? "";
    const planned = this.failOnToken[token];
    if (planned) {
      if (planned.remaining === undefined || planned.remaining > 0) {
        if (planned.remaining !== undefined) planned.remaining -= 1;
        return failure(planned);
      }
    }

    const page = this.pages[token];
    if (!page) {
      return {
        ok: true,
        status: 200,
        page: { items: [] },
      };
    }

    const showCompleted = request.showCompleted !== false;
    const showHidden = request.showHidden === true;
    const showDeleted = request.showDeleted === true;
    const items = page.items.filter((item) => {
      if (request.updatedMin && item.updated < request.updatedMin) return false;
      if (item.deleted && !showDeleted) return false;
      if (item.hidden && !showHidden) return false;
      if (item.status === "completed" && !showCompleted) return false;
      return true;
    });

    return {
      ok: true,
      status: 200,
      page: {
        items,
        nextPageToken: page.nextPageToken,
      },
    };
  }
}

function failure(planned: MemoryHttpFailure): ListTasksFailure {
  if (planned.status === 401) {
    return {
      ok: false,
      status: 401,
      message: planned.message ?? "需重新登录",
    };
  }
  if (planned.status === 429) {
    return {
      ok: false,
      status: 429,
      retryAfterMs: planned.retryAfterMs ?? 1000,
      message: planned.message ?? "请求过于频繁，稍后重试",
    };
  }
  return {
    ok: false,
    status: 500,
    retryAfterMs: planned.retryAfterMs ?? 2000,
    message: planned.message ?? "上游暂时不可用，未丢弃已拉取页",
  };
}

export function pagesFromItems(
  items: GoogleTaskItem[],
  pageSize: number,
): Record<string, GoogleTaskPage> {
  const pages: Record<string, GoogleTaskPage> = {};
  if (items.length === 0) {
    pages[""] = { items: [] };
    return pages;
  }
  const chunks: GoogleTaskItem[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    chunks.push(items.slice(i, i + pageSize));
  }
  chunks.forEach((chunk, index) => {
    const token = index === 0 ? "" : `p${index + 1}`;
    const nextPageToken = index < chunks.length - 1 ? `p${index + 2}` : undefined;
    pages[token] = { items: chunk, nextPageToken };
  });
  return pages;
}
