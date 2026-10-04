import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createInitialParseSettings,
  createInitialProjectInstruments,
  createInitialSettingsState,
} from '../src/app/AppInitialState';
import { APP_STARTUP_DEFAULTS } from '../src/app/appConfig';

const normalizeInput = (raw: string): string =>
  raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

const manifest = JSON.parse(readFileSync('public/examples/combined/project.wnproj', 'utf-8'));
const manifestMainDat = normalizeInput(
  readFileSync('public/examples/combined/data/main.dat', 'utf-8'),
);
const fixtureInput = normalizeInput(
  readFileSync('tests/fixtures/industry_case_combined_input.txt', 'utf-8'),
);

describe('combined startup seed matches permanent manifest bootstrap semantics', () => {
  it('manifest main.dat input matches the combined fixture input', () => {
    expect(manifestMainDat).toBe(fixtureInput);
    expect(APP_STARTUP_DEFAULTS?.input).toBe(fixtureInput);
  });

  it('startup settings match manifest ui.settings', () => {
    const settings = createInitialSettingsState();
    expect(settings.convergenceLimit).toBe(manifest.ui.settings.convergenceLimit);
    expect(settings.convergenceLimit).toBe(0.01);
    expect(settings.maxIterations).toBe(manifest.ui.settings.maxIterations);
  });

  it('startup parse settings match manifest ui.parseSettings, incl. the 3 overlay fields', () => {
    const parse = createInitialParseSettings();
    const mps = manifest.ui.parseSettings;
    const fields = [
      'coordMode',
      'coordSystemMode',
      'crsId',
      'order',
      'deltaMode',
      'angleStationOrder',
      'lonSign',
      'verticalDeflectionNorthSec',
      'verticalDeflectionEastSec',
      'applyCurvatureRefraction',
      'verticalReduction',
      'refractionCoefficient',
      'suspectImpactMode',
      'levelWeight',
      'positionalToleranceEnabled',
      'qFixLinearSigmaM',
      'qFixAngularSigmaSec',
      'runMode',
      'preanalysisMode',
    ] as const;
    for (const field of fields) {
      expect(parse[field], field).toEqual(mps[field]);
    }
    // The three reviewer-confirmed gaps the manifest overlay covers.
    expect(parse.suspectImpactMode).toBe('off');
    expect(parse.levelWeight).toBe(1.5);
    expect(parse.positionalToleranceEnabled).toBe(true);
  });

  it('startup instruments match manifest project instruments', () => {
    const instruments = createInitialProjectInstruments();
    for (const code of Object.keys(manifest.project.projectInstruments)) {
      expect(instruments[code]).toEqual(manifest.project.projectInstruments[code]);
    }
    expect(APP_STARTUP_DEFAULTS?.selectedInstrument).toBe(
      manifest.project.selectedInstrument,
    );
  });
});
