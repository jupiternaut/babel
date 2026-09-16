import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  BabelError,
  DEFAULT_ENDPOINT,
  DEFAULT_PROJECT_ID,
  DEMO_ACTOR,
  EXIT_BY_CODE,
  SERVICE_ACTOR,
  type Actor,
  type CommandName,
  type CommandRequest,
  type QueryName,
} from "../contracts.ts";
import { DomainService } from "../core/domain.ts";
import { isAllowedBrowserOrigin, tokenFromHeaders } from "./auth.ts";

export interface ServerOptions {
  host?: string;
  port?: number;
  domain: DomainService;
  serviceToken: string;
}

const CORS_ALLOW_HEADERS = "content-type,authorization,idempotency-key,last-event-id,x-babel-service-token";

/**
 * HTTP contract (M0):
 *   GET  /v2/health
 *   GET  /v2/snapshot?projectId=
 *   POST /v2/command   { name, projectId, input, expectedRevision?, idempotencyKey?, correlationId?, actor? }
 *   POST /v2/query     { name, projectId?, input?, actor? }
 *   GET  /v2/events?projectId=&cursor=   SSE, Last-Event-ID
 * REST aliases map to the same command/query handlers.
 */
export function createDemoServer(options: ServerOptions) {
  const host = options.host ?? "127.0.0.1";
  const bindPort = options.port ?? 7780;
  const domain = options.domain;
  const serviceToken = options.serviceToken;
  const bound = { port: bindPort };
  const server = createServer((req, res) => {
    void handle(req, res, domain, serviceToken);
  });
  return {
    host,
    get port() {
      return bound.port;
    },
    get endpoint() {
      return `http://${host}:${bound.port}`;
    },
    domain,
    serviceToken,
    listen(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(bindPort, host, () => {
          const address = server.address();
          if (address && typeof address === "object") bound.port = address.port;
          resolve();
        });
      });
    },
    close(): Promise<void> {
      domain.dispose();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    raw: server,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, domain: DomainService, serviceToken: string): Promise<void> {
  const url = new URL(req.url ?? "/", DEFAULT_ENDPOINT);
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/v2/health") {
      return json(res, 200, domain.health(), cors);
    }
    if (req.method === "GET" && url.pathname === "/v2/snapshot") {
      const actor = trustedActor(req, serviceToken);
      const projectId = url.searchParams.get("projectId") ?? DEFAULT_PROJECT_ID;
      return json(res, 200, { mode: "demo", snapshot: domain.snapshot(projectId, actor) }, cors);
    }
    if (req.method === "GET" && url.pathname === "/v2/events") {
      return streamEvents(req, res, url, domain, serviceToken);
    }
    if (req.method === "POST" && url.pathname === "/v2/command") {
      const body = await readJson(req);
      const request = commandFromBody(body, req, serviceToken);
      const result = await domain.command(request);
      return json(res, result.settled ? 200 : 202, result, cors);
    }
    if (req.method === "POST" && url.pathname === "/v2/query") {
      const body = await readJson(req);
      const result = domain.query({
        name: body.name as QueryName,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        input: (body.input as Record<string, unknown> | undefined) ?? {},
        actor: trustedActor(req, serviceToken),
      });
      return json(res, 200, result, cors);
    }
    if (await handleRest(req, res, url, domain, serviceToken)) return;
    json(res, 404, fail("NOT_FOUND", `未知路径 ${url.pathname}`), cors);
  } catch (error) {
    writeError(res, error, cors);
  }
}

async function handleRest(req: IncomingMessage, res: ServerResponse, url: URL, domain: DomainService, serviceToken: string): Promise<boolean> {
  const actor = trustedActor(req, serviceToken);
  const cors = corsHeaders(req);
  const projectId = url.searchParams.get("projectId") ?? DEFAULT_PROJECT_ID;
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/v2/projects") {
    json(res, 200, domain.query({ name: "project.list", actor }), cors);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/v2/devices") {
    json(res, 200, domain.query({ name: "device.list", projectId, actor }), cors);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/v2/capabilities") {
    json(res, 200, domain.query({ name: "capabilities.get", projectId, input: Object.fromEntries(url.searchParams), actor }), cors);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/v2/tasks") {
    json(res, 200, domain.query({ name: "task.list", projectId, input: Object.fromEntries(url.searchParams), actor }), cors);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/v2/tasks") {
    const input = await readJson(req);
    const result = await domain.command(commandFromBody({ name: "task.create", projectId, input }, req, serviceToken));
    json(res, 200, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts.length === 3) {
    const id = parts[2];
    if (req.method === "GET") {
      json(res, 200, domain.query({ name: "task.get", projectId, input: { trackerId: id }, actor }), cors);
      return true;
    }
    if (req.method === "PATCH") {
      const input = await readJson(req);
      const result = await domain.command(commandFromBody({
        name: "task.update",
        projectId,
        input: { ...input, trackerId: id },
        expectedRevision: input.expectedRevision,
      }, req, serviceToken));
      json(res, 200, result, cors);
      return true;
    }
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts[3] === "reorder" && req.method === "POST") {
    const input = await readJson(req);
    const result = await domain.command(commandFromBody({ name: "task.reorder", projectId, input: { ...input, trackerId: parts[2] } }, req, serviceToken));
    json(res, 200, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts[3] === "archive" && req.method === "POST") {
    const input = await readJson(req).catch(() => ({}));
    const result = await domain.command(commandFromBody({ name: "task.archive", projectId, input: { ...input, trackerId: parts[2] } }, req, serviceToken));
    json(res, 200, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts[3] === "restore" && req.method === "POST") {
    const input = await readJson(req).catch(() => ({}));
    const result = await domain.command(commandFromBody({ name: "task.restore", projectId, input: { ...input, trackerId: parts[2] } }, req, serviceToken));
    json(res, 200, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts[3] === "runs" && req.method === "POST") {
    const input = await readJson(req).catch(() => ({}));
    const result = await domain.command(commandFromBody({ name: "run.start", projectId, input: { ...input, trackerId: parts[2] } }, req, serviceToken));
    json(res, result.settled ? 200 : 202, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "tasks" && parts[2] && parts[3] === "runs" && req.method === "GET") {
    json(res, 200, domain.query({ name: "run.list", projectId, input: { trackerId: parts[2] }, actor }), cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts.length === 3 && req.method === "GET") {
    json(res, 200, domain.query({ name: "run.show", projectId, input: { runId: parts[2] }, actor }), cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts[3] === "messages" && req.method === "POST") {
    const input = await readJson(req);
    const result = await domain.command(commandFromBody({ name: "run.message", projectId, input: { ...input, runId: parts[2] } }, req, serviceToken));
    json(res, 202, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts[3] === "cancel" && req.method === "POST") {
    const input = await readJson(req).catch(() => ({}));
    const result = await domain.command(commandFromBody({ name: "run.cancel", projectId, input: { ...input, runId: parts[2] } }, req, serviceToken));
    json(res, 202, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts[3] === "review" && req.method === "POST") {
    const input = await readJson(req);
    const name: CommandName = String(input.decision ?? input.name) === "request_changes" ? "review.request_changes" : "review.accept";
    const result = await domain.command(commandFromBody({ name, projectId, input: { ...input, runId: parts[2] } }, req, serviceToken));
    json(res, 200, result, cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts[3] === "diff" && req.method === "GET") {
    json(res, 200, domain.query({ name: "diff.get", projectId, input: { runId: parts[2] }, actor }), cors);
    return true;
  }
  if (parts[0] === "v2" && parts[1] === "runs" && parts[2] && parts[3] === "artifacts" && req.method === "GET") {
    json(res, 200, domain.query({ name: "artifact.list", projectId, input: { runId: parts[2] }, actor }), cors);
    return true;
  }
  return false;
}

function streamEvents(req: IncomingMessage, res: ServerResponse, url: URL, domain: DomainService, serviceToken: string): void {
  const actor = trustedActor(req, serviceToken);
  const cors = corsHeaders(req);
  const projectId = url.searchParams.get("projectId") ?? DEFAULT_PROJECT_ID;
  const lastEventId = req.headers["last-event-id"];
  const cursor = url.searchParams.get("cursor") ?? (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
  res.writeHead(200, {
    ...cors,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (event: { eventId: string; cursor: string }) => {
    res.write(`id: ${event.cursor}\n`);
    res.write(`event: babel\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    for (const event of domain.eventsSince(projectId, cursor ?? undefined, actor)) send(event);
  } catch (error) {
    writeError(res, error, cors);
    return;
  }
  const unsubscribe = domain.onEvent((event) => {
    if (event.projectId && event.projectId !== projectId) return;
    send(event);
  });
  const beat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
}

function commandFromBody(body: Record<string, unknown>, req: IncomingMessage, serviceToken: string): CommandRequest {
  const headers = req.headers;
  const actor = trustedActor(req, serviceToken);
  const name = body.name as CommandName;
  if (name === "hook.register" && actor.kind !== "system") {
    throw new BabelError("PERMISSION", "登记可执行进程 Hook 需要服务令牌");
  }
  return {
    name,
    projectId: String(body.projectId ?? DEFAULT_PROJECT_ID),
    input: (body.input ?? {}) as Record<string, unknown>,
    expectedRevision: body.expectedRevision != null ? Number(body.expectedRevision) : undefined,
    idempotencyKey: (body.idempotencyKey as string | undefined) ?? header(headers["idempotency-key"]),
    correlationId: body.correlationId as string | undefined,
    actor,
  };
}

function trustedActor(req: IncomingMessage, serviceToken: string): Actor {
  const presented = tokenFromHeaders(req.headers as Record<string, string | string[] | undefined>);
  if (presented && presented === serviceToken) return { ...SERVICE_ACTOR };
  return { ...DEMO_ACTOR };
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = header(req.headers.origin);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
    vary: "Origin",
  };
  if (origin && isAllowedBrowserOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function header(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BabelError("VALIDATION", "请求体不是合法 JSON");
  }
}

function json(res: ServerResponse, status: number, body: unknown, cors: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function writeError(res: ServerResponse, error: unknown, cors: Record<string, string> = {}): void {
  if (error instanceof BabelError) {
    json(res, statusOf(error.code), {
      ok: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
      exitCode: EXIT_BY_CODE[error.code],
    }, cors);
    return;
  }
  json(res, 500, fail("UNAVAILABLE", error instanceof Error ? error.message : "内部错误"), cors);
}

function fail(code: string, message: string): Record<string, unknown> {
  return { ok: false, code, message, retryable: false, details: {} };
}

function statusOf(code: BabelError["code"]): number {
  switch (code) {
    case "USAGE":
      return 400;
    case "VALIDATION":
      return 422;
    case "CONFLICT":
    case "REVISION_CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
    case "PRECONDITION":
    case "RUN_ACTIVE":
    case "CANCEL_PENDING":
    case "LOST_UNRECONCILED":
    case "COMPLETION_GUARD":
      return 409;
    case "PERMISSION":
    case "HOOK_DENIED":
    case "HOOK_TIMEOUT":
    case "READ_ONLY":
    case "UNAUTHORIZED_STREAM":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "UNAVAILABLE":
      return 503;
    case "WAIT_TIMEOUT":
      return 408;
    default:
      return 400;
  }
}
