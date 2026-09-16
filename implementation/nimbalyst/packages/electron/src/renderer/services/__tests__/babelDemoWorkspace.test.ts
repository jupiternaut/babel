import { afterEach, describe, expect, it } from 'vitest';
import { allowedDemoWorkspacePath, isBabelDemoWorkspace } from '../babelDemoWorkspace';

const originalMode = process.env.BABEL_MODE;
const originalWorkspace = process.env.BABEL_DEMO_WORKSPACE;

afterEach(() => {
  if (originalMode == null) delete process.env.BABEL_MODE;
  else process.env.BABEL_MODE = originalMode;
  if (originalWorkspace == null) delete process.env.BABEL_DEMO_WORKSPACE;
  else process.env.BABEL_DEMO_WORKSPACE = originalWorkspace;
});

describe('demo workspace isolation', () => {
  it('does not treat an arbitrary workspace as demo just because BABEL_MODE=demo', () => {
    process.env.BABEL_MODE = 'demo';
    expect(isBabelDemoWorkspace('C:/Users/someone/Documents/other-project')).toBe(false);
  });

  it('matches the allowed demo workspace path', () => {
    process.env.BABEL_DEMO_WORKSPACE = 'D:/Projects/babel-nimbalyst-data/demo-profile/workspaces/babel';
    expect(isBabelDemoWorkspace('D:\\Projects\\babel-nimbalyst-data\\demo-profile\\workspaces\\babel')).toBe(true);
    expect(allowedDemoWorkspacePath()).toContain('demo-profile/workspaces/babel');
  });

  it('rejects lookalike paths and the old profile when an isolated profile is configured', () => {
    process.env.BABEL_DEMO_WORKSPACE = 'D:/acceptance/workspaces/babel';
    expect(isBabelDemoWorkspace('D:/acceptance/workspaces/babel')).toBe(true);
    expect(isBabelDemoWorkspace('D:/Projects/babel-nimbalyst-data/demo-profile/workspaces/babel')).toBe(false);
    expect(isBabelDemoWorkspace('D:/copy/babel-nimbalyst-data/demo-profile/workspaces/babel-backup')).toBe(false);
    expect(isBabelDemoWorkspace('D:/acceptance/workspaces/babel/child')).toBe(false);
  });

  it('preserves case on POSIX paths while accepting Windows separator and drive case variants', () => {
    process.env.BABEL_DEMO_WORKSPACE = '/home/user/Babel';
    expect(isBabelDemoWorkspace('/home/user/babel')).toBe(false);
    process.env.BABEL_DEMO_WORKSPACE = 'D:/Acceptance/Babel';
    expect(isBabelDemoWorkspace('d:\\acceptance\\babel\\')).toBe(true);
  });
});
