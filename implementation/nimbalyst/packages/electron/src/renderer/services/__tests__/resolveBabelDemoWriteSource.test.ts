import { describe, expect, it, vi } from 'vitest';
import { resolveBabelDemoWriteSource } from '../createWorkspaceTrackerDataSource';

describe('resolveBabelDemoWriteSource', () => {
  it('returns the data source object, not the type-guard boolean', () => {
    const source = { kind: 'babel-demo', command: vi.fn() };
    const resolved = resolveBabelDemoWriteSource(source as never);
    expect(resolved).toBe(source);
    expect(typeof resolved?.command).toBe('function');
  });

  it('returns null for a native host source', () => {
    expect(resolveBabelDemoWriteSource({ kind: 'electron' } as never)).toBeNull();
    expect(resolveBabelDemoWriteSource(null)).toBeNull();
  });
});
