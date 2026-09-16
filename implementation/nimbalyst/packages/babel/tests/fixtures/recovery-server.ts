import path from "node:path";
import { DomainService } from "../../src/core/domain.ts";
import { createDemoServer } from "../../src/server/http.ts";

const profileDir = process.argv[2];
if (!profileDir || !path.isAbsolute(profileDir)) throw new Error("An isolated absolute profile is required");

const domain = new DomainService({ profileDir, simulate: "async", stepMs: 1000 });
const server = createDemoServer({ host: "127.0.0.1", port: 0, domain, serviceToken: "crash-recovery-test-token" });
await server.listen();
process.send?.({ type: "ready", endpoint: server.endpoint, pid: process.pid, nodeVersion: process.version, profileDir });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
