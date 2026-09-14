/**
 * Phase 12J.9 Track A — session model tests (synthetic literals only).
 */
import { describe, expect, it } from 'vitest';
import type { RawGnssFileMetadata } from '../../src/engine/gnssRawTypes';
import type { RawOccupationMeta } from '../../src/engine/gnssRawSessionModel';
import {
  detectDuplicates,
  edgeWindow,
  occupationIdentity,
  overlapMatrix,
  planSessionInterval,
  resolveSessionAntennas,
  resolveSessionWindow,
  sessionIdentity,
  validateIntakeSize,
} from '../../src/engine/gnssRawSessionModel';

const meta = (over: Partial<RawGnssFileMetadata> & { marker?: string | null }): RawGnssFileMetadata => ({
  role: 'BASE',
  fileName: 'a.06o',
  sha256: 'sha-a',
  rinexVersion: '2.10',
  marker: 'A',
  approxXyz: [1, 2, 3],
  antennaModel: 'SYN-GENX00      NONE',
  antennaHeight: 0,
  antennaEast: 0,
  antennaNorth: 0,
  receiverModel: 'SYNTHRCV',
  firstEpoch: '2024-01-01T00:00:00.000Z',
  lastEpoch: '2024-01-01T01:00:00.000Z',
  intervalSeconds: 30,
  constellations: ['G'],
  signals: ['L1', 'L2'],
  ...over,
});

const occ = (
  marker: string,
  over: Partial<RawGnssFileMetadata> = {},
  epochCount = 120,
  sha = `sha-${marker}`,
): RawOccupationMeta => ({
  meta: meta({ marker, sha256: sha, fileName: `${marker}.06o`, ...over }),
  epochCount,
});

describe('occupation identity', () => {
  it('is deterministic and ignores fileName', () => {
    const a = occ('A');
    const renamed: RawOccupationMeta = { ...a, meta: { ...a.meta, fileName: 'renamed.06o' } };
    expect(occupationIdentity(renamed).occupationId).toBe(occupationIdentity(a).occupationId);
    expect(occupationIdentity(a).fileName).toBe('A.06o');
  });

  it('session identity is invariant under upload order', () => {
    const set = [occ('A'), occ('B'), occ('C')];
    expect(sessionIdentity(set)).toBe(sessionIdentity([...set].reverse()));
  });

  it('rejects sizes outside 2-20', () => {
    expect(validateIntakeSize([occ('A')]).ok).toBe(false);
    expect(validateIntakeSize([occ('A'), occ('B')]).ok).toBe(true);
  });
});

describe('overlap and window', () => {
  it('intersects spans and blocks zero overlap fail-closed', () => {
    const a = occ('A');
    const b = occ('B', { firstEpoch: '2024-01-01T00:30:00.000Z', lastEpoch: '2024-01-01T01:30:00.000Z' });
    const m = overlapMatrix([a, b]);
    expect(m[0]![1]!.overlaps).toBe(true);
    expect(m[0]![1]!.start).toBe('2024-01-01T00:30:00.000Z');
    const w = resolveSessionWindow([a, b], { mode: 'AUTO' });
    expect(w.ok).toBe(true);
    const far = occ('C', { firstEpoch: '2024-01-02T00:00:00.000Z', lastEpoch: '2024-01-02T01:00:00.000Z' });
    const blocked = resolveSessionWindow([a, far], { mode: 'AUTO' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('NO_COMMON_TIME');
    expect(edgeWindow(a, far).ok).toBe(false);
  });
});

describe('duplicates', () => {
  it('warns on exact hash dup, same marker/time dup, decimated alternate', () => {
    const a = occ('A', {}, 120, 'same-sha');
    const b = occ('B', {}, 60, 'same-sha');
    expect(detectDuplicates([a, b]).some((w) => w.includes('duplicate input'))).toBe(true);
    const c = occ('A', { fileName: 'a2.06o' }, 120, 'sha-other');
    expect(detectDuplicates([a, c]).some((w) => w.includes('duplicate occupation'))).toBe(true);
    const full = occ('A', { intervalSeconds: 15 }, 240, 'sha-full');
    const deci = occ('A', { intervalSeconds: 30 }, 120, 'sha-deci');
    expect(detectDuplicates([full, deci]).some((w) => w.includes('decimated'))).toBe(true);
  });
});

describe('interval plan', () => {
  it('resolves AUTO from the common set and warns on mixed intervals', () => {
    const plan = planSessionInterval([occ('A'), occ('B', { intervalSeconds: 15 })], 'AUTO');
    expect(plan.resolved).toBe(22.5);
    expect(plan.warnings.some((w) => w.includes('mixed'))).toBe(true);
    expect(plan.requested).toBe('AUTO');
    expect(plan.stochastic.status).toBe('FORMAL_UNCALIBRATED');
    const explicit = planSessionInterval([occ('A')], 15);
    expect(explicit.resolved).toBe(15);
  });
});

describe('antenna table', () => {
  it('reports PARTIAL when one station is unknown and flags the baseline', () => {
    const named = occ('A');
    const blank = occ('B', { antennaModel: '' });
    const table = resolveSessionAntennas([named, blank], [{ from: 'A', to: 'B' }]);
    expect(table.overall).toBe('NONE');
    expect(table.baselineNotes).toEqual(['ANTENNA CALIBRATION INCOMPLETE: A->B']);
    expect(table.stations.map((s) => s.status).sort()).toEqual(['UNAVAILABLE', 'UNKNOWN']);
  });
});
