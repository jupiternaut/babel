export interface BabelWorkbenchDraft {
  startSummary: string;
  message: string;
  respondText: string;
  reviewComment: string;
}

const emptyDraft = (): BabelWorkbenchDraft => ({
  startSummary: '',
  message: '',
  respondText: '',
  reviewComment: '',
});

const drafts = new Map<string, BabelWorkbenchDraft>();
const viewingRunByTracker = new Map<string, string | null>();
const tabByTracker = new Map<string, string>();

export function getWorkbenchDraft(trackerId: string): BabelWorkbenchDraft {
  return drafts.get(trackerId) ?? emptyDraft();
}

export function patchWorkbenchDraft(
  trackerId: string,
  patch: Partial<BabelWorkbenchDraft>,
): BabelWorkbenchDraft {
  const next = { ...getWorkbenchDraft(trackerId), ...patch };
  drafts.set(trackerId, next);
  return next;
}

export function getViewingRunId(trackerId: string): string | null {
  return viewingRunByTracker.has(trackerId) ? viewingRunByTracker.get(trackerId) ?? null : null;
}

export function setViewingRunId(trackerId: string, runId: string | null): void {
  viewingRunByTracker.set(trackerId, runId);
}

export function getWorkbenchTab(trackerId: string, fallback = 'detail'): string {
  return tabByTracker.get(trackerId) ?? fallback;
}

export function setWorkbenchTab(trackerId: string, tab: string): void {
  tabByTracker.set(trackerId, tab);
}

export function clearWorkbenchSessionStateForTests(): void {
  drafts.clear();
  viewingRunByTracker.clear();
  tabByTracker.clear();
}
