#!/usr/bin/env node
// Local development only: no dependency installation, signing, or publishing.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, lstatSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const repo = path.dirname(path.dirname(script));
const source = path.join(repo, 'implementation/nimbalyst');
const electron = path.join(source, 'packages/electron');
const babel = path.join(source, 'packages/babel');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

export function configuration(profile, environment = process.env, nodePath = process.execPath) {
  if (!path.isAbsolute(profile)) throw new Error('--profile must be an absolute path');
  const root = path.resolve(profile);
  const ports = { babel: 7780, vite: 5273, cdp: 9223 };
  for (const [key, variable] of Object.entries({ babel: 'BABEL_PORT', vite: 'VITE_PORT', cdp: 'NIMBALYST_CDP_PORT' })) {
    if (environment[variable]) ports[key] = Number(environment[variable]);
    if (!Number.isInteger(ports[key]) || ports[key] < 1024 || ports[key] > 65535) throw new Error(`Invalid ${variable}`);
  }
  if (new Set(Object.values(ports)).size !== 3) throw new Error('Babel, Vite and CDP ports must be distinct');
  const output = `out-macos-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
  const paths = {
    root, demo: path.join(root, 'demo'), electron: path.join(root, 'electron'),
    system: path.join(root, 'system'), logs: path.join(root, 'logs'), cache: path.join(root, 'cache'),
    workspace: path.join(root, 'demo/workspaces/babel'),
  };
  const inherited = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(BABEL_|NIMBALYST_|ELECTRON_|VITE_BABEL_|PLAYWRIGHT)/.test(key)));
  const env = {
    ...inherited, PATH: `${path.dirname(nodePath)}${path.delimiter}${environment.PATH || ''}`,
    BABEL_PROFILE: paths.demo, BABEL_DEMO_WORKSPACE: paths.workspace,
    BABEL_ENDPOINT: `http://127.0.0.1:${ports.babel}`, VITE_BABEL_ENDPOINT: `http://127.0.0.1:${ports.babel}`,
    BABEL_PROJECT_ID: 'fixture-project-babel', BABEL_PORT: String(ports.babel),
    NIMBALYST_USER_DATA_DIR: paths.electron, NIMBALYST_USER_DATA_PATH: paths.electron,
    BABEL_SYSTEM_PROFILE: paths.system,
    NIMBALYST_CDP_PORT: String(ports.cdp), VITE_PORT: String(ports.vite),
    ELECTRON_ENTRY: `${output}/main/index.js`, NODE_ENV: 'development', npm_config_cache: paths.cache,
  };
  const experiments = { glassRefraction: environment.VITE_BABEL_GLASS_REFRACTION === 'true' };
  if (experiments.glassRefraction) env.VITE_BABEL_GLASS_REFRACTION = 'true';
  // Never borrow credentials or Node/Electron launch overrides from the caller.
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'REMOTE_DEBUGGING_PORT', 'V8_INSPECTOR_PORT', 'V8_INSPECTOR_BRK_PORT', 'NO_SANDBOX', 'RUN_ONE_DEV_MODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete env[key];
  return { paths, ports, output, env, experiments };
}

export function prepareProfile(root, repository = repo) {
  const marker = path.join(root, '.babel-macos-dev.json');
  if (existsSync(root)) {
    if (lstatSync(root).isSymbolicLink()) throw new Error('Profile root must not be a symlink');
    if (!existsSync(marker) && readdirSync(root).length) throw new Error('Refusing an existing nonempty profile without a Babel development marker');
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (existsSync(marker)) {
    const owner = readJson(marker);
    if (owner.version !== 1 || owner.repository !== repository) throw new Error('Profile belongs to another checkout');
  } else writeFileSync(marker, JSON.stringify({ version: 1, repository }, null, 2), { flag: 'wx', mode: 0o600 });
  for (const name of ['demo', 'electron', 'system', 'logs', 'cache']) {
    const dir = path.join(root, name);
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing a symlinked profile directory: ${dir}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function processTable() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart=,command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (result.status !== 0) throw new Error('Cannot inspect process identity');
  return result.stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), group: Number(match[2]), started: match[3].replace(/\s+/g, ' '), command: match[4] }] : [];
  });
}

export function sameProcess(expected, actual) {
  return Boolean(expected && actual && expected.pid === actual.pid && expected.group === actual.group && expected.started === actual.started && expected.command === actual.command);
}

export async function stopOwned(record, { graceMs = 5000 } = {}) {
  const current = processTable();
  const owner = current.find(item => item.pid === record.pid);
  if (!sameProcess(record, owner)) {
    if (owner || current.some(item => item.group === record.group)) throw new Error(`Refusing to stop PID/group ${record.pid}: ownership no longer matches`);
    return;
  }
  if (record.group !== record.pid || record.pid === process.pid) throw new Error('Refusing a non-owned process group');
  const members = current.filter(item => item.group === record.group);
  process.kill(-record.group, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processTable().some(item => item.group === record.group)) return;
    await delay(100);
  }
  // A leader may already have exited. Force only individual identities sampled
  // before SIGTERM, never a reused group or a newly unrelated process.
  for (const member of members) {
    if (sameProcess(member, processTable().find(item => item.pid === member.pid))) {
      try { process.kill(member.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  await delay(100);
  if (processTable().some(item => item.group === record.group)) throw new Error(`Owned group ${record.group} still has processes; inspect it before retrying`);
}

function save(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}

function listeners(port) {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8' });
  if (result.error || ![0, 1].includes(result.status)) throw new Error(`Cannot inspect TCP port ${port}`);
  let pid;
  return result.stdout.split('\n').flatMap(line => {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    return line.startsWith('n') ? [{ pid, address: line.slice(1) }] : [];
  });
}

function localListeners(port, owner) {
  const found = listeners(port);
  const group = processTable().filter(item => item.group === owner.group).map(item => item.pid);
  if (!found.length) throw new Error(`Port ${port} has no listener`);
  if (found.some(item => !/^(127\.0\.0\.1|\[::1\]):/.test(item.address) || !group.includes(item.pid))) {
    throw new Error(`Port ${port} is not exclusively loopback and owned by this run`);
  }
  return found;
}

async function waitReady(url, owner, timeoutMs = 180_000, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (!sameProcess(owner, processTable().find(item => item.pid === owner.pid))) throw new Error(`Process ${owner.pid} exited before ${url} was ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function launch(command, args, cwd, env, logFile) {
  const fd = openSync(logFile, 'a', 0o600);
  let child;
  try {
    child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } finally { closeSync(fd); }
  const identity = processTable().find(item => item.pid === child.pid);
  child.unref();
  if (!identity || identity.group !== child.pid) {
    child.kill('SIGTERM');
    throw new Error(`Failed to capture owned process identity: ${logFile}`);
  }
  return { ...identity, logFile, args, cwd };
}

function resolveBinary(name) {
  const require = createRequire(path.join(electron, 'package.json'));
  const file = require.resolve(`${name}/package.json`);
  const spec = readJson(file);
  const bin = typeof spec.bin === 'string' ? spec.bin : spec.bin?.[name];
  if (!bin) throw new Error(`No installed binary for ${name}; prepare dependencies first`);
  return path.resolve(path.dirname(file), bin);
}

function versions(env) {
  const npm = spawnSync('npm', ['--version'], { env, encoding: 'utf8' });
  if (npm.status !== 0 || Number(npm.stdout.trim().split('.')[0]) < 11) throw new Error('npm >=11 is required on the selected Node PATH');
  const require = createRequire(path.join(electron, 'package.json'));
  return {
    node: process.version, nodePath: process.execPath, npm: npm.stdout.trim(), arch: process.arch,
    macOS: spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
    xcode: spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' }).stdout.trim(),
    commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
    worktreeDirty: Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim()),
    electron: readJson(require.resolve('electron/package.json')).version,
    electronVite: readJson(require.resolve('electron-vite/package.json')).version,
  };
}

async function start(config) {
  const { paths, ports, env, output, experiments } = config;
  prepareProfile(paths.root);
  const stateFile = path.join(paths.root, 'run.json');
  const lockFile = path.join(paths.root, 'start.lock');
  let lock;
  try { lock = openSync(lockFile, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`A start lock already exists: ${lockFile}; inspect its PID before removing only that stale lock`); throw error; }
  const started = [];
  const abort = new AbortController();
  const interrupted = () => abort.abort(new Error('Startup interrupted'));
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted);
  let state;
  try {
    writeFileSync(lock, JSON.stringify(processTable().find(item => item.pid === process.pid)));
    if (existsSync(stateFile)) {
      const previous = readJson(stateFile);
      if ((previous.processes || []).some(owner => processTable().some(item => item.pid === owner.pid || item.group === owner.group))) throw new Error('A recorded development instance still exists; use status/stop first');
    }
    for (const port of Object.values(ports)) if (listeners(port).length) throw new Error(`TCP port ${port} is occupied; no process was stopped`);
    const vite = resolveBinary('electron-vite');
    state = { version: 1, repository: repo, createdAt: new Date().toISOString(), status: 'preparing', versions: versions(env), paths, ports, output, experiments, processes: started };
    save(stateFile, state);
    const buildLog = path.join(paths.logs, 'prepare.log');
    const fd = openSync(buildLog, 'a', 0o600);
    try {
      for (const args of [['run', 'build', '--prefix', '../extension-sdk'], ['run', 'build:worker']]) {
        const result = spawnSync('npm', args, { cwd: electron, env, stdio: ['ignore', fd, fd] });
        if (result.status !== 0) throw new Error(`Preparation failed; inspect ${buildLog}`);
      }
    } finally { closeSync(fd); }
    abort.signal.throwIfAborted();
    started.push(await launch(process.execPath, ['--import', 'tsx', 'scripts/acceptance-server.ts'], babel, env, path.join(paths.logs, 'babel.log')));
    state.status = 'starting'; save(stateFile, state);
    await waitReady(`${env.BABEL_ENDPOINT}/v2/health`, started[0], 30_000, abort.signal);
    localListeners(ports.babel, started[0]);
    started.push(await launch(process.execPath, [vite, 'dev', `--outDir=${output}`, '--', '--remote-debugging-address=127.0.0.1', '--workspace', paths.workspace], electron, env, path.join(paths.logs, 'electron.log')));
    save(stateFile, state);
    await waitReady(`http://127.0.0.1:${ports.cdp}/json/version`, started[1], 180_000, abort.signal);
    localListeners(ports.cdp, started[1]); localListeners(ports.vite, started[1]);
    state.status = 'ready'; save(stateFile, state);
    return state;
  } catch (error) {
    const cleanupErrors = [];
    for (const owned of [...started].reverse()) try { await stopOwned(owned); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
    if (state) save(stateFile, { ...state, status: 'failed', error: error.message, cleanupErrors });
    throw new Error(`${error.message}${cleanupErrors.length ? `; cleanup: ${cleanupErrors.join('; ')}` : ''}`);
  } finally {
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    closeSync(lock); unlinkSync(lockFile);
  }
}

async function inspectOrStop(profile, stop) {
  const marker = path.join(profile, '.babel-macos-dev.json');
  const file = path.join(profile, 'run.json');
  if (!existsSync(file)) return { status: 'not-started', profile };
  if (!existsSync(marker) || readJson(marker).repository !== repo) throw new Error('Profile is not owned by this checkout');
  const state = readJson(file);
  if (state.version !== 1 || state.repository !== repo) throw new Error('Run record is not owned by this checkout');
  if (stop) {
    if (existsSync(path.join(profile, 'start.lock'))) throw new Error('Startup is still locked; let start finish before stopping');
    for (const owned of [...state.processes].reverse()) await stopOwned(owned);
    state.status = 'stopped'; state.stoppedAt = new Date().toISOString(); save(file, state);
  }
  const table = processTable();
  const processes = state.processes.map(owner => ({ ...owner, alive: sameProcess(owner, table.find(item => item.pid === owner.pid)) }));
  const alive = processes.filter(item => item.alive).length;
  return {
    ...state, lastStartStatus: state.status,
    status: alive === 0 ? 'not-running' : alive === processes.length ? 'processes-running' : 'partially-running',
    processes, listeners: Object.fromEntries(Object.entries(state.ports).map(([key, port]) => [key, listeners(port)])),
  };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node scripts/dev-macos.mjs start|status|stop [--profile /absolute/path]\nNode >=24, npm >=11, macOS arm64. BABEL_NODE_BIN selects the Node bin directory.\nOptional ports: BABEL_PORT=7780 VITE_PORT=5273 NIMBALYST_CDP_PORT=9223.\nStart preserves data; stop only signals recorded process identities.');
    return;
  }
  const [command, ...rest] = args;
  if (!['start', 'status', 'stop'].includes(command) || (rest.length && (rest.length !== 2 || rest[0] !== '--profile' || !rest[1]))) throw new Error('Invalid arguments; use --help');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This development launcher targets native macOS arm64');
  const bin = process.env.BABEL_NODE_BIN || (existsSync('/opt/homebrew/opt/node@24/bin/node') ? '/opt/homebrew/opt/node@24/bin' : path.dirname(process.execPath));
  if (realpathSync(path.join(bin, 'node')) !== realpathSync(process.execPath) || Number(process.versions.node.split('.')[0]) < 24) {
    if (process.env.BABEL_MACOS_NODE_REEXEC) throw new Error('Selected Node binary must be >=24');
    const result = spawnSync(path.join(bin, 'node'), [script, ...args], { env: { ...process.env, BABEL_MACOS_NODE_REEXEC: '1', PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` }, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1; return;
  }
  const profile = rest[1] || path.join(homedir(), 'Library/Application Support/Babel/mac-dev');
  const config = configuration(profile, { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` });
  console.log(JSON.stringify(command === 'start' ? await start(config) : await inspectOrStop(config.paths.root, command === 'stop'), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  main().catch(error => { console.error(`Babel macOS: ${error.message}`); process.exitCode = 1; });
}
