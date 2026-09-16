import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export type SyntheticHttpBehavior = "ok" | "error" | "hang";

/** Loopback-only HTTP fixture. Not GitLab, MediaWiki, or any user service. */
export class SyntheticHealthServer {
  behavior: SyntheticHttpBehavior = "ok";
  errorStatus = 503;
  requestCount = 0;
  lastPath: string | null = null;
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  private port = 0;

  get listening(): boolean {
    return this.server?.listening === true;
  }

  url(pathname = "/health"): string {
    if (!this.port) throw new Error("synthetic health server is not listening");
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `http://127.0.0.1:${this.port}${path}`;
  }

  start(): Promise<{ port: number; url: string }> {
    if (this.server?.listening) return Promise.resolve({ port: this.port, url: this.url() });
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      this.server = server;
      server.on("connection", (socket) => {
        this.sockets.add(socket);
        socket.on("close", () => this.sockets.delete(socket));
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("synthetic health server did not bind a TCP port"));
          return;
        }
        this.port = address.port;
        resolve({ port: this.port, url: this.url() });
      });
      server.on("error", reject);
    });
  }

  setBehavior(behavior: SyntheticHttpBehavior, errorStatus = 503): void {
    this.behavior = behavior;
    this.errorStatus = errorStatus;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    this.requestCount += 1;
    this.lastPath = req.url ?? "/";
    if (this.behavior === "hang") return;
    if (this.behavior === "error") {
      res.writeHead(this.errorStatus, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, mode: "demo", reason: "synthetic-unhealthy" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, mode: "demo", service: "synthetic-http" }));
  }
}
