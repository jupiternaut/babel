import { describe, expect, it } from 'vitest';
import {
  SURFACE_BOARD_BREAKPOINT_PX,
  boardLayoutMode,
  claimsRealOnline,
  claimsRealOpsReady,
  claimsRealSsh,
  claimsRealTranslation,
  nodeFreshnessKind,
  nodeFreshnessLabel,
  opsHealthKind,
  opsHealthLabel,
  pdfTranslationKind,
  pdfTranslationLabel,
  projectBoardLayoutNote,
  projectNodesSurface,
  projectOfflineSurfaces,
  projectOpsSurface,
  projectPdfSurface,
  sanitizeSurfaceNote,
  surfaceAccessLabel,
} from '../babelSurfaces';

function collectTexts(view: ReturnType<typeof projectOfflineSurfaces>): string[] {
  const surfaces = [view.ops, view.nodes, view.pdf];
  const texts = [
    view.boardLayoutNote,
    view.placementNote,
    ...surfaces.flatMap((surface) => [
      surface.accessLabel,
      surface.demoLabel,
      surface.connectionNote,
      ...surface.layers.map((layer) => `${layer.label} ${layer.note}`),
      ...surface.ruleNotes,
      ...surface.errors.map((error) => error.message),
    ]),
    view.ops.healthLabel,
    view.ops.healthNote,
    view.nodes.freshnessLabel,
    view.nodes.freshnessNote,
    view.pdf.translationLabel,
    view.pdf.translationNote,
  ];
  return texts;
}

describe('babel surfaces projection', () => {
  it('labels demo versus unconnected access and never claims a live integration', () => {
    expect(surfaceAccessLabel('demo')).toBe('演示');
    expect(surfaceAccessLabel('idle')).toBe('未接入');
    expect(surfaceAccessLabel('unavailable')).toBe('未接入');
    expect(surfaceAccessLabel(undefined)).toBe('未接入');

    const demo = projectOfflineSurfaces({
      connection: 'demo',
      demoLabel: '演示数据',
      ops: { lastProbeOutcome: 'ok', lastProbeAt: '2026-09-14T11:00:00.000Z' },
      nodes: { lastCollectedAt: '2026-09-14T15:59:00.000Z', platform: 'ubuntu' },
      pdf: { documentId: 'doc-fixture', translationSource: 'test-fixture' },
      now: '2026-09-14T16:00:00.000Z',
    });

    expect(demo.ops.realOps).toBe(false);
    expect(demo.ops.realHealth).toBe(false);
    expect(demo.ops.restartExecuted).toBe(false);
    expect(demo.ops.chatVendorSelected).toBe(false);
    expect(demo.nodes.realMachine).toBe(false);
    expect(demo.nodes.realSsh).toBe(false);
    expect(demo.pdf.realTranslation).toBe(false);
    expect(demo.pdf.liveReader).toBe(false);
    expect(demo.ops.healthLabel).toBe('合成探测成功（演示）');
    expect(demo.nodes.freshnessLabel).toBe('已采集（演示）');
    expect(demo.pdf.translationLabel).toBe('测试译文（演示）');
    expect(collectTexts(demo).some((text) => claimsRealOnline(text))).toBe(false);
    expect(collectTexts(demo).some((text) => claimsRealOpsReady(text))).toBe(false);
    expect(collectTexts(demo).some((text) => claimsRealSsh(text))).toBe(false);
    expect(collectTexts(demo).some((text) => claimsRealTranslation(text))).toBe(false);
  });

  it('does not treat missing probe or collection time as success', () => {
    expect(opsHealthKind({ connection: 'demo' })).toBe('unknown');
    expect(opsHealthLabel('unknown')).toBe('未知');
    expect(nodeFreshnessKind({
      connection: 'demo',
      lastCollectedAt: null,
      now: '2026-09-14T16:00:00.000Z',
    })).toBe('unknown');
    expect(nodeFreshnessLabel('unknown')).toBe('未知');
    expect(pdfTranslationKind({ connection: 'demo' })).toBe('none');
    expect(pdfTranslationLabel('none')).toBe('无译文');

    const view = projectOfflineSurfaces({ connection: 'demo', demoLabel: '演示数据' });
    expect(view.ops.healthNote).toMatch(/不能写成服务已恢复/);
    expect(view.nodes.freshnessNote).toMatch(/不能推断离线/);
    expect(view.pdf.translationNote).toMatch(/不能写成已对译/);
  });

  it('rewrites unconnected rows that try to claim live success', () => {
    expect(claimsRealOnline('在线')).toBe(true);
    expect(claimsRealOnline('演示在线')).toBe(false);
    expect(claimsRealOnline('不显示在线')).toBe(false);
    expect(claimsRealOpsReady('健康通过')).toBe(true);
    expect(claimsRealSsh('SSH已通')).toBe(true);
    expect(claimsRealTranslation('翻译完成')).toBe(true);
    expect(sanitizeSurfaceNote('ops', '健康通过')).toBe('未接入真实运维。不显示服务已恢复，也不显示健康通过。');
    expect(sanitizeSurfaceNote('nodes', '节点在线')).toBe('未接入真机节点。不显示在线，也不显示 SSH 已通。');
    expect(sanitizeSurfaceNote('pdf', '翻译完成')).toBe('未接入真实翻译。不显示翻译完成。');

    const view = projectOfflineSurfaces({
      connection: 'idle',
      ops: { connectionNote: '健康通过' },
      nodes: { connectionNote: '节点在线' },
      pdf: { connectionNote: '翻译完成' },
    });
    expect(view.ops.connectionNote).toMatch(/未接入真实运维/);
    expect(view.nodes.connectionNote).toMatch(/未接入真机节点/);
    expect(view.pdf.connectionNote).toMatch(/未接入真实翻译/);
    expect(view.ops.accessLabel).toBe('未接入');
    expect(view.nodes.accessLabel).toBe('未接入');
    expect(view.pdf.accessLabel).toBe('未接入');
  });

  it('keeps a live translation flag from becoming 翻译完成', () => {
    const view = projectPdfSurface({
      connection: 'demo',
      pdf: { documentId: 'doc-1', translationSource: 'live' },
    });
    expect(view.realTranslation).toBe(false);
    expect(view.translationKind).toBe('unconnected');
    expect(view.translationLabel).toBe('未接入');
    expect(view.translationNote).toMatch(/不显示翻译完成/);
    expect(view.ruleNotes.some((note) => note.includes('不显示翻译完成'))).toBe(true);
  });

  it('reuses boardLayoutMode(768) and does not invent a squeezed four-column mobile board', () => {
    expect(SURFACE_BOARD_BREAKPOINT_PX).toBe(768);
    expect(boardLayoutMode(767)).toBe('stage-list');
    expect(boardLayoutMode(768)).toBe('columns');
    expect(boardLayoutMode(1586)).toBe('columns');

    const narrow = projectOfflineSurfaces({ boardWidthPx: 767 });
    expect(narrow.boardLayoutMode).toBe('stage-list');
    expect(narrow.boardBreakpointPx).toBe(768);
    expect(narrow.boardLayoutNote).toMatch(/阶段列表/);
    expect(narrow.boardLayoutNote).toMatch(/不把四列挤成不可读卡片/);
    expect(narrow.placementNote).toMatch(/不进入中央四列/);

    const wide = projectBoardLayoutNote(768);
    expect(wide).toMatch(/中央保持四列/);
    expect(wide).toMatch(/留在左侧/);
  });

  it('keeps SSH, Worker and Agent layers separate on demo nodes', () => {
    const view = projectNodesSurface({ connection: 'demo' });
    expect(view.layers.slice(0, 3).map((layer) => layer.label)).toEqual(['未知', '未知', '未知']);
    expect(view.layers[0].note).toMatch(/不等于 Worker/);
    expect(projectNodesSurface({ connection: 'idle' }).layers.every((layer) => (
      layer.label === '未接入'
    ))).toBe(true);
  });

  it('marks a synthetic health failure as a draft input, not a restart', () => {
    const view = projectOpsSurface({
      connection: 'demo',
      ops: {
        lastProbeOutcome: 'http_error',
        lastProbeAt: '2026-09-14T11:00:00.000Z',
        draftCount: 1,
      },
    });
    expect(view.healthKind).toBe('synthetic-fail');
    expect(view.healthLabel).toBe('合成探测失败（演示）');
    expect(view.healthNote).toMatch(/不自动重启/);
    expect(view.restartExecuted).toBe(false);
    expect(view.layers.find((layer) => layer.id === 'repair')?.label).toBe('已拒绝自动执行');
  });
});
