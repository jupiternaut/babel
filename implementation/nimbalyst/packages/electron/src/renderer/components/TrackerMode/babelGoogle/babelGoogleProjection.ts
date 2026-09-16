import type {
  GoogleAccess,
  GoogleAccessLabel,
  GoogleQueryError,
  GoogleSyncKind,
  GoogleTasksStatusSnapshot,
  GoogleTasksView,
} from './types';

/** Spec 8.2: planned poll interval. Display only; this panel does not start polling. */
export const GOOGLE_POLL_INTERVAL_SECONDS = 60;

/** Overlap window used by the synthetic importer (120s). Display only. */
export const GOOGLE_OVERLAP_WINDOW_SECONDS = 120;

export interface GoogleTasksViewInput {
  status?: GoogleTasksStatusSnapshot | null;
}

export function googleAccessLabel(connection: GoogleAccess | undefined): GoogleAccessLabel {
  return connection === 'demo' ? '演示' : '未接入';
}

export function claimsRealGoogleSync(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  const mentionsSuccess = normalized.includes('同步成功')
    || normalized.includes('已同步')
    || normalized.includes('同步完成');
  if (!mentionsSuccess) return false;
  return !normalized.includes('演示') && !normalized.includes('合成');
}

export function sanitizeSyncNote(text: string): string {
  if (!claimsRealGoogleSync(text)) return text;
  return '未接入真实 Google 账号。不显示同步成功。';
}

export function googleSyncKind(status: GoogleTasksStatusSnapshot | null | undefined): GoogleSyncKind {
  if (!status || status.connection !== 'demo') return 'unconnected';
  if (status.reauthRequired || status.lastError?.status === 401) return 'reauth';
  if (!status.lastSyntheticPullAt) return 'unknown';
  return 'synthetic';
}

export function googleSyncLabel(kind: GoogleSyncKind): string {
  switch (kind) {
    case 'unconnected':
      return '未接入';
    case 'unknown':
      return '未知';
    case 'synthetic':
      return '合成拉取已完成（演示）';
    case 'reauth':
      return '需重新登录';
  }
}

export function googleSyncNote(kind: GoogleSyncKind): string {
  switch (kind) {
    case 'unconnected':
      return '没有真连接。未接入 Google Tasks，不显示同步成功。';
    case 'unknown':
      return '尚未做合成拉取。未知不能写成已同步。';
    case 'synthetic':
      return '合成拉取仅使用内存页。不是真实 Google 同步成功。';
    case 'reauth':
      return '合成会话需要重新登录。未读取用户 OAuth token。';
  }
}

export function projectGoogleErrors(status: GoogleTasksStatusSnapshot | null | undefined): GoogleQueryError[] {
  const errors: GoogleQueryError[] = [];
  if (!status || status.connection === 'unavailable') {
    errors.push({
      code: 'UNAVAILABLE',
      message: status?.connectionNote
        || '未接入 Google Tasks。本面板不启动真实同步。',
    });
  }
  if (status?.reauthRequired || status?.lastError?.status === 401) {
    errors.push({
      code: 'REAUTH_REQUIRED',
      message: status.lastError?.message || '需重新登录',
    });
  } else if (status?.lastError?.message) {
    errors.push({
      code: status.lastError.code ?? 'UPSTREAM',
      message: status.lastError.message,
    });
  }
  return errors;
}

export function projectGoogleTasksView(input: GoogleTasksViewInput = {}): GoogleTasksView {
  const status = input.status ?? { connection: 'idle' };
  const accessLabel = googleAccessLabel(status.connection);
  const syncKind = googleSyncKind(status);
  const selectedTasklistId = status.selectedTasklistId ?? null;
  const selectedTasklistTitle = status.selectedTasklistTitle ?? null;
  const conflictCount = status.conflictCount ?? 0;
  const demo = status.connection === 'demo';

  return {
    accessLabel,
    demoLabel: status.demoLabel || '演示数据',
    connectionNote: sanitizeSyncNote(
      status.connectionNote
        || (demo
          ? '演示服务已连接。Google Tasks 只走合成内存页，不是真实账号同步。'
          : '没有真连接。未接入 Google Tasks，不显示同步成功。'),
    ),
    realSync: false,
    oauthStarted: false,
    pollIntervalSeconds: GOOGLE_POLL_INTERVAL_SECONDS,
    overlapWindowSeconds: GOOGLE_OVERLAP_WINDOW_SECONDS,
    syncKind,
    syncLabel: googleSyncLabel(syncKind),
    syncNote: googleSyncNote(syncKind),
    selectedTasklistId,
    selectedTasklistTitle,
    selectedListNote: selectedTasklistId
      ? (demo
        ? '当前展示合成列表。未导入账号内全部任务，也不创建 Google 列表。'
        : '已记下列表标识，但未接入真实 Google，不能当作已同步。')
      : (demo
        ? '尚未选择合成列表。不会导入全部任务。'
        : '未选择任务列表。未接入时不会导入。'),
    conflictCount,
    conflictNote: conflictCount > 0
      ? `待处理冲突 ${conflictCount} 条。外部完成不是 Agent 已成功。`
      : '当前没有待处理冲突。',
    ruleNotes: [
      '外部完成不是 Agent 已成功，也不会把运行中的任务标为完成。',
      '外部删除不删除本地记录，也不取消运行。',
      '本面板不读取用户 OAuth，也不启动真实同步。',
    ],
    errors: projectGoogleErrors(status),
  };
}
