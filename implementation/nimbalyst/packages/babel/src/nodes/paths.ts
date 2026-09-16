import { mkdirSync } from "node:fs";
import path from "node:path";
import { nodeError } from "./errors.ts";

/** Isolated scratch only. Never write a user Nimbalyst install. */
export const BABEL_DATA_ROOT = path.resolve("D:/Projects/babel-nimbalyst-data");
export const NODES_SCRATCH_ROOT = path.resolve(BABEL_DATA_ROOT, "nodes-scratch");

export function assertIsolatedPath(target: string, label = "path"): string {
  const resolved = path.resolve(target);
  const root = path.resolve(NODES_SCRATCH_ROOT);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const same = equalsPath(resolved, root);
  const inside = resolved.toLowerCase().startsWith(prefix.toLowerCase());
  if (!same && !inside) {
    throw nodeError("VALIDATION", `${label} 必须位于隔离目录 ${root}`);
  }
  if (!resolved.toLowerCase().startsWith(path.resolve(BABEL_DATA_ROOT).toLowerCase())) {
    throw nodeError("VALIDATION", `${label} 必须位于 ${BABEL_DATA_ROOT}`);
  }
  return resolved;
}

export function ensureScratchRoot(): string {
  const root = assertIsolatedPath(NODES_SCRATCH_ROOT, "nodes-scratch");
  mkdirSync(root, { recursive: true });
  return root;
}

export function resolveNodeTree(isolationRoot: string, nodeId: string): string {
  const root = assertIsolatedPath(isolationRoot, "isolationRoot");
  return assertIsolatedPath(path.join(root, sanitizeSegment(nodeId), "tree"), "node tree");
}

export function normalizeRelative(relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw nodeError("VALIDATION", "缺少相对路径");
  }
  if (relativePath.includes("\0")) {
    throw nodeError("PERMISSION", "拒绝路径穿越");
  }
  const unified = relativePath.replace(/\\/g, "/");
  if (
    unified.startsWith("/")
    || unified.startsWith("//")
    || /^[A-Za-z]:/.test(unified)
    || unified.includes("://")
    || relativePath.startsWith("\\\\")
  ) {
    throw nodeError("PERMISSION", "拒绝路径穿越");
  }
  const parts = unified.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || part === "~")) {
    throw nodeError("PERMISSION", "拒绝路径穿越");
  }
  if (!parts.length) {
    throw nodeError("VALIDATION", "缺少相对路径");
  }
  return parts.join("/");
}

export function resolveInside(root: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  const resolvedRoot = assertIsolatedPath(root, "tree root");
  const absolute = path.resolve(resolvedRoot, ...normalized.split("/"));
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (equalsPath(absolute, resolvedRoot) || !absolute.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw nodeError("PERMISSION", "只读树越界");
  }
  return absolute;
}

export function isDeniedPath(relativePath: string, deniedPaths: string[] = []): boolean {
  const normalized = normalizeRelative(relativePath);
  return deniedPaths.some((denied) => {
    const rule = denied.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalized === rule || normalized.startsWith(`${rule}/`);
  });
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    throw nodeError("VALIDATION", "非法的节点标识");
  }
  return cleaned;
}

function equalsPath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
