import { readFileSync } from 'node:fs';
import { act } from 'react';

import type { ParseSettings, SettingsState } from '../../src/appStateTypes';
import { REPORT_TABLE_WINDOW_SIZE } from '../../src/components/report/reportSectionRegistry';
import { importExternalInput } from '../../src/engine/importers';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from '../../src/engine/importedRecordSerialization';
import { createRunProfileBuilders } from '../../src/engine/runProfileBuilders';
import { runAdjustmentSession } from '../../src/engine/runSession';
import type { AdjustedPointsColumnId, ProjectExportFormat } from '../../src/types';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

export { REPORT_TABLE_WINDOW_SIZE };
export type BrowserBenchmarkFixtureKind = 'imported-ts' | 'imported-gnss' | 'imported-leveling';

export interface BrowserBenchmarkFixture {
  id: string;
  kind: BrowserBenchmarkFixtureKind;
  repeatCount: number;
  expectedStationCount: number;
  expectedObservationCount: number;
  reportWindowSize: number;
  solveBudgetMs: number;
  rerunBudgetMs: number;
  renderBudgetMs: number;
  qaDerivedBuildBudgetMs: number;
  artifactBuildBudgetMs: number;
  artifactFormat: ProjectExportFormat;
}

export const BENCHMARK_CASE_TIMEOUT_MS = 30000;

export const benchmarkFixtures = JSON.parse(
  readFileSync('tests/fixtures/browser_large_project_benchmark.json', 'utf-8'),
) as BrowserBenchmarkFixture[];

export const importedTsFixture = readFileSync('tests/fixtures/jobxml_trimble_station_setup_sample.jxl', 'utf-8');
export const importedTsDataset = importExternalInput(
  importedTsFixture,
  'jobxml_trimble_station_setup_sample.jxl',
).dataset;

if (!importedTsDataset) {
  throw new Error('Benchmark fixture import failed for jobxml_trimble_station_setup_sample.jxl');
}

export const settingsFromRequest = (
  request: ReturnType<typeof createRunSessionRequest>,
): SettingsState => ({
  maxIterations: request.maxIterations,
  convergenceLimit: request.convergenceLimit,
  units: request.units,
  uiTheme: 'gruvbox-light',
  mapShowLostStations: true,
  map3dEnabled: false,
  showRunComparisonPanel: false,
  showReviewQueuePanel: false,
  listingShowLostStations: true,
  listingShowCoordinates: true,
  listingShowObservationsResiduals: true,
  listingShowErrorPropagation: true,
  listingShowProcessingNotes: true,
  listingShowAzimuthsBearings: true,
  listingSortCoordinatesBy: 'input',
  listingSortObservationsBy: 'input',
  listingObservationLimit: 0,
});

export const createArtifactRequest = (
  request: ReturnType<typeof createRunSessionRequest>,
  result: ReturnType<typeof runAdjustmentSession>['result'],
  exportFormat: ProjectExportFormat,
) => {
  const { buildRunDiagnostics } = createRunProfileBuilders({
    projectInstruments: request.projectInstruments,
    selectedInstrument: request.selectedInstrument,
    defaultIndustryInstrumentCode: 'S9',
    defaultIndustryInstrument: request.projectInstruments.S9,
    normalizeSolveProfile: () => 'industry-parity',
  });

  return {
    exportFormat,
    dateStamp: '2026-03-20',
    result,
    units: request.units,
    settings: settingsFromRequest(request),
    parseSettings: request.parseSettings as ParseSettings,
    runDiagnostics: buildRunDiagnostics(request.parseSettings as ParseSettings, result),
    adjustedPointsExportSettings: {
      format: 'csv' as const,
      delimiter: 'comma' as const,
      columns: ['P', 'N', 'E', 'Z', 'D'] as AdjustedPointsColumnId[],
      presetId: 'PNEZD' as const,
      includeLostStations: true,
      transform: {
        referenceStationId: '',
        scope: 'all' as const,
        selectedStationIds: [],
        rotation: { enabled: false, angleDeg: 0 },
        translation: {
          enabled: false,
          method: 'direction-distance' as const,
          azimuthDeg: 0,
          distance: 0,
          targetE: 0,
          targetN: 0,
        },
        scale: { enabled: false, factor: 1 },
      },
    },
    levelLoopCustomPresets: [],
    currentComparisonText: '',
  };
};

export const prefixedId = (prefix: string, id: string): string => `${prefix}${id}`;

export const buildImportedTsInput = (fixture: BrowserBenchmarkFixture): string => {
  const lines = [
    '# Imported dense JobXML-style total-station benchmark',
    '# Source profile: jobxml_trimble_station_setup_sample.jxl',
    '.2D',
    '.UNITS M',
    '.ORDER EN',
    '.DELTA OFF',
  ];

  for (let index = 0; index < fixture.repeatCount; index += 1) {
    const prefix = `TS${String(index + 1).padStart(3, '0')}_`;
    const eastOffset = (index % 5) * 250;
    const northOffset = Math.floor(index / 5) * 250;

    lines.push(`# Imported setup cluster ${index + 1}`);
    importedTsDataset.controlStations.forEach((station) => {
      const translated = {
        ...station,
        stationId: prefixedId(prefix, station.stationId),
        eastM: (station.eastM ?? 0) + eastOffset,
        northM: (station.northM ?? 0) + northOffset,
      };
      const baseLine = serializeImportedControlStationRecord(translated, '2D', true);
      const isFixedSetup = station.stationId === '1' || station.stationId === '1000';
      lines.push(isFixedSetup ? `${baseLine} ! !` : baseLine);
    });

    importedTsDataset.observations.forEach((observation) => {
      const remapped =
        observation.kind === 'measurement'
          ? {
              ...observation,
              atId: prefixedId(prefix, observation.atId),
              fromId: prefixedId(prefix, observation.fromId),
              toId: prefixedId(prefix, observation.toId),
            }
          : observation;
      serializeImportedObservationRecord(remapped)
        .filter((line) => line !== '.DELTA OFF')
        .forEach((line) => lines.push(line));
    });
  }

  return lines.join('\n');
};

export const buildImportedGnssInput = (fixture: BrowserBenchmarkFixture): string => {
  const lines = [
    '# Imported dense GNSS loop benchmark',
    '.2D',
    '.UNITS M',
    '.ORDER EN',
    '.GPS CHECK ON',
    '.GPS NETWORK',
  ];

  for (let index = 0; index < fixture.repeatCount; index += 1) {
    const prefix = `GN${String(index + 1).padStart(3, '0')}_`;
    const eastOffset = (index % 6) * 300;
    const northOffset = Math.floor(index / 6) * 300;
    const a = prefixedId(prefix, 'A');
    const b = prefixedId(prefix, 'B');
    const c = prefixedId(prefix, 'C');
    const d = prefixedId(prefix, 'D');

    lines.push(`# Imported GNSS loop ${index + 1}`);
    lines.push(`C ${a} ${(eastOffset + 0).toFixed(4)} ${(northOffset + 0).toFixed(4)} ! !`);
    lines.push(`C ${b} ${(eastOffset + 100).toFixed(4)} ${(northOffset + 0).toFixed(4)}`);
    lines.push(`C ${c} ${(eastOffset + 100).toFixed(4)} ${(northOffset + 100).toFixed(4)}`);
    lines.push(`C ${d} ${(eastOffset + 200).toFixed(4)} ${(northOffset + 100).toFixed(4)}`);
    lines.push(`G GPS1 ${a} ${b} 100.0000 0.0000 0.0100 0.0100`);
    lines.push(`G GPS1 ${b} ${c} 0.0000 100.0000 0.0100 0.0100`);
    lines.push(`G GPS1 ${a} ${c} 100.0300 99.9900 0.0100 0.0100`);
    lines.push(`G GPS1 ${c} ${d} 100.0000 0.0000 0.0100 0.0100`);
    lines.push(`G GPS1 ${a} ${d} 200.2500 100.0500 0.0100 0.0100`);
  }

  return lines.join('\n');
};

export const buildImportedLevelingInput = (fixture: BrowserBenchmarkFixture): string => {
  const lines = [
    '# Imported dense differential-leveling benchmark',
    '.UNITS M',
    '.COORD 3D',
    '.ORDER EN',
    'I LEV1 Level-0.7mm 0 0 0 0 0 0 0 0.7',
  ];

  for (let index = 0; index < fixture.repeatCount; index += 1) {
    const prefix = `LV${String(index + 1).padStart(3, '0')}_`;
    const eastOffset = index * 40;
    const a = prefixedId(prefix, 'A');
    const b = prefixedId(prefix, 'B');
    const c = prefixedId(prefix, 'C');
    const d = prefixedId(prefix, 'D');

    lines.push(`# Imported level loop ${index + 1}`);
    lines.push(`C ${a} ${(eastOffset + 0).toFixed(4)} 0.0000 100.0000 ! ! !`);
    lines.push(`C ${b} ${(eastOffset + 10).toFixed(4)} 0.0000 100.0000 ! !`);
    lines.push(`C ${c} ${(eastOffset + 20).toFixed(4)} 0.0000 100.0000 ! !`);
    lines.push(`C ${d} ${(eastOffset + 30).toFixed(4)} 0.0000 100.0000 ! !`);
    lines.push(`L LEV1 ${a} ${b} 1.0000 0.50`);
    lines.push(`L LEV1 ${b} ${c} 1.5000 0.60`);
    lines.push(`L LEV1 ${a} ${c} 2.4900 1.10`);
    lines.push(`L LEV1 ${c} ${d} 0.7500 0.40`);
    lines.push(`L LEV1 ${a} ${d} 3.2600 1.50`);
  }

  return lines.join('\n');
};

export const buildBenchmarkInput = (fixture: BrowserBenchmarkFixture): string => {
  switch (fixture.kind) {
    case 'imported-ts':
      return buildImportedTsInput(fixture);
    case 'imported-gnss':
      return buildImportedGnssInput(fixture);
    case 'imported-leveling':
      return buildImportedLevelingInput(fixture);
    default:
      throw new Error(`Unsupported benchmark fixture kind: ${String((fixture as { kind: string }).kind)}`);
  }
};

export const sortIds = (ids: string[]): string[] =>
  [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export const medianDurationMs = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export const ensureSectionExpanded = async (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll('button[aria-expanded]')).find((entry) =>
    entry.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Section toggle "${label}" not found.`);
  if (button.getAttribute('aria-expanded') === 'true') return;
  await act(async () => {
    button.click();
  });
};

export const observationSectionLabel = (type: string): string => {
  switch (type) {
    case 'angle':
      return 'Angles (TS)';
    case 'direction':
      return 'Directions (DB/DN)';
    case 'dist':
      return 'Distances (TS)';
    case 'bearing':
      return 'Bearings/Azimuths';
    case 'dir':
      return 'Directions (Azimuth)';
    case 'zenith':
      return 'Zenith/Vertical Angles';
    case 'gps':
      return 'GPS Vectors';
    case 'lev':
      return 'Leveling dH';
    default:
      throw new Error(`Unsupported observation type: ${type}`);
  }
};

export const observationSectionKey = (type: string): string => {
  switch (type) {
    case 'angle':
      return 'observations-angles-ts';
    case 'direction':
      return 'observations-directions-db-dn';
    case 'dist':
      return 'observations-distances-ts';
    case 'bearing':
      return 'observations-bearings-azimuths';
    case 'dir':
      return 'observations-directions-azimuth';
    case 'zenith':
      return 'observations-zenith-vertical-angles';
    case 'gps':
      return 'observations-gps-vectors';
    case 'lev':
      return 'observations-leveling-dh';
    default:
      throw new Error(`Unsupported observation type: ${type}`);
  }
};
