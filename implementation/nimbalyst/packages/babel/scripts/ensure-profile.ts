import path from "node:path";
import { ensureProfileDir, loadOrCreateServiceToken } from "../src/server/auth.ts";

const profileDir = process.env.BABEL_PROFILE ?? "D:\\Projects\\babel-nimbalyst-data\\demo-profile";
const electronProfile = process.env.NIMBALYST_USER_DATA_DIR ?? "D:\\Projects\\babel-nimbalyst-data\\electron-profile";
const npmCache = process.env.npm_config_cache ?? "D:\\Projects\\babel-nimbalyst-cache\\npm";

ensureProfileDir(profileDir);
ensureProfileDir(electronProfile);
ensureProfileDir(npmCache);
const token = loadOrCreateServiceToken(profileDir);

process.stderr.write(
  [
    `profile=${profileDir}`,
    `electronProfile=${electronProfile}`,
    `npmCache=${npmCache}`,
    `tokenFile=${path.join(profileDir, "service.token")}`,
    `tokenBytes=${token.length}`,
    "repeatable: this script only creates missing directories and token; it does not wipe demo-store.json",
  ].join("\n") + "\n",
);
