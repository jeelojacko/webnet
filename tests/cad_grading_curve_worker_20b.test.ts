/**
 * Phase 20B Gate-10: curved sources subdivide in the PRODUCTION worker path.
 *
 * §90 quarter-circle through computeGradingFromSnapshots: every stitched
 * source node on the true arc with exact station Z, sagitta within
 * tolerance, CURVE_APPROXIMATED. §91 convergence across a 10× tolerance
 * ladder vs the finest run, plus a pin that tolerance changes subdivision.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { featureLineArcSubdivisions } from '../src/engine/cad/cadSurfaceRevision';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type { CadGradingResult } from '../src/engine/cad/grading/gradingTypes';

// Quarter circle R=50: (50,0) -> (0,50), center (0,0), CCW sweep 90°.
const R = 50;
const CENTER = { x: 0, y: 0 };
const ARC_BULGE = Math.tan(Math.PI / 8);

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20b-curve${seq}`;
};

const makeArcFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    { id: `feature-vertex:${id}:a`, x: 50, y: 0, z: 10 },
    { id: `feature-vertex:${id}:b`, x: 0, y: 50, z: 10 },
  ],
  segmentGeometry: [{ kind: 'arc', bulge: ARC_BULGE }],
});

const makeFlatTarget = (id: string): CadSurface => ({
  id,
  name: 'Target',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const world = (tolerance: number): { project: CadProject; gradingId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Grading Curve', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeArcFeatureLine(flId)],
    surfaces: [makeFlatTarget(targetId)],
  };
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  const withGrading = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'G-curve',
    sourceFeatureLineId: flId,
    vertexAId: entity.vertices[0]!.id,
    vertexBId: entity.vertices[1]!.id,
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: tolerance,
  }).present.project;
  return { project: withGrading, gradingId: withGrading.gradings![0]!.id, targetId };
};

const runCurve = (tolerance: number): CadGradingResult => {
  const { project, gradingId, targetId } = world(tolerance);
  const inputs = resolveGradingInputs(project, gradingId);
  expect(inputs).not.toBeNull();
  // Production path carries the arc circle params (Gate-10 wiring proof).
  expect(inputs!.resolvedSource.isArc).toBe(true);
  expect(inputs!.resolvedSource.arc).toBeDefined();
  expect(inputs!.resolvedSource.arc!.centerX).toBeCloseTo(0, 6);
  expect(inputs!.resolvedSource.arc!.centerY).toBeCloseTo(0, 6);
  expect(inputs!.resolvedSource.arc!.radius).toBeCloseTo(R, 6);
  expect(inputs!.resolvedSource.arc!.sweepCCW).toBe(true);
  const target = project.surfaces!.find((entry) => entry.id === targetId)!;
  const built = buildCadSurface(project, target);
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const outcome = computeGradingFromSnapshots({
    gradingId,
    revision: inputs!.revision,
    source: inputs!.resolvedSource,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: tolerance,
    target: {
      points: built.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`curve compute failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

/** Mesh vertices split cleanly: source rides z=10, daylight rides z=0. */
const splitMesh = (result: CadGradingResult): { source: number[][]; daylight: number[][] } => {
  const source: number[][] = [];
  const daylight: number[][] = [];
  for (let i = 0; i + 2 < result.gradingMesh.points.length; i += 3) {
    const v = [result.gradingMesh.points[i]!, result.gradingMesh.points[i + 1]!, result.gradingMesh.points[i + 2]!];
    if (Math.abs(v[2]! - 10) < 1e-9) source.push(v);
    else if (Math.abs(v[2]!) < 1e-9) daylight.push(v);
    else throw new Error(`stray mesh vertex z=${v[2]}`);
  }
  return { source, daylight };
};

/** Max plan-distance from daylight nodes to the reference polyline segments. */
const daylightDeviation = (result: CadGradingResult, reference: CadGradingResult): number => {
  const ref: Array<[number, number]> = [];
  for (let i = 0; i + 2 < reference.daylightPoints.length; i += 3) {
    ref.push([reference.daylightPoints[i]!, reference.daylightPoints[i + 1]!]);
  }
  const segDist = (px: number, py: number): number => {
    let best = Infinity;
    for (let i = 0; i + 1 < ref.length; i += 1) {
      const [ax, ay] = ref[i]!;
      const [bx, by] = ref[i + 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
    }
    return best;
  };
  let worst = 0;
  for (let i = 0; i + 2 < result.daylightPoints.length; i += 3) {
    worst = Math.max(worst, segDist(result.daylightPoints[i]!, result.daylightPoints[i + 1]!));
  }
  return worst;
};

describe('grading curve worker path (Gate-10)', () => {
  it('§90 quarter-circle subdivides: arc-exact source, sagitta-bound, CURVE_APPROXIMATED', () => {
    const tolerance = 0.05;
    const result = runCurve(tolerance);
    expect(result.accuracy).toBe('CURVE_APPROXIMATED');
    // Subdivision count is the sagitta policy count at this tolerance.
    const expected = featureLineArcSubdivisions(R, Math.PI / 2, tolerance);
    expect(result.regions.length).toBe(expected);
    // Arc length 25π rides the result, not the chord.
    expect(result.sourceLength).toBeCloseTo(25 * Math.PI, 9);
    const { source, daylight } = splitMesh(result);
    expect(source.length).toBeGreaterThanOrEqual(expected + 1);
    expect(daylight.length).toBeGreaterThan(0);
    // Every stitched source node on the true arc, station Z exact.
    // Phase 20K.1 Wave C2 old→new: OVERLAP internal seams trim chord tips
    // to the miter line; the inserted crossings' source mates ride the
    // chord (linear strip model, exact), off the arc by at most the chord
    // sagitta. Joint samples stay arc-exact; the bound below pins the
    // linearization tolerance instead of the old endpoint-only identity.
    for (const v of source) {
      expect(Math.abs(Math.hypot(v[0]! - CENTER.x, v[1]! - CENTER.y) - R)).toBeLessThanOrEqual(tolerance * (1 + 1e-9));
      expect(v[2]).toBe(10);
    }
    // Sagitta of every stitched chord within tolerance.
    const ordered = [...source].sort((a, b) => Math.atan2(a[1]!, a[0]!) - Math.atan2(b[1]!, b[0]!));
    let worstSagitta = 0;
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const c = Math.hypot(ordered[i + 1]![0]! - ordered[i]![0]!, ordered[i + 1]![1]! - ordered[i]![1]!);
      if (c < 1e-12) continue; // ulp-duplicate joint vertices share the arc point
      const sagitta = R - Math.sqrt(R * R - (c / 2) * (c / 2));
      worstSagitta = Math.max(worstSagitta, sagitta);
      expect(sagitta).toBeLessThanOrEqual(tolerance * (1 + 1e-9));
    }
    expect(worstSagitta).toBeGreaterThan(0);
    // Flat target, −50% fill: chord offsets land exactly 20 m out at z=0.
    // Phase 20K.1 Wave C2 old→new: OVERLAP internal seams resolve to the
    // miter tie, whose extent exceeds the perpendicular by 1/cos(half the
    // joint turn) — 18 joints over 90° ⇒ 20/cos(2.5°) ≈ 20.0190537033.
    // The naive stitch never recorded ties, so max read exactly 20.
    expect(result.minProjectionDistance).toBeCloseTo(20, 9);
    expect(result.maxProjectionDistance * Math.cos(Math.PI / 72)).toBeCloseTo(20, 9);
    expect(result.meanProjectionDistance).toBeGreaterThanOrEqual(20);
    expect(result.meanProjectionDistance).toBeLessThanOrEqual(result.maxProjectionDistance);
    // Phase 20K.1 Wave C2 old→new: internal miter ties carry the plane
    // evaluation residual (~1e-16) instead of the chord solve's exact 0.
    // Geometry is unchanged (agreement-gated); only the identity weakens.
    for (const v of daylight) expect(v[2]).toBeCloseTo(0, 9);
    for (let i = 0; i + 2 < result.daylightPoints.length; i += 3) {
      expect(result.daylightPoints[i + 2]).toBeCloseTo(0, 9);
    }
  });

  it('§91 10× finer tolerance converges: subdivision grows, sagitta shrinks', () => {
    const ladder = [0.5, 0.05, 0.005];
    const results = ladder.map(runCurve);
    const counts = results.map((result) => result.regions.length);
    // Tolerance pin: coarse and fine runs subdivide differently.
    expect(counts[2]).toBeGreaterThan(counts[0]);
    expect(counts[1]).toBeGreaterThanOrEqual(counts[0]);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
    for (const [index, tolerance] of ladder.entries()) {
      expect(counts[index]).toBe(featureLineArcSubdivisions(R, Math.PI / 2, tolerance));
      expect(results[index]!.accuracy).toBe('CURVE_APPROXIMATED');
    }
    // Sagitta shrinks along the ladder.
    const worstSagitta = results.map((result) => {
      const { source } = splitMesh(result);
      const ordered = [...source].sort((a, b) => Math.atan2(a[1]!, a[0]!) - Math.atan2(b[1]!, b[0]!));
      let worst = 0;
      for (let i = 0; i + 1 < ordered.length; i += 1) {
        const c = Math.hypot(ordered[i + 1]![0]! - ordered[i]![0]!, ordered[i + 1]![1]! - ordered[i]![1]!);
        if (c < 1e-12) continue;
        worst = Math.max(worst, R - Math.sqrt(R * R - (c / 2) * (c / 2)));
      }
      return worst;
    });
    expect(worstSagitta[0]).toBeLessThanOrEqual(ladder[0]! * (1 + 1e-9));
    expect(worstSagitta[2]).toBeLessThanOrEqual(ladder[2]! * (1 + 1e-9));
    expect(worstSagitta[2]!).toBeLessThan(worstSagitta[0]!);
    // Daylight converges to the finest run, monotone along the ladder.
    // Per-chord ties carry a tangential bias ~ tie-distance x segment
    // angle, so convergence is linear in tolerance (not absolute): the
    // 10x step cuts the deviation ~10x (theory ratio ~0.25, margin 0.6).
    const finest = results[2]!;
    const dev0 = daylightDeviation(results[0]!, finest);
    const dev1 = daylightDeviation(results[1]!, finest);
    expect(dev1).toBeLessThanOrEqual(dev0);
    expect(dev1).toBeLessThan(dev0 * 0.6);
    expect(dev1).toBeLessThan(1);
  });

  it('save/reopen recalculates byte-identical curve geometry', () => {
    const tolerance = 0.05;
    const { project, gradingId, targetId } = world(tolerance);
    const inputs = resolveGradingInputs(project, gradingId)!;
    const before = runCurve(tolerance);
    const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    const again = resolveGradingInputs(reopened, gradingId)!;
    expect(again.revision).toBe(inputs.revision);
    expect(again.resolvedSource.arc).toEqual(inputs.resolvedSource.arc);
    const target = reopened.surfaces!.find((entry) => entry.id === targetId)!;
    const built = buildCadSurface(reopened, target);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') return;
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: again.revision,
      source: again.resolvedSource,
      side: again.grading.side,
      criterion: again.grading.criterion,
      maxSearchDistance: again.grading.maxSearchDistance,
      curveChordTolerance: again.grading.curveChordTolerance,
      target: {
        points: built.points.flatMap((p) => [p.x, p.y, p.z]),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    if (!outcome.ok) throw new Error('reopen compute failed');
    expect(outcome.result.daylightPoints).toEqual(before.daylightPoints);
    expect(outcome.result.gradingMesh).toEqual(before.gradingMesh);
  });
});
