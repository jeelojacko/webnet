import { describe, expect, it } from 'vitest';

import { buildExportArtifacts } from '../src/engine/exportArtifacts';
import { createRunProfileBuilders } from '../src/engine/runProfileBuilders';
import { runAdjustmentSession } from '../src/engine/runSession';
import type { ParseSettings, SettingsState } from '../src/appStateTypes';
import type { AdjustedPointsColumnId } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const simpleInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.0 0.01',
  'D B-P 64.0 0.01',
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

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

describe('buildExportArtifacts', () => {
  it('builds deterministic csv, geojson, and QA bundle artifacts from a solved run', () => {
    const request = createRunSessionRequest({
      input: simpleInput,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        coordMode: '2D',
      },
    });
    const outcome = runAdjustmentSession(request);
    expect(outcome.result.success).toBe(true);

    const { buildRunDiagnostics } = createRunProfileBuilders({
      projectInstruments: request.projectInstruments,
      selectedInstrument: request.selectedInstrument,
      defaultIndustryInstrumentCode: 'S9',
      defaultIndustryInstrument: request.projectInstruments.S9,
      normalizeSolveProfile: () => 'industry-parity',
    });
    const runDiagnostics = buildRunDiagnostics(
      request.parseSettings as ParseSettings,
      outcome.result,
    );
    const baseRequest = {
      dateStamp: '2026-03-20',
      result: outcome.result,
      units: request.units,
      settings: settingsFromRequest(request),
      parseSettings: request.parseSettings as ParseSettings,
      runDiagnostics,
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
      currentComparisonText: 'COMPARE',
    };

    const observationsCsv = buildExportArtifacts({
      ...baseRequest,
      exportFormat: 'observations-csv',
    });
    expect(observationsCsv.files).toEqual([
      expect.objectContaining({
        name: 'webnet-observations-residuals-2026-03-20.csv',
        mimeType: 'text/csv',
      }),
    ]);
    expect(observationsCsv.files[0]?.text).toContain('obsId,status,type,stations');

    const geoJson = buildExportArtifacts({
      ...baseRequest,
      exportFormat: 'geojson',
    });
    expect(geoJson.files).toEqual([
      expect.objectContaining({
        name: 'webnet-network-2026-03-20.geojson',
        mimeType: 'application/geo+json',
      }),
    ]);
    expect(JSON.parse(geoJson.files[0]?.text ?? '{}')).toEqual(
      expect.objectContaining({ type: 'FeatureCollection' }),
    );

    const bundle = buildExportArtifacts({
      ...baseRequest,
      exportFormat: 'bundle-qa-standard-with-landxml',
    });
    expect(bundle.noticeTitle).toBe('QA bundle exported');
    expect(bundle.files.map((file) => file.name)).toEqual([
      'webnet-qa-bundle-2026-03-20-comparison-summary.txt',
      'webnet-qa-bundle-2026-03-20-webnet-report.txt',
      'webnet-qa-bundle-2026-03-20-industry-listing.txt',
      'webnet-qa-bundle-2026-03-20-adjusted-points.csv',
      'webnet-qa-bundle-2026-03-20-network.xml',
    ]);
    expect(bundle.files[1]?.text).toContain('# WebNet Adjustment Results');
    expect(bundle.files[2]?.text).toContain('Adjusted Coordinates');
    expect(bundle.files[4]?.text).toContain('<LandXML');
  });
});
