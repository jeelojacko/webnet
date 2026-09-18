import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurfaceStyle, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  SURFACE_STYLE_BOUNDARY_ID,
  SURFACE_STYLE_CONTOURS_ID,
  SURFACE_STYLE_CONTOURS_TRIANGLES_ID,
  SURFACE_STYLE_NONE_ID,
  SURFACE_STYLE_TRIANGLES_ID,
  SURFACE_STYLE_TRIANGLES_POINTS_ID,
  backfillCadSurfaceStyles,
  updateCadSurfaceStyle,
} from '../src/engine/cad/cadSurfaceStyles';
import {
  contourLevelSpecFromStyle,
  cullContourLabels,
  contourPathsToPathD,
  deriveContourLabels,
  resolveContourDisplay,
} from '../src/engine/cad/cadSurfaceContourView';
import {
  computeContourGeometryRevision,
  toContourGeometrySpec,
} from '../src/engine/cad/surfaceContours/contourStyleRevision';
import type { CadSurfaceContourPath, CadSurfaceContourSet } from '../src/engine/cad/surfaceContours/contourTypes';
import { buildSurfaceDisplayLayer } from '../src/engine/cad/cadSurfaceView';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { filterCadDisplaySceneForViewport } from '../src/engine/cad/cadViewportAppearance';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

const pt = (stationId: string, x: number, y: number, z?: number): CadSurveyPointEntity => ({
  id: `pt-${(seq += 1)}`,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z == null ? {} : { z }),
  pointClass: 'unknown',
  source: 'parsed-input',
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'test-project',
  name: 'test',
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

const openPath = (elevation: number, kind: 'minor' | 'major', n: number): CadSurfaceContourPath => ({
  elevation,
  kind,
  closed: false,
  points: Array.from({ length: n }, (_, i) => ({ x: i * 10, y: elevation })),
});

const loopPath = (elevation: number, kind: 'minor' | 'major'): CadSurfaceContourPath => ({
  elevation,
  kind,
  closed: true,
  points: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ],
});

const contourSet = (overrides?: Partial<CadSurfaceContourSet>): CadSurfaceContourSet => ({
  surfaceId: 'surf-1',
  surfaceRevision: 'rev-1',
  styleRevision: 'crev1:abc',
  minorPaths: [openPath(10.5, 'minor', 12)],
  majorPaths: [loopPath(11, 'major')],
  minLevel: 10.5,
  maxLevel: 11,
  stats: {
    levelCount: 2, minorLevelCount: 1, majorLevelCount: 1,
    minorPathCount: 1, majorPathCount: 1, totalLength: 100, segmentCount: 10,
  },
  ...overrides,
});

const contourStyle = (overrides?: Partial<CadSurfaceStyle>): CadSurfaceStyle => ({
  id: 'style-contours',
  name: 'Contours',
  showContours: true,
  minorContourInterval: 1,
  majorContourEvery: 5,
  contourBaseElevation: 0,
  showContourLabels: true,
  labelMajorOnly: true,
  contourLabelSpacing: 40,
  contourLabelPrecision: 1,
  ...overrides,
});

/** Meshed quad project with the given styles + style assignment. */
const meshedProject = (styles: CadSurfaceStyle[], styleId?: string) => {
  const a = pt('A', 0, 0, 10);
  const b = pt('B', 10, 0, 12);
  const c = pt('C', 10, 10, 14);
  const d = pt('D', 0, 10, 11);
  const project = baseProject([a, b, c, d]);
  project.surfaceStyles = styles;
  project.surfaces = [{
    id: 'surf-1',
    name: 'Surface 1',
    definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
    cachedRevision: null,
    ...(styleId ? { styleId } : {}),
  }];
  const surface = project.surfaces[0]!;
  const built = buildCadSurface(project, surface);
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('fixture build failed');
  surface.cachedRevision = built.revision;
  const cache = createCadSurfaceCache('test');
  cache.set(surface.id, built.revision, {
    revision: built.revision,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
  return { project, surface, cache };
};

// ---------------------------------------------------------------------------
// Legacy compat + seeds
// ---------------------------------------------------------------------------

describe('contour style legacy compat and seeds', () => {
  it('legacy sparse styles show no contours (display-time default, no mutation)', () => {
    const legacy: CadSurfaceStyle = { id: 'old', name: 'Old', showTriangles: true };
    const before = { ...legacy };
    expect(resolveContourDisplay(legacy, '#fff')).toBeNull();
    expect(legacy).toEqual(before);
    // Explicit opt-in backfills safe defaults for display + derivation.
    expect(resolveContourDisplay({ ...legacy, showContours: true }, '#fff')).not.toBeNull();
    expect(contourLevelSpecFromStyle({ ...legacy, showContours: true })).toEqual({
      minorInterval: 1, majorEvery: 5, baseElevation: 0,
    });
  });

  it('showContours with an interval backfills safe defaults', () => {
    const resolved = resolveContourDisplay(
      { id: 's', name: 'S', showContours: true, minorContourInterval: 0.5 },
      '#123456',
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.minorInterval).toBe(0.5);
    expect(resolved!.majorEvery).toBe(5);
    expect(resolved!.baseElevation).toBe(0);
    expect(resolved!.majorWidth).toBeGreaterThan(1);
    expect(resolved!.minorStroke).toBe('#123456');
  });

  it('preserves the four legacy seeds and adds two contour seeds', () => {
    const seeds = backfillCadSurfaceStyles(undefined);
    expect(seeds.map((entry) => entry.id)).toEqual([
      SURFACE_STYLE_TRIANGLES_ID,
      SURFACE_STYLE_TRIANGLES_POINTS_ID,
      SURFACE_STYLE_BOUNDARY_ID,
      SURFACE_STYLE_NONE_ID,
      SURFACE_STYLE_CONTOURS_ID,
      SURFACE_STYLE_CONTOURS_TRIANGLES_ID,
    ]);
    // Existing appearances untouched: no contour fields, same flags.
    expect(seeds[0]).toEqual({ id: SURFACE_STYLE_TRIANGLES_ID, name: 'Triangles', showTriangles: true });
    expect(seeds[1]).toEqual({
      id: SURFACE_STYLE_TRIANGLES_POINTS_ID, name: 'Triangles+Points', showTriangles: true, showPoints: true,
    });
    expect(seeds[2]).toEqual({ id: SURFACE_STYLE_BOUNDARY_ID, name: 'Boundary', showBoundary: true });
    expect(seeds[3]).toEqual({ id: SURFACE_STYLE_NONE_ID, name: 'No Display' });
    expect(seeds[4]).toMatchObject({
      showContours: true, minorContourInterval: 1, majorContourEvery: 5,
      contourBaseElevation: 0, showContourLabels: true, labelMajorOnly: true,
    });
    expect(seeds[5]).toMatchObject({ showContours: true, showTriangles: true, minorContourInterval: 1 });
  });

  it('rejects invalid contour patches without touching stored styles', () => {
    const seeds = backfillCadSurfaceStyles(undefined);
    expect(updateCadSurfaceStyle(seeds, SURFACE_STYLE_CONTOURS_ID, { minorContourInterval: 0 })).toBeNull();
    expect(updateCadSurfaceStyle(seeds, SURFACE_STYLE_CONTOURS_ID, { majorContourEvery: 0 })).toBeNull();
    expect(updateCadSurfaceStyle(seeds, SURFACE_STYLE_CONTOURS_ID, { contourLabelPrecision: 7 })).toBeNull();
    expect(updateCadSurfaceStyle(seeds, SURFACE_STYLE_CONTOURS_ID, { contourLabelSpacing: -1 })).toBeNull();
    const ok = updateCadSurfaceStyle(seeds, SURFACE_STYLE_CONTOURS_ID, { minorContourInterval: 2 });
    expect(ok?.find((entry) => entry.id === SURFACE_STYLE_CONTOURS_ID)?.minorContourInterval).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Appearance vs geometry revision
// ---------------------------------------------------------------------------

describe('contour appearance vs geometry revision', () => {
  it('appearance-only change reuses geometry; interval change re-derives', () => {
    const style = contourStyle();
    const before = computeContourGeometryRevision(toContourGeometrySpec(contourLevelSpecFromStyle(style)!));
    const seeds = updateCadSurfaceStyle([style], style.id, { minorContour: { color: '#ff0000' } });
    const afterAppearance = computeContourGeometryRevision(
      toContourGeometrySpec(contourLevelSpecFromStyle(seeds!.find((entry) => entry.id === style.id)!)!),
    );
    expect(afterAppearance).toBe(before);
    const moved = updateCadSurfaceStyle([style], style.id, { minorContourInterval: 2 });
    const afterGeometry = computeContourGeometryRevision(
      toContourGeometrySpec(contourLevelSpecFromStyle(moved!.find((entry) => entry.id === style.id)!)!),
    );
    expect(afterGeometry).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Display layer: aggregated paths, OFF hides without recompute
// ---------------------------------------------------------------------------

describe('contour display layer', () => {
  it('aggregates one path string per kind and derives labels', () => {
    const style = contourStyle();
    const { project, surface, cache } = meshedProject([style], style.id);
    const layer = buildSurfaceDisplayLayer(surface, project, cache, undefined, { set: contourSet() });
    expect(layer?.showContours).toBe(true);
    // One aggregated string per kind (M count << segment count, never per-segment nodes).
    const minorMoves = (layer!.minorContoursD!.match(/M/g) ?? []).length;
    expect(minorMoves).toBe(1);
    expect(layer!.majorContoursD!.endsWith('Z')).toBe(true);
    // Default major-only labels, upright, unit-free elevation text.
    expect(layer!.contourLabels!.length).toBeGreaterThan(0);
    expect(layer!.contourLabels!.every((label) => label.kind === 'major')).toBe(true);
    expect(layer!.contourLabels!.every((label) => label.rotationDeg > -90 && label.rotationDeg <= 90)).toBe(true);
    expect(layer!.contourLabels![0]!.text).toBe((11).toFixed(1));
    expect(layer!.contourLabelsTruncated).toBe(false);
  });

  it('legacy style layer carries no contours', () => {
    const { project, surface, cache } = meshedProject(
      [{ id: 't', name: 'T', showTriangles: true }], 't',
    );
    const layer = buildSurfaceDisplayLayer(surface, project, cache, undefined, { set: contourSet() });
    expect(layer?.showContours).toBeFalsy();
    expect(layer?.minorContoursD ?? '').toBe('');
    expect(layer?.contourLabels ?? []).toEqual([]);
  });

  it('layer OFF hides contours with the layer (no recompute)', () => {
    const style = contourStyle();
    const { project, cache } = meshedProject([style], style.id);
    const scene = buildCadDisplayScene(project, {
      surfaceCache: cache,
      surfaceContours: () => ({ set: contourSet() }),
    });
    expect(scene.surfaceLayers?.length).toBe(1);
    expect(scene.surfaceLayers![0]!.showContours).toBe(true);
    const hidden = filterCadDisplaySceneForViewport(
      {
        ...project,
        layers: [{ id: 'general', name: 'General', color: '#fff', visible: false, locked: false, role: 'surfaces' }],
      },
      scene,
    );
    expect(hidden.surfaceLayers ?? []).toEqual([]);
  });

  it('export scenes still exclude surfaces', () => {
    const style = contourStyle();
    const { project } = meshedProject([style], style.id);
    // No session cache = definition-only (DXF/SVG/PDF path).
    const scene = buildCadDisplayScene(project);
    expect(scene.surfaceLayers ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Labels: determinism, upright, cap, culling
// ---------------------------------------------------------------------------

describe('contour labels', () => {
  it('is deterministic and keeps text upright without unit suffix', () => {
    const set = contourSet();
    const options = { spacing: 40, precision: 2, majorOnly: false };
    const first = deriveContourLabels(set, options);
    const second = deriveContourLabels(set, options);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    for (const label of first) {
      expect(label.rotationDeg).toBeGreaterThan(-90);
      expect(label.rotationDeg).toBeLessThanOrEqual(90);
      expect(label.text).toBe(label.elevation.toFixed(2));
      expect(label.text).not.toMatch(/m$/);
    }
  });

  it('caps visible labels and culls to the viewport (geometry complete)', () => {
    const many = contourSet({
      majorPaths: Array.from({ length: 60 }, (_, i) => loopPath(100 + i, 'major')),
    });
    const all = deriveContourLabels(many, { spacing: 1, precision: 0, majorOnly: true });
    expect(all.length).toBeGreaterThan(200);
    const capped = cullContourLabels(all, null);
    expect(capped.visible.length).toBe(200);
    expect(capped.truncated).toBe(true);
    // Geometry untouched by the display cap.
    expect(all.length).toBeGreaterThan(capped.visible.length);
    const culled = cullContourLabels(all, { minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(culled.visible.length).toBeLessThan(all.length);
  });

  it('aggregates path data as a single string', () => {
    const d = contourPathsToPathD([openPath(5, 'minor', 4), loopPath(6, 'major')]);
    expect(typeof d).toBe('string');
    expect(d.match(/M/g)!.length).toBe(2);
    expect(d.endsWith('Z')).toBe(true);
  });
});
