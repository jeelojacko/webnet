/** @vitest-environment jsdom */
/**
 * STRUCT-194.2 — regression coverage for the extracted CAD shell-action
 * control plane.
 *
 * The action literal that used to live in SurveyCadWorkspace is now composed
 * from four cohesive factories. This suite pins the extraction contract:
 *   1. the full CadShellActions keyset is present with unchanged signatures;
 *   2. the actions channel keeps its mount/unmount-only notify cadence while
 *      re-registering fresh closures on every render;
 *   3. representative real dispatches still work end-to-end;
 *   4. the grading current/stale + group-vs-single safety matrix, compose
 *      safety, and the deterministic section-view layout are preserved.
 */
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import type { ActiveCommandKey, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { buildCadWorkspaceShellGradingActions } from '../src/components/surveyCad/cadWorkspaceShellActionsGrading';
import type { CadWorkspaceShellGradingContext } from '../src/components/surveyCad/cadWorkspaceShellActionsGrading';
import { buildCadWorkspaceShellCoreActions } from '../src/components/surveyCad/cadWorkspaceShellActionsCore';
import type { CadWorkspaceShellCoreContext } from '../src/components/surveyCad/cadWorkspaceShellActionsCore';
import { planSectionViewLayout } from '../src/components/surveyCad/cadWorkspaceSectionViewLayout';
import type { SurfaceGradingService } from '../src/workers/surfaceGradingService';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import {
  appendCadProjectEntities,
  buildCadProjectSignature,
} from '../src/engine/cad/cadProjectState';
import type {
  CadProject,
  CadSampleLineGroup,
  CadSectionView,
  CadSurveyPointEntity,
  SurveyCadPersistedState,
} from '../src/engine/cad/cadTypes';
import type { ParseOptions } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

const PARSE_OPTIONS: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
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
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const NOOP_PERSIST: React.Dispatch<React.SetStateAction<SurveyCadPersistedState | null>> = () => {};

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const buildPersisted = (withBlockRef = false): SurveyCadPersistedState => {
  const drawing = createBlankCadDrawingDocument({ name: 'Actions 1942', units: 'm' });
  const base = buildSurveyCadSpikeProject({
    input: INPUT,
    instrumentLibrary: {},
    parseOptions: PARSE_OPTIONS,
    units: 'm',
    result: null,
  });
  const points = [
    point('sp:1', 'P1', 0, 0, 0),
    point('sp:2', 'P2', 50, 0, 0),
    point('sp:3', 'P3', 50, 50, 0),
    point('sp:4', 'P4', 0, 50, 0),
  ];
  const blockRef = {
    id: 'br:1',
    type: 'block-reference' as const,
    layerId: 'points',
    visible: true,
    locked: false,
    blockDefinitionId: 'blk:1',
    x: 1,
    y: 2,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
  };
  const project: CadProject = {
    ...appendCadProjectEntities(
      { ...base, id: drawing.project.id, name: 'Actions 1942' },
      withBlockRef ? [...points, blockRef] : points,
    ),
    ...(withBlockRef
      ? { blockDefinitions: [{ id: 'blk:1', name: 'Marker', basePoint: { x: 0, y: 0 }, entities: [] }] }
      : {}),
    surfaces: [
      {
        id: 'surf:1',
        name: 'Existing',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['sp:1', 'sp:2', 'sp:3', 'sp:4'] } },
        cachedRevision: null,
      },
    ],
  };
  return { version: 1, sourceSignature: buildCadProjectSignature(project), project };
};

interface HarnessApi {
  bump: () => void;
  setPersisted: (_next: SurveyCadPersistedState) => void;
  tick: () => number;
}

const Harness: React.FC<{
  link: CadShellLink;
  initial: SurveyCadPersistedState;
  apiRef: { current: HarnessApi | null };
  strict?: boolean;
}> = ({ link, initial, apiRef, strict }) => {
  const [persisted, setPersisted] = useState(initial);
  const [tick, setTick] = useState(0);
  const api: HarnessApi = {
    bump: () => setTick((value) => value + 1),
    setPersisted: (next) => setPersisted(next),
    tick: () => tick,
  };
  React.useImperativeHandle(apiRef, () => api);
  const tree = (
    <div>
      <span data-tick>{tick}</span>
      <SurveyCadWorkspace
        input={INPUT}
        instrumentLibrary={{}}
        parseOptions={PARSE_OPTIONS}
        units="m"
        result={null}
        persistedState={persisted}
        onPersistedStateChange={NOOP_PERSIST}
        shellLink={link}
        shellChrome
      />
    </div>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

interface Mounted {
  container: HTMLElement;
  root: Root;
  link: CadShellLink;
  api: HarnessApi;
  snapshot: () => ReturnType<CadShellLink['getSnapshot']>;
  actions: () => NonNullable<CadShellLink['actions']>;
}

const mount = async (
  initial: SurveyCadPersistedState = buildPersisted(),
  options: { strict?: boolean } = {},
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  const apiRef: { current: HarnessApi | null } = { current: null };
  await act(async () => {
    root.render(<Harness link={link} initial={initial} apiRef={apiRef} strict={options.strict} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    root,
    link,
    api: {
      bump: () => apiRef.current!.bump(),
      setPersisted: (next) => apiRef.current!.setPersisted(next),
      tick: () => apiRef.current!.tick(),
    },
    snapshot: () => link.getSnapshot(),
    actions: () => link.actions!,
  };
};

const BASELINE_KEYS = [
  'startCommand', 'undo', 'redo', 'selectAll', 'clearSelection', 'eraseSelection', 'selectEntities',
  'editField', 'runParcelLinkAction', 'runLayerCommand', 'runSurveyCommand', 'runFeatureLineCommand',
  'runGradingCommand', 'selectGrading', 'selectGradingGroup', 'openGradingManager',
  'requestGradingCalculate', 'extractGradingDaylight', 'bakeGradingSurface', 'runGradingGroupCommand',
  'requestGroupGradingCalculate', 'extractGroupDaylight', 'bakeGroupSurface', 'openGradingGroupManager',
  'selectSurface', 'selectVolume', 'selectProfile', 'rebuildProfile', 'createProfileView',
  'selectProfileView', 'queryProfileElevation', 'selectSampleLineGroup', 'selectSampleLine',
  'rebuildSections', 'rebuildSectionLine', 'createSectionViews', 'selectSectionView',
  'querySectionElevation', 'requestVolume', 'startVolumePick', 'queryVolumeDifference',
  'calculateSelectedVolume', 'selectAnalysis', 'selectAnalysisLegend', 'createAnalysis',
  'requestAnalysis', 'calculateSelectedAnalysis', 'startAnalysisPick', 'queryAnalysis',
  'startSurfacePick', 'querySurfaceElevation', 'querySurfaceSlope', 'rebuildSurface',
  'rebuildAllSurfaces', 'describeBreaklineSource', 'describeBoundarySource', 'describeBreaklineChain',
  'describeSurveyPointCoords', 'describeBoundarySourceDetail', 'preflightBoundaryVertexEdit',
  'preflightBoundaryCandidate', 'preflightDesignApply', 'openSurveyManager', 'openBlockManager',
  'runBlockOp', 'ensureBlockSymbols', 'armInsertPick', 'cancelInsertPick', 'explodeSelectedBlocks',
  'openAnnotationManager', 'openSurveyTableManager', 'runAnnotationOp', 'zoomToParcel',
  'startParcelSharedEdit', 'selectAllSurveyPoints', 'selectSurveyGroupPoints', 'setCurrentLayer',
  'openLayerManager', 'setSnapPreference', 'newDrawing', 'openDrawingFile', 'saveDrawing',
  'requestLandXmlImport', 'submitSessionText', 'setSessionInputValue', 'startSurfaceEditSession',
  'cancelSurfaceEditSession', 'selectSurfacePoints', 'setSurfacePointSelectionFilter',
  'clearSurfacePointSelection', 'startSurfaceBulkEditSession', 'previewSurfaceCompose',
  'requestSurfaceCompose', 'toggleDraftingPanel', 'toggleExportCenter', 'cancelCommand',
  'confirmCommandInput',
].sort();

let mounted: Mounted[] = [];

const track = async (view: Mounted): Promise<Mounted> => {
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
  mounted = [];
  vi.restoreAllMocks();
});

describe('STRUCT-194.2 shell-action extraction — keyset and dispatch', () => {
  it('exposes every CadShellActions key after mount', async () => {
    const view = await track(await mount());
    expect(view.link.actions).not.toBeNull();
    expect(Object.keys(view.actions()).sort()).toEqual(BASELINE_KEYS);
    expect(Object.keys(view.actions()).length).toBe(97);
  });

  it('pins the actions channel to mount/unmount transitions only', async () => {
    const view = await track(await mount());
    const versionAtMount = view.link.getActionsVersion();
    expect(versionAtMount).toBe(1);
    expect(view.link.actions).not.toBeNull();

    // A same-link parent rerender must NOT notify subscribers, but must
    // re-register a fresh actions object.
    const before = view.link.actions;
    await act(async () => {
      view.api.bump();
    });
    expect(view.api.tick()).toBe(1);
    expect(view.link.getActionsVersion()).toBe(versionAtMount);
    expect(view.link.actions).not.toBe(before);

    // Unmount nulls actions and notifies exactly once more.
    await act(async () => {
      view.root.unmount();
    });
    expect(view.link.actions).toBeNull();
    expect(view.link.getActionsVersion()).toBe(versionAtMount + 1);
    mounted = mounted.filter((entry) => entry !== view);
    view.container.remove();
  });

  it('reads the current selection through re-registered closures', async () => {
    const view = await track(await mount(buildPersisted(true)));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const stale = view.link.actions;
    await act(async () => {
      view.actions().selectEntities(['br:1']);
    });
    expect(view.link.actions).not.toBe(stale);
    expect(view.snapshot()?.selectedEntityIds).toEqual(['br:1']);

    // The fresh closure sees the new selection (no "select ... first" alert);
    // the stale pre-selection closure would have alerted.
    await act(async () => {
      view.actions().explodeSelectedBlocks!();
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps true/false typed commands and undo/redo working', async () => {
    const view = await track(await mount());
    expect(view.actions().startCommand('LINE')).toBe(true);
    expect(view.actions().startCommand('NOT_A_COMMAND' as ActiveCommandKey)).toBe(false);

    const layerId = view.snapshot()?.layers[0]?.id;
    expect(layerId).toBeTruthy();
    await act(async () => {
      expect(view.actions().runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId: layerId! })).toBe(true);
    });
    expect(view.snapshot()?.canUndo).toBe(true);
    await act(async () => {
      view.actions().undo();
    });
    expect(view.snapshot()?.canUndo).toBe(false);
    await act(async () => {
      view.actions().redo();
    });
    expect(view.snapshot()?.canUndo).toBe(true);
  });

  it('opens a survey manager overlay through the extracted action', async () => {
    const view = await track(await mount());
    expect(view.container.querySelector('[aria-label="Point group manager"]')).toBeNull();
    await act(async () => {
      view.actions().openSurveyManager('point-groups');
    });
    expect(view.container.querySelector('[aria-label="Point group manager"]')).not.toBeNull();
    await act(async () => {
      view.actions().cancelCommand();
    });
  });

  it('cancels and confirms without throwing when no session is staged', async () => {
    const view = await track(await mount());
    expect(() => view.actions().cancelCommand()).not.toThrow();
    await act(async () => {
      view.actions().startCommand('LINE');
    });
    expect(() => view.actions().confirmCommandInput()).not.toThrow();
    await act(async () => {
      view.actions().setSessionInputValue?.('@10,20');
    });
    expect(view.snapshot()?.commandInputValue).toBe('@10,20');
  });

  it('stays mounted and notified under StrictMode double-effects', async () => {
    const view = await track(await mount(buildPersisted(), { strict: true }));
    expect(view.link.actions).not.toBeNull();
    expect(Object.keys(view.actions()).length).toBe(97);
    expect(view.link.getActionsVersion()).toBeGreaterThanOrEqual(1);
    await act(async () => {
      view.actions().toggleDraftingPanel();
    });
    expect(view.container.querySelector('[aria-label="Sheets and layers"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dock Enter/text precedence (the extracted core dispatch closure, not just
// a no-throw smoke test). Point session first, then bulk edit, then bulk
// selection, then the regular command/dock text.
// ---------------------------------------------------------------------------

type DockSessions = CadWorkspaceShellCoreContext['editSessions'];

const dockSession = <T,>(over: Record<string, unknown>): T => over as unknown as T;

const makeDockContext = (
  editSessions: DockSessions,
): {
  actions: ReturnType<typeof buildCadWorkspaceShellCoreActions>;
  handleEnterKey: ReturnType<typeof vi.fn>;
  setCommandInputValue: ReturnType<typeof vi.fn>;
} => {
  const handleEnterKey = vi.fn();
  const setCommandInputValue = vi.fn();
  const context = {
    link: null,
    starters: {} as Record<ActiveCommandKey, (() => void) | undefined>,
    workspace: { setCommandInputValue },
    project: { entities: [], layers: [], pointGroups: [] },
    selectedEntityIds: [],
    undo: vi.fn(),
    redo: vi.fn(),
    clearSelection: vi.fn(),
    eraseSelection: vi.fn(),
    handleNewDrawing: vi.fn(),
    handleSaveDrawing: vi.fn(),
    handleEscapeKey: vi.fn(),
    handleEnterKey,
    setViewBounds: vi.fn(),
    applyViewport: vi.fn(),
    fileInputRef: { current: null },
    landXmlImportInputRef: { current: null },
    setDraftingPanelOpen: vi.fn(),
    setExportCenterOpen: vi.fn(),
    setDraftingInitialTab: vi.fn(),
    setF2fSection: vi.fn(),
    setSurveyManager: vi.fn(),
    setBlockInsertPick: vi.fn(),
    editSessions,
  } as unknown as CadWorkspaceShellCoreContext;
  return {
    actions: buildCadWorkspaceShellCoreActions(context),
    handleEnterKey,
    setCommandInputValue,
  };
};

describe('STRUCT-194.2 dock Enter/text precedence', () => {
  it('routes submitted text: live point session, then bulk edit, else the dock command', () => {
    const pointSubmit = vi.fn(() => true);
    const bulkEditSubmit = vi.fn(() => true);
    const pointWins = makeDockContext({
      point: dockSession({ session: {}, submitValueText: pointSubmit }),
      bulkEdit: dockSession({ session: {}, submitValueText: bulkEditSubmit }),
      bulkSelection: dockSession({}),
    });
    pointWins.actions.submitSessionText!('12.5');
    expect(pointSubmit).toHaveBeenCalledWith('12.5');
    expect(bulkEditSubmit).not.toHaveBeenCalled();
    expect(pointWins.setCommandInputValue).not.toHaveBeenCalled();
    expect(pointWins.handleEnterKey).not.toHaveBeenCalled();

    const bulkEditSubmitWins = vi.fn(() => true);
    const bulkEditWins = makeDockContext({
      point: dockSession({ session: null, submitValueText: vi.fn(() => false) }),
      bulkEdit: dockSession({ session: {}, submitValueText: bulkEditSubmitWins }),
      bulkSelection: dockSession({}),
    });
    bulkEditWins.actions.submitSessionText!('-3');
    expect(bulkEditSubmitWins).toHaveBeenCalledWith('-3');
    expect(bulkEditWins.setCommandInputValue).not.toHaveBeenCalled();
    expect(bulkEditWins.handleEnterKey).not.toHaveBeenCalled();

    const regular = makeDockContext({
      point: dockSession({ session: null, submitValueText: vi.fn(() => false) }),
      bulkEdit: dockSession({ session: null, submitValueText: vi.fn(() => false) }),
      bulkSelection: dockSession({}),
    });
    regular.actions.submitSessionText!('LINE');
    expect(regular.setCommandInputValue).toHaveBeenCalledWith('LINE');
    expect(regular.handleEnterKey).toHaveBeenCalledTimes(1);
  });

  it('confirms empty Enter: point, then bulk edit, then bulk selection, then the active command', () => {
    const pointEnter = vi.fn(() => true);
    const pointLoserBulkEdit = vi.fn(() => true);
    const pointLoserBulkSelection = vi.fn(() => true);
    const pointWins = makeDockContext({
      point: dockSession({ session: {}, handleEnter: pointEnter }),
      bulkEdit: dockSession({ handleEnter: pointLoserBulkEdit }),
      bulkSelection: dockSession({ handleEnter: pointLoserBulkSelection }),
    });
    pointWins.actions.confirmCommandInput();
    expect(pointEnter).toHaveBeenCalledTimes(1);
    expect(pointLoserBulkEdit).not.toHaveBeenCalled();
    expect(pointLoserBulkSelection).not.toHaveBeenCalled();
    expect(pointWins.handleEnterKey).not.toHaveBeenCalled();

    const bulkEditEnter = vi.fn(() => true);
    const pointDeclined = vi.fn(() => false);
    const bulkEditLoserBulkSelection = vi.fn(() => true);
    const bulkEditWins = makeDockContext({
      point: dockSession({ handleEnter: pointDeclined }),
      bulkEdit: dockSession({ handleEnter: bulkEditEnter }),
      bulkSelection: dockSession({ handleEnter: bulkEditLoserBulkSelection }),
    });
    bulkEditWins.actions.confirmCommandInput();
    expect(pointDeclined).toHaveBeenCalledTimes(1);
    expect(bulkEditEnter).toHaveBeenCalledTimes(1);
    expect(bulkEditLoserBulkSelection).not.toHaveBeenCalled();
    expect(bulkEditWins.handleEnterKey).not.toHaveBeenCalled();

    const bulkSelectionEnter = vi.fn(() => true);
    const bulkSelectionWins = makeDockContext({
      point: dockSession({ handleEnter: vi.fn(() => false) }),
      bulkEdit: dockSession({ handleEnter: vi.fn(() => false) }),
      bulkSelection: dockSession({ handleEnter: bulkSelectionEnter }),
    });
    bulkSelectionWins.actions.confirmCommandInput();
    expect(bulkSelectionEnter).toHaveBeenCalledTimes(1);
    expect(bulkSelectionWins.handleEnterKey).not.toHaveBeenCalled();

    const commandFallback = makeDockContext({
      point: dockSession({ handleEnter: vi.fn(() => false) }),
      bulkEdit: dockSession({ handleEnter: vi.fn(() => false) }),
      bulkSelection: dockSession({ handleEnter: vi.fn(() => false) }),
    });
    commandFallback.actions.confirmCommandInput();
    expect(commandFallback.handleEnterKey).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Grading current/stale + group-vs-single matrix (factory-level, real
// dispatch payload assertions; worker/service stubbed only where slow).
// ---------------------------------------------------------------------------

const makeGradingContext = (
  rows: Array<Record<string, unknown>>,
): {
  context: CadWorkspaceShellGradingContext;
  runLayerCommand: ReturnType<typeof vi.fn>;
  requestGrading: ReturnType<typeof vi.fn>;
  requestGroupGrading: ReturnType<typeof vi.fn>;
  setGradingVersion: ReturnType<typeof vi.fn>;
} => {
  const runLayerCommand = vi.fn(() => true);
  const requestGrading = vi.fn(() => 'Calculating grading…');
  const requestGroupGrading = vi.fn(() => 'Calculating group…');
  const setGradingVersion = vi.fn();
  const snapshot = { grading: { gradings: rows, selectedGradingId: null } } as unknown as CadWorkspaceSnapshot;
  const context: CadWorkspaceShellGradingContext = {
    snapshot,
    workspace: { runLayerCommand },
    gradingService: { requestGrading, requestGroupGrading } as unknown as SurfaceGradingService,
    setSelectedGradingId: vi.fn(),
    setGradingManagerTab: vi.fn(),
    setGradingManagerMethod: vi.fn(),
    setGradingVersion,
    setSurveyManager: vi.fn(),
    setSelectedGroupId: vi.fn(),
    setGroupManagerTab: vi.fn(),
  };
  return { context, runLayerCommand, requestGrading, requestGroupGrading, setGradingVersion };
};

const gradingRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 'g1',
  name: 'Pond',
  boundaryLabel: 'Daylight',
  extractable: false,
  extractNotice: 'Extract unavailable.',
  bakeable: false,
  bakeNotice: 'Bake unavailable.',
  currentResult: null,
  revision: '',
  ...over,
});

describe('STRUCT-194.2 grading control plane', () => {
  it('never recomputes in history: non-CURRENT rows return their verbatim notice', () => {
    const { context, runLayerCommand } = makeGradingContext([
      gradingRow({ id: 'g1', extractable: false, extractNotice: 'Needs a CURRENT boundary.' }),
    ]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    expect(actions.extractGradingDaylight!('g1')).toBe('Needs a CURRENT boundary.');
    expect(actions.bakeGradingSurface!('g1')).toBe('Bake unavailable.');
    expect(runLayerCommand).not.toHaveBeenCalled();
  });

  it('fails closed when an extractable row has no current cached result', () => {
    const { context, runLayerCommand } = makeGradingContext([
      gradingRow({ extractable: true, currentResult: null }),
    ]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    expect(actions.extractGradingDaylight!('g1')).toBe('Extract needs a CURRENT calculated result.');
    expect(runLayerCommand).not.toHaveBeenCalled();
  });

  it('dispatches Extract/Bake with the pinned original revision + sessionCurrent', () => {
    const { context, runLayerCommand } = makeGradingContext([
      gradingRow({ extractable: true, bakeable: true, currentResult: { mesh: true }, revision: 'rev-7' }),
    ]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    expect(actions.extractGradingDaylight!('g1')).toBe('Extracted “Pond - Daylight”.');
    expect(runLayerCommand).toHaveBeenCalledWith({
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId: 'g1',
      result: { mesh: true },
      expectedRevision: 'rev-7',
      sessionCurrent: true,
    });
    expect(actions.bakeGradingSurface!('g1')).toBe('Baked “Pond” into an explicit-TIN surface.');
    expect(runLayerCommand).toHaveBeenCalledWith({
      key: 'GRADINGBAKE',
      gradingId: 'g1',
      result: { mesh: true },
      expectedRevision: 'rev-7',
      sessionCurrent: true,
    });
  });

  it('groups route through their own command family with the same gate', () => {
    const { context, runLayerCommand } = makeGradingContext([]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    // No group snapshot is present in the single-grading snapshot -> notice.
    expect(actions.bakeGroupSurface!('grp-1')).toBe('Bake unavailable — needs a CURRENT, bakeable result.');
    expect(runLayerCommand).not.toHaveBeenCalled();
  });

  it('Calculate bumps the version through the session service (never auto-started)', () => {
    const { context, requestGrading, requestGroupGrading, setGradingVersion } = makeGradingContext([]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    expect(actions.requestGradingCalculate!('g1')).toBe('Calculating grading…');
    expect(requestGrading).toHaveBeenCalledWith('g1');
    expect(actions.requestGroupGradingCalculate!('grp-1')).toBe('Calculating group…');
    expect(requestGroupGrading).toHaveBeenCalledWith('grp-1');
    expect(setGradingVersion).toHaveBeenCalledTimes(2);
  });

  it('routes definition commands through runLayerCommand for both families', () => {
    const { context, runLayerCommand } = makeGradingContext([]);
    const actions = buildCadWorkspaceShellGradingActions(context);
    actions.runGradingCommand!({ key: 'GRADING_DELETE', gradingId: 'g1' } as never);
    actions.runGradingGroupCommand!({ key: 'GROUP_DELETE', groupId: 'grp-1' } as never);
    expect(runLayerCommand).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Compose + section layout safety (real project/cache, real engine)
// ---------------------------------------------------------------------------

const sectionProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Sections 1942', units: 'm' });
  const group1: CadSampleLineGroup = {
    id: 'grp-1',
    name: 'Corridor',
    alignmentEntityId: 'align-1',
    surfaceSources: [{ surfaceId: 'surf-1' }],
    sampleLines: [
      { id: 'line-1', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
      { id: 'line-2', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
    ],
  };
  const group2: CadSampleLineGroup = {
    id: 'grp-2',
    name: 'Second',
    alignmentEntityId: 'align-1',
    surfaceSources: [{ surfaceId: 'surf-1' }],
    sampleLines: [{ id: 'line-3', rawStation: 3, leftWidth: 4, rightWidth: 4, skewDeg: 0 }],
  };
  const existing: CadSectionView = {
    id: 'view-existing',
    name: 'View A',
    sampleLineGroupId: 'grp-1',
    sampleLineId: 'line-1',
    sourceSurfaceIds: ['surf-1'],
    insertionX: 0,
    insertionY: -200,
    horizontalScale: 1,
    verticalExaggeration: 1,
    datumMode: 'auto',
  };
  return {
    ...drawing.project,
    entities: [
      point('p1', 'P1', 0, 0, 5),
      point('p2', 'P2', 10, 0, 5),
      point('p3', 'P3', 10, 10, 5),
      point('p4', 'P4', 0, 10, 5),
      {
        id: 'align-1',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'CL',
        elements: [{ kind: 'line', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } }],
        startStation: 0,
      },
    ],
    surfaces: [
      {
        id: 'surf-1',
        name: 'Existing',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } },
        cachedRevision: null,
      },
    ],
    sampleLineGroups: [group1, group2],
    sectionViews: [existing],
  };
};

describe('STRUCT-194.2 section view layout', () => {
  it('reports a missing group honestly', () => {
    const plan = planSectionViewLayout(sectionProject(), createCadSectionCache('test'), 'nope');
    expect(plan).toEqual({ kind: 'group-missing' });
  });

  it('reports fully-built groups as already-exist and partial builds as placements', () => {
    // Already-exist branch: every grp-1 line already has a section view.
    const built = sectionProject();
    built.sectionViews = [
      built.sectionViews![0],
      { ...built.sectionViews![0], id: 'view-existing-2', sampleLineId: 'line-2' },
    ];
    expect(planSectionViewLayout(built, createCadSectionCache('test'), 'grp-1')).toEqual({
      kind: 'already-exist',
      message: 'Section views for “Corridor” already exist.',
    });

    // Missing-line branch: line-1 is built but line-2 still needs a placement.
    const partial = planSectionViewLayout(sectionProject(), createCadSectionCache('test'), 'grp-1');
    expect(partial.kind).toBe('placements');
    if (partial.kind !== 'placements') throw new Error('expected placements');
    expect(partial.placements.map((entry) => entry.lineId)).toEqual(['line-2']);
  });

  it('stacks new frames deterministically below every cross-group frame', () => {
    const project = sectionProject();
    project.sectionViews = [
      {
        ...project.sectionViews![0],
        sampleLineGroupId: 'grp-1',
        sampleLineId: 'line-1',
        insertionY: -100,
      },
    ];
    const plan = planSectionViewLayout(project, createCadSectionCache('test'), 'grp-2');
    expect(plan.kind).toBe('placements');
    if (plan.kind !== 'placements') throw new Error('expected placements');
    expect(plan.placements).toHaveLength(1);
    // Null cache + no results => fallback height 60 (+20 pad) = 80 per frame.
    // clearance = max(80, 80) + 20 = 100; origin = -100 - 100 = -200.
    expect(plan.placements[0].insertionY).toBe(-200);
    expect(plan.placements[0].insertionX).toBe(0);
  });

  it('exposes the same plan through the extracted createSectionViews action', async () => {
    const view = await track(await mount());
    expect(view.actions().createSectionViews('missing-group')).toBe('Select a sample-line group first.');
  });
});

describe('STRUCT-194.2 compose safety', () => {
  it('never promotes a stale/missing mesh and rejects same-surface compose', async () => {
    const view = await track(await mount());
    expect(view.actions().previewSurfaceCompose?.('surf:1', 'surf:1')).toBeNull();
    expect(view.actions().previewSurfaceCompose?.('surf:1', 'surf:missing')).toBeNull();
    expect(view.actions().previewSurfaceCompose?.('surf:missing', 'surf:1')).toBeNull();
  });

  it('falls back to the verbatim grading notices when no grading snapshot exists', async () => {
    const view = await track(await mount());
    expect(view.actions().extractGradingDaylight?.('nope')).toBe(
      'Extract unavailable — needs a CURRENT, single-boundary result.',
    );
    expect(view.actions().bakeGradingSurface?.('nope')).toBe(
      'Bake unavailable — needs a CURRENT, bakeable result.',
    );
    expect(view.actions().extractGroupDaylight?.('nope')).toBe(
      'Extract unavailable — needs a CURRENT, single-boundary result.',
    );
    expect(view.actions().bakeGroupSurface?.('nope')).toBe(
      'Bake unavailable — needs a CURRENT, bakeable result.',
    );
  });
});
