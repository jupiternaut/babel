import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface RemoteResource {
  resourceId: string;
  relativePath: string;
  revision: string;
  readonly: true;
}

export class IsolatedSftpTree {
  constructor(private readonly root: string) {}

  resolve(relativePath: string): RemoteResource {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.includes("..")) {
      const error = new Error("拒绝路径穿越");
      error.name = "PERMISSION";
      throw error;
    }
    const absolute = path.join(this.root, normalized);
    if (!absolute.toLowerCase().startsWith(this.root.toLowerCase())) {
      const error = new Error("只读树越界");
      error.name = "PERMISSION";
      throw error;
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      const error = new Error("远端文件不存在");
      error.name = "NOT_FOUND";
      throw error;
    }
    const body = readFileSync(absolute);
    return {
      resourceId: `sftp:${normalized}`,
      relativePath: normalized,
      revision: createHash("sha256").update(body).digest("hex").slice(0, 16),
      readonly: true,
    };
  }
}
