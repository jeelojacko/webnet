import { describe, expect, it } from 'vitest';

import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import { buildValueFingerprint } from '../src/engine/qaWorkflowSnapshots';
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

  it('canonicalizes nontrivial ids with code-unit ordering independent of insertion order', () => {
    // Ids chosen so locale-aware numeric ordering (`P2` < `P10`) and
    // case folding disagree with code-unit order (`P10` < `P2`, all
    // uppercase before lowercase): the fingerprint must be stable and
    // match an explicitly code-unit-sorted reference.
    const ids = ['ST-10', 'ST-2', 'ST-1', 'st-1', 'P2', 'P10'];
    const stationsOf = (order: readonly string[]): AdjustmentResult['stations'] =>
      // Coords keyed by id (not position) so reorderings stay identical.
      Object.fromEntries(order.map((id) => {
        const index = ids.indexOf(id);
        return [id, { x: index, y: -index, h: index * 0.5, fixed: false, lost: false }];
      }));
    const rawShots = [
      { id: 'ss-2', from: 'ST-2', to: 'P10' },
      { id: 'ss-10', from: 'P10', to: 'ST-2' },
      { id: 'ss-1', from: 'ST-10', to: 'st-1' },
      { id: 'ss-0', from: 'P10', to: 'P2' },
    ];
    const shotsOf = (order: readonly { id: string; from: string; to: string }[]) => order.map((shot) => ({
      ...shot,
      mode: 'slope' as const,
      hasAzimuth: false,
      distance: 1,
      horizDistance: 1,
      easting: 1,
      northing: 2,
      height: 3,
    }));
    const sideways = (stationOrder: readonly string[], shotOrder: readonly { id: string; from: string; to: string }[]): AdjustmentResult => ({
      ...(baseResult()),
      stations: stationsOf(stationOrder),
      sideshots: shotsOf(shotOrder),
    });
    const forward = sideways(ids, rawShots);
    const reversed = sideways([...ids].reverse(), [...rawShots].reverse());
    expect(buildAdjustmentResultFingerprint(reversed)).toBe(buildAdjustmentResultFingerprint(forward));
    // Pin the comparator: code-unit order puts `P10` before `P2` and
    // every uppercase id before `st-1` — numeric-locale order would differ.
    const codeUnitSorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(codeUnitSorted).toEqual(['P10', 'P2', 'ST-1', 'ST-10', 'ST-2', 'st-1']);
    const expected = buildValueFingerprint({
      version: ADJUSTMENT_RESULT_FINGERPRINT_VERSION,
      coordMode: null,
      stations: codeUnitSorted.map((id) => ({
        id,
        x: ids.indexOf(id),
        y: -ids.indexOf(id),
        h: ids.indexOf(id) * 0.5,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: false,
        constraintModeX: null,
        constraintModeY: null,
        constraintModeH: null,
        lost: false,
      })),
      sideshots: [...rawShots]
        .sort((a, b) =>
          (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
          || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)
          || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((shot) => ({
          id: shot.id,
          from: shot.from,
          to: shot.to,
          mode: 'slope',
          easting: 1,
          northing: 2,
          height: 3,
        })),
    });
    expect(buildAdjustmentResultFingerprint(forward)).toBe(expected);
  });
});
