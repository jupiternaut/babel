// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Store files observed under the isolated Electron profile on 2026-09-14. */
export const ISOLATED_ELECTRON_STORE_FILES = [
  'app-settings.json',
  'workspace-settings.json',
  'ai-settings.json',
  'analytics-settings.json',
  'feature-tracking.json',
  'feature-usage.json',
  'nimbalyst-settings.json',
  'terminal-store.json',
  'database-backend.json',
  'mcp-endpoint.json',
] as const;

const ISOLATED_USER_DATA = 'D:/Projects/babel-nimbalyst-data/electron-profile';
const FORBIDDEN_PREFIXES = [
  'C:/Users/gengr/Downloads/nimbalyst',
  'C:/Program Files/Nimbalyst',
];

describe('isolated electron-store paths', () => {
  it('keeps known store files under the D-drive demo userData directory', () => {
    for (const file of ISOLATED_ELECTRON_STORE_FILES) {
      const resolved = path.posix.join(ISOLATED_USER_DATA, file);
      expect(resolved.startsWith(`${ISOLATED_USER_DATA}/`)).toBe(true);
      for (const forbidden of FORBIDDEN_PREFIXES) {
        expect(resolved.startsWith(forbidden)).toBe(false);
      }
    }
  });

  it('finds those store files on the current isolated profile when present', () => {
    if (!existsSync(ISOLATED_USER_DATA)) {
      expect(existsSync(ISOLATED_USER_DATA)).toBe(false);
      return;
    }
    const present = ISOLATED_ELECTRON_STORE_FILES.filter((file) =>
      existsSync(path.join(ISOLATED_USER_DATA, file)),
    );
    expect(present.length).toBeGreaterThan(0);
    expect(present).toEqual(expect.arrayContaining(['app-settings.json', 'workspace-settings.json']));
  });
});
