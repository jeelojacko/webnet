/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { buildBlankProjectWorkspace } from '../src/app/blankProjectDefaults';
import { DEFAULT_PLANNING_MAP_STATE, clonePlanningMapState } from '../src/engine/planningMapState';
import {
  createManifestFromFlatProject,
  createProjectId,
  type ProjectSessionState,
} from '../src/engine/projectWorkspace';
import { buildProjectIndexRow } from '../src/engine/projectStorage';
import {
  buildParsedPayloadFromSession,
  createFlatProjectManifestSeed,
} from '../src/hooks/projectFilePayloadBuilders';
import { useProjectPayloadLoader } from '../src/hooks/useProjectPayloadLoader';
import { useAppReviewQueue } from '../src/hooks/useAppReviewQueue';
import type { ReviewQueueItem } from '../src/engine/reviewQueue';
import type { CadDrawingDocument } from '../src/engine/cad/cadTypes';
import ProjectFilesProjectOptionsTab from '../src/components/projectOptions/tabs/ProjectFilesProjectOptionsTab';
import AppInputSidebar from '../src/components/app/AppInputSidebar';
import {
  React,
  act,
  useRef,
  useState,
  createRoot,
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  useProjectFileWorkflow,
  baseSettings,
  baseParseSettings,
  cloneInstrumentLibrary,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
  installProjectWorkflowFakeIndexedDb,
} from './projectFileWorkflowState/projectFileWorkflowStateTestSupport';
import type {
  Root,
  ParseSettings,
  PersistedSavedRunSnapshot,
  SettingsState,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from './projectFileWorkflowState/projectFileWorkflowStateTestSupport';

describe('buildBlankProjectWorkspace', () => {
  it('has no module-graph path to startup/example defaults', async () => {
    const { readFileSync } = await import('node:fs');
    const blank = readFileSync('src/app/blankProjectDefaults.ts', 'utf8');
    expect(blank).not.toMatch(/AppInitialState/);
    expect(blank).not.toMatch(/appConfig|APP_STARTUP_DEFAULTS/);
    const base = readFileSync('src/app/baseProjectDefaults.ts', 'utf8');
    expect(base).not.toMatch(/appConfig|APP_STARTUP_DEFAULTS/);
  });
  it('returns explicit blank defaults, not camp values', () => {
    const blank = buildBlankProjectWorkspace();
    expect(blank.input).toBe('');
    expect(blank.includeFiles).toEqual({});
    expect(blank.parseSettings.runMode).toBe('adjustment');
    expect(blank.parseSettings.preanalysisMode).toBe(false);
    expect(blank.parseSettings.coordSystemMode).toBe('local');
    expect(blank.parseSettings.crsId).toBe('');
    expect(blank.projectInstruments).toEqual({});
    expect(blank.selectedInstrument).toBe('');
    expect(blank.levelLoopCustomPresets).toEqual([]);
    expect(blank.geoidSourceData).toBeNull();
    expect(blank.geoidSourceDataLabel).toBe('');
    expect(blank.exportFormat).toBe('points');
    expect(blank.surveyCadState).toBeNull();
    expect(blank.planningMap).toEqual(DEFAULT_PLANNING_MAP_STATE);
    expect(blank.adjustedPointsExportSettings).toEqual(
      cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
    );
    const gps = blank.parseSettings;
    expect(gps.crsTransformEnabled).toBe(false);
    expect(gps.crsLabel).toBe('');
    expect(gps.crsGridScaleEnabled).toBe(false);
    expect(gps.crsConvergenceEnabled).toBe(false);
    expect(gps.crsConvergenceAngleRad).toBe(0);
    expect(gps.geoidModelEnabled).toBe(false);
    expect(gps.geoidModelId).toBe('');
    expect(gps.geoidSourcePath).toBe('');
    expect(gps.geoidHeightConversionEnabled).toBe(false);
    expect(gps.gpsLoopCheckEnabled).toBe(false);
    expect(gps.gpsAddHiHtEnabled).toBe(false);
    expect(gps.gpsAddHiHtHiM).toBe(0);
    expect(gps.gpsAddHiHtHtM).toBe(0);
    expect(gps.verticalDeflectionNorthSec).toBe(0);
    expect(gps.verticalDeflectionEastSec).toBe(0);
    expect(gps.averageGeoidHeight).toBe(0);
    expect(gps.gnssVectorFrameDefault).toBe('gridNEU');
    expect(gps.gnssFrameConfirmed).toBe(false);
    expect(gps.geoidSourceFormat).toBe('builtin');
    expect(gps.geoidInterpolation).toBe('bilinear');
    expect(gps.geoidOutputHeightDatum).toBe('orthometric');
  });

  it('pins the full blank matrix: old-Pre-analysis baseline, not Combined/Pre-analysis data', () => {
    const blank = buildBlankProjectWorkspace();
    // Old Pre-analysis startup benign defaults (baseline main 0b08ccda patch
    // values; base seeds are convergenceLimit 0.001 / lonSign west-negative).
    expect(blank.settings.convergenceLimit).toBe(0.01);
    expect(blank.settings.maxIterations).toBe(10);
    const p = blank.parseSettings;
    expect(p.coordMode).toBe('3D');
    expect(p.order).toBe('EN');
    expect(p.deltaMode).toBe('slope');
    expect(p.angleStationOrder).toBe('atfromto');
    expect(p.lonSign).toBe('west-positive');
    expect(p.applyCurvatureRefraction).toBe(true);
    expect(p.verticalReduction).toBe('curvref');
    expect(p.refractionCoefficient).toBe(0.07);
    expect(p.qFixLinearSigmaM).toBe(1e-7);
    expect(p.qFixAngularSigmaSec).toBe(0.0010001);
    // NOT Combined: no grid CRS, no NE order, no deflection/levelWeight/overlay.
    expect(p.coordSystemMode).toBe('local');
    expect(p.crsId).toBe('');
    expect(p.verticalDeflectionNorthSec).toBe(0);
    expect(p.verticalDeflectionEastSec).toBe(0);
    expect(p.levelWeight).toBeUndefined();
    expect(p.suspectImpactMode).toBe('auto');
    expect(p.positionalToleranceEnabled).toBe(false);
    // NOT Pre-analysis data: empty input, Adjustment mode.
    expect(blank.input).toBe('');
    expect(p.runMode).toBe('adjustment');
    expect(p.preanalysisMode).toBe(false);
    expect(p.crsId).not.toContain('UTM');
  });

  it('seeds a minimal valid manifest from empty input', () => {
    const blank = buildBlankProjectWorkspace();
    const { manifest, sourceTexts } = createManifestFromFlatProject({
      name: 'Blank',
      input: blank.input,
      includeFiles: blank.includeFiles,
      ui: {
        settings: blank.settings as unknown as Record<string, unknown>,
        parseSettings: blank.parseSettings as unknown as Record<string, unknown>,
        exportFormat: blank.exportFormat,
        adjustedPointsExport: blank.adjustedPointsExportSettings,
        planningMap: blank.planningMap,
      },
      project: {
        projectInstruments: blank.projectInstruments,
        selectedInstrument: blank.selectedInstrument,
        levelLoopCustomPresets: blank.levelLoopCustomPresets,
      },
    });
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.name).toBe('main.dat');
    expect(sourceTexts[manifest.files[0]?.id ?? '']).toBe('');
  });
});

describe('create new blank project', () => {
  // Single shared wording owned by createLocalProjectFromCurrentWorkspace;
  // the sidebar and Project Files tab both route through it.
  const sharedConfirmWording =
    'Create a new blank project? Unsaved untitled input will be discarded.';
  const Harness = ({
    onReset,
    initialInput = 'STN A 100 200',
  }: {
    onReset: () => void;
    initialInput?: string;
  }) => {
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState(initialInput);
  const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({
    'extra.dat': 'STN B 300 400',
  });
  const [settings, setSettings] = useState<SettingsState>({ ...baseSettings, uiTheme: 'catppuccin-mocha' });
  const [parseSettings, setParseSettings] = useState<ParseSettings>({
    ...baseParseSettings,
    crsId: 'CA_NAD83_CSRS_UTM_20N',
    crsTransformEnabled: true,
    gpsLoopCheckEnabled: true,
    geoidModelEnabled: true,
  });
  const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(new Uint8Array([1, 2]));
  const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('prior.bin');
  const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
  const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
    useState<AdjustedPointsExportSettings>(() =>
      cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
    );
  const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([
    { id: 'run-1' } as unknown as PersistedSavedRunSnapshot,
  ]);
  const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
    S9: { code: 'S9' } as InstrumentLibrary['S9'],
  });
  const [selectedInstrument, setSelectedInstrument] = useState('S9');
  const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
    CustomLevelLoopTolerancePreset[]
  >([{ id: 'p1' } as unknown as CustomLevelLoopTolerancePreset]);
  const [_settingsDraft, setSettingsDraft] = useState(settings);
  const [_parseSettingsDraft, setParseSettingsDraft] = useState<ParseSettings>(parseSettings);
  const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
  const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
  const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
  const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
  const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
    CustomLevelLoopTolerancePreset[]
  >([]);
  const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
    useState<AdjustedPointsExportSettings>(() =>
      cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
    );
  const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
    useState(false);
  const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
    useState<string[]>([]);
  const [_importNotice, setImportNotice] = useState<{
    title: string;
    detailLines: string[];
  } | null>(null);

  const { createLocalProjectFromCurrentWorkspace, handleSaveProject, projectSession } = useProjectFileWorkflow({
    projectFileInputRef,
    projectSourceFileInputRef,
    input,
    projectIncludeFiles,
    settings,
    parseSettings,
    exportFormat,
    adjustedPointsExportSettings,
    savedRunSnapshots,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setParseSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setProjectInstruments,
    setSelectedInstrument,
    setLevelLoopCustomPresets,
    setSettingsDraft,
    setParseSettingsDraft,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabelDraft,
    setProjectInstrumentsDraft,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresetsDraft,
    setAdjustedPointsExportSettingsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
    setImportNotice,
    resetWorkspaceAfterProjectLoad: onReset,
    restoreSavedRunSnapshots: setSavedRunSnapshots,
    normalizeUiTheme,
    normalizeSolveProfile,
    buildObservationModeFromGridFields,
    cloneInstrumentLibrary,
  });

  return (
    <div>
      <button type="button" id="create-project" onClick={() => void createLocalProjectFromCurrentWorkspace()}>
        create
      </button>
      <button type="button" id="save-project" onClick={() => void handleSaveProject()}>
        save
      </button>
      <div id="project-id">{projectSession?.manifest.projectId ?? '-'}</div>
      <div id="live-input">{input === '' ? 'empty' : input}</div>
      <div id="live-crs">{parseSettings.crsId === '' ? 'blank' : parseSettings.crsId}</div>
      <div id="live-runmode">{parseSettings.runMode}</div>
      <div id="live-inst-count">{String(Object.keys(projectInstruments).length)}</div>
      <div id="live-sel-inst">{selectedInstrument === '' ? 'blank' : selectedInstrument}</div>
      <div id="live-presets">{String(levelLoopCustomPresets.length)}</div>
      <div id="live-geoid-label">{geoidSourceDataLabel === '' ? 'blank' : geoidSourceDataLabel}</div>
      <div id="live-snaps">{String(savedRunSnapshots.length)}</div>
      <div id="live-theme">{settings.uiTheme}</div>
    </div>
  );
};

  it('does not clone workspace content, clears runtime state, preserves theme', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    installProjectWorkflowFakeIndexedDb('Blank Project');
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const resetSpy = vi.fn();


    try {
      await act(async () => {
        root.render(<Harness onReset={resetSpy} />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          if (container.querySelector('#project-id')?.textContent !== '-') break;
        }
      });
      expect(container.querySelector('#project-id')?.textContent).not.toBe('-');
      expect(confirmSpy).toHaveBeenCalledWith(sharedConfirmWording);
      expect(container.querySelector('#live-input')?.textContent).toBe('empty');
      expect(container.querySelector('#live-crs')?.textContent).toBe('blank');
      expect(container.querySelector('#live-runmode')?.textContent).toBe('adjustment');
      expect(container.querySelector('#live-inst-count')?.textContent).toBe('0');
      expect(container.querySelector('#live-sel-inst')?.textContent).toBe('blank');
      expect(container.querySelector('#live-presets')?.textContent).toBe('0');
      expect(container.querySelector('#live-geoid-label')?.textContent).toBe('blank');
      expect(container.querySelector('#live-snaps')?.textContent).toBe('0');
      expect(container.querySelector('#live-theme')?.textContent).toBe('catppuccin-mocha');
      expect(resetSpy).toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
      window.prompt = originalPrompt;
      window.confirm = originalConfirm;
    }
  });

  it('save without a session preserves the untitled workspace instead of blanking', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    installProjectWorkflowFakeIndexedDb('Blank Project');
    const resetSpy = vi.fn();
    window.prompt = () => 'Saved Workspace Project';
    try {
      await act(async () => {
        root.render(<Harness onReset={resetSpy} />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      await act(async () => {
        (container.querySelector('#save-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          if (container.querySelector('#project-id')?.textContent !== '-') break;
        }
      });
      expect(container.querySelector('#project-id')?.textContent).not.toBe('-');
      // Save attaches a named session (id assigned) while every live field is
      // preserved: the clone path bypasses applyLoadedProjectPayload, so the
      // loader's resetWorkspaceAfterProjectLoad callback (which clears
      // result/integrity markers, comparison/review state, and CAD state) is
      // never invoked here — unlike the explicit Create path above.
      expect(container.querySelector('#live-input')?.textContent).toBe('STN A 100 200');
      expect(container.querySelector('#live-crs')?.textContent).toBe('CA_NAD83_CSRS_UTM_20N');
      expect(container.querySelector('#live-runmode')?.textContent).toBe('adjustment');
      expect(container.querySelector('#live-inst-count')?.textContent).toBe('1');
      expect(container.querySelector('#live-sel-inst')?.textContent).toBe('S9');
      expect(container.querySelector('#live-presets')?.textContent).toBe('1');
      expect(container.querySelector('#live-geoid-label')?.textContent).toBe('prior.bin');
      expect(container.querySelector('#live-snaps')?.textContent).toBe('1');
      expect(container.querySelector('#live-theme')?.textContent).toBe('catppuccin-mocha');
      expect(resetSpy).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
      window.prompt = originalPrompt;
    }
  });

  it('shared guard: declining the confirm aborts before prompting or storing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    installProjectWorkflowFakeIndexedDb('Blank Project');
    const promptSpy = window.prompt as unknown as ReturnType<typeof vi.fn>;
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy as unknown as typeof window.confirm;
    try {
      await act(async () => {
        root.render(<Harness onReset={vi.fn()} />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
        }
      });
      expect(confirmSpy).toHaveBeenCalledWith(sharedConfirmWording);
      expect(promptSpy).not.toHaveBeenCalled();
      expect(container.querySelector('#project-id')?.textContent).toBe('-');
      expect(container.querySelector('#live-input')?.textContent).toBe('STN A 100 200');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
      window.prompt = originalPrompt;
      window.confirm = originalConfirm;
    }
  });

  it('shared guard: whitespace-only untitled input skips the confirm', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    installProjectWorkflowFakeIndexedDb('Blank Project');
    // Declining would abort if the guard ran, so false proves it is skipped.
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy as unknown as typeof window.confirm;
    try {
      await act(async () => {
        root.render(<Harness onReset={vi.fn()} initialInput="   " />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          if (container.querySelector('#project-id')?.textContent !== '-') break;
        }
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(container.querySelector('#project-id')?.textContent).not.toBe('-');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
      window.prompt = originalPrompt;
      window.confirm = originalConfirm;
    }
  });

  it('shared guard: an attached session skips the confirm even with live input', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalConfirm = window.confirm;
    installProjectWorkflowFakeIndexedDb('Saved Workspace Project');
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy as unknown as typeof window.confirm;
    try {
      await act(async () => {
        root.render(<Harness onReset={vi.fn()} />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      // Save attaches a session while preserving the non-empty live input.
      await act(async () => {
        (container.querySelector('#save-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          if (container.querySelector('#project-id')?.textContent !== '-') break;
        }
      });
      const firstId = container.querySelector('#project-id')?.textContent;
      expect(firstId).not.toBe('-');
      expect(container.querySelector('#live-input')?.textContent).toBe('STN A 100 200');
      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
          const currentId = container.querySelector('#project-id')?.textContent;
          if (currentId !== '-' && currentId !== firstId) break;
        }
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(container.querySelector('#project-id')?.textContent).not.toBe(firstId);
      expect(container.querySelector('#live-input')?.textContent).toBe('empty');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDb });
      window.prompt = originalPrompt;
      window.confirm = originalConfirm;
    }
  });
});

describe('review queue workspace revision reset', () => {
  const fakeQueueItem: ReviewQueueItem = {
    id: 'queue-1',
    title: 'Suspect observation',
    subtitle: 'obs 7',
    severity: 'high',
    sourceType: 'suspect-observation',
    resolved: false,
    target: { kind: 'station', stationId: 'A' },
    preferredTab: 'report',
    sourceGroup: 'workspace',
  };

  const QueueHarness = ({
    projectId,
    workspaceRevision,
  }: {
    projectId: string | null;
    workspaceRevision: number;
  }) => {
    const {
      reviewQueueSeverityFilter,
      setReviewQueueSeverityFilter,
      reviewQueueSourceFilter,
      setReviewQueueSourceFilter,
      reviewQueueUnresolvedOnly,
      setReviewQueueUnresolvedOnly,
      reviewQueueImportedGroupFilter,
      setReviewQueueImportedGroupFilter,
      selectedReviewQueueItemId,
      handleSelectReviewQueueItem,
    } = useAppReviewQueue({
      result: null,
      excludedIds: new Set<number>(),
      clusterReviewDecisions: {},
      runComparisonSummary: null,
      importReviewState: null,
      selectObservation: () => undefined,
      selectStation: () => undefined,
      setActiveTab: () => undefined,
      setIsSidebarOpen: () => undefined,
      setPendingEditorJumpLine: () => undefined,
      projectId,
      workspaceRevision,
    });
    return (
      <div>
        <button type="button" id="rq-dirty-severity" onClick={() => setReviewQueueSeverityFilter('high')}>
          sev
        </button>
        <button type="button" id="rq-dirty-source" onClick={() => setReviewQueueSourceFilter('cluster-candidate')}>
          src
        </button>
        <button type="button" id="rq-dirty-unresolved" onClick={() => setReviewQueueUnresolvedOnly(true)}>
          unresolved
        </button>
        <button type="button" id="rq-dirty-group" onClick={() => setReviewQueueImportedGroupFilter('import-a')}>
          group
        </button>
        <button type="button" id="rq-select" onClick={() => handleSelectReviewQueueItem(fakeQueueItem)}>
          select
        </button>
        <div id="rq-severity">{reviewQueueSeverityFilter}</div>
        <div id="rq-source">{reviewQueueSourceFilter}</div>
        <div id="rq-unresolved">{String(reviewQueueUnresolvedOnly)}</div>
        <div id="rq-group">{reviewQueueImportedGroupFilter}</div>
        <div id="rq-selected">{selectedReviewQueueItemId ?? 'none'}</div>
      </div>
    );
  };

  const dirtyQueue = async (container: HTMLElement) => {
    await act(async () => {
      const buttonIds = ['#rq-dirty-severity', '#rq-dirty-source', '#rq-dirty-unresolved', '#rq-dirty-group', '#rq-select'];
      for (const id of buttonIds) {
        (container.querySelector(id) as HTMLButtonElement).click();
      }
    });
  };

  const readQueue = (container: HTMLElement) => ({
    severity: container.querySelector('#rq-severity')?.textContent,
    source: container.querySelector('#rq-source')?.textContent,
    unresolved: container.querySelector('#rq-unresolved')?.textContent,
    group: container.querySelector('#rq-group')?.textContent,
    selected: container.querySelector('#rq-selected')?.textContent,
  });

  const dirtiedQueue = {
    severity: 'high',
    source: 'cluster-candidate',
    unresolved: 'true',
    group: 'import-a',
    selected: 'queue-1',
  };

  const resetQueue = {
    severity: 'all',
    source: 'all',
    unresolved: 'false',
    group: 'all',
    selected: 'none',
  };

  it('resets filters and selection on a revision bump with projectId null on both sides', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => {
        root.render(<QueueHarness projectId={null} workspaceRevision={0} />);
      });
      await dirtyQueue(container);
      expect(readQueue(container)).toEqual(dirtiedQueue);
      await act(async () => {
        root.render(<QueueHarness projectId={null} workspaceRevision={1} />);
      });
      expect(readQueue(container)).toEqual(resetQueue);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('keeps filters and selection on re-render with the same revision', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => {
        root.render(<QueueHarness projectId={null} workspaceRevision={5} />);
      });
      await dirtyQueue(container);
      expect(readQueue(container)).toEqual(dirtiedQueue);
      // Ordinary edits re-render with fresh object identities but the same
      // revision token, so the queue state must survive.
      await act(async () => {
        root.render(<QueueHarness projectId={null} workspaceRevision={5} />);
      });
      expect(readQueue(container)).toEqual(dirtiedQueue);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe('project payload loader clears prior CAD state', () => {
  it('applies null survey CAD state for blank projects instead of keeping the old drawing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const resetSpy = vi.fn();
    const restoreSpy = vi.fn();
    const createdAt = '2026-06-01T10:00:00.000Z';
    const seed = createFlatProjectManifestSeed({
      projectId: createProjectId(),
      name: 'Blank',
      createdAt,
      updatedAt: createdAt,
      workspace: buildBlankProjectWorkspace(),
      cloneInstrumentLibrary,
    });
    const blankSession: ProjectSessionState = {
      indexRow: buildProjectIndexRow({
        id: seed.manifest.projectId,
        name: 'Blank',
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
    const parsed = buildParsedPayloadFromSession(blankSession);
    const LoaderHarness = () => {
      const [input, setInput] = useState('prior input');
      const [_projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [_settings, setSettings] = useState<SettingsState>({ ...baseSettings });
      const [_parseSettings, setParseSettings] = useState<ParseSettings>({ ...baseParseSettings });
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [_exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [_adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_planningMap, setPlanningMap] = useState(() =>
        clonePlanningMapState(DEFAULT_PLANNING_MAP_STATE),
      );
      const [surveyCadState, setSurveyCadState] = useState<CadDrawingDocument | null>(
        {} as unknown as CadDrawingDocument,
      );
      const [_projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({});
      const [_selectedInstrument, setSelectedInstrument] = useState('');
      const [_levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const { applyLoadedProjectPayload } = useProjectPayloadLoader({
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
        currentUiTheme: 'gruvbox-dark',
        normalizeSolveProfile,
        resetWorkspaceAfterProjectLoad: resetSpy,
        restoreSavedRunSnapshots: restoreSpy,
        setAdjustedPointsExportSettings,
        setAdjustedPointsExportSettingsDraft: () => undefined,
        setAdjustedPointsTransformSelectedDraft: () => undefined,
        setExportFormat,
        setGeoidSourceData,
        setGeoidSourceDataDraft: () => undefined,
        setGeoidSourceDataLabel,
        setGeoidSourceDataLabelDraft: () => undefined,
        setInput,
        setIsAdjustedPointsTransformSelectOpen: () => undefined,
        setLevelLoopCustomPresets,
        setLevelLoopCustomPresetsDraft: () => undefined,
        setParseSettings,
        setParseSettingsDraft: () => undefined,
        setPlanningMap,
        setProjectIncludeFiles,
        setProjectInstruments,
        setProjectInstrumentsDraft: () => undefined,
        setSelectedInstrument,
        setSelectedInstrumentDraft: () => undefined,
        setSettings,
        setSettingsDraft: () => undefined,
        setSurveyCadState,
      });
      return (
        <div>
          <button
            type="button"
            id="loader-apply"
            onClick={() => applyLoadedProjectPayload(parsed, blankSession, [])}
          >
            apply
          </button>
          <div id="loader-cad">{surveyCadState ? 'present' : 'cleared'}</div>
          <div id="loader-input">{input === '' ? 'empty' : input}</div>
        </div>
      );
    };
    try {
      await act(async () => {
        root.render(<LoaderHarness />);
      });
      expect(container.querySelector('#loader-cad')?.textContent).toBe('present');
      await act(async () => {
        (container.querySelector('#loader-apply') as HTMLButtonElement).click();
      });
      expect(container.querySelector('#loader-cad')?.textContent).toBe('cleared');
      expect(container.querySelector('#loader-input')?.textContent).toBe('empty');
      expect(resetSpy).toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe('create new project action wording', () => {
  it('labels the button action, not the storage noun', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const SettingsCard: React.FC<{ title: string; children: React.ReactNode }> = ({ children }) => (
      <div>{children}</div>
    );
    try {
      await act(async () => {
        root.render(
          <ProjectFilesProjectOptionsTab
            context={
              {
                PROJECT_OPTION_SECTION_TOOLTIPS: {},
                SettingsCard,
                activeProjectFileViews: [],
                createBlankProjectFile: () => undefined,
                createLocalProjectFromCurrentWorkspace: () => undefined,
                currentProjectFile: null,
                deleteLocalProject: () => undefined,
                exportPortableProject: () => undefined,
                exportProjectBundle: () => undefined,
                handleSaveProject: () => undefined,
                moveProjectFile: () => undefined,
                openPermanentExampleProject: () => undefined,
                openProjectById: () => undefined,
                projectSession: null,
                recentProjects: [],
                removeProjectFile: () => undefined,
                renameProjectFile: () => undefined,
                storageStatus: null,
                switchActiveProjectFile: () => undefined,
                toggleProjectFileEnabled: () => undefined,
                triggerProjectFileSelect: () => undefined,
                triggerProjectSourceFileSelect: () => undefined,
              } as unknown as React.ComponentProps<typeof ProjectFilesProjectOptionsTab>['context']
            }
          />,
        );
      });
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === 'Create New Project',
      );
      expect(button).toBeDefined();
      expect(button?.getAttribute('aria-label')).toBe('Create new project');
      expect(button?.getAttribute('title')).toBeTruthy();
      expect(container.textContent).not.toContain('Create Local Project');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe('untitled input safety', () => {
  const renderSidebar = async ({
    input,
    confirmResult,
    onCreate,
    confirmSpy,
  }: {
    input: string;
    confirmResult: boolean;
    onCreate: () => void;
    confirmSpy: ReturnType<typeof vi.fn>;
  }) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const Harness = () => {
      const inputPaneRef = useRef(null);
      return (
        <AppInputSidebar
          splitPercent={50}
          inputPaneRef={inputPaneRef}
          input={input}
          handleInputChange={() => undefined}
          projectSession={null}
          currentProjectFile={null}
          activeProjectFileViews={[]}
          projectRunValidation={{ ok: true, errors: [], warnings: [] }}
          handleOpenProjectWorkspacePanel={() => undefined}
          createLocalProjectFromCurrentWorkspace={onCreate}
          triggerProjectSourceFileSelect={() => undefined}
          openFileTab={() => undefined}
          closeFileTab={() => undefined}
          switchActiveProjectFile={() => undefined}
          createBlankProjectFile={() => ''}
          duplicateProjectFile={() => ''}
          renameProjectFile={() => undefined}
          deleteProjectFile={() => undefined}
          setProjectFileEnabled={() => undefined}
          reorderProjectFiles={() => undefined}
          importNotice={null}
          setImportNotice={() => undefined}
          handleDividerMouseDown={() => undefined}
        />
      );
    };
    await act(async () => {
      confirmSpy.mockReturnValue(confirmResult);
      window.confirm = confirmSpy as unknown as typeof window.confirm;
      root.render(<Harness />);
    });
    return { container, root };
  };

  it('delegates untitled-input confirmation to the create action instead of confirming locally', async () => {
    const onCreate = vi.fn();
    const confirmSpy = vi.fn();
    const originalConfirm = window.confirm;
    const { container, root } = await renderSidebar({
      input: 'STN A 100 200',
      confirmResult: false,
      onCreate,
      confirmSpy,
    });
    try {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.includes('Project Files'),
      );
      expect(button).toBeDefined();
      await act(async () => {
        button?.click();
      });
      // The guard moved into createLocalProjectFromCurrentWorkspace so the
      // sidebar and Project Files tab share one wording: the sidebar passes
      // through without confirming locally.
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onCreate).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      window.confirm = originalConfirm;
    }
  });

  it('creates without confirming when untitled input is empty', async () => {
    const onCreate = vi.fn();
    const confirmSpy = vi.fn();
    const originalConfirm = window.confirm;
    const { container, root } = await renderSidebar({
      input: '   ',
      confirmResult: true,
      onCreate,
      confirmSpy,
    });
    try {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.includes('Project Files'),
      );
      await act(async () => {
        button?.click();
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onCreate).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      window.confirm = originalConfirm;
    }
  });
});
