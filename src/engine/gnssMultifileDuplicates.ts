/**
 * Phase 12H.1 — indexed GNSS duplicate detector (~O(n), no pairwise scan).
 *
 * Classes: LEGITIMATE / POSSIBLE_DUPLICATE / STRONG_DUPLICATE /
 * REVERSED_CANDIDATE. Warnings only except STRONG across different active
 * sources (blocks the run, naming both records). Never deletes.
 */
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import type { GnssMultifileProvenance } from './gnssMultifileComposition';

export type GnssDuplicateClass =
  | 'LEGITIMATE'
  | 'POSSIBLE_DUPLICATE'
  | 'STRONG_DUPLICATE'
  | 'REVERSED_CANDIDATE';

export interface GnssDuplicateCandidate {
  readonly baselineA: number;
  readonly baselineB: number;
  readonly class: GnssDuplicateClass;
  readonly reason: string;
  readonly blocksRun: boolean;
}

const VECTOR_TOL_M = 1e-9;
const COV_REL_TOL = 1e-9;

const vectorsClose = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= VECTOR_TOL_M &&
  Math.abs(a.y - b.y) <= VECTOR_TOL_M &&
  Math.abs(a.z - b.z) <= VECTOR_TOL_M;

const covariancesClose = (
  a: GnssBaselineObservation['covariance'],
  b: GnssBaselineObservation['covariance'],
): boolean => {
  const pairs: Array<[number, number]> = [
    [a.xx, b.xx],
    [a.xy, b.xy],
    [a.xz, b.xz],
    [a.yy, b.yy],
    [a.yz, b.yz],
    [a.zz, b.zz],
  ];
  return pairs.every(([x, y]) => {
    const scale = Math.max(1, Math.abs(x), Math.abs(y));
    return Math.abs(x - y) <= COV_REL_TOL * scale;
  });
};

const recordLabel = (
  baselines: readonly GnssBaselineObservation[],
  provenance: readonly GnssMultifileProvenance[],
  composedId: number,
): string => {
  const baseline = baselines[composedId - 1];
  const prov = provenance[composedId - 1];
  if (!baseline || !prov) return `#${composedId}`;
  return `${prov.sourceId} '${prov.fileName}' #${prov.originalId} (${baseline.from}->${baseline.to})`;
};

/**
 * Indexed classification over composed baselines. Same-endpoint groups
 * are bucketed by hash key; only within-bucket pairs compare (~O(n)).
 * Reversed pairs bucket by unordered endpoint key separately.
 */
export const classifyGnssDuplicates = (
  baselines: readonly GnssBaselineObservation[],
  provenance: readonly GnssMultifileProvenance[],
): GnssDuplicateCandidate[] => {
  const byEndpoints = new Map<string, number[]>();
  const byUnordered = new Map<string, number[]>();
  baselines.forEach((baseline, index) => {
    const id = index + 1;
    const ordered = `${baseline.from}->${baseline.to}`;
    const unordered =
      baseline.from < baseline.to
        ? `${baseline.from}|${baseline.to}`
        : `${baseline.to}|${baseline.from}`;
    const orderedGroup = byEndpoints.get(ordered) ?? [];
    orderedGroup.push(id);
    byEndpoints.set(ordered, orderedGroup);
    if (baseline.from !== baseline.to) {
      const unorderedGroup = byUnordered.get(unordered) ?? [];
      unorderedGroup.push(id);
      byUnordered.set(unordered, unorderedGroup);
    }
  });
  const candidates: GnssDuplicateCandidate[] = [];
  const provenanceOf = (id: number): GnssMultifileProvenance | undefined =>
    provenance[id - 1];
  byEndpoints.forEach((group) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const idA = group[i]!;
        const idB = group[j]!;
        const baseA = baselines[idA - 1]!;
        const baseB = baselines[idB - 1]!;
        const provA = provenanceOf(idA);
        const provB = provenanceOf(idB);
        const sameSource = !!provA && !!provB && provA.sourceId === provB.sourceId;
        const sameVectorId =
          !!provA &&
          !!provB &&
          provA.originalId === provB.originalId &&
          (provA.index === provB.index || sameSource);
        const sameSession =
          (baseA.sessionId ?? '') !== '' &&
          baseA.sessionId === baseB.sessionId &&
          (baseA.solutionId ?? '') !== '' &&
          baseA.solutionId === baseB.solutionId;
        const vectorSame =
          vectorsClose(baseA.vector, baseB.vector) && covariancesClose(baseA.covariance, baseB.covariance);
        if (sameVectorId && vectorSame && sameSession) {
          if (!sameSource && provA?.sourceId !== provB?.sourceId) {
            candidates.push({
              baselineA: idA,
              baselineB: idB,
              class: 'STRONG_DUPLICATE',
              reason:
                `STRONG_DUPLICATE ${recordLabel(baselines, provenance, idA)} vs ` +
                `${recordLabel(baselines, provenance, idB)} (same session/solution, identical vector).`,
              blocksRun: true,
            });
          } else if (sameSource) {
            // Same physical source added twice: project duplicate-source
            // protection owns this; math layer keeps both, warns only.
            candidates.push({
              baselineA: idA,
              baselineB: idB,
              class: 'POSSIBLE_DUPLICATE',
              reason:
                `POSSIBLE_DUPLICATE ${recordLabel(baselines, provenance, idA)} vs ` +
                `${recordLabel(baselines, provenance, idB)} (same source record repeated; kept, dedupe at project source list).`,
              blocksRun: false,
            });
          } else {
            // Metadata cannot support certainty across sources: downgrade.
            candidates.push({
              baselineA: idA,
              baselineB: idB,
              class: 'POSSIBLE_DUPLICATE',
              reason:
                `POSSIBLE_DUPLICATE ${recordLabel(baselines, provenance, idA)} vs ` +
                `${recordLabel(baselines, provenance, idB)} (identical vector but session/solution metadata insufficient for STRONG; kept).`,
              blocksRun: false,
            });
          }
        } else if (vectorSame) {
          candidates.push({
            baselineA: idA,
            baselineB: idB,
            class: 'POSSIBLE_DUPLICATE',
            reason:
              `POSSIBLE_DUPLICATE ${recordLabel(baselines, provenance, idA)} vs ` +
              `${recordLabel(baselines, provenance, idB)} (same endpoints, near-identical vector; kept for review).`,
            blocksRun: false,
          });
        }
        // Distinct vectors/sessions are LEGITIMATE: no candidate emitted.
      }
    }
  });
  byUnordered.forEach((group) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const idA = group[i]!;
        const idB = group[j]!;
        const baseA = baselines[idA - 1]!;
        const baseB = baselines[idB - 1]!;
        if (baseA.from === baseB.from) continue; // same direction handled above
        const negated = { x: -baseB.vector.x, y: -baseB.vector.y, z: -baseB.vector.z };
        if (baseA.from === baseB.to && baseA.to === baseB.from && vectorsClose(baseA.vector, negated)) {
          candidates.push({
            baselineA: idA,
            baselineB: idB,
            class: 'REVERSED_CANDIDATE',
            reason:
              `REVERSED_CANDIDATE ${recordLabel(baselines, provenance, idA)} vs ` +
              `${recordLabel(baselines, provenance, idB)} (endpoint swap + negated vector; kept, no auto-flip).`,
            blocksRun: false,
          });
        }
      }
    }
  });
  return candidates.sort(
    (left, right) => left.baselineA - right.baselineA || left.baselineB - right.baselineB,
  );
};

/** Blocking STRONG duplicates across different sources (empty when runnable). */
export const strongDuplicateBlocks = (
  candidates: readonly GnssDuplicateCandidate[],
): string[] =>
  candidates
    .filter((candidate) => candidate.blocksRun)
    .map((candidate) => `compose blocked: ${candidate.reason}`);
