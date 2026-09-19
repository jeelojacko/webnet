import { describe, expect, it } from 'vitest';

import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildProfileViewDisplayLayers } from '../src/engine/cad/cadProfileView';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { createCadProfileCache } from '../src/engine/cad/profileCache';
import type { CadSurfaceSourcePoint } from '../src/engine/cad/cadSurfaces';
import type { CadAlignmentElement, CadProject } from '../src/engine/cad/cadTypes';
import {
  PROFILE_ARC_VERTICAL_TOLERANCE,
  extractSurfaceProfile,
  type ProfileExtractionMesh,
} from '../src/engine/cad/profiles/profileExtraction';
import { queryProfileElevationAt } from '../src/engine/cad/profiles/profileInquiry';
import { profileStats } from '../src/engine/cad/profiles/profileStats';

const pt = (entityId: string, x: number, y: number, z: number): CadSurfaceSourcePoint => ({
  entityId,
  x,
  y,
  z,
});

const meshOf = (
  points: CadSurfaceSourcePoint[],
  triangles: Array<[number, number, number]>,
): ProfileExtractionMesh => ({
  points: points.map((p) => ({ ...p })),
  triangles: triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
  grid: buildSurfaceGrid(points, triangles),
});

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

/** Flat unit quad z=5 over [0,10]x[0,10]. */
const flatMesh = (): ProfileExtractionMesh =>
  meshOf(
    [pt('a', 0, 0, 5), pt('b', 10, 0, 5), pt('c', 10, 10, 5), pt('d', 0, 10, 5)],
    [[0, 1, 2], [0, 2, 3]],
  );

describe('profile extraction oracles', () => {
  it('flat plane is exact: single segment, constant elevation', () => {
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh: flatMesh(),
    });
    expect(result.segments).toHaveLength(1);
    expect(result.coveredLength).toBeCloseTo(10, 9);
    expect(result.gapLength).toBeCloseTo(0, 9);
    for (const sample of result.segments[0]!.samples) {
      expect(sample.elevation).toBeCloseTo(5, 9);
      expect(Number.isNaN(sample.elevation)).toBe(false);
    }
    expect(result.minElevation).toBeCloseTo(5, 9);
    expect(result.maxElevation).toBeCloseTo(5, 9);
  });

  it('planar slope z=2x+3y+1 is linear in chainage', () => {
    const mesh = meshOf(
      [pt('a', 0, 0, 1), pt('b', 10, 0, 21), pt('c', 10, 10, 51), pt('d', 0, 10, 31)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 0, 10, 0)],
      startStation: 0,
      mesh,
    });
    expect(result.segments).toHaveLength(1);
    for (const sample of result.segments[0]!.samples) {
      expect(sample.elevation).toBeCloseTo(2 * sample.rawChainage + 1, 9);
    }
  });

  it('ridge breakline: kink exact, continuous, no sawtooth', () => {
    // plane1 z=y (x<=y side), plane2 z=x — agree on diagonal x=y, kink across it.
    const mesh = meshOf(
      [pt('a', 0, 0, 0), pt('b', 10, 0, 0), pt('c', 10, 10, 10), pt('d', 0, 10, 0)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 10, 10, 0)],
      startStation: 0,
      mesh,
    });
    const samples = result.segments.flatMap((segment) => segment.samples);
    expect(result.diagnostics).toHaveLength(0);
    // Crossing at (5,5) raw=sqrt(50): both planes give 5.
    const crossing = samples.reduce((best, sample) =>
      Math.abs(sample.rawChainage - Math.SQRT2 * 5) < Math.abs(best.rawChainage - Math.SQRT2 * 5)
        ? sample
        : best,
    );
    expect(crossing.elevation).toBeCloseTo(5, 9);
    for (const sample of samples) {
      expect(Number.isFinite(sample.elevation)).toBe(true);
    }
  });

  it('plane disagreement marks a break, never a sawtooth', () => {
    // Non-conforming pair: planes disagree along the shared edge.
    const mesh = meshOf(
      [pt('a', 0, 0, 0), pt('b', 10, 0, 0), pt('c', 10, 10, 0), pt('d', 0, 0, 5), pt('e', 0, 10, 0)],
      [[0, 1, 2], [3, 2, 4]],
    );
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 10, 10, 0)],
      startStation: 0,
      mesh,
    });
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    const kinds = result.segments.flatMap((segment) =>
      segment.samples.map((sample) => sample.eventKind),
    );
    expect(kinds).toContain('plane-break');
  });

  it('void gap yields two segments plus a gap, never bridged', () => {
    const mesh = meshOf(
      [
        pt('a', 0, 0, 5), pt('b', 4, 0, 5), pt('c', 4, 4, 5), pt('d', 0, 4, 5),
        pt('e', 6, 0, 7), pt('f', 10, 0, 7), pt('g', 10, 4, 7), pt('h', 6, 4, 7),
      ],
      [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
    );
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 2, 10, 2)],
      startStation: 0,
      mesh,
    });
    expect(result.segments).toHaveLength(2);
    expect(result.coveredLength).toBeCloseTo(8, 9);
    expect(result.gapLength).toBeCloseTo(2, 9);
    expect(result.segments[0]!.samples.at(-1)!.elevation).toBeCloseTo(5, 9);
    expect(result.segments[1]!.samples[0]!.elevation).toBeCloseTo(7, 9);
    const kinds = result.segments.flatMap((segment) =>
      segment.samples.map((sample) => sample.eventKind),
    );
    expect(kinds).toContain('void-exit');
    expect(kinds).toContain('void-entry');
  });

  it('exact vertex crossing emits one canonical event, no NaN', () => {
    const mesh = meshOf(
      [
        pt('a', 0, 0, 5), pt('b', 10, 0, 5), pt('c', 10, 10, 5), pt('d', 0, 10, 5),
        pt('e', 5, 5, 5),
      ],
      [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
    );
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh,
    });
    expect(result.segments).toHaveLength(1);
    const atCenter = result.segments[0]!.samples.filter(
      (sample) => Math.abs(sample.rawChainage - 5) <= 1e-9 * 5,
    );
    expect(atCenter).toHaveLength(1);
    expect(atCenter[0]!.eventKind).toBe('vertex');
    for (const sample of result.segments[0]!.samples) {
      expect(Number.isNaN(sample.elevation)).toBe(false);
    }
  });

  it('along-edge travel stays continuous when planes agree', () => {
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 0, 10, 10)],
      startStation: 0,
      mesh: flatMesh(),
    });
    expect(result.segments).toHaveLength(1);
    expect(result.coveredLength).toBeCloseTo(Math.SQRT2 * 10, 9);
    expect(result.diagnostics).toHaveLength(0);
    for (const sample of result.segments[0]!.samples) {
      expect(sample.elevation).toBeCloseTo(5, 9);
    }
  });

  it('arc over a plane keeps chord error within tolerance', () => {
    const mesh = meshOf(
      [pt('a', -10, -10, 11), pt('b', 30, -10, 91), pt('c', 30, 30, 211), pt('d', -10, 30, 131)],
      [[0, 1, 2], [0, 2, 3]],
    );
    // z = 2x+3y+61 across the whole quad.
    const arc: CadAlignmentElement = {
      kind: 'arc',
      center: { x: 10, y: 10 },
      radius: 10,
      startAngleDeg: 180,
      endAngleDeg: 360,
    };
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [arc],
      startStation: 0,
      mesh,
    });
    expect(result.segments).toHaveLength(1);
    const samples = result.segments[0]!.samples;
    expect(samples.length).toBeGreaterThan(2);
    expect(samples.length).toBeLessThan(2000);
    let maxError = 0;
    for (let index = 0; index + 1 < samples.length; index += 1) {
      const a = samples[index]!;
      const b = samples[index + 1]!;
      const midRaw = (a.rawChainage + b.rawChainage) / 2;
      const answer = queryProfileElevationAt(
        { alignmentElements: [arc], startStation: 0, mesh },
        midRaw,
      );
      if (!('gap' in answer)) {
        const lerp = (a.elevation + b.elevation) / 2;
        maxError = Math.max(maxError, Math.abs(answer.elevation - lerp));
      }
    }
    expect(maxError).toBeLessThanOrEqual(PROFILE_ARC_VERTICAL_TOLERANCE);
  });

  it('station equation: geometry continuous, display jumps, raw positions kept', () => {
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 0, 10, 0)],
      startStation: 0,
      stationEquations: [{ backStation: 6, aheadStation: 56, rawStation: 5 }],
      mesh: flatMesh(),
    });
    const samples = result.segments.flatMap((segment) => segment.samples);
    // Geometry is a pure function of raw chainage.
    for (const sample of samples) {
      expect(sample.x).toBeCloseTo(sample.rawChainage, 9);
      expect(sample.displayStation).not.toBeNull();
    }
    const before = samples.filter((sample) => sample.rawChainage < 5).at(-1)!;
    const after = samples.filter((sample) => sample.rawChainage > 5)[0]!;
    expect(before.displayStation!).toBeCloseTo(before.rawChainage, 9);
    expect(after.displayStation!).toBeCloseTo(after.rawChainage + 50, 9);
    expect(after.displayStation! - before.displayStation!).toBeGreaterThan(40);
  });

  it('startStation offsets raw chainage', () => {
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 1000,
      mesh: flatMesh(),
    });
    expect(result.rawStartStation).toBeCloseTo(1000, 9);
    expect(result.rawEndStation).toBeCloseTo(1010, 9);
    for (const sample of result.segments[0]!.samples) {
      expect(sample.displayStation).toBeCloseTo(sample.rawChainage, 9);
    }
  });

  it('+2M/+7M translation is equivalent', () => {
    const dx = 2_000_000;
    const dy = 7_000_000;
    const movedPoints = [pt('a', 0, 0, 5), pt('b', 10, 0, 5), pt('c', 10, 10, 5), pt('d', 0, 10, 5)].map(
      (p) => ({ ...p, x: p.x + dx, y: p.y + dy }),
    );
    const moved = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(dx, 5 + dy, 10 + dx, 5 + dy)],
      startStation: 0,
      mesh: meshOf(movedPoints, [[0, 1, 2], [0, 2, 3]]),
    });
    const base = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh: flatMesh(),
    });
    const movedSamples = moved.segments.flatMap((segment) => segment.samples);
    const baseSamples = base.segments.flatMap((segment) => segment.samples);
    expect(movedSamples).toHaveLength(baseSamples.length);
    movedSamples.forEach((sample, index) => {
      expect(sample.rawChainage).toBe(baseSamples[index]!.rawChainage);
      expect(sample.elevation).toBe(baseSamples[index]!.elevation);
    });
  });

  it('shuffled triangle order gives equivalent samples', () => {
    const points = [pt('a', 0, 0, 5), pt('b', 10, 0, 5), pt('c', 10, 10, 5), pt('d', 0, 10, 5)];
    const forward = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh: meshOf(points, [[0, 1, 2], [0, 2, 3]]),
    });
    const shuffled = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh: meshOf(points, [[0, 2, 3], [0, 1, 2]]),
    });
    const strip = (samples: { rawChainage: number; elevation: number }[]): Array<[number, number]> =>
      samples.map((sample) => [sample.rawChainage, sample.elevation]);
    expect(strip(shuffled.segments.flatMap((segment) => segment.samples))).toEqual(
      strip(forward.segments.flatMap((segment) => segment.samples)),
    );
  });

  it('line-to-arc joints stay continuous', () => {
    const arc: CadAlignmentElement = {
      kind: 'arc',
      center: { x: 10, y: 10 },
      radius: 10,
      startAngleDeg: -90,
      endAngleDeg: 0,
    };
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 0, 10, 0), arc],
      startStation: 0,
      mesh: meshOf(
        [pt('a', -5, -5, 5), pt('b', 25, -5, 5), pt('c', 25, 25, 5), pt('d', -5, 25, 5)],
        [[0, 1, 2], [0, 2, 3]],
      ),
    });
    expect(result.segments).toHaveLength(1);
    const samples = result.segments[0]!.samples;
    const joint = 10;
    const before = samples.filter((sample) => sample.rawChainage <= joint).at(-1)!;
    const after = samples.filter((sample) => sample.rawChainage >= joint)[0]!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1.5);
    expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(1e-6);
  });

  it('inquiry answers elevation or honest gaps; stats derive from results', () => {
    const mesh = flatMesh();
    const query = { alignmentElements: [line(0, 5, 10, 5)], startStation: 0, mesh };
    const hit = queryProfileElevationAt(query, 4);
    expect(hit).toEqual({ x: 4, y: 5, elevation: 5 });
    expect(queryProfileElevationAt(query, 40)).toEqual({ gap: true });
    const result = extractSurfaceProfile({
      profileId: 'p1',
      revision: 'prev1:test',
      alignmentElements: [line(0, 5, 10, 5)],
      startStation: 0,
      mesh,
    });
    const stats = profileStats(result);
    expect(stats.coveredLength).toBeCloseTo(10, 9);
    expect(stats.gapLength).toBeCloseTo(0, 9);
    expect(stats.minElevation).toBeCloseTo(5, 9);
    expect(stats.maxElevation).toBeCloseTo(5, 9);
    expect(stats.startElevation).toBeCloseTo(5, 9);
    expect(stats.endElevation).toBeCloseTo(5, 9);
    expect(stats.segmentCount).toBe(1);
    expect(stats.sampleCount).toBeGreaterThan(0);
  });
});

describe('profile view display', () => {
  const viewProject = (): CadProject => {
    const drawing = createBlankCadDrawingDocument({ name: 'Profiles', units: 'm' });
    const layerId = drawing.project.layers[0]?.id ?? 'general';
    const survey = (id: string, stationId: string, x: number, y: number, z: number) => ({
      id,
      type: 'survey-point' as const,
      layerId,
      visible: true,
      locked: false,
      stationId,
      x,
      y,
      z,
      pointClass: 'free' as const,
      source: 'parsed-input' as const,
    });
    return {
      ...drawing.project,
      entities: [
        survey('a', 'A', 0, 0, 5),
        survey('b', 'B', 10, 0, 5),
        survey('c', 'C', 10, 10, 5),
        survey('d', 'D', 0, 10, 5),
        {
          id: 'align-1',
          type: 'alignment',
          layerId,
          visible: true,
          locked: false,
          name: 'Main',
          elements: [{ kind: 'line', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }],
          startStation: 0,
          stationEquations: [{ backStation: 6, aheadStation: 56, rawStation: 5 }],
        },
      ],
      surfaces: [
        {
          id: 'surf-1',
          name: 'Ground',
          definition: { pointSource: { kind: 'points', pointEntityIds: ['a', 'b', 'c', 'd'] } },
          cachedRevision: null,
        },
      ],
      surfaceProfiles: [
        { id: 'prof-1', name: 'Main', alignmentEntityId: 'align-1', surfaceId: 'surf-1' },
      ],
      profileViews: [
        {
          id: 'view-1',
          name: 'Sheet',
          alignmentEntityId: 'align-1',
          profileIds: ['prof-1'],
          insertionX: 100,
          insertionY: 200,
          horizontalScale: 1,
          verticalExaggeration: 5,
          datumMode: 'auto',
        },
      ],
    };
  };

  it('places profile paths, auto datum, and equation markers', () => {
    const project = viewProject();
    const surface = project.surfaces![0]!;
    const profile = project.surfaceProfiles![0]!;
    const alignment = project.entities.find((entity) => entity.id === 'align-1')!;
    if (alignment.type !== 'alignment') throw new Error('alignment fixture broke');
    const surfaceRev = computeCadSurfaceSourceRevision(project, surface);
    const revision = computeSurfaceProfileRevision(profile, alignment, surfaceRev);
    const mesh = meshOf(
      [
        pt('a', 0, 0, 5),
        pt('b', 10, 0, 5),
        pt('c', 10, 10, 5),
        pt('d', 0, 10, 5),
      ],
      [[0, 1, 2], [0, 2, 3]],
    );
    const cache = createCadProfileCache('scope-view');
    cache.set(
      'prof-1',
      extractSurfaceProfile({
        profileId: 'prof-1',
        revision,
        alignmentElements: alignment.elements,
        startStation: alignment.startStation,
        stationEquations: alignment.stationEquations,
        mesh,
      }),
    );
    const layers = buildProfileViewDisplayLayers(project, cache);
    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.datumElevation).toBe(5);
    expect(layer.profilePaths).toHaveLength(1);
    expect(layer.profilePaths[0]!.d.length).toBeGreaterThan(0);
    // Equation marker at the raw position with BK/AH labels.
    expect(layer.equationMarkers).toHaveLength(1);
    expect(layer.equationMarkers[0]!.rawChainage).toBeCloseTo(5, 9);
    expect(layer.equationMarkers[0]!.x).toBeCloseTo(105, 9);
    expect(layer.equationMarkers[0]!.backLabel).toContain('BK');
    expect(layer.equationMarkers[0]!.aheadLabel).toContain('AH');
    expect(layer.labelsTruncated).toBe(false);
    expect(layer.bounds).not.toBeNull();
  });

  it('renders nothing without a cached result', () => {
    const project = viewProject();
    expect(buildProfileViewDisplayLayers(project, createCadProfileCache('empty'))).toEqual([]);
    expect(buildProfileViewDisplayLayers(project, null)).toEqual([]);
  });
});
