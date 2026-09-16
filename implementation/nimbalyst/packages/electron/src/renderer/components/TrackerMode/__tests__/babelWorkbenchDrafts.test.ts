import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWorkbenchSessionStateForTests,
  getViewingRunId,
  getWorkbenchDraft,
  getWorkbenchTab,
  patchWorkbenchDraft,
  setViewingRunId,
  setWorkbenchTab,
} from '../babelWorkbench/babelDrafts';

describe('babel workbench drafts', () => {
  afterEach(() => {
    clearWorkbenchSessionStateForTests();
  });

  it('keeps drafts and tabs when switching tracker ids', () => {
    patchWorkbenchDraft('fixture-tracker-pdf', { message: '补充一句', startSummary: '先跑 PDF' });
    setWorkbenchTab('fixture-tracker-pdf', 'session');
    setViewingRunId('fixture-tracker-pdf', 'run-old');

    patchWorkbenchDraft('fixture-tracker-sync', { message: '另一张卡' });
    expect(getWorkbenchDraft('fixture-tracker-pdf')).toMatchObject({
      message: '补充一句',
      startSummary: '先跑 PDF',
    });
    expect(getWorkbenchTab('fixture-tracker-pdf')).toBe('session');
    expect(getViewingRunId('fixture-tracker-pdf')).toBe('run-old');
    expect(getWorkbenchDraft('fixture-tracker-sync').message).toBe('另一张卡');
  });

  it('does not treat viewing an old run as replacing the current run id store until set', () => {
    expect(getViewingRunId('missing')).toBeNull();
    setViewingRunId('missing', null);
    expect(getViewingRunId('missing')).toBeNull();
  });
});
