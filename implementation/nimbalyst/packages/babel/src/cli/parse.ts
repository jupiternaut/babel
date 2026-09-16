import { readFileSync } from "node:fs";
import { BabelError } from "../contracts.ts";

export interface CliFlags {
  json: boolean;
  help: boolean;
  project?: string;
  id?: string;
  task?: string;
  run?: string;
  request?: string;
  inputPath?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
  endpoint?: string;
  profile?: string;
  after?: string;
  format?: string;
  scenario?: string;
  wait: boolean;
  timeoutMs?: number;
  device?: string;
  comment?: string;
  types?: string;
  cursor?: string;
  view?: string;
  text?: string;
  resolution?: string;
  tracker?: string;
  body?: string;
  name?: string;
  before?: string;
  dependsOn?: string;
  blocks?: string;
  delivery?: string;
  phase?: string;
  hookId?: string;
  viewId?: string;
  executable?: string;
  tasklist?: string;
  quote?: string;
  service?: string;
  rest: string[];
}

const ALIASES: Record<string, keyof CliFlags | "flag"> = {
  "--json": "json",
  "--help": "help",
  "-h": "help",
  "--wait": "wait",
};

export function parseArgv(argv: string[]): CliFlags {
  const flags: CliFlags = {
    json: false,
    help: false,
    wait: false,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--") {
      flags.rest.push(...argv.slice(i + 1));
      break;
    }
    if (token === "--json") {
      flags.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "--wait") {
      flags.wait = true;
      continue;
    }
    if (!token.startsWith("-")) {
      flags.rest.push(token);
      continue;
    }
    const [rawKey, inline] = splitInline(token);
    const value = inline ?? argv[i + 1];
    const eat = inline == null;
    switch (rawKey) {
      case "--project":
        flags.project = needValue(rawKey, value, eat, () => i++);
        break;
      case "--id":
        flags.id = needValue(rawKey, value, eat, () => i++);
        break;
      case "--task":
      case "--tracker":
        flags.task = needValue(rawKey, value, eat, () => i++);
        flags.tracker = flags.task;
        break;
      case "--run":
        flags.run = needValue(rawKey, value, eat, () => i++);
        break;
      case "--request":
        flags.request = needValue(rawKey, value, eat, () => i++);
        break;
      case "--input":
        flags.inputPath = needValue(rawKey, value, eat, () => i++);
        break;
      case "--expected-revision":
        flags.expectedRevision = Number(needValue(rawKey, value, eat, () => i++));
        if (!Number.isFinite(flags.expectedRevision)) {
          throw new BabelError("USAGE", "--expected-revision 必须是数字");
        }
        break;
      case "--idempotency-key":
        flags.idempotencyKey = needValue(rawKey, value, eat, () => i++);
        break;
      case "--endpoint":
        flags.endpoint = needValue(rawKey, value, eat, () => i++);
        break;
      case "--profile":
        flags.profile = needValue(rawKey, value, eat, () => i++);
        break;
      case "--after":
      case "--cursor":
        flags.after = needValue(rawKey, value, eat, () => i++);
        flags.cursor = flags.after;
        break;
      case "--format":
        flags.format = needValue(rawKey, value, eat, () => i++);
        break;
      case "--scenario":
        flags.scenario = needValue(rawKey, value, eat, () => i++);
        break;
      case "--timeout":
        flags.timeoutMs = Number(needValue(rawKey, value, eat, () => i++));
        if (!Number.isFinite(flags.timeoutMs) || flags.timeoutMs <= 0) {
          throw new BabelError("USAGE", "--timeout 必须是正整数毫秒");
        }
        break;
      case "--device":
        flags.device = needValue(rawKey, value, eat, () => i++);
        break;
      case "--comment":
        flags.comment = needValue(rawKey, value, eat, () => i++);
        break;
      case "--types":
        flags.types = needValue(rawKey, value, eat, () => i++);
        break;
      case "--view":
        flags.view = needValue(rawKey, value, eat, () => i++);
        break;
      case "--text":
        flags.text = needValue(rawKey, value, eat, () => i++);
        break;
      case "--resolution":
        flags.resolution = needValue(rawKey, value, eat, () => i++);
        break;
      case "--body":
        flags.body = needValue(rawKey, value, eat, () => i++);
        break;
      case "--name":
        flags.name = needValue(rawKey, value, eat, () => i++);
        break;
      case "--before":
        flags.before = needValue(rawKey, value, eat, () => i++);
        break;
      case "--depends-on":
        flags.dependsOn = needValue(rawKey, value, eat, () => i++);
        break;
      case "--blocks":
        flags.blocks = needValue(rawKey, value, eat, () => i++);
        break;
      case "--delivery":
        flags.delivery = needValue(rawKey, value, eat, () => i++);
        break;
      case "--phase":
        flags.phase = needValue(rawKey, value, eat, () => i++);
        break;
      case "--hook-id":
        flags.hookId = needValue(rawKey, value, eat, () => i++);
        break;
      case "--view-id":
        flags.viewId = needValue(rawKey, value, eat, () => i++);
        break;
      case "--executable":
        flags.executable = needValue(rawKey, value, eat, () => i++);
        break;
      case "--tasklist":
        flags.tasklist = needValue(rawKey, value, eat, () => i++);
        break;
      case "--quote":
        flags.quote = needValue(rawKey, value, eat, () => i++);
        break;
      case "--service":
        flags.service = needValue(rawKey, value, eat, () => i++);
        break;
      default:
        throw new BabelError("USAGE", `未知参数 ${rawKey}`);
    }
  }
  void ALIASES;
  return flags;
}

function splitInline(token: string): [string, string | undefined] {
  const eq = token.indexOf("=");
  if (eq === -1) return [token, undefined];
  return [token.slice(0, eq), token.slice(eq + 1)];
}

function needValue(key: string, value: string | undefined, eat: boolean, advance: () => void): string {
  if (value == null || (eat && value.startsWith("-") && value !== "-")) {
    throw new BabelError("USAGE", `${key} 需要取值`);
  }
  if (eat) advance();
  return value;
}

export async function readInputJson(inputPath: string | undefined): Promise<Record<string, unknown>> {
  if (!inputPath) return {};
  const text = inputPath === "-" ? await readStdin() : readFileSync(inputPath, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new BabelError("VALIDATION", "--input 必须是 JSON 对象");
  } catch (error) {
    if (error instanceof BabelError) throw error;
    throw new BabelError("VALIDATION", "--input 不是合法 JSON", { path: inputPath });
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
    if (process.stdin.isTTY) {
      reject(new BabelError("USAGE", "--input - 需要从标准输入提供 JSON"));
    }
  });
}
