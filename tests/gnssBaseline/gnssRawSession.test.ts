/**
 * Phase 12J.5 — session-composition evidence tests (agent tier, fast).
 *
 * EVIDENCE ONLY: synthetic literals, no vendor bytes, no production changes.
 * Locks deterministic grouping, review warnings, star selection, table shape,
 * and v1 JSON compatibility of gnssRawSession.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRawBaselineExport,
  parseRawBaselineExport,
  serializeRawBaselineExport,
} from '../../src/engine/gnssRawExport';
import {
  assignDependencyGroup,
  composeSession,
  selectSpanningTree,
  SESSION_REVIEW_HEADER,
  sessionReviewTable,
} from '../../src/engine/gnssRawSession';
import type { RawSessionInput } from '../../src/engine/gnssRawSession';
import { MARKER_TO_MARKER_ECEF } from '../../src/engine/gnssRawTypes';
import type {
  ProcessedRawGnssBaseline,
  RawGnssAntennaAssessment,
  RawGnssFileMetadata,
  RawGnssProcessingOptions,
} from '../../src/engine/gnssRawTypes';

const endpoint = (marker: string) => ({
  marker,
  model: 'TRIMBLE Zephyr 3',
  calibration: 'CALIBRATION_EXACT' as const,
  height: 2,
  east: 0,
  north: 0,
});

const antenna = (overall: RawGnssAntennaAssessment['overall']): RawGnssAntennaAssessment => ({
  base: endpoint('P041'),
  rover: endpoint('sixtwo'),
  overall,
  warning: overall === 'FULL' ? null : 'missing calibration',
});

const makeResult = (overrides?: Partial<ProcessedRawGnssBaseline>): ProcessedRawGnssBaseline => ({
  status: 'FIXED',
  acceptance: 'PROCESSING_ACCEPTED',
  acceptanceNotes: [],
  from: 'P041',
  to: 'sixtwo',
  deltaX: 5822.646,
  deltaY: -5654.885,
  deltaZ: -4846.085,
  baselineLength: 9400.123,
  covariance: { xx: 25e-6, xy: 1e-6, xz: -1e-6, yy: 36e-6, yz: 2e-6, zz: 49e-6 },
  covarianceAssessment: {
    model: 'RTKLIB_FORMAL',
    calibration: 'UNCALIBRATED',
    status: 'FORMAL_UNCALIBRATED',
    finite: true,
    spd: true,
  },
  coordinateReference: MARKER_TO_MARKER_ECEF,
  referenceFrame: 'ITRF2020@2020.0',
  start: '2026-09-01T00:00:00.000Z',
  stop: '2026-09-01T01:30:00.000Z',
  solutionQuality: { ratio: 8.5, fixedEpochs: 100, usedEpochs: 120, satellites: 9 },
  antennaAssessment: antenna('FULL'),
  provenance: {
    processor: 'rnx2rtkp 2.5.1 @62d4677',
    emccVersion: 'emcc-test',
    compileFlags: [],
    baseObsSha256: 'base-sha',
    roverObsSha256: 'rover-sha',
    navSha256: ['nav-sha'],
    sp3Sha256: null,
    optionsHash: 'fnv1a-00000000',
    intervalRequested: 'AUTO',
    intervalResolved: 30,
    elevationMaskResolved: 10,
    ephemerisRequested: 'BROADCAST',
    ephemerisUsed: 'BROADCAST',
    processedAt: '2026-09-01T02:00:00.000Z',
  },
  diagnostics: [],
  ...overrides,
});

const input = (
  result: ProcessedRawGnssBaseline,
  baseObsSha = 'base-sha',
  roverObsSha = 'rover-sha',
): RawSessionInput => ({ result, baseObsSha, roverObsSha });

const fileMeta = (role: RawGnssFileMetadata['role'], name: string): RawGnssFileMetadata => ({
  role,
  fileName: name,
  sha256: `${role}-sha`,
  rinexVersion: '3.04',
  marker: role === 'BASE' ? 'P041' : 'sixtwo',
  approxXyz: null,
  antennaModel: 'TRIMBLE Zephyr 3',
  antennaHeight: 2,
  antennaEast: 0,
  antennaNorth: 0,
  receiverModel: null,
  firstEpoch: '2026-09-01T00:00:00.000Z',
  lastEpoch: '2026-09-01T01:30:00.000Z',
  intervalSeconds: 30,
  constellations: ['G'],
  signals: ['L1', 'L2'],
});

const options: RawGnssProcessingOptions = {
  elevationMaskDegrees: 10,
  intervalRequested: 'AUTO',
  ephemerisRequested: 'BROADCAST',
  windowStart: null,
  windowStop: null,
};

describe('gnssRawSession dependency groups', () => {
  it('assignDependencyGroup is order-independent (sorted hashes)', () => {
    const a = assignDependencyGroup({ baseObsSha: 'aaa', roverObsSha: 'bbb' });
    const b = assignDependencyGroup({ baseObsSha: 'bbb', roverObsSha: 'aaa' });
    expect(a).toBe(b);
    expect(a).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });

  it('distinct hashes land in distinct groups', () => {
    const a = assignDependencyGroup({ baseObsSha: 'aaa', roverObsSha: 'bbb' });
    const b = assignDependencyGroup({ baseObsSha: 'aaa', roverObsSha: 'ccc' });
    expect(a).not.toBe(b);
  });

  it('members sharing any input hash land in the same group', () => {
    const review = composeSession(
      [
        input(makeResult({ from: 'P041', to: 'A' }), 'base-1', 'rover-1'),
        input(makeResult({ from: 'P041', to: 'B' }), 'base-1', 'rover-2'),
      ],
      'S1',
      '2026-09-01T00:00:00.000Z',
    );
    expect(review.members[0].dependencyGroup).toBe(review.members[1].dependencyGroup);
  });

  it('fully disjoint inputs land in distinct groups', () => {
    const review = composeSession(
      [
        input(makeResult({ from: 'P041', to: 'A' }), 'base-1', 'rover-1'),
        input(makeResult({ from: 'P041', to: 'B' }), 'base-2', 'rover-2'),
      ],
      'S1',
      '2026-09-01T00:00:00.000Z',
    );
    expect(review.members[0].dependencyGroup).not.toBe(review.members[1].dependencyGroup);
  });
});

describe('gnssRawSession review warnings', () => {
  it('FLOAT members are diagnostic-only with a warning', () => {
    const review = composeSession([input(makeResult({ status: 'FLOAT' }))], 'S1', '2026-09-01T00:00:00.000Z');
    expect(review.members[0].role).toBe('DIAGNOSTIC');
    expect(review.members[0].includeInReview).toBe(false);
    expect(review.warnings.some((w) => w.includes('FLOAT'))).toBe(true);
  });

  it('shared-observation groups warn that members are not independent', () => {
    const review = composeSession(
      [
        input(makeResult({ from: 'P041', to: 'A' }), 'base-1', 'rover-1'),
        input(makeResult({ from: 'P041', to: 'B' }), 'base-1', 'rover-2'),
      ],
      'S1',
      '2026-09-01T00:00:00.000Z',
    );
    expect(review.warnings.some((w) => w.includes('not independent'))).toBe(true);
  });

  it('PARTIAL antenna and uncalibrated formal covariance warn', () => {
    const review = composeSession(
      [input(makeResult({ antennaAssessment: antenna('PARTIAL') }))],
      'S1',
      '2026-09-01T00:00:00.000Z',
    );
    expect(review.warnings.some((w) => w.includes('PARTIAL'))).toBe(true);
    expect(review.warnings.some((w) => w.includes('uncalibrated'))).toBe(true);
  });

  it('empty input never throws and carries a warning', () => {
    const review = composeSession([], 'S1', '2026-09-01T00:00:00.000Z');
    expect(review.members).toEqual([]);
    expect(review.warnings.length).toBeGreaterThanOrEqual(1);
    expect(selectSpanningTree(review)).toEqual([]);
    expect(sessionReviewTable(review)).toEqual([[...SESSION_REVIEW_HEADER]]);
  });
});

describe('gnssRawSession spanning tree', () => {
  it('keeps one member per unique to around the most-frequent from base', () => {
    const review = composeSession(
      [
        input(makeResult({ from: 'P041', to: 'A' }), 'b1', 'r1'),
        input(makeResult({ from: 'P041', to: 'B' }), 'b1', 'r2'),
        input(makeResult({ from: 'A', to: 'B' }), 'b3', 'r3'),
      ],
      'S1',
      '2026-09-01T00:00:00.000Z',
    );
    const tree = selectSpanningTree(review);
    expect(tree).toHaveLength(3);
    const winners = tree.filter((m) => m.role !== 'REDUNDANT');
    expect(winners.map((m) => `${m.result.from}->${m.result.to}`).sort()).toEqual([
      'P041->A',
      'P041->B',
    ]);
  });

  it('prefers FIXED over FLOAT for the same to, deterministically', () => {
    const mk = (status: 'FIXED' | 'FLOAT', sha: string) =>
      input(
        makeResult({ from: 'P041', to: 'A', status, solutionQuality: { ratio: status === 'FIXED' ? 3 : 99, fixedEpochs: 10, usedEpochs: 20, satellites: 8 } }),
        'b1',
        sha,
      );
    const review = composeSession([mk('FLOAT', 'r1'), mk('FIXED', 'r2')], 'S1', '2026-09-01T00:00:00.000Z');
    const once = selectSpanningTree(review).filter((m) => m.role !== 'REDUNDANT');
    // Same selection regardless of input order.
    const flipped = composeSession([mk('FIXED', 'r2'), mk('FLOAT', 'r1')], 'S1', '2026-09-01T00:00:00.000Z');
    const twice = selectSpanningTree(flipped).filter((m) => m.role !== 'REDUNDANT');
    expect(once).toHaveLength(1);
    expect(once[0].result.status).toBe('FIXED');
    expect(twice[0].result.status).toBe('FIXED');
  });
});

describe('gnssRawSession table and v1 compat', () => {
  it('table has a header row first and REVIEW_ONLY survey status', () => {
    const review = composeSession([input(makeResult())], 'S1', '2026-09-01T00:00:00.000Z');
    const table = sessionReviewTable(review);
    expect(table[0]).toEqual([...SESSION_REVIEW_HEADER]);
    expect(table).toHaveLength(2);
    const row = table[1];
    expect(row[0]).toBe('P041->sixtwo');
    expect(row[1]).toBe('FIXED');
    expect(row[2]).toBe('8.5');
    expect(row[3]).toBe('90.0');
    expect(row[4]).toBe('9');
    expect(row[5]).toBe('FULL');
    expect(Number(row[6])).toBeGreaterThan(0);
    expect(Number(row[7])).toBeGreaterThan(0);
    expect(Number(row[8])).toBeGreaterThan(0);
    expect(row[9]).toBe('REVIEW_ONLY');
    expect(row[10]).toHaveLength(8);
  });

  it('session fields live outside the v1 result object (JSON unchanged)', () => {
    const result = makeResult();
    const before = JSON.stringify(result);
    const review = composeSession([input(result)], 'S1', '2026-09-01T00:00:00.000Z');
    expect(JSON.stringify(review.members[0].result)).toBe(before);
    expect('sessionId' in review.members[0].result).toBe(false);
    expect('dependencyGroup' in review.members[0].result).toBe(false);
    expect(review.members[0].sessionId).toBe('S1');
  });

  it('member results still round-trip through the v1 export parser', () => {
    const review = composeSession([input(makeResult())], 'S1', '2026-09-01T00:00:00.000Z');
    const doc = buildRawBaselineExport(
      fileMeta('BASE', 'base.obs'),
      fileMeta('ROVER', 'rover.obs'),
      options,
      review.members[0].result,
    );
    const parsed = parseRawBaselineExport(serializeRawBaselineExport(doc));
    expect(parsed.result.from).toBe('P041');
    expect(parsed.result.to).toBe('sixtwo');
    expect(parsed.result.covariance).toEqual(review.members[0].result.covariance);
  });
});
