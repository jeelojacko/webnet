import { describe, expect, it } from 'vitest';

import { buildPendingRunSettingDiffs } from '../src/app/appHelpers';
import type { RunSettingsSnapshot } from '../src/appRunStateTypes';
import { sanitizeLocalTestPolicy } from '../src/engine/localTestPolicy';
import { attachLocalTestPolicySettings } from '../src/engine/projectFileSanitizers';
import { buildValueFingerprint } from '../src/engine/qaWorkflowSnapshots';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  defaults,
  parseProjectFile,
  serializeProjectFile,
} from './projectFile/projectFileTestSupport';

const snapshotBase = {
  units: 'm',
  runMode: 'adjustment',
  solveProfile: 'industry-parity',
  coordMode: '2D',
  coordSystemMode: 'local',
  crsId: '',
  maxIterations: 8,
  convergenceLimit: 0.002,
  precisionReportingMode: 'industry-standard',
  directionSetMode: 'reduced',
  mapMode: 'off',
  mapScaleFactor: 1,
  verticalReduction: 'none',
  applyCurvatureRefraction: false,
  tsCorrelationEnabled: false,
  tsCorrelationScope: 'set',
  tsCorrelationRho: 0,
  robustMode: 'none',
  robustK: 1.5,
  clusterDetectionEnabled: false,
  autoSideshotEnabled: true,
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 1,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 3,
  suspectImpactMode: 'auto',
  selectedInstrument: '',
} as unknown as RunSettingsSnapshot;

describe('local test policy persistence', () => {
  it('round-trips the policy through project files', () => {
    const text = serializeProjectFile({
      input: '.2D',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: {
          ...defaults.parseSettings,
          localTestPolicy: { mode: 'baarda-w', alpha: 0.01, correction: 'sidak' },
        },
        exportFormat: 'webnet',
        adjustedPointsExport: DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
      },
      project: {
        projectInstruments: defaults.projectInstruments,
        selectedInstrument: 'S9',
        levelLoopCustomPresets: defaults.levelLoopCustomPresets,
      },
    });
    const parsed = parseProjectFile(text, defaults);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.ui.parseSettings.localTestPolicy).toEqual({
      mode: 'baarda-w',
      alpha: 0.01,
      correction: 'sidak',
    });
  });

  it('loads legacy projects without the field as legacy default', () => {
    const parseSettings: Record<string, unknown> = {};
    attachLocalTestPolicySettings(parseSettings, {});
    expect(parseSettings.localTestPolicy).toBeUndefined();
    expect(sanitizeLocalTestPolicy(undefined)).toBeUndefined();
  });

  it('drops invalid policies back to the default instead of failing the load', () => {
    const parseSettings: Record<string, unknown> = {};
    attachLocalTestPolicySettings(parseSettings, {
      localTestPolicy: { mode: 'bogus', alpha: 99 },
    });
    expect(parseSettings.localTestPolicy).toBeUndefined();
    expect(sanitizeLocalTestPolicy({ mode: 'pope-tau', alpha: 0.05 })).toEqual({
      mode: 'pope-tau',
      alpha: 0.05,
    });
  });
});

describe('local test policy stale-run detection', () => {
  it('marks prior results stale when the policy changes', () => {
    const diffs = buildPendingRunSettingDiffs(
      { ...snapshotBase, localTestPolicy: { mode: 'baarda-w', alpha: 0.05, correction: 'none' } },
      { ...snapshotBase, localTestPolicy: undefined },
    );
    expect(diffs.some((d) => d.startsWith('Local Test:'))).toBe(true);
  });

  it('treats normalized-equal policies as equivalent', () => {
    const diffs = buildPendingRunSettingDiffs(
      {
        ...snapshotBase,
        localTestPolicy: {
          mode: 'legacy-fixed',
          alpha: 0.05,
          correction: 'none',
          critical: 3.29,
        },
      },
      { ...snapshotBase, localTestPolicy: undefined },
    );
    expect(diffs).toEqual([]);
  });

  it('gives legacy and formal runs different settings fingerprints', () => {
    const legacyPrint = buildValueFingerprint({ ...snapshotBase, localTestPolicy: undefined });
    const formalPrint = buildValueFingerprint({
      ...snapshotBase,
      localTestPolicy: { mode: 'pope-tau', alpha: 0.05, correction: 'none' },
    });
    expect(formalPrint).not.toBe(legacyPrint);
  });
});
