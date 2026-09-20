/**
 * Phase 18S downstream integration — the TIN edit stack must flow through the
 * revision-keyed consumers, not just the applicator.
 *
 * Pins:
 * - contour: edit retires the current set (stale-tin), rebuilt contours are
 *   derived from the edited mesh, and a deleted interior edge stops contours
 *   inside the removed triangles (never bridged).
 * - profile: SOURCE_NOT_CURRENT -> rebuild consumes the edited mesh; the
 *   deleted interior hole yields a profile gap (never bridged).
 * - section: same lifecycle; the hole yields a section gap.
 * - volume: source TIN edit -> SOURCE_NOT_CURRENT; a stale result ->
 *   NEEDS_RECALC; the exact overlay runs on the edited meshes and the overlap
 *   follows the reduced domain (analytic delete-boundary oracle).
 *
 * Pure engine reads; no UI, no worker, no persistence.
 */
import { describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { deriveSurfaceContourStatus } from '../src/engine/cad/surfaceContourStatus';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { deriveVolumeSurfaceStatus } from '../src/engine/cad/cadVolumeSurfaces';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import type {
  CadAlignmentElement,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
  CadVolumeSurface,
  CadVolumeResult,
} from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const plane = (x: number, y: number): number => 0.013 * x + 0.021 * y + 2.5;

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt:${id}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

/** 3x3 plane grid (spacing 10) carrying one editable surface. */
const gridProject = (surfaceId = 'surf-grid'): { project: CadProject; surface: CadSurface } => {
  const base = createBlankCadProject({ name: 'T18S-downstream', units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = col * 10;
      const y = row * 10;
      entities.push(point(`${row}${col}`, x, y, plane(x, y)));
    }
  }
  const surface: CadSurface = {
    id: surfaceId,
    name: 'Plane grid',
    definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((e) => e.id) } },
  };
  return { project: { ...base, entities, surfaces: [surface] }, surface };
};

const buildOf = (project: CadProject, surface: CadSurface) => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome}`);
  return build;
};

const edgeMap = (build: ReturnType<typeof buildCadSurface>): Map<string, number[]> => {
  const map = new Map<string, number[]>();
  build.triangles.forEach((tri, index) => {
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = `${Math.min(u, v)}>${Math.max(u, v)}`;
      map.set(key, [...(map.get(key) ?? []), index]);
    }
  });
  return map;
};

const edgesWithAdjacency = (build: ReturnType<typeof buildCadSurface>, count: number): Array<[number, number]> =>
  [...edgeMap(build)]
    .filter(([, list]) => list.length === count)
    .map(([key]) => key.split('>').map(Number) as [number, number]);

/** Interior edge whose midpoint is closest to the mesh centroid. */
const centralInteriorEdge = (build: ReturnType<typeof buildCadSurface>): [number, number] => {
  const cx = build.points.reduce((sum, p) => sum + p.x, 0) / build.points.length;
  const cy = build.points.reduce((sum, p) => sum + p.y, 0) / build.points.length;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const [a, b] of edgesWithAdjacency(build, 2)) {
    const d = Math.hypot((build.points[a].x + build.points[b].x) / 2 - cx, (build.points[a].y + build.points[b].y) / 2 - cy);
    if (d < bestD) {
      bestD = d;
      best = [a, b];
    }
  }
  if (!best) throw new Error('fixture: no interior edge');
  return best;
};

const editOf = (kind: 'swap-edge' | 'delete-line', id: string, aId: string, bId: string): CadSurfaceEdit =>
  kind === 'swap-edge'
    ? { id, kind, edge: { a: { key: `source:${aId}` }, b: { key: `source:${bId}` } } }
    : { id, kind, edge: { a: { key: `source:${aId}` }, b: { key: `source:${bId}` } } };

/** Delete one interior edge: two adjacent triangles vanish into a quad hole. */
const withInteriorDelete = (surface: CadSurface, build: ReturnType<typeof buildCadSurface>): {
  project: CadProject;
  surface: CadSurface;
  removed: Array<[number, number, number]>;
} => {
  const [a, b] = centralInteriorEdge(build);
  const adj = edgeMap(build).get(`${Math.min(a, b)}>${Math.max(a, b)}`) ?? [];
  const removed = adj.map((index) => build.triangles[index] as [number, number, number]);
  const edited: CadSurface = {
    ...surface,
    definition: { ...surface.definition, edits: [editOf('delete-line', 'del-hole', build.points[a].entityId, build.points[b].entityId)] },
  };
  return { project: { ...gridProject().project, surfaces: [edited] }, surface: edited, removed };
};

const profileMesh = (build: ReturnType<typeof buildCadSurface>) => ({
  points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
  grid: build.grid,
});

const lineElement = (from: { x: number; y: number }, to: { x: number; y: number }): CadAlignmentElement =>
  ({ kind: 'line', start: from, end: to });

const inTriangle = (
  p: { x: number; y: number },
  tri: [number, number, number],
  build: ReturnType<typeof buildCadSurface>,
): boolean => {
  const side = (i: number, j: number, k: number): boolean => {
    const at = orient2d(build.points[i].x, build.points[i].y, build.points[j].x, build.points[j].y, p.x, p.y);
    const ref = orient2d(build.points[i].x, build.points[i].y, build.points[j].x, build.points[j].y, build.points[k].x, build.points[k].y);
    return at === 0 || (at > 0) === (ref > 0);
  };
  const [a, b, c] = tri;
  return side(a, b, c) && side(b, c, a) && side(c, a, b);
};

// ---------------------------------------------------------------------------
// Contours
// ---------------------------------------------------------------------------

describe('18S downstream contour lifecycle', () => {
  it('edit retires the current set; rebuilt contours follow the edited mesh and stop at the hole', () => {
    const { project, surface } = gridProject();
    const base = buildOf(project, surface);
    const edited = withInteriorDelete(surface, base);
    const editedBuild = buildOf(edited.project, edited.surface);
    expect(editedBuild.triangles.length).toBe(base.triangles.length - 2);

    // An edit invalidates the parent TIN revision, so no set can derive CURRENT.
    const stale = deriveSurfaceContourStatus({ tinCurrent: false, building: false, cacheHit: false, hasStale: true });
    expect(stale.status).not.toBe('CURRENT');
    expect(stale.stale).toBe(true);

    const mid = edited.removed[0];
    const level = plane(
      (base.points[mid[0]].x + base.points[mid[1]].x + base.points[mid[2]].x) / 3,
      (base.points[mid[0]].y + base.points[mid[1]].y + base.points[mid[2]].y) / 3,
    );
    const args = (build: ReturnType<typeof buildCadSurface>) => ({
      surfaceId: surface.id,
      surfaceRevision: 'srev1:x',
      styleRevision: 'crev1:x',
      points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
      levels: [{ elevation: level, levelIndex: 0, kind: 'minor' as const }],
    });
    const insideRemoved = (set: ReturnType<typeof extractSurfaceContours>, build: ReturnType<typeof buildCadSurface>): number => {
      let hits = 0;
      for (const path of [...set.minorPaths, ...set.majorPaths]) {
        for (let i = 0; i + 1 < path.points.length; i += 1) {
          const a = path.points[i];
          const b = path.points[i + 1];
          const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (edited.removed.some((tri) => inTriangle(p, tri, build))) hits += 1;
        }
      }
      return hits;
    };
    const baseSet = extractSurfaceContours(args(base));
    const editedSet = extractSurfaceContours(args(editedBuild));
    expect(insideRemoved(baseSet, base)).toBeGreaterThan(0);
    expect(insideRemoved(editedSet, editedBuild)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Profile + section
// ---------------------------------------------------------------------------

describe('18S downstream profile/section lifecycle', () => {
  it('delete hole is never bridged: profile and section report a gap in the removed quad', () => {
    const { project, surface } = gridProject();
    const base = buildOf(project, surface);
    const edited = withInteriorDelete(surface, base);
    const editedBuild = buildOf(edited.project, edited.surface);
    const [a, b] = centralInteriorEdge(base);
    const m = { x: (base.points[a].x + base.points[b].x) / 2, y: (base.points[a].y + base.points[b].y) / 2 };
    const dx = base.points[b].x - base.points[a].x;
    const dy = base.points[b].y - base.points[a].y;
    const len = Math.hypot(dx, dy);
    const dir = { x: -dy / len, y: dx / len };
    const from = { x: m.x - dir.x * 9, y: m.y - dir.y * 9 };
    const to = { x: m.x + dir.x * 9, y: m.y + dir.y * 9 };

    const profileOf = (build: ReturnType<typeof buildCadSurface>) =>
      extractSurfaceProfile({
        profileId: 'p1',
        revision: 'prev1:x',
        alignmentElements: [lineElement(from, to)],
        startStation: 0,
        mesh: profileMesh(build),
      });
    expect(profileOf(base).gapLength).toBeLessThan(1e-6);
    expect(profileOf(editedBuild).gapLength).toBeGreaterThan(0);

    const sectionOf = (build: ReturnType<typeof buildCadSurface>) =>
      extractSampleLine({ mesh: profileMesh(build), center: m, direction: dir, leftWidth: 9, rightWidth: 9, rawStation: 0 });
    const baseSection = sectionOf(base);
    const editedSection = sectionOf(editedBuild);
    if (!baseSection.ok || !editedSection.ok) throw new Error('fixture: section failed');
    expect(baseSection.section.gapWidth).toBeLessThan(1e-6);
    expect(editedSection.section.gapWidth).toBeGreaterThan(0);
    expect(editedSection.section.segments.length).toBeGreaterThan(1);

    // Lifecycle: edit -> SOURCE_NOT_CURRENT; rebuilt-but-stale result -> NEEDS_REBUILD.
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: deriveSurfaceStatus(edited.project, edited.surface),
      surfaceRevisionAtBuild: null, currentSurfaceRevision: null, hasResult: true, building: false,
    })).toBe('SOURCE_NOT_CURRENT');
    const currentRevision = computeCadSurfaceSourceRevision(edited.project, edited.surface);
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: 'CURRENT',
      surfaceRevisionAtBuild: 'prev1:old', currentSurfaceRevision: currentRevision, hasResult: true, building: false,
    })).toBe('NEEDS_REBUILD');
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus: 'NEEDS_REBUILD', surfaceRevisionAtBuild: null, currentSurfaceRevision: currentRevision,
      hasResult: true, building: false, outOfRange: false,
    })).toBe('SOURCE_NOT_CURRENT');
  });
});

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

describe('18S downstream volume lifecycle', () => {
  it('stale result -> NEEDS_RECALC; delete-boundary overlay follows the reduced domain', () => {
    const base = gridProject('surf-base');
    const cmp = gridProject('surf-cmp');
    const cmpEntities = cmp.project.entities.map((entity) =>
      entity.type === 'survey-point' ? { ...entity, z: 5 } : entity,
    );
    const cmpProject: CadProject = {
      ...cmp.project,
      entities: cmpEntities,
      surfaces: [{ ...cmp.surface, name: 'Comparison' }, base.surface],
    };
    const cmpSurface = cmpProject.surfaces![0];
    const baseSurface = cmpProject.surfaces![1];
    const baseBuild = buildOf(cmpProject, baseSurface);
    const cmpBuild = buildOf(cmpProject, cmpSurface);
    const [ba, bb] = edgesWithAdjacency(cmpBuild, 1)[0];
    const removedTri = cmpBuild.triangles.find((tri) =>
      tri.includes(ba) && tri.includes(bb),
    )!;
    const editedCmp: CadSurface = {
      ...cmpSurface,
      definition: {
        ...cmpSurface.definition,
        edits: [editOf('delete-line', 'del-boundary', cmpBuild.points[ba].entityId, cmpBuild.points[bb].entityId)],
      },
    };
    const projectWithEdit: CadProject = { ...cmpProject, surfaces: [editedCmp, baseSurface] };
    const editedBuild = buildOf(projectWithEdit, editedCmp);
    expect(editedBuild.triangles.length).toBe(cmpBuild.triangles.length - 1);

    const volume: CadVolumeSurface = { id: 'vol1', name: 'V', baseSurfaceId: baseSurface.id, comparisonSurfaceId: editedCmp.id };
    expect(deriveVolumeSurfaceStatus(projectWithEdit, volume, { building: false })).toBe('SOURCE_NOT_CURRENT');

    // Rebuild both sources CURRENT, but keep a result built for the old revision.
    const cache = createCadSurfaceCache('18s-downstream');
    const baseRev = computeCadSurfaceSourceRevision(projectWithEdit, baseSurface);
    const cmpRev = computeCadSurfaceSourceRevision(projectWithEdit, editedCmp);
    let project = applySurfaceBuildSuccess(projectWithEdit, cache, baseSurface.id, baseRev, baseBuild);
    project = applySurfaceBuildSuccess(project, cache, editedCmp.id, cmpRev, editedBuild);
    const staleResult = { revision: 'vrev1:old', overlapArea: 400 } as CadVolumeResult;
    expect(deriveVolumeSurfaceStatus(project, volume, { building: false, result: staleResult })).toBe('NEEDS_RECALC');

    const toMesh = (build: ReturnType<typeof buildCadSurface>): VolumeMesh => ({
      points: build.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
    });
    const before = computeVolumeQuantities(toMesh(baseBuild), toMesh(cmpBuild)).quantities;
    const after = computeVolumeQuantities(toMesh(baseBuild), toMesh(editedBuild)).quantities;
    const removedArea = Math.abs(
      orient2d(
        cmpBuild.points[removedTri[0]].x, cmpBuild.points[removedTri[0]].y,
        cmpBuild.points[removedTri[1]].x, cmpBuild.points[removedTri[1]].y,
        cmpBuild.points[removedTri[2]].x, cmpBuild.points[removedTri[2]].y,
      ),
    ) / 2;
    expect(before.overlapArea).toBeCloseTo(400, 9);
    expect(after.overlapArea).toBeCloseTo(400 - removedArea, 9);
    expect(after.comparisonArea).toBeCloseTo(400 - removedArea, 9);
  });
});
