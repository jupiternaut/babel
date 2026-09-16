import path from "node:path";
import { DomainService } from "../core/domain.ts";
import { ensureProfileDir, loadOrCreateServiceToken } from "./auth.ts";
import { createDemoServer } from "./http.ts";

const profileDir = ensureProfileDir(process.env.BABEL_PROFILE ?? "D:\\Projects\\babel-nimbalyst-data\\demo-profile");
const host = process.env.BABEL_HOST ?? "127.0.0.1";
const port = Number(process.env.BABEL_PORT ?? 7780);
const serviceToken = loadOrCreateServiceToken(profileDir);

const domain = new DomainService({
  profileDir,
  workdir: process.env.BABEL_WORKDIR ?? path.join(profileDir, "workspaces", "babel"),
  fixturesPath: process.env.BABEL_FIXTURES,
  simulate: (process.env.BABEL_SIMULATE as "async" | "sync" | "off") ?? "async",
});

const server = createDemoServer({ host, port, domain, serviceToken });
await server.listen();
process.stderr.write(`babel demo server ${server.endpoint} profile=${profileDir} mode=demo tokenFile=${path.join(profileDir, "service.token")}\n`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
