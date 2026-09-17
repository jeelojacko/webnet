/**
 * Phase 17C close-out (agent tier, fast).
 *
 * - Native C/P conflicts warn at parse (exact repeats stay silent); staged
 *   merges surface STATION_DEFINITION_CONFLICT in review.
 * - GNSS networks emit sourceUnits directly (BL source-declared, GVX/CSV
 *   unknown-BLOCKING unless the caller confirms).
 * - Mixed m+ft files normalize to one canonical project with distinct
 *   provenance; save/reopen retains fingerprint+units; reimport recognized.
 * - Import cancel keeps FRESH, commit => STALE; stage-only never invalidates.
 * - Replacement parse failures stay atomic; metre exports stay byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parseInputCore';
import { solveEngine } from '../src/engine/solveEngine';
import {
  needsUnitConfirmation,
  rescaleDatasetFromAssumedMeters,
} from '../src/engine/importUnitProvenance';
import {
  classifyReimport,
  contentFingerprint,
  replaceSourceAtomic,
  type ManagedSourceEntry,
} from '../src/engine/importSourceIdentity';
import { convertImportedDatasetToWebNetInput } from '../src/engine/importers/sharedDataset';
import type { ImportedDataset } from '../src/engine/importers';
import {
  appendImportReviewSource,
  buildImportReviewModel,
  buildStagedSourceSummary,
} from '../src/engine/importReviewModel';
import { parseGnssBaselineText } from '../src/engine/gnssBaselineNetworkImport';
import { parseGvx } from '../src/engine/gnssGvxImport';
import {
  importGnssBaselineDelimited,
  importGnssControlCsv,
} from '../src/engine/gnssBaselineCsvImport';
import {
  assessResultIntegrity,
  type AppliedRunIdentity,
  type ResultDependencyIdentity,
} from '../src/engine/resultIntegrity';
import { createManifestEntry } from '../src/engine/projectWorkspace';
import type { AdjustmentResult } from '../src/typesAdjustmentResult';

const NET_M = [
  '.UNITS M',
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

const NET_FT = [
  '.UNITS FT',
  '.2D',
  'C A 0 0 0 ! !',
  `C B ${100 / 0.3048} 0 0 ! !`,
  `C P ${50 / 0.3048} ${40 / 0.3048} 0`,
  `D A-P ${64.031 / 0.3048} ${0.01 / 0.3048}`,
  `D B-P ${64.031 / 0.3048} ${0.01 / 0.3048}`,
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

describe('native C/P redefinition warnings', () => {
  it('warns on conflicting C redefinition but stays silent on exact repeats', () => {
    const conflict = parseInput(`${NET_M}\nC P 51 41 0`, {}, { coordMode: '2D' });
    expect(conflict.logs.some((log) => log.includes('redefines station P'))).toBe(true);
    const repeat = parseInput(`${NET_M}\nC P 50 40 0`, {}, { coordMode: '2D' });
    expect(repeat.logs.some((log) => log.includes('redefines station'))).toBe(false);
  });

  it('warns on fixity mismatch and stays quiet for the C+E height flow', () => {
    const fixity = parseInput('C A 0 0 0 ! !\nC A 0 0 0 * *', {}, { coordMode: '2D' });
    expect(fixity.logs.some((log) => log.includes('redefines station A'))).toBe(true);
    const height = parseInput('C A 0 0 0 ! !\nE A 10.0', {}, { coordMode: '2D' });
    expect(height.logs.some((log) => log.includes('redefines station'))).toBe(false);
    expect(height.stations['A']!.h).toBeCloseTo(10, 12);
  });

  it('warns on conflicting P redefinition, last definition wins', () => {
    const input = [
      'P A 40.0 -75.0 100.0',
      'P B 40.001 -75.0 100.0',
      'P A 41.0 -75.0 100.0',
    ].join('\n');
    const parsed = parseInput(input, {}, { coordMode: '3D' });
    expect(parsed.logs.some((log) => log.includes('redefines station A'))).toBe(true);
    expect(parsed.logs.some((log) => log.includes('redefines station B'))).toBe(false);
  });
});

describe('staged merge conflicts', () => {
  const station = (east: number) => ({
    kind: 'control-station' as const,
    stationId: 'A',
    coordinateMode: 'local' as const,
    eastM: east,
    northM: 0,
  });
  const base: ImportedDataset = {
    importerId: 'native-dat',
    formatLabel: 't',
    summary: 't',
    notice: { title: 't', detailLines: [] },
    comments: [],
    controlStations: [station(1)],
    observations: [],
    trace: [],
  };
  const sourceOf = (dataset: ImportedDataset, key: string, name: string) => ({
    key,
    sourceName: name,
    notice: { title: 't', detailLines: [] },
    dataset,
    isPrimary: key === 's0',
  });

  it('surfaces STATION_DEFINITION_CONFLICT on merge, silent on exact match', () => {
    const model = buildImportReviewModel(base);
    const merged = appendImportReviewSource(base, model, sourceOf(
      { ...base, controlStations: [station(2)] },
      's1',
      'b.dat',
    ));
    const codes = merged.dataset.trace.map((entry) => entry.sourceCode);
    expect(codes).toContain('STATION_DEFINITION_CONFLICT');
    expect(merged.reviewModel.warnings.map((entry) => entry.sourceCode)).toContain(
      'STATION_DEFINITION_CONFLICT',
    );
    const clean = appendImportReviewSource(base, buildImportReviewModel(base), sourceOf(
      { ...base, controlStations: [station(1)] },
      's1',
      'b.dat',
    ));
    expect(clean.dataset.trace.map((entry) => entry.sourceCode)).not.toContain(
      'STATION_DEFINITION_CONFLICT',
    );
  });
});

describe('GNSS sourceUnits direct', () => {
  const BL_MM =
    'FRAME ECEF ITRF2020@2020.0 EPOCH 2020.0 ELLIPSOID GRS80\nUNITS MM\n' +
    'GX A 1000000 2000000 3000000 FIXED\n' +
    'GX B 1000100 2000000 3000000\n' +
    'BL A B 100000 0 0 SESSION 2026-101\n' +
    'COV 4 0 0 9 0 16\n';

  it('marks BL units source-declared without touching covariance math', () => {
    const parsed = parseGnssBaselineText(BL_MM, 'bl.txt');
    expect(parsed.network).not.toBeNull();
    expect(parsed.network!.sourceUnits).toMatchObject({ linear: 'mm', origin: 'source-declared' });
    expect(parsed.network!.needsUnitConfirmation).toBe(false);
    // 100000 mm vector, cov entries scale with f^2 = 1e-6 against the m case.
    expect(parsed.network!.baselines[0]!.vector.x).toBeCloseTo(100, 9);
    expect(parsed.network!.baselines[0]!.covariance.xx).toBeCloseTo(4e-6, 15);
  });

  it('marks GVX unknown-BLOCKING with a diagnostic', () => {
    const gvx =
      '<?xml version="1.0" encoding="utf-8"?>\n<GVX VERSION="1.0">\n' +
      '   <REFERENCE_SYSTEM>\n      <ID>126</ID>\n      <NAME>SYNTH</NAME>\n' +
      '      <LINEAR_UNIT><NAME>meters</NAME></LINEAR_UNIT>\n' +
      '      <ANGULAR_UNIT><NAME>decimal degrees</NAME></ANGULAR_UNIT>\n   </REFERENCE_SYSTEM>\n' +
      '   <POINT><ID>A</ID><NAME>A</NAME><EQUIPMENT_ID>1</EQUIPMENT_ID><ARP_HEIGHT>0</ARP_HEIGHT>' +
      '<POINT_TYPE>Keyed-in</POINT_TYPE><COORDINATES><REFERENCE_SYSTEM_ID>126</REFERENCE_SYSTEM_ID>' +
      '<EPOCH>2010.0</EPOCH><GEODETIC_COORDINATES><LATITUDE>39.0</LATITUDE><LONGITUDE>-77.0</LONGITUDE>' +
      '<ELLIPSOIDAL_HEIGHT>100.0</ELLIPSOIDAL_HEIGHT></GEODETIC_COORDINATES><GEOCENTRIC_COORDINATES>' +
      '<X>3779000.0</X><Y>150000.0</Y><Z>5121000.0</Z></GEOCENTRIC_COORDINATES></COORDINATES></POINT>\n' +
      '   <POINT><ID>B</ID><NAME>B</NAME><EQUIPMENT_ID>1</EQUIPMENT_ID><ARP_HEIGHT>0</ARP_HEIGHT>' +
      '<POINT_TYPE>Keyed-in</POINT_TYPE><COORDINATES><REFERENCE_SYSTEM_ID>126</REFERENCE_SYSTEM_ID>' +
      '<EPOCH>2010.0</EPOCH><GEODETIC_COORDINATES><LATITUDE>39.0</LATITUDE><LONGITUDE>-77.0</LONGITUDE>' +
      '<ELLIPSOIDAL_HEIGHT>100.0</ELLIPSOIDAL_HEIGHT></GEODETIC_COORDINATES><GEOCENTRIC_COORDINATES>' +
      '<X>3780234.577</X><Y>149765.855</Y><Z>5121345.89</Z></GEOCENTRIC_COORDINATES></COORDINATES></POINT>\n' +
      '   <GNSS_VECTOR><ID>V1</ID><INITIAL_POINT_ID>A</INITIAL_POINT_ID><TERMINAL_POINT_ID>B</TERMINAL_POINT_ID>' +
      '<ECEF_DELTAS><DX>1234.577</DX><DY>-234.145</DY><DZ>345.89</DZ></ECEF_DELTAS><CORRELATION_MATRIX>' +
      '<SDX>0.002</SDX><SDY>0.003</SDY><SDZ>0.004</SDZ><PXY>0.5</PXY><PXZ>0</PXZ><PYZ>0</PYZ>' +
      '</CORRELATION_MATRIX></GNSS_VECTOR>\n</GVX>\n';
    const parsed = parseGvx(gvx, 'v.gvx');
    expect(parsed.network).not.toBeNull();
    expect(parsed.network!.sourceUnits).toMatchObject({ linear: 'm', origin: 'unknown-legacy' });
    expect(parsed.network!.needsUnitConfirmation).toBe(true);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('GNSS_UNIT_UNKNOWN');
    // Covariance math untouched: Cxx = SDX^2 exactly.
    expect(parsed.network!.baselines[0]!.covariance.xx).toBe(0.002 * 0.002);
  });

  it('marks CSV unknown-BLOCKING unless the caller confirms units', () => {
    const control = importGnssControlCsv('id,X,Y,Z,fixed\nA,1000000,2000000,3000000,1\nB,1000100,2000000,3000000,0\n', {
      units: 'm',
      sourceFile: 'ctrl.csv',
    });
    expect(control.stations).not.toBeNull();
    const header = 'frompoint,topoint,DX,DY,DZ,sx,sy,sz,rho_xy,rho_xz,rho_yz\n';
    const row = 'A,B,100,0,0,0.002,0.003,0.004,0,0,0\n';
    const baseOptions = {
      units: 'm',
      vectorFrame: 'ecef' as const,
      referenceFrame: 'ITRF2020',
    };
    const unconfirmed = importGnssBaselineDelimited(header + row, control.stations!, baseOptions);
    expect(unconfirmed.network!.needsUnitConfirmation).toBe(true);
    expect(unconfirmed.network!.sourceUnits).toMatchObject({ origin: 'unknown-legacy' });
    const confirmed = importGnssBaselineDelimited(header + row, control.stations!, {
      ...baseOptions,
      unitsConfirmed: true,
    });
    expect(confirmed.network!.needsUnitConfirmation).toBe(false);
    expect(confirmed.network!.sourceUnits).toMatchObject({ linear: 'm', origin: 'user-confirmed' });
    expect(confirmed.network!.baselines[0]!.covariance.xx).toBe(
      unconfirmed.network!.baselines[0]!.covariance.xx,
    );
  });
});

describe('mixed m+ft coherence and persistence', () => {
  it('normalizes m and ft files to one canonical project with distinct provenance', () => {
    const parsedM = parseInput(NET_M, {}, { coordMode: '2D' });
    const parsedFt = parseInput(NET_FT, {}, { coordMode: '2D' });
    const solvedM = solveEngine({ input: NET_M, maxIterations: 8, parseOptions: { coordMode: '2D', units: 'm' } });
    const solvedFt = solveEngine({ input: NET_FT, maxIterations: 8, parseOptions: { coordMode: '2D', units: 'm' } });
    expect(solvedFt.converged).toBe(true);
    expect(Math.abs(solvedM.stations['P']!.x - solvedFt.stations['P']!.x)).toBeLessThan(1e-6);
    expect(Math.abs(solvedM.stations['P']!.y - solvedFt.stations['P']!.y)).toBeLessThan(1e-6);
    // No leakage: parsing ft afterwards leaves the m parse untouched.
    expect(parsedM.stations['B']!.x).toBeCloseTo(100, 9);
    expect(parsedFt.stations['B']!.x).toBeCloseTo(100, 9);
    // Distinct provenance.
    expect(contentFingerprint(NET_M)).not.toBe(contentFingerprint(NET_FT));
  });

  it('retains fingerprint+units through manifest save/reopen and recognizes reimport', () => {
    const fingerprint = contentFingerprint(NET_FT);
    const entry = {
      ...createManifestEntry({ name: 'B.dat', kind: 'dat' as const, order: 1, text: NET_FT }),
      sourceUnits: { linear: 'ft' as const, origin: 'user-confirmed' as const },
      contentFingerprint: fingerprint,
      sourceKey: 'source:b',
    };
    const reopened = JSON.parse(JSON.stringify({ files: [entry] }));
    expect(reopened.files[0].sourceUnits).toMatchObject({ linear: 'ft', origin: 'user-confirmed' });
    expect(reopened.files[0].contentFingerprint).toBe(fingerprint);
    const sources: ManagedSourceEntry[] = [{
      key: {
        sourceId: 'source:b',
        importerId: 'native-dat',
        originalFilename: 'B.dat',
        contentFingerprint: fingerprint,
      },
      rawText: NET_FT,
    }];
    expect(classifyReimport(sources, {
      sourceId: 'source:b',
      importerId: 'native-dat',
      originalFilename: 'B.dat',
      contentFingerprint: contentFingerprint(NET_FT),
    })).toBe('exact-duplicate');
    expect(classifyReimport(sources, {
      sourceId: 'source:b',
      importerId: 'native-dat',
      originalFilename: 'B.dat',
      contentFingerprint: contentFingerprint(`${NET_FT}\n`),
    })).toBe('revision-same-id');
  });

  it('rescales staged datasets exactly once with angular fields untouched', () => {
    const dataset: ImportedDataset = {
      importerId: 'carlson-rw5',
      formatLabel: 't',
      summary: 't',
      notice: { title: 't', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        { kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, hiM: 1.5, sourceLine: 1 },
        { kind: 'angle', atId: 'P', fromId: 'A', toId: 'B', angleDeg: 45 },
        { kind: 'distance-vertical', fromId: 'A', toId: 'B', distanceM: 100, verticalMode: 'zenith', verticalValue: 89 },
      ],
      trace: [],
    };
    expect(needsUnitConfirmation(dataset)).toBe(true);
    const confirmed = rescaleDatasetFromAssumedMeters(dataset, 'ft');
    expect(confirmed.needsUnitConfirmation).toBe(false);
    expect(confirmed.sourceUnits).toMatchObject({ linear: 'ft', origin: 'user-confirmed' });
    const distance = confirmed.observations[0]!;
    expect(distance).toMatchObject({ distanceM: 100 * 0.3048, hiM: 1.5 * 0.3048 });
    expect(confirmed.observations[1]).toMatchObject({ angleDeg: 45 });
    // Zenith angles are angular: never scaled.
    expect(confirmed.observations[2]).toMatchObject({ verticalValue: 89, distanceM: 100 * 0.3048 });
    expect(buildStagedSourceSummary(confirmed, { sourceName: 's.rw5' }).unitConfirmationRequired).toBe(false);
  });
});

describe('freshness interaction and atomicity', () => {
  const applied: AppliedRunIdentity = {
    inputFingerprint: 'input-a',
    mathFingerprint: 'math-a',
    exclusionFingerprint: 'excl-a',
    runMode: 'adjustment',
  };
  const current: ResultDependencyIdentity = { ...applied };
  const okResult = { success: true, converged: true, preanalysisMode: false } as AdjustmentResult;

  it('keeps FRESH across cancel/stage-only and goes STALE on commit', () => {
    expect(assessResultIntegrity({ result: okResult, applied, current }).state).toBe('FRESH_SUCCESS');
    // Cancel: nothing applied, identities unchanged.
    expect(assessResultIntegrity({ result: okResult, applied, current }).state).toBe('FRESH_SUCCESS');
    // Commit of a new input: input dep changes => STALE until re-run.
    const committed: ResultDependencyIdentity = { ...current, inputFingerprint: 'input-b' };
    const stale = assessResultIntegrity({ result: okResult, applied, current: committed });
    expect(stale.state).toBe('STALE_SUCCESS');
    expect(stale.changedDeps).toEqual(['input']);
    expect(stale.blockMessage).not.toBeNull();
  });

  it('keeps malformed revisions atomic: original retained', () => {
    const sources: ManagedSourceEntry[] = [{
      key: { sourceId: 's', importerId: 'x', originalFilename: 'a.dat', contentFingerprint: contentFingerprint('ok') },
      rawText: 'ok',
    }];
    const result = replaceSourceAtomic(sources, 's', 'bad revision', (_text: string) => {
      throw new Error('parse failed');
    });
    expect(result.ok).toBe(false);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.rawText).toBe('ok');
  });
});

describe('metre export parity', () => {
  const dataset: ImportedDataset = {
    importerId: 'native-dat',
    formatLabel: 't',
    summary: 't',
    notice: { title: 't', detailLines: [] },
    comments: [],
    controlStations: [{
      kind: 'control-station',
      stationId: 'A',
      coordinateMode: 'local',
      eastM: 1,
      northM: 2,
    }],
    observations: [{ kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, sourceLine: 7 }],
    trace: [],
  };

  it('exports metres byte-identically with no provenance leakage', () => {
    const first = convertImportedDatasetToWebNetInput(dataset);
    const second = convertImportedDatasetToWebNetInput(dataset);
    expect(second).toBe(first);
    expect(first).toContain('.UNITS M');
    expect(first).not.toContain('user-confirmed');
    expect(first).not.toContain('fingerprint');
    const reparsed = parseInput(first, {}, { coordMode: '2D' });
    expect(reparsed.stations['A']!.x).toBeCloseTo(1, 9);
    expect(reparsed.stations['A']!.y).toBeCloseTo(2, 9);
  });
});
