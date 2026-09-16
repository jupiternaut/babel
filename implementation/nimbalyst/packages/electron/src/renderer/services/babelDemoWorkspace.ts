/**
 * Detect the isolated Babel M0 demo workspace. Production workspaces and the
 * user's installed Nimbalyst profile must never match.
 */

const DEFAULT_PROFILE = 'D:/Projects/babel-nimbalyst-data/demo-profile';

export function babelExecutionMode(): 'demo' | 'local' {
  return readEnv('BABEL_MODE') === 'local' ? 'local' : 'demo';
}

export function allowedDemoWorkspacePath(): string {
  const explicit = readEnv('BABEL_DEMO_WORKSPACE');
  if (explicit) return normalizePath(explicit);
  if (babelExecutionMode() === 'local') return '';
  const profile = readEnv('BABEL_PROFILE') || DEFAULT_PROFILE;
  return normalizePath(`${profile.replace(/[/\\]+$/, '')}/workspaces/babel`);
}

export function isBabelDemoWorkspace(workspacePath: string | null | undefined): boolean {
  if (!workspacePath) return false;
  const normalized = normalizePath(workspacePath);
  const allowed = allowedDemoWorkspacePath();
  return normalized === allowed;
}

export function babelDemoEndpoint(): string {
  const fromVite = readEnv('VITE_BABEL_ENDPOINT');
  if (fromVite) return fromVite.replace(/\/$/, '');
  const fromProcess = readEnv('BABEL_ENDPOINT');
  if (fromProcess) return fromProcess.replace(/\/$/, '');
  return 'http://127.0.0.1:7780';
}

export function babelDemoProjectId(): string {
  return readEnv('BABEL_PROJECT_ID') || 'fixture-project-babel';
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows paths are case-insensitive; POSIX workspaces must stay distinct.
  return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function readEnv(name: string): string | undefined {
  try {
    // Static access is required for Vite's explicit define replacements.
    const configured: Record<string, string | undefined> = {
      BABEL_MODE: import.meta.env.BABEL_MODE,
      BABEL_DEMO_WORKSPACE: import.meta.env.BABEL_DEMO_WORKSPACE,
      BABEL_PROFILE: import.meta.env.BABEL_PROFILE,
      BABEL_ENDPOINT: import.meta.env.BABEL_ENDPOINT,
      BABEL_PROJECT_ID: import.meta.env.BABEL_PROJECT_ID,
      VITE_BABEL_ENDPOINT: import.meta.env.VITE_BABEL_ENDPOINT,
    };
    const fromMeta = configured[name];
    if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  } catch {
    // Renderer may not expose every key on import.meta.env.
  }
  if (typeof process !== 'undefined' && typeof process.env?.[name] === 'string' && process.env[name]) {
    return process.env[name];
  }
  return undefined;
}
