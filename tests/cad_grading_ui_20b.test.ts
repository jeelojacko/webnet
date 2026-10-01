/**
 * Phase 20B UI slice — pure snapshot/display/report/export/authoring pins.
 *
 * Covers the shell-owned grading layer: criterion normalization + signed
 * ratio display, ghost side preview, snapshot status/metrics derivation,
 * inquiry report + CSV, one display pass (stale/failed/curve states), and
 * the export-scene dispositions (CURRENT-only gate, curve warning, DXF
 * 3D/3DFACE, LandXML NOT_APPLICABLE).
 */
import { describe, expect, it } from 'vitest';
import type { CadProject, CadFeatureLineEntity, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import type { CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import type {
  CadGrading,
  CadGradingResult,
  GradingAccuracy,
} from '../src/engine/cad/grading/gradingTypes';
import {
  buildCadGradingSnapshot,
  type CadGradingResultCache,
} from '../src/cad-app/shell/cadGradingSnapshot';
import { buildGradingTopologyCertificate } from '../src/engine/cad/grading/gradingTopologyCertificate';
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
} from '../src/cad-app/shell/cadGradingShell';
import { buildGradingCsv, buildGradingInquiryReport } from '../src/cad-app/shell/cadGradingReport';
import { buildGradingDisplayPass, gradingGhostArrow, buildGradingSceneLayers } from '../src/cad-app/shell/cadGradingDisplay';
import { filterCadDisplaySceneForViewport } from '../src/engine/cad/cadViewportAppearance';
import {
  buildGradingModelItems,
  buildGradingSheetItems,
  gradingLandXmlWarnings,
  isGradingLayerCurrent,
} from '../src/engine/cad/cadGradingExportScene';

let seq = 0;

const pt = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'grading-ui-project',
  name: 'grading-ui',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

/** Flat 10x10 surface (z=0) + a 10 m feature line + one fixed grading. */
const fixture = (): {
  project: CadProject;
  grading: CadGrading;
  surfaceCache: CadSurfaceCache;
} => {
  seq = 0;
  const a = pt('A', 0, 0, 0);
  const b = pt('B', 10, 0, 0);
  const c = pt('C', 10, 10, 0);
  const d = pt('D', 0, 10, 0);
  const fl: CadFeatureLineEntity = {
    id: `fl-${(seq += 1)}`,
    type: 'feature-line',
    layerId: 'feature-lines',
    visible: true,
    locked: false,
    name: 'Ridge',
    vertices: [
      { id: 'vA', x: 0, y: 5, z: 0 },
      { id: 'vB', x: 10, y: 5, z: 0 },
    ],
    closed: false,
  };
  const project = baseProject([a, b, c, d, fl]);
  project.surfaces = [
    {
      id: 'srf-1',
      name: 'Pond',
      definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
      cachedRevision: null,
    },
  ];
  const grading: CadGrading = {
    id: 'g-1',
    name: 'Ridge - Right',
    sourceFeatureLineId: fl.id,
    sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
    targetSurfaceId: 'srf-1',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
  };
  project.gradings = [grading];
  const surfaceCache = createCadSurfaceCache('20b-ui');
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') throw new Error('fixture mesh failed');
    surfaceCache.set(surface.id, built.revision, {
      revision: built.revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
  return { project, grading, surfaceCache };
};

const mkResult = (
  gradingId: string,
  revision: string,
  accuracy: GradingAccuracy = 'EXACT',
): CadGradingResult => ({
  gradingId,
  revision,
  accuracy,
  regions: [{ classification: 'FILL', stationSpan: [0, 10] }],
  daylightPoints: [0, 20, 0, 10, 20, 0],
  gradingMesh: {
    points: [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0],
    triangles: [0, 1, 2, 0, 2, 3],
  },
  sourceLength: 10,
  gradingPlanArea: 200,
  grading3dArea: 223.6,
  minProjectionDistance: 20,
  maxProjectionDistance: 20,
  meanProjectionDistance: 20,
  cutSourceLength: 0,
  fillSourceLength: 10,
  tiedSourceLength: 0,
  candidateTriangleCount: 2,
  intersectionSegmentCount: 1,
  multipleSolutionCount: 0,
  diagnostics: [],
  topologyCertificate: buildGradingTopologyCertificate({
    scope: 'standalone',
    points: [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0],
    triangles: [0, 1, 2, 0, 2, 3],
  }) ?? undefined,
});

const cacheOf = (results: readonly CadGradingResult[]): CadGradingResultCache => ({
  get: (id, revision) => results.find((r) => r.gradingId === id && r.revision === revision),
  retained: (id) => results.filter((r) => r.gradingId === id),
});

describe('grading criterion authoring', () => {
  it('parses explicit nH:1V and rejects unlabeled or zero rise', () => {
    expect(parseHorizontalVerticalRatio('2H:1V')).toBeCloseTo(0.5, 9);
    expect(parseHorizontalVerticalRatio('2:1')).toBeCloseTo(0.5, 9);
    expect(parseHorizontalVerticalRatio('0H:1V')).toBeNull();
    expect(parseHorizontalVerticalRatio('abc')).toBeNull();
  });

  it('resolves signed ratios and formats the percent', () => {
    expect(resolveSignedGradeRatio('h-v', 0.5, 'up')).toBeCloseTo(0.5, 9);
    expect(resolveSignedGradeRatio('h-v', 0.5, 'down')).toBeCloseTo(-0.5, 9);
    expect(resolveSignedGradeRatio('percent', 2, 'down')).toBeCloseTo(-0.02, 9);
    expect(resolveSignedGradeRatio('percent', 0, 'up')).toBe(0);
    expect(formatSignedGradePercent(0.5)).toBe('+50.000%');
    expect(formatSignedGradePercent(-1 / 3)).toBe('-33.333%');
    expect(formatSignedGradePercent(0)).toBe('0.000%');
  });

  it('ghost preview points to the requested side (normal direction)', () => {
    const source = { startX: 0, startY: 0, endX: 10, endY: 0, startZ: 0, endZ: 0, length: 10, reoriented: false, isArc: false };
    const left = gradingGhostArrow(source, 'left', 5);
    const right = gradingGhostArrow(source, 'right', 5);
    expect(left.to.y).toBeGreaterThan(0);
    expect(right.to.y).toBeLessThan(0);
    expect(left.to.x).toBeCloseTo(5, 9);
  });
});

describe('grading snapshot', () => {
  it('derives UNBUILT then CURRENT with metrics once a result is cached', () => {
    const { project, grading, surfaceCache } = fixture();
    const empty = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
    expect(empty.gradings[0]?.status).toBe('UNBUILT');
    expect(empty.gradings[0]?.revision).toMatch(/^grev1:/);
    const seeded = mkResult(grading.id, empty.gradings[0]!.revision);
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([seeded]), grading.id);
    expect(snap.gradings[0]?.status).toBe('CURRENT');
    expect(snap.gradings[0]?.metrics?.triangleCount).toBe(2);
    expect(snap.gradings[0]?.exportable).toBe(true);
  });

  it('marks a retained result at an old revision NEEDS_RECALC and stale', () => {
    const { project, grading, surfaceCache } = fixture();
    const old = mkResult(grading.id, 'grev1:stale');
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([old]), grading.id);
    expect(snap.gradings[0]?.status).toBe('NEEDS_RECALC');
    expect(snap.gradings[0]?.stale).toBe(true);
    expect(snap.gradings[0]?.metrics?.gradingPlanArea).toBeCloseTo(200, 6);
  });

  it('reports BROKEN_REFERENCE when the course vertex pair is no longer adjacent', () => {
    const { project, surfaceCache } = fixture();
    const fl = project.entities.find((entity) => entity.type === 'feature-line') as CadFeatureLineEntity;
    fl.vertices = [
      { id: 'vA', x: 0, y: 5, z: 0 },
      { id: 'vMid', x: 5, y: 5, z: 0 },
      { id: 'vB', x: 10, y: 5, z: 0 },
    ];
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), 'g-1');
    expect(snap.gradings[0]?.status).toBe('BROKEN_REFERENCE');
    expect(snap.gradings[0]?.calculable).toBe(false);
  });

  it('reports UNBUILT (before any result) when the target has no CURRENT mesh', () => {
    const { project, grading } = fixture();
    const snap = buildCadGradingSnapshot(project, null, cacheOf([]), grading.id);
    expect(snap.gradings[0]?.status).toBe('UNBUILT');
    expect(snap.gradings[0]?.calculable).toBe(false);
  });
});

describe('grading inquiry + CSV', () => {
  it('builds a CURRENT report and a station CSV', () => {
    const { project, grading, surfaceCache } = fixture();
    const empty = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
    const result = mkResult(grading.id, empty.gradings[0]!.revision);
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([result]), grading.id);
    const row = snap.gradings[0]!;
    const report = buildGradingInquiryReport(row.definition, row.source, row, row.currentResult);
    expect(report).toContain('Grading Inquiry');
    expect(report).toContain('Multiple-root');
    const csv = buildGradingCsv(row.definition, row.source!, result);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Station,Source E,Source N,Source Z,Side,Classification,Tie Distance');
    expect(lines.length).toBe(3);
  });

  it('answers honestly when not CURRENT', () => {
    const { project, grading, surfaceCache } = fixture();
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
    const row = snap.gradings[0]!;
    const report = buildGradingInquiryReport(row.definition, row.source, row, null);
    expect(report).toContain('No CURRENT result');
  });
});

describe('grading display pass', () => {
  it('emits geometry only for CURRENT and flags curve approximation', () => {
    const { project, grading, surfaceCache } = fixture();
    const empty = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
    const result = mkResult(grading.id, empty.gradings[0]!.revision, 'CURVE_APPROXIMATED');
    const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([result]), grading.id);
    const row = snap.gradings[0]!;
    const pass = buildGradingDisplayPass(row, row.currentResult, row.source);
    expect(pass.current).toBe(true);
    expect(pass.daylight.length).toBe(2);
    expect(pass.triangles.length).toBe(2);
    expect(pass.warnings.some((w) => w.includes('Curve approximated'))).toBe(true);
    const stale = buildGradingDisplayPass({ ...row, status: 'NEEDS_RECALC', stale: true, currentResult: null }, null, row.source);
    expect(stale.current).toBe(false);
    expect(stale.daylight.length).toBe(0);
    expect(stale.warnings.length).toBe(1);
  });
});

describe('grading live scene layers', () => {
    const currentSnapshotOf = (accuracy: GradingAccuracy = 'EXACT') => {
      const { project, grading, surfaceCache } = fixture();
      const empty = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
      const result = mkResult(grading.id, empty.gradings[0]!.revision, accuracy);
      const snap = buildCadGradingSnapshot(project, surfaceCache, cacheOf([result]), grading.id);
      expect(snap.gradings[0]?.status).toBe('CURRENT');
      return { project, snap };
    };

    it('contributes daylight + fill primitives to the live scene when CURRENT', () => {
      const { snap } = currentSnapshotOf();
      const layers = buildGradingSceneLayers(snap);
      expect(layers).toHaveLength(1);
      expect(layers[0]!.gradingId).toBe('g-1');
      expect(layers[0]!.layerId).toBe('grading');
      expect(layers[0]!.daylightD).toBe('M0 20L10 20');
      expect(layers[0]!.trianglesD).toContain('Z');
      expect(layers[0]!.curveApproximated).toBe(false);
    });

    it('emits no layer for stale or failed rows (never renders as current)', () => {
      const { project, grading, surfaceCache } = fixture();
      const old = mkResult(grading.id, 'grev1:stale');
      const stale = buildCadGradingSnapshot(project, surfaceCache, cacheOf([old]), grading.id);
      expect(stale.gradings[0]?.status).toBe('NEEDS_RECALC');
      expect(buildGradingSceneLayers(stale)).toHaveLength(0);
      const unbuilt = buildCadGradingSnapshot(project, surfaceCache, cacheOf([]), grading.id);
      expect(buildGradingSceneLayers(unbuilt)).toHaveLength(0);
    });

    it('flags curve-approximated results for the canvas badge', () => {
      const { snap } = currentSnapshotOf('CURVE_APPROXIMATED');
      const layers = buildGradingSceneLayers(snap);
      expect(layers).toHaveLength(1);
      expect(layers[0]!.curveApproximated).toBe(true);
      expect(layers[0]!.badgeAnchor).toEqual({ x: 0, y: 20 });
    });

    it('drops the grading layer when its layer is OFF, restores when ON', () => {
      const { project, snap } = currentSnapshotOf();
      const layers = buildGradingSceneLayers(snap);
      expect(layers).toHaveLength(1);
      const off: CadProject = {
        ...project,
        layers: [{ id: 'grading', name: 'Grading', color: '#ffffff', visible: false, locked: false, role: 'surfaces' }],
      };
      expect(
        filterCadDisplaySceneForViewport(off, { bounds: null, primitives: [], gradingLayers: layers })
          .gradingLayers,
      ).toHaveLength(0);
      expect(
        filterCadDisplaySceneForViewport(project, { bounds: null, primitives: [], gradingLayers: layers })
          .gradingLayers,
      ).toHaveLength(1);
    });
});

describe('grading export dispositions', () => {
  const currentInput = (
    grading: { id: string; name: string; layerId?: string },
    result: CadGradingResult,
  ) => ({ layers: [{ grading, status: 'CURRENT', result }] });

  it('emits sheet fill + daylight for CURRENT only, warns when withheld', () => {
    const result = mkResult('g-1', 'grev1:x');
    const toPaper = (x: number, y: number) => ({ xMm: x, yMm: y });
    const ok = buildGradingSheetItems(currentInput({ id: 'g-1', name: 'G' }, result), toPaper, 'clip');
    expect(ok.items.filter((i) => i.kind === 'polyline').length).toBe(3);
    expect(ok.warnings).toHaveLength(0);
    const stale = buildGradingSheetItems(
      { layers: [{ grading: { id: 'g-1', name: 'G' }, status: 'NEEDS_RECALC', result }] },
      toPaper,
    );
    expect(stale.items).toHaveLength(0);
    expect(stale.warnings.some((w) => w.message.includes('CURRENT-only'))).toBe(true);
    expect(isGradingLayerCurrent({ grading: { id: 'g-1', name: 'G' }, status: 'CURRENT', result })).toBe(true);
  });

  it('emits DXF 3D daylight polylines + mesh 3DFACE and a curve warning', () => {
    const result = mkResult('g-1', 'grev1:x', 'CURVE_APPROXIMATED');
    const model = buildGradingModelItems(currentInput({ id: 'g-1', name: 'G' }, result));
    expect(model.polylines3d).toHaveLength(1);
    expect(model.polylines3d[0]!.vertices[0]).toEqual({ x: 0, y: 20, z: 0 });
    expect(model.faces3d).toHaveLength(2);
    expect(model.warnings.some((w) => w.message.includes('curve-approximated'))).toBe(true);
  });

  it('never writes grading geometry to LandXML (NOT_APPLICABLE per definition)', () => {
    const result = mkResult('g-1', 'grev1:x');
    const warnings = gradingLandXmlWarnings(currentInput({ id: 'g-1', name: 'G' }, result));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('NOT_APPLICABLE');
  });
});
