import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createInitialParseSettings,
  createInitialProjectInstruments,
  createInitialSettingsState,
} from '../src/app/AppInitialState';
import { ACTIVE_PARITY_STARTUP_DEFAULTS, APP_STARTUP_DEFAULTS } from '../src/app/appConfig';
import {
  ACTIVE_INDUSTRY_PARITY_CASE,
  ACTIVE_INDUSTRY_PARITY_CASE_ID,
  INDUSTRY_PARITY_CASES,
} from '../src/industryParityCases';
import { PERMANENT_EXAMPLE_PROJECTS } from '../src/engine/permanentExampleProjects';

const normalizeInput = (raw: string): string =>
  raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

const canonicalCombinedInput = normalizeInput(
  readFileSync('tests/fixtures/industry_case_combined_input.txt', 'utf-8'),
);
const campInput = normalizeInput(
  readFileSync('tests/fixtures/camp_design_preanalysis_traverse_only.dat', 'utf-8'),
);

// startupDefaults is optional on the case type even though every case defines it.
const appStartup = APP_STARTUP_DEFAULTS!;
const combinedStartup = INDUSTRY_PARITY_CASES.combined.startupDefaults!;
const campStartup = INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults!;

// Robust marker unique to the combined case; the camp traverse-only startup
// shares the '#Traverse Only' / pre-analysis header, so that cannot distinguish.
const COMBINED_ONLY_MARKER = '.PTOL /CON APOG BROD';

describe('fresh bootstrap startup defaults (combined canonical example)', () => {
  it('seeds the combined startup input, not the camp traverse-only input', () => {
    expect(appStartup.input).toBe(canonicalCombinedInput);
    expect(appStartup.input).toContain(COMBINED_ONLY_MARKER);
    expect(appStartup.input).not.toBe(campInput);
    expect(appStartup.input).not.toContain('CAMP_DESIGN');
    // Guard the marker itself: camp input must not contain it.
    expect(campInput).not.toContain('.PTOL');
  });

  it('boots in Adjustment mode with combined grid/CRS parse settings', () => {
    const parseSettings = createInitialParseSettings();
    expect(parseSettings.runMode).toBe('adjustment');
    expect(parseSettings.preanalysisMode).toBe(false);
    expect(parseSettings.coordSystemMode).toBe('grid');
    expect(parseSettings.crsId).toBe('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(parseSettings.order).toBe('NE');
    expect(parseSettings.deltaMode).toBe('slope');
    expect(parseSettings.angleStationOrder).toBe('atfromto');
    expect(parseSettings.lonSign).toBe('west-positive');
    expect(parseSettings.verticalDeflectionNorthSec).toBe(-2.91);
    expect(parseSettings.verticalDeflectionEastSec).toBe(-1.46);
    expect(parseSettings.applyCurvatureRefraction).toBe(true);
    expect(parseSettings.verticalReduction).toBe('curvref');
    expect(parseSettings.refractionCoefficient).toBe(0.07);
  });

  it('seeds combined setting and traverse instrument defaults', () => {
    expect(createInitialSettingsState().convergenceLimit).toBe(0.01);

    const instruments = createInitialProjectInstruments();
    expect(Object.keys(instruments)).toContain('TRAV_DEFAULT');
    expect(appStartup.selectedInstrument).toBe('TRAV_DEFAULT');
    expect(appStartup.projectInstruments).toBe(combinedStartup.projectInstruments);
  });

  it('does not seed a project name or project run files for the untitled workspace', () => {
    expect(appStartup.projectName).toBeUndefined();
    expect(appStartup.projectRunFiles ?? []).toEqual([]);
  });

  it('keeps the parity ACTIVE case on campDesignPreanalysis (option b split)', () => {
    expect(ACTIVE_INDUSTRY_PARITY_CASE_ID).toBe('campDesignPreanalysis');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.id).toBe('campDesignPreanalysis');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults?.selectedInstrument).toBe('CAMP_DEFAULT');
    expect(campStartup.parseSettingsPatch.runMode).toBe('preanalysis');
    expect(ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults).not.toBe(appStartup);
    expect(appStartup).toBe(combinedStartup);
    // The legacy alias intentionally tracks the app startup example.
    expect(ACTIVE_PARITY_STARTUP_DEFAULTS).toBe(appStartup);
  });
});

describe('permanent example projects registry', () => {
  it('keeps exactly preanalysis, combined, and combined-split with unchanged urls', () => {
    expect(PERMANENT_EXAMPLE_PROJECTS.map((project) => project.id)).toEqual([
      'preanalysis',
      'combined',
      'combined-split',
    ]);
    expect(PERMANENT_EXAMPLE_PROJECTS.map((project) => project.projectUrl)).toEqual([
      '/examples/preanalysis/project.wnproj',
      '/examples/combined/project.wnproj',
      '/examples/combined-split/project.wnproj',
    ]);
  });
});
