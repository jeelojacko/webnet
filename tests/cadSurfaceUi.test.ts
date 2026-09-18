import { describe, expect, it } from 'vitest';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import {
  buildSurfaceDisplayLayers,
  classifyBreaklineChainZ,
  findSurfaceBrokenRefs,
  queryMeshElevation,
  resolveSurfaceDisplayStatus,
  surfaceBoundaryPathD,
  surfaceTrianglesPathD,
  validateBoundaryEntity,
} from '../src/engine/cad/cadSurfaceView';
import {
  buildCadSurfaceSnapshot,
  querySurfaceElevationText,
} from '../src/cad-app/shell/cadSurfaceSnapshot';

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

/** Four corner points + surface over them; mesh built through the engine. */
const quadFixture = () => {
  const a = pt('A', 0, 0, 10);
  const b = pt('B', 10, 0, 12);
  const c = pt('C', 10, 10, 14);
  const d = pt('D', 0, 10, 11);
  const project = baseProject([a, b, c, d]);
  project.surfaces = [{
    id: 'surf-1',
    name: 'Surface 1',
    definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } },
    cachedRevision: null,
  }];
  const surface = project.surfaces[0]!;
  const built = buildCadSurface(project, surface);
  expect(built.outcome).toBe('ok');
  const cache = createCadSurfaceCache('test');
  cache.set(surface.id, built.revision, {
    revision: built.revision,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
  });
  return { project, surface, cache, revision: built.revision };
};

// ---------------------------------------------------------------------------
// Display status + stale policy
// ---------------------------------------------------------------------------

describe('surface display status', () => {
  it('reads CURRENT from a fresh session mesh, UNBUILT with no mesh', () => {
    const { project, surface, cache, revision } = quadFixture();
    expect(cache.get(surface.id, revision)).toBeDefined();
    const current = resolveSurfaceDisplayStatus(project, surface, true);
    expect(current.status).toBe('CURRENT');
    expect(current.stale).toBe(false);
    const unbuilt = resolveSurfaceDisplayStatus(project, surface, false);
    expect(unbuilt.status).toBe('UNBUILT');
  });

  it('keeps the old mesh visible stale after a definition edit', () => {
    const { project, surface, cache, revision } = quadFixture();
    const extra = pt('E', 5, 5, 13);
    const edited: CadProject = {
      ...project,
      entities: [...project.entities, extra],
      surfaces: [{
        ...surface,
        definition: {
          pointSource: {
            kind: 'points',
            pointEntityIds: [
              ...(surface.definition.pointSource as { pointEntityIds: string[] }).pointEntityIds,
              extra.id,
            ],
          },
        },
      }],
    };
    const editedSurface = edited.surfaces![0]!;
    // Content revision moved on; no fresh mesh for it.
    expect(computeCadSurfaceSourceRevision(edited, editedSurface)).not.toBe(revision);
    // Content revision moved on; the old session mesh is stale, not fresh.
    const stale = resolveSurfaceDisplayStatus(edited, editedSurface, false, true);
    expect(stale.status).toBe('NEEDS_REBUILD');
    expect(stale.stale).toBe(true);
    // The old mesh still resolves through the revision index.
    const layers = buildSurfaceDisplayLayers(edited, cache, new Map([[surface.id, [revision]]]));
    expect(layers).toHaveLength(1);
    expect(layers[0]!.stale).toBe(true);
    expect(layers[0]!.trianglesD.length).toBeGreaterThan(0);
  });

  it('flags BROKEN_REFERENCE with ids when a source point disappears', () => {
    const { project, surface } = quadFixture();
    const victim = (surface.definition.pointSource as { pointEntityIds: string[] }).pointEntityIds[0]!;
    const pruned: CadProject = {
      ...project,
      entities: project.entities.filter((entity) => entity.id !== victim),
    };
    const health = findSurfaceBrokenRefs(pruned, surface);
    expect(health.brokenIds).toContain(`point:${victim}`);
    expect(resolveSurfaceDisplayStatus(pruned, surface, false).status).toBe('BROKEN_REFERENCE');
  });
});

// ---------------------------------------------------------------------------
// Derived paths (one node per component, shared edges deduped)
// ---------------------------------------------------------------------------

describe('surface derived paths', () => {
  it('buckets unique edges once and boundary edges exactly once', () => {
    const { cache, surface, revision } = quadFixture();
    const mesh = cache.get(surface.id, revision)!;
    // Quad = 2 triangles: 5 unique edges (4 outer + 1 diagonal), 4 boundary.
    expect(surfaceTrianglesPathD(mesh).split('M').filter(Boolean)).toHaveLength(5);
    expect(surfaceBoundaryPathD(mesh).split('M').filter(Boolean)).toHaveLength(4);
  });

  it('interpolates elevation inside the mesh and null outside', () => {
    const { cache, surface, revision } = quadFixture();
    const mesh = cache.get(surface.id, revision)!;
    const inside = queryMeshElevation(mesh, 5, 5);
    expect(inside).not.toBeNull();
    expect(inside!).toBeGreaterThanOrEqual(10);
    expect(inside!).toBeLessThanOrEqual(14);
    expect(queryMeshElevation(mesh, 100, 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshot + inquiry text
// ---------------------------------------------------------------------------

describe('surface snapshot', () => {
  it('summarizes definition counts, stats, and inquiry answers', () => {
    const { project, surface, cache } = quadFixture();
    const snapshot = buildCadSurfaceSnapshot(project, cache, surface.id, {});
    expect(snapshot.surfaces).toHaveLength(1);
    const row = snapshot.surfaces[0]!;
    expect(row.status).toBe('CURRENT');
    expect(row.statusText).toBe('Current');
    expect(row.definition.pointCount).toBe(4);
    expect(row.stats?.triangles).toBe(2);
    expect(row.stats?.vertices).toBe(4);
    expect(querySurfaceElevationText(project, cache, surface.id, 5, 5)).toContain('elevation');
    expect(querySurfaceElevationText(project, cache, surface.id, 100, 100))
      .toContain('No surface elevation at point');
  });

  it('asks for a rebuild when the mesh is absent', () => {
    const { project, surface } = quadFixture();
    const text = querySurfaceElevationText(project, createCadSurfaceCache('empty'), surface.id, 5, 5)!;
    expect(text).toContain('no current mesh');
  });
});

// ---------------------------------------------------------------------------
// Breakline gate + boundary validation
// ---------------------------------------------------------------------------

describe('breakline and boundary gates', () => {
  it('blocks unresolvable Z and never invents zero', () => {
    const a = pt('A', 0, 0, 1);
    const lookup = (id: string): number | null => (id === a.id && a.z != null ? a.z : null);
    const blocked = classifyBreaklineChainZ({ vertices: [{ x: 0, y: 0 }], metadata: {} }, lookup);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('UNRESOLVABLE_Z');
    const ok = classifyBreaklineChainZ(
      { vertices: [{ x: 0, y: 0 }], metadata: { sourcePointIds: [a.id] } },
      lookup,
    );
    expect(ok.ok).toBe(true);
    expect(ok.minZ).toBe(1);
  });

  it('requires F2F explicitness and closed rings', () => {
    const a = pt('A', 0, 0, 1);
    const lookup = (): number | null => a.z ?? null;
    const f2f = classifyBreaklineChainZ(
      {
        vertices: [{ x: 0, y: 0 }],
        metadata: { provenance: { generatedBy: 'FIELD_TO_FINISH' }, sourcePointIds: [a.id] },
      },
      lookup,
    );
    expect(f2f.ok).toBe(false);
    expect(f2f.reason).toBe('F2F_EXPLICIT_ONLY');
    expect(validateBoundaryEntity({ type: 'line', vertices: [] }).ok).toBe(false);
    expect(validateBoundaryEntity({
      type: 'polyline',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    }).reason).toBe('TOO_FEW_VERTICES');
    expect(validateBoundaryEntity({
      type: 'polyline',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    }).reason).toBe('NOT_CLOSED');
    expect(validateBoundaryEntity({
      type: 'polyline',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }],
    }).ok).toBe(true);
  });
});
