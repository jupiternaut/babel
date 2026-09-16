import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Isolated scratch only. Never write a user Nimbalyst install. */
export const WORKER_SCRATCH_ROOT = path.resolve("D:/Projects/babel-nimbalyst-data/worker-scratch");

export function assertIsolatedPath(target: string, label = "path"): string {
  const resolved = path.resolve(target);
  const root = path.resolve(WORKER_SCRATCH_ROOT);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const same = equalsPath(resolved, root);
  const inside = resolved.toLowerCase().startsWith(prefix.toLowerCase());
  if (!same && !inside) {
    const error = new Error(`${label} 必须位于隔离目录 ${root}`);
    error.name = "VALIDATION";
    throw error;
  }
  return resolved;
}

export function resolveWorktree(projectId: string, runId: string, isolationRoot = WORKER_SCRATCH_ROOT): string {
  const root = assertIsolatedPath(isolationRoot, "isolationRoot");
  const safeProject = sanitizeSegment(projectId);
  const safeRun = sanitizeSegment(runId);
  return assertIsolatedPath(path.join(root, safeProject, safeRun), "worktree");
}

export function createIsolatedWorktree(projectId: string, runId: string, isolationRoot = WORKER_SCRATCH_ROOT): string {
  const worktree = resolveWorktree(projectId, runId, isolationRoot);
  mkdirSync(path.join(worktree, "src"), { recursive: true });
  mkdirSync(path.join(worktree, "artifacts"), { recursive: true });
  writeFileSync(
    path.join(worktree, "README.md"),
    [
      "Babel managed-worker scratch worktree.",
      "protocol: protocol-double | pi-sim",
      "This is not a real Pi execution and must not be labeled as one.",
      "",
    ].join("\n"),
    "utf8",
  );
  initSyntheticGit(worktree);
  return worktree;
}

function initSyntheticGit(worktree: string): void {
  const git = spawnSync("git", ["init"], { cwd: worktree, encoding: "utf8", windowsHide: true });
  if (git.status !== 0) return;
  spawnSync("git", ["add", "-A"], { cwd: worktree, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["-c", "user.email=worker-scratch@babel.local", "-c", "user.name=Babel Worker Scratch", "commit", "-m", "synthetic baseline"], {
    cwd: worktree,
    encoding: "utf8",
    windowsHide: true,
  });
}

export function fencePath(worktree: string): string {
  return path.join(assertIsolatedPath(worktree, "worktree"), ".babel-execution.json");
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    const error = new Error("非法的项目或 run 标识");
    error.name = "VALIDATION";
    throw error;
  }
  return cleaned;
}

function equalsPath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
