/** @vitest-environment jsdom */

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { ParseSettings } from '../src/appStateTypes';
import {
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  cloneAdjustedPointsExportSettings,
} from '../src/engine/adjustedPointsExport';
import { useImportReviewWorkflow } from '../src/hooks/useImportReviewWorkflow';
import type { PreparedAssociatedProjectSettingsImport } from '../src/hooks/useProjectFileWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trimmedIndustryJobXml = readFileSync(
  'tests/fixtures/jobxml_industry_style_trimmed_260215.jxl',
  'utf-8',
);

const parseSettings: ParseSettings = {
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
};

describe('useImportReviewWorkflow', () => {
  it('opens and clears the angle-mode prompt for prompt-required import files', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const setInput = vi.fn();
    const setProjectIncludeFiles = vi.fn();
    const setImportNotice = vi.fn();
    const resetWorkspaceForImportedInput = vi.fn();

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        parseSettings,
        projectInstruments: {},
        setInput,
        setProjectIncludeFiles,
        setImportNotice,
        resetWorkspaceForImportedInput,
      });

      return (
        <div>
          <div data-prompt>{state.pendingAnglePromptFile?.file.name ?? '-'}</div>
          <div data-angle>{state.pendingAnglePromptFile?.angleMode ?? '-'}</div>
          <div data-face>{state.pendingAnglePromptFile?.faceMode ?? '-'}</div>
          <div data-style>{state.pendingAnglePromptFile?.importStyle ?? '-'}</div>
          <button
            onClick={() =>
              state.handleFileChange({
                target: {
                  files: [new File(['<xml />'], 'sample.jobxml', { type: 'text/xml' })],
                  value: '',
                },
              } as never)
            }
          >
            choose
          </button>
          <button onClick={() => state.handleImportAnglePromptSetImportStyle('industry-style')}>
            industry
          </button>
          <button onClick={state.handleImportAnglePromptCancel}>cancel</button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    };

    await click('choose');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('sample.jobxml');
    expect(container.querySelector('[data-angle]')?.textContent).toBe('reduced');
    expect(container.querySelector('[data-face]')?.textContent).toBe('on');
    expect(container.querySelector('[data-style]')?.textContent).toBe('generic');

    await click('industry');
    expect(container.querySelector('[data-style]')?.textContent).toBe('industry-style');

    await click('cancel');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('-');
    expect(setInput).not.toHaveBeenCalled();
    expect(resetWorkspaceForImportedInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes plain dat imports to project source-file append when a project handler exists', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const setInput = vi.fn();
    const importProjectSourceFiles = vi.fn(async () => true);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: 'ORIGINAL',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        importProjectSourceFiles,
        parseSettings,
        projectInstruments: {},
        setInput,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <button
          onClick={() =>
            void state.handleFileChange({
              target: {
                files: [
                  new File(['A'], 'traverse.dat', { type: 'text/plain' }),
                  new File(['B'], 'control.dat', { type: 'text/plain' }),
                ],
                value: '',
              },
            } as never)
          }
        >
          choose
        </button>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(importProjectSourceFiles).toHaveBeenCalledTimes(1);
    const importedFiles = (
      importProjectSourceFiles.mock.calls as unknown as Array<[File[]]>
    )[0]?.[0];
    expect(importedFiles?.map((file) => file.name)).toEqual([
      'traverse.dat',
      'control.dat',
    ]);
    expect(setInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('restores a saved import-review snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: 'C P1 100.0000 200.0000 10.0000',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-source>{state.importReviewState?.sourceName ?? '-'}</div>
          <div data-sources>{state.importReviewState?.sources.length ?? 0}</div>
          <div data-conflicts>{state.importReviewState?.conflicts.length ?? 0}</div>
          <div data-compare-rows>{state.importReviewState?.comparisonSummary?.rows.length ?? 0}</div>
          <div data-resolution>{state.importReviewState?.conflictResolutions['control:0'] ?? '-'}</div>
          <div data-rename>{state.importReviewState?.conflictRenameValues['control:0'] ?? '-'}</div>
          <div data-style>{state.importReviewState?.importStyle ?? '-'}</div>
          <div data-snapshot>{state.importReviewSnapshot?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
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
                      controlStations: [
                        {
                          kind: 'control-station',
                          coordinateMode: 'local',
                          stationId: 'P1',
                          eastM: 101,
                          northM: 201,
                          heightM: 11,
                        },
                      ],
                      observations: [
                        {
                          kind: 'distance',
                          fromId: 'P1',
                          toId: 'P2',
                          distanceM: 12.3,
                        },
                      ],
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
                  controlStations: [
                    {
                      kind: 'control-station',
                      coordinateMode: 'local',
                      stationId: 'P1',
                      eastM: 101,
                      northM: 201,
                      heightM: 11,
                    },
                  ],
                  observations: [],
                  trace: [],
                },
                reviewModel: {
                  groups: [
                    {
                      key: 'control',
                      kind: 'control',
                      label: 'Control',
                      defaultComment: 'CONTROL',
                      itemIds: ['control:0'],
                    },
                  ],
                  items: [
                    {
                      id: 'control:0',
                      kind: 'control',
                      index: 0,
                      groupKey: 'control',
                      sourceType: 'Control Point',
                      stationId: 'P1',
                    },
                  ],
                  warnings: [],
                  errors: [],
                },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: { control: 'Control' },
                groupComments: { control: 'CONTROL' },
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'industry-style',
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 2,
                conflicts: [
                  {
                    id: 'coordinate-conflict:P1:0',
                    type: 'coordinate-conflict',
                    resolutionKey: 'control:0',
                    title: 'Coordinate values differ for the same station',
                    targetLabel: 'P1',
                    existingSummary: 'ID P1; E=100.0000; N=200.0000; H=10.0000',
                    incomingSummary: 'ID P1; E=101.0000; N=201.0000; H=11.0000',
                    relatedItems: [{ kind: 'control', index: 0 }],
                  },
                ],
                conflictResolutions: { 'control:0': 'rename-incoming' },
                conflictRenameValues: { 'control:0': 'P1_IMPORT' },
              })
            }
          >
            restore
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'restore',
      ) as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-source]')?.textContent).toBe('imported.jxl');
    expect(container.querySelector('[data-sources]')?.textContent).toBe('2');
    expect(container.querySelector('[data-conflicts]')?.textContent).toBe('1');
    expect(container.querySelector('[data-compare-rows]')?.textContent).toBe('1');
    expect(container.querySelector('[data-resolution]')?.textContent).toBe('rename-incoming');
    expect(container.querySelector('[data-rename]')?.textContent).toBe('P1_IMPORT');
    expect(container.querySelector('[data-style]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-snapshot]')?.textContent).toBe('imported.jxl');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('defaults industry-style JXL review to the industry preset and excludes MTA rows', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-prompt-style>{state.pendingAnglePromptFile?.importStyle ?? '-'}</div>
          <div data-preset>{state.importReviewState?.preset ?? '-'}</div>
          <div data-import-style>{state.importReviewState?.importStyle ?? '-'}</div>
          <div data-excluded>{state.importReviewState?.excludedItemIds.size ?? 0}</div>
          <button
            onClick={() =>
              state.handleFileChange({
                target: {
                  files: [
                    new File([trimmedIndustryJobXml], '260215 TRAVERSE.jxl', {
                      type: 'text/xml',
                    }),
                  ],
                  value: '',
                },
              } as never)
            }
          >
            choose
          </button>
          <button onClick={() => state.handleImportAnglePromptSetImportStyle('industry-style')}>
            industry
          </button>
          <button onClick={state.handleImportAnglePromptAccept}>accept</button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('choose');
    expect(container.querySelector('[data-prompt-style]')?.textContent).toBe('generic');

    await click('industry');
    expect(container.querySelector('[data-prompt-style]')?.textContent).toBe('industry-style');

    await click('accept');
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (container.querySelector('[data-preset]')?.textContent === 'industry-style') break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
    expect(container.querySelector('[data-preset]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-import-style]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-excluded]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('stages associated settings inside import review until final import', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const settingsFileInputRef = { current: null as HTMLInputElement | null };
    const importGeneratedProjectSourceFile = vi.fn(async () => true);
    const preparedSettings: PreparedAssociatedProjectSettingsImport = {
      sourceName: 'sample.snproj',
      payload: {
        schemaVersion: 5,
        input: '',
        includeFiles: {},
        savedRuns: [],
        ui: {
          settings: {} as Record<string, unknown>,
          parseSettings: {} as Record<string, unknown>,
          exportFormat: 'industry-style',
          adjustedPointsExport: cloneAdjustedPointsExportSettings(
            DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          ),
        },
        project: {
          projectInstruments: {},
          selectedInstrument: 'IMPORTED',
          levelLoopCustomPresets: [],
        },
      },
      appliedDomains: ['parse settings', 'instrument defaults'],
      ignoredDomains: ['data file list'],
    };
    const prepareAssociatedProjectSettingsImport = vi.fn(async () => preparedSettings);
    const applyPreparedAssociatedProjectSettings = vi.fn(async () => true);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        settingsFileInputRef,
        importGeneratedProjectSourceFile,
        prepareAssociatedProjectSettingsImport,
        applyPreparedAssociatedProjectSettings,
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-source>{state.importReviewState?.sourceName ?? '-'}</div>
          <div data-staged>{state.importReviewState?.stagedAssociatedSettings?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
                sourceName: '260215 TRAVERSE.jxl',
                notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                sources: [
                  {
                    key: 'source:0',
                    sourceName: '260215 TRAVERSE.jxl',
                    notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                    dataset: {
                      importerId: 'jobxml',
                      formatLabel: 'JobXML',
                      summary: 'summary',
                      notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                      comments: [],
                      controlStations: [],
                      observations: [
                        {
                          kind: 'distance',
                          fromId: 'P1',
                          toId: 'P2',
                          distanceM: 12.3456,
                        },
                      ],
                      trace: [],
                    },
                    isPrimary: true,
                  },
                ],
                dataset: {
                  importerId: 'jobxml',
                  formatLabel: 'JobXML',
                  summary: 'summary',
                  notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                  comments: [],
                  controlStations: [],
                  observations: [
                    {
                      kind: 'distance',
                      fromId: 'P1',
                      toId: 'P2',
                      distanceM: 12.3456,
                    },
                  ],
                  trace: [],
                },
                reviewModel: {
                  groups: [
                    {
                      key: 'observation',
                      kind: 'setup',
                      label: 'Observation',
                      defaultComment: 'OBSERVATION',
                      itemIds: ['observation:0'],
                    },
                  ],
                  items: [
                    {
                      id: 'observation:0',
                      kind: 'observation',
                      index: 0,
                      groupKey: 'observation',
                      sourceType: 'Distance',
                      sourceObservationKind: 'distance',
                    },
                  ],
                  warnings: [],
                  errors: [],
                },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: { observation: 'Observation' },
                groupComments: { observation: 'OBSERVATION' },
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'industry-style',
                stagedAssociatedSettings: null,
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 1,
                conflicts: [],
                conflictResolutions: {},
                conflictRenameValues: {},
              })
            }
          >
            restore
          </button>
          <button onClick={() => void state.handleApplyImportReviewAsNewFile()}>new-file</button>
          <button
            onClick={() =>
              void state.handleImportReviewSettingsFileChange({
                target: {
                  files: [
                    new File(['{}'], 'sample.snproj', { type: 'text/plain' }),
                  ],
                  value: 'sample.snproj',
                },
              } as never)
            }
          >
            settings
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('restore');
    expect(container.querySelector('[data-source]')?.textContent).toBe('260215 TRAVERSE.jxl');

    await click('settings');
    expect(prepareAssociatedProjectSettingsImport).toHaveBeenCalledTimes(1);
    const importedSettingsFile = (
      prepareAssociatedProjectSettingsImport.mock.calls[0] as unknown as [File] | undefined
    )?.[0];
    expect(importedSettingsFile?.name).toBe('sample.snproj');
    expect(applyPreparedAssociatedProjectSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[data-staged]')?.textContent).toBe('sample.snproj');

    await click('new-file');
    expect(importGeneratedProjectSourceFile).toHaveBeenCalledTimes(1);
    expect(importGeneratedProjectSourceFile).toHaveBeenCalledWith({
      sourceName: '260215 TRAVERSE.jxl',
      text: '.UNITS M\n.ORDER EN\n\n# OBSERVATION\nD P1 P2 12.3456\n',
    });
    expect(applyPreparedAssociatedProjectSettings).toHaveBeenCalledTimes(1);
    expect(applyPreparedAssociatedProjectSettings).toHaveBeenCalledWith(preparedSettings, {
      successTitle: 'Project source file added and settings applied',
      successDetailPrefix: ['Added imported review output to the current project workspace.'],
      failureDetailPrefix: ['Imported review output was added to the current project workspace.'],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('restores staged associated settings from the import-review snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef: { current: null },
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-staged>{state.importReviewState?.stagedAssociatedSettings?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
                sourceName: 'coldstream.dat',
                notice: { title: 'Imported dataset', detailLines: ['detail'] },
                sources: [],
                dataset: {
                  importerId: 'jobxml',
                  formatLabel: 'JobXML',
                  summary: 'summary',
                  notice: { title: 'Imported dataset', detailLines: ['detail'] },
                  comments: [],
                  controlStations: [],
                  observations: [],
                  trace: [],
                },
                reviewModel: { groups: [], items: [], warnings: [], errors: [] },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: {},
                groupComments: {},
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'generic',
                stagedAssociatedSettings: {
                  sourceName: 'coldstream_case_settings.snproj',
                  payload: {
                    schemaVersion: 5,
                    input: '',
                    includeFiles: {},
                    savedRuns: [],
                    ui: {
                      settings: {} as Record<string, unknown>,
                      parseSettings: {} as Record<string, unknown>,
                      exportFormat: 'industry-style',
                      adjustedPointsExport: cloneAdjustedPointsExportSettings(
                        DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
                      ),
                    },
                    project: {
                      projectInstruments: {},
                      selectedInstrument: 'IMPORTED',
                      levelLoopCustomPresets: [],
                    },
                  },
                  appliedDomains: ['parse settings'],
                  ignoredDomains: [],
                },
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 1,
                conflicts: [],
                conflictResolutions: {},
                conflictRenameValues: {},
              })
            }
          >
            restore
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('button') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-staged]')?.textContent).toBe(
      'coldstream_case_settings.snproj',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
