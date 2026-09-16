import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NODES_SCRATCH_ROOT,
  SyntheticNodeHost,
  assertIsolatedPath,
  normalizeRelative,
} from "../src/nodes/index.ts";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function open(label: string) {
  const isolationRoot = path.join(
    NODES_SCRATCH_ROOT,
    "lr-12-tests",
    `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temps.push(isolationRoot);
  const host = new SyntheticNodeHost({ isolationRoot });
  return { host, isolationRoot };
}

describe("隔离 SFTP 只读资源引用（合成）", () => {
  it("同一内容得到稳定 resourceId 与 revision，内容变化后 revision 改变", () => {
    const { host, isolationRoot } = open("revision");
    host.command("node.register", {
      nodeId: "node-ubuntu",
      platform: "ubuntu",
      seedFiles: { "notes/readme.txt": "hello-v1\n" },
    });
    const first = host.command("node.attach", { nodeId: "node-ubuntu", relativePath: "notes/readme.txt" });
    expect(first.result.resourceId).toBe("sftp:node-ubuntu/notes/readme.txt");
    expect(first.result.readonly).toBe(true);
    expect(typeof first.result.revision).toBe("string");
    expect(String(first.result.revision).length).toBe(16);

    const again = host.resolveFile("node-ubuntu", "notes/readme.txt");
    expect(again.revision).toBe(first.result.revision);
    expect(again.resourceId).toBe(first.result.resourceId);

    const filePath = path.join(isolationRoot, "node-ubuntu", "tree", "notes", "readme.txt");
    writeFileSync(filePath, "hello-v2\n", "utf8");
    const next = host.resolveFile("node-ubuntu", "notes/readme.txt");
    expect(next.revision).not.toBe(first.result.revision);

    expect(() => host.command("node.attach", {
      nodeId: "node-ubuntu",
      relativePath: "notes/readme.txt",
      expectedRevision: first.result.revision,
    })).toThrow(/revision/);
    try {
      host.command("node.attach", {
        nodeId: "node-ubuntu",
        relativePath: "notes/readme.txt",
        expectedRevision: first.result.revision,
      });
    } catch (error) {
      expect((error as Error).name).toBe("REVISION");
    }

    const accepted = host.command("node.attach", {
      nodeId: "node-ubuntu",
      relativePath: "notes/readme.txt",
      expectedRevision: next.revision,
    });
    expect(accepted.result.revision).toBe(next.revision);
    const queried = host.query("node.resource", { nodeId: "node-ubuntu", relativePath: "notes/readme.txt" });
    expect((queried.resource as { revision: string }).revision).toBe(next.revision);
    const events = (host.query("node.events", { nodeId: "node-ubuntu" }).events) as Array<{ kind: string }>;
    expect(events.filter((event) => event.kind === "resource_attached").length).toBe(2);
  });

  it("拒绝路径穿越、绝对路径和 UNC", () => {
    const { host } = open("traverse");
    host.command("node.register", { nodeId: "node-win", platform: "windows" });

    const cases = [
      "../secret",
      "notes/../../outside.txt",
      "notes\\..\\..\\secret",
      "C:\\Windows\\win.ini",
      "/etc/passwd",
      "\\\\server\\share\\file",
      "notes/./../../etc/passwd",
    ];
    for (const relativePath of cases) {
      expect(() => host.resolveFile("node-win", relativePath), relativePath).toThrow(/穿越|越界/);
      try {
        host.resolveFile("node-win", relativePath);
      } catch (error) {
        expect((error as Error).name, relativePath).toBe("PERMISSION");
      }
    }
    expect(() => normalizeRelative("notes/\0hidden")).toThrow(/穿越/);
  });

  it("隔离根必须落在 babel-nimbalyst-data/nodes-scratch", () => {
    expect(() => new SyntheticNodeHost({ isolationRoot: "C:\\Users\\gengr\\AppData\\Local\\Temp\\babel-nodes" }))
      .toThrow(/隔离目录/);
    expect(() => assertIsolatedPath("D:\\Projects\\babel-nimbalyst-data\\worker-scratch\\nope", "tree"))
      .toThrow(/隔离目录/);
    const { isolationRoot } = open("inside");
    expect(assertIsolatedPath(isolationRoot).toLowerCase().startsWith(NODES_SCRATCH_ROOT.toLowerCase())).toBe(true);
  });

  it("受限路径与写入都是 PERMISSION", () => {
    const { host, isolationRoot } = open("acl");
    host.command("node.register", {
      nodeId: "node-mac",
      platform: "macos",
      deniedPaths: ["secret"],
      seedFiles: {
        "notes/readme.txt": "ok\n",
        "secret/key.txt": "do-not-read\n",
      },
    });
    expect(host.resolveFile("node-mac", "notes/readme.txt").relativePath).toBe("notes/readme.txt");
    expect(() => host.resolveFile("node-mac", "secret/key.txt")).toThrow(/权限/);
    try {
      host.resolveFile("node-mac", "secret/key.txt");
    } catch (error) {
      expect((error as Error).name).toBe("PERMISSION");
    }
    expect(() => host.writeFile("node-mac", "notes/readme.txt")).toThrow(/只读/);
    try {
      host.writeFile("node-mac", "notes/readme.txt");
    } catch (error) {
      expect((error as Error).name).toBe("PERMISSION");
    }
    expect(readFileSync(path.join(isolationRoot, "node-mac", "tree", "notes", "readme.txt"), "utf8")).toBe("ok\n");
    expect(() => host.resolveFile("node-mac", "missing.txt")).toThrow(/不存在/);
  });

  it("未授权节点与未登记主机都不访问", () => {
    const { host } = open("auth");
    host.command("node.register", {
      nodeId: "node-denied",
      platform: "ubuntu",
      authorized: false,
      seedFiles: { "notes/readme.txt": "hidden\n" },
    });
    expect(() => host.command("node.attach", { nodeId: "node-denied", relativePath: "notes/readme.txt" }))
      .toThrow(/未授权/);
    try {
      host.resolveFile("node-denied", "notes/readme.txt");
    } catch (error) {
      expect((error as Error).name).toBe("UNAUTHORIZED");
    }
    expect(() => host.probeHost("192.168.1.20")).toThrow(/不扫描局域网/);
    try {
      host.probeHost("10.0.0.8");
    } catch (error) {
      expect((error as Error).name).toBe("UNAUTHORIZED");
    }
    expect(() => host.resolveFile("not-registered", "notes/readme.txt")).toThrow(/未登记/);
  });
});
