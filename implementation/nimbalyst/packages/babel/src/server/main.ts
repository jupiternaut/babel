import path from "node:path";
import { DomainService } from "../core/domain.ts";
import { ensureProfileDir, loadOrCreateServiceToken } from "./auth.ts";
import { createDemoServer } from "./http.ts";
import { loadLocalPiConfig } from "./local-config.ts";
import { LocalPiRuntime } from "../pi/runtime.ts";

const localRequested = process.env.BABEL_MODE === "local" || Boolean(process.env.BABEL_LOCAL_PI_CONFIG);
if (localRequested && (!process.env.BABEL_PROFILE || !process.env.BABEL_LOCAL_PI_CONFIG)) throw new Error("本地模式需要独立 BABEL_PROFILE 和 BABEL_LOCAL_PI_CONFIG");
const profileDir = ensureProfileDir(process.env.BABEL_PROFILE ?? "D:\\Projects\\babel-nimbalyst-data\\demo-profile");
const host = process.env.BABEL_HOST ?? "127.0.0.1";
const port = Number(process.env.BABEL_PORT ?? (localRequested ? 7783 : 7780));
const serviceToken = loadOrCreateServiceToken(profileDir);
if (process.env.BABEL_MODE === "local" && !process.env.BABEL_LOCAL_PI_CONFIG) throw new Error("本地模式需要 BABEL_LOCAL_PI_CONFIG");
const config = process.env.BABEL_LOCAL_PI_CONFIG ? loadLocalPiConfig(process.env.BABEL_LOCAL_PI_CONFIG, profileDir) : undefined;

const domain = new DomainService({
  profileDir,
  workdir: process.env.BABEL_WORKDIR ?? path.join(profileDir, "workspaces", "babel"),
  fixturesPath: process.env.BABEL_FIXTURES,
  simulate: (process.env.BABEL_SIMULATE as "async" | "sync" | "off") ?? "async",
  ...(config ? { local: { project: config.project, provider: config.provider, model: config.model,
    runtime: new LocalPiRuntime({ executable: config.executable, agentDir: config.agentDir,
      provider: config.provider, model: config.model, sessionDir: config.sessionDir }) } } : {}),
});

const server = createDemoServer({ host, port, domain, serviceToken });
await server.listen();
process.stderr.write(`babel server ${server.endpoint} profile=${profileDir} mode=${domain.mode} tokenFile=${path.join(profileDir, "service.token")}\n`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
