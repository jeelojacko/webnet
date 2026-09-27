/**
 * Phase 20C Wave-4A — grading-group display pass (from the CURRENT cache only).
 *
 * Renderer-agnostic model-XY geometry: the merged daylight boundary (drawn
 * visually distinct), an optional triangle fill, the miter/corner seam
 * (screen-only diagnostic, never persisted, excluded from plot/export by
 * construction), and source-side markers. A stale/unbuilt row emits NO
 * geometry — the state is carried so the shell can label it. A FAILED row
 * emits diagnostic-only markers at the offending corner/course (never fill).
 *
 * `groupGhostArrows` is the pre-commit side preview: short normal arrows on
 * the grading side at representative courses (several spread around closed
 * rings). Unlike the 20B single-grading ghost (computed but never consumed),
 * these arrows ARE consumed: the workspace renders them through the group
 * scene layers for the selected uncalculated group.
 */
import type { GradingAccuracy, GradingCriterion, GradingSide, ResolvedGradingSource } from '../../engine/cad/grading/gradingTypes';
import type {
  CadGradingGroupResult,
  GroupDiagnostic,
} from '../../engine/cad/grading/gradingGroupTypes';
import {
  gradingPlaneGradient,
  miterSeam,
  selectMiterRay,
} from '../../engine/cad/grading/gradingCornerMath';
import { gradingSideNormal } from '../../engine/cad/grading/gradingCourseFrame';
import {
  buildGradingGroupDisplayLayers,
  type CadGradingGroupDisplayLayer,
  type GroupDisplayLayerEntry,
} from '../../engine/cad/cadGradingGroupView';
import type { CadGradingGroupRow, CadGradingGroupSnapshot } from './cadGradingGroupSnapshot';

export interface GroupPlanPoint {
  x: number;
  y: number;
  z: number;
}

export interface GroupDisplayTriangle {
  a: { x: number; y: number };
  b: { x: number; y: number };
  c: { x: number; y: number };
}

export interface CadGradingGroupDisplayPass {
  groupId: string;
  status: CadGradingGroupRow['status'];
  /** True only when a CURRENT result produced geometry. */
  current: boolean;
  accuracy: GradingAccuracy | null;
  curveCornerApproximated: boolean;
  showTriangles: boolean;
  showDaylight: boolean;
  /** Merged daylight boundary (model XYZ); empty unless CURRENT. */
  daylight: GroupPlanPoint[];
  /** Grading-strip triangle fill (plan XY); empty unless CURRENT. */
  triangles: GroupDisplayTriangle[];
  /** Resolved miter/corner seam polyline (plan XY); empty unless CURRENT. */
  seam: Array<{ x: number; y: number }>;
  /** Failed corner/course markers (FAILED only; never fill). */
  failedMarkers: Array<{ x: number; y: number; label: string }>;
  /** Human warnings (stale, curve approximated, failed) — never color-only. */
  warnings: string[];
}

export const groupDisplayStateWarning = (row: CadGradingGroupRow): string | null => {
  if (row.status === 'CURRENT') {
    return row.curveCornerApproximated
      ? 'Curve corner approximated — chords within chord tolerance.'
      : null;
  }
  if (row.status === 'FAILED') return `Group FAILED — see manager diagnostics (${row.statusText}).`;
  if (row.stale) return `Showing STALE geometry withheld — group is ${row.statusText}.`;
  return `No CURRENT geometry — group is ${row.statusText}.`;
};

const daylightPointsOf = (result: CadGradingGroupResult): GroupPlanPoint[] => {
  const points: GroupPlanPoint[] = [];
  for (let index = 0; index + 2 < result.daylightPoints.length; index += 3) {
    points.push({
      x: result.daylightPoints[index]!,
      y: result.daylightPoints[index + 1]!,
      z: result.daylightPoints[index + 2]!,
    });
  }
  return points;
};

const trianglesOf = (result: CadGradingGroupResult): GroupDisplayTriangle[] => {
  const { points, triangles } = result.gradingMesh;
  const out: GroupDisplayTriangle[] = [];
  const at = (index: number): { x: number; y: number } => ({
    x: points[index * 3] ?? 0,
    y: points[index * 3 + 1] ?? 0,
  });
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    out.push({ a: at(triangles[index]!), b: at(triangles[index + 1]!), c: at(triangles[index + 2]!) });
  }
  return out;
};

/** Resolved post-calc seam: miter-ray segments + corner daylight vertices. */
const seamOf = (result: CadGradingGroupResult): Array<{ x: number; y: number }> => {
  const seam: Array<{ x: number; y: number }> = [];
  for (const corner of result.corners) {
    if (corner.tiePointXyz != null) {
      seam.push({ x: corner.tiePointXyz[0], y: corner.tiePointXyz[1] });
    }
    if (corner.daylightPoints != null) {
      for (let index = 0; index + 2 < corner.daylightPoints.length; index += 3) {
        seam.push({ x: corner.daylightPoints[index]!, y: corner.daylightPoints[index + 1]! });
      }
    }
  }
  return seam;
};

const midOf = (source: ResolvedGradingSource): { x: number; y: number } => ({
  x: (source.startX + source.endX) / 2,
  y: (source.startY + source.endY) / 2,
});

/**
 * Failed-corner/course markers from session diagnostics: corner diagnostics
 * anchor at the joint vertex, member diagnostics at the member midpoint.
 * Never fill — diagnostic only.
 */
export const failedMarkersOf = (
  row: CadGradingGroupRow,
  diagnostics: ReadonlyArray<GroupDiagnostic>,
): Array<{ x: number; y: number; label: string }> => {
  const sources = row.memberSources;
  if (sources == null || sources.length === 0) return [];
  const markers: Array<{ x: number; y: number; label: string }> = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.cornerIndex != null) {
      const source = sources[diagnostic.cornerIndex % sources.length]!;
      markers.push({ x: source.endX, y: source.endY, label: `#${diagnostic.cornerIndex} ${diagnostic.code}` });
    } else if (diagnostic.memberIndex != null) {
      const source = sources[diagnostic.memberIndex % sources.length]!;
      const mid = midOf(source);
      markers.push({ x: mid.x, y: mid.y, label: `m${diagnostic.memberIndex} ${diagnostic.code}` });
    } else {
      const mid = midOf(sources[0]!);
      markers.push({ x: mid.x, y: mid.y, label: diagnostic.code });
    }
  }
  return markers;
};

/**
 * FAILED markers from structured diagnostics, falling back to the session
 * error string (one marker at the first member midpoint). Never fill.
 */
export const failedErrorMarkers = (
  row: CadGradingGroupRow,
  diagnostics: ReadonlyArray<GroupDiagnostic>,
  failedError?: string,
): Array<{ x: number; y: number; label: string }> => {
  const structured = failedMarkersOf(row, diagnostics);
  if (structured.length > 0) return structured;
  if (failedError == null || failedError.length === 0) return [];
  const first = row.memberSources?.[0];
  if (!first) return [];
  const mid = midOf(first);
  return [{ x: mid.x, y: mid.y, label: failedError.length > 80 ? `${failedError.slice(0, 80)}\u2026` : failedError }];
};

export const buildGroupGradingDisplayPass = (
  row: CadGradingGroupRow,
  result: CadGradingGroupResult | null,
  options?: {
    showTriangles?: boolean;
    showDaylight?: boolean;
    failedDiagnostics?: ReadonlyArray<GroupDiagnostic>;
    failedError?: string;
  },
): CadGradingGroupDisplayPass => {
  const showTriangles = options?.showTriangles !== false;
  const showDaylight = options?.showDaylight !== false;
  const warning = groupDisplayStateWarning(row);
  const current = row.status === 'CURRENT' && result != null;
  const daylight = current && result ? daylightPointsOf(result) : [];
  const triangles = current && result && showTriangles ? trianglesOf(result) : [];
  const seam = current && result ? seamOf(result) : [];
  const failedMarkers =
    row.status === 'FAILED'
      ? failedErrorMarkers(row, options?.failedDiagnostics ?? [], options?.failedError)
      : [];
  return {
    groupId: row.id,
    status: row.status,
    current,
    accuracy: current && result ? result.accuracy : row.accuracy,
    curveCornerApproximated: row.curveCornerApproximated,
    showTriangles,
    showDaylight,
    daylight: showDaylight ? daylight : [],
    triangles,
    seam,
    failedMarkers,
    warnings: warning ? [warning] : [],
  };
};

/**
 * Live-viewport layers from the snapshot: every CURRENT row contributes its
 * display pass (daylight + fill + seam); the selected uncalculated row
 * contributes a ghost layer (side arrows, closing the 20B ghost gap);
 * FAILED rows contribute diagnostic-only markers. Stale/unbuilt rows emit
 * no layer — the viewport never shows superseded geometry as current.
 */
export const buildGroupGradingSceneLayers = (
  snapshot: CadGradingGroupSnapshot | null | undefined,
  options?: {
    selectedGroupId?: string | null;
    failedDiagnostics?: ReadonlyMap<string, ReadonlyArray<GroupDiagnostic>>;
    failedErrors?: ReadonlyMap<string, string>;
  },
): CadGradingGroupDisplayLayer[] => {
  const entries: GroupDisplayLayerEntry[] = [];
  for (const row of snapshot?.groups ?? []) {
    if (row.status === 'CURRENT' && row.currentResult != null) {
      const pass = buildGroupGradingDisplayPass(row, row.currentResult);
      entries.push({
        groupId: row.id,
        groupName: row.name,
        ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
        kind: 'result',
        accuracy: pass.accuracy,
        curveCornerApproximated: pass.curveCornerApproximated,
        daylight: pass.daylight.map((point) => ({ x: point.x, y: point.y })),
        triangles: pass.triangles,
        seam: pass.seam,
        ghostArrows: [],
        failedMarkers: [],
      });
      continue;
    }
    if (row.status === 'FAILED') {
      entries.push({
        groupId: row.id,
        groupName: row.name,
        ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
        kind: 'failed',
        accuracy: row.accuracy,
        curveCornerApproximated: false,
        daylight: [],
        triangles: [],
        seam: [],
        ghostArrows: [],
        failedMarkers: failedErrorMarkers(
          row,
          options?.failedDiagnostics?.get(row.id) ?? [],
          options?.failedErrors?.get(row.id),
        ),
      });
      continue;
    }
    const selected = options?.selectedGroupId ?? snapshot?.selectedGroupId ?? null;
    // Ghost side preview only before any result exists (UNBUILT / BUILDING /
    // result-less SOURCE_NOT_CURRENT): a stale retained result already shows
    // its STALE label, so it emits no layer — never rendered as current.
    if (
      row.id === selected &&
      !row.stale &&
      row.currentResult == null &&
      row.status !== 'BROKEN_REFERENCE' &&
      row.memberSources != null &&
      row.memberSources.length > 0
    ) {
      entries.push({
        groupId: row.id,
        groupName: row.name,
        ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
        kind: 'ghost',
        accuracy: null,
        curveCornerApproximated: false,
        daylight: [],
        triangles: [],
        seam: groupGhostSeam(row.memberSources, row.definition.side, row.definition.criterion),
        ghostArrows: groupGhostArrows(row.memberSources, row.definition.side),
        failedMarkers: [],
      });
    }
  }
  return buildGradingGroupDisplayLayers(entries);
};

/**
 * Pre-commit side-preview ghost: short normal arrows on the grading side at
 * representative courses — every course for short chains, up to 4 spread
 * around longer/closed rings. No mutation, no engine call.
 */
export const groupGhostArrows = (
  sources: ReadonlyArray<ResolvedGradingSource>,
  side: GradingSide,
  length = 5,
): Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> => {
  if (sources.length === 0) return [];
  const picks: ResolvedGradingSource[] = sources.length <= 4
    ? [...sources]
    : [0, 1, 2, 3].map((slot) => sources[Math.floor((slot * sources.length) / 4)]!);
  return picks.map((source) => {
    const midX = (source.startX + source.endX) / 2;
    const midY = (source.startY + source.endY) / 2;
    const len = Math.max(source.length, 1e-9);
    const tx = (source.endX - source.startX) / len;
    const ty = (source.endY - source.startY) / len;
    const nx = side === 'left' ? -ty : ty;
    const ny = side === 'left' ? tx : -tx;
    return {
      from: { x: midX, y: midY },
      to: { x: midX + nx * length, y: midY + ny * length },
    };
  });
};

/**
 * Pre-calc miter seam ghosts from the analytic plane-intersection seam.
 *
 * Per-course longitudinal grade comes from the source itself
 * (`gs = (endZ - startZ) / length`); the caller supplies the per-course
 * cross-slope `g` (exact pre-target for a `fixed` criterion). Each joint
 * resolves through gradingPlaneGradient → miterSeam → selectMiterRay.
 * Coincident/ambiguous/inverted joints emit NO ghost for that joint —
 * honest omission; the post-calc overlay is truth. Screen-only, never
 * persisted.
 */
export const miterSeamGhosts = (
  sources: ReadonlyArray<ResolvedGradingSource>,
  side: GradingSide,
  crossSlopes: ReadonlyArray<number>,
  length = 3,
): Array<{ x: number; y: number }> => {
  const seam: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < sources.length; index += 1) {
    const a = sources[index]!;
    const b = sources[index + 1]!;
    const g1 = crossSlopes[index];
    const g2 = crossSlopes[index + 1];
    if (g1 === undefined || g2 === undefined) continue;
    if (!Number.isFinite(g1) || !Number.isFinite(g2)) continue;
    if (!(a.length > 0) || !(b.length > 0)) continue;
    const gs1 = (a.endZ - a.startZ) / a.length;
    const gs2 = (b.endZ - b.startZ) / b.length;
    const plane1 = gradingPlaneGradient(a, side, g1, gs1);
    const plane2 = gradingPlaneGradient(b, side, g2, gs2);
    if (!plane1 || !plane2) continue;
    const direction = miterSeam(plane1, plane2);
    if (!direction || 'coincident' in direction) continue;
    const n1 = sideNormalOf(a, side);
    const n2 = sideNormalOf(b, side);
    if (!n1 || !n2) continue;
    const ray = selectMiterRay(direction, n1, n2);
    if (!ray || 'ambiguous' in ray || 'inverted' in ray) continue;
    seam.push({ x: b.startX, y: b.startY }, { x: b.startX + ray.mx * length, y: b.startY + ray.my * length });
  }
  return seam;
};

/** Unit grading-side normal of a resolved source, null when degenerate. */
const sideNormalOf = (
  source: ResolvedGradingSource,
  side: GradingSide,
): { nx: number; ny: number } | null => {
  const dx = source.endX - source.startX;
  const dy = source.endY - source.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return gradingSideNormal(dx / len, dy / len, side);
};

/**
 * Directional corner preview for `cut-fill` groups, where the corner side
 * (cut vs fill) is unknowable pre-target so no exact g exists. Pure plan
 * angle bisector — exact only for equal-slope flat joints, never solved
 * geometry. Screen-only, never persisted.
 */
export const indicativeCornerGhosts = (
  sources: ReadonlyArray<ResolvedGradingSource>,
  length = 3,
): Array<{ x: number; y: number }> => {
  const seam: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < sources.length; index += 1) {
    const a = sources[index]!;
    const b = sources[index + 1]!;
    const aLen = Math.max(a.length, 1e-9);
    const bLen = Math.max(b.length, 1e-9);
    const atx = (a.endX - a.startX) / aLen;
    const aty = (a.endY - a.startY) / aLen;
    const btx = (b.endX - b.startX) / bLen;
    const bty = (b.endY - b.startY) / bLen;
    // Interior bisector of the turn: (-aty + -bty) normal blend, normalized.
    let bx = -aty - bty;
    let by = atx + btx;
    const norm = Math.hypot(bx, by);
    if (!(norm > 1e-9)) continue;
    bx /= norm;
    by /= norm;
    seam.push({ x: b.startX, y: b.startY }, { x: b.startX + bx * length, y: b.startY + by * length });
  }
  return seam;
};

/**
 * Pre-calc seam ghost for a group row: the exact analytic seam for `fixed`
 * (exact g known pre-target), the directional bisector preview for
 * `cut-fill` (corner side unknowable pre-target — never solved geometry).
 */
export const groupGhostSeam = (
  sources: ReadonlyArray<ResolvedGradingSource>,
  side: GradingSide,
  criterion: GradingCriterion,
  length = 3,
): Array<{ x: number; y: number }> => {
  if (criterion.kind === 'fixed' && Number.isFinite(criterion.gradeRatio)) {
    return miterSeamGhosts(sources, side, sources.map(() => criterion.gradeRatio), length);
  }
  return indicativeCornerGhosts(sources, length);
};
