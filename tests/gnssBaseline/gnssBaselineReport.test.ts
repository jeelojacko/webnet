/**
 * Phase 12D — report model, text rendering, determinism, and one-block
 * removal what-if.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import {
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
  runGnssBaselineRemovalWhatIf,
} from '../../src/engine/gnssBaselineReport';
import { parseGnssBaselineText } from '../../src/engine/gnssBaselineNetworkImport';
import {
  buildBaselines,
  buildStations,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

const triangleInput = () => {
  resetBaselineIds();
  const a = { x: 1000, y: 2000, z: 3000 };
  const b = { x: 1100, y: 2000, z: 3000 };
  const c = { x: 1100, y: 2100, z: 3000 };
  return {
    stations: buildStations([
      { id: 'A', ...a, fixed: true },
      { id: 'B', ...b },
      { id: 'C', ...c },
    ]),
    baselines: buildBaselines([
      { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
      { from: 'B', to: 'C', dx: 0.006, dy: 100, dz: -0.003 },
      { from: 'A', to: 'C', dx: 100, dy: 100, dz: 0 },
    ]),
    referenceFrame: 'ITRF2020@2020.0',
    epoch: '2020.0',
    ellipsoid: 'GRS80',
  };
};

describe('gnss baseline report', () => {
  it('builds a structured report with ECEF labels and no project coordinates', () => {
    const { report } = buildGnssReportFromInput(triangleInput());
    expect(report.adjustmentFrame).toBe('ecef');
    expect(report.routeProvenance).toBe('typescript-dense');
    expect(report.referenceFrame).toBe('ITRF2020@2020.0');
    expect(report.baselineCount).toBe(3);
    expect(report.observationEquationCount).toBe(9);
    expect(report.degreesOfFreedom).toBe(3);
    expect(report.stationCount).toBe(3);
    expect(report.fixedStationCount).toBe(1);
    expect(report.cycleRank).toBe(1);
    expect(report.closureCount).toBe(1);
    expect(report.baselines).toHaveLength(3);
    const first = report.baselines[0]!;
    expect(first.observed).toEqual({ x: 100, y: 0, z: 0 });
    expect(first.inputSigma.x).toBeCloseTo(0.005, 12);
    expect(first.distributionKind).toBe('diagnostic-only');
    expect(first.status).toBe('ok');
    expect(first.blockRank).toBe(3);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/easting|northing|Easting|Northing/);
    expect(serialized).not.toMatch(/pValue|chi-square\(3\)/);
  });

  it('renders deterministic text with the required sections', () => {
    const { report } = buildGnssReportFromInput(triangleInput());
    const first = renderGnssBaselineTextReport(report);
    const { report: again } = buildGnssReportFromInput(triangleInput());
    expect(renderGnssBaselineTextReport(again)).toBe(first);
    for (const section of [
      'NETWORK SUMMARY',
      'BASELINE RESIDUALS',
      'BASELINE PRECISION / REDUNDANCY',
      'BASELINE STATISTICS',
      'LOOP CLOSURES',
      'SUSPECT RANKING',
    ]) {
      expect(first).toContain(section);
    }
    expect(first).toContain('LOOP-001');
  });

  it('reordered input records give identical statistics by baseline id', () => {
    const header = 'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n' +
      'GX A 1000 2000 3000 FIXED\nGX B 1100 2000 3000\nGX C 1100 2100 3000\n';
    const iso = 'COV 0.000025 0 0 0.000025 0 0.000025';
    const orderA = parseGnssBaselineText(
      `${header}BL A B 100 0.001 0\n${iso}\nBL A C 100 100 0\n${iso}\n`,
    ).network!;
    const orderB = parseGnssBaselineText(
      `${header}BL A C 100 100 0\n${iso}\nBL A B 100 0.001 0\n${iso}\n`,
    ).network!;
    const reportA = buildGnssReportFromInput({ stations: orderA.stations, baselines: orderA.baselines }).report;
    const reportB = buildGnssReportFromInput({ stations: orderB.stations, baselines: orderB.baselines }).report;
    // Same vectors in different row order: statistics agree as multisets.
    const keyA = reportA.baselines.map((entry) => `${entry.from}->${entry.to}:${entry.blockT}`).sort().join('|');
    const keyB = reportB.baselines.map((entry) => `${entry.from}->${entry.to}:${entry.blockT}`).sort().join('|');
    expect(keyA).toBe(keyB);
  });

  it('suspect ranking flags the inconsistent region; what-if removal attributes the culprit', () => {
    resetBaselineIds();
    const a = { x: 1000, y: 2000, z: 3000 };
    const b = { x: 1100, y: 2000, z: 3000 };
    const c = { x: 1100, y: 2100, z: 3000 };
    const d = { x: 1000, y: 2100, z: 3000 };
    const quad = (dx2: number) => ({
      stations: buildStations([
        { id: 'A', ...a, fixed: true },
        { id: 'B', ...b },
        { id: 'C', ...c },
        { id: 'D', ...d },
      ]),
      baselines: buildBaselines([
        { from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 },
        { from: 'B', to: 'C', dx: dx2, dy: 100, dz: 0 },
        { from: 'C', to: 'D', dx: -100, dy: 0, dz: 0 },
        { from: 'D', to: 'A', dx: 0, dy: -100, dz: 0 },
        { from: 'A', to: 'C', dx: 100, dy: 100, dz: 0 },
      ]),
    });
    const input = quad(0.05);
    const { report } = buildGnssReportFromInput(input);
    // Smearing is honest: the exact baseline dragged by the blunder ranks
    // with the culprit. The ranking flags the region, not the culprit.
    expect(report.suspectRanking.slice(0, 2).sort()).toEqual([1, 2]);
    expect([...report.suspectRanking].sort()).toEqual([1, 2, 3, 4, 5]);
    // Attribution comes from one-block removal: dropping the true culprit
    // (id 2) collapses SEUW; dropping an exact baseline elsewhere (id 3)
    // leaves the inconsistency visible. (Dropping id 1 would turn B into a
    // zero-freedom spur that absorbs the blunder — also reported honestly.)
    const dropCulprit = runGnssBaselineRemovalWhatIf(input, 2);
    expect(dropCulprit.solvable).toBe(true);
    expect(dropCulprit.seuwAfter).toBeLessThan(1e-9);
    const dropElsewhere = runGnssBaselineRemovalWhatIf(input, 3);
    expect(dropElsewhere.solvable).toBe(true);
    expect(dropElsewhere.seuwAfter).toBeGreaterThan(1);
  });

  it('one-block removal what-if works on whole blocks only', () => {
    const input = triangleInput();
    const whatIf = runGnssBaselineRemovalWhatIf(input, 2);
    expect(whatIf.solvable).toBe(true);
    expect(whatIf.removedBaselineId).toBe(2);
    expect(whatIf.dofBefore).toBe(3);
    expect(whatIf.dofAfter).toBe(0);
    expect(whatIf.maxCoordinateShiftM).toBeGreaterThan(0);
    expect(whatIf.seuwAfter).toBe(0);
    // Unknown id: clean non-removable verdict, no solve attempted.
    const missing = runGnssBaselineRemovalWhatIf(input, 999);
    expect(missing.solvable).toBe(false);
    expect(missing.reason).toMatch(/not found/);
  });

  it('removal that breaks datum reports non-removable instead of solving uncontrolled', () => {
    resetBaselineIds();
    const input = {
      stations: buildStations([
        { id: 'A', x: 0, y: 0, z: 0, fixed: true },
        { id: 'B', x: 100, y: 0, z: 0 },
      ]),
      baselines: buildBaselines([{ from: 'A', to: 'B', dx: 100, dy: 0, dz: 0 }]),
    };
    const whatIf = runGnssBaselineRemovalWhatIf(input, 1);
    expect(whatIf.solvable).toBe(false);
    expect(whatIf.reason).toMatch(/at least one baseline/);
  });

  it('ENU-imported and ECEF-imported networks give equivalent statistics', () => {
    const ecefText =
      'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS M\n' +
      'GX A 1000000 2000000 3000000 FIXED\n' +
      'GX B 1000111.222 1999995.5 3000001.25\n' +
      'GX C 999950 2000100.75 2999998\n' +
      'BL A B 111.222 -4.5 1.25 SESSION S1\n' +
      'COV 0.000004 0.000001 0.0000002 0.000009 -0.0000003 0.000016\n' +
      'BL A C -50.003 100.75 -2.001 SESSION S1\n' +
      'COV 0.000009 0 0 0.000004 0.0000005 0.000025\n';
    const ecef = parseGnssBaselineText(ecefText).network!;
    // Hand-rotated ENU equivalent via the independently verified rotation:
    // values produced once through the rotation module and pinned here.
    const enuText =
      'FRAME ENU ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80 ORIGIN_LAT 46.123 ORIGIN_LON -67.456\nUNITS M\n' +
      'GX A 1000000 2000000 3000000 FIXED\n' +
      'GX B 1000111.222 1999995.5 3000001.25\n' +
      'GX C 999950 2000100.75 2999998\n' +
      'BL A B 100.9977455358 -32.8668749725 33.3372120942 SESSION S1\n' +
      'COV 0.000005443142210931932 0.000001833443335616146 -0.000001666251821287719 0.000011259502872386617 0.000004204464341491035 0.00001229735491668145\n' +
      'BL A C -7.5552143668 79.5060118169 -79.2248656095 SESSION S1\n' +
      'COV 0.000008265049773861993 -0.0000011433468353883598 0.0000013653222407563929 0.000014931818821439987 0.000010142838506067332 0.000014803131404698026\n';
    const enu = parseGnssBaselineText(enuText);
    expect(enu.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const reportEcef = buildGnssReportFromInput({ stations: ecef.stations, baselines: ecef.baselines }).report;
    const reportEnu = buildGnssReportFromInput({ stations: enu.network!.stations, baselines: enu.network!.baselines }).report;
    reportEcef.baselines.forEach((entry, index) => {
      const mirror = reportEnu.baselines[index]!;
      // Trace redundancy is frame-invariant by construction.
      expect(Math.abs(entry.redundancy.trace - mirror.redundancy.trace)).toBeLessThan(1e-6);
    });
  });

  it('routing: report path stays TS-dense with no WASM', () => {
    const input = triangleInput();
    const result = runGnssBaselineAdjustment({ stations: input.stations, baselines: input.baselines });
    expect(result.routeProvenance).toBe('typescript-dense');
    expect(result.adjustmentFrame).toBe('ecef');
    expect(result.statistics.length).toBe(3);
  });
});
