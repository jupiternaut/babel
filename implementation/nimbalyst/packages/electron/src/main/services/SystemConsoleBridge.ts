import type {
  ConsoleCommand,
  ConsoleQuery,
} from "../../../../babel/src/system/types";

export type SystemReply<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string } };
const baseUrl = "http://127.0.0.1:7782";

/** Reject extra fields as well as unknown actions: renderers cannot supply URLs or commands. */
export function validateSystemPayload(
  kind: "query" | "command",
  input: unknown
): ConsoleQuery | ConsoleCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid console request");
  const p = input as Record<string, unknown>;
  const queryNames = [
    "resources",
    "processes",
    "services",
    "service",
    "logs",
    "operations",
    "events",
  ];
  const commandNames = [
    "service.start",
    "service.stop",
    "service.restart",
    "service.autostart",
    "process.terminate",
  ];
  const fields =
    kind === "query"
      ? ["name", "serviceId", "limit", "after"]
      : ["name", "serviceId", "enabled", "process", "force", "requestId"];
  if (
    Object.keys(p).some((key) => !fields.includes(key)) ||
    !(kind === "query" ? queryNames : commandNames).includes(String(p.name))
  )
    throw new Error("Unsupported console request");
  if (
    p.serviceId !== undefined &&
    (typeof p.serviceId !== "string" || !/^[\w.-]{1,128}$/.test(p.serviceId))
  )
    throw new Error("Invalid service identifier");
  for (const field of ["limit", "after"])
    if (
      p[field] !== undefined &&
      (!Number.isSafeInteger(p[field]) ||
        Number(p[field]) < 0 ||
        (field === "limit" && Number(p[field]) > 10000))
    )
      throw new Error("Invalid query range");
  if (
    kind === "query" &&
    ["service", "logs"].includes(String(p.name)) &&
    !p.serviceId
  )
    throw new Error("Service identifier required");
  if (kind === "command") {
    if (typeof p.requestId !== "string" || !/^[\w.-]{1,128}$/.test(p.requestId))
      throw new Error("Request identifier required");
    if (String(p.name).startsWith("service.") && !p.serviceId)
      throw new Error("Service identifier required");
    if (p.name === "service.autostart" && typeof p.enabled !== "boolean")
      throw new Error("Autostart value required");
    if (p.name === "process.terminate") {
      const identity = p.process as Record<string, unknown> | undefined;
      if (
        !identity ||
        Object.keys(identity).some((k) => !["pid", "startedAt"].includes(k)) ||
        !Number.isSafeInteger(identity.pid) ||
        Number(identity.pid) <= 0 ||
        typeof identity.startedAt !== "string" ||
        !Number.isFinite(Date.parse(identity.startedAt))
      )
        throw new Error("PID and process start time required");
      if (p.force !== undefined && typeof p.force !== "boolean")
        throw new Error("Invalid force flag");
    }
  }
  return input as ConsoleQuery | ConsoleCommand;
}

export class SystemConsoleBridge {
  private connecting?: Promise<SystemReply>;
  constructor(
    private readonly deps: {
      token: () => Promise<string>;
      request: typeof fetch;
      launch: () => Promise<void>;
      elevate?: () => Promise<void>;
      delay?: () => Promise<void>;
    }
  ) {}

  async request(
    kind: "query" | "command",
    payload: unknown,
    signal: AbortSignal
  ): Promise<SystemReply> {
    const validated = validateSystemPayload(kind, payload);
    const token = (await this.deps.token()).trim();
    if (!token) throw new Error("System service token unavailable");
    const response = await this.deps.request(`${baseUrl}/v1/${kind}`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validated),
    });
    const body = (await response.json()) as SystemReply;
    if (!body || typeof body.ok !== "boolean")
      throw new Error("Unexpected system service response");
    if (!body.ok)
      body.error.message = body.error.message.split(token).join("[redacted]");
    if (!response.ok && body.ok)
      throw new Error(`System service HTTP ${response.status}`);
    return body;
  }

  connect(): Promise<SystemReply> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectOnce().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async elevate(): Promise<SystemReply> {
    if (!this.deps.elevate)
      throw new Error("Administrator mode is only available on Windows");
    const token = (await this.deps.token()).trim();
    if (!token) throw new Error("System service token unavailable");
    const response = await this.deps.request(`${baseUrl}/v1/shutdown`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = (await response.json()) as SystemReply;
    if (!response.ok || !result.ok) return result;
    await this.deps.elevate();
    for (let attempt = 0; attempt < 60; attempt++) {
      await (this.deps.delay?.() ??
        new Promise((resolve) => setTimeout(resolve, 500)));
      try {
        return await this.request(
          "query",
          { name: "operations", limit: 1 },
          AbortSignal.timeout(1500)
        );
      } catch (error) {
        if (attempt === 59) throw error;
      }
    }
    throw new Error("Administrator service did not become ready");
  }

  private async connectOnce(): Promise<SystemReply> {
    try {
      return await this.request(
        "query",
        { name: "operations", limit: 1 },
        AbortSignal.timeout(2500)
      );
    } catch {
      await this.deps.launch();
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      await (this.deps.delay?.() ??
        new Promise((resolve) => setTimeout(resolve, 300)));
      try {
        return await this.request(
          "query",
          { name: "operations", limit: 1 },
          AbortSignal.timeout(2500)
        );
      } catch (error) {
        if (attempt === 29) throw error;
      }
    }
    throw new Error("System service did not become ready");
  }
}
