/**
 * Phase 20C Wave-1A — exact straight-chord grading solve.
 *
 * Moved verbatim from `src/workers/surfaceGradingCompute.ts` (zero numerical
 * change): the long chord solve is only reorganized into small helpers that
 * move contiguous statement blocks unchanged. Pure numeric pipeline, no
 * CadProject, no React. Both the surface worker handler and the in-process
 * fallback/tests run through here.
 */
import {
  gradingSideNormal,
  toLocalFrame,
  fromLocalFrame,
  type PlanVector,
} from './gradingCourseFrame';
import { classifySourceDelta, requireSourceCoverage, splitStationsAtZeros } from './gradingCutFill';
import { gradeElevation } from './gradingStraightSolve';
import { candidateTriangles } from './gradingTargetIndex';
import {
  solveStationSpans,
  type ChordSpan,
  type SourcePointFn,
} from './gradingSpanSolve';
import { zeroDelta } from '../surfaces/volume/zero';
import type {
  GradingCriterion,
  GradingDiagnostic,
  GradingDiagnosticCode,
  GradingResultRegion,
  GradingSide,
} from './gradingTypes';
import type {
  GradingComputeSource,
  GradingTargetMeshSnapshot,
  TargetQuery,
} from './gradingComputeTypes';

export const finiteSource = (source: GradingComputeSource): boolean =>
  Number.isFinite(source.startX) &&
  Number.isFinite(source.startY) &&
  Number.isFinite(source.endX) &&
  Number.isFinite(source.endY) &&
  Number.isFinite(source.startZ) &&
  Number.isFinite(source.endZ) &&
  Number.isFinite(source.length) &&
  source.length > 0;

export interface StraightChordSolve {
  regions: GradingResultRegion[];
  diagnostics: GradingDiagnostic[];
  /** Arc-mapped stations parallel to the polylines (chord solve: raw u). */
  nodeStations: number[];
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

export type StraightChordOutcome =
  | { ok: true; solve: StraightChordSolve }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

export interface StraightChordInput {
  source: GradingComputeSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  target: GradingTargetMeshSnapshot;
  query: TargetQuery;
  /** Arc-station offset added to every chord-local station. */
  stationBase: number;
  /** Chord-u → arc-station scale (straight solve: 1). */
  stationScale: number;
}

interface StraightFrame {
  len: number;
  tx: number;
  ty: number;
  gs: number;
  normal: PlanVector;
  fixedG: number | null;
}

type FrameResult =
  | { ok: true; frame: StraightFrame }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

/** Validate source/side/criterion and derive the straight frame. */
const resolveStraightFrame = (
  source: GradingComputeSource,
  side: GradingSide,
  criterion: GradingCriterion,
): FrameResult => {
  if (!finiteSource(source)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SOURCE' };
  const dx = source.endX - source.startX;
  const dy = source.endY - source.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DEGENERATE_SOURCE' };
  const normal = gradingSideNormal(dx / len, dy / len, side);
  if (!normal) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_SIDE' };
  let fixedG: number | null = null;
  if (criterion.kind === 'fixed') {
    if (!Number.isFinite(criterion.gradeRatio)) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_CRITERION' };
    fixedG = criterion.gradeRatio;
  } else {
    if (!Number.isFinite(criterion.cutGradeRatio) || !Number.isFinite(criterion.fillGradeRatio)) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_CRITERION' };
    }
  }
  const tx = dx / len;
  const ty = dy / len;
  const gs = (source.endZ - source.startZ) / source.length;
  return { ok: true, frame: { len, tx, ty, gs, normal, fixedG } };
};

/** Strip corners for the grid-bbox candidate pass. */
const findChordCandidates = (
  target: GradingTargetMeshSnapshot,
  source: GradingComputeSource,
  normal: PlanVector,
  maxSearchDistance: number,
): number[] | null => {
  const corner = (u: number, d: number): { x: number; y: number } => {
    const p = fromLocalFrame(u, d, source, normal);
    return { x: p?.x ?? NaN, y: p?.y ?? NaN };
  };
  return candidateTriangles(target, [
    corner(0, 0),
    corner(source.length, 0),
    corner(0, maxSearchDistance),
    corner(source.length, maxSearchDistance),
  ]);
};

type SpanPlanResult =
  | { ok: true; spans: ChordSpan[] }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

/** Coverage probes: endpoints + every candidate-vertex station clamped in. */
const collectCutFillProbes = (
  source: GradingComputeSource,
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  normal: PlanVector,
  atSource: SourcePointFn,
  query: TargetQuery,
): { probes: number[]; deltas: Array<number | null> } => {
  // Coverage probe: endpoints + every candidate-vertex station clamped in.
  const probeSet = new Set<number>([0, source.length]);
  for (const index of candidates) {
    for (let k = 0; k < 3; k += 1) {
      const vi = target.triangles[index * 3 + k]!;
      const local = toLocalFrame(target.points[vi * 3]!, target.points[vi * 3 + 1]!, source, normal);
      if (local && local.u >= 0 && local.u <= source.length) probeSet.add(local.u);
    }
  }
  const probes = [...probeSet].sort((a, b) => a - b);
  const deltas: Array<number | null> = probes.map((u) => {
    const p = atSource(u);
    const z = query.elevationAt(p.x, p.y);
    return z === null ? null : z - p.z;
  });
  return { probes, deltas };
};

/** Cut/fill station plan: coverage-gated zero-split spans. */
const planCutFillSpans = (
  source: GradingComputeSource,
  criterion: GradingCriterion,
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  normal: PlanVector,
  atSource: SourcePointFn,
  query: TargetQuery,
): SpanPlanResult => {
  const cutG = (criterion as Extract<GradingCriterion, { kind: 'cut-fill' }>).cutGradeRatio;
  const fillG = (criterion as Extract<GradingCriterion, { kind: 'cut-fill' }>).fillGradeRatio;
  const { probes, deltas } = collectCutFillProbes(source, target, candidates, normal, atSource, query);
  if (!requireSourceCoverage(deltas)) {
    return { ok: false, code: 'TARGET_GAP', detail: 'GRADING_CUTFILL_SOURCE_COVERAGE' };
  }
  const split = splitStationsAtZeros(probes, deltas as number[]);
  const spans: ChordSpan[] = [];
  for (let i = 0; i + 1 < split.length; i += 1) {
    const u0 = split[i]!;
    const u1 = split[i + 1]!;
    const mid = (u0 + u1) / 2;
    const p = atSource(mid);
    const z = query.elevationAt(p.x, p.y);
    const delta = z === null ? 0 : z - p.z;
    const cls = classifySourceDelta(delta);
    spans.push({
      u0,
      u1,
      g: cls === 'CUT' ? cutG : cls === 'FILL' ? fillG : 0,
      region: cls === 'TIED' ? 'FIXED' : cls,
    });
  }
  return { ok: true, spans };
};

/** Station plan: fixed = one span; cut/fill = coverage-gated zero-split spans. */
const planStationSpans = (
  source: GradingComputeSource,
  criterion: GradingCriterion,
  fixedG: number | null,
  target: GradingTargetMeshSnapshot,
  candidates: number[],
  normal: PlanVector,
  atSource: SourcePointFn,
  query: TargetQuery,
): SpanPlanResult => {
  if (fixedG !== null) {
    return { ok: true, spans: [{ u0: 0, u1: source.length, g: fixedG, region: 'FIXED' }] };
  }
  return planCutFillSpans(source, criterion, target, candidates, normal, atSource, query);
};

/** Sort + drop d-collinear interior joints under one grading plane. */
const simplifyDaylightNodes = (
  daylight: Array<{ u: number; d: number; span: number }>,
): void => {
  daylight.sort((a, b) => a.u - b.u || a.span - b.span);
  // Drop interior joints d-collinear under one grading plane: TIN
  // diagonals inject event stations along a straight tie; z is then
  // mathematically determined by (u, d), so no separate z check is
  // needed (and its float noise would only keep dead nodes). Cross-plane
  // joints (cut/fill z-steps) keep both sides via the samePlane gate.
  const simplified: Array<{ u: number; d: number; span: number }> = [daylight[0]!];
  for (let i = 1; i + 1 < daylight.length; i += 1) {
    const prev = simplified[simplified.length - 1]!;
    const mid = daylight[i]!;
    const next = daylight[i + 1]!;
    const samePlane = prev.span === mid.span && mid.span === next.span;
    const du = next.u - prev.u;
    const expectedD = du === 0 ? prev.d : prev.d + ((next.d - prev.d) * (mid.u - prev.u)) / du;
    const dFlat = Math.abs(mid.d - expectedD) <= zeroDelta(mid.d, expectedD);
    if (samePlane && dFlat) continue;
    simplified.push(mid);
  }
  simplified.push(daylight[daylight.length - 1]!);
  daylight.length = 0;
  daylight.push(...simplified);
};

interface ChordCounts {
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  multipleSolutionCount: number;
}

/** Map regions/diagnostics through the affine station map (order-preserving). */
const buildChordSolve = (
  regions: GradingResultRegion[],
  diagnostics: GradingDiagnostic[],
  world: WorldDaylight,
  counts: ChordCounts,
  stationBase: number,
  stationScale: number,
): StraightChordSolve => {
  const { sourcePts, daylightPts, daylightFlat, distances, nodeStations } = world;
  // Affine station map preserves order (scale > 0), so mapped spans stay sorted.
  const mapStation = (u: number): number => stationBase + u * stationScale;
  return {
    regions: regions.map((region) => ({
      classification: region.classification,
      stationSpan: [mapStation(region.stationSpan[0]), mapStation(region.stationSpan[1])] as [number, number],
    })),
    diagnostics: diagnostics.map((diagnostic) =>
      diagnostic.stationSpan
        ? {
            ...diagnostic,
            stationSpan: [
              mapStation(diagnostic.stationSpan[0]),
              mapStation(diagnostic.stationSpan[1]),
            ] as [number, number],
          }
        : diagnostic,
    ),
    nodeStations,
    sourcePts,
    daylightPts,
    daylightFlat,
    distances,
    candidateTriangleCount: counts.candidateTriangleCount,
    intersectionSegmentCount: counts.intersectionSegmentCount,
    multipleSolutionCount: counts.multipleSolutionCount,
  };
};

interface WorldDaylight {
  sourcePts: Array<{ x: number; y: number; z: number }>;
  daylightPts: Array<{ x: number; y: number; z: number }>;
  daylightFlat: number[];
  distances: number[];
  nodeStations: number[];
}

/** World daylight + source XYZ (grading-plane Z after proven agreement). */
type WorldDaylightResult =
  | { ok: true; world: WorldDaylight }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

const liftDaylightToWorld = (
  daylight: Array<{ u: number; d: number; span: number }>,
  spans: ChordSpan[],
  source: GradingComputeSource,
  normal: PlanVector,
  gs: number,
  atSource: SourcePointFn,
  query: TargetQuery,
  stationBase: number,
  stationScale: number,
): WorldDaylightResult => {
  const daylightFlat: number[] = [];
  const sourcePts: Array<{ x: number; y: number; z: number }> = [];
  const daylightPts: Array<{ x: number; y: number; z: number }> = [];
  const distances: number[] = [];
  const nodeStations: number[] = [];
  for (const node of daylight) {
    const world = fromLocalFrame(node.u, node.d, source, normal);
    if (!world) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_FRAME' };
    const s = atSource(node.u);
    // Daylight Z agreement: target-plane Z must match grading-plane Z.
    const zt = query.elevationAt(world.x, world.y);
    const zg = gradeElevation(source.startZ, gs, node.u, spans[node.span]!.g, node.d);
    if (zt === null) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DAYLIGHT_OFF_TARGET' };
    if (Math.abs(zt - zg) > zeroDelta(zt, zg)) {
      return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_DAYLIGHT_DISAGREE' };
    }
    sourcePts.push(s);
    daylightPts.push({ x: world.x, y: world.y, z: zg });
    daylightFlat.push(world.x, world.y, zg);
    distances.push(node.d);
    nodeStations.push(stationBase + node.u * stationScale);
  }
  return { ok: true, world: { sourcePts, daylightPts, daylightFlat, distances, nodeStations } };
};

/**
 * Exact straight-chord solve through world polylines. The solver math is
 * untouched by the arc slice: station mapping is affine (base + u*scale),
 * so the straight path (base 0, scale 1) reproduces its stations bitwise.
 */
export const solveStraightChord = (input: StraightChordInput): StraightChordOutcome => {
  const { source, side, criterion, maxSearchDistance, target, query, stationBase, stationScale } = input;
  const framed = resolveStraightFrame(source, side, criterion);
  if (!framed.ok) return framed;
  const { tx, ty, gs, normal, fixedG } = framed.frame;
  const atSource: SourcePointFn = (u) => ({
    x: source.startX + tx * u,
    y: source.startY + ty * u,
    z: source.startZ + gs * u,
  });
  const candidates = findChordCandidates(target, source, normal, maxSearchDistance);
  if (!candidates) return { ok: false, code: 'NO_SOLUTION', detail: 'GRADING_BAD_TARGET_MESH' };
  const planned = planStationSpans(source, criterion, fixedG, target, candidates, normal, atSource, query);
  if (!planned.ok) return planned;
  const spans = planned.spans;
  const solvedSpans = solveStationSpans({
    target,
    candidates,
    source,
    normal,
    gs,
    maxSearchDistance,
    atSource,
    query,
    fixedG,
    spans,
  });
  if (!solvedSpans.ok) return solvedSpans;
  const { diagnostics, regions, daylight, intersectionSegmentCount, multipleSolutionCount } = solvedSpans.accum;
  if (daylight.length < 2) return { ok: false, code: 'NO_SOLUTION' };
  simplifyDaylightNodes(daylight);
  const lifted = liftDaylightToWorld(
    daylight,
    spans,
    source,
    normal,
    gs,
    atSource,
    query,
    stationBase,
    stationScale,
  );
  if (!lifted.ok) return lifted;
  return {
    ok: true,
    solve: buildChordSolve(regions, diagnostics, lifted.world, {
      candidateTriangleCount: candidates.length,
      intersectionSegmentCount,
      multipleSolutionCount,
    }, stationBase, stationScale),
  };
};

