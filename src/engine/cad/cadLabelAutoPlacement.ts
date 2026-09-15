import type {
  CadDraftLabel,
  DraftLabelViewportOverride,
} from './cadLabelEngine';
import { normalizePlacementState } from './cadLabelEngine';

// Optional paper-mm auto-placement for viewport labels. Operates only in
// viewport/paper-mm coords; source geometry is never touched. Deterministic:
// same doc + viewport input always yields identical output (sorted label
// order, fixed candidate order, id tie-breaks). AUTO labels only, unless
// the caller passes reset: true.

export interface PaperRect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface AutoPlaceLabelInput {
  label: CadDraftLabel;
  /** Anchor in viewport/paper-mm (label source point already projected). */
  anchorMm: { x: number; y: number };
  /** Estimated label box (paper mm) at zero offset. */
  sizeMm: { width: number; height: number };
}

export interface AutoPlaceArgs {
  labels: AutoPlaceLabelInput[];
  viewportId: string;
  /** Other labels already placed, point symbols, line/curve geometry, viewport boundary. */
  obstaclesMm: PaperRect[];
  /** Title/table exclusion rects (paper mm). */
  exclusionMm?: PaperRect[];
  viewportMm: PaperRect;
  leaderThresholdMm?: number;
  /** When true, MANUAL labels are re-placed too; otherwise they are kept. */
  reset?: boolean;
}

export interface AutoPlaceResult {
  labelId: string;
  viewportId: string;
  override: DraftLabelViewportOverride;
  leaderEnabled: boolean;
  candidate: string;
}

export const DEFAULT_LEADER_THRESHOLD_MM = 3;

const CANDIDATES = [
  'NE', 'NW', 'SE', 'SW', 'above', 'below', 'along-left', 'along-right',
] as const;

// Fixed paper-mm offsets per candidate (gap + direction). Along-left/right
// suit long road/alignment labels: offset parallel to the segment.
const CANDIDATE_OFFSET_MM: Record<(typeof CANDIDATES)[number], { dx: number; dy: number }> = {
  NE: { dx: 2, dy: -2 },
  NW: { dx: -2, dy: -2 },
  SE: { dx: 2, dy: 2 },
  SW: { dx: -2, dy: 2 },
  above: { dx: 0, dy: -3 },
  below: { dx: 0, dy: 3 },
  'along-left': { dx: -6, dy: 0 },
  'along-right': { dx: 6, dy: 0 },
};

const boxAt = (
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  offset: { dx: number; dy: number },
): PaperRect => ({
  xMm: anchor.x + offset.dx - size.width / 2,
  yMm: anchor.y + offset.dy - size.height / 2,
  widthMm: size.width,
  heightMm: size.height,
});

const overlapArea = (a: PaperRect, b: PaperRect): number => {
  const x = Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm) - Math.max(a.xMm, b.xMm);
  const y = Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm) - Math.max(a.yMm, b.yMm);
  return x > 0 && y > 0 ? x * y : 0;
};

const clippedArea = (box: PaperRect, viewport: PaperRect): number => {
  const insideX =
    Math.min(box.xMm + box.widthMm, viewport.xMm + viewport.widthMm) - Math.max(box.xMm, viewport.xMm);
  const insideY =
    Math.min(box.yMm + box.heightMm, viewport.yMm + viewport.heightMm) - Math.max(box.yMm, viewport.yMm);
  const inside = Math.max(0, insideX) * Math.max(0, insideY);
  return box.widthMm * box.heightMm - inside;
};

const rectsOverlap = (a: PaperRect, b: PaperRect): boolean => overlapArea(a, b) > 0;

export const autoPlaceViewportLabels = (args: AutoPlaceArgs): AutoPlaceResult[] => {
  const threshold = args.leaderThresholdMm ?? DEFAULT_LEADER_THRESHOLD_MM;
  const placed: PaperRect[] = [];
  const results: AutoPlaceResult[] = [];
  // Deterministic input order: sort by label id (same doc+viewport → same output).
  const ordered = [...args.labels].sort((a, b) => {
    if (a.label.id < b.label.id) return -1;
    if (a.label.id > b.label.id) return 1;
    return 0;
  });
  for (const entry of ordered) {
    const placement = normalizePlacementState(entry.label.placement ?? 'AUTO');
    if (placement === 'MANUAL' && !args.reset) continue;
    const blockers = [...args.obstaclesMm, ...(args.exclusionMm ?? []), ...placed];
    let best: { name: string; dx: number; dy: number; score: number } | undefined;
    for (const name of CANDIDATES) {
      const offset = CANDIDATE_OFFSET_MM[name];
      const box = boxAt(entry.anchorMm, entry.sizeMm, offset);
      const overlap = blockers.reduce((sum, blocker) => sum + overlapArea(box, blocker), 0);
      const leaderLength = Math.hypot(offset.dx, offset.dy);
      const distance = leaderLength;
      const clipping = clippedArea(box, args.viewportMm);
      // Score: overlap dominates, then clipping, then leader length, then distance.
      const score = overlap * 1000 + clipping * 100 + leaderLength * 2 + distance;
      if (!best || score < best.score) best = { name, ...offset, score };
    }
    const chosen = best ?? { name: 'NE', ...CANDIDATE_OFFSET_MM.NE, score: 0 };
    const box = boxAt(entry.anchorMm, entry.sizeMm, chosen);
    // Keep the label inside the viewport on both axes when the box can fit, without re-scoring.
    const fitsX = entry.sizeMm.width <= args.viewportMm.widthMm;
    const fitsY = entry.sizeMm.height <= args.viewportMm.heightMm;
    const clampedDx = !fitsX
      ? chosen.dx
      : box.xMm < args.viewportMm.xMm
        ? chosen.dx + (args.viewportMm.xMm - box.xMm)
        : box.xMm + box.widthMm > args.viewportMm.xMm + args.viewportMm.widthMm
          ? chosen.dx - (box.xMm + box.widthMm - args.viewportMm.xMm - args.viewportMm.widthMm)
          : chosen.dx;
    const clampedBoxX = boxAt(entry.anchorMm, entry.sizeMm, { dx: clampedDx, dy: chosen.dy });
    const clampedDy = !fitsY
      ? chosen.dy
      : clampedBoxX.yMm < args.viewportMm.yMm
        ? chosen.dy + (args.viewportMm.yMm - clampedBoxX.yMm)
        : clampedBoxX.yMm + clampedBoxX.heightMm > args.viewportMm.yMm + args.viewportMm.heightMm
          ? chosen.dy - (clampedBoxX.yMm + clampedBoxX.heightMm - args.viewportMm.yMm - args.viewportMm.heightMm)
          : chosen.dy;
    placed.push(boxAt(entry.anchorMm, entry.sizeMm, { dx: clampedDx, dy: clampedDy }));
    const leaderEnabled = Math.hypot(clampedDx, clampedDy) > threshold;
    results.push({
      labelId: entry.label.id,
      viewportId: args.viewportId,
      override: {
        dxMm: Math.round(clampedDx * 1000) / 1000,
        dyMm: Math.round(clampedDy * 1000) / 1000,
      },
      leaderEnabled,
      candidate: chosen.name,
    });
  }
  // Deterministic output order (tie-break by label id, already ordered).
  return results.sort((a, b) => {
    if (a.labelId < b.labelId) return -1;
    if (a.labelId > b.labelId) return 1;
    return 0;
  });
};

export const isBlocked = (box: PaperRect, obstacles: PaperRect[]): boolean =>
  obstacles.some((obstacle) => rectsOverlap(box, obstacle));
