/**
 * Phase 18L — CAD→LandXML civil export: TIN surfaces + alignments.
 *
 * Independent oracle: the emitted XML is re-parsed by
 * tests/landxmlCivilTestSupport.ts (no shared serializer/importer code) and
 * checked against the source mesh and an analytic plane.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache, type CachedSurfaceMesh } from '../src/engine/cad/cadSurfaceCache';
import { parseCadDrawingFile, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument } from '../src/engine/cad/cadTypes';
import {
  cadAlignmentEndStation,
  cadAlignmentLength,
  cadAlignmentRawStationToDisplayStation,
} from '../src/engine/cad/cadAlignmentStationing';
import {
  parseAlignments,
  parseCgPoints,
  parseSurfaces,
  type ParsedSurfacePoint,
} from './landxmlCivilTestSupport';
import {
  buildAlignmentProject,
  buildPlaneSurfaceProject,
  makeCurrentSurface,
  planeElev,
} from './landxmlCivilFixtures';

const FIXED = new Date('2026-09-19T12:00:00Z');

const settingsFor = (projectName: string) => ({
  units: 'm' as const,
  projectName,
  generatedAt: FIXED,
});

const shoelaceArea = (points: readonly ParsedSurfacePoint[], faces: readonly number[][]): number => {
  let area = 0;
  for (const [a, b, c] of faces as [number, number, number][]) {
    const pa = points[a - 1] as ParsedSurfacePoint;
    const pb = points[b - 1] as ParsedSurfacePoint;
    const pc = points[c - 1] as ParsedSurfacePoint;
    area += Math.abs((pb.e - pa.e) * (pc.n - pa.n) - (pc.e - pa.e) * (pb.n - pa.n)) / 2;
  }
  return area;
};

/** Per-triangle contour chords at a threshold, deterministic order. */
const contourSegments = (
  points: readonly { e: number; n: number; z: number }[],
  faces: readonly (readonly number[])[],
  threshold: number,
): string[] => {
  const segments: string[] = [];
  for (const face of faces) {
    const crossings: Array<[number, number]> = [];
    for (const [i, j] of [
      [face[0] as number, face[1] as number],
      [face[1] as number, face[2] as number],
      [face[2] as number, face[0] as number],
    ]) {
      const pi = points[i - 1] as { e: number; n: number; z: number };
      const pj = points[j - 1] as { e: number; n: number; z: number };
      if ((pi.z - threshold) * (pj.z - threshold) < 0) {
        const t = (threshold - pi.z) / (pj.z - pi.z);
        crossings.push([pi.e + t * (pj.e - pi.e), pi.n + t * (pj.n - pi.n)]);
      }
    }
    if (crossings.length === 2) {
      const [p, q] = crossings as [[number, number], [number, number]];
      segments.push([p[0], p[1], q[0], q[1]].map((v) => v.toFixed(6)).join(','));
    }
  }
  return segments.sort();
};

describe('Phase 18L LandXML surface export', () => {
  it('exports the retained mesh deterministically and reimports canonically', () => {
    const { project, surfaceId } = buildPlaneSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const result = buildLandXmlProjectExportWithResult(
      current.project,
      settingsFor('Plane Site'),
      { surfaceCache: current.cache },
    );

    expect(result.civilEntries).toEqual([
      { class: 'surface', id: surfaceId, name: 'Plane TIN', disposition: 'EXPORTED' },
    ]);
    const parsed = parseSurfaces(result.output);
    expect(parsed).toHaveLength(1);
    const surface = parsed[0]!;
    const mesh = current.built;

    // XYZ + 1-based ids in canonical vertex order.
    expect(surface.points).toHaveLength(mesh.points.length);
    surface.points.forEach((point, index) => {
      const source = mesh.points[index]!;
      expect(point.id).toBe(index + 1);
      expect(point.e).toBeCloseTo(source.x, 6);
      expect(point.n).toBeCloseTo(source.y, 6);
      expect(point.z).toBeCloseTo(source.z, 6);
      // Analytic plane oracle: every retained vertex lies on z = f(e, n).
      expect(point.z).toBeCloseTo(planeElev(point.e, point.n), 6);
    });

    // Topology preserved 1:1.
    expect(surface.faces).toEqual(mesh.triangles.map((tri) => [tri[0] + 1, tri[1] + 1, tri[2] + 1]));

    // Domain area, min/max elevation.
    expect(surface.area2D).toBeCloseTo(mesh.stats.planimetricArea, 4);
    expect(surface.elevMin).toBeCloseTo(mesh.stats.minZ as number, 6);
    expect(surface.elevMax).toBeCloseTo(mesh.stats.maxZ as number, 6);
    expect(shoelaceArea(surface.points, surface.faces)).toBeCloseTo(surface.area2D as number, 5);

    // Elevation probe at each face centroid (linear TIN == plane).
    for (const [a, b, c] of surface.faces as [number, number, number][]) {
      const pa = surface.points[a - 1]!;
      const pb = surface.points[b - 1]!;
      const pc = surface.points[c - 1]!;
      const e = (pa.e + pb.e + pc.e) / 3;
      const n = (pa.n + pb.n + pc.n) / 3;
      const z = (pa.z + pb.z + pc.z) / 3;
      expect(z).toBeCloseTo(planeElev(e, n), 6);
    }

    // Deterministic contours derived from the parsed mesh match the source mesh.
    const sourceContours = contourSegments(
      mesh.points.map((point) => ({ e: point.x, n: point.y, z: point.z })),
      mesh.triangles.map((t) => [t[0] + 1, t[1] + 1, t[2] + 1]),
      planeElev(40, 40),
    );
    expect(contourSegments(surface.points, surface.faces, planeElev(40, 40))).toEqual(sourceContours);
    expect(contourSegments(surface.points, surface.faces, planeElev(40, 40))).toEqual(sourceContours);
  });

  it('re-exports an unchanged surface byte-identically (timestamp pinned)', () => {
    const { project, surfaceId } = buildPlaneSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const sources = { surfaceCache: current.cache };
    const first = buildLandXmlProjectExportWithResult(current.project, settingsFor('Plane Site'), sources).output;
    const second = buildLandXmlProjectExportWithResult(current.project, settingsFor('Plane Site'), sources).output;
    expect(second).toBe(first);
  });

  it('blocks a stale surface and emits no stale triangles', () => {
    const { project, surfaceId } = buildPlaneSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    // Source edit + empty cache: cachedRevision no longer matches => NEEDS_REBUILD.
    const stale = {
      ...current.project,
      surfaces: (current.project.surfaces ?? []).map((surface) =>
        surface.id === surfaceId ? { ...surface, cachedRevision: 'srev1:stale' } : surface,
      ),
    };
    const result = buildLandXmlProjectExportWithResult(stale, settingsFor('Plane Site'), {
      surfaceCache: createCadSurfaceCache('stale'),
    });
    expect(result.civilEntries[0]?.disposition).toBe('BLOCKED');
    expect(result.civilEntries[0]?.reason).toBe('LANDXML_SURFACE_NOT_CURRENT');
    expect(result.omittedEntityIds).toContain(surfaceId);
    expect(result.output).not.toContain('<Surface ');
    expect(result.warnings.some((warning) => warning.entityId === surfaceId)).toBe(true);
  });

  it('never exports a surface without a runtime mesh (legacy call unchanged)', () => {
    const { project, surfaceId } = buildPlaneSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const plainDef = { ...current.project };
    const withoutSurface = { ...current.project, surfaces: [] };
    // No civilSources: surfaces are excluded byte-identically (pre-18L contract).
    expect(buildLandXmlProjectExportWithResult(plainDef, settingsFor('Plane Site')).output).toBe(
      buildLandXmlProjectExportWithResult(withoutSurface, settingsFor('Plane Site')).output,
    );
    // With civil sources but no runtime mesh: blocked with an explicit reason.
    const blocked = buildLandXmlProjectExportWithResult(current.project, settingsFor('Plane Site'), {
      surfaceCache: createCadSurfaceCache('empty'),
    });
    expect(blocked.civilEntries[0]?.disposition).toBe('BLOCKED');
    expect(blocked.civilEntries[0]?.reason).toBe('LANDXML_SURFACE_MESH_UNAVAILABLE');
  });

  it('keeps a civil-free drawing byte-identical with and without civil sources', () => {
    const { project } = buildPlaneSurfaceProject();
    const pointsOnly = { ...project, surfaces: [] };
    const legacy = buildLandXmlProjectExportWithResult(pointsOnly, settingsFor('Points Only')).output;
    const withSources = buildLandXmlProjectExportWithResult(pointsOnly, settingsFor('Points Only'), {
      surfaceCache: createCadSurfaceCache('none'),
    }).output;
    expect(withSources).toBe(legacy);
    expect(legacy).not.toContain('<Surfaces>');
    expect(legacy).not.toContain('<StaEquation');
  });

  it('round-trips an imported (explicit-topology) TIN through WNCAD save/reopen', () => {
    // The import path persists explicit vertices/faces and re-materializes the
    // mesh on reopen; at the export boundary this is a mesh whose topology was
    // NOT produced by Delaunay. Inject that mesh directly so the test is
    // independent of the import worker's in-flight materializer.
    const plane = buildPlaneSurfaceProject();
    const surface = plane.project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(plane.project, surface);
    const mesh: CachedSurfaceMesh = {
      revision,
      points: [
        { entityId: 'v0', x: 0, y: 0, z: 0 },
        { entityId: 'v1', x: 20, y: 0, z: 1 },
        { entityId: 'v2', x: 20, y: 20, z: 2 },
        { entityId: 'v3', x: 0, y: 20, z: 1 },
      ],
      triangles: [[0, 1, 2], [0, 2, 3]],
      stats: {
        resolvedPointCount: 4,
        usedPointCount: 4,
        skippedMissingZCount: 0,
        triangleCount: 2,
        minZ: 0,
        maxZ: 2,
        minX: 0,
        minY: 0,
        maxX: 20,
        maxY: 20,
        planimetricArea: 400,
        surface3DArea: 600,
        meanElevation: 1,
        minFaceSlopeRatio: 0,
        maxFaceSlopeRatio: 1,
        meanFaceSlopeRatio: 0.5,
      },
      grid: { minX: 0, minY: 0, cellSize: 20, cells: new Map() },
      adjacency: [],
      edgeKinds: [],
    };
    const project = {
      ...plane.project,
      surfaces: [{ ...surface, cachedRevision: revision }],
    };
    const cache = createCadSurfaceCache('import-1');
    cache.set(surface.id, revision, mesh);
    const first = buildLandXmlProjectExportWithResult(project, settingsFor('Imported Site'), {
      surfaceCache: cache,
    });
    const firstSurfaces = parseSurfaces(first.output);
    expect(firstSurfaces[0]?.faces).toEqual([[1, 2, 3], [1, 3, 4]]);
    expect(firstSurfaces[0]?.points.map((point) => [point.n, point.e, point.z])).toEqual([
      [0, 0, 0],
      [0, 20, 1],
      [20, 20, 2],
      [20, 0, 1],
    ]);

    // WNCAD save + reopen: explicit topology survives, derived mesh does not.
    const document: CadDrawingDocument = {
      kind: 'webnet-cad-drawing',
      schemaVersion: 2,
      drawingId: 'imported-18l',
      name: 'Imported Site',
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z',
      units: 'm',
      project,
    };
    const parsedDocument = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsedDocument.ok).toBe(true);
    if (!parsedDocument.ok) return;
    const reopenedSurface = parsedDocument.drawing.project.surfaces?.[0];
    expect(reopenedSurface?.cachedRevision).toBeNull();
    if (!reopenedSurface) throw new Error('reopened drawing lost its surface');
    const revision2 = computeCadSurfaceSourceRevision(parsedDocument.drawing.project, reopenedSurface);
    const cache2 = createCadSurfaceCache('import-2');
    cache2.set(reopenedSurface.id, revision2, { ...mesh, revision: revision2 });
    const reopened = {
      ...parsedDocument.drawing.project,
      surfaces: [{ ...reopenedSurface, cachedRevision: revision2 }],
    };
    const second = buildLandXmlProjectExportWithResult(reopened, settingsFor('Imported Site'), {
      surfaceCache: cache2,
    });
    expect(parseSurfaces(second.output)).toEqual(firstSurfaces);
  });
});

describe('Phase 18L LandXML alignment export', () => {
  it('exports native line/arc/line with staStart and station equations', () => {
    const { project, entity } = buildAlignmentProject();
    const result = buildLandXmlProjectExportWithResult(project, settingsFor('Alignment Site'));
    const alignments = parseAlignments(result.output);
    expect(alignments).toHaveLength(1);
    const alignment = alignments[0]!;
    const points = parseCgPoints(result.output);
    const coord = (ref: string | undefined): [number, number, number] | undefined =>
      ref == null ? undefined : points.get(ref);

    expect(alignment.staStart).toBe(1000);
    expect(alignment.lines).toHaveLength(2);
    expect(alignment.curves).toHaveLength(1);

    // N-E order: [northing, easting, elevation].
    expect(coord(alignment.lines[0]?.from)).toEqual([0, 0, 0]);
    expect(coord(alignment.lines[0]?.to)).toEqual([0, 100, 0]);
    expect(coord(alignment.curves[0]?.from)).toEqual([0, 100, 0]);
    expect(coord(alignment.curves[0]?.to)).toEqual([50, 150, 0]);
    expect(alignment.curves[0]?.radius).toBe(50);
    expect(alignment.curves[0]?.rot).toBe('ccw');
    expect(coord(alignment.lines[1]?.from)).toEqual([50, 150, 0]);
    expect(coord(alignment.lines[1]?.to)).toEqual([50, 250, 0]);

    expect(alignment.equations).toEqual([{ staInternal: 1040, staAhead: 2000, staBack: 1050 }]);

    // Length oracle: two 100 m chords + one 90° arc of R=50.
    const arcChord = Math.hypot(150 - 100, 50 - 0);
    const sweep = 2 * Math.asin(arcChord / (2 * 50));
    const expected = 100 + 50 * sweep + 100;
    expect(cadAlignmentLength(entity)).toBeCloseTo(expected, 6);

    // Stations + STA PT rebuilt from the exported staStart/equations agree
    // with the source alignment at several stations including the equation.
    const roundtrip = {
      id: entity.id,
      elements: entity.elements,
      startStation: alignment.staStart as number,
      stationEquations: alignment.equations.map((equation) => ({
        backStation: equation.staBack as number,
        aheadStation: equation.staAhead,
        rawStation: equation.staInternal,
      })),
    };
    for (const raw of [1000, 1030, 1040, 1060, 1100]) {
      expect(cadAlignmentRawStationToDisplayStation(roundtrip, raw)).toBe(
        cadAlignmentRawStationToDisplayStation(entity, raw),
      );
    }
    expect(cadAlignmentEndStation(roundtrip)).toBeCloseTo(cadAlignmentEndStation(entity) as number, 9);
    expect(cadAlignmentRawStationToDisplayStation(roundtrip, 1040)).toBe(2000);
  });
});
