/**
 * Phase 20B grading definition persistence (ENGINE ONLY — no UI).
 *
 * Definitions persist; derived daylight/mesh/status/results never do.
 * Additive + optional (still schema v2, no bump — same precedent as every
 * 18F–19D table): legacy files backfill [] and reopen UNBUILT.
 *
 * Phase 20F: distance/elevation criteria omit `targetSurfaceId` on writes; a
 * retained stale id stays dormant. Clone preserves key order and never mints
 * a placeholder id.
 */

import { createGradingDefinition } from './gradingAuthoring';
import type { CadGrading } from './gradingTypes';

export const cloneCadGrading = (grading: CadGrading): CadGrading => ({
  id: grading.id,
  name: grading.name,
  sourceFeatureLineId: grading.sourceFeatureLineId,
  sourceCourse: { ...grading.sourceCourse },
  ...(grading.targetSurfaceId !== undefined ? { targetSurfaceId: grading.targetSurfaceId } : {}),
  side: grading.side,
  criterion: { ...grading.criterion },
  maxSearchDistance: grading.maxSearchDistance,
  curveChordTolerance: grading.curveChordTolerance,
  ...(grading.layerId !== undefined ? { layerId: grading.layerId } : {}),
  ...(grading.styleId !== undefined ? { styleId: grading.styleId } : {}),
});

export const cloneCadGradings = (gradings: CadGrading[] | undefined): CadGrading[] =>
  (gradings ?? []).map(cloneCadGrading);

/** Load-time backfill: legacy drawings (field absent) open with no gradings. */
export const backfillCadGradings = (gradings: CadGrading[] | undefined): CadGrading[] =>
  cloneCadGradings(gradings);

/**
 * Key-order discipline: project signatures are key-order-sensitive
 * JSON.stringify, and `gradings` is the trailing key. Object spread
 * overwrites in place, so a `{...spread, sharedParcelBoundaries, gradings}`
 * literal keeps a pre-existing mid-order `gradings` ahead of an appended
 * `sharedParcelBoundaries` (e.g. a 19D-era file opened on the parse path).
 * Strip the key first so callers re-append it canonically last.
 */
export const withoutGradingsKey = <T extends object>(project: T): Omit<T, 'gradings'> => {
  const { gradings: _dropped, ...rest } = project as T & { gradings?: unknown };
  return rest;
};

/**
 * Fail-closed definition validation: a raw entry round-trips through the
 * authoring constructor (shared id/criterion/scalar rules); malformed
 * entries are dropped, valid ones are kept verbatim (never rebound).
 */
export const sanitizeCadGradings = (gradings: unknown): CadGrading[] => {
  if (!Array.isArray(gradings)) return [];
  const kept: CadGrading[] = [];
  for (const entry of gradings) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const course = candidate['sourceCourse'] as { vertexAId?: unknown; vertexBId?: unknown } | undefined;
    const built = createGradingDefinition({
      id: candidate['id'] as string,
      name: candidate['name'] as string,
      sourceFeatureLineId: candidate['sourceFeatureLineId'] as string,
      vertexAId: course?.vertexAId as string,
      vertexBId: course?.vertexBId as string,
      ...(typeof candidate['targetSurfaceId'] === 'string'
        ? { targetSurfaceId: candidate['targetSurfaceId'] as string }
        : {}),
      side: candidate['side'] as CadGrading['side'],
      criterion: candidate['criterion'] as CadGrading['criterion'],
      maxSearchDistance: candidate['maxSearchDistance'] as number,
      curveChordTolerance: candidate['curveChordTolerance'] as number,
      ...(typeof candidate['layerId'] === 'string' ? { layerId: candidate['layerId'] } : {}),
      ...(typeof candidate['styleId'] === 'string' ? { styleId: candidate['styleId'] } : {}),
    });
    if (built.ok) kept.push(cloneCadGrading(built.value));
  }
  return kept;
};
