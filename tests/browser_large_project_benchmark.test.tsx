/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ParseSettings, SettingsState } from '../src/appStateTypes';
import MapView from '../src/components/MapView';
import ReportView from '../src/components/ReportView';
import { buildExportArtifacts } from '../src/engine/exportArtifacts';
import { importExternalInput } from '../src/engine/importers';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from '../src/engine/importedRecordSerialization';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import { runAdjustmentSession } from '../src/engine/runSession';
import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
} from '../src/engine/solveEngine';
import type { AdjustedPointsColumnId, ProjectExportFormat } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BrowserBenchmarkFixtureKind = 'imported-ts' | 'imported-gnss' | 'imported-leveling';

interface BrowserBenchmarkFixture {
  id: string;
  kind: BrowserBenchmarkFixtureKind;
  repeatCount: number;
  expectedStationCount: number;
  expectedObservationCount: number;
  reportWindowSize: number;
  solveBudgetMs: number;
  rerunBudgetMs: number;
  renderBudgetMs: number;
  artifactBuildBudgetMs: number;
  artifactFormat: ProjectExportFormat;
}

const BENCHMARK_CASE_TIMEOUT_MS = 30000;

const benchmarkFixtures = JSON.parse(
  readFileSync('tests/fixtures/browser_large_project_benchmark.json', 'utf-8'),
) as BrowserBenchmarkFixture[];

const importedTsFixture = readFileSync('tests/fixtures/jobxml_trimble_station_setup_sample.jxl', 'utf-8');
const importedTsDataset = importExternalInput(
  importedTsFixture,
  'jobxml_trimble_station_setup_sample.jxl',
).dataset;

if (!importedTsDataset) {
  throw new Error('Benchmark fixture import failed for jobxml_trimble_station_setup_sample.jxl');
}

const settingsFromRequest = (
  request: ReturnType<typeof createRunSessionRequest>,
): SettingsState => ({
  maxIterations: request.maxIterations,
  convergenceLimit: request.convergenceLimit,
  units: request.units,
  uiTheme: 'gruvbox-light',
  mapShowLostStations: true,
  map3dEnabled: false,
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

const createArtifactRequest = (
  request: ReturnType<typeof createRunSessionRequest>,
  result: ReturnType<typeof runAdjustmentSession>['result'],
  exportFormat: ProjectExportFormat,
) => {
  const { buildRunDiagnostics } = createRunProfileBuilders({
    projectInstruments: request.projectInstruments,
    selectedInstrument: request.selectedInstrument,
    defaultIndustryInstrumentCode: 'S9',
    defaultIndustryInstrument: request.projectInstruments.S9,
    normalizeSolveProfile: (profile) =>
      profile === 'industry-parity' ? 'industry-parity-current' : profile,
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

const prefixedId = (prefix: string, id: string): string => `${prefix}${id}`;

const buildImportedTsInput = (fixture: BrowserBenchmarkFixture): string => {
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

const buildImportedGnssInput = (fixture: BrowserBenchmarkFixture): string => {
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

const buildImportedLevelingInput = (fixture: BrowserBenchmarkFixture): string => {
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

const buildBenchmarkInput = (fixture: BrowserBenchmarkFixture): string => {
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

const sortIds = (ids: string[]): string[] =>
  [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

describe('browser large-project benchmark coverage', () => {
  it.each(benchmarkFixtures)(
    'keeps imported-job solve, rerun, render, and artifact work within guardrails for %s',
    async (fixture) => {
      resetScenarioRunServiceCache();
      const input = buildBenchmarkInput(fixture);
      const request = createRunSessionRequest({
        input,
        parseSettings: {
          ...createRunSessionRequest().parseSettings,
          coordMode: fixture.kind === 'imported-leveling' ? '3D' : '2D',
        },
      });

      const solveStart = performance.now();
      const outcome = runAdjustmentSession(request);
      const solveDurationMs = performance.now() - solveStart;

      expect(outcome.result.success).toBe(true);
      expect(outcome.result.converged).toBe(true);
      expect(Object.keys(outcome.result.stations)).toHaveLength(fixture.expectedStationCount);
      expect(outcome.result.observations).toHaveLength(fixture.expectedObservationCount);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(solveDurationMs).toBeLessThan(fixture.solveBudgetMs);
      const firstRunStats = getScenarioRunServiceStats();
      expect(firstRunStats.parseCacheMisses).toBeGreaterThanOrEqual(1);
      expect(firstRunStats.planningCacheMisses).toBeGreaterThanOrEqual(1);

      const rerunStart = performance.now();
      const rerunOutcome = runAdjustmentSession(request);
      const rerunDurationMs = performance.now() - rerunStart;

      expect(rerunOutcome.result.success).toBe(true);
      expect(rerunOutcome.result.converged).toBe(true);
      expect(rerunDurationMs).toBeLessThan(fixture.rerunBudgetMs);
      const rerunStats = getScenarioRunServiceStats();
      expect(rerunStats.parseCacheHits).toBeGreaterThan(firstRunStats.parseCacheHits);
      expect(rerunStats.planningCacheHits).toBeGreaterThan(firstRunStats.planningCacheHits);

      const artifactStart = performance.now();
      const artifactResult = buildExportArtifacts(
        createArtifactRequest(request, outcome.result, fixture.artifactFormat),
      );
      const artifactDurationMs = performance.now() - artifactStart;

      expect(artifactDurationMs).toBeLessThan(fixture.artifactBuildBudgetMs);
      expect(artifactResult.files.length).toBeGreaterThan(0);
      expect(artifactResult.files.some((file) => file.name.endsWith('.txt'))).toBe(true);

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);
      const derived = buildQaDerivedResult(outcome.result);
      const firstObservationId = outcome.result.observations[0]?.id ?? null;
      const sortedStationIds = sortIds(Object.keys(outcome.result.stations));
      const firstStationId = sortedStationIds[0] ?? null;
      const lastStationId = sortedStationIds[sortedStationIds.length - 1] ?? null;

      const BenchmarkHarness: React.FC = () => {
        const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
          firstObservationId,
        );
        const [selectedStationId, setSelectedStationId] = React.useState<string | null>(
          firstStationId,
        );
        return (
          <div>
            <div data-selection-status>
              obs:{selectedObservationId ?? '-'} station:{selectedStationId ?? '-'}
            </div>
            <ReportView
              result={outcome.result}
              units="m"
              runDiagnostics={null}
              excludedIds={new Set<number>()}
              onToggleExclude={() => {}}
              onApplyImpactExclude={() => {}}
              onApplyPreanalysisAction={() => {}}
              onReRun={() => {}}
              onClearExclusions={() => {}}
              overrides={{}}
              onOverride={() => {}}
              onResetOverrides={() => {}}
              clusterReviewDecisions={{}}
              activeClusterApprovedMerges={[]}
              onClusterDecisionStatus={() => {}}
              onClusterCanonicalSelection={() => {}}
              onApplyClusterMerges={() => {}}
              onResetClusterReview={() => {}}
              onClearClusterMerges={() => {}}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
            <MapView
              result={outcome.result}
              units="m"
              derivedResult={derived}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
          </div>
        );
      };

      const renderStart = performance.now();
      await act(async () => {
        root.render(<BenchmarkHarness />);
      });
      const renderDurationMs = performance.now() - renderStart;

      expect(renderDurationMs).toBeLessThan(fixture.renderBudgetMs);
      expect(container.textContent).toContain('Adjusted Coordinates');
      expect(container.textContent).toContain(firstStationId ?? '');
      expect(container.querySelectorAll('[data-map-station]').length).toBe(
        fixture.expectedStationCount,
      );
      expect(container.querySelectorAll('[data-map-label]').length).toBeLessThanOrEqual(
        fixture.expectedStationCount,
      );

      const showMoreButton = container.querySelector(
        '[data-report-load-more="adjusted-coordinates"]',
      ) as HTMLButtonElement | null;
      const firstObservationRow = container.querySelector(
        `[data-report-observation-row="${firstObservationId}"]`,
      ) as HTMLTableRowElement | null;
      expect(firstObservationRow).not.toBeNull();
      const coordinateHeading = Array.from(container.querySelectorAll('h3')).find((node) =>
        node.textContent?.includes('Adjusted Coordinates'),
      );
      const coordinateSection = coordinateHeading?.parentElement?.parentElement ?? null;
      const expectedInitialRowCount =
        fixture.expectedStationCount > fixture.reportWindowSize
          ? fixture.reportWindowSize
          : fixture.expectedStationCount;
      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(expectedInitialRowCount);

      await act(async () => {
        firstObservationRow?.click();
        showMoreButton?.click();
      });

      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(
        fixture.expectedStationCount,
      );
      expect(container.textContent).toContain(lastStationId ?? '');
      expect(container.querySelector('[data-selection-status]')?.textContent).toContain(
        `obs:${firstObservationId}`,
      );
      expect(container.querySelector(`[data-map-station="${firstStationId}"]`)).not.toBeNull();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    BENCHMARK_CASE_TIMEOUT_MS,
  );
});
