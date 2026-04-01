/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { ParseSettings } from '../src/appStateTypes';
import { useImportReviewWorkflow } from '../src/hooks/useImportReviewWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const parseSettings: ParseSettings = {
  solveProfile: 'industry-parity-current',
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
      });
    };

    await click('choose');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('sample.jobxml');
    expect(container.querySelector('[data-angle]')?.textContent).toBe('reduced');
    expect(container.querySelector('[data-face]')?.textContent).toBe('on');

    await click('cancel');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('-');
    expect(setInput).not.toHaveBeenCalled();
    expect(resetWorkspaceForImportedInput).not.toHaveBeenCalled();

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
    expect(container.querySelector('[data-snapshot]')?.textContent).toBe('imported.jxl');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
