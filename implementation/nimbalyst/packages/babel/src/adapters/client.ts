import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import {
  BabelError,
  DEFAULT_ENDPOINT,
  DEMO_ACTOR,
  type Actor,
  type BabelEvent,
  type CommandRequest,
  type CommandResult,
  type ErrorCode,
  type QueryRequest,
} from "../contracts.ts";
import { serviceAuthHeaders } from "./auth-headers.ts";

export interface BabelClientOptions {
  endpoint?: string;
  actor?: Actor;
  timeoutMs?: number;
}

export class BabelHttpClient {
  readonly endpoint: string;
  readonly actor: Actor;
  readonly timeoutMs: number;

  constructor(options: BabelClientOptions = {}) {
    this.endpoint = (options.endpoint ?? process.env.BABEL_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.actor = options.actor ?? { ...DEMO_ACTOR };
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request("GET", "/v2/health");
  }

  async snapshot(projectId: string): Promise<unknown> {
    return this.request("GET", `/v2/snapshot?projectId=${encodeURIComponent(projectId)}`);
  }

  async command(request: CommandRequest): Promise<CommandResult> {
    const result = await this.request<CommandResult>("POST", "/v2/command", {
      ...request,
      actor: request.actor ?? this.actor,
    }, request.idempotencyKey);
    return result;
  }

  async query<T = unknown>(request: QueryRequest): Promise<T> {
    return this.request<T>("POST", "/v2/query", {
      ...request,
      actor: request.actor ?? this.actor,
    });
  }

  watchEvents(projectId: string, cursor: string | undefined, onEvent: (event: BabelEvent) => void): { close: () => void } {
    const url = new URL(`${this.endpoint}/v2/events`);
    url.searchParams.set("projectId", projectId);
    if (cursor) url.searchParams.set("cursor", cursor);
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: {
        accept: "text/event-stream",
        "x-actor-id": this.actor.id,
        "x-actor-kind": this.actor.kind,
        "x-actor-projects": this.actor.projectIds.join(","),
        ...serviceAuthHeaders(),
        ...(cursor ? { "last-event-id": cursor } : {}),
      },
    });
    let buffer = "";
    req.on("response", (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          try {
            onEvent(JSON.parse(dataLine.slice(6)) as BabelEvent);
          } catch {
            // ignore malformed frames
          }
        }
      });
    });
    req.on("error", () => undefined);
    req.end();
    return {
      close() {
        req.destroy();
      },
    };
  }

  private request<T>(method: string, pathname: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const url = new URL(this.endpoint + pathname);
    const payload = body == null ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = transport(url, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-actor-id": this.actor.id,
          "x-actor-kind": this.actor.kind,
          "x-actor-projects": this.actor.projectIds.join(","),
          ...serviceAuthHeaders(),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = text ? JSON.parse(text) : {};
            if (parsed && parsed.ok === false && parsed.code) {
              reject(new BabelError(parsed.code as ErrorCode, parsed.message ?? "请求失败", parsed.details ?? {}, Boolean(parsed.retryable)));
              return;
            }
            resolve(parsed as T);
          } catch (error) {
            reject(error);
          }
        });
      });
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new BabelError("WAIT_TIMEOUT", "请求超时", { endpoint: this.endpoint }, true));
      });
      req.on("error", (error) => {
        reject(new BabelError("UNAVAILABLE", `无法连接演示服务 ${this.endpoint}`, { cause: String(error) }, true));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
