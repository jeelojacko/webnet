/**
 * Phase 12J.4 — agent-tier tests for the pre-WASM raw-GNSS preflight gate.
 *
 * Every listed error code is reached by at least one case. Fixtures are
 * synthetic (see tests/fixtures/gnssRaw/generate.mjs).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../src/engine/gnssRawHash';
import type {
  PreflightInput,
  PreflightInputFile,
} from '../../src/engine/gnssRawPreflight';
import {
  assessAntennas,
  classifyAntenna,
  deriveInterval,
  preflightRawGnss,
} from '../../src/engine/gnssRawPreflight';
import { NO_CALIBRATION_WARNING } from '../../src/engine/gnssRawTypes';

const FX = 'tests/fixtures/gnssRaw';
const textOf = (name: string): string => readFileSync(`${FX}/${name}`, 'utf8');

async function file(name: string): Promise<PreflightInputFile> {
  const text = textOf(name);
  return {
    fileName: name,
    sha256: await sha256Hex(new TextEncoder().encode(text)),
    text,
  };
}

async function baseInput(
  overrides: Partial<PreflightInput> = {},
  optionOverrides: Partial<PreflightInput['options']> = {},
): Promise<PreflightInput> {
  return {
    base: await file('base.06o'),
    rover: await file('rover.06o'),
    nav: [await file('nav.06n')],
    sp3: null,
    options: {
      elevationMaskDegrees: 10,
      intervalRequested: 'AUTO',
      ephemerisRequested: 'BROADCAST',
      windowStart: null,
      windowStop: null,
      ...optionOverrides,
    },
    ...overrides,
  };
}

describe('preflightRawGnss accept path', () => {
  it('accepts the synthetic base pair with AUTO interval', async () => {
    const res = preflightRawGnss(await baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commonStart).toBe('2024-01-01T00:00:00.000Z');
    expect(res.commonStop).toBe('2024-01-01T00:06:00.000Z');
    expect(res.resolvedInterval).toBe(30);
    expect(res.warnings).toEqual([]);
    expect(res.base.role).toBe('BASE');
    expect(res.rover.role).toBe('ROVER');
    expect(res.base.sha256).toHaveLength(64);
    expect(res.rover.constellations).toContain('G');
  });

  it('honours an explicit interval', async () => {
    const res = preflightRawGnss(await baseInput({}, { intervalRequested: 15 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolvedInterval).toBe(15);
  });

  it('warns when the header interval disagrees with observed epochs', async () => {
    const input = await baseInput();
    const edited: PreflightInputFile = {
      ...input.rover,
      text: input.rover.text.replace('    30.000                                                  INTERVAL', '    15.000                                                  INTERVAL'),
    };
    const res = preflightRawGnss({ ...input, rover: edited });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('rover');
  });
});

describe('preflightRawGnss rejections', () => {
  it('NO_COMMON_TIME for the shifted rover', async () => {
    const input = await baseInput({ rover: await file('rover_nooverlap.06o') });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NO_COMMON_TIME');
  });

  it('MISSING_NAV when no nav file is provided', async () => {
    const res = preflightRawGnss(await baseInput({ nav: [] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('MISSING_NAV');
  });

  it('NO_GPS_OBSERVATIONS for the Galileo-only file', async () => {
    const input = await baseInput({ rover: await file('galileo_only.06o') });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NO_GPS_OBSERVATIONS');
  });

  it('NO_DUAL_FREQUENCY for the L1-only file', async () => {
    const input = await baseInput({ rover: await file('rover_l1only.06o') });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NO_DUAL_FREQUENCY');
  });

  it('accepts a version 4.01 pair (RINEX 4 keeps RINEX 3 epoch records)', async () => {
    const input = await baseInput({
      base: await file('r4base.24o'),
      rover: await file('r4rover.24o'),
    });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commonStart).toBe('2024-01-01T00:00:00.000Z');
    expect(res.resolvedInterval).toBe(30);
  });

  it('UNSUPPORTED_RINEX for a version 5.00 file', async () => {
    const input = await baseInput();
    const edited: PreflightInputFile = {
      ...input.base,
      text: input.base.text.replace('2.10', '5.00'),
    };
    const res = preflightRawGnss({ ...input, base: edited });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('UNSUPPORTED_RINEX');
  });

  it('INVALID_RINEX for the malformed file', async () => {
    const input = await baseInput({ base: await file('malformed.06o') });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INVALID_RINEX');
  });

  it('NAV_COVERAGE_MISSING for a header-only nav file', async () => {
    const input = await baseInput();
    const emptyNav: PreflightInputFile = {
      fileName: 'empty.06n',
      sha256: '0'.repeat(64),
      text: '     2.10           N: GPS NAV DATA                         RINEX VERSION / TYPE\n                                                            END OF HEADER\n',
    };
    const res = preflightRawGnss({ ...input, nav: [emptyNav] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NAV_COVERAGE_MISSING');
  });

  it('PRECISE_PRODUCT_MISSING when precise is requested without SP3', async () => {
    const res = preflightRawGnss(await baseInput({}, { ephemerisRequested: 'PRECISE' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PRECISE_PRODUCT_MISSING');
  });

  it('MEMORY_OR_SIZE_LIMIT for an oversized file', async () => {
    const input = await baseInput({}, { maxFileBytes: 16 });
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('MEMORY_OR_SIZE_LIMIT');
  });
});

describe('antenna assessment', () => {
  it('classifies blank models as unknown and named models as unavailable', () => {
    expect(classifyAntenna('')).toBe('ANTENNA_UNKNOWN');
    expect(classifyAntenna('   ')).toBe('ANTENNA_UNKNOWN');
    expect(classifyAntenna('SYN-GENX00      NONE')).toBe('CALIBRATION_UNAVAILABLE');
  });

  it('reports NONE plus the generic warning without ANTEX', async () => {
    const input = await baseInput();
    const res = preflightRawGnss(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.antennaAssessment.overall).toBe('NONE');
    expect(res.antennaAssessment.warning).toBe(NO_CALIBRATION_WARNING);
    expect(res.antennaAssessment.base.calibration).toBe('CALIBRATION_UNAVAILABLE');
  });

  it('marks a blank-model endpoint as unknown (PARTIAL/NONE, never FULL)', () => {
    const meta = {
      marker: 'X',
      antennaModel: '',
      antennaHeight: null,
      antennaEast: null,
      antennaNorth: null,
      fileName: 'x.06o',
    };
    const named = { ...meta, marker: 'Y', antennaModel: 'SYN-GENX00      NONE', fileName: 'y.06o' };
    const a = assessAntennas(named, meta);
    expect(a.rover.calibration).toBe('ANTENNA_UNKNOWN');
    expect(a.overall).toBe('NONE');
    expect(a.warning).toBe(NO_CALIBRATION_WARNING);
  });
});

describe('deriveInterval', () => {
  it('takes the median of epoch deltas, not a hardcoded value', () => {
    const t0 = Date.UTC(2024, 0, 1);
    expect(deriveInterval([t0, t0 + 15000, t0 + 30000, t0 + 45000])).toBe(15);
    expect(deriveInterval([t0])).toBeNull();
    expect(deriveInterval([])).toBeNull();
  });
});
