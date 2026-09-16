import { IsolatedSftpTree, type RemoteResource } from "../gateway/remote-files.ts";
import { nodeError } from "./errors.ts";
import { assertIsolatedPath, isDeniedPath, normalizeRelative, resolveInside } from "./paths.ts";
import type { MockSshSession } from "./session.ts";

export interface IsolatedNodeResource extends RemoteResource {
  nodeId: string;
  resourceId: string;
  readonly: true;
}

export class IsolatedNodeFileTree {
  private readonly tree: IsolatedSftpTree;
  readonly isolationRoot: string;

  constructor(
    isolationRoot: string,
    private readonly nodeId: string,
    private readonly session: MockSshSession,
    private readonly options: { authorized: boolean; deniedPaths?: string[] },
  ) {
    this.isolationRoot = assertIsolatedPath(isolationRoot, "node tree");
    this.tree = new IsolatedSftpTree(this.isolationRoot);
  }

  resolve(relativePath: string, expectedRevision?: string): IsolatedNodeResource {
    if (!this.options.authorized) {
      throw nodeError("UNAUTHORIZED", "未授权设备不访问");
    }
    if (!this.session.connected) {
      throw nodeError("DISCONNECTED", "SSH 会话已断开，只读资源引用不可用");
    }
    const normalized = normalizeRelative(relativePath);
    if (isDeniedPath(normalized, this.options.deniedPaths)) {
      throw nodeError("PERMISSION", "权限不足，拒绝读取该路径");
    }
    resolveInside(this.isolationRoot, normalized);

    let resource: RemoteResource;
    try {
      resource = this.tree.resolve(normalized);
    } catch (error) {
      if (error instanceof Error && (error.name === "PERMISSION" || error.name === "NOT_FOUND")) {
        throw error;
      }
      throw error;
    }

    if (expectedRevision != null && expectedRevision !== resource.revision) {
      throw nodeError("REVISION", "资源 revision 不匹配", {
        expectedRevision,
        actual: resource.revision,
      });
    }

    return {
      ...resource,
      nodeId: this.nodeId,
      relativePath: normalized,
      resourceId: `sftp:${this.nodeId}/${normalized}`,
      readonly: true,
    };
  }

  write(_relativePath: string): never {
    throw nodeError("PERMISSION", "SSH/SFTP 资源引用只读，拒绝写入");
  }
}
