import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lexical dry-run for the Windows isolation namespace. This neither writes files
// nor authorizes a restore: the actual installer must also check filesystem state.
const DATA_ROOT = 'D:\\Projects\\babel-nimbalyst-data';
const INSTALL_ROOT = path.win32.join(DATA_ROOT, 'install-restore');
export const NEW_ISOLATED = Object.fromEntries(
  ['demo-profile', 'electron-profile', 'npm-cache', 'worker-scratch', 'nodes-scratch', 'backups']
    .map(role => [role, path.win32.join(INSTALL_ROOT, role)]),
);
const LIVE_ROOTS = ['demo-profile', 'electron-profile', 'worker-scratch', 'nodes-scratch']
  .map(role => path.win32.join(DATA_ROOT, role))
  .concat('D:\\Projects\\babel-nimbalyst-cache\\npm');

export function isSameOrInside(target, root) {
  const relative = path.win32.relative(root.toLowerCase(), target.toLowerCase());
  return relative === '' || (!relative.startsWith(`..${path.win32.sep}`) && relative !== '..' && !path.win32.isAbsolute(relative));
}

export function checkIsolatedInstallPath(input) {
  const resolved = typeof input === 'string' ? path.win32.normalize(input) : '';
  const result = (allowed, code, reason) => ({ allowed, code, resolved, reason });
  if (typeof input !== 'string' || !/^[a-z]:[\\/]/i.test(input) || /[\0\r\n]/.test(input) || input.slice(2).includes(':')) {
    return result(false, 'INVALID_PATH', 'A fully qualified Windows path without streams is required.');
  }
  const normalized = resolved.toLowerCase();
  if (/^[a-z]:\\(?:program files(?: \(x86\))?(?:\\|$)|users\\[^\\]+\\(?:downloads\\nimbalyst|appdata\\local\\programs\\nimbalyst)(?:\\|$))/.test(normalized)) {
    return result(false, 'FORBIDDEN_INSTALL', 'The installed application must not be overwritten.');
  }
  if (/^[a-z]:\\users\\[^\\]+\\appdata\\(?:local|roaming)\\(?:nimbalyst|@nimbalyst\\electron)(?:\\|$)/.test(normalized)) {
    return result(false, 'FORBIDDEN_OFFICIAL_PROFILE', 'The official user profile must not be overwritten.');
  }
  if (/^[a-z]:\\users\\[^\\]+\\appdata\\local\\npm-cache(?:\\|$)/.test(normalized)) {
    return result(false, 'FORBIDDEN_OFFICIAL_NPM', 'The user npm cache is outside the isolation namespace.');
  }
  if (LIVE_ROOTS.some(root => isSameOrInside(resolved, root))) {
    return result(false, 'LIVE_ISOLATED_IN_USE', 'Existing development roots must not be restored over.');
  }
  if (Object.values(NEW_ISOLATED).some(root => isSameOrInside(resolved, root))) {
    return result(true, 'NEW_ISOLATION', 'Path is in the dedicated install/restore namespace.');
  }
  return result(false, 'OUTSIDE_NEW_ISOLATION', 'Only dedicated install/restore roles and backups are allowed.');
}

export function checkMany(paths) {
  const checks = paths.map(checkIsolatedInstallPath);
  return { ok: checks.length > 0 && checks.every(check => check.allowed), mode: 'demo', kind: 'isolated-install-dry-run', checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), paths = [];
  let invalid = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--defaults') paths.push(...Object.values(NEW_ISOLATED));
    else if (args[index] === '--path' && args[index + 1] && !args[index + 1].startsWith('--')) paths.push(args[++index]);
    else invalid = true;
  }
  const result = checkMany(paths);
  if (invalid) result.ok = false;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
