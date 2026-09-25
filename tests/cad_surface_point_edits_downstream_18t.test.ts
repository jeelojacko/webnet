/**
 * Phase 18T downstream integration pins (§70-74).
 *
 * Point/elevation edits must flow through the revision-keyed consumers
 * exactly like the 18S edge edits did:
 * - contour: an elevated Add-Point produces a peak loop; undo restores the
 *   original revision (stale → rebuild), never a cached CURRENT.
 * - slope/aspect inquiry: an edited triangle answers with the new plane.
 * - profile + section: an edit crossing the line → SOURCE_NOT_CURRENT,
 *   rebuilt-but-old → NEEDS_REBUILD, rebuild uses the new elevations.
 * - volume: comparison/base elevation edit → NEEDS_RECALC; cut/fill moves by
 *   the analytic delta (raised comparison ⇒ fillVolume += area × Δ).
 *
 * Pure engine reads; no UI, no worker. Reuses the 18H/18I/18J/18K service
 * entry points, not test-local reimplementations.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import { deriveSurfaceContourStatus } from '../src/engine/cad/surfaceContourStatus';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { querySurfaceSlopeAt } from '../src/engine/cad/surfaceAnalysis';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { computeVolumeSurfaceRevision, deriveVolumeSurfaceStatus } from '../src/engine/cad/cadVolumeSurfaces';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import type { CadAlignmentElement, CadProject, CadSurface, CadVolumeResult, CadVolumeSurface } from '../src/engine/cad/cadTypes';
import { gridFixture, meshOf, planeZ, type Build } from './cadSurfacePointEdits18tFixtures';

const PEAK: CadSurface['definition']['edits'] = [
  { id: 'e-peak', kind: 'add-point', x: 5, y: 5, z: planeZ(5, 5) + 50 },
];

const withEdits = (surface: CadSurface, edits: CadSurface['definition']['edits']): CadSurface => ({
  ...surface,
  definition: { ...surface.definition, edits },
});

const buildOf = (project: CadProject, surface: CadSurface): Build => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome}`);
  return build;
};

const contourArgs = (build: Build) => ({
  surfaceId: 'surf-18t',
  surfaceRevision: 'srev1:test',
  styleRevision: 'crev1:test',
  points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
  levels: [{ elevation: 20, levelIndex: 20, kind: 'minor' as const }],
});

const lineElement = (from: { x: number; y: number }, to: { x: number; y: number }): CadAlignmentElement => ({
  kind: 'line',
  start: from,
  end: to,
});

describe('18T downstream contours (§70)', () => {
  it('elevated Add-Point produces a closed peak loop and undo restores CURRENT', () => {
    const { project, surface } = gridFixture({ side: 3 });
    // Cache the base mesh so the surface derives CURRENT pre-edit.
    const baseBuild = buildOf(project, surface);
    const baseRev = computeCadSurfaceSourceRevision(project, surface);
    const cache = createCadSurfaceCache('18t-downstream');
    const cached = applySurfaceBuildSuccess(project, cache, surface.id, baseRev, baseBuild);
    const cachedSurface = cached.surfaces![0]!;
    expect(deriveSurfaceStatus(cached, cachedSurface)).toBe('CURRENT');

    const editedSurface = withEdits(cachedSurface, PEAK);
    const projectWithEdit: CadProject = { ...cached, surfaces: [editedSurface] };
    expect(deriveSurfaceStatus(projectWithEdit, editedSurface)).toBe('NEEDS_REBUILD');

    const baseSet = extractSurfaceContours(contourArgs(baseBuild));
    const editedBuild = buildOf(projectWithEdit, editedSurface);
    const editedSet = extractSurfaceContours(contourArgs(editedBuild));
    // The base plane never reaches the level; the peak crosses it once.
    expect(baseSet.minorPaths).toHaveLength(0);
    expect(baseSet.majorPaths).toHaveLength(0);
    expect(editedSet.minorPaths).toHaveLength(1);
    const loopPoints = editedSet.minorPaths[0]!.points;
    expect(loopPoints.length).toBeGreaterThanOrEqual(4);
    for (const point of loopPoints) {
      expect(Math.hypot(point.x - 5, point.y - 5)).toBeLessThan(7);
    }
    // Closed ring: first == last omitted by the stitcher, so the path is a loop.
    expect(editedSet.minorPaths[0]!.closed).toBe(true);

    // Stale-TIN before rebuild; CURRENT after the rebuild lands the new revision.
    expect(deriveSurfaceContourStatus({ tinCurrent: false, building: false, cacheHit: true, hasStale: true }))
      .toEqual({ status: 'CURRENT', stale: true });
    const editedRev = computeCadSurfaceSourceRevision(projectWithEdit, editedSurface);
    const rebuilt = applySurfaceBuildSuccess(projectWithEdit, cache, surface.id, editedRev, editedBuild);
    expect(deriveSurfaceStatus(rebuilt, rebuilt.surfaces![0]!)).toBe('CURRENT');

    // Undo: dropping the edit restores the original revision, CURRENT again.
    const undone: CadProject = { ...rebuilt, surfaces: [cachedSurface] };
    expect(computeCadSurfaceSourceRevision(undone, cachedSurface)).toBe(baseRev);
    expect(deriveSurfaceStatus(undone, cachedSurface)).toBe('CURRENT');
  });
});

describe('18T downstream slope/aspect inquiry (§71)', () => {
  it('edited triangles answer with the new plane; raise preserves slope and shifts elevation', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const base = buildOf(project, surface);
    const editedBuild = buildOf(project, withEdits(surface, PEAK));
    const baseSlope = querySurfaceSlopeAt(base.points, base.triangles, 5.5, 5.5);
    const peakSlope = querySurfaceSlopeAt(editedBuild.points, editedBuild.triangles, 5.5, 5.5);
    expect(baseSlope?.slopePercent).toBeCloseTo(2.47, 1);
    expect(peakSlope!.slopePercent).toBeGreaterThan(baseSlope!.slopePercent * 100);
    expect(peakSlope!.aspectDeg).not.toBeCloseTo(baseSlope!.aspectDeg ?? 0, 1);
    expect(peakSlope!.elevation).toBeCloseTo(47.69, 1);
    // Far from the edit the original plane still answers unchanged.
    const farEdited = querySurfaceSlopeAt(editedBuild.points, editedBuild.triangles, 15, 15);
    const farBase = querySurfaceSlopeAt(base.points, base.triangles, 15, 15);
    expect(farEdited).toEqual(farBase);

    const raisedBuild = buildOf(project, withEdits(surface, [{ id: 'e-raise', kind: 'raise-lower-surface', deltaZ: 3 }]));
    const raisedSlope = querySurfaceSlopeAt(raisedBuild.points, raisedBuild.triangles, 5.5, 5.5);
    expect(raisedSlope!.slopePercent).toBeCloseTo(baseSlope!.slopePercent, 9);
    expect(raisedSlope!.aspectDeg).toBeCloseTo(baseSlope!.aspectDeg ?? 0, 9);
    expect(raisedSlope!.elevation).toBeCloseTo(baseSlope!.elevation + 3, 9);
  });
});

describe('18T downstream profile (§72)', () => {
  it('add-point peak crossing the line raises the profile; lifecycle follows the revision', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const line = [lineElement({ x: 0, y: 5 }, { x: 20, y: 5 })];
    const profileOf = (build: Build) =>
      extractSurfaceProfile({ profileId: 'p1', revision: 'prev1:x', alignmentElements: line, startStation: 0, mesh: meshOf(build) });
    const base = buildOf(project, surface);
    const baseProfile = profileOf(base);
    const editedBuild = buildOf(project, withEdits(surface, PEAK));
    const editedProfile = profileOf(editedBuild);
    expect(baseProfile.gapLength).toBeLessThan(1e-9);
    expect(editedProfile.gapLength).toBeLessThan(1e-9);
    expect(editedProfile.maxElevation!).toBeGreaterThan(baseProfile.maxElevation! + 40);

    // Edit → SOURCE_NOT_CURRENT (no fresh build); old result against the new
    // revision → NEEDS_REBUILD; matching revision → CURRENT.
    const editedSurface = withEdits(surface, PEAK);
    const projectWithEdit: CadProject = { ...project, surfaces: [editedSurface] };
    const surfaceStatus = deriveSurfaceStatus(projectWithEdit, editedSurface);
    expect(surfaceStatus).not.toBe('CURRENT');
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus,
      surfaceRevisionAtBuild: null, currentSurfaceRevision: null, hasResult: true, building: false,
    })).toBe('SOURCE_NOT_CURRENT');
    const editedRev = computeCadSurfaceSourceRevision(projectWithEdit, editedSurface);
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: 'CURRENT',
      surfaceRevisionAtBuild: 'prev1:old', currentSurfaceRevision: editedRev, hasResult: true, building: false,
    })).toBe('NEEDS_REBUILD');
    expect(deriveSurfaceProfileStatus({
      profileExists: true, alignmentExists: true, surfaceStatus: 'CURRENT',
      surfaceRevisionAtBuild: editedRev, currentSurfaceRevision: editedRev, hasResult: true, building: false,
    })).toBe('CURRENT');
    // Rebuild against the edited mesh consumes the peak, not the base plane.
    const rebuiltProfile = extractSurfaceProfile({
      profileId: 'p1', revision: editedRev, alignmentElements: line, startStation: 0, mesh: meshOf(editedBuild),
    });
    expect(rebuiltProfile.maxElevation).toBeCloseTo(editedProfile.maxElevation!, 9);
  });
});

describe('18T downstream section (§73)', () => {
  it('add-point peak raises the section; lifecycle mirrors the profile', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const sectionOf = (build: Build) =>
      extractSampleLine({ mesh: meshOf(build), center: { x: 5, y: 10 }, direction: { x: 0, y: 1 }, leftWidth: 10, rightWidth: 10, rawStation: 0 });
    const base = buildOf(project, surface);
    const baseSection = sectionOf(base);
    const editedBuild = buildOf(project, withEdits(surface, PEAK));
    const editedSection = sectionOf(editedBuild);
    if (!baseSection.ok || !editedSection.ok) throw new Error('fixture: section failed');
    expect(baseSection.section.gapWidth).toBeLessThan(1e-9);
    expect(editedSection.section.gapWidth).toBeLessThan(1e-9);
    expect(editedSection.section.maxElevation!).toBeGreaterThan(baseSection.section.maxElevation! + 40);
    // The peak sample is present in the retained segments (never bridged).
    const peakSample = editedSection.section.segments
      .flatMap((segment) => segment.samples)
      .reduce((best, sample) => (sample.elevation > best.elevation ? sample : best));
    expect(peakSample.elevation).toBeCloseTo(52.67, 1);

    const editedSurface = withEdits(surface, PEAK);
    const projectWithEdit: CadProject = { ...project, surfaces: [editedSurface] };
    const editedRev = computeCadSurfaceSourceRevision(projectWithEdit, editedSurface);
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus: deriveSurfaceStatus(projectWithEdit, editedSurface),
      surfaceRevisionAtBuild: null, currentSurfaceRevision: null, hasResult: true, building: false, outOfRange: false,
    })).toBe('SOURCE_NOT_CURRENT');
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus: 'CURRENT', surfaceRevisionAtBuild: 'prev1:old', currentSurfaceRevision: editedRev,
      hasResult: true, building: false, outOfRange: false,
    })).toBe('NEEDS_REBUILD');
  });
});

describe('18T downstream volume (§74)', () => {
  const raised = (deltaZ: number): CadSurface['definition']['edits'] => [
    { id: 'e-raise', kind: 'raise-lower-surface', deltaZ },
  ];

  it('comparison raise moves fillVolume by area × Δ and forces NEEDS_RECALC', () => {
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
    expect(before.cutVolume).toBeCloseTo(0, 9);
    expect(before.fillVolume).toBeCloseTo(800, 9);

    // Cache both sources CURRENT so the volume derives CURRENT for its revision.
    const cache = createCadSurfaceCache('18t-volume');
    let current = applySurfaceBuildSuccess(
      project, cache, baseFixture.surface.id,
      computeCadSurfaceSourceRevision(project, baseFixture.surface), baseBuild,
    );
    current = applySurfaceBuildSuccess(
      current, cache, cmpFixture.surface.id,
      computeCadSurfaceSourceRevision(current, cmpFixture.surface), cmpBuild,
    );
    const volume: CadVolumeSurface = {
      id: 'vol1', name: 'V',
      baseSurfaceId: baseFixture.surface.id,
      comparisonSurfaceId: cmpFixture.surface.id,
    };
    const currentRevision = computeVolumeSurfaceRevision({
      baseId: volume.baseSurfaceId,
      baseRev: current.surfaces![0]!.cachedRevision ?? null,
      cmpId: volume.comparisonSurfaceId,
      cmpRev: current.surfaces![1]!.cachedRevision ?? null,
    });
    const staleResult = { revision: currentRevision, overlapArea: 400 } as CadVolumeResult;
    expect(deriveVolumeSurfaceStatus(current, volume, {
      building: false, result: staleResult,
    })).toBe('CURRENT');

    // Edit the comparison elevation (+1): sources stale, result outdated.
    const editedCmp = withEdits(current.surfaces![1]!, raised(1));
    const editedProject: CadProject = { ...current, surfaces: [current.surfaces![0]!, editedCmp] };
    expect(deriveVolumeSurfaceStatus(editedProject, volume, {
      building: false, result: staleResult,
    })).toBe('SOURCE_NOT_CURRENT');
    const editedCmpBuild = buildOf(editedProject, editedCmp);
    const rebuilt = applySurfaceBuildSuccess(
      editedProject, cache, editedCmp.id,
      computeCadSurfaceSourceRevision(editedProject, editedCmp), editedCmpBuild,
    );
    expect(deriveVolumeSurfaceStatus(rebuilt, volume, {
      building: false, result: staleResult,
    })).toBe('NEEDS_RECALC');

    // Analytic overlay: fill depth grows by exactly Δ over the shared domain.
    const after = computeVolumeQuantities(toMesh(baseBuild), toMesh(editedCmpBuild)).quantities;
    expect(after.overlapArea).toBeCloseTo(before.overlapArea, 9);
    expect(after.cutVolume).toBeCloseTo(0, 9);
    expect(after.fillVolume - before.fillVolume).toBeCloseTo(before.overlapArea * 1, 6);
  });
});
