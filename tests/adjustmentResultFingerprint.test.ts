import { describe, expect, it } from 'vitest';

import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import {
  ADJUSTMENT_RESULT_FINGERPRINT_VERSION,
  buildAdjustmentResultFingerprint,
} from '../src/engine/adjustmentResultFingerprint';
import {
  buildFieldToFinishLink,
  buildSourceRevision,
  computeSyncStatus,
} from '../src/engine/fieldToFinish/linkedSync';

const baseResult = (): AdjustmentResult => ({
  success: true,
  converged: true,
  iterations: 3,
  stations: {
    B: { x: 1000.5, y: 2000.25, h: 100.125, fixed: false, lost: false },
    A: { x: 999, y: 1999, h: 99, fixed: true, fixedX: true, fixedY: true, fixedH: true, constraintModeX: 'fixed', lost: false },
  },
  observations: [],
  logs: ['solved'],
  seuw: 1.02,
  dof: 4,
  sideshots: [
    { id: 'ss1', from: 'A', to: 'S1', mode: 'slope', hasAzimuth: true, distance: 10, horizDistance: 9.9, easting: 1010, northing: 2005, height: 99.5 },
    { id: 'ss2', from: 'B', to: 'S2', mode: 'gps', hasAzimuth: false, distance: 20, horizDistance: 20, easting: 1020, northing: 2010 },
  ],
});

describe('adjustment result fingerprint', () => {
  it('is versioned with the fnv1a convention', () => {
    expect(ADJUSTMENT_RESULT_FINGERPRINT_VERSION).toBe('adjustment-result/v1');
    expect(buildAdjustmentResultFingerprint(baseResult()).startsWith('fnv1a:')).toBe(true);
  });

  it('is stable for the same result', () => {
    expect(buildAdjustmentResultFingerprint(baseResult())).toBe(buildAdjustmentResultFingerprint(baseResult()));
  });

  it('is order-insensitive to station/sideshot insertion order', () => {
    const reordered = baseResult();
    reordered.stations = {
      A: reordered.stations['A'] as (typeof reordered.stations)[string],
      B: reordered.stations['B'] as (typeof reordered.stations)[string],
    };
    reordered.sideshots = [...(reordered.sideshots ?? [])].reverse();
    expect(buildAdjustmentResultFingerprint(reordered)).toBe(buildAdjustmentResultFingerprint(baseResult()));
  });

  it('changes when one station coordinate changes', () => {
    const altered = baseResult();
    altered.stations = { ...altered.stations, B: { ...altered.stations['B'], x: 1000.51 } };
    expect(buildAdjustmentResultFingerprint(altered)).not.toBe(buildAdjustmentResultFingerprint(baseResult()));
  });

  it('changes when one sideshot coordinate changes', () => {
    const altered = baseResult();
    altered.sideshots = (altered.sideshots ?? []).map((shot) =>
      shot.id === 'ss1' ? { ...shot, easting: 1010.001 } : shot);
    expect(buildAdjustmentResultFingerprint(altered)).not.toBe(buildAdjustmentResultFingerprint(baseResult()));
  });

  it('ignores UI-only diffs such as logs and stats', () => {
    const altered = baseResult();
    altered.logs = [...altered.logs, 'rendered report tab'];
    altered.seuw = 9.99;
    altered.iterations = 42;
    expect(buildAdjustmentResultFingerprint(altered)).toBe(buildAdjustmentResultFingerprint(baseResult()));
  });

  it('treats numerically identical coordinates the same however they were computed', () => {
    const left = baseResult();
    const right = baseResult();
    // Same double via different arithmetic: TS vs native builds must agree.
    right.stations = { ...right.stations, B: { ...right.stations['B'], x: 1000 + 0.5 } };
    expect(right.stations['B'].x).toBe(left.stations['B'].x);
    expect(buildAdjustmentResultFingerprint(right)).toBe(buildAdjustmentResultFingerprint(left));
  });

  describe('f2f link migration', () => {
    const linkInit = {
      generationRunId: 'run-1',
      catalogId: 'cat',
      catalogRevision: '1',
      sourceKind: 'adjustment' as const,
      sourceRecordIds: [],
      stationIds: ['A'],
      generatedEntityIds: [],
      generatedLabelIds: [],
    };

    it('stamps the result fingerprint as the authoritative sourceRevision', () => {
      const resultFp = buildAdjustmentResultFingerprint(baseResult());
      const link = buildFieldToFinishLink({ ...linkInit, inputFingerprint: 'fnv1a:a', settingsFingerprint: 'fnv1a:b', resultFingerprint: resultFp });
      expect(link.sourceRevision).toBe(resultFp);
      expect(link.inputFingerprint).toBe('fnv1a:a');
      expect(link.resultFingerprint).toBe(resultFp);
      expect(buildSourceRevision({ inputFingerprint: 'fnv1a:a', settingsFingerprint: 'fnv1a:b', resultFingerprint: resultFp })).toBe(resultFp);
    });

    it('fails closed: legacy composite links never read CURRENT against a result snapshot', () => {
      const legacy = buildFieldToFinishLink({ ...linkInit, inputFingerprint: 'fnv1a:a', settingsFingerprint: 'fnv1a:b' });
      expect(legacy.sourceRevision).toBe('fnv1a:a:fnv1a:b');
      expect(computeSyncStatus(legacy, { sourceRevision: buildAdjustmentResultFingerprint(baseResult()) })).toBe('COORDINATES_CHANGED');
    });
  });

  it('treats -0 and +0 as the same coordinate', () => {
    const altered = baseResult();
    altered.stations = { ...altered.stations, B: { ...altered.stations['B'], x: -0 } };
    const zeroed = baseResult();
    zeroed.stations = { ...zeroed.stations, B: { ...zeroed.stations['B'], x: 0 } };
    expect(buildAdjustmentResultFingerprint(altered)).toBe(buildAdjustmentResultFingerprint(zeroed));
  });
});
