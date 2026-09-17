/**
 * Phase 17C import-unit-reimport-integrity (agent tier, fast).
 *
 * - Units: exact factors, ft-vs-us-ft observable difference, m/ft solve
 *   oracle equivalence, sigma scaling, conversion-once (no double convert).
 * - CSV: default units block until confirmed; missing Z warns (no silent 0);
 *   column mapping surfaced; adjusted-points output fails closed.
 * - Identity: exact dup blocked; revision explicit + atomic; remove isolates
 *   per-source; fingerprint stable across save/reopen; staging non-destructive.
 * - Repeats/stations: identical observations preserved; exact station merge
 *   ok; conflicting definitions BLOCKING; record provenance retained.
 */
import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/engine/parseInputCore';
import { solveEngine } from '../src/engine/solveEngine';
import {
  UNIT_TO_METERS,
  confirmDatasetUnits,
  describeSourceUnits,
  linearToMeters,
  needsUnitConfirmation,
  normalizeLinearUnit,
  varianceScale,
} from '../src/engine/importUnitProvenance';
import {
  classifyReimport,
  contentFingerprint,
  detectStationDefinitionConflicts,
  guardAgainstAdjustedPointsCsv,
  isAdjustedPointsCsvHeader,
  reimportWarningCode,
  replaceSourceAtomic,
  type ManagedSourceEntry,
} from '../src/engine/importSourceIdentity';
import {
  importExternalInput,
  type ImportedDataset,
} from '../src/engine/importers';
import { convertImportedDatasetToWebNetInput } from '../src/engine/importers/sharedDataset';
import { parseTerrestrialCoordinateCsv } from '../src/engine/terrestrialCsvImport';
import {
  appendImportReviewSource,
  buildImportReviewModel,
  buildStagedSourceSummary,
} from '../src/engine/importReviewModel';

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

const scaleLinearLine = (line: string, factor: number): string =>
  line.replace(/-?\d+(?:\.\d+)?/g, (match) => String(Number(match) * factor));

const toUnitInput = (unitDirective: string, factor: number): string =>
  NET_M.split('\n')
    .map((line, index) => {
      if (index === 0) return unitDirective;
      if (/^[CD] /.test(line)) return scaleLinearLine(line, factor);
      return line;
    })
    .join('\n');

const solve = (input: string) =>
  solveEngine({ input, maxIterations: 8, parseOptions: { coordMode: '2D', units: 'm' } });

const stationCoord = (result: ReturnType<typeof solve>, id: string) => {
  const station = result.stations[id];
  expect(station).toBeDefined();
  return { e: station!.x, n: station!.y };
};

describe('unit factors', () => {
  it('uses exact conversion factors', () => {
    expect(UNIT_TO_METERS.ft).toBe(0.3048);
    expect(UNIT_TO_METERS['us-ft']).toBe(1200 / 3937);
    expect(UNIT_TO_METERS.mm).toBe(0.001);
    expect(UNIT_TO_METERS.cm).toBe(0.01);
    expect(linearToMeters(1, 'ft')).toBe(0.3048);
    expect(varianceScale('ft')).toBeCloseTo(0.3048 * 0.3048, 12);
  });

  it('normalizes historical unit aliases', () => {
    expect(normalizeLinearUnit('usft')).toBe('us-ft');
    expect(normalizeLinearUnit('USSurveyFoot')).toBe('us-ft');
    expect(normalizeLinearUnit('feet')).toBe('ft');
    expect(normalizeLinearUnit('MM')).toBe('mm');
    expect(normalizeLinearUnit('furlongs')).toBeUndefined();
  });

  it('makes ft vs us-ft observably different on long distances', () => {
    const ft = linearToMeters(1000, 'ft');
    const usFt = linearToMeters(1000, 'us-ft');
    // ~0.6 mm per km — distinct, never interchangeable.
    expect(Math.abs(usFt - ft)).toBeGreaterThan(0.0005);
    expect(Math.abs(usFt - ft)).toBeLessThan(0.001);
  });

  it('solves the same network identically in m and ft', () => {
    const base = solve(NET_M);
    const ft = solve(toUnitInput('.UNITS FT', 1 / 0.3048));
    expect(ft.converged).toBe(true);
    const baseP = stationCoord(base, 'P');
    const ftP = stationCoord(ft, 'P');
    expect(Math.abs(baseP.e - ftP.e)).toBeLessThan(1e-6);
    expect(Math.abs(baseP.n - ftP.n)).toBeLessThan(1e-6);
    expect(Math.abs(base.seuw - ft.seuw)).toBeLessThan(1e-9);
  });

  it('scales distance sigmas with the unit factor (never angular sigmas)', () => {
    const base = parseInput(NET_M, {}, { coordMode: '2D' });
    const ft = parseInput(toUnitInput('.UNITS FT', 1 / 0.3048), {}, { coordMode: '2D' });
    expect(base.observations.length).toBe(ft.observations.length);
    base.observations.forEach((obs, index) => {
      const other = ft.observations[index]!;
      if (obs.type === 'dist') {
        expect(other.type).toBe('dist');
        if (other.type === 'dist') {
          expect(Math.abs(other.obs - obs.obs)).toBeLessThan(1e-6);
          expect(Math.abs(other.stdDev - obs.stdDev)).toBeLessThan(1e-9);
        }
      }
      if (obs.type === 'angle' && other.type === 'angle') {
        expect(Math.abs(other.obs - obs.obs)).toBeLessThan(1e-12);
      }
    });
  });

  it('converts exactly once: CSV ft -> metres -> .UNITS M text reparses identically', () => {
    const csv = 'ID,Northing,Easting,Elevation\nA,100,200,10\nB,150,250,12';
    const dataset = parseTerrestrialCoordinateCsv(csv, { units: 'ft' }, 'once.csv')!;
    expect(dataset.sourceUnits).toMatchObject({ linear: 'ft', origin: 'user-confirmed' });
    const station = dataset.controlStations[0]!;
    expect(station.northM).toBeCloseTo(100 * 0.3048, 9);
    const text = convertImportedDatasetToWebNetInput(dataset);
    expect(text).toContain('.UNITS M');
    const reparsed = parseInput(text, {}, {});
    expect(reparsed.stations.A!.y).toBeCloseTo(100 * 0.3048, 6);
    expect(reparsed.stations.A!.x).toBeCloseTo(200 * 0.3048, 6);
  });
});

describe('csv contract', () => {
  const csv3d = 'ID,Northing,Easting,Elevation\nA,100,200,10';

  it('blocks the production default path until units are confirmed', () => {
    const result = importExternalInput(csv3d, 'points.csv');
    expect(result.detected).toBe(true);
    expect(result.dataset!.needsUnitConfirmation).toBe(true);
    expect(needsUnitConfirmation(result.dataset!)).toBe(true);
    expect(result.dataset!.sourceUnits?.origin).toBe('unknown-legacy');
    expect(
      result.dataset!.trace.some((entry) => entry.sourceCode === 'UNIT_USER_CONFIRMATION_REQUIRED'),
    ).toBe(true);
  });

  it('accepts explicit units without blocking', () => {
    const result = importExternalInput(csv3d, 'points.csv', {
      terrestrialCsv: { units: 'ft' },
    });
    expect(result.dataset!.needsUnitConfirmation).toBe(false);
    expect(result.dataset!.sourceUnits).toMatchObject({ linear: 'ft', origin: 'user-confirmed' });
  });

  it('warns on missing elevation and never invents 0', () => {
    const dataset = parseTerrestrialCoordinateCsv('ID,Northing,Easting\nA,100,200', { units: 'm' }, 'flat.csv')!;
    expect(dataset.controlStations[0]!.heightM).toBeUndefined();
    expect(
      dataset.trace.some(
        (entry) => entry.sourceCode === 'HEIGHT_MISSING' && entry.level === 'warning',
      ),
    ).toBe(true);
  });

  it('keeps explicit zero elevations without a missing-height warning', () => {
    const dataset = parseTerrestrialCoordinateCsv('ID,Northing,Easting,Elevation\nA,100,200,0', { units: 'm' }, 'zero.csv')!;
    expect(dataset.controlStations[0]!.heightM).toBe(0);
    expect(dataset.trace.some((entry) => entry.sourceCode === 'HEIGHT_MISSING')).toBe(false);
  });

  it('warns HEIGHT_MISSING on present-but-non-numeric elevation instead of going 2D silently', () => {
    const dataset = parseTerrestrialCoordinateCsv('ID,Northing,Easting,Elevation\nA,100,200,abc', { units: 'm' }, 'bad-elev.csv')!;
    expect(dataset.controlStations[0]!.heightM).toBeUndefined();
    expect(
      dataset.trace.some(
        (entry) => entry.sourceCode === 'HEIGHT_MISSING' && entry.level === 'warning',
      ),
    ).toBe(true);
  });

  it('surfaces the interpreted column mapping in the review model', () => {
    const dataset = parseTerrestrialCoordinateCsv(
      'Point Name,Northing,Easting,Elevation\nA,100,200,10',
      { units: 'm' },
      'trimble.csv',
    )!;
    expect(dataset.columnMapping).toMatchObject({ id: 'Point Name' });
    const summary = buildStagedSourceSummary(dataset, { sourceName: 'trimble.csv' });
    expect(summary.columnMapping?.id).toBe('Point Name');
    expect(summary.controlCount).toBe(1);
  });

  it('fails closed on adjusted-points output instead of misparsing it', () => {
    expect(isAdjustedPointsCsvHeader('P,N,E,Z,D')).toBe(true);
    expect(isAdjustedPointsCsvHeader('ID,Northing,Easting')).toBe(false);
    const guard = guardAgainstAdjustedPointsCsv('P,N,E,Z,D\nA,1,2,3,desc', 'adjusted.csv');
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.code).toBe('ADJUSTED_POINTS_OUTPUT_ONLY');
  });

  it('confirms units additively without reconverting values', () => {
    const dataset = parseTerrestrialCoordinateCsv(csv3d, { units: 'm' }, 'c.csv')!;
    const northBefore = dataset.controlStations[0]!.northM;
    const confirmed = confirmDatasetUnits(dataset, 'm');
    expect(confirmed.sourceUnits).toMatchObject({ linear: 'm', origin: 'user-confirmed' });
    expect(confirmed.controlStations[0]!.northM).toBe(northBefore);
    expect(describeSourceUnits(confirmed.sourceUnits)).toContain('confirmed by user');
  });
});

const entry = (sourceId: string, filename: string, text: string): ManagedSourceEntry => ({
  key: { sourceId, importerId: 'native-dat', originalFilename: filename, contentFingerprint: contentFingerprint(text) },
  rawText: text,
});

describe('source identity', () => {
  it('fingerprints deterministically regardless of line endings or time', () => {
    expect(contentFingerprint('A\r\nB')).toBe(contentFingerprint('A\nB'));
    expect(contentFingerprint(NET_M)).toBe(contentFingerprint(NET_M));
    expect(contentFingerprint(`${NET_M}\n`)).not.toBe(contentFingerprint(NET_M));
  });

  it('blocks exact duplicates and flags revisions explicitly', () => {
    const sources = [entry('a', 'net.dat', NET_M)];
    expect(classifyReimport(sources, { ...sources[0]!.key })).toBe('exact-duplicate');
    expect(reimportWarningCode('exact-duplicate')).toBe('SOURCE_ALREADY_IMPORTED');
    const revised = { ...sources[0]!.key, contentFingerprint: contentFingerprint(`${NET_M}\n`) };
    expect(classifyReimport(sources, revised)).toBe('revision-same-id');
    expect(reimportWarningCode('revision-same-id')).toBe('SOURCE_REVISION_DETECTED');
    const renamed = {
      sourceId: 'b',
      importerId: 'native-dat',
      originalFilename: 'net.dat',
      contentFingerprint: contentFingerprint(`${NET_M}\n`),
    };
    expect(classifyReimport(sources, renamed)).toBe('same-filename-new-source');
    expect(classifyReimport(sources, entry('c', 'other.dat', NET_M).key)).toBe('new');
    expect(reimportWarningCode('new')).toBeNull();
  });

  it('replaces atomically: malformed revisions never delete the original', () => {
    const sources = [entry('a', 'net.dat', NET_M)];
    const bad = replaceSourceAtomic(sources, 'a', 'not valid {{{', (text) => {
      if (!text.includes('.UNITS')) throw new Error('parse failed');
      return text;
    });
    expect(bad.ok).toBe(false);
    expect(sources[0]!.rawText).toBe(NET_M);
    const good = replaceSourceAtomic(sources, 'a', `${NET_M}\n`, (text) => text);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.sources[0]!.rawText).toBe(`${NET_M}\n`);
      expect(good.sources[0]!.key.contentFingerprint).toBe(contentFingerprint(`${NET_M}\n`));
      expect(sources[0]!.rawText).toBe(NET_M);
    }
  });

  it('removes only the target source records', () => {
    const dataset: ImportedDataset = {
      importerId: 'native-dat',
      formatLabel: 't',
      summary: 't',
      notice: { title: 't', detailLines: [] },
      comments: [],
      controlStations: [
        { kind: 'control-station', stationId: 'A', coordinateMode: 'local', importSourceKey: 'a' },
        { kind: 'control-station', stationId: 'B', coordinateMode: 'local', importSourceKey: 'b' },
      ],
      observations: [],
      trace: [],
    };
    const remaining = dataset.controlStations.filter((station) => station.importSourceKey !== 'a');
    expect(remaining.map((station) => station.stationId)).toEqual(['B']);
  });

  it('retains fingerprint and units through save/reopen JSON round-trips', () => {
    const record = {
      id: 'a',
      name: 'net.dat',
      kind: 'dat',
      path: 'net.dat',
      enabled: true,
      order: 0,
      sourceUnits: { linear: 'ft', origin: 'user-confirmed' },
      contentFingerprint: contentFingerprint(NET_M),
      sourceKey: 'a',
    };
    const reopened = JSON.parse(JSON.stringify(record));
    expect(reopened.sourceUnits).toMatchObject({ linear: 'ft', origin: 'user-confirmed' });
    expect(reopened.contentFingerprint).toBe(contentFingerprint(NET_M));
  });

  it('stages non-destructively: inputs unchanged, cancel keeps zero changes', () => {
    const base: ImportedDataset = {
      importerId: 'x',
      formatLabel: 't',
      summary: 't',
      notice: { title: 't', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [],
      trace: [],
    };
    const model = buildImportReviewModel(base);
    const staged: ImportedDataset = {
      ...base,
      importerId: 'native-dat',
      observations: [
        { kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, sourceLine: 7 },
      ],
    };
    const appended = appendImportReviewSource(staged, model, {
      key: 's1',
      sourceName: 'extra.dat',
      notice: { title: 't', detailLines: [] },
      dataset: staged,
      isPrimary: false,
    });
    expect(model.items).toHaveLength(0);
    expect(staged.observations).toHaveLength(1);
    expect(appended.dataset.observations).toHaveLength(2);
    // Cancel = drop `appended`; committed text would carry a new fingerprint.
    expect(contentFingerprint(convertImportedDatasetToWebNetInput(staged))).not.toBe(
      contentFingerprint(convertImportedDatasetToWebNetInput(base)),
    );
  });
});

describe('repeats, stations, and provenance', () => {
  it('preserves identical repeated observations (never global-dedupes by value)', () => {
    const dataset: ImportedDataset = {
      importerId: 'native-dat',
      formatLabel: 't',
      summary: 't',
      notice: { title: 't', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        { kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, sourceLine: 7 },
        { kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, sourceLine: 8 },
      ],
      trace: [],
    };
    const model = buildImportReviewModel(dataset);
    expect(model.items).toHaveLength(2);
    const text = convertImportedDatasetToWebNetInput(dataset);
    expect(text.split('\n').filter((line) => line.startsWith('D A B'))).toHaveLength(2);
  });

  it('merges identical station definitions and blocks conflicting ones', () => {
    const station = (east: number) => ({
      kind: 'control-station' as const,
      stationId: 'A',
      coordinateMode: 'local' as const,
      eastM: east,
      northM: 0,
    });
    expect(detectStationDefinitionConflicts([station(1), station(1)])).toHaveLength(0);
    const conflicts = detectStationDefinitionConflicts([station(1), station(2)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.severity).toBe('BLOCKING');
  });

  it('retains per-record sourceLine and codes through staging', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 't',
      summary: 't',
      notice: { title: 't', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        { kind: 'distance', fromId: 'A', toId: 'B', distanceM: 100, sourceLine: 42, sourceCode: 'MLM' },
      ],
      trace: [],
    };
    const model = buildImportReviewModel(dataset);
    expect(model.items[0]).toMatchObject({ sourceLine: 42, sourceCode: 'MLM' });
    const appended = appendImportReviewSource(dataset, model, {
      key: 's1',
      sourceName: 'job.xml',
      notice: { title: 't', detailLines: [] },
      dataset,
      isPrimary: false,
    });
    const staged = appended.reviewModel.items.find((item) => item.sourceKey === 's1');
    expect(staged).toMatchObject({ sourceLine: 42, sourceCode: 'MLM' });
    expect(appended.dataset.observations[1]).toMatchObject({ sourceLine: 42, sourceCode: 'MLM' });
  });

  it('marks formats without unit declarations as unknown (never format-defined)', () => {
    // RW5 carries no unit element; metres are assumed pending confirmation.
    const rw5 = 'JOB Test\nUNITS M\n---\nSS,OP1,FP2,AR90.0,ZE90.0,SD100.0\n';
    const result = importExternalInput(rw5, 'survey.rw5');
    if (result.detected) {
      expect(result.dataset!.sourceUnits?.origin).toBe('unknown-legacy');
      expect(result.dataset!.needsUnitConfirmation).toBe(true);
    }
  });
});
