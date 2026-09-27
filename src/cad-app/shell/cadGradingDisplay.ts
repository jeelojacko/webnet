/**
 * Phase 20B — grading display pass (one pass, from the CURRENT cache only).
 *
 * Renderer-agnostic model-XY geometry: the derived daylight line (drawn
 * visually distinct from the source FL), an optional triangle fill for the
 * grading surface, and a source-side marker. A stale/failed/unbuilt row
 * emits NO geometry — the state is carried so the shell can label it.
 *
 * `gradingGhostArrow` is the pre-commit creation preview: a short normal
 * arrow on the chosen side at no mutation.
 */
import type { GradingSide } from '../../engine/cad/grading/gradingTypes';
import type { ResolvedGradingSource } from '../../engine/cad/grading/gradingTypes';
import type { CadGradingResult, GradingAccuracy } from '../../engine/cad/grading/gradingTypes';
import { buildGradingDisplayLayers, type CadGradingDisplayLayer } from '../../engine/cad/cadGradingView';
import type { CadGradingRow, CadGradingSnapshot } from './cadGradingSnapshot';

export interface GradingPlanPoint {
  x: number;
  y: number;
  z: number;
}

export interface GradingDisplayTriangle {
  a: { x: number; y: number };
  b: { x: number; y: number };
  c: { x: number; y: number };
}

export interface CadGradingDisplayPass {
  gradingId: string;
  status: CadGradingRow['status'];
  /** True only when a CURRENT result produced geometry. */
  current: boolean;
  accuracy: GradingAccuracy | null;
  showTriangles: boolean;
  showDaylight: boolean;
  /** Derived daylight tie line (model XYZ); empty unless CURRENT. */
  daylight: GradingPlanPoint[];
  /** Optional grading-surface triangle fill (plan XY); empty unless CURRENT. */
  triangles: GradingDisplayTriangle[];
  /** Short perpendicular ticks from the source to the first/last tie. */
  sourceMarker: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
  /** Human warnings (stale, curve approximated, failed) — never color-only. */
  warnings: string[];
}

export const gradingDisplayStateWarning = (row: CadGradingRow): string | null => {
  if (row.status === 'CURRENT') {
    return row.accuracy === 'CURVE_APPROXIMATED' ? 'Curve approximated — chords within chord tolerance.' : null;
  }
  if (row.stale) return `Showing STALE geometry withheld — grading is ${row.statusText}.`;
  return `No CURRENT geometry — grading is ${row.statusText}.`;
};

const daylightPointsOf = (result: CadGradingResult): GradingPlanPoint[] => {
  const points: GradingPlanPoint[] = [];
  for (let index = 0; index + 2 < result.daylightPoints.length; index += 3) {
    points.push({
      x: result.daylightPoints[index]!,
      y: result.daylightPoints[index + 1]!,
      z: result.daylightPoints[index + 2]!,
    });
  }
  return points;
};

const trianglesOf = (result: CadGradingResult): GradingDisplayTriangle[] => {
  const { points, triangles } = result.gradingMesh;
  const triangles3: GradingDisplayTriangle[] = [];
  const at = (index: number): { x: number; y: number } => ({
    x: points[index * 3] ?? 0,
    y: points[index * 3 + 1] ?? 0,
  });
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const i0 = triangles[index]!;
    const i1 = triangles[index + 1]!;
    const i2 = triangles[index + 2]!;
    triangles3.push({ a: at(i0), b: at(i1), c: at(i2) });
  }
  return triangles3;
};

export const buildGradingDisplayPass = (
  row: CadGradingRow,
  result: CadGradingResult | null,
  source: ResolvedGradingSource | null,
  options?: { showTriangles?: boolean; showDaylight?: boolean; markerLength?: number },
): CadGradingDisplayPass => {
  const showTriangles = options?.showTriangles !== false;
  const showDaylight = options?.showDaylight !== false;
  const warning = gradingDisplayStateWarning(row);
  const current = row.status === 'CURRENT' && result != null;
  const daylight = current && result ? daylightPointsOf(result) : [];
  const triangles = current && result && showTriangles ? trianglesOf(result) : [];
  const marker: CadGradingDisplayPass['sourceMarker'] = [];
  if (current && source != null && daylight.length > 0) {
    const length = options?.markerLength ?? Math.max(1, row.maxSearchDistance * 0.1);
    const tangentLen = Math.max(source.length, 1e-9);
    const tx = (source.endX - source.startX) / tangentLen;
    const ty = (source.endY - source.startY) / tangentLen;
    for (const point of [daylight[0]!, daylight[daylight.length - 1]!]) {
      marker.push({
        a: { x: point.x - tx * length, y: point.y - ty * length },
        b: { x: point.x + tx * length, y: point.y + ty * length },
      });
    }
  }
  return {
    gradingId: row.id,
    status: row.status,
    current,
    accuracy: current && result ? result.accuracy : row.accuracy,
    showTriangles,
    showDaylight,
    daylight,
    triangles,
    sourceMarker: marker,
    warnings: warning ? [warning] : [],
  };
};

/**
 * Live-viewport layers from the snapshot: every CURRENT row contributes its
 * display pass (daylight + triangles); stale/failed/unbuilt rows emit no
 * layer — the viewport never shows superseded geometry as current.
 */
export const buildGradingSceneLayers = (
  snapshot: CadGradingSnapshot | null | undefined,
): CadGradingDisplayLayer[] =>
  buildGradingDisplayLayers(
    (snapshot?.gradings ?? [])
      .filter((row) => row.status === 'CURRENT' && row.currentResult != null)
      .map((row) => {
        const pass = buildGradingDisplayPass(row, row.currentResult, row.source);
        return {
          gradingId: row.id,
          gradingName: row.name,
          ...(row.layerId !== undefined ? { layerId: row.layerId } : {}),
          current: pass.current,
          accuracy: pass.accuracy,
          daylight: pass.daylight.map((point) => ({ x: point.x, y: point.y })),
          triangles: pass.triangles,
        };
      }),
  );

/**
 * Pre-commit ghost arrow: short normal arrow at the course midpoint on the
 * chosen side (world XY). No mutation, no engine call.
 */
export const gradingGhostArrow = (
  source: ResolvedGradingSource,
  side: GradingSide,
  length = 5,
): { from: { x: number; y: number }; to: { x: number; y: number } } => {
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
};
