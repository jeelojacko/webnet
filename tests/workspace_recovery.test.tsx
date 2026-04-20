/** @vitest-environment jsdom */

import React, { act, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useWorkspaceRecovery } from '../src/hooks/useWorkspaceRecovery';
import { createDefaultReportViewSnapshot } from '../src/hooks/useReportViewState';
import type { RunSettingsSnapshot, WorkspaceDraftSnapshot } from '../src/appStateTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'webnet.workspace-recovery.test';
const defaultReportViewSnapshot = createDefaultReportViewSnapshot();

const buildSnapshot = (overrides: Partial<WorkspaceDraftSnapshot> = {}): WorkspaceDraftSnapshot => ({
  input: 'INPUT',
  projectIncludeFiles: {},
  settings: {
    maxIterations: 10,
    convergenceLimit: 0.01,
    units: 'm',
    uiTheme: 'gruvbox-dark',
    mapShowLostStations: true,
    map3dEnabled: false,
    listingShowLostStations: true,
    listingShowCoordinates: true,
    listingShowObservationsResiduals: true,
    listingShowErrorPropagation: true,
    listingShowProcessingNotes: true,
    listingShowAzimuthsBearings: true,
    listingSortCoordinatesBy: 'name',
    listingSortObservationsBy: 'residual',
    listingObservationLimit: 60,
  },
  parseSettings: {
    solveProfile: 'industry-parity',
    coordMode: '3D',
    coordSystemMode: 'local',
    crsId: 'LOCAL',
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    verticalDeflectionNorthSec: 0,
    verticalDeflectionEastSec: 0,
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
    clusterDetectionEnabled: false,
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 4,
    suspectImpactMode: 'auto',
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: 1e-7,
    qFixAngularSigmaSec: 0.0010001,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    directionSetMode: 'reduced',
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  },
  exportFormat: 'points',
  adjustedPointsExportSettings: {
    presetId: 'PNEZ',
    format: 'csv',
    delimiter: 'comma',
    includeLostStations: true,
    columns: ['P', 'N', 'E', 'Z'],
    transform: {
      referenceStationId: '',
      scope: 'all',
      selectedStationIds: [],
      rotation: { enabled: false, angleDeg: 0 },
      translation: { enabled: false, method: 'direction-distance', azimuthDeg: 0, distance: 0, targetE: 0, targetN: 0 },
      scale: { enabled: false, factor: 1 },
    },
  },
  projectInstruments: {},
  selectedInstrument: 'S9',
  levelLoopCustomPresets: [],
  geoidSourceDataBase64: null,
  geoidSourceDataLabel: '',
  view: {
    activeTab: 'report',
    splitPercent: 35,
    isSidebarOpen: true,
    review: {
      reportView: { ...defaultReportViewSnapshot },
      selection: {
        stationId: null,
        observationId: null,
        sourceLine: null,
        origin: null,
      },
      pinnedObservationIds: [],
      runFreshness: 'ready',
      blockingReasons: [],
    },
  },
  comparisonView: {
    stationMovementThreshold: 0.001,
    residualDeltaThreshold: 0.25,
  },
  savedRunSnapshots: [],
  importReview: null,
  ...overrides,
});

describe('useWorkspaceRecovery', () => {
  it('offers startup recovery and restores the stored snapshot', async () => {
    window.localStorage.clear();
    const savedSnapshot = buildSnapshot({ input: 'RECOVERED INPUT' });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: savedSnapshot,
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(buildSnapshot());
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: setSnapshot,
      });

      return (
        <div>
          <div data-has>{recovery.hasStoredDraft ? 'yes' : 'no'}</div>
          <div data-pending>{recovery.pendingRecovery ? 'yes' : 'no'}</div>
          <div data-input>{snapshot.input}</div>
          <button data-recover onClick={recovery.recoverDraft} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-pending]')?.textContent).toBe('yes');
    expect(container.querySelector('[data-input]')?.textContent).toBe('INPUT');

    await act(async () => {
      (container.querySelector('[data-recover]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-pending]')?.textContent).toBe('no');
    expect(container.querySelector('[data-input]')?.textContent).toBe('RECOVERED INPUT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('round-trips an open import-review snapshot through recovery storage', async () => {
    window.localStorage.clear();
    const savedSnapshot = buildSnapshot({
      input: 'RECOVER IMPORT',
      savedRunSnapshots: [
        {
          id: 'saved-run-1',
          sourceRunId: 'run-3',
          createdAt: '2026-03-18T11:00:00.000Z',
          savedAt: '2026-03-18T11:05:00.000Z',
          label: 'Saved Run 03',
          notes: 'checkpoint',
          inputFingerprint: 'fnv1a:abc',
          settingsFingerprint: 'fnv1a:def',
          summary: {
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stationCount: 1,
            observationCount: 0,
            suspectObservationCount: 0,
            maxAbsStdRes: 0,
          },
          result: {
            success: true,
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stations: {
              A: { x: 0, y: 0, h: 0, fixed: true },
            },
            observations: [],
            logs: [],
          },
          runDiagnostics: null,
          settingsSnapshot: {
            solveProfile: 'industry-parity',
          } as unknown as RunSettingsSnapshot,
          excludedIds: [],
          overrideIds: [],
          overrides: {},
          approvedClusterMerges: [],
          reopenState: null,
        },
      ],
      importReview: {
        sourceName: 'imported.jxl',
        notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
        sources: [
          {
            key: 'source:0',
            sourceName: 'imported.jxl',
            notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
            dataset: {
              importerId: 'jobxml',
              formatLabel: 'JobXML',
              summary: 'summary',
              notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
              comments: [],
              controlStations: [],
              observations: [],
              trace: [],
            },
            isPrimary: true,
          },
          {
            key: 'source:1',
            sourceName: 'imported.htm',
            notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
            dataset: {
              importerId: 'trimble-survey-report',
              formatLabel: 'Survey Report',
              summary: 'summary',
              notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
              comments: [],
              controlStations: [],
              observations: [],
              trace: [],
            },
            isPrimary: false,
          },
        ],
        dataset: {
          importerId: 'jobxml',
          formatLabel: 'JobXML',
          summary: 'summary',
          notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
          comments: [],
          controlStations: [],
          observations: [],
          trace: [],
        },
        reviewModel: {
          groups: [],
          items: [],
          warnings: [],
          errors: [],
        },
        comparisonMode: 'non-mta-only',
        excludedItemIds: [],
        fixedItemIds: [],
        groupLabels: {},
        groupComments: {},
        rowOverrides: {},
        rowTypeOverrides: {},
        preset: 'clean-webnet',
        importFaceNormalizationMode: 'on',
        force2DOutput: false,
        nextSyntheticId: 1,
        nextSourceId: 2,
        conflicts: [],
        conflictResolutions: {},
        conflictRenameValues: {},
      },
    });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: savedSnapshot,
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(buildSnapshot());
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: setSnapshot,
      });

      return (
        <div>
          <div data-import-source>{snapshot.importReview?.sourceName ?? '-'}</div>
          <div data-saved-runs>{snapshot.savedRunSnapshots.length}</div>
          <button data-recover onClick={recovery.recoverDraft} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('[data-recover]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-import-source]')?.textContent).toBe('imported.jxl');
    expect(container.querySelector('[data-saved-runs]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('discards a pending startup draft without immediately re-saving the current snapshot', async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: buildSnapshot({ input: 'OLD INPUT' }),
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot: useMemo(() => buildSnapshot({ input: 'CURRENT INPUT' }), []),
        onRecover: () => undefined,
      });

      return <button data-discard onClick={recovery.discardRecoveredDraft} />;
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('[data-discard]') as HTMLButtonElement).click();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('clears the current draft and only re-saves after the snapshot changes', async () => {
    window.localStorage.clear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [suffix, setSuffix] = useState('A');
      const snapshot = useMemo(() => buildSnapshot({ input: `INPUT-${suffix}` }), [suffix]);
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
      });

      useEffect(() => {
        if (!window.localStorage.getItem(STORAGE_KEY)) return;
      }, []);

      return (
        <div>
          <button data-clear onClick={recovery.clearCurrentDraft} />
          <button data-change onClick={() => setSuffix('B')} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-clear]') as HTMLButtonElement).click();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      (container.querySelector('[data-change]') as HTMLButtonElement).click();
    });

    const rawAfterChange = window.localStorage.getItem(STORAGE_KEY);
    expect(rawAfterChange).not.toBeNull();
    expect(rawAfterChange).toContain('INPUT-B');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('replaces the persisted draft snapshot when a project-style load swaps the workspace state', async () => {
    window.localStorage.clear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(
        buildSnapshot({
          input: 'DRAFT INPUT',
          exportFormat: 'points',
          projectIncludeFiles: { 'draft.dat': 'C P1 0 0 0' },
        }),
      );
      useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
      });

      return (
        <button
          data-load-project
          onClick={() =>
            setSnapshot(
              buildSnapshot({
                input: 'PROJECT INPUT',
                exportFormat: 'industry-style',
                projectIncludeFiles: { 'loaded.dat': 'C P2 1 1 1' },
                view: {
                  activeTab: 'map',
                  splitPercent: 42,
                  isSidebarOpen: false,
                  review: {
                    reportView: {
                      ...defaultReportViewSnapshot,
                      ellipseMode: '95',
                      reportFilterQuery: 'p2',
                      reportObservationTypeFilter: 'dist',
                      reportExclusionFilter: 'included',
                      tableRowLimits: { sample: 250 },
                      pinnedDetailSections: [{ id: 'angles-ts', label: 'Angles (TS)' }],
                      collapsedDetailSections: {
                        ...defaultReportViewSnapshot.collapsedDetailSections,
                        'angles-ts': true,
                      },
                    },
                    selection: {
                      stationId: 'P2',
                      observationId: null,
                      sourceLine: 12,
                      origin: 'report',
                    },
                    pinnedObservationIds: [7],
                    runFreshness: 'reviewing',
                    blockingReasons: ['1 setting change(s) pending rerun'],
                  },
                },
              }),
            )
          }
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const initialRaw = window.localStorage.getItem(STORAGE_KEY);
    expect(initialRaw).toContain('DRAFT INPUT');
    expect(initialRaw).not.toContain('PROJECT INPUT');

    await act(async () => {
      (container.querySelector('[data-load-project]') as HTMLButtonElement).click();
    });

    const replacedRaw = window.localStorage.getItem(STORAGE_KEY);
    expect(replacedRaw).toContain('PROJECT INPUT');
    expect(replacedRaw).toContain('industry-style');
    expect(replacedRaw).toContain('loaded.dat');
    expect(replacedRaw).toContain('"activeTab":"map"');
    expect(replacedRaw).toContain('"reportFilterQuery":"p2"');
    expect(replacedRaw).not.toContain('DRAFT INPUT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('disables browser draft recovery while a named local project is open', async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-04-10T12:00:00.000Z',
        snapshot: buildSnapshot({ input: 'STORED DRAFT' }),
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [disabled, setDisabled] = useState(true);
      const snapshot = useMemo(
        () => buildSnapshot({ input: disabled ? 'NAMED PROJECT' : 'UNTITLED WORKSPACE' }),
        [disabled],
      );
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
        disabled,
      });

      return (
        <div>
          <div data-has>{recovery.hasStoredDraft ? 'yes' : 'no'}</div>
          <div data-pending>{recovery.pendingRecovery ? 'yes' : 'no'}</div>
          <button data-enable onClick={() => setDisabled(false)} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-has]')?.textContent).toBe('no');
    expect(container.querySelector('[data-pending]')?.textContent).toBe('no');
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('STORED DRAFT');

    await act(async () => {
      (container.querySelector('[data-enable]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-has]')?.textContent).toBe('yes');
    expect(container.querySelector('[data-pending]')?.textContent).toBe('yes');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
