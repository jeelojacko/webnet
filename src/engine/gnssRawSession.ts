/**
 * Phase 12J.5 — raw session composition evidence (EVIDENCE ONLY).
 *
 * Pure, deterministic helpers for grouping reviewed raw baselines into a
 * survey session WITHOUT promoting them to solve observations. Everything
 * here stays REVIEW_ONLY: dependency groups flag shared-observation
 * (non-independent) legs, the spanning-tree selection is a star shortlist,
 * and the review table is display text. Nothing enters the adjustment.
 *
 * No solver/adjustment imports. The only engine import is the pure
 * ECEF->ENU rotation pair from gnssStochasticEvidence for display sigmas.
 */
import { ecefToEnuRotation, rotateCovariance } from './gnssStochasticEvidence';
import type { ProcessedRawGnssBaseline } from './gnssRawTypes';

export type RawSessionRole = 'SPANNING' | 'REDUNDANT' | 'DIAGNOSTIC';

export interface RawSessionMember {
  readonly result: ProcessedRawGnssBaseline;
  readonly sessionId: string;
  /** Deterministic group id; members sharing any input hash share a group. */
  readonly dependencyGroup: string;
  readonly role: RawSessionRole;
  readonly includeInReview: boolean;
}

export interface RawSessionReview {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly members: RawSessionMember[];
  readonly warnings: string[];
}

/** One baseline plus the content hashes of the RINEX inputs that made it. */
export interface RawSessionInput {
  readonly result: ProcessedRawGnssBaseline;
  readonly baseObsSha: string;
  readonly roverObsSha: string;
}

/** Portable FNV-1a hex (same construction as hashOptions; pure TS, no crypto). */
const fnv1aHex = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
};

/**
 * Deterministic group id from the sorted pair of content hashes, so hash
 * order never matters. Baselines sharing any input file hash land in the
 * same group via union-find in composeSession (this pair hash is the
 * singleton-component case of that grouping).
 */
export const assignDependencyGroup = (hashes: {
  readonly baseObsSha: string;
  readonly roverObsSha: string;
}): string => fnv1aHex([...[hashes.baseObsSha, hashes.roverObsSha].sort()].join('|'));

const groupIdForComponent = (hashes: readonly string[]): string =>
  fnv1aHex([...hashes].sort().join('|'));

/**
 * Build a review session. Never throws on empty input: returns an empty
 * review carrying a warning. The v1 result objects are referenced as-is —
 * sessionId/dependencyGroup live on the member wrapper only. `createdAt` is
 * caller-supplied so this function stays pure and deterministic.
 */
export const composeSession = (
  inputs: readonly RawSessionInput[],
  sessionId: string,
  createdAt: string,
): RawSessionReview => {
  if (inputs.length === 0) {
    return {
      sessionId,
      createdAt,
      members: [],
      warnings: [`session ${sessionId} has no members`],
    };
  }
  // Union-find over members: union when they share any input hash.
  const parent = inputs.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const hashOwners = new Map<string, number>();
  inputs.forEach((input, i) => {
    for (const h of [input.baseObsSha, input.roverObsSha]) {
      const owner = hashOwners.get(h);
      if (owner === undefined) hashOwners.set(h, i);
      else union(owner, i);
    }
  });
  const componentHashes = new Map<number, string[]>();
  inputs.forEach((input, i) => {
    const root = find(i);
    const list = componentHashes.get(root) ?? [];
    list.push(input.baseObsSha, input.roverObsSha);
    componentHashes.set(root, list);
  });
  const componentGroup = new Map<number, string>();
  for (const [root, hashes] of componentHashes) {
    componentGroup.set(root, groupIdForComponent(hashes));
  }
  const componentSize = new Map<number, number>();
  inputs.forEach((_, i) => {
    const root = find(i);
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  });

  const members: RawSessionMember[] = inputs.map((input, i) => {
    const diagnostic = input.result.status === 'FLOAT';
    return {
      result: input.result,
      sessionId,
      dependencyGroup: componentGroup.get(find(i)) ?? assignDependencyGroup(input),
      role: diagnostic ? 'DIAGNOSTIC' : 'SPANNING',
      includeInReview: input.result.status === 'FIXED',
    };
  });

  const warnings: string[] = [];
  if (members.some((m) => m.result.covarianceAssessment.status === 'FORMAL_UNCALIBRATED')) {
    warnings.push(
      'formal covariance is uncalibrated processor precision; not survey weighting',
    );
  }
  members.forEach((m) => {
    const label = `${m.result.from}->${m.result.to}`;
    if (m.result.status === 'FLOAT') {
      warnings.push(`${label} is FLOAT: diagnostic-only, not a survey baseline`);
    }
    if (m.result.antennaAssessment.overall !== 'FULL') {
      warnings.push(
        `${label} antenna calibration ${m.result.antennaAssessment.overall}: ` +
          'unmodelled phase-center effects possible',
      );
    }
  });
  const warnedGroups = new Set<string>();
  members.forEach((m, i) => {
    const root = find(i);
    const size = componentSize.get(root) ?? 1;
    if (size > 1 && !warnedGroups.has(m.dependencyGroup)) {
      warnedGroups.add(m.dependencyGroup);
      warnings.push(
        `group ${m.dependencyGroup.slice(-8)} shares input observations ` +
          `across ${size} baselines; members are not independent`,
      );
    }
  });
  return { sessionId, createdAt, members, warnings };
};

const statusRank = (status: ProcessedRawGnssBaseline['status']): number =>
  status === 'FIXED' ? 0 : status === 'FLOAT' ? 1 : 2;

const ratioOrFloor = (ratio: number | null): number =>
  ratio === null || !Number.isFinite(ratio) ? Number.NEGATIVE_INFINITY : ratio;

/**
 * Deterministic star shortlist: base = most frequent `from` (lexicographic
 * tie-break); one member kept per unique `to` (FIXED over FLOAT, then higher
 * ratio, then base leg, then lexicographic label, then group). Winners keep
 * their role; losers are marked REDUNDANT. Pure: returns new member objects.
 */
export const selectSpanningTree = (review: RawSessionReview): RawSessionMember[] => {
  if (review.members.length === 0) return [];
  const fromCounts = new Map<string, number>();
  for (const m of review.members) {
    fromCounts.set(m.result.from, (fromCounts.get(m.result.from) ?? 0) + 1);
  }
  let base = '';
  let bestCount = -1;
  for (const [from, n] of fromCounts) {
    if (n > bestCount || (n === bestCount && from < base)) {
      base = from;
      bestCount = n;
    }
  }
  const byTo = new Map<string, number[]>();
  review.members.forEach((m, i) => {
    const list = byTo.get(m.result.to) ?? [];
    list.push(i);
    byTo.set(m.result.to, list);
  });
  const winners = new Set<number>();
  for (const [, indices] of byTo) {
    const ordered = [...indices].sort((a, b) => {
      const ma = review.members[a];
      const mb = review.members[b];
      const rank = statusRank(ma.result.status) - statusRank(mb.result.status);
      if (rank !== 0) return rank;
      const ratio =
        ratioOrFloor(mb.result.solutionQuality.ratio) -
        ratioOrFloor(ma.result.solutionQuality.ratio);
      if (ratio !== 0) return ratio;
      const star =
        (ma.result.from === base ? 0 : 1) - (mb.result.from === base ? 0 : 1);
      if (star !== 0) return star;
      const labelA = `${ma.result.from}->${ma.result.to}`;
      const labelB = `${mb.result.from}->${mb.result.to}`;
      if (labelA !== labelB) return labelA < labelB ? -1 : 1;
      if (ma.dependencyGroup !== mb.dependencyGroup) {
        return ma.dependencyGroup < mb.dependencyGroup ? -1 : 1;
      }
      return a - b;
    });
    winners.add(ordered[0]);
  }
  return review.members.map((m, i) =>
    winners.has(i) ? m : { ...m, role: 'REDUNDANT' as const },
  );
};

export const SESSION_REVIEW_HEADER = [
  'baseline',
  'solution',
  'ratio',
  'durationMin',
  'sats',
  'antenna',
  'sigmaE_mm',
  'sigmaN_mm',
  'sigmaU_mm',
  'surveyStatus',
  'depGroup',
] as const;

const fmtSigmaMm = (variance: number): string => {
  if (!Number.isFinite(variance) || variance < 0) return 'n/a';
  return (Math.sqrt(variance) * 1000).toFixed(2);
};

const fmtDurationMin = (start: string, stop: string): string => {
  const ms = Date.parse(stop) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  return (ms / 60000).toFixed(1);
};

/**
 * Display-only review table, header row first. Formal sigmas are rotated to
 * ENU at the baseline vector direction (evidence-only display proxy: the v1
 * result carries no absolute position) and shown in mm. Survey status is
 * always REVIEW_ONLY — this table never authorizes survey use.
 */
export const sessionReviewTable = (review: RawSessionReview): string[][] => {
  const rows = review.members.map((m) => {
    const r = m.result;
    const enu = rotateCovariance(
      r.covariance,
      ecefToEnuRotation([r.deltaX, r.deltaY, r.deltaZ]),
    );
    return [
      `${r.from}->${r.to}`,
      r.status,
      r.solutionQuality.ratio === null ? 'n/a' : String(r.solutionQuality.ratio),
      fmtDurationMin(r.start, r.stop),
      String(r.solutionQuality.satellites),
      r.antennaAssessment.overall,
      fmtSigmaMm(enu.xx),
      fmtSigmaMm(enu.yy),
      fmtSigmaMm(enu.zz),
      'REVIEW_ONLY',
      m.dependencyGroup.slice(-8),
    ];
  });
  return [[...SESSION_REVIEW_HEADER], ...rows];
};
