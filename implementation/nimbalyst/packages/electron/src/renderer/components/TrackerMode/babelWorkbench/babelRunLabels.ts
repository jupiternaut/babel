export function runStatusLabel(status: string, mode: 'demo' | 'local' = 'demo'): string {
  const labels: Record<string, string> = {
    requested: '已请求',
    accepted: '已接受，尚未完成',
    executing: '执行中',
    waiting_input: '等待输入',
    verifying: '核验中',
    review_required: '待审查',
    cancel_requested: '取消尚未确认',
    lost: '失联，尚未核对',
    succeeded: mode === 'local' ? '已完成并验收' : '已成功（演示）',
    failed: '失败',
    cancelled: '已取消',
  };
  return labels[status] ?? status;
}

export function verificationLabel(state: string): string {
  const labels: Record<string, string> = {
    pending: '待判定',
    passed: '通过',
    failed: '未通过',
    skipped: '已跳过',
    waived: '人工豁免',
  };
  return labels[state] ?? state;
}

export function toolStateLabel(state: string): string {
  if (state === 'succeeded') return '已完成';
  if (state === 'executing') return '进行中';
  if (state === 'failed') return '失败';
  return state;
}
