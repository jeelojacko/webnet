import type { CutFillResult, SectionResult } from './sectionTypes';

const OFFSET_EPS = 1e-9;

/** Piecewise-linear trace: consecutive sample pairs within each segment. */
const tracePieces = (
  trace: SectionResult,
): Array<{ o0: number; o1: number; z0: number; z1: number }> => {
  const pieces: Array<{ o0: number; o1: number; z0: number; z1: number }> = [];
  for (const segment of trace.segments) {
    const samples = segment.samples;
    for (let index = 0; index + 1 < samples.length; index += 1) {
      const a = samples[index]!;
      const b = samples[index + 1]!;
      if (b.offset - a.offset <= OFFSET_EPS) continue;
      pieces.push({ o0: a.offset, o1: b.offset, z0: a.elevation, z1: b.elevation });
    }
  }
  return pieces;
};

const isCoveredAt = (
  trace: SectionResult,
  offset: number,
): boolean =>
  trace.segments.some((segment) => {
    const samples = segment.samples;
    if (samples.length === 0) return false;
    const first = samples[0]!.offset;
    const last = samples[samples.length - 1]!.offset;
    return last - first > OFFSET_EPS && offset >= first - OFFSET_EPS && offset <= last + OFFSET_EPS;
  });

const elevationAt = (
  pieces: Array<{ o0: number; o1: number; z0: number; z1: number }>,
  offset: number,
): number | null => {
  for (const piece of pieces) {
    if (offset >= piece.o0 - OFFSET_EPS && offset <= piece.o1 + OFFSET_EPS) {
      const width = piece.o1 - piece.o0;
      if (width <= OFFSET_EPS) continue;
      const ratio = Math.max(0, Math.min(1, (offset - piece.o0) / width));
      return piece.z0 + (piece.z1 - piece.z0) * ratio;
    }
  }
  return null;
};

/**
 * Exact pairwise cut/fill overlay over COMMON-coverage intervals only.
 * Delta is linear per interval (TIN planes are linear along the line);
 * sign changes split at the exact zero crossing. Gaps contribute zero.
 * Reports Cut >= 0, Fill >= 0, Net = Fill - Cut in drawing units squared.
 * NO volume anywhere: per-section areas only.
 */
export const computeCutFillArea = (
  base: SectionResult,
  comparison: SectionResult,
): CutFillResult => {
  const basePieces = tracePieces(base);
  const comparisonPieces = tracePieces(comparison);
  const breaks = new Set<number>();
  for (const segment of [...base.segments, ...comparison.segments]) {
    for (const sample of segment.samples) breaks.add(sample.offset);
  }
  const ordered = [...breaks].sort((a, b) => a - b);
  const merged: number[] = [];
  for (const offset of ordered) {
    const last = merged[merged.length - 1];
    if (last == null || Math.abs(offset - last) > OFFSET_EPS) merged.push(offset);
  }

  let fill = 0;
  let cut = 0;
  let overlapWidth = 0;
  for (let index = 0; index + 1 < merged.length; index += 1) {
    const o0 = merged[index]!;
    const o1 = merged[index + 1]!;
    const width = o1 - o0;
    if (width <= OFFSET_EPS) continue;
    const mid = (o0 + o1) / 2;
    if (!isCoveredAt(base, mid) || !isCoveredAt(comparison, mid)) continue;
    const zB0 = elevationAt(basePieces, o0);
    const zB1 = elevationAt(basePieces, o1);
    const zC0 = elevationAt(comparisonPieces, o0);
    const zC1 = elevationAt(comparisonPieces, o1);
    if (zB0 == null || zB1 == null || zC0 == null || zC1 == null) continue;
    const d0 = zC0 - zB0;
    const d1 = zC1 - zB1;
    overlapWidth += width;
    const add = (area: number): void => {
      if (area > 0) fill += area;
      else cut -= area;
    };
    if (d0 * d1 < 0) {
      // Exact zero-crossing split: two triangles.
      const t = d0 / (d0 - d1);
      add((d0 * (t * width)) / 2);
      add((d1 * ((1 - t) * width)) / 2);
    } else {
      add(((d0 + d1) / 2) * width);
    }
  }
  return { fill, cut, net: fill - cut, overlapWidth };
};
