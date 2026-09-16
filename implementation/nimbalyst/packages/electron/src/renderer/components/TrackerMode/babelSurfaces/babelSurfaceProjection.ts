import { formatBabelHostError } from '../../../services/babelDemoErrors';
import { boardLayoutMode } from '../babelWorkbench/babelScope';
import type {
  HealthKind,
  NodeFreshnessKind,
  NodesSurfaceSnapshot,
  NodesSurfaceView,
  OfflineSurfacesView,
  OpsSurfaceSnapshot,
  OpsSurfaceView,
  PdfSurfaceSnapshot,
  PdfSurfaceView,
  SurfaceAccess,
  SurfaceAccessLabel,
  SurfaceLayerView,
  SurfaceQueryError,
  SurfaceStatusSnapshot,
  TranslationKind,
} from './types';

/** Same board breakpoint as BabelExecutionBoard. Surfaces stay in the sidebar. */
export const SURFACE_BOARD_BREAKPOINT_PX = 768;

/** Spec 8.1 collection interval. Display only; this panel does not probe machines. */
export const NODE_COLLECTION_INTERVAL_SECONDS = 60;

/** Spec 8.1 stale threshold. Display only. */
export const NODE_SNAPSHOT_STALE_AFTER_SECONDS = 150;

export interface OfflineSurfacesInput {
  connection?: SurfaceAccess | null;
  demoLabel?: string;
  connectionNote?: string;
  ops?: OpsSurfaceSnapshot | null;
  nodes?: NodesSurfaceSnapshot | null;
  pdf?: PdfSurfaceSnapshot | null;
  boardWidthPx?: number;
  now?: string;
}

export function surfaceAccessLabel(connection: SurfaceAccess | null | undefined): SurfaceAccessLabel {
  return connection === 'demo' ? '演示' : '未接入';
}

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function negatedClaim(normalized: string, claim: string): boolean {
  return normalized.includes(`不显示${claim}`)
    || normalized.includes(`不是${claim}`)
    || normalized.includes(`不能写成${claim}`)
    || normalized.includes(`不能当作${claim}`)
    || normalized.includes(`不等于${claim}`);
}

export function claimsRealOnline(text: string): boolean {
  const normalized = compact(text);
  if (!normalized.includes('在线')) return false;
  if (normalized.includes('演示在线')) return false;
  if (negatedClaim(normalized, '在线')) return false;
  return true;
}

export function claimsRealOpsReady(text: string): boolean {
  const normalized = compact(text);
  if (normalized.includes('演示') || normalized.includes('合成') || normalized.includes('未接入')) {
    return false;
  }
  const hits = ['运维已通过', '健康通过', '服务已恢复', '生产运维', 'GitLab已接通', 'MediaWiki已接通'];
  if (!hits.some((hit) => normalized.includes(hit))) return false;
  return !hits.some((hit) => negatedClaim(normalized, hit));
}

export function claimsRealSsh(text: string): boolean {
  const normalized = compact(text);
  if (normalized.includes('演示') || normalized.includes('合成') || normalized.includes('未接入')) {
    return false;
  }
  const hits = ['SSH已通', '真机在线', '节点在线', 'SFTP已连接'];
  return hits.some((hit) => normalized.includes(hit) && !negatedClaim(normalized, hit));
}

export function claimsRealTranslation(text: string): boolean {
  const normalized = compact(text);
  if (normalized.includes('测试译文') || normalized.includes('test-fixture')) return false;
  if (normalized.includes('未接入') || normalized.includes('不交付')) return false;
  const hits = ['翻译完成', '真实翻译', '已对译'];
  if (!hits.some((hit) => normalized.includes(hit))) return false;
  return !hits.some((hit) => negatedClaim(normalized, hit));
}

export function sanitizeSurfaceNote(
  kind: 'ops' | 'nodes' | 'pdf',
  text: string,
): string {
  if (kind === 'ops' && (claimsRealOpsReady(text) || claimsRealOnline(text))) {
    return '未接入真实运维。不显示服务已恢复，也不显示健康通过。';
  }
  if (kind === 'nodes' && (claimsRealSsh(text) || claimsRealOnline(text))) {
    return '未接入真机节点。不显示在线，也不显示 SSH 已通。';
  }
  if (kind === 'pdf' && claimsRealTranslation(text)) {
    return '未接入真实翻译。不显示翻译完成。';
  }
  return text;
}

export function projectSurfaceErrors(
  connection: SurfaceAccess | null | undefined,
  connectionNote: string | undefined,
  queryError: SurfaceStatusSnapshot['queryError'],
  fallback: string,
): SurfaceQueryError[] {
  const errors: SurfaceQueryError[] = [];
  if (!connection || connection === 'unavailable' || connection === 'idle') {
    errors.push({
      code: 'UNAVAILABLE',
      message: connectionNote || fallback,
    });
  }
  if (queryError != null) {
    if (typeof queryError === 'object' && queryError && 'message' in queryError) {
      const row = queryError as { code?: string; message?: string };
      if (row.message) {
        errors.push({
          code: row.code ?? 'UNAVAILABLE',
          message: row.message,
        });
      }
    } else {
      errors.push(formatBabelHostError(queryError));
    }
  }
  return errors;
}

export function projectBoardLayoutNote(widthPx: number): string {
  const mode = boardLayoutMode(widthPx);
  if (mode === 'stage-list') {
    return '可用宽度不足 768。中央改为阶段列表，不把四列挤成不可读卡片。运维、节点和 PDF 说明留在左侧。';
  }
  return '可用宽度达到 768。中央保持四列。运维、节点和 PDF 说明留在左侧，不进入中央看板。';
}

function resolveConnection(
  snapshot: SurfaceStatusSnapshot | null | undefined,
  fallback: SurfaceAccess | null | undefined,
): SurfaceAccess {
  return snapshot?.connection ?? fallback ?? 'idle';
}

export function opsHealthKind(input: {
  connection: SurfaceAccess;
  lastProbeOutcome?: OpsSurfaceSnapshot['lastProbeOutcome'];
  lastProbeAt?: string | null;
}): HealthKind {
  if (input.connection !== 'demo') return 'unconnected';
  if (!input.lastProbeAt || !input.lastProbeOutcome) return 'unknown';
  return input.lastProbeOutcome === 'ok' ? 'synthetic-ok' : 'synthetic-fail';
}

export function opsHealthLabel(kind: HealthKind): string {
  switch (kind) {
    case 'unconnected':
      return '未接入';
    case 'unknown':
      return '未知';
    case 'synthetic-ok':
      return '合成探测成功（演示）';
    case 'synthetic-fail':
      return '合成探测失败（演示）';
  }
}

export function opsHealthNote(kind: HealthKind): string {
  switch (kind) {
    case 'unconnected':
      return '没有真连接。未接入运维。GitLab 与 MediaWiki 都未接通。';
    case 'unknown':
      return '尚未做合成探测。未知不能写成服务已恢复。';
    case 'synthetic-ok':
      return '合成回环探测成功。这不是生产验收，也不表示用户服务已接通。';
    case 'synthetic-fail':
      return '合成探测失败只产出修复待办输入。不自动重启服务，也不执行修复。';
  }
}

export function projectOpsSurface(input: OfflineSurfacesInput = {}): OpsSurfaceView {
  const snapshot = input.ops ?? {};
  const connection = resolveConnection(snapshot, input.connection);
  const accessLabel = surfaceAccessLabel(connection);
  const demo = connection === 'demo';
  const healthKind = opsHealthKind({
    connection,
    lastProbeOutcome: snapshot.lastProbeOutcome,
    lastProbeAt: snapshot.lastProbeAt,
  });
  const defaultNote = demo
    ? '合成运维探测与聊天草稿。不是 GitLab、MediaWiki，也没有部署聊天服务器。'
    : '运维未接入。没有真实健康探测，也不重启用户服务。';

  const layers: SurfaceLayerView[] = [
    {
      id: 'health',
      title: '登记服务健康',
      label: accessLabel === '未接入' ? '未接入' : (healthKind === 'unknown' ? '未知' : opsHealthLabel(healthKind)),
      note: demo
        ? '只读合成 HTTP。失败可预填修复待办，不自动执行，也不关闭探测进程。'
        : '没有登记 GitLab 或 MediaWiki。空列表不能写成服务已恢复。',
    },
    {
      id: 'chat',
      title: '聊天转待办',
      label: '未选定',
      note: '中立合成适配器，vendor=none。未选定 Element 或 Fluxer，也没有部署聊天服务器。',
    },
    {
      id: 'repair',
      title: '修复与重启',
      label: '已拒绝自动执行',
      note: 'ops.repair.execute 与 ops.service.restart 保持拒绝。确认前不落库，落库也不启动 Agent。',
    },
  ];

  return {
    kind: 'ops',
    accessLabel,
    demoLabel: snapshot.demoLabel || input.demoLabel || '演示数据',
    connectionNote: sanitizeSurfaceNote('ops', snapshot.connectionNote || input.connectionNote || defaultNote),
    realOps: false,
    realHealth: false,
    restartExecuted: false,
    chatVendorSelected: false,
    healthKind,
    healthLabel: opsHealthLabel(healthKind),
    healthNote: opsHealthNote(healthKind),
    draftCount: snapshot.draftCount ?? 0,
    layers,
    ruleNotes: [
      '探测失败默认只产出待办输入；确认后才创建任务，不自动启动。',
      '未选定聊天厂商，消息须确认才保存。',
      '本面板不连接用户服务，也不重启进程。',
    ],
    errors: projectSurfaceErrors(
      connection,
      snapshot.connectionNote || input.connectionNote,
      snapshot.queryError,
      '运维未接入。本面板不启动真实健康探测。',
    ),
  };
}

export function nodeFreshnessKind(input: {
  connection: SurfaceAccess;
  lastCollectedAt?: string | null;
  now: string;
}): NodeFreshnessKind {
  if (input.connection !== 'demo') return 'unconnected';
  if (!input.lastCollectedAt) return 'unknown';
  const observed = Date.parse(input.lastCollectedAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return 'unknown';
  if (now - observed > NODE_SNAPSHOT_STALE_AFTER_SECONDS * 1000) return 'stale';
  return 'fresh';
}

export function nodeFreshnessLabel(kind: NodeFreshnessKind): string {
  switch (kind) {
    case 'unconnected':
      return '未接入';
    case 'unknown':
      return '未知';
    case 'stale':
      return '快照过期';
    case 'fresh':
      return '已采集（演示）';
  }
}

export function nodeFreshnessNote(kind: NodeFreshnessKind): string {
  switch (kind) {
    case 'unconnected':
      return '没有真连接。未接入节点采集，不显示在线。';
    case 'unknown':
      return '查询未返回采集时间。未知不能推断离线或 Agent 已停止。';
    case 'stale':
      return '超过 150 秒未成功采集。快照过期不能推断离线或 Agent 已停止。';
    case 'fresh':
      return '最近一次合成采集在 freshness 阈值内。这不是真机探测，也不显示在线。';
  }
}

export function projectNodesSurface(input: OfflineSurfacesInput = {}): NodesSurfaceView {
  const snapshot = input.nodes ?? {};
  const connection = resolveConnection(snapshot, input.connection);
  const accessLabel = surfaceAccessLabel(connection);
  const demo = connection === 'demo';
  const now = input.now ?? new Date().toISOString();
  const freshnessKind = nodeFreshnessKind({
    connection,
    lastCollectedAt: snapshot.lastCollectedAt,
    now,
  });
  const layerLabel = demo ? '未知' : '未接入';
  const defaultNote = demo
    ? '合成节点与隔离 SFTP 树。不是真机 SSH，也不扫描局域网。'
    : '节点未接入。没有 SSH / SFTP 真连接，不显示在线。';

  const layers: SurfaceLayerView[] = [
    {
      id: 'ssh',
      title: 'SSH 可达',
      label: layerLabel,
      note: demo
        ? 'SSH 可达不等于 Worker 可用。演示节点未做真机探测。'
        : '没有 SSH 探测，不能写成不可达或已离线。',
    },
    {
      id: 'worker',
      title: 'Worker 可用',
      label: layerLabel,
      note: demo
        ? 'Worker 可用不等于 Agent 可用。演示节点未做真机探测。'
        : '没有 Worker 探测。SSH 未接入也不等于节点已停止。',
    },
    {
      id: 'agent',
      title: 'Agent 能力可用',
      label: layerLabel,
      note: demo
        ? 'Agent 状态来自合成查询，失联不是已停止。'
        : '没有 Agent 能力探测。未接入不能写成 Agent 已停止。',
    },
    {
      id: 'sftp',
      title: 'SFTP 只读引用',
      label: demo ? '隔离合成树' : '未接入',
      note: demo
        ? '只读资源引用停留在隔离目录。断线不取消原 run，重连不重跑。'
        : '没有真机 SFTP。空列表不能写成文件已同步。',
    },
  ];

  return {
    kind: 'nodes',
    accessLabel,
    demoLabel: snapshot.demoLabel || input.demoLabel || '演示数据',
    connectionNote: sanitizeSurfaceNote('nodes', snapshot.connectionNote || input.connectionNote || defaultNote),
    realMachine: false,
    realSsh: false,
    nodeId: snapshot.nodeId ?? null,
    platform: snapshot.platform ?? null,
    freshnessKind,
    freshnessLabel: nodeFreshnessLabel(freshnessKind),
    freshnessNote: nodeFreshnessNote(freshnessKind),
    attachedResourceCount: snapshot.attachedResourceCount ?? 0,
    layers,
    ruleNotes: [
      `采集周期 ${NODE_COLLECTION_INTERVAL_SECONDS} 秒、过期 ${NODE_SNAPSHOT_STALE_AFTER_SECONDS} 秒是规格说明，本面板不启动真机采集。`,
      'Windows / Ubuntu / macOS 字段分开；SSH、Worker、Agent 互不推导。',
      '本面板不扫描局域网，也不连接未授权主机。',
    ],
    errors: projectSurfaceErrors(
      connection,
      snapshot.connectionNote || input.connectionNote,
      snapshot.queryError,
      '节点未接入。本面板不启动真机 SSH。',
    ),
  };
}

export function pdfTranslationKind(input: {
  connection: SurfaceAccess;
  translationSource?: PdfSurfaceSnapshot['translationSource'];
  documentId?: string | null;
}): TranslationKind {
  if (input.connection !== 'demo') return 'unconnected';
  if (input.translationSource === 'test-fixture') return 'test-fixture';
  if (input.translationSource === 'live') return 'unconnected';
  if (!input.documentId) return 'none';
  return 'none';
}

export function pdfTranslationLabel(kind: TranslationKind): string {
  switch (kind) {
    case 'unconnected':
      return '未接入';
    case 'none':
      return '无译文';
    case 'test-fixture':
      return '测试译文（演示）';
  }
}

export function pdfTranslationNote(kind: TranslationKind): string {
  switch (kind) {
    case 'unconnected':
      return '没有翻译凭据，也没有真实 PDF 阅读器。不显示翻译完成。';
    case 'none':
      return '当前没有测试译文。空白不能写成已对译。';
    case 'test-fixture':
      return '译文来源是 test-fixture。这不是真实翻译。';
  }
}

export function projectPdfSurface(input: OfflineSurfacesInput = {}): PdfSurfaceView {
  const snapshot = input.pdf ?? {};
  const connection = resolveConnection(snapshot, input.connection);
  const accessLabel = surfaceAccessLabel(connection);
  const demo = connection === 'demo';
  const translationKind = pdfTranslationKind({
    connection,
    translationSource: snapshot.translationSource,
    documentId: snapshot.documentId,
  });
  const defaultNote = demo
    ? 'PDF 锚点与测试译文接口。没有真实阅读器，也不交付真实翻译。'
    : 'PDF 未接入。没有原页阅读器，也不显示翻译完成。';

  const layers: SurfaceLayerView[] = [
    {
      id: 'anchor',
      title: '选文锚点',
      label: demo ? (snapshot.documentId ? '合成文档' : '未知') : '未接入',
      note: demo
        ? '跨版本 remap 只作用于合成文档。不能当成用户 PDF 已打开。'
        : '没有打开本地 PDF。空锚点不能写成已定位。',
    },
    {
      id: 'bilingual',
      title: '段落对译',
      label: pdfTranslationLabel(translationKind),
      note: pdfTranslationNote(translationKind),
    },
    {
      id: 'annotate',
      title: '批注与任务引用',
      label: demo ? '测试批注' : '未接入',
      note: demo
        ? '批注 source 固定为 test-fixture。引用任务不启动 Agent。'
        : '没有批注通道。不能把空列表写成已同步到任务。',
    },
  ];

  return {
    kind: 'pdf',
    accessLabel,
    demoLabel: snapshot.demoLabel || input.demoLabel || '演示数据',
    connectionNote: sanitizeSurfaceNote('pdf', snapshot.connectionNote || input.connectionNote || defaultNote),
    realTranslation: false,
    liveReader: false,
    documentId: snapshot.documentId ?? null,
    revision: snapshot.revision ?? null,
    translationKind,
    translationLabel: pdfTranslationLabel(translationKind),
    translationNote: pdfTranslationNote(translationKind),
    annotationCount: snapshot.annotationCount ?? 0,
    layers,
    ruleNotes: [
      '即使出现 live 标记也不显示翻译完成。本面板没有翻译凭据。',
      '锚点绑定任务只记引用，不启动执行。',
      '本面板不打开用户文件，也不导出已翻译 PDF。',
    ],
    errors: projectSurfaceErrors(
      connection,
      snapshot.connectionNote || input.connectionNote,
      snapshot.queryError,
      'PDF 未接入。本面板不打开真实阅读器。',
    ),
  };
}

export function projectOfflineSurfaces(input: OfflineSurfacesInput = {}): OfflineSurfacesView {
  const width = input.boardWidthPx ?? 1586;
  const mode = boardLayoutMode(width);
  return {
    ops: projectOpsSurface(input),
    nodes: projectNodesSurface(input),
    pdf: projectPdfSurface(input),
    boardBreakpointPx: SURFACE_BOARD_BREAKPOINT_PX,
    boardLayoutMode: mode,
    boardLayoutNote: projectBoardLayoutNote(width),
    placementNote: '这些说明挂在左侧，不进入中央四列，也不另造独立产品页。',
  };
}

export { boardLayoutMode };
