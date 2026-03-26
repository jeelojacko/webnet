import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { normalizeIndustryParityCaseText } from '../src/engine/industryParityText';
import { ACTIVE_INDUSTRY_PARITY_CASE, INDUSTRY_PARITY_CASES } from '../src/industryParityCases';

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

  it('solves the active leveling startup case as a height-only network with reference-like elevations', () => {
    const startup = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults;
    expect(startup).toBeDefined();
    const result = new LSAEngine({
      input: startup?.input ?? '',
      maxIterations: 15,
      convergenceThreshold: 0.001,
      instrumentLibrary: startup?.projectInstruments,
      parseOptions: {
        currentInstrument: startup?.selectedInstrument,
        coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
        order: startup?.parseSettingsPatch.order ?? 'EN',
      },
    }).solve();

    if (!result.success) {
      console.log(result.logs.join('\n'));
    }

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.observations.filter((obs) => obs.type === 'lev')).toHaveLength(60);
    expect(Math.abs((result.stations.GPS3?.h ?? Number.NaN) - 51.9278)).toBeLessThanOrEqual(
      0.001,
    );
    expect(Math.abs((result.stations.GATE?.h ?? Number.NaN) - 48.4755)).toBeLessThanOrEqual(
      0.001,
    );
    expect(Math.abs((result.stations.APOG?.h ?? Number.NaN) - 117.7601)).toBeLessThanOrEqual(
      0.001,
    );
  });

  it('keeps the copied leveling reference output available for future exact normalized text parity work', () => {
    const outputText = readFileSync(INDUSTRY_PARITY_CASES.leveling.fixtureOutputPath, 'utf-8');
    const normalized = normalizeIndustryParityCaseText(outputText, INDUSTRY_PARITY_CASES.leveling);

    expect(normalized).toContain('Adjusted Elevations and Error Propagation');
    expect(normalized).toContain('Adjusted Differential Level Observations');
  });
});
