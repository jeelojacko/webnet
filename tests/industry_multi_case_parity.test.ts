import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import { normalizeIndustryParityCaseText } from '../src/engine/industryParityText';
import { ACTIVE_INDUSTRY_PARITY_CASE, INDUSTRY_PARITY_CASES } from '../src/industryParityCases';

const buildCaseResult = (caseId: keyof typeof INDUSTRY_PARITY_CASES) => {
  const startup = INDUSTRY_PARITY_CASES[caseId].startupDefaults;
  expect(startup).toBeDefined();

  return new LSAEngine({
    input: startup?.input ?? '',
    maxIterations: 15,
    convergenceThreshold: startup?.settingsPatch.convergenceLimit ?? 0.001,
    instrumentLibrary: startup?.projectInstruments,
    parseOptions: {
      currentInstrument: startup?.selectedInstrument,
      coordSystemMode: startup?.parseSettingsPatch.coordSystemMode,
      crsId: startup?.parseSettingsPatch.crsId,
      coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
      order: startup?.parseSettingsPatch.order ?? 'EN',
      deltaMode: startup?.parseSettingsPatch.deltaMode ?? 'slope',
      angleStationOrder: startup?.parseSettingsPatch.angleStationOrder ?? 'atfromto',
      lonSign: startup?.parseSettingsPatch.lonSign ?? 'west-negative',
      applyCurvatureRefraction: startup?.parseSettingsPatch.applyCurvatureRefraction,
      verticalReduction: startup?.parseSettingsPatch.verticalReduction,
      refractionCoefficient: startup?.parseSettingsPatch.refractionCoefficient,
    },
  }).solve();
};

describe('industry multi-case parity foundation', () => {
  it('registers committed fixture paths for each manual industry case', () => {
    Object.values(INDUSTRY_PARITY_CASES).forEach((spec) => {
      expect(existsSync(spec.fixtureInputPath), `${spec.id} input fixture should exist`).toBe(true);
      expect(existsSync(spec.fixtureOutputPath), `${spec.id} output fixture should exist`).toBe(
        true,
      );
    });
  });

  it('normalizes only the volatile header lines required by the parity workflow', () => {
    const raw = [
      'MicroSurvey STAR*NET-PRO Version 13.0.2.5829',
      'Run Date: Thu May  1 2025 11:15:46',
      '      Project Folder     C:\\TEMP\\CASE',
      '      Data File List  1. Level_Adjustment.dat',
      '      Project Units                       : Meters',
    ].join('\n');

    const normalized = normalizeIndustryParityCaseText(raw, ACTIVE_INDUSTRY_PARITY_CASE);

    expect(normalized).toContain('MicroSurvey STAR*NET-PRO Version <normalized>');
    expect(normalized).toContain('Run Date: <normalized>');
    expect(normalized).toContain('Project Folder     <normalized>');
    expect(normalized).toContain('Data File List  <normalized>');
    expect(normalized).toContain('Project Units                       : Meters');
  });

  it('makes the traverse case the active startup default with the expected grid settings and instruments', () => {
    expect(ACTIVE_INDUSTRY_PARITY_CASE.id).toBe('traverse');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults).toBeDefined();

    const startup = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults!;
    expect(startup.input).toContain('#Traverse Only');
    expect(startup.input).toContain('#-------------------------------CONTROL----------------------------------#');
    expect(startup.input).not.toContain('Project Option Settings');
    expect(startup.settingsPatch.convergenceLimit).toBe(0.01);
    expect(startup.parseSettingsPatch.coordMode).toBe('3D');
    expect(startup.parseSettingsPatch.coordSystemMode).toBe('grid');
    expect(startup.parseSettingsPatch.crsId).toBe('CA_NAD83_NB83_STEREO_DOUBLE');
    expect(startup.parseSettingsPatch.order).toBe('NE');
    expect(startup.parseSettingsPatch.lonSign).toBe('west-positive');
    expect(startup.parseSettingsPatch.applyCurvatureRefraction).toBe(true);
    expect(startup.parseSettingsPatch.verticalReduction).toBe('curvref');
    expect(startup.parseSettingsPatch.refractionCoefficient).toBe(0.07);
    expect(startup.selectedInstrument).toBe('TRAV_DEFAULT');
    expect(Object.keys(startup.projectInstruments).sort()).toEqual([
      'S9',
      'SX12',
      'TRAV_DEFAULT',
      'TS11',
    ]);
  });

  it('keeps the copied leveling reference output available for future exact normalized text parity work', () => {
    const outputText = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const normalized = normalizeIndustryParityCaseText(outputText, INDUSTRY_PARITY_CASES.leveling);

    expect(normalized).toContain('Adjusted Elevations and Error Propagation');
    expect(normalized).toContain('Adjusted Differential Level Observations');
  });

  it(
    'matches the traverse startup zenith summary after curvature/refraction parity fixes',
    () => {
      const withStartupDefaults = buildCaseResult('traverse');
      expect(withStartupDefaults.success).toBe(true);
      expect(withStartupDefaults.statisticalSummary).toBeDefined();
      const statisticalSummary = withStartupDefaults.statisticalSummary!;

      const zenith = statisticalSummary.byGroup.find(
        (row) => row.label === 'Zenith',
      );
      expect(zenith).toBeDefined();
      expect(zenith?.sumSquares ?? Number.NaN).toBeCloseTo(807.697, 0);
      expect(zenith?.errorFactor ?? Number.NaN).toBeCloseTo(1.51, 2);
    },
    120000,
  );

  it('matches the leveling reference listing exactly from project option settings to the file end', () => {
    const startup = INDUSTRY_PARITY_CASES.leveling.startupDefaults;
    expect(startup).toBeDefined();

    const result = buildCaseResult('leveling');
    expect(result.success).toBe(true);

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 15,
        convergenceLimit: startup?.settingsPatch.convergenceLimit,
        precisionReportingMode: 'industry-standard',
        units: 'm',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: true,
        listingShowAzimuthsBearings: true,
        listingShowLostStations: true,
        listingSortCoordinatesBy: 'input',
        listingSortObservationsBy: 'residual',
        listingObservationLimit: 9999,
      },
      {
        coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
        order: startup?.parseSettingsPatch.order ?? 'EN',
        angleUnits: startup?.parseSettingsPatch.angleUnits ?? 'dms',
        angleStationOrder: startup?.parseSettingsPatch.angleStationOrder ?? 'atfromto',
        deltaMode: startup?.parseSettingsPatch.deltaMode ?? 'slope',
        refractionCoefficient: startup?.parseSettingsPatch.refractionCoefficient ?? 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: '',
        rotationAngleRad: 0,
        currentInstrumentCode: startup?.selectedInstrument,
        currentInstrumentDesc: startup?.projectInstruments[startup?.selectedInstrument ?? '']?.desc,
        currentInstrumentLevStdMmPerKm:
          startup?.projectInstruments[startup?.selectedInstrument ?? '']?.levStd_mmPerKm,
      },
    );

    const referenceOutput = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const startMarker = 'Project Option Settings';
    const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normalizedReferenceOutput = normalizeLineEndings(referenceOutput);
    const normalizedListing = normalizeLineEndings(listing);

    expect(normalizedReferenceOutput.slice(normalizedReferenceOutput.indexOf(startMarker))).toBe(
      normalizedListing.slice(normalizedListing.indexOf(startMarker)),
    );
  });
});
