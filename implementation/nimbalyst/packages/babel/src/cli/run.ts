import { createInterface } from "node:readline";
import { runSystemCli } from "../system/cli.ts";
import {
  BabelError,
  DEFAULT_ENDPOINT,
  DEMO_ACTOR,
  EXIT_BY_CODE,
  TERMINAL_RUN,
  type CommandName,
  type CommandResult,
  type QueryName,
  type RunRecord,
} from "../contracts.ts";
import { HELP_JSON, HELP_TEXT } from "./help.ts";
import { CliHttp } from "./http.ts";
import { parseArgv, readInputJson, type CliFlags } from "./parse.ts";
import { dispatchSurface, isSurfaceResource } from "./surfaces.ts";

const PROJECT_SCOPED = new Set([
  "task",
  "run",
  "review",
  "comment",
  "events",
  "history",
  "diff",
  "ready",
  "view",
  "device",
  "relation",
  "hook",
]);

const WAIT_DEFAULT_MS = Number(process.env.BABEL_WAIT_TIMEOUT ?? 30000);

export interface CliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

export interface CliExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function executeCli(argv: string[]): Promise<CliExecution> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: { write(chunk: string) { stdout += chunk; } },
    stderr: { write(chunk: string) { stderr += chunk; } },
  };
  const exitCode = await runCli(argv, io);
  return { exitCode, stdout, stderr };
}

export async function runCli(argv: string[], io: CliIo = process): Promise<number> {
  if (argv[0] === "system") return runSystemCli(argv.slice(1), io);
  let flags: CliFlags;
  try {
    flags = parseArgv(argv);
  } catch (error) {
    return fail(io, error);
  }
  try {
    const result = await dispatch(flags, io);
    if (result !== undefined) writeJson(io, result);
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

function fail(io: CliIo, error: unknown): number {
  const babel = toBabel(error);
  const body = {
    ok: false as const,
    code: babel.code,
    message: babel.message,
    retryable: babel.retryable,
    details: babel.details,
    exitCode: EXIT_BY_CODE[babel.code],
    mode: "demo" as const,
  };
  io.stdout.write(`${JSON.stringify(body)}\n`);
  if (babel.code === "USAGE") {
    io.stderr.write("缺少或无效的参数。运行 babel --help 查看用法。\n");
  } else {
    io.stderr.write(`${babel.code}: ${babel.message}\n`);
  }
  return EXIT_BY_CODE[babel.code];
}

function toBabel(error: unknown): BabelError {
  if (error instanceof BabelError) return error;
  if (error instanceof Error) return new BabelError("UNAVAILABLE", error.message, {}, true);
  return new BabelError("UNAVAILABLE", "未知错误", {}, true);
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value)}\n`);
}

function requireProject(flags: CliFlags): string {
  if (!flags.project) throw new BabelError("USAGE", "缺少 --project");
  return flags.project;
}

function trackerId(flags: CliFlags): string {
  const id = flags.task ?? flags.tracker ?? flags.id;
  if (!id) throw new BabelError("USAGE", "缺少 --id 或 --task");
  return id;
}

function runIdOf(flags: CliFlags): string {
  const id = flags.run ?? flags.id;
  if (!id) throw new BabelError("USAGE", "缺少 --id 或 --run");
  return id;
}

function requireInput(flags: CliFlags): string {
  if (!flags.inputPath) throw new BabelError("USAGE", "缺少 --input");
  return flags.inputPath;
}

function actorOf(): typeof DEMO_ACTOR {
  return {
    id: process.env.BABEL_ACTOR_ID ?? DEMO_ACTOR.id,
    kind: "cli",
    projectIds: [...DEMO_ACTOR.projectIds],
  };
}

function clientOf(flags: CliFlags, io: CliIo): CliHttp {
  if (flags.profile) {
    io.stderr.write(`提示: --profile ${flags.profile} 只作说明，实际连接 ${flags.endpoint ?? process.env.BABEL_ENDPOINT ?? DEFAULT_ENDPOINT}\n`);
  }
  return new CliHttp({
    endpoint: flags.endpoint,
    actor: actorOf(),
  });
}

function splitIds(raw: string | undefined): string[] | undefined {
  if (raw == null || raw === "") return undefined;
  return raw.split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean);
}

function asStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return splitIds(value);
  throw new BabelError("USAGE", "dependsOn/blocks 必须是字符串或字符串数组");
}

async function waitForRun(http: CliHttp, projectId: string, runId: string, timeoutMs: number): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  let last: RunRecord | undefined;
  while (Date.now() < deadline) {
    const shown = await http.query<{ run: RunRecord }>({
      name: "run.show",
      projectId,
      input: { runId },
    });
    last = shown.run;
    if (last && (last.status === "review_required" || TERMINAL_RUN.has(last.status))) {
      return last;
    }
    await sleep(200);
  }
  throw new BabelError("WAIT_TIMEOUT", "等待执行到达待验收或终态超时，未自动重派", {
    runId,
    lastStatus: last?.status ?? null,
    timeoutMs,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function annotateCommand(result: CommandResult): CommandResult {
  if (!result.settled) {
    return {
      ...result,
      result: {
        ...result.result,
        settled: false,
        commandMeans: result.result.commandMeans ?? "accepted_not_finished",
        note: "命令已接受，不表示 run 已完成",
      },
    };
  }
  return result;
}

async function dispatch(flags: CliFlags, io: CliIo): Promise<unknown> {
  const [resource, action, extra] = flags.rest;
  if (!resource || flags.help) {
    if (flags.json) return HELP_JSON;
    io.stderr.write(HELP_TEXT);
    return undefined;
  }

  if (resource === "tui") {
    throw new BabelError("USAGE", "交互界面请运行 npx tsx src/tui/main.ts，CLI 保持非交互");
  }

  if (isSurfaceResource(resource)) {
    return dispatchSurface(flags);
  }

  const http = clientOf(flags, io);
  const verb = action ?? "get";

  if (resource === "capabilities") {
    return http.query({
      name: "capabilities.get",
      projectId: flags.project,
      input: {
        ...(flags.id ? { trackerId: flags.id } : {}),
        ...(flags.run ? { runId: flags.run } : {}),
      },
    });
  }

  if (resource === "health") {
    return http.health();
  }

  if (PROJECT_SCOPED.has(resource) && resource !== "schema" && !flags.project && resource !== "project") {
    if (resource !== "capabilities") requireProject(flags);
  }

  if (resource === "project" && (verb === "list" || !action)) {
    return http.query({ name: "project.list" });
  }
  if (resource === "device" && (verb === "list" || !action)) {
    return http.query({ name: "device.list", projectId: requireProject(flags) });
  }
  if (resource === "schema" && (verb === "types" || !action)) {
    return http.query({ name: "schema.types", projectId: flags.project });
  }
  if (resource === "view") {
    const projectId = requireProject(flags);
    if (verb === "list" || !action) {
      return http.query({ name: "view.list", projectId });
    }
    if (verb === "save") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const name = flags.name ?? (typeof input.name === "string" ? input.name : undefined);
      if (!name?.trim()) throw new BabelError("USAGE", "view.save 需要 --name 或 --input.name");
      return annotateCommand(await http.command({
        name: "view.save",
        projectId,
        input: {
          name: name.trim(),
          ...(flags.viewId || input.viewId ? { viewId: flags.viewId ?? input.viewId } : {}),
          definition: input.definition ?? {
            types: flags.types === "all" || flags.types === "executable" ? flags.types : flags.types ? flags.types.split(",") : undefined,
            deviceId: flags.device,
            q: typeof input.q === "string" ? input.q : undefined,
            viewId: flags.view,
          },
        },
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    throw new BabelError("USAGE", `未知 view 动作 ${verb}`);
  }
  if (resource === "ready" && (verb === "list" || !action)) {
    return http.query({ name: "ready.list", projectId: requireProject(flags) });
  }

  if (resource === "relation") {
    const projectId = requireProject(flags);
    if (verb !== "set") throw new BabelError("USAGE", `未知 relation 动作 ${verb}`);
    const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
    const dependsOn = splitIds(flags.dependsOn) ?? asStringArray(input.dependsOn);
    const blocks = splitIds(flags.blocks) ?? asStringArray(input.blocks);
    if (!dependsOn && !blocks) {
      throw new BabelError("USAGE", "relation.set 需要 --depends-on、--blocks 或 --input 中的对应字段");
    }
    return annotateCommand(await http.command({
      name: "relation.set",
      projectId,
      input: {
        trackerId: trackerId(flags),
        ...(dependsOn ? { dependsOn } : {}),
        ...(blocks ? { blocks } : {}),
      },
      expectedRevision: flags.expectedRevision,
      idempotencyKey: flags.idempotencyKey,
    }));
  }

  if (resource === "hook") {
    if (verb === "list" || !action) {
      return http.query({
        name: "hook.list",
        projectId: flags.project ?? DEMO_ACTOR.projectIds[0],
      });
    }
    if (verb === "register") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const hookId = flags.hookId ?? input.hookId;
      const phase = flags.phase ?? input.phase;
      const executable = flags.executable ?? input.executable;
      if (!hookId || !phase || !executable) {
        throw new BabelError("USAGE", "hook.register 需要 hookId、phase、executable（--input 或对应参数）");
      }
      return annotateCommand(await http.command({
        name: "hook.register",
        projectId: flags.project ?? DEMO_ACTOR.projectIds[0],
        input: {
          ...input,
          hookId,
          phase,
          executable,
          argv: input.argv ?? [],
        },
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    if (verb === "retry" || verb === "retry_delivery" || verb === "retry-delivery") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const deliveryId = flags.delivery ?? flags.id ?? input.deliveryId;
      if (!deliveryId) throw new BabelError("USAGE", "hook.retry 需要 --delivery 或 --id");
      return annotateCommand(await http.command({
        name: "hook.retry_delivery",
        projectId: flags.project ?? DEMO_ACTOR.projectIds[0],
        input: { deliveryId },
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    throw new BabelError("USAGE", `未知 hook 动作 ${verb}`);
  }

  if (resource === "task") {
    const projectId = requireProject(flags);
    if (verb === "list") {
      const input: Record<string, unknown> = {};
      if (flags.types) input.types = flags.types === "all" || flags.types === "executable" ? flags.types : flags.types.split(",");
      if (flags.types === "all") input.includeSemantic = true;
      if (flags.view) input.viewId = flags.view;
      if (flags.device) input.deviceId = flags.device;
      if (flags.attentionOnly) input.attentionOnly = true;
      return http.query({ name: "task.list", projectId, input });
    }
    if (verb === "get") {
      return http.query({ name: "task.get", projectId, input: { trackerId: trackerId(flags) } });
    }
    if (verb === "create") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const title = typeof input.title === "string" && input.title.trim()
        ? input.title
        : flags.name;
      if (!title?.trim()) throw new BabelError("USAGE", "task.create 需要 --input.title 或 --name");
      const requestedId = typeof input.id === "string" && input.id.trim() ? input.id : undefined;
      const payload: Record<string, unknown> = { ...input, title: title.trim() };
      if (requestedId) payload.id = requestedId;
      else delete payload.id;
      return annotateCommand(await http.command({
        name: "task.create",
        projectId,
        input: payload,
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    if (verb === "update") {
      if (!flags.inputPath && flags.name == null && flags.body == null) {
        throw new BabelError("USAGE", "task.update 需要 --input、--name 或 --body");
      }
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      if (flags.name != null) input.title = flags.name;
      if (flags.body != null) {
        input.description = flags.body;
        if (input.markdown == null) input.markdown = flags.body;
      }
      if ("stage" in input || "outcome" in input || "run.status" in input || "runStatus" in input) {
        throw new BabelError("VALIDATION", "普通字段更新不能写入 stage/outcome/run.status");
      }
      if (flags.expectedRevision == null) throw new BabelError("USAGE", "task.update 需要 --expected-revision");
      return annotateCommand(await http.command({
        name: "task.update",
        projectId,
        input: { ...input, trackerId: trackerId(flags) },
        expectedRevision: flags.expectedRevision,
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    if (verb === "archive" || verb === "restore") {
      return annotateCommand(await http.command({
        name: (`task.${verb}` as CommandName),
        projectId,
        input: { trackerId: trackerId(flags) },
        expectedRevision: flags.expectedRevision,
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    if (verb === "reorder") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const beforeId = flags.before ?? (input.beforeId != null ? String(input.beforeId) : undefined);
      const afterId = flags.after ?? (input.afterId != null ? String(input.afterId) : undefined);
      if (!beforeId && !afterId) {
        throw new BabelError("USAGE", "task.reorder 需要 --before、--after 或 --input 中的 beforeId/afterId");
      }
      return annotateCommand(await http.command({
        name: "task.reorder",
        projectId,
        input: {
          trackerId: trackerId(flags),
          ...(beforeId ? { beforeId } : {}),
          ...(afterId ? { afterId } : {}),
        },
        expectedRevision: flags.expectedRevision,
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    throw new BabelError("USAGE", `未知 task 动作 ${verb}`);
  }

  if (resource === "comment" && verb === "add") {
    const projectId = requireProject(flags);
    const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
    const body = flags.body ?? input.body ?? input.text;
    if (!body) throw new BabelError("USAGE", "comment.add 需要 --body 或 --input.body");
    return annotateCommand(await http.command({
      name: "comment.add",
      projectId,
      input: { trackerId: trackerId(flags), body },
    }));
  }

  if (resource === "run") {
    const projectId = requireProject(flags);
    if (verb === "start") {
      const result = annotateCommand(await http.command({
        name: "run.start",
        projectId,
        input: {
          trackerId: trackerId(flags),
          ...(flags.device ? { deviceId: flags.device } : {}),
        },
        expectedRevision: flags.expectedRevision,
        idempotencyKey: flags.idempotencyKey,
      }));
      return maybeWait(http, flags, projectId, result);
    }
    if (verb === "show") {
      return http.query({ name: "run.show", projectId, input: { runId: runIdOf(flags) } });
    }
    if (verb === "list") {
      return http.query({
        name: "run.list",
        projectId,
        input: flags.task || flags.tracker ? { trackerId: flags.task ?? flags.tracker } : {},
      });
    }
    if (verb === "message") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const text = flags.text ?? input.text;
      if (!text) throw new BabelError("USAGE", "run.message 需要 --text 或 --input.text");
      const result = annotateCommand(await http.command({
        name: "run.message",
        projectId,
        input: { runId: runIdOf(flags), text },
        idempotencyKey: flags.idempotencyKey,
      }));
      return maybeWait(http, flags, projectId, result);
    }
    if (verb === "respond") {
      if (!flags.request) throw new BabelError("USAGE", "run.respond 需要 --request");
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      const text = flags.text ?? input.text ?? input.answer;
      if (text == null || text === "") throw new BabelError("USAGE", "run.respond 需要 --input 中的 text/answer");
      const result = annotateCommand(await http.command({
        name: "run.respond",
        projectId,
        input: { runId: runIdOf(flags), requestId: flags.request, text },
        idempotencyKey: flags.idempotencyKey,
      }));
      return maybeWait(http, flags, projectId, result);
    }
    if (verb === "cancel") {
      return annotateCommand(await http.command({
        name: "run.cancel",
        projectId,
        input: { runId: runIdOf(flags) },
        idempotencyKey: flags.idempotencyKey,
      }));
    }
    if (verb === "retry") {
      const result = annotateCommand(await http.command({
        name: "run.retry",
        projectId,
        input: { trackerId: trackerId(flags), ...(flags.run ? { runId: flags.run } : {}) },
        expectedRevision: flags.expectedRevision,
        idempotencyKey: flags.idempotencyKey,
      }));
      return maybeWait(http, flags, projectId, result);
    }
    if (verb === "reconcile") {
      const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
      return annotateCommand(await http.command({
        name: "run.reconcile",
        projectId,
        input: {
          runId: runIdOf(flags),
          resolution: flags.resolution ?? input.resolution,
        },
      }));
    }
    throw new BabelError("USAGE", `未知 run 动作 ${verb}`);
  }

  if (resource === "review") {
    const projectId = requireProject(flags);
    const name: CommandName = verb === "request-changes" || verb === "request_changes"
      ? "review.request_changes"
      : verb === "accept"
        ? "review.accept"
        : (() => { throw new BabelError("USAGE", `未知 review 动作 ${verb}`); })();
    if (name === "review.accept" && flags.expectedRevision == null) {
      throw new BabelError("USAGE", "review.accept 需要 --expected-revision");
    }
    const input = flags.inputPath ? await readInputJson(flags.inputPath) : {};
    return annotateCommand(await http.command({
      name,
      projectId,
      input: {
        runId: runIdOf(flags),
        ...(flags.comment || input.comment ? { comment: flags.comment ?? input.comment } : {}),
      },
      expectedRevision: flags.expectedRevision,
      idempotencyKey: flags.idempotencyKey,
    }));
  }

  if (resource === "history" && (verb === "get" || !action)) {
    return http.query({
      name: "history.get",
      projectId: requireProject(flags),
      input: { trackerId: trackerId(flags) },
    });
  }
  if (resource === "diff" && (verb === "get" || !action)) {
    return http.query({
      name: "diff.get",
      projectId: requireProject(flags),
      input: { runId: runIdOf(flags) },
    });
  }
  if (resource === "events") {
    const projectId = requireProject(flags);
    if (verb === "list") {
      return http.query({
        name: "events.list",
        projectId,
        input: { cursor: flags.after ?? flags.cursor },
      });
    }
    if (verb === "watch") {
      await watchEvents(http, projectId, flags.after ?? flags.cursor ?? "0", io);
      return undefined;
    }
    throw new BabelError("USAGE", `未知 events 动作 ${verb}`);
  }
  if (resource === "demo") {
    const projectId = flags.project ?? DEMO_ACTOR.projectIds[0];
    if (verb === "reset") {
      return annotateCommand(await http.command({ name: "demo.reset", projectId, input: {} }));
    }
    if (verb === "inject") {
      if (!flags.scenario) throw new BabelError("USAGE", "demo.inject 需要 --scenario");
      return annotateCommand(await http.command({
        name: "demo.inject",
        projectId,
        input: {
          scenario: flags.scenario,
          ...(flags.task || flags.id ? { trackerId: flags.task ?? flags.id } : {}),
          ...(flags.run ? { runId: flags.run } : {}),
        },
      }));
    }
    throw new BabelError("USAGE", `未知 demo 动作 ${verb}`);
  }

  if (isQueryName(resource) && !action) {
    return http.query({
      name: resource,
      projectId: flags.project,
      input: {
        ...(flags.id ? { trackerId: flags.id, runId: flags.id } : {}),
      },
    });
  }

  throw new BabelError("USAGE", extra ? `未知命令 ${resource} ${verb} ${extra}` : `未知命令 ${resource}${action ? ` ${verb}` : ""}`);
}

function isQueryName(name: string): name is QueryName {
  return [
    "task.get", "task.list", "run.show", "run.list", "diff.get", "artifact.list",
    "events.list", "view.list", "ready.list", "schema.types", "capabilities.get",
    "device.list", "hook.list", "history.get", "project.list",
  ].includes(name);
}

async function maybeWait(http: CliHttp, flags: CliFlags, projectId: string, result: CommandResult): Promise<unknown> {
  if (!flags.wait || !result.runId) return result;
  const run = await waitForRun(http, projectId, result.runId, flags.timeoutMs ?? WAIT_DEFAULT_MS);
  return {
    ...result,
    settled: run.status === "review_required" || TERMINAL_RUN.has(run.status),
    result: {
      ...result.result,
      wait: {
        status: run.status,
        settled: run.status === "review_required" || TERMINAL_RUN.has(run.status),
        note: "等待到达待验收或终态，未自动重派",
      },
      run,
    },
  };
}

async function watchEvents(http: CliHttp, projectId: string, cursor: string, io: CliIo): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closed = false;
    const session = http.watchEvents(projectId, cursor, (event) => {
      io.stdout.write(`${JSON.stringify(event)}\n`);
    }, (error) => {
      if (!closed) reject(error);
    });
    const stop = () => {
      if (closed) return;
      closed = true;
      session.close();
      io.stderr.write("已断开事件订阅，未取消任何 run。\n");
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
      rl.on("close", stop);
    }
  });
}
