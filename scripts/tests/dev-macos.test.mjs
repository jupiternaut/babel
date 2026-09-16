import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configuration, prepareProfile, processTable, stopOwned } from '../dev-macos.mjs';

test('one isolated profile overrides inherited endpoints, credentials and launch arguments', () => {
  const parent = { PATH: '/usr/bin', BABEL_PROFILE: '/personal', NIMBALYST_USER_DATA_DIR: '/personal',
    NIMBALYST_USER_DATA_PATH: '/personal/database', BABEL_SYSTEM_WINDOWS_SCRIPT: '/personal/control.ps1',
    BABEL_HOST: '0.0.0.0', BABEL_SYSTEM_PORT: '9090', NIMBALYST_DEV_PROTOCOL: '1',
    ELECTRON_EXEC_PATH: '/personal/Electron', PLAYWRIGHT: '1', NODE_ENV: 'production', RUN_ONE_DEV_MODE: 'true',
    BABEL_SERVICE_TOKEN: 'personal-secret', OPENAI_API_KEY: 'personal-key', NODE_OPTIONS: '--require bad.js',
    ELECTRON_RUN_AS_NODE: '1', ELECTRON_CLI_ARGS: '["--workspace","/personal"]', BABEL_PORT: '7890' };
  const config = configuration('/tmp/babel test profile', parent, '/custom/node24/bin/node');
  assert.equal(config.env.BABEL_PROFILE, '/tmp/babel test profile/demo');
  assert.equal(config.env.NIMBALYST_USER_DATA_DIR, '/tmp/babel test profile/electron');
  assert.equal(config.env.NIMBALYST_USER_DATA_PATH, config.env.NIMBALYST_USER_DATA_DIR);
  assert.equal(config.env.BABEL_SYSTEM_PROFILE, '/tmp/babel test profile/system');
  assert.equal(config.env.BABEL_DEMO_WORKSPACE, path.join(config.env.BABEL_PROFILE, 'workspaces/babel'));
  assert.equal(config.env.BABEL_ENDPOINT, 'http://127.0.0.1:7890');
  assert.equal(config.env.PATH, '/custom/node24/bin:/usr/bin');
  for (const key of ['BABEL_SERVICE_TOKEN', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_CLI_ARGS', 'BABEL_SYSTEM_WINDOWS_SCRIPT', 'BABEL_HOST', 'BABEL_SYSTEM_PORT', 'NIMBALYST_DEV_PROTOCOL', 'ELECTRON_EXEC_PATH', 'PLAYWRIGHT', 'RUN_ONE_DEV_MODE']) assert.equal(config.env[key], undefined);
  assert.equal(config.env.NODE_ENV, 'development');
  assert.equal(parent.OPENAI_API_KEY, 'personal-key');
  assert.throws(() => configuration('relative'), /absolute/);
  assert.throws(() => configuration('/tmp/test', { BABEL_PORT: '9223' }), /distinct/);
  assert.throws(() => configuration('/tmp/test', { BABEL_PORT: 'NaN' }), /Invalid/);
});

test('refraction is an explicit exact-value experiment and does not admit other Vite overrides', () => {
  for (const value of [undefined, 'false', '1', 'TRUE', 'true']) {
    const config = configuration('/tmp/babel-refraction', {
      VITE_BABEL_GLASS_REFRACTION: value,
      VITE_BABEL_ENDPOINT: 'https://personal-service.invalid',
      VITE_BABEL_EXPERIMENTAL_CONTROL: 'enabled',
    });
    assert.equal(config.env.VITE_BABEL_GLASS_REFRACTION, value === 'true' ? 'true' : undefined);
    assert.deepEqual(config.experiments, { glassRefraction: value === 'true' });
    assert.equal(config.env.VITE_BABEL_ENDPOINT, 'http://127.0.0.1:7780');
    assert.equal(config.env.VITE_BABEL_EXPERIMENTAL_CONTROL, undefined);
  }
});

test('profile initialization preserves data and refuses foreign or linked profiles', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'babel-macos-profile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'owned');
  prepareProfile(root, '/checkout');
  writeFileSync(path.join(root, 'demo/keep.json'), 'kept');
  prepareProfile(root, '/checkout');
  assert.equal(readFileSync(path.join(root, 'demo/keep.json'), 'utf8'), 'kept');
  assert.throws(() => prepareProfile(root, '/other'), /another checkout/);
  const personal = path.join(directory, 'personal'); mkdirSync(personal);
  writeFileSync(path.join(personal, 'app-settings.json'), 'private');
  assert.throws(() => prepareProfile(personal, '/checkout'), /nonempty profile/);
  const linked = path.join(directory, 'linked'); symlinkSync(personal, linked);
  assert.throws(() => prepareProfile(linked, '/checkout'), /symlink/);
  assert.equal(readFileSync(path.join(personal, 'app-settings.json'), 'utf8'), 'private');
});

test('stop refuses an identity mismatch and terminates only its owned process group', { skip: process.platform === 'win32' }, async t => {
  // These are idle test children, without listeners, services, or Electron.
  const children = [];
  t.after(() => { for (const child of children) try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  async function idle() {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    children.push(child);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    return child;
  }
  const owned = await idle(); const unrelated = await idle();
  const identity = processTable().find(item => item.pid === owned.pid);
  assert.ok(identity);
  await assert.rejects(stopOwned({ ...identity, started: 'not this process' }), /ownership/);
  assert.doesNotThrow(() => process.kill(owned.pid, 0));
  await stopOwned(identity, { graceMs: 1000 });
  assert.throws(() => process.kill(owned.pid, 0), /ESRCH/);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  await stopOwned(identity, { graceMs: 100 });
});

test('local Pi startup is explicit, isolated from demo, and does not inherit credentials', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'babel-local-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'profile');
  const file = path.join(directory, 'local.json');
  const workdir = path.join(directory, 'code'); mkdirSync(workdir);
  const local = { projectId: 'explicit-project', name: '本地项目', workdir, executable: '/explicit/pi',
    agentDir: path.join(root, 'local/pi-agent'), provider: 'explicit-provider', model: 'explicit-model' };
  writeFileSync(file, JSON.stringify(local));
  const env = { BABEL_MODE: 'local', BABEL_LOCAL_PI_CONFIG: file, BABEL_SERVICE_TOKEN: 'never-inherit', OPENAI_API_KEY: 'never-inherit' };
  const config = configuration(root, env);
  assert.deepEqual(config.ports, { babel: 7783, vite: 5274, cdp: 9224 });
  assert.equal(config.env.BABEL_PROFILE, path.join(root, 'local'));
  assert.equal(config.env.BABEL_PROJECT_ID, local.projectId);
  assert.equal(config.env.BABEL_DEMO_WORKSPACE, config.paths.workspace);
  assert.equal(config.env.BABEL_ENDPOINT, 'http://127.0.0.1:7783');
  assert.equal(config.env.BABEL_MODE, 'local');
  assert.equal(config.env.BABEL_LOCAL_PI_CONFIG, file);
  assert.equal(config.env.BABEL_SERVICE_TOKEN, undefined);
  assert.equal(config.env.OPENAI_API_KEY, undefined);
  assert.equal(config.serviceEntry, 'src/server/main.ts');
  prepareProfile(root, '/checkout', 'local');
  assert.throws(() => prepareProfile(root, '/checkout'), /another execution mode/);
  assert.throws(() => configuration(root, { BABEL_LOCAL_PI_CONFIG: file }), /BABEL_MODE=local/);
  assert.throws(() => configuration(root, { BABEL_MODE: 'local' }), /absolute JSON file/);
  writeFileSync(file, JSON.stringify({ ...local, agentDir: '/personal/.pi/agent' }));
  assert.throws(() => configuration(root, env), /dedicated/);
  writeFileSync(file, JSON.stringify({ ...local, model: '' }));
  assert.throws(() => configuration(root, env), /requires model/);
});
