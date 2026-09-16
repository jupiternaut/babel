import { nodeError } from "./errors.ts";
import type { NodePlatform, PlatformServiceKind, ProbeLayers } from "./types.ts";

export const PLATFORM_SERVICE: Record<NodePlatform, PlatformServiceKind> = {
  windows: "windows-service",
  ubuntu: "systemd",
  macos: "launchd",
};

export interface MockSystemInterface {
  readonly platform: NodePlatform;
  readonly serviceKind: PlatformServiceKind;
  readonly realMachine: false;
  probe(): ProbeLayers;
  setLayers(next: Partial<ProbeLayers>): ProbeLayers;
}

const UNKNOWN_LAYERS: ProbeLayers = {
  ssh: "unknown",
  worker: "unknown",
  agent: "unknown",
};

export class MockPlatformAdapter implements MockSystemInterface {
  readonly realMachine = false as const;
  readonly serviceKind: PlatformServiceKind;
  private layers: ProbeLayers;

  constructor(
    readonly platform: NodePlatform,
    initial: Partial<ProbeLayers> = {},
  ) {
    this.serviceKind = PLATFORM_SERVICE[platform];
    this.layers = { ...UNKNOWN_LAYERS, ...initial };
  }

  probe(): ProbeLayers {
    return { ...this.layers };
  }

  setLayers(next: Partial<ProbeLayers>): ProbeLayers {
    this.layers = { ...this.layers, ...next };
    return this.probe();
  }
}

export function createPlatformAdapter(
  platform: NodePlatform,
  initial: Partial<ProbeLayers> = {},
): MockSystemInterface {
  if (platform !== "windows" && platform !== "ubuntu" && platform !== "macos") {
    throw nodeError("VALIDATION", "只支持 windows / ubuntu / macos 合成适配");
  }
  return new MockPlatformAdapter(platform, initial);
}
