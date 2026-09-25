/**
 * Phase 18V downstream integration pins (bulk/region edits).
 *
 * The three bulk kinds (`set-elevation-many`, `raise-lower-points`,
 * `move-points`) are ordinary stack entries: they must flow through the same
 * revision-keyed consumers as the 18S edge edits and the 18T point edits.
 *
 * - contours: a bulk Raise/Set patch invalidates the parent TIN revision
 *   (never a fresh CURRENT), the stale set is stale-marked, and the rebuild
 *   reflects the patch; Raise ≡ Set at the same final Z.
 * - profile/section: SOURCE_NOT_CURRENT → NEEDS_REBUILD; the rebuild consumes
 *   the new elevations.
 * - volume: a bulk comparison raise → SOURCE_NOT_CURRENT → NEEDS_RECALC; the
 *   analytic overlay moves fillVolume by exactly overlapArea × Δ.
 * - slope/aspect: the final mesh answers with the edited triangle plane.
 * - 18U analysis: SOURCE_NOT_CURRENT → NEEDS_RECALC; the recalced bands are
 *   exact and conserve plan area.
 *
 * Pure engine reads; no UI, no worker, no persistence. Reuses the shared
 * 18T grid fixture and the real 18H/18I/18J/18K/18U service entry points.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import { deriveSurfaceContourStatus } from '../src/engine/cad/surfaceContourStatus';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { querySurfaceSlopeAt } from '../src/engine/cad/surfaceAnalysis';
import { analyzeElevationBands, type ElevationMesh } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import { computeAnalysisGeometryRevision } from '../src/engine/cad/cadAnalysisRevision';
import { deriveAnalysisStatus } from '../src/engine/cad/cadAnalysisStatus';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { computeVolumeSurfaceRevision, deriveVolumeSurfaceStatus } from '../src/engine/cad/cadVolumeSurfaces';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import type { CadAnalysisBand, CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import type {
  CadAlignmentElement,
  CadProject,
  CadSurface,
  CadVolumeResult,
  CadVolumeSurface,
} from '../src/engine/cad/cadTypes';
import {
  gridFixture,
  meshOf,
  planeZ,
  surfacePoint,
  type Build,
} from './cadSurfacePointEdits18tFixtures';

const ref = (entityId: string): { key: string } => ({ key: `source:${entityId}` });

const withEdits = (surface: CadSurface, edits: CadSurface['definition']['edits']): CadSurface => ({
  ...surface,
  definition: { ...surface.definition, edits },
});

const buildOf = (project: CadProject, surface: CadSurface): Build => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome}`);
  return build;
};

const contoursOf = (build: Build, elevation: number) =>
  extractSurfaceContours({
    surfaceId: 'surf-18v',
    surfaceRevision: 'srev1:test',
    styleRevision: 'crev1:test',
    points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
    levels: [{ elevation, levelIndex: elevation, kind: 'minor' as const }],
  });

const lineElement = (from: { x: number; y: number }, to: { x: number; y: number }): CadAlignmentElement => ({
  kind: 'line',
  start: from,
  end: to,
});

const analysisMesh = (build: Build): ElevationMesh => ({
  xs: build.points.map((p) => p.x),
  ys: build.points.map((p) => p.y),
  zs: build.points.map((p) => p.z),
  tris: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
});

describe('18V downstream contours', () => {
  it('bulk raise/set stale→rebuild yields the patch loop and marks the old set stale', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const baseBuild = buildOf(project, surface);
    const baseRev = computeCadSurfaceSourceRevision(project, surface);
    const cache = createCadSurfaceCache('18v-downstream-contour');
    const cached = applySurfaceBuildSuccess(project, cache, surface.id, baseRev, baseBuild);
    expect(deriveSurfaceStatus(cached, cached.surfaces![0]!)).toBe('CURRENT');

    const raiseEdit: CadSurface['definition']['edits'] = [
      { id: 'e-raise', kind: 'raise-lower-points', vertices: [ref('pt:1-1')], deltaZ: 50 },
    ];
    const raisedSurface = withEdits(cached.surfaces![0]!, raiseEdit);
    const raisedProject: CadProject = { ...cached, surfaces: [raisedSurface] };
    expect(deriveSurfaceStatus(raisedProject, raisedSurface)).toBe('NEEDS_REBUILD');

    // The cached pre-edit set can never derive a fresh CURRENT; it is stale-marked.
    expect(deriveSurfaceContourStatus({ tinCurrent: false, building: false, cacheHit: true, hasStale: true }))
      .toEqual({ status: 'CURRENT', stale: true });

    const level = 30;
    expect(contoursOf(baseBuild, level).minorPaths).toHaveLength(0);
    const raisedBuild = buildOf(raisedProject, raisedSurface);
    const raisedSet = contoursOf(raisedBuild, level);
    expect(raisedSet.minorPaths).toHaveLength(1);
    expect(raisedSet.minorPaths[0]!.closed).toBe(true);
    for (const point of raisedSet.minorPaths[0]!.points) {
      expect(Math.hypot(point.x - 10, point.y - 10)).toBeLessThan(10);
    }

    // Rebuild lands the edited revision: the same set becomes a FRESH CURRENT.
    const raisedRev = computeCadSurfaceSourceRevision(raisedProject, raisedSurface);
    const rebuilt = applySurfaceBuildSuccess(raisedProject, cache, surface.id, raisedRev, raisedBuild);
    expect(deriveSurfaceStatus(rebuilt, rebuilt.surfaces![0]!)).toBe('CURRENT');
    expect(deriveSurfaceContourStatus({ tinCurrent: true, building: false, cacheHit: true, hasStale: false }))
      .toEqual({ status: 'CURRENT', stale: false });

    // Set-many to the same final Z is contour-equivalent to the raise.
    const setSurface = withEdits(cached.surfaces![0]!, [
      { id: 'e-set', kind: 'set-elevation-many', vertices: [ref('pt:1-1')], z: planeZ(10, 10) + 50 },
    ]);
    const setBuild = buildOf({ ...cached, surfaces: [setSurface] }, setSurface);
    expect(contoursOf(setBuild, level).minorPaths.map((path) => path.points)).toEqual(
      raisedSet.minorPaths.map((path) => path.points),
    );

    // Undo: dropping the edit restores the original revision.
    expect(computeCadSurfaceSourceRevision(cached, cached.surfaces![0]!)).toBe(baseRev);
    expect(deriveSurfaceStatus(cached, cached.surfaces![0]!)).toBe('CURRENT');
  });
});

describe('18V downstream profile/section', () => {
  it('bulk raise reaches the rebuilt profile/section with the new elevations and lifecycle', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const raiseEdit: CadSurface['definition']['edits'] = [
      { id: 'e-raise', kind: 'raise-lower-points', vertices: [ref('pt:0-1'), ref('pt:1-1'), ref('pt:2-1')], deltaZ: 30 },
    ];
    const editedSurface = withEdits(surface, raiseEdit);
    const editedProject: CadProject = { ...project, surfaces: [editedSurface] };
    const baseBuild = buildOf(project, surface);
    const editedBuild = buildOf(editedProject, editedSurface);

    const line = [lineElement({ x: 0, y: 5 }, { x: 20, y: 5 })];
    const profileOf = (build: Build) =>
      extractSurfaceProfile({ profileId: 'p1', revision: 'prev1:x', alignmentElements: line, startStation: 0, mesh: meshOf(build) });
    const baseProfile = profileOf(baseBuild);
    const editedProfile = profileOf(editedBuild);
    expect(baseProfile.gapLength).toBeLessThan(1e-9);
    expect(editedProfile.gapLength).toBeLessThan(1e-9);
    expect(editedProfile.maxElevation!).toBeGreaterThan(baseProfile.maxElevation! + 20);

    const surfaceStatus = deriveSurfaceStatus(editedProject, editedSurface);
    expect(surfaceStatus).not.toBe('CURRENT');
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus,
      surfaceRevisionAtBuild: null, currentSurfaceRevision: null, hasResult: true, building: false,
    })).toBe('SOURCE_NOT_CURRENT');
    const editedRev = computeCadSurfaceSourceRevision(editedProject, editedSurface);
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: 'CURRENT',
      surfaceRevisionAtBuild: 'prev1:old', currentSurfaceRevision: editedRev, hasResult: true, building: false,
    })).toBe('NEEDS_REBUILD');

    const sectionOf = (build: Build) =>
      extractSampleLine({ mesh: meshOf(build), center: { x: 10, y: 10 }, direction: { x: 0, y: 1 }, leftWidth: 10, rightWidth: 10, rawStation: 0 });
    const baseSection = sectionOf(baseBuild);
    const editedSection = sectionOf(editedBuild);
    if (!baseSection.ok || !editedSection.ok) throw new Error('fixture: section failed');
    expect(editedSection.section.gapWidth).toBeLessThan(1e-9);
    expect(editedSection.section.maxElevation!).toBeGreaterThan(baseSection.section.maxElevation! + 20);
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus, surfaceRevisionAtBuild: null, currentSurfaceRevision: null,
      hasResult: true, building: false, outOfRange: false,
    })).toBe('SOURCE_NOT_CURRENT');
  });
});

describe('18V downstream volume', () => {
  it('bulk comparison raise forces SOURCE_NOT_CURRENT→NEEDS_RECALC and moves fill by area × Δ', () => {
    const baseFixture = gridFixture({ side: 3, surfaceId: 'vol-base' });
    const cmpFixture = gridFixture({ side: 3, surfaceId: 'vol-cmp', idPrefix: 'c', zOf: (x, y) => planeZ(x, y) + 2 });
    const project: CadProject = {
      ...baseFixture.project,
      entities: [...baseFixture.project.entities, ...cmpFixture.project.entities],
      surfaces: [baseFixture.surface, cmpFixture.surface],
    };
    const baseBuild = buildOf(project, baseFixture.surface);
    const cmpBuild = buildOf(project, cmpFixture.surface);
    const toMesh = (build: Build): VolumeMesh => ({
      points: build.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: build.triangles.flatMap((t) => [t[0], t[1], t[2]]),
    });
    const before = computeVolumeQuantities(toMesh(baseBuild), toMesh(cmpBuild)).quantities;
    expect(before.overlapArea).toBeCloseTo(400, 9);
    expect(before.fillVolume).toBeCloseTo(800, 9);

    const cache = createCadSurfaceCache('18v-downstream-volume');
    let current = applySurfaceBuildSuccess(
      project, cache, baseFixture.surface.id,
      computeCadSurfaceSourceRevision(project, baseFixture.surface), baseBuild,
    );
    current = applySurfaceBuildSuccess(
      current, cache, cmpFixture.surface.id,
      computeCadSurfaceSourceRevision(current, cmpFixture.surface), cmpBuild,
    );
    const volume: CadVolumeSurface = {
      id: 'vol1', name: 'V', baseSurfaceId: baseFixture.surface.id, comparisonSurfaceId: cmpFixture.surface.id,
    };
    const currentRevision = computeVolumeSurfaceRevision({
      baseId: volume.baseSurfaceId,
      baseRev: current.surfaces![0]!.cachedRevision ?? null,
      cmpId: volume.comparisonSurfaceId,
      cmpRev: current.surfaces![1]!.cachedRevision ?? null,
    });
    const staleResult = { revision: currentRevision, overlapArea: 400 } as CadVolumeResult;
    expect(deriveVolumeSurfaceStatus(current, volume, { building: false, result: staleResult })).toBe('CURRENT');

    // Bulk raise the whole comparison patch by Δ = 1 m.
    const cmpRefs = cmpFixture.project.entities.map((entity) => ref(entity.id));
    const editedCmp = withEdits(current.surfaces![1]!, [
      { id: 'e-cmp-raise', kind: 'raise-lower-points', vertices: cmpRefs, deltaZ: 1 },
    ]);
    const editedProject: CadProject = { ...current, surfaces: [current.surfaces![0]!, editedCmp] };
    expect(deriveVolumeSurfaceStatus(editedProject, volume, { building: false, result: staleResult })).toBe('SOURCE_NOT_CURRENT');
    const editedCmpBuild = buildOf(editedProject, editedCmp);
    const rebuilt = applySurfaceBuildSuccess(
      editedProject, cache, editedCmp.id,
      computeCadSurfaceSourceRevision(editedProject, editedCmp), editedCmpBuild,
    );
    expect(deriveVolumeSurfaceStatus(rebuilt, volume, { building: false, result: staleResult })).toBe('NEEDS_RECALC');

    const after = computeVolumeQuantities(toMesh(baseBuild), toMesh(editedCmpBuild)).quantities;
    expect(after.overlapArea).toBeCloseTo(before.overlapArea, 9);
    expect(after.cutVolume).toBeCloseTo(0, 9);
    expect(after.fillVolume - before.fillVolume).toBeCloseTo(before.overlapArea * 1, 6);
  });
});

describe('18V downstream slope/aspect', () => {
  it('answers from the edited triangle plane; far field is unchanged', () => {
    const { project, surface } = gridFixture({ side: 4 });
    const base = buildOf(project, surface);
    const edited = buildOf(project, withEdits(surface, [
      { id: 'e-raise', kind: 'raise-lower-points', vertices: [ref('pt:1-1')], deltaZ: 50 },
    ]));
    const baseSlope = querySurfaceSlopeAt(base.points, base.triangles, 10.5, 10.5);
    const editedSlope = querySurfaceSlopeAt(edited.points, edited.triangles, 10.5, 10.5);
    expect(baseSlope).not.toBeNull();
    expect(editedSlope!.slopePercent).toBeGreaterThan(baseSlope!.slopePercent * 5);
    expect(editedSlope!.elevation).toBeGreaterThan(baseSlope!.elevation + 20);
    // A point outside the edited one-ring still reads the original plane.
    expect(querySurfaceSlopeAt(edited.points, edited.triangles, 24, 25))
      .toEqual(querySurfaceSlopeAt(base.points, base.triangles, 24, 25));
  });
});

describe('18V downstream analysis (18U)', () => {
  const bands: CadAnalysisBand[] = [
    { id: 'low', lower: 0, upper: 10, color: '#111111' },
    { id: 'high', lower: 10, upper: 30, color: '#222222' },
  ];

  const triangleFixture = () => {
    const base = createBlankCadProject({ name: 'T18V-analysis', units: 'm' });
    const entities = [
      surfacePoint('A', 0, 0, 0),
      surfacePoint('B', 10, 0, 0),
      surfacePoint('C', 0, 10, 20),
    ];
    const surface: CadSurface = {
      id: 'surf-tri',
      name: 'Single triangle',
      definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entity) => entity.id) } },
    };
    return { project: { ...base, entities, surfaces: [surface] }, surface };
  };

  it('bulk raise → SOURCE_NOT_CURRENT → NEEDS_RECALC with exact conserving bands', () => {
    const { project, surface } = triangleFixture();
    const map: CadAnalysisMap = {
      id: 'amap-1', name: 'Elevation', source: { kind: 'surface', surfaceId: surface.id, metric: 'elevation' }, bands, opacity: 0.5,
    };
    const baseBuild = buildOf(project, surface);
    const baseRev = computeCadSurfaceSourceRevision(project, surface);
    const baseAnalysis = analyzeElevationBands(analysisMesh(baseBuild), bands, { includeDisplay: false });
    expect(baseAnalysis.bands[0]!.planArea).toBeCloseTo(37.5, 9);
    expect(baseAnalysis.bands[1]!.planArea).toBeCloseTo(12.5, 9);

    const baseGeometry = computeAnalysisGeometryRevision(map, { surfaceRevision: baseRev });
    expect(deriveAnalysisStatus(map, { found: true, status: 'CURRENT' }, true, baseGeometry, baseGeometry)).toBe('CURRENT');

    const cache = createCadSurfaceCache('18v-downstream-analysis');
    const cached = applySurfaceBuildSuccess(project, cache, surface.id, baseRev, baseBuild);
    const editedSurface = withEdits(cached.surfaces![0]!, [
      { id: 'e-raise', kind: 'raise-lower-points', vertices: [ref('pt:B')], deltaZ: 20 },
    ]);
    const editedProject: CadProject = { ...cached, surfaces: [editedSurface] };
    const sourceStatus = deriveSurfaceStatus(editedProject, editedSurface);
    expect(sourceStatus).not.toBe('CURRENT');
    expect(deriveAnalysisStatus(map, { found: true, status: sourceStatus }, true, baseGeometry, baseGeometry))
      .toBe('SOURCE_NOT_CURRENT');

    const editedBuild = buildOf(editedProject, editedSurface);
    const editedRev = computeCadSurfaceSourceRevision(editedProject, editedSurface);
    const rebuilt = applySurfaceBuildSuccess(editedProject, cache, surface.id, editedRev, editedBuild);
    expect(deriveSurfaceStatus(rebuilt, rebuilt.surfaces![0]!)).toBe('CURRENT');
    const editedGeometry = computeAnalysisGeometryRevision(map, { surfaceRevision: editedRev });
    expect(editedGeometry).not.toBe(baseGeometry);
    expect(deriveAnalysisStatus(map, { found: true, status: 'CURRENT' }, true, baseGeometry, editedGeometry))
      .toBe('NEEDS_RECALC');

    // Recalc on the edited mesh: exact bands, full conservation, deterministic.
    const recalc = analyzeElevationBands(analysisMesh(editedBuild), bands, { includeDisplay: false });
    expect(recalc.bands[0]!.planArea).toBeCloseTo(12.5, 9);
    expect(recalc.bands[1]!.planArea).toBeCloseTo(37.5, 9);
    expect(recalc.totals.surfacePlanArea).toBeCloseTo(50, 9);
    expect(recalc.totals.surfacePlanArea).toBeCloseTo(editedBuild.stats.planimetricArea, 9);
    expect(recalc.bands.reduce((sum, band) => sum + band.planArea, 0)).toBeCloseTo(recalc.totals.surfacePlanArea, 9);
    expect(recalc.totals.unclassifiedPlanArea).toBeCloseTo(0, 12);
    const rerun = analyzeElevationBands(analysisMesh(editedBuild), bands, { includeDisplay: false });
    expect(rerun.bands.map((band) => band.planArea)).toEqual(recalc.bands.map((band) => band.planArea));
  });
});
