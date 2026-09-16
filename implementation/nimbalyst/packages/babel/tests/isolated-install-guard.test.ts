// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/isolated-install-dry-run.mjs",
);

const NEW_ROOT = "D:\\Projects\\babel-nimbalyst-data\\install-restore";

async function loadGuard() {
  return import(pathToFileURL(SCRIPT).href) as Promise<{
    checkIsolatedInstallPath: (input: string) => {
      allowed: boolean;
      code: string;
      resolved: string;
      reason: string;
    };
    checkMany: (paths: string[]) => { ok: boolean; checks: Array<{ allowed: boolean; code: string }> };
    NEW_ISOLATED: Record<string, string>;
    isSameOrInside: (target: string, root: string) => boolean;
  }>;
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  const stdout = result.stdout ?? "";
  expect(stdout, "stdout must stay JSON").not.toMatch(/\x1b\[/);
  return { status: result.status, stdout, stderr: result.stderr ?? "", body: JSON.parse(stdout.trim()) as Record<string, unknown> };
}

describe("LR-18 isolated install dry-run", () => {
  it("rejects missing CLI input without treating an empty dry-run as success", () => {
    const ran = runCli([]);
    expect(ran.status).toBe(2);
    expect(ran.body).toMatchObject({ ok: false, checks: [] });
  });

  it("allows only new isolation directories under babel-nimbalyst-data/install-restore", async () => {
    const guard = await loadGuard();
    const allowed = [
      guard.NEW_ISOLATED["demo-profile"],
      guard.NEW_ISOLATED["electron-profile"],
      guard.NEW_ISOLATED["npm-cache"],
      guard.NEW_ISOLATED["worker-scratch"],
      guard.NEW_ISOLATED["nodes-scratch"],
      path.join(NEW_ROOT, "backups", "lr-20260914-1107-example"),
      `${NEW_ROOT}\\demo-profile\\workspaces\\babel`,
    ];
    for (const candidate of allowed) {
      const result = guard.checkIsolatedInstallPath(candidate);
      expect(result.allowed, candidate).toBe(true);
      expect(result.code).toBe("NEW_ISOLATION");
    }
  });

  it("rejects Downloads, Program Files, and official user profiles", async () => {
    const guard = await loadGuard();
    const forbidden: Array<[string, string]> = [
      ["C:\\Users\\gengr\\Downloads\\nimbalyst", "FORBIDDEN_INSTALL"],
      ["C:\\Users\\gengr\\Downloads\\nimbalyst\\packages\\electron", "FORBIDDEN_INSTALL"],
      ["C:\\Program Files\\Nimbalyst", "FORBIDDEN_INSTALL"],
      ["C:\\Program Files\\Nimbalyst\\app", "FORBIDDEN_INSTALL"],
      ["C:\\Users\\gengr\\AppData\\Local\\Programs\\Nimbalyst", "FORBIDDEN_INSTALL"],
      ["C:\\Users\\gengr\\AppData\\Roaming\\Nimbalyst", "FORBIDDEN_OFFICIAL_PROFILE"],
      ["C:\\Users\\gengr\\AppData\\Roaming\\Nimbalyst\\app-settings.json", "FORBIDDEN_OFFICIAL_PROFILE"],
      ["C:\\Users\\gengr\\AppData\\Roaming\\@nimbalyst\\electron", "FORBIDDEN_OFFICIAL_PROFILE"],
      ["C:\\Users\\gengr\\AppData\\Local\\Nimbalyst", "FORBIDDEN_OFFICIAL_PROFILE"],
      ["C:\\Users\\gengr\\AppData\\Local\\@nimbalyst\\electron", "FORBIDDEN_OFFICIAL_PROFILE"],
      ["C:\\Users\\gengr\\AppData\\Local\\npm-cache", "FORBIDDEN_OFFICIAL_NPM"],
    ];
    for (const [candidate, code] of forbidden) {
      const result = guard.checkIsolatedInstallPath(candidate);
      expect(result.allowed, candidate).toBe(false);
      expect(result.code, candidate).toBe(code);
    }
  });

  it("rejects live isolated roots so restore cannot overwrite them", async () => {
    const guard = await loadGuard();
    const live = [
      "D:\\Projects\\babel-nimbalyst-data\\demo-profile",
      "D:\\Projects\\babel-nimbalyst-data\\demo-profile\\workspaces\\babel",
      "D:\\Projects\\babel-nimbalyst-data\\electron-profile",
      "D:\\Projects\\babel-nimbalyst-data\\electron-profile\\app-settings.json",
      "D:\\Projects\\babel-nimbalyst-cache\\npm",
      "D:\\Projects\\babel-nimbalyst-data\\worker-scratch",
      "D:\\Projects\\babel-nimbalyst-data\\nodes-scratch",
      "D:\\Projects\\babel-nimbalyst-data\\install-restore\\..\\demo-profile",
    ];
    for (const candidate of live) {
      const result = guard.checkIsolatedInstallPath(candidate);
      expect(result.allowed, candidate).toBe(false);
      expect(["LIVE_ISOLATED_IN_USE", "LIVE_ADJACENT"], candidate).toContain(result.code);
    }
  });

  it("rejects the data root itself and adjacent non-install directories", async () => {
    const guard = await loadGuard();
    const outside = [
      "D:\\Projects\\babel-nimbalyst-data",
      "D:\\Projects\\babel-nimbalyst-data\\development-runs\\lr-20260914-1107",
      "D:\\Projects\\babel-nimbalyst-data\\electron-appdata",
      "D:\\Projects\\babel-nimbalyst-data\\electron-local",
      "D:\\Projects\\babel-nimbalyst-cache",
      "D:\\Projects\\babel-nimbalyst-dev-kit",
    ];
    for (const candidate of outside) {
      const result = guard.checkIsolatedInstallPath(candidate);
      expect(result.allowed, candidate).toBe(false);
    }
  });

  it("does not treat install-restore-other as the allowed namespace", async () => {
    const guard = await loadGuard();
    const result = guard.checkIsolatedInstallPath("D:\\Projects\\babel-nimbalyst-data\\install-restore-other\\demo-profile");
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("OUTSIDE_NEW_ISOLATION");
    expect(guard.isSameOrInside(
      "D:\\Projects\\babel-nimbalyst-data\\install-restore-other",
      NEW_ROOT,
    )).toBe(false);
  });

  it("normalizes Windows paths independently of the host and denies ambiguous or escaped paths", async () => {
    const guard = await loadGuard();
    expect(guard.checkIsolatedInstallPath("d:/PROJECTS/babel-nimbalyst-data/install-restore/demo-profile").allowed).toBe(true);
    for (const candidate of ["", "demo-profile", "D:demo-profile", `${NEW_ROOT}\\demo-profile\\..\\..\\demo-profile`, `${NEW_ROOT}\\demo-profile:stream`, NEW_ROOT]) {
      expect(guard.checkIsolatedInstallPath(candidate).allowed, candidate).toBe(false);
    }
  });

  it("CLI --defaults accepts the five new isolation roles and backups", () => {
    const ran = runCli(["--defaults"]);
    expect(ran.status).toBe(0);
    expect(ran.body.ok).toBe(true);
    expect(ran.body.mode).toBe("demo");
    expect(ran.body.kind).toBe("isolated-install-dry-run");
    const checks = ran.body.checks as Array<{ allowed: boolean; resolved: string }>;
    expect(checks.length).toBeGreaterThanOrEqual(5);
    expect(checks.every((item) => item.allowed)).toBe(true);
    expect(checks.every((item) => item.resolved.toLowerCase().includes("install-restore"))).toBe(true);
  });

  it("CLI rejects official install and profile paths with exit 2", () => {
    const ran = runCli([
      "--path",
      "C:\\Users\\gengr\\Downloads\\nimbalyst",
      "--path",
      "C:\\Program Files\\Nimbalyst",
      "--path",
      "C:\\Users\\gengr\\AppData\\Roaming\\Nimbalyst",
    ]);
    expect(ran.status).toBe(2);
    expect(ran.body.ok).toBe(false);
    const checks = ran.body.checks as Array<{ allowed: boolean; code: string }>;
    expect(checks.map((item) => item.code)).toEqual([
      "FORBIDDEN_INSTALL",
      "FORBIDDEN_INSTALL",
      "FORBIDDEN_OFFICIAL_PROFILE",
    ]);
  });
});
