import { describe, expect, it } from 'vitest';
import {
  NODE_COLLECTION_INTERVAL_SECONDS,
  NODE_SNAPSHOT_STALE_AFTER_SECONDS,
  projectNodesSurface,
  projectOfflineSurfaces,
  projectOpsSurface,
  projectPdfSurface,
  projectSurfaceErrors,
} from '../babelSurfaces';

describe('babel offline surface notes', () => {
  it('keeps selected node, drafts and fixture document as a read-only projection', () => {
    const view = projectOfflineSurfaces({
      connection: 'demo',
      demoLabel: '演示数据',
      ops: { draftCount: 2, lastProbeOutcome: 'ok', lastProbeAt: '2026-09-14T11:00:00.000Z' },
      nodes: {
        nodeId: 'node-ubuntu',
        platform: 'ubuntu',
        attachedResourceCount: 1,
        lastCollectedAt: '2026-09-14T15:59:00.000Z',
      },
      pdf: {
        documentId: 'doc-fixture',
        revision: 2,
        translationSource: 'test-fixture',
        annotationCount: 3,
      },
      now: '2026-09-14T16:00:00.000Z',
    });

    expect(view.ops.draftCount).toBe(2);
    expect(view.nodes.nodeId).toBe('node-ubuntu');
    expect(view.nodes.platform).toBe('ubuntu');
    expect(view.nodes.attachedResourceCount).toBe(1);
    expect(view.pdf.documentId).toBe('doc-fixture');
    expect(view.pdf.revision).toBe(2);
    expect(view.pdf.annotationCount).toBe(3);
    expect(view.ops.ruleNotes.some((note) => note.includes('不自动启动'))).toBe(true);
    expect(view.nodes.ruleNotes.some((note) => note.includes('不扫描局域网'))).toBe(true);
    expect(view.pdf.ruleNotes.some((note) => note.includes('不启动执行'))).toBe(true);
    expect(NODE_COLLECTION_INTERVAL_SECONDS).toBe(60);
    expect(NODE_SNAPSHOT_STALE_AFTER_SECONDS).toBe(150);
  });

  it('does not apply a live filter or success label when the query is unavailable', () => {
    const view = projectOfflineSurfaces({
      connection: 'unavailable',
      ops: { connectionNote: '演示服务未接入。未启动运维探测。', draftCount: 4 },
      nodes: { connectionNote: '演示服务未接入。未启动节点采集。', nodeId: 'ghost' },
      pdf: { connectionNote: '演示服务未接入。未打开 PDF。', documentId: 'ghost-doc' },
    });
    expect(view.ops.accessLabel).toBe('未接入');
    expect(view.nodes.accessLabel).toBe('未接入');
    expect(view.pdf.accessLabel).toBe('未接入');
    expect(view.ops.healthKind).toBe('unconnected');
    expect(view.nodes.freshnessKind).toBe('unconnected');
    expect(view.pdf.translationKind).toBe('unconnected');
    expect(view.ops.errors[0]).toMatchObject({ code: 'UNAVAILABLE' });
    expect(view.nodes.errors[0]).toMatchObject({ code: 'UNAVAILABLE' });
    expect(view.pdf.errors[0]).toMatchObject({ code: 'UNAVAILABLE' });
    expect(view.ops.draftCount).toBe(4);
    expect(view.nodes.nodeId).toBe('ghost');
    expect(view.pdf.documentId).toBe('ghost-doc');
    expect(view.ops.healthNote).toMatch(/GitLab/);
    expect(view.nodes.freshnessNote).toMatch(/不显示在线/);
    expect(view.pdf.translationNote).toMatch(/不显示翻译完成/);
  });

  it('surfaces structured query errors without inventing success', () => {
    expect(projectSurfaceErrors(
      'unavailable',
      '演示服务未接入。未启动运维探测。',
      undefined,
      '运维未接入。',
    )).toEqual([{
      code: 'UNAVAILABLE',
      message: '演示服务未接入。未启动运维探测。',
    }]);
    expect(projectSurfaceErrors('demo', undefined, {
      code: 'PERMISSION',
      message: '当前身份不能查询该项目的运维草稿',
    }, '运维未接入。')).toEqual([{
      code: 'PERMISSION',
      message: '当前身份不能查询该项目的运维草稿',
    }]);
  });

  it('defaults to 未接入 when the host has not passed a status snapshot', () => {
    const view = projectOfflineSurfaces();
    expect(view.ops.accessLabel).toBe('未接入');
    expect(view.nodes.accessLabel).toBe('未接入');
    expect(view.pdf.accessLabel).toBe('未接入');
    expect(view.ops.realOps).toBe(false);
    expect(view.nodes.realMachine).toBe(false);
    expect(view.pdf.realTranslation).toBe(false);
    expect(view.boardLayoutMode).toBe('columns');
    expect(view.boardBreakpointPx).toBe(768);
  });

  it('marks a snapshot stale after 150 seconds without calling that offline', () => {
    const stale = projectNodesSurface({
      connection: 'demo',
      nodes: { lastCollectedAt: '2026-09-14T15:57:29.000Z' },
      now: '2026-09-14T16:00:00.000Z',
    });
    expect(stale.freshnessKind).toBe('stale');
    expect(stale.freshnessLabel).toBe('快照过期');
    expect(stale.freshnessNote).toMatch(/不能推断离线/);
    expect(stale.layers.every((layer) => layer.label !== '离线')).toBe(true);
  });

  it('keeps ops, nodes and PDF copy understandable when demo service is connected', () => {
    const ops = projectOpsSurface({ connection: 'demo' });
    const nodes = projectNodesSurface({ connection: 'demo' });
    const pdf = projectPdfSurface({ connection: 'demo' });
    expect(ops.connectionNote).toMatch(/不是 GitLab/);
    expect(ops.layers.find((layer) => layer.id === 'chat')?.note).toMatch(/未选定 Element/);
    expect(nodes.connectionNote).toMatch(/不是真机 SSH/);
    expect(pdf.connectionNote).toMatch(/不交付真实翻译/);
    expect(pdf.liveReader).toBe(false);
  });
});
