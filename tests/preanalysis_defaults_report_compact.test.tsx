/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createBaseParseSettings } from '../src/app/baseProjectDefaults';
import { buildBlankProjectWorkspace } from '../src/app/blankProjectDefaults';
import { createInitialParseSettings } from '../src/app/AppInitialState';
import {
  DEFAULT_PREANALYSIS_ACCURACY_THRESHOLD_METERS,
  DEFAULT_PREANALYSIS_MAX_ADDED_SETS,
} from '../src/engine/defaults';
import {
  createProjectId,
  type ProjectSessionState,
} from '../src/engine/projectWorkspace';
import { buildProjectIndexRow } from '../src/engine/projectStorage';
import {
  buildParsedPayloadFromSession,
  createFlatProjectManifestSeed,
} from '../src/hooks/projectFilePayloadBuilders';
import { useProjectPayloadLoader } from '../src/hooks/useProjectPayloadLoader';
import {
  React,
  act,
  useState,
  createRoot,
  cloneInstrumentLibrary,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  type Root,
  type ParseSettings,
} from './projectFileWorkflowState/projectFileWorkflowStateTestSupport';

const readManifestParseSettings = (path: string) =>
  JSON.parse(readFileSync(path, 'utf-8')).ui.parseSettings;

const applyPayloadAndCaptureParseSettings = async (
  mutate: (_parseSettings: Record<string, unknown>) => void,
): Promise<ParseSettings> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const createdAt = '2026-06-01T10:00:00.000Z';
  const seed = createFlatProjectManifestSeed({
    projectId: createProjectId(),
    name: 'Probe',
    createdAt,
    updatedAt: createdAt,
    workspace: buildBlankProjectWorkspace(),
    cloneInstrumentLibrary,
  });
  const session: ProjectSessionState = {
    indexRow: buildProjectIndexRow({
      id: seed.manifest.projectId,
      name: 'Probe',
      backend: 'indexeddb',
      createdAt,
      updatedAt: createdAt,
    }),
    manifest: seed.manifest,
    sourceTexts: seed.sourceTexts,
    dirtyFileIds: [],
    manifestDirty: false,
    autosaveState: 'idle',
    lastAutosavedAt: null,
    lastAutosaveError: null,
  };
  const parsed = buildParsedPayloadFromSession(session);
  mutate(parsed.ui.parseSettings as unknown as Record<string, unknown>);
  let captured: ParseSettings | null = null;
  const noop = () => undefined;
  const CaptureHarness = () => {
    const [parseSettings] = useState<ParseSettings>(() => createBaseParseSettings());
    const { applyLoadedProjectPayload } = useProjectPayloadLoader({
      buildObservationModeFromGridFields,
      cloneInstrumentLibrary,
      currentUiTheme: 'gruvbox-dark',
      normalizeSolveProfile,
      resetWorkspaceAfterProjectLoad: noop,
      restoreSavedRunSnapshots: noop as unknown as () => void,
      setAdjustedPointsExportSettings: noop as never,
      setAdjustedPointsExportSettingsDraft: noop as never,
      setAdjustedPointsTransformSelectedDraft: noop as never,
      setExportFormat: noop as never,
      setGeoidSourceData: noop as never,
      setGeoidSourceDataDraft: noop as never,
      setGeoidSourceDataLabel: noop as never,
      setGeoidSourceDataLabelDraft: noop as never,
      setInput: noop as never,
      setIsAdjustedPointsTransformSelectOpen: noop as never,
      setLevelLoopCustomPresets: noop as never,
      setLevelLoopCustomPresetsDraft: noop as never,
      setParseSettings: ((value: React.SetStateAction<ParseSettings>) => {
        const resolved =
          typeof value === 'function'
            ? (value as (_prev: ParseSettings) => ParseSettings)(parseSettings)
            : value;
        captured = resolved;
      }) as never,
      setParseSettingsDraft: noop as never,
      setPlanningMap: noop as never,
      setProjectIncludeFiles: noop as never,
      setProjectInstruments: noop as never,
      setProjectInstrumentsDraft: noop as never,
      setSelectedInstrument: noop as never,
      setSelectedInstrumentDraft: noop as never,
      setSettings: noop as never,
      setSettingsDraft: noop as never,
    });
    return (
      <button
        type="button"
        id="probe-apply"
        onClick={() => applyLoadedProjectPayload(parsed, null, [])}
      >
        apply
      </button>
    );
  };
  try {
    await act(async () => {
      root.render(<CaptureHarness />);
    });
    await act(async () => {
      (container.querySelector('#probe-apply') as HTMLButtonElement).click();
    });
    expect(captured).not.toBeNull();
    return captured as unknown as ParseSettings;
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
};

describe('preanalysis planning defaults (0.005 m / 3 sets)', () => {
  it('exposes the new defaults through the central authority', () => {
    expect(DEFAULT_PREANALYSIS_ACCURACY_THRESHOLD_METERS).toBe(0.005);
    expect(DEFAULT_PREANALYSIS_MAX_ADDED_SETS).toBe(3);
  });

  it('createBaseParseSettings carries the new defaults', () => {
    const base = createBaseParseSettings();
    expect(base.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(base.preanalysisMaxAddedSets).toBe(3);
  });

  it('blank Create New Project latent preanalysis fields match the new defaults', () => {
    const blank = buildBlankProjectWorkspace();
    expect(blank.parseSettings.runMode).toBe('adjustment');
    expect(blank.parseSettings.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(blank.parseSettings.preanalysisMaxAddedSets).toBe(3);
  });

  it('fresh Combined startup resolves to the new defaults while staying in Adjustment', () => {
    const startup = createInitialParseSettings();
    expect(startup.runMode).toBe('adjustment');
    expect(startup.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(startup.preanalysisMaxAddedSets).toBe(3);
  });

  it('permanent Combined manifest carries the new defaults and stays Adjustment', () => {
    const manifest = readManifestParseSettings('public/examples/combined/project.wnproj');
    expect(manifest.runMode).toBe('adjustment');
    expect(manifest.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(manifest.preanalysisMaxAddedSets).toBe(3);
  });

  it('permanent Combined-split manifest carries the new defaults and stays Adjustment', () => {
    const manifest = readManifestParseSettings('public/examples/combined-split/project.wnproj');
    expect(manifest.runMode).toBe('adjustment');
    expect(manifest.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(manifest.preanalysisMaxAddedSets).toBe(3);
  });

  it('permanent Pre-analysis manifest carries the new defaults and stays Preanalysis', () => {
    const manifest = readManifestParseSettings('public/examples/preanalysis/project.wnproj');
    expect(manifest.runMode).toBe('preanalysis');
    expect(manifest.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(manifest.preanalysisMaxAddedSets).toBe(3);
  });

  it('imported payloads with explicit old values preserve them exactly', async () => {
    const applied = await applyPayloadAndCaptureParseSettings((parseSettings) => {
      parseSettings.preanalysisAccuracyThresholdMeters = 0.001;
      parseSettings.preanalysisMaxAddedSets = 5;
    });
    expect(applied.preanalysisAccuracyThresholdMeters).toBe(0.001);
    expect(applied.preanalysisMaxAddedSets).toBe(5);
  });

  it('imported payloads missing the fields receive the new defaults', async () => {
    const applied = await applyPayloadAndCaptureParseSettings((parseSettings) => {
      delete parseSettings.preanalysisAccuracyThresholdMeters;
      delete parseSettings.preanalysisMaxAddedSets;
    });
    expect(applied.preanalysisAccuracyThresholdMeters).toBe(0.005);
    expect(applied.preanalysisMaxAddedSets).toBe(3);
  });
});
