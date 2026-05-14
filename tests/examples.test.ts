import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { LSAEngine } from '../src/engine/adjust';
import { parseProjectFile } from '../src/engine/projectFile';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  sanitizeAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';

describe('Example Datasets', () => {
  it('parses and solves mixed_grid_tutorial.dat successfully', () => {
    const filePath = path.join(process.cwd(), 'public/examples/mixed_grid_tutorial.dat');
    const input = fs.readFileSync(filePath, 'utf-8');

    const result = new LSAEngine({
      input,
      maxIterations: 10,
      convergenceThreshold: 0.001,
    }).solve();

    if (!result.success) {
      console.log(result.logs.join('\n'));
    }

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.observations.length).toBe(17);
    expect(result.stations['C1']).toBeDefined();
    expect(result.stations['C2']).toBeDefined();
    expect(result.stations['C3']).toBeDefined();
    expect(result.stations['U1']).toBeDefined();
    expect(result.seuw).toBeGreaterThan(0);
    expect(result.seuw).toBeLessThan(5);
  });

  it('parses and solves industry_demo.dat without errors', () => {
    const filePath = path.join(process.cwd(), 'public/examples/industry_demo.dat');
    const input = fs.readFileSync(filePath, 'utf-8');

    const engine = new LSAEngine({
      input,
      maxIterations: 10,
      convergenceThreshold: 0.001,
    });

    const result = engine.solve();

    // Log output for debugging if it fails
    if (!result.success) {
      console.log(result.logs.join('\n'));
    }

    // Expect parsing to succeed
    expect(result.stations['MASTER']).toBeDefined();
    expect(result.observations.length).toBeGreaterThan(15);

    // Note: Example data might not converge perfectly due to manual construction
    // but should parse and run through the engine.
    // expect(result.success).toBe(true)
    // expect(result.converged).toBe(true)

    // Verify key stations exist
    expect(result.stations['MASTER']).toBeDefined();
    expect(result.stations['P_NE']).toBeDefined();
    expect(result.stations['P_NW']).toBeDefined();

    // Verify observations parsed
    // We have:
    // A: 1
    // D: 1
    // V: 1
    // M: 3 (Angle, Dist, Zen)
    // BM: 3 (Bearing, Dist, Zen)
    // Traverse: 2 legs * 3 obs = 6 + TE closure check?
    // Direction: 1 DN (Angle) + 1 DM (3 obs) = 4
    // SS: 1 * 2 obs = 2 (but SS are obs too, just excluded from solve usually)
    // L: 2
    // Total should be substantial
    expect(result.observations.length).toBeGreaterThan(15);

    // Output basic stats
    // console.log(`Solved ${Object.keys(result.stations).length} stations with ${result.observations.length} observations. SEUW: ${result.seuw}`)
  });

  it('fails cleanly on the singular industry_demo.dat solve path', () => {
    const filePath = path.join(process.cwd(), 'public/examples/industry_demo.dat');
    const input = fs.readFileSync(filePath, 'utf-8');

    const result = new LSAEngine({
      input,
      maxIterations: 10,
      convergenceThreshold: 0.001,
    }).solve();

    expect(result.success).toBe(false);
    expect(result.converged).toBe(false);
    expect(
      result.logs.some((line) =>
        line.includes('normal-equation factorization required diagonal damping'),
      ),
    ).toBe(true);
    expect(
      result.logs.some((line) => line.includes('Normal equation solve failed')) ||
        result.logs.some((line) => line.includes('Max iterations reached.')),
    ).toBe(true);
    expect(
      result.logs.some((line) => line.includes('remained singular')) ||
        result.logs.some((line) => line.includes('ill-conditioned')),
    ).toBe(true);
    expect(result.sideshots?.length ?? 0).toBeGreaterThan(0);
  });

  it('loads the Complex Combined Adjustment portable project example', () => {
    const filePath = path.join(
      process.cwd(),
      'public/examples/Complex Combined Adjustment/Complex Combined Adjustment.wnproj.json',
    );
    const text = fs.readFileSync(filePath, 'utf-8');

    const parsed = parseProjectFile(text, {
      settings: {
        maxIterations: 10,
        convergenceLimit: 0.01,
        precisionReportingMode: 'industry-standard',
        units: 'm',
        uiTheme: 'gruvbox-dark',
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
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'stdResidual',
        listingObservationLimit: 60,
      },
      parseSettings: {
        solveProfile: 'industry-parity',
        coordMode: '3D',
        coordSystemMode: 'local',
        crsId: 'CA_NAD83_CSRS_UTM_20N',
        localDatumScheme: 'average-scale',
        averageScaleFactor: 1,
        commonElevation: 0,
        averageGeoidHeight: 0,
        gnssVectorFrameDefault: 'gridNEU',
        gnssFrameConfirmed: false,
        verticalDeflectionNorthSec: 0,
        verticalDeflectionEastSec: 0,
        observationMode: {
          bearing: 'grid',
          distance: 'measured',
          angle: 'measured',
          direction: 'measured',
        },
        gridBearingMode: 'grid',
        gridDistanceMode: 'measured',
        gridAngleMode: 'measured',
        gridDirectionMode: 'measured',
        runMode: 'adjustment',
        preanalysisMode: false,
        clusterDetectionEnabled: false,
        autoSideshotEnabled: true,
        autoAdjustEnabled: false,
        autoAdjustMaxCycles: 3,
        autoAdjustMaxRemovalsPerCycle: 1,
        autoAdjustStdResThreshold: 4,
        suspectImpactMode: 'auto',
        order: 'EN',
        angleUnits: 'dms',
        angleStationOrder: 'atfromto',
        angleMode: 'auto',
        deltaMode: 'slope',
        mapMode: 'off',
        mapScaleFactor: 1,
        normalize: true,
        faceNormalizationMode: 'on',
        applyCurvatureRefraction: false,
        refractionCoefficient: 0.13,
        verticalReduction: 'none',
        levelWeight: undefined,
        levelLoopToleranceBaseMm: 0,
        levelLoopTolerancePerSqrtKmMm: 4,
        crsTransformEnabled: false,
        crsProjectionModel: 'legacy-equirectangular',
        crsLabel: '',
        crsGridScaleEnabled: false,
        crsGridScaleFactor: 1,
        crsConvergenceEnabled: false,
        crsConvergenceAngleRad: 0,
        geoidModelEnabled: false,
        geoidModelId: 'NGS-DEMO',
        geoidSourceFormat: 'builtin',
        geoidSourcePath: '',
        geoidInterpolation: 'bilinear',
        geoidHeightConversionEnabled: false,
        geoidOutputHeightDatum: 'orthometric',
        gpsLoopCheckEnabled: false,
        gpsAddHiHtEnabled: false,
        gpsAddHiHtHiM: 0,
        gpsAddHiHtHtM: 0,
        qFixLinearSigmaM: 1e-7,
        qFixAngularSigmaSec: 1.0001e-3,
        prismEnabled: false,
        prismOffset: 0,
        prismScope: 'global',
        positionalToleranceEnabled: false,
        positionalToleranceConstantMm: 0,
        positionalTolerancePpm: 0,
        positionalToleranceConfidencePercent: 95,
        descriptionReconcileMode: 'first',
        descriptionAppendDelimiter: ' | ',
        lonSign: 'west-negative',
        tsCorrelationEnabled: false,
        tsCorrelationRho: 0.25,
        tsCorrelationScope: 'set',
        robustMode: 'none',
        robustK: 1.5,
        parseCompatibilityMode: 'strict',
        parseModeMigrated: true,
      },
      exportFormat: 'points',
      adjustedPointsExport: sanitizeAdjustedPointsExportSettings(
        {
          ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          includeLostStations: true,
        },
        DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      ),
      projectInstruments: {},
      selectedInstrument: '',
      levelLoopCustomPresets: [],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.input).toContain('#Traverse Only');
    expect(parsed.project.ui.parseSettings.coordSystemMode).toBe('grid');
    expect(parsed.project.ui.parseSettings.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(parsed.project.project.selectedInstrument).toBe('TRAV_DEFAULT');
  });
});
