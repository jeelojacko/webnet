/**
 * Phase 18O annotation performance bench — MEASUREMENT ONLY.
 *
 * No absolute-time assertions and no source behavior changes: this file
 * builds representative annotation mixes and reports wall time for the
 * production seams. It exists to answer two questions with evidence:
 *
 *   1. How does derived-geometry / bounds / hit-test / SVG-export cost scale
 *      from 100 → 1,000 → 10,000 annotation entities?
 *   2. After editing ONE source line, does the architecture re-derive only
 *      the affected bearing/distance label or the whole label set?
 *
 * Results are printed as markdown tables (paper trail:
 * docs/evidence/phase18o-annotation-performance.md).
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildCadDisplayScene } from '../../cadRenderer';
import { entityIntersectsBounds } from '../../cadSpatialBounds';
import { buildCadSpatialIndex } from '../../cadSpatialIndex';
import { buildExportSheetSceneWithResult } from '../../cadExportScene';
import { serializeExportSceneToSvg } from '../../cadSvgSerializer';
import { createBlankDraftDocument, type DraftDocument } from '../../cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../../cadSheets';
import { primitiveBounds } from '../../../../components/surveyCad/SurveyCadPreview.geometry';
import { bearingLabelPlacement, deriveBearingDistanceLabel } from '../cadSurveyLabels';
import type { CadAnnotationAnchor } from '../cadAnnotationAnchors';
import {
  seedBearingLabelStyles,
  seedCurveLabelStyles,
  seedDimensionStyles,
  seedLeaderStyles,
  seedProfessionalTextStyles,
} from '../cadAnnotationSeeds';
import type {
  CadBlockDefinition,
  CadBounds,
  CadEntity,
  CadLayer,
  CadLineEntity,
  CadProject,
} from '../../cadTypes';

const ANNOTATION_LAYER = 'ann';
const GEOMETRY_LAYER = 'geom';
const SPACING = 25;

const annotationLayer = (): CadLayer => ({
  id: ANNOTATION_LAYER, name: 'Annotation', color: '#ffffff', visible: true, locked: false, role: 'labels',
});
const geometryLayer = (): CadLayer => ({
  id: GEOMETRY_LAYER, name: 'Geometry', color: '#ffffff', visible: true, locked: false, role: 'parcels',
});

const arrowBlock = (): CadBlockDefinition => ({
  id: 'arrow-closed',
  name: 'Closed Arrow',
  basePoint: { x: 0, y: 0 },
  entities: [{
    id: 'arrow-closed-body', type: 'polygon', layerId: GEOMETRY_LAYER, visible: true, locked: false,
    vertices: [{ x: 0, y: 0 }, { x: -1, y: 0.25 }, { x: -1, y: -0.25 }], vertexLabels: ['', '', ''],
  }],
});

const fixed = (x: number, y: number): CadAnnotationAnchor => ({ kind: 'fixed', x, y });

const baseProject = (layers: CadLayer[], bounds: CadBounds): CadProject => ({
  version: 2,
  id: 'perf-18o',
  name: 'Phase 18O Perf',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers,
  styleLibrary: { lineTypes: [], textStyles: seedProfessionalTextStyles(), pointSymbols: [], styles: [] },
  dimensionStyles: seedDimensionStyles(),
  leaderStyles: seedLeaderStyles(),
  bearingLabelStyles: seedBearingLabelStyles(),
  curveLabelStyles: seedCurveLabelStyles(),
  annotationSettings: { scaleDenominator: 500 },
  blockDefinitions: [arrowBlock()],
  entities: [],
  cogoComputations: [],
  bounds,
});

const gridPoint = (index: number, cols: number): { x: number; y: number } => ({
  x: (index % cols) * SPACING,
  y: Math.floor(index / cols) * SPACING,
});

const sourceLine = (index: number, cols: number): CadLineEntity => {
  const p = gridPoint(index, cols);
  return {
    type: 'line', id: `src-line-${index}`, layerId: GEOMETRY_LAYER, visible: true, locked: false,
    fromStationId: `P${index}`, toStationId: `Q${index}`,
    fromX: p.x, fromY: p.y, toX: p.x + 20, toY: p.y + 10, sourceObservationIds: [],
  };
};

const textStyleId = (): string => seedProfessionalTextStyles()[0]!.id;

/** 40% mtext, 20% leaders, 25% dimensions, 15% bearing/distance labels. */
const buildMixedDrawing = (size: number) => {
  const cols = Math.ceil(Math.sqrt(size));
  const geometryCount = Math.max(10, Math.ceil(size / 4));
  const bounds: CadBounds = { minX: 0, minY: 0, maxX: cols * SPACING + 30, maxY: Math.ceil(size / cols) * SPACING + 30 };
  const project = baseProject([annotationLayer(), geometryLayer()], bounds);
  const geometry: CadEntity[] = [];
  for (let i = 0; i < geometryCount; i += 1) geometry.push(sourceLine(i, cols));

  const mtextCount = Math.round(size * 0.4);
  const leaderCount = Math.round(size * 0.2);
  const dimensionCount = Math.round(size * 0.25);
  const bearingCount = size - mtextCount - leaderCount - dimensionCount;
  const entities: CadEntity[] = [...geometry];
  const style = textStyleId();

  for (let i = 0; i < mtextCount; i += 1) {
    const p = gridPoint(i, cols);
    entities.push({
      type: 'mtext', id: `mtext-${i}`, layerId: ANNOTATION_LAYER, visible: true, locked: false,
      x: p.x, y: p.y, text: `LABEL ${i}\nSECOND LINE`, textStyleId: style, rotationDeg: 0, attachment: 'middle-center',
    });
  }
  for (let i = 0; i < leaderCount; i += 1) {
    const p = gridPoint(i, cols);
    entities.push({
      type: 'leader', id: `leader-${i}`, layerId: ANNOTATION_LAYER, visible: true, locked: false,
      arrowAnchor: fixed(p.x, p.y), vertices: [{ x: p.x, y: p.y }, { x: p.x + 8, y: p.y + 6 }],
      text: 'LEADER TEXT', leaderStyleId: 'std-leader',
    });
  }
  for (let i = 0; i < dimensionCount; i += 1) {
    const p = gridPoint(i, cols);
    entities.push({
      type: 'dimension', id: `dim-${i}`, layerId: ANNOTATION_LAYER, visible: true, locked: false,
      dimensionKind: 'linear', anchors: [fixed(p.x, p.y), fixed(p.x + 20, p.y)],
      defPoint1: fixed(p.x, p.y), defPoint2: fixed(p.x + 20, p.y), orientation: 'horizontal',
      dimLinePoint: { x: p.x, y: p.y - 8 }, dimensionStyleId: 'std-500',
    });
  }
  for (let i = 0; i < bearingCount; i += 1) {
    entities.push({
      type: 'bearing-label', id: `bearing-${i}`, layerId: ANNOTATION_LAYER, visible: true, locked: false,
      sourceEntityId: `src-line-${i % geometryCount}`, labelStyleId: 'bearing-default', offset: { x: 0, y: 2 },
    });
  }
  project.entities = entities;
  return { project, counts: { mtext: mtextCount, leaders: leaderCount, dimensions: dimensionCount, bearings: bearingCount, geometry: geometryCount, total: entities.length } };
};

const buildDraft = (project: CadProject): { draft: DraftDocument; sheetId: string } => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Perf', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheet = draft.sheets[0]!;
  const bounds = project.bounds!;
  draft = addViewportToSheet(draft, sheet.id, {
    name: 'Perf viewport',
    modelCenterX: (bounds.minX + bounds.maxX) / 2,
    modelCenterY: (bounds.minY + bounds.maxY) / 2,
    scaleDenominator: 1000,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 250,
    paperHeightMm: 170,
  });
  return { draft, sheetId: sheet.id };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const measure = <T>(fn: () => T, runs: number): { ms: number; value: T } => {
  const samples: number[] = [];
  let value = fn();
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    value = fn();
    samples.push(performance.now() - start);
  }
  return { ms: median(samples), value };
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

interface MixedRow {
  size: number;
  entities: number;
  primitives: number;
  derivedMs: number;
  boundsScanMs: number;
  snapQueryMs: number;
  hitTestMs: number;
  exportSceneMs: number;
  exportItems: number;
  svgMs: number;
  svgKb: number;
}

const measureMixed = (size: number): MixedRow => {
  const { project } = buildMixedDrawing(size);
  const runs = size >= 10000 ? 1 : 3;
  const scene = measure(() => buildCadDisplayScene(project), runs);
  const primitives = scene.value.primitives;
  const bounds = project.bounds!;
  const boundsScanMs = measure(() => {
    let hits = 0;
    for (const entity of project.entities) if (entityIntersectsBounds(project, entity, bounds)) hits += 1;
    return hits;
  }, runs).ms;
  const snapQueryMs = measure(
    () => buildCadSpatialIndex(project).queryNearestSnap({ x: 10, y: 10 }, 5, undefined, { active: false, basePoint: null }, bounds),
    runs,
  ).ms;
  const identity = (x: number, y: number) => ({ x, y });
  const hitTestMs = measure(() => {
    let count = 0;
    for (const primitive of primitives) {
      primitiveBounds(primitive, identity, 1);
      count += 1;
    }
    return count;
  }, runs).ms;
  const { draft, sheetId } = buildDraft(project);
  const exportSceneMs = measure(
    () => buildExportSheetSceneWithResult({ draft, sheetId, project }),
    runs,
  ).ms;
  const exportScene = buildExportSheetSceneWithResult({ draft, sheetId, project }).output;
  const svg = measure(() => serializeExportSceneToSvg(exportScene), runs);
  return {
    size,
    entities: project.entities.length,
    primitives: primitives.length,
    derivedMs: round(scene.ms),
    boundsScanMs: round(boundsScanMs),
    snapQueryMs: round(snapQueryMs),
    hitTestMs: round(hitTestMs),
    exportSceneMs: round(exportSceneMs),
    exportItems: exportScene.items.length,
    svgMs: round(svg.ms),
    svgKb: Math.round(svg.value.length / 1024),
  };
};

describe('Phase 18O annotation performance bench', () => {
  it('scales derived geometry, bounds, hit-test prep and SVG across 100/1k/10k annotations', () => {
    // Warm every derivation path once on a mid-size drawing so the first
    // timed row is not inflated by cold JIT (measurement hygiene only).
    measureMixed(1000);
    const rows = [100, 1000, 10000].map(measureMixed);
    const header = '| entities | primitives | derivedMs | boundsScanMs | snapQueryMs | hitTestMs | exportItems | exportSceneMs | svgMs | svgKb |';
    const divider = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
    const body = rows.map((r) =>
      `| ${r.entities} (${r.size} ann) | ${r.primitives} | ${r.derivedMs} | ${r.boundsScanMs} | ${r.snapQueryMs} | ${r.hitTestMs} | ${r.exportItems} | ${r.exportSceneMs} | ${r.svgMs} | ${r.svgKb} |`,
    );
    console.log(['', '### Mixed annotation scaling (per-entity medians omitted; see report)', header, divider, ...body, ''].join('\n'));

    const perEntity = rows.map((r) =>
      `| ${r.entities} | ${round((r.derivedMs / r.entities) * 1000)} | ${round((r.boundsScanMs / r.entities) * 1000)} | ${round((r.hitTestMs / Math.max(1, r.primitives)) * 1000)} | ${round((r.svgMs / r.entities) * 1000)} |`,
    );
    console.log(['', '### Per-entity µs', '| entities | derived µs/entity | bounds µs/entity | hit-test µs/primitive | svg µs/entity |', '| --- | --- | --- | --- | --- |', ...perEntity, ''].join('\n'));

    const ratios = rows.slice(1).map((row, index) => {
      const prev = rows[index]!;
      return `| ${prev.entities} → ${row.entities} (×${row.entities / prev.entities}) | ${round(row.derivedMs / Math.max(prev.derivedMs, 0.001))}× | ${round(row.boundsScanMs / Math.max(prev.boundsScanMs, 0.001))}× | ${round(row.snapQueryMs / Math.max(prev.snapQueryMs, 0.001))}× | ${round(row.hitTestMs / Math.max(prev.hitTestMs, 0.001))}× | ${round(row.exportSceneMs / Math.max(prev.exportSceneMs, 0.001))}× | ${round(row.svgMs / Math.max(prev.svgMs, 0.001))}× |`;
    });
    console.log(['', '### Scaling ratio per decade', '| decade | derived | bounds | snap-query | hit-test | export-scene | svg |', '| --- | --- | --- | --- | --- | --- | --- |', ...ratios, ''].join('\n'));

    expect(rows.every((row) => row.primitives > 0)).toBe(true);
    expect(rows.at(-1)!.entities).toBeGreaterThan(rows[0]!.entities);
  }, 600_000);

  it('measures associative update: affected label vs full label set (1000 lines + 1000 bearing labels)', () => {
    const cols = 40;
    const bounds: CadBounds = { minX: 0, minY: 0, maxX: cols * SPACING + 30, maxY: cols * SPACING + 30 };
    const project = baseProject([annotationLayer(), geometryLayer()], bounds);
    const lines: CadLineEntity[] = [];
    const labels: CadEntity[] = [];
    for (let i = 0; i < 1000; i += 1) {
      lines.push(sourceLine(i, cols));
      labels.push({
        type: 'bearing-label', id: `bearing-${i}`, layerId: ANNOTATION_LAYER, visible: true, locked: false,
        sourceEntityId: `src-line-${i}`, labelStyleId: 'bearing-default', offset: { x: 0, y: 2 },
      });
    }
    project.entities = [...lines, ...labels];

    const style = project.bearingLabelStyles![0]!;
    const deriveOne = (index: number) => {
      const source = lines[index]!;
      const from = { x: source.fromX, y: source.fromY };
      const to = { x: source.toX, y: source.toY };
      const label = deriveBearingDistanceLabel({
        from, to, content: style.content, separator: '\n', distancePrecision: style.decimalPrecision,
      });
      bearingLabelPlacement(from, to, Math.hypot(style.offset.x, style.offset.y), 'left');
      return label;
    };
    const deriveAll = () => {
      let chars = 0;
      for (let i = 0; i < lines.length; i += 1) chars += deriveOne(i).text.length;
      return chars;
    };

    // Edit exactly ONE source line (same object identity as in project.entities).
    const edited = lines[0]!;
    edited.toX += 5;

    const affectedMs = measure(() => deriveOne(0), 101).ms;
    const allLabelsMs = measure(deriveAll, 5).ms;
    const fullSceneMs = measure(() => buildCadDisplayScene(project), 3).ms;
    const linesOnly: CadProject = { ...project, entities: [...lines] };
    const linesOnlyMs = measure(() => buildCadDisplayScene(linesOnly), 3).ms;
    const labelShareMs = round(fullSceneMs - linesOnlyMs);

    const table = [
      '',
      '### Associative update (one edited source line)',
      '| measurement | ms |',
      '| --- | --- |',
      `| affected label re-derivation (1 of 1000) | ${round(affectedMs)} |`,
      `| all labels derived standalone (1000) | ${round(allLabelsMs)} |`,
      `| full scene rebuild (1000 lines + 1000 labels) | ${round(fullSceneMs)} |`,
      `| scene rebuild, lines only (no labels) | ${round(linesOnlyMs)} |`,
      `| label share of full rebuild | ${labelShareMs} |`,
      `| full rebuild / affected | ${Math.round(fullSceneMs / Math.max(affectedMs, 1e-6))}× |`,
      `| label share / all-labels | ${round(labelShareMs / Math.max(allLabelsMs, 1e-6))}× |`,
      '',
    ];
    console.log(table.join('\n'));

    expect(deriveOne(0).text.length).toBeGreaterThan(0);
    expect(project.entities.length).toBe(2000);
  }, 600_000);
});
