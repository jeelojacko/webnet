import { describe, expect, it } from 'vitest';

import { buildSurfaceGrid } from '../src/engine/cad/cadSurfaceInterpolation';
import { getAlignmentElements } from '../src/engine/cad/cadAlignmentElements';
import { computeCutFillArea } from '../src/engine/cad/sections/sectionArea';
import { resolveSampleFrame } from '../src/engine/cad/sections/sectionDirection';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import {
  buildSectionRawStations,
  resolveSampleRawStation,
  validateSampleRawStation,
} from '../src/engine/cad/sections/sectionStationing';
import { resolveTangentAtRawStation } from '../src/engine/cad/sections/sectionTangent';
import type { CadSurfaceSourcePoint } from '../src/engine/cad/cadSurfaces';
import type { CadAlignmentElement } from '../src/engine/cad/cadTypes';
import type { ProfileExtractionMesh } from '../src/engine/cad/profiles/profileExtraction';
import type { SectionResult } from '../src/engine/cad/sections/sectionTypes';

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

const eastbound = [line(0, 0, 100, 0)];

const sectionOn = (
  alignment: readonly CadAlignmentElement[],
  mesh: ProfileExtractionMesh,
  rawStation: number,
  leftWidth: number,
  rightWidth: number,
  skewDeg = 0,
): SectionResult => {
  const tangent = resolveTangentAtRawStation(alignment, 0, rawStation);
  if (!tangent.ok) throw new Error(`tangent failed: ${tangent.code}`);
  const frame = resolveSampleFrame(tangent.value.tangent, skewDeg);
  if (!frame.ok) throw new Error(`frame failed: ${frame.code}`);
  const extracted = extractSampleLine({
    mesh,
    center: tangent.value.point,
    direction: frame.value.d,
    leftWidth,
    rightWidth,
    rawStation,
  });
  if (!extracted.ok) throw new Error(`extract failed: ${extracted.code}`);
  return extracted.section;
};

describe('section tangent resolver', () => {
  it('eastbound line: T=(1,0), N=(0,1); +20 LEFT is north', () => {
    const tangent = resolveTangentAtRawStation(eastbound, 0, 40);
    expect(tangent.ok).toBe(true);
    if (!tangent.ok) return;
    expect(tangent.value.tangent.x).toBeCloseTo(1, 12);
    expect(tangent.value.tangent.y).toBeCloseTo(0, 12);
    expect(tangent.value.point).toEqual({ x: 40, y: 0 });
    const frame = resolveSampleFrame(tangent.value.tangent);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    expect(frame.value.n.x).toBeCloseTo(0, 12);
    expect(frame.value.n.y).toBeCloseTo(1, 12);
  });

  it('northbound line: +offset is west', () => {
    const alignment = [line(0, 0, 0, 100)];
    const tangent = resolveTangentAtRawStation(alignment, 0, 30);
    expect(tangent.ok).toBe(true);
    if (!tangent.ok) return;
    expect(tangent.value.tangent.y).toBeCloseTo(1, 12);
    const frame = resolveSampleFrame(tangent.value.tangent);
    expect(frame.ok).toBe(true);
    if (!frame.ok) return;
    // N = (-ty, tx) = (-1, 0): positive offset points west (negative x).
    expect(frame.value.n.x).toBeCloseTo(-1, 12);
    expect(frame.value.n.y).toBeCloseTo(0, 12);
  });

  it('arc tangent is exact and perpendicular to the radius', () => {
    const arc: CadAlignmentElement = {
      kind: 'arc',
      center: { x: 0, y: 0 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 90,
    };
    const rawMid = (Math.PI * 50) / 4; // 45 degrees along.
    const tangent = resolveTangentAtRawStation([arc], 0, rawMid);
    expect(tangent.ok).toBe(true);
    if (!tangent.ok) return;
    const radial = { x: tangent.value.point.x / 50, y: tangent.value.point.y / 50 };
    const dot = radial.x * tangent.value.tangent.x + radial.y * tangent.value.tangent.y;
    expect(dot).toBeCloseTo(0, 12);
    expect(Math.hypot(tangent.value.tangent.x, tangent.value.tangent.y)).toBeCloseTo(1, 12);
    expect(tangent.value.point.x).toBeCloseTo(50 * Math.SQRT1_2, 9);
    expect(tangent.value.point.y).toBeCloseTo(50 * Math.SQRT1_2, 9);
  });

  it('internal boundary uses AHEAD tangent; alignment end uses BACK tangent', () => {
    const alignment = [line(0, 0, 50, 0), line(50, 0, 50, 50)];
    const atCorner = resolveTangentAtRawStation(alignment, 0, 50);
    expect(atCorner.ok).toBe(true);
    if (!atCorner.ok) return;
    expect(atCorner.value.atBoundary).toBe('ahead');
    expect(atCorner.value.elementIndex).toBe(1);
    expect(atCorner.value.tangent.x).toBeCloseTo(0, 12);
    expect(atCorner.value.tangent.y).toBeCloseTo(1, 12);
    const atEnd = resolveTangentAtRawStation(alignment, 0, 100);
    expect(atEnd.ok).toBe(true);
    if (!atEnd.ok) return;
    expect(atEnd.value.atBoundary).toBe('back');
    expect(atEnd.value.elementIndex).toBe(1);
  });

  it('out-of-range raw station is fail-closed', () => {
    expect(resolveTangentAtRawStation(eastbound, 0, -0.5)).toEqual({
      ok: false,
      code: 'OUT_OF_RANGE',
    });
    expect(resolveTangentAtRawStation(eastbound, 0, 100.5)).toEqual({
      ok: false,
      code: 'OUT_OF_RANGE',
    });
    expect(resolveTangentAtRawStation([], 0, 0)).toEqual({ ok: false, code: 'EMPTY_ALIGNMENT' });
  });
});

describe('sample-line direction and widths', () => {
  it('skew matches the D = N*cos + T*sin oracle in both signs', () => {
    for (const skew of [30, -30, 45]) {
      const frame = resolveSampleFrame({ x: 1, y: 0 }, skew);
      expect(frame.ok).toBe(true);
      if (!frame.ok) continue;
      const rad = (skew * Math.PI) / 180;
      expect(frame.value.d.x).toBeCloseTo(Math.sin(rad), 12);
      expect(frame.value.d.y).toBeCloseTo(Math.cos(rad), 12);
    }
  });

  it('skew bound is fail-closed at |89|, never clamped', () => {
    expect(resolveSampleFrame({ x: 1, y: 0 }, 89).ok).toBe(false);
    expect(resolveSampleFrame({ x: 1, y: 0 }, -89).ok).toBe(false);
    expect(resolveSampleFrame({ x: 1, y: 0 }, 88.9).ok).toBe(true);
    expect(resolveSampleFrame({ x: 1, y: 0 }, Number.NaN).ok).toBe(false);
  });

  it('width validation: non-negative, at least one positive', () => {
    const mesh = flatMesh();
    const center = { x: 5, y: 5 };
    const direction = { x: 0, y: 1 };
    expect(extractSampleLine({ mesh, center, direction, leftWidth: 0, rightWidth: 0, rawStation: 0 }).ok).toBe(false);
    expect(extractSampleLine({ mesh, center, direction, leftWidth: -1, rightWidth: 5, rawStation: 0 }).ok).toBe(false);
    expect(
      extractSampleLine({ mesh, center, direction, leftWidth: 0, rightWidth: 5, rawStation: 0 }).ok,
    ).toBe(true);
  });
});

describe('section TIN extraction oracles', () => {
  it('flat TIN is constant with full coverage', () => {
    // One-sided section (leftWidth 10, rightWidth 0): domain 0..10, fully covered.
    const section = sectionOn(eastbound, flatMesh(), 5, 10, 0);
    expect(section.segments).toHaveLength(1);
    expect(section.coveredWidth).toBeCloseTo(10, 9);
    expect(section.gapWidth).toBeCloseTo(0, 9);
    for (const sample of section.segments[0]!.samples) {
      expect(sample.elevation).toBeCloseTo(5, 9);
    }
    expect(section.minElevation).toBeCloseTo(5, 9);
    expect(section.maxElevation).toBeCloseTo(5, 9);
    // Canonical domain ascending: -rightWidth..+leftWidth.
    const offsets = section.segments[0]!.samples.map((sample) => sample.offset);
    expect(offsets[0]).toBeCloseTo(0, 9);
    expect(offsets[offsets.length - 1]).toBeCloseTo(10, 9);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('planar z = 2x + 3y + 1 is linear in offset', () => {
    const mesh = meshOf(
      [pt('a', 0, 0, 1), pt('b', 10, 0, 21), pt('c', 10, 10, 51), pt('d', 0, 10, 31)],
      [[0, 1, 2], [0, 2, 3]],
    );
    // Eastbound at raw 5: center (5,0), D = north. z = 2*5 + 3*offset + 1.
    const section = sectionOn(eastbound, mesh, 5, 5, 5);
    for (const segment of section.segments) {
      for (const sample of segment.samples) {
        expect(sample.elevation).toBeCloseTo(11 + 3 * sample.offset, 9);
      }
    }
  });

  it('TIN edge/vertex/ridge crossings emit breaks without bridging', () => {
    // Ridge on diagonal x=y (z=y below, z=x above); eastbound section x=5
    // crosses it at (5,5): kink exact, continuous, no sawtooth.
    const mesh = meshOf(
      [pt('a', 0, 0, 0), pt('b', 10, 0, 0), pt('c', 10, 10, 10), pt('d', 0, 10, 0)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const section = sectionOn([line(0, 5, 10, 5)], mesh, 5, 7, 7);
    const samples = section.segments.flatMap((segment) => segment.samples);
    expect(section.diagnostics).toHaveLength(0);
    expect(samples.length).toBeGreaterThan(2);
    const kinds = new Set(samples.map((sample) => sample.eventKind).filter(Boolean));
    expect(kinds.has('edge-crossing') || kinds.has('vertex')).toBe(true);
    const crossing = samples.reduce((best, sample) =>
      Math.abs(sample.offset) < Math.abs(best.offset) ? sample : best,
    );
    expect(crossing.elevation).toBeCloseTo(5, 9);
    for (const sample of samples) {
      expect(Number.isFinite(sample.elevation)).toBe(true);
    }
  });

  it('voids split segments and are never bridged', () => {
    // Two disjoint quads with an x-gap in (4,6); line crosses the gap.
    const mesh = meshOf(
      [
        pt('a', 0, 0, 5), pt('b', 4, 0, 5), pt('c', 4, 10, 5), pt('d', 0, 10, 5),
        pt('e', 6, 0, 7), pt('f', 10, 0, 7), pt('g', 10, 10, 7), pt('h', 6, 10, 7),
      ],
      [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
    );
    // Northbound alignment: section runs along x at y=5, crossing the x-gap.
    // Center (0,5), D=west: offsets -10..0 map to x=10..0.
    const section = sectionOn([line(0, 0, 0, 10)], mesh, 5, 0, 10);
    expect(section.segments.length).toBeGreaterThanOrEqual(2);
    expect(section.gapWidth).toBeGreaterThan(1);
    expect(section.coveredWidth + section.gapWidth).toBeCloseTo(10, 6);
    // Segment domains are disjoint.
    const domains = section.segments.map((segment) => [
      segment.samples[0]!.offset,
      segment.samples[segment.samples.length - 1]!.offset,
    ]);
    for (let i = 0; i + 1 < domains.length; i += 1) {
      expect(domains[i]![1]).toBeLessThan(domains[i + 1]![0]);
    }
  });

  it('two topologies over one line stay independent', () => {
    const shifted = meshOf(
      [pt('a', 0, 0, 9), pt('b', 10, 0, 9), pt('c', 10, 10, 9), pt('d', 0, 10, 9)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const first = sectionOn(eastbound, flatMesh(), 5, 5, 5);
    const second = sectionOn(eastbound, shifted, 5, 5, 5);
    expect(first.minElevation).toBeCloseTo(5, 9);
    expect(second.minElevation).toBeCloseTo(9, 9);
  });

  it('shuffled triangle order is deterministic in elevations and offsets', () => {
    const points = [pt('a', 0, 0, 5), pt('b', 10, 0, 5), pt('c', 10, 10, 5), pt('d', 0, 10, 5)];
    const forward = sectionOn(eastbound, meshOf(points, [[0, 1, 2], [0, 2, 3]]), 5, 5, 5);
    const shuffled = sectionOn(eastbound, meshOf(points, [[0, 2, 3], [0, 1, 2]]), 5, 5, 5);
    const flat = (section: SectionResult): Array<[number, number]> =>
      section.segments.flatMap((segment) => segment.samples.map((s) => [s.offset, s.elevation] as [number, number]));
    expect(flat(shuffled)).toEqual(flat(forward));
  });

  it('large-coordinate translation preserves elevations', () => {
    const shift = (dx: number, dy: number): { alignment: CadAlignmentElement[]; mesh: ProfileExtractionMesh } => ({
      alignment: [line(dx, dy, dx + 10, dy)],
      mesh: meshOf(
        [pt('a', dx, dy, 5), pt('b', dx + 10, dy, 5), pt('c', dx + 10, dy + 10, 5), pt('d', dx, dy + 10, 5)],
        [[0, 1, 2], [0, 2, 3]],
      ),
    });
    const elevations = (section: SectionResult): number[] =>
      section.segments.flatMap((segment) => segment.samples.map((sample) => sample.elevation));
    const base = elevations(sectionOn(eastbound, flatMesh(), 5, 5, 5));
    for (const { alignment, mesh } of [shift(2e6, 0), shift(7e6, 0)]) {
      const moved = elevations(sectionOn(alignment, mesh, 5, 5, 5));
      expect(moved.length).toBe(base.length);
      for (let i = 0; i < base.length; i += 1) {
        expect(moved[i]).toBeCloseTo(base[i]!, 6);
      }
    }
  });
});

describe('cut/fill area oracles', () => {
  // Eastbound raw 5, widths 10/10: section runs x=5, y in [-10,+10].
  const lineSetup = { rawStation: 5, leftWidth: 10, rightWidth: 10 };
  const zeroBase = (): ProfileExtractionMesh =>
    meshOf(
      [pt('a', 0, -10, 0), pt('b', 10, -10, 0), pt('c', 10, 10, 0), pt('d', 0, 10, 0)],
      [[0, 1, 2], [0, 2, 3]],
    );
  const flatAt = (z: number): ProfileExtractionMesh =>
    meshOf(
      [pt('a', 0, -10, z), pt('b', 10, -10, z), pt('c', 10, 10, z), pt('d', 0, 10, z)],
      [[0, 1, 2], [0, 2, 3]],
    );

  it('constant +1 over width 20 gives fill 20, cut 0', () => {
    const base = sectionOn(eastbound, zeroBase(), lineSetup.rawStation, 10, 10);
    const comparison = sectionOn(eastbound, flatAt(1), lineSetup.rawStation, 10, 10);
    const area = computeCutFillArea(base, comparison);
    expect(area.fill).toBeCloseTo(20, 9);
    expect(area.cut).toBeCloseTo(0, 9);
    expect(area.net).toBeCloseTo(20, 9);
    expect(area.overlapWidth).toBeCloseTo(20, 9);
  });

  it('constant -1 over width 20 gives cut 20, fill 0', () => {
    const base = sectionOn(eastbound, zeroBase(), lineSetup.rawStation, 10, 10);
    const comparison = sectionOn(eastbound, flatAt(-1), lineSetup.rawStation, 10, 10);
    const area = computeCutFillArea(base, comparison);
    expect(area.cut).toBeCloseTo(20, 9);
    expect(area.fill).toBeCloseTo(0, 9);
    expect(area.net).toBeCloseTo(-20, 9);
  });

  it('crossing delta offset/10 splits into exact halves (5 fill, 5 cut)', () => {
    // Comparison plane z = y/10: delta(offset) = offset/10 over -10..+10.
    const comparison = meshOf(
      [pt('a', 0, -10, -1), pt('b', 10, -10, -1), pt('c', 10, 10, 1), pt('d', 0, 10, 1)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const base = sectionOn(eastbound, zeroBase(), lineSetup.rawStation, 10, 10);
    const comp = sectionOn(eastbound, comparison, lineSetup.rawStation, 10, 10);
    const area = computeCutFillArea(base, comp);
    expect(area.fill).toBeCloseTo(5, 9);
    expect(area.cut).toBeCloseTo(5, 9);
    expect(area.net).toBeCloseTo(0, 9);
  });

  it('interior zero crossing splits exactly (synthetic single-interval traces)', () => {
    const trace = (z0: number, z1: number): SectionResult => ({
      rawStation: 0,
      center: { x: 0, y: 0 },
      direction: { x: 0, y: 1 },
      leftWidth: 10,
      rightWidth: 10,
      segments: [
        {
          samples: [
            { offset: -10, x: 0, y: -10, elevation: z0 },
            { offset: 10, x: 0, y: 10, elevation: z1 },
          ],
        },
      ],
      minElevation: Math.min(z0, z1),
      maxElevation: Math.max(z0, z1),
      coveredWidth: 20,
      gapWidth: 0,
      diagnostics: [],
    });
    // Delta runs -1..+1 across one interval: zero at mid, halves exact.
    const area = computeCutFillArea(trace(0, 0), trace(-1, 1));
    expect(area.fill).toBeCloseTo(5, 9);
    expect(area.cut).toBeCloseTo(5, 9);
    expect(area.net).toBeCloseTo(0, 9);
    expect(area.overlapWidth).toBeCloseTo(20, 9);
  });

  it('same plane with different triangulation gives zero area', () => {
    const points = [pt('a', 0, -10, 4), pt('b', 10, -10, 14), pt('c', 10, 10, 24), pt('d', 0, 10, 14)];
    const base = sectionOn(eastbound, meshOf(points, [[0, 1, 2], [0, 2, 3]]), 5, 10, 10);
    const comp = sectionOn(eastbound, meshOf(points, [[0, 1, 3], [1, 2, 3]]), 5, 10, 10);
    const area = computeCutFillArea(base, comp);
    expect(area.fill).toBeCloseTo(0, 9);
    expect(area.cut).toBeCloseTo(0, 9);
    expect(area.overlapWidth).toBeCloseTo(20, 6);
  });

  it('partial overlap restricts area to common coverage', () => {
    const base = sectionOn(eastbound, zeroBase(), lineSetup.rawStation, 10, 10);
    // Comparison covers y in [-10, 0] only (offsets -10..0).
    const partial = meshOf(
      [pt('a', 0, -10, 1), pt('b', 10, -10, 1), pt('c', 10, 0, 1), pt('d', 0, 0, 1)],
      [[0, 1, 2], [0, 2, 3]],
    );
    const comp = sectionOn(eastbound, partial, lineSetup.rawStation, 10, 10);
    const area = computeCutFillArea(base, comp);
    expect(area.fill).toBeCloseTo(10, 6);
    expect(area.cut).toBeCloseTo(0, 6);
    expect(area.overlapWidth).toBeCloseTo(10, 6);
  });

  it('void intervals contribute zero area', () => {
    const base = sectionOn(eastbound, zeroBase(), lineSetup.rawStation, 10, 10);
    // Comparison with a void over y in (-2, 2): delta +1 elsewhere.
    const gappy = meshOf(
      [
        pt('a', 0, -10, 1), pt('b', 10, -10, 1), pt('c', 10, -2, 1), pt('d', 0, -2, 1),
        pt('e', 0, 2, 1), pt('f', 10, 2, 1), pt('g', 10, 10, 1), pt('h', 0, 10, 1),
      ],
      [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]],
    );
    const comp = sectionOn(eastbound, gappy, lineSetup.rawStation, 10, 10);
    expect(comp.gapWidth).toBeGreaterThan(3);
    const area = computeCutFillArea(base, comp);
    expect(area.fill).toBeCloseTo(16, 6);
    expect(area.cut).toBeCloseTo(0, 6);
    expect(area.overlapWidth).toBeCloseTo(16, 6);
  });
});

describe('section stationing', () => {
  const equationAlignment = {
    elements: eastbound,
    startStation: 0,
    stationEquations: [{ backStation: 60, aheadStation: 70 }],
  };

  it('display input resolves to raw; equation gap is OUT_OF_RANGE', () => {
    expect(resolveSampleRawStation(equationAlignment, 30)).toEqual({ ok: true, rawStation: 30 });
    // Exactly at the equation: ahead label resolves to the equation raw station.
    expect(resolveSampleRawStation(equationAlignment, 70)).toEqual({ ok: true, rawStation: 60 });
    // Inside the (back, ahead) gap: fail-closed.
    expect(resolveSampleRawStation(equationAlignment, 65)).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
    expect(resolveSampleRawStation(equationAlignment, 500)).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
  });

  it('station equations change labels, not XY geometry', () => {
    const elements = getAlignmentElements(equationAlignment);
    const tangent = resolveTangentAtRawStation(elements, 0, 60);
    expect(tangent.ok).toBe(true);
    if (!tangent.ok) return;
    // Same XY as the equation-free alignment at raw 60.
    const plain = resolveTangentAtRawStation(eastbound, 0, 60);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(tangent.value.point).toEqual(plain.value.point);
  });

  it('raw range validation is fail-closed with no clamp', () => {
    expect(validateSampleRawStation(equationAlignment, 100)).toEqual({ ok: true, rawStation: 100 });
    expect(validateSampleRawStation(equationAlignment, 100.5)).toEqual({
      ok: false,
      code: 'OUT_OF_RANGE',
    });
    expect(validateSampleRawStation(equationAlignment, Number.NaN)).toEqual({
      ok: false,
      code: 'OUT_OF_RANGE',
    });
  });

  it('interval generation steps physical raw chainage with STA INT semantics', () => {
    expect(buildSectionRawStations(0, 100, { interval: 25 })).toEqual([0, 25, 50, 75, 100]);
    expect(buildSectionRawStations(0, 100, { interval: 30 })).toEqual([0, 30, 60, 90, 100]);
    expect(buildSectionRawStations(0, 100, { interval: 25, includeStart: false })).toEqual([
      25, 50, 75, 100,
    ]);
    expect(buildSectionRawStations(0, 100, { interval: 25, includeEnd: false })).toEqual([
      0, 25, 50, 75,
    ]);
    expect(buildSectionRawStations(0, 100, { interval: 0 })).toEqual([]);
  });
});
