import { describe, expect, it } from 'vitest';

import { buildPendingRunSettingDiffs } from '../src/app/appHelpers';
import type { RunSettingsSnapshot } from '../src/appRunStateTypes';
import { sanitizeReliabilityPolicy } from '../src/engine/reliabilityPolicy';
import { attachReliabilitySettings } from '../src/engine/projectFileSanitizers';
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

describe('reliability policy persistence', () => {
  it('round-trips the policy through project files', () => {
    const text = serializeProjectFile({
      input: '.2D',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: defaults.settings,
        parseSettings: {
          ...defaults.parseSettings,
          reliabilityPolicy: { model: 'statistical', alpha: 0.001, power: 0.9 },
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
    expect(parsed.project.ui.parseSettings.reliabilityPolicy).toEqual({
      model: 'statistical',
      alpha: 0.001,
      power: 0.9,
    });
  });

  it('loads legacy projects without the field as legacy default', () => {
    const parseSettings: Record<string, unknown> = {};
    attachReliabilitySettings(parseSettings, {});
    expect(parseSettings.reliabilityPolicy).toBeUndefined();
    expect(sanitizeReliabilityPolicy(undefined)).toBeUndefined();
  });

  it('drops invalid policies back to the default instead of failing the load', () => {
    const parseSettings: Record<string, unknown> = {};
    attachReliabilitySettings(parseSettings, {
      reliabilityPolicy: { model: 'bogus', alpha: 99 },
    });
    expect(parseSettings.reliabilityPolicy).toBeUndefined();
    expect(sanitizeReliabilityPolicy({ model: 'statistical', alpha: 0.001 })).toEqual({
      model: 'statistical',
      alpha: 0.001,
    });
  });
});

describe('reliability policy stale-run detection', () => {
  it('marks prior results stale when the policy changes', () => {
    const diffs = buildPendingRunSettingDiffs(
      { ...snapshotBase, reliabilityPolicy: { model: 'statistical', alpha: 0.001, power: 0.9 } },
      { ...snapshotBase, reliabilityPolicy: undefined },
    );
    expect(diffs.some((d) => d.startsWith('Reliability:'))).toBe(true);
  });

  it('treats normalized-equal policies as equivalent', () => {
    const diffs = buildPendingRunSettingDiffs(
      {
        ...snapshotBase,
        reliabilityPolicy: { model: 'legacy-3.29', alpha: 0.001, power: 0.8 },
      },
      { ...snapshotBase, reliabilityPolicy: undefined },
    );
    expect(diffs).toEqual([]);
  });

  it('gives legacy and statistical runs different settings fingerprints', () => {
    const legacyPrint = buildValueFingerprint({ ...snapshotBase, reliabilityPolicy: undefined });
    const statisticalPrint = buildValueFingerprint({
      ...snapshotBase,
      reliabilityPolicy: { model: 'statistical', alpha: 0.001, power: 0.8 },
    });
    expect(statisticalPrint).not.toBe(legacyPrint);
  });
});
