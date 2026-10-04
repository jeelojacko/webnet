import { DEFAULT_INPUT } from '../defaultInput';
import {
  normalizeListingSortObservationsBy,
} from '../listingSortObservations';
import {
  APP_STARTUP_DEFAULTS,
} from './appConfig';
import {
  createDefaultS9Instrument,
  parseInstrumentLibraryFromInput,
} from './appHelpers';
import {
  createBaseParseSettings,
  createBaseSettingsState,
  createInitialAdjustedPointsExportSettings,
} from './baseProjectDefaults';
import type { ParseSettings, SettingsState } from '../appStateTypes';
import type { InstrumentLibrary } from '../types';

export { createBaseParseSettings, createBaseSettingsState };
export { createInitialAdjustedPointsExportSettings };

/**
 * Fresh-startup (Combined example) state: base factory defaults overlaid with
 * APP_STARTUP_DEFAULTS. New-blank-project state MUST use the base factories
 * directly (see blankProjectDefaults.ts), never these startup-seeded ones.
 */
export const createInitialSettingsState = (): SettingsState => {
  const seed: SettingsState = {
    ...createBaseSettingsState(),
    ...APP_STARTUP_DEFAULTS?.settingsPatch,
  };
  return {
    ...seed,
    listingSortObservationsBy: normalizeListingSortObservationsBy(seed.listingSortObservationsBy, {
      legacyResidualMeansStdResidual: true,
    }),
  };
};

export const createInitialParseSettings = (): ParseSettings => ({
  ...createBaseParseSettings(),
  ...APP_STARTUP_DEFAULTS?.parseSettingsPatch,
});

export const createInitialProjectInstruments = (): InstrumentLibrary => ({
  S9: createDefaultS9Instrument(),
  ...(APP_STARTUP_DEFAULTS?.projectInstruments ?? {}),
  ...parseInstrumentLibraryFromInput(APP_STARTUP_DEFAULTS?.input ?? DEFAULT_INPUT),
});
