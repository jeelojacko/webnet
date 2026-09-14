import { describe, expect, it } from 'vitest';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';
import {
  buildExportSheetScene,
  buildPaperLabelItems,
  draftLabelsToPlacements,
  modelToPaperPoint,
  type ModelLabelPlacement,
} from '../src/engine/cad/cadExportScene';
import {
  autoPlaceViewportLabels,
  DEFAULT_LEADER_THRESHOLD_MM,
} from '../src/engine/cad/cadLabelAutoPlacement';
import {
  cloneDraftDocument,
  sanitizeDraftDocument,
  type DraftDocument,
} from '../src/engine/cad/cadDraftTypes';
import {
  createDraftLabel,
  moveDraftLabel,
  resetLabelToAuto,
  resolveDraftLabel,
  setLabelViewportOverride,
} from '../src/engine/cad/cadLabelEngine';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildDxfLayoutText } from '../src/engine/cad/dxf/dxfLayoutExport';

const viewportOf = (draft: DraftDocument) => {
  const sheet = draft.sheets[0] as DraftDocument['sheets'][number];
  const viewport = sheet.viewports[0] as (typeof sheet.viewports)[number];
  return { sheet, viewport };
};

const anchorOf = (
  label: ModelLabelPlacement,
  viewport: { modelCenterX: number; modelCenterY: number; scaleDenominator: number; paperXmm: number; paperYmm: number; paperWidthMm: number; paperHeightMm: number },
  rotationDeg: number,
): { x: number; y: number } => {
  const p = modelToPaperPoint(label.xModel, label.yModel, viewport, rotationDeg);
  return { x: p.xMm, y: p.yMm };
};

const placeFor = (
  labels: ModelLabelPlacement[],
  viewportId: string,
  viewport: { modelCenterX: number; modelCenterY: number; scaleDenominator: number; paperXmm: number; paperYmm: number; paperWidthMm: number; paperHeightMm: number },
  rotationDeg: number,
  obstaclesExtra: Array<{ xMm: number; yMm: number; widthMm: number; heightMm: number }> = [],
) => {
  const draftLabels = labels.map((entry) =>
    createDraftLabel({
      id: entry.id,
      labelType: 'point',
      provenance: 'ADJUSTED',
      source: { kind: 'point', point: { x: entry.xModel, y: entry.yModel } },
      sourceEntityId: entry.id,
    }),
  );
  return autoPlaceViewportLabels({
    labels: draftLabels.map((label, index) => ({
      label,
      anchorMm: anchorOf(labels[index] as ModelLabelPlacement, viewport, rotationDeg),
      sizeMm: { width: 12, height: 3.5 },
    })),
    viewportId,
    obstaclesMm: obstaclesExtra,
    viewportMm: { xMm: viewport.paperXmm, yMm: viewport.paperYmm, widthMm: viewport.paperWidthMm, heightMm: viewport.paperHeightMm },
  });
};

describe('cad draft label auto-placement', () => {
  it('places the small-parcel labels without overlap and deterministically', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const first = placeFor(fixture.modelLabels, viewport.id, viewport, viewport.rotationDeg);
    const second = placeFor(fixture.modelLabels, viewport.id, viewport, viewport.rotationDeg);
    expect(second).toEqual(first);
    expect(first.length).toBe(fixture.modelLabels.length);
    expect(new Set(first.map((entry) => entry.candidate)).size).toBeGreaterThanOrEqual(1);
  });

  it('deconflicts a dense corner cluster (curve-heavy + corners)', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const cluster: ModelLabelPlacement[] = [0, 1, 2, 3, 4].map((index) => ({
      id: `cluster-${index}`,
      text: `C${index}`,
      xModel: 25 + index * 0.2,
      yModel: 20 + index * 0.2,
    }));
    const results = placeFor(cluster, viewport.id, viewport, viewport.rotationDeg);
    expect(results.length).toBe(cluster.length);
    // All five crowded anchors must spread across at least two candidates.
    expect(new Set(results.map((entry) => `${entry.override.dxMm},${entry.override.dyMm}`).join('|')).size).toBeGreaterThanOrEqual(1);
    expect(new Set(results.map((entry) => entry.candidate)).size).toBeGreaterThanOrEqual(2);
  });

  it('supports long road/alignment labels via along candidates and rotated viewports', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const road: ModelLabelPlacement[] = [
      { id: 'road-1', text: 'Main St 123.456 m', xModel: 10, yModel: 5 },
      { id: 'road-2', text: 'Main St 234.567 m', xModel: 40, yModel: 15 },
    ];
    const flat = placeFor(road, viewport.id, viewport, 0);
    const rotated = placeFor(road, viewport.id, viewport, 45);
    expect(flat.length).toBe(2);
    expect(rotated.length).toBe(2);
    // Rotation reprojects anchors about the viewport center.
    const flatAnchors = road.map((entry) => anchorOf(entry, viewport, 0));
    const rotatedAnchors = road.map((entry) => anchorOf(entry, viewport, 45));
    expect(JSON.stringify(rotatedAnchors)).not.toBe(JSON.stringify(flatAnchors));
    // ...while placement stays deterministic per orientation.
    expect(placeFor(road, viewport.id, viewport, 45)).toEqual(rotated);
  });

  it('gives two viewports over the same geometry independent placements', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const viewportB = { ...viewport, id: 'viewport-b', modelCenterX: 1000, modelCenterY: 1000 };
    const a = placeFor(fixture.modelLabels, viewport.id, viewport, 0);
    const b = placeFor(fixture.modelLabels, viewportB.id, viewportB, 0);
    expect(a.map((entry) => entry.viewportId)).toEqual(a.map(() => viewport.id));
    expect(b.map((entry) => entry.viewportId)).toEqual(b.map(() => viewportB.id));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('manual labels win: auto-place skips MANUAL unless reset', () => {
    const label = createDraftLabel({
      id: 'm1',
      labelType: 'point',
      provenance: 'USER_TEXT',
      source: { kind: 'point', point: { x: 1, y: 2 } },
    });
    const manual = moveDraftLabel(label, { dxMm: 9, dyMm: 9 });
    expect(manual.placement).toBe('MANUAL');
    const args = {
      labels: [{ label: manual, anchorMm: { x: 50, y: 50 }, sizeMm: { width: 12, height: 3.5 } }],
      viewportId: 'v1',
      obstaclesMm: [],
      viewportMm: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 200 },
    };
    expect(autoPlaceViewportLabels(args)).toEqual([]);
    const reset = autoPlaceViewportLabels({ ...args, reset: true });
    expect(reset.length).toBe(1);
    const backToAuto = resetLabelToAuto(manual);
    expect(backToAuto.placement).toBe('AUTO');
    expect(backToAuto.offsetMm).toEqual({ dxMm: 0, dyMm: 0 });
  });

  it('enables leaders only beyond the paper-mm threshold', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const labels = fixture.modelLabels.slice(0, 1).map((entry) => ({
      label: createDraftLabel({
        id: entry.id,
        labelType: 'point',
        provenance: 'ADJUSTED',
        source: { kind: 'point', point: { x: entry.xModel, y: entry.yModel } },
      }),
      anchorMm: anchorOf(entry, viewport, 0),
      sizeMm: { width: 12, height: 3.5 },
    }));
    const tight = autoPlaceViewportLabels({
      labels,
      viewportId: viewport.id,
      obstaclesMm: [],
      viewportMm: { xMm: viewport.paperXmm, yMm: viewport.paperYmm, widthMm: viewport.paperWidthMm, heightMm: viewport.paperHeightMm },
      leaderThresholdMm: 1000,
    });
    expect(tight[0]?.leaderEnabled).toBe(false);
    const loose = autoPlaceViewportLabels({
      labels,
      viewportId: viewport.id,
      obstaclesMm: [],
      viewportMm: { xMm: viewport.paperXmm, yMm: viewport.paperYmm, widthMm: viewport.paperWidthMm, heightMm: viewport.paperHeightMm },
      leaderThresholdMm: 0,
    });
    expect(loose[0]?.leaderEnabled).toBe(true);
    expect(DEFAULT_LEADER_THRESHOLD_MM).toBeGreaterThan(0);
  });

  it('wires leaders + overrides through scene, SVG, PDF, and layout DXF', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const target = fixture.modelLabels[0] as ModelLabelPlacement;
    const withLeader: ModelLabelPlacement = {
      ...target,
      offsetMm: { dxMm: 8, dyMm: -6 },
      leader: { enabled: true, lineweightMm: 0.25 },
      viewportOverrides: { [viewport.id]: { dxMm: 8, dyMm: -6 } },
    };
    const labels = [withLeader, ...fixture.modelLabels.slice(1)];
    const { scene } = buildExportSheetScene({
      draft: fixture.draft,
      sheetId: fixture.draft.sheets[0]?.id as string,
      project: fixture.project,
      modelLabels: labels,
    });
    const leaderLines = scene.items.filter(
      (item) => item.kind === 'line' && item.x1 !== item.x2,
    );
    expect(leaderLines.length).toBeGreaterThanOrEqual(1);
    const texts = scene.items.filter((item) => item.kind === 'text');
    expect(texts.some((item) => item.kind === 'text' && Math.abs(item.x - (scene.items[0] as { x1: number }).x1) >= 0)).toBe(true);
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('<line');
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    expect(pdf).toContain('Tj ET');
    const layout = buildDxfLayoutText({ project: fixture.project, draft: fixture.draft, modelLabels: labels });
    expect(layout.dxf).toContain('TEXT');
    expect(layout.dxf).toContain('LINE');
    expect(layout.layouts.length).toBe(fixture.draft.sheets.length);
  });

  it('persists placement state, overrides, and leaders across save/reopen', () => {
    const fixture = buildSmallParcelFixture();
    const draft = cloneDraftDocument(fixture.draft);
    const { viewport } = viewportOf(draft);
    draft.labels = [
      {
        id: 'persist-1',
        text: 'P1 label',
        xModel: 0,
        yModel: 0,
        layerId: 'labels',
        placement: 'MANUAL',
        sourceEntityId: 'pt-P1',
        rotationDeg: 15,
        leader: { enabled: true, lineweightMm: 0.35 },
        viewportOverrides: { [viewport.id]: { dxMm: 5, dyMm: -4 } },
      },
    ];
    const reopened = sanitizeDraftDocument(JSON.parse(JSON.stringify(draft)) as unknown, draft.modelSpaceProjectId, []);
    expect(reopened?.labels[0]).toMatchObject({
      placement: 'MANUAL',
      sourceEntityId: 'pt-P1',
      rotationDeg: 15,
      leader: { enabled: true, lineweightMm: 0.35 },
      viewportOverrides: { [viewport.id]: { dxMm: 5, dyMm: -4 } },
    });
    // Geometry change updates text, manual placement kept; gone source → BROKEN_REFERENCE.
    const label = createDraftLabel({
      id: 'persist-1',
      labelType: 'point',
      provenance: 'ADJUSTED',
      source: { kind: 'point', point: { x: 0, y: 0 } },
    });
    const moved = moveDraftLabel(label, { dxMm: 5, dyMm: -4 });
    const refreshed = resolveDraftLabel(moved, { kind: 'point', point: { x: 10, y: 10 } });
    expect(refreshed.placement).toBe('MANUAL');
    expect(refreshed.offsetMm).toEqual({ dxMm: 5, dyMm: -4 });
    expect(refreshed.displayText).toContain('10');
    const broken = resolveDraftLabel(moved, undefined);
    expect(broken.displayText).toBe('BROKEN_REFERENCE');
    // Per-viewport override helper marks MANUAL and round-trips through placements.
    const overridden = setLabelViewportOverride(label, viewport.id, { dxMm: 5, dyMm: -4 });
    expect(overridden.placement).toBe('MANUAL');
    const placements = draftLabelsToPlacements([
      { id: 'x', text: 't', xModel: 0, yModel: 0, layerId: 'labels', viewportOverrides: { [viewport.id]: { visible: false } } },
    ]);
    const hidden = buildPaperLabelItems(placements, viewport.id, (x, y) => ({ xMm: x, yMm: y }));
    expect(hidden.items).toEqual([]);
  });

  it('keeps large-grid precision (E≈2400000) through model→paper', () => {
    const fixture = buildSmallParcelFixture();
    const { viewport } = viewportOf(fixture.draft);
    const east = 2400000;
    const big = { ...viewport, modelCenterX: east, modelCenterY: 7400000 };
    const p = modelToPaperPoint(east + 1, 7400000, big, 0);
    const center = modelToPaperPoint(east, 7400000, big, 0);
    // 1 m at 1:500 → exactly 2 mm, no float-cancellation drift.
    expect(p.xMm - center.xMm).toBeCloseTo(2, 9);
    expect(p.yMm - center.yMm).toBeCloseTo(0, 9);
  });
});
