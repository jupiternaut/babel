import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function ensureProfileDir(profileDir: string): string {
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(path.join(profileDir, "state"), { recursive: true });
  mkdirSync(path.join(profileDir, "workspaces", "babel"), { recursive: true });
  mkdirSync(path.join(profileDir, "hooks"), { recursive: true });
  return profileDir;
}

export function loadOrCreateServiceToken(profileDir: string): string {
  const fromEnv = process.env.BABEL_SERVICE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  ensureProfileDir(profileDir);
  const file = path.join(profileDir, "service.token");
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

export function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "null") return true;
  return LOCAL_ORIGIN.test(origin);
}

export function tokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const authorization = firstHeader(headers.authorization);
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return firstHeader(headers["x-babel-service-token"]);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
