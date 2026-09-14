/**
 * Phase 12J.4 — agent-tier tests for RINEX OBS header parsing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  RinexParseError,
  parseRinexObs,
} from '../../src/engine/gnssRinexHeader';

const FX = 'tests/fixtures/gnssRaw';
const read = (name: string): string => readFileSync(`${FX}/${name}`, 'utf8');

describe('parseRinexObs (RINEX 2.10)', () => {
  it('parses the synthetic base file', () => {
    const p = parseRinexObs(read('base.06o'));
    expect(p.metadata.rinexVersion).toBe('2.10');
    expect(p.metadata.marker).toBe('SYNB');
    expect(p.metadata.approxXyz).toEqual([-1284945.5806, -4795482.1918, 3993386.8674]);
    expect(p.metadata.antennaModel).toBe('SYN-GENX00      NONE');
    expect(p.metadata.receiverModel).toBe('SYNTHRCV');
    expect(p.metadata.constellations).toContain('G');
    expect(p.metadata.signals).toEqual(['C1', 'L1', 'L2', 'P1', 'P2']);
    expect(p.metadata.intervalSeconds).toBe(30);
    expect(p.epochCount).toBe(13);
    expect(p.firstEpochMs).toBe(Date.UTC(2024, 0, 1, 0, 0, 0));
    expect(p.lastEpochMs).toBe(Date.UTC(2024, 0, 1, 0, 6, 0));
    expect(p.metadata.firstEpoch).toBe(new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString());
    expect(p.epochTimesMs.length).toBeGreaterThanOrEqual(13);
  });

  it('rejects malformed numerics fail-closed', () => {
    expect(() => parseRinexObs(read('malformed.06o'))).toThrow(RinexParseError);
  });

  it('rejects a missing END OF HEADER', () => {
    expect(() => parseRinexObs('     2.10           OBSERVATION DATA\n')).toThrow(RinexParseError);
  });
});

describe('parseRinexObs (RINEX 3.04)', () => {
  it('parses the synthetic RINEX 3 base file', () => {
    const p = parseRinexObs(read('r3base.24o'));
    expect(p.metadata.rinexVersion).toBe('3.04');
    expect(p.metadata.marker).toBe('SYNB');
    expect(p.metadata.constellations).toEqual(['G']);
    expect(p.metadata.signals).toContain('C1C');
    expect(p.metadata.signals).toContain('L2W');
    expect(p.epochCount).toBe(6);
    expect(p.metadata.approxXyz?.[0]).toBeCloseTo(-1284945.5806, 3);
  });
});
