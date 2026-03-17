/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { useAdjustmentWorkflow } from '../src/hooks/useAdjustmentWorkflow';
import type {
  ParseSettings,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
} from '../src/appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  InstrumentLibrary,
} from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseSettings: SettingsState = {
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
};

const baseParseSettings: ParseSettings = {
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
  clusterDetectionEnabled: true,
  autoSideshotEnabled: true,
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
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
  qFixAngularSigmaSec: 1.0001e-3,
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

const baseRunSettingsSnapshot: RunSettingsSnapshot = {
  maxIterations: 10,
  convergenceLimit: 0.01,
  units: 'm',
  solveProfile: 'industry-parity-current',
  runMode: 'adjustment',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'LOCAL',
  directionSetMode: 'reduced',
  mapMode: 'off',
  mapScaleFactor: 1,
  verticalReduction: 'none',
  applyCurvatureRefraction: false,
  tsCorrelationEnabled: false,
  tsCorrelationScope: 'set',
  tsCorrelationRho: 0.25,
  robustMode: 'none',
  robustK: 1.5,
  clusterDetectionEnabled: true,
  autoSideshotEnabled: true,
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
  selectedInstrument: 'S9',
};

const buildClusterResult = (): AdjustmentResult =>
  ({
    converged: true,
    iterations: 1,
    seuw: 1,
    dof: 1,
    stations: {
      A: { x: 0, y: 0, h: 0, fixed: false },
      B: { x: 1, y: 1, h: 0, fixed: false },
    },
    observations: [],
    residuals: [],
    logs: [],
    clusterDiagnostics: {
      enabled: true,
      candidates: [
        {
          key: 'CL-1',
          representativeId: 'A',
          stationIds: ['A', 'B'],
          memberCount: 2,
        },
      ],
      appliedMerges: [],
      rejectedProposals: [],
    },
  }) as unknown as AdjustmentResult;

describe('useAdjustmentWorkflow', () => {
  it('tracks cluster-review state, applies reruns, and resets local review state', async () => {
    vi.useFakeTimers();
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });

    const directRunner = vi.fn(
      (request: {
        excludedIds: number[];
        approvedClusterMerges: ClusterApprovedMerge[];
      }) =>
        ({
          result: {
            ...buildClusterResult(),
            logs: [],
          },
          effectiveExcludedIds: [...request.excludedIds],
          effectiveClusterApprovedMerges: [...request.approvedClusterMerges],
          droppedExclusions: 0,
          droppedOverrides: 0,
          droppedClusterMerges: 0,
          inputChangedSinceLastRun: false,
          elapsedMs: 12,
        }) as const,
    );
    const recordRunSnapshot = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [result, setResult] = useState<AdjustmentResult | null>(buildClusterResult());
      const [runDiagnostics, setRunDiagnostics] = useState<RunDiagnostics | null>(null);
      const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null);
      const [lastRunInput, setLastRunInput] = useState<string | null>(null);
      const [lastRunSettingsSnapshot, setLastRunSettingsSnapshot] =
        useState<RunSettingsSnapshot | null>(null);
      const [reportActivations, setReportActivations] = useState(0);

      const state = useAdjustmentWorkflow<RunDiagnostics>({
        input: 'NETWORK',
        lastRunInput,
        settings: baseSettings,
        parseSettings: baseParseSettings,
        projectInstruments: { S9: { code: 'S9' } as InstrumentLibrary['S9'] },
        selectedInstrument: 'S9',
        projectIncludeFiles: {},
        geoidSourceData: null,
        currentRunSettingsSnapshot: baseRunSettingsSnapshot,
        result,
        buildRunDiagnostics: (_parseSettings, _solved) =>
          ({
            runMode: 'adjustment',
            preanalysisMode: false,
            plannedObservationCount: 0,
            parity: false,
          }) as RunDiagnostics,
        directRunner: directRunner as never,
        setResult,
        setRunDiagnostics,
        setRunElapsedMs,
        setLastRunInput,
        setLastRunSettingsSnapshot,
        activateReportTab: () => setReportActivations((prev) => prev + 1),
        recordRunSnapshot,
      });

      return (
        <div>
          <button type="button" onClick={() => state.handleClusterDecisionStatus('CL-1', 'approve')}>
            approve
          </button>
          <button type="button" onClick={() => state.handleClusterCanonicalSelection('CL-1', 'B')}>
            choose-b
          </button>
          <button type="button" onClick={() => state.toggleExclude(7)}>
            exclude
          </button>
          <button type="button" onClick={() => state.handleOverride(7, { obs: 1.23 })}>
            override
          </button>
          <button type="button" onClick={state.applyClusterReviewMerges}>
            run-merge
          </button>
          <button type="button" onClick={state.resetAdjustmentWorkflowState}>
            reset
          </button>
          <div id="status">{state.pipelineState.status}</div>
          <div id="decision">{state.clusterReviewDecisions['CL-1']?.status ?? '-'}</div>
          <div id="canonical">{state.clusterReviewDecisions['CL-1']?.canonicalId ?? '-'}</div>
          <div id="excluded">{state.excludedIds.size}</div>
          <div id="overrides">{Object.keys(state.overrides).length}</div>
          <div id="merges">{state.activeClusterApprovedMerges.length}</div>
          <div id="report">{reportActivations}</div>
          <div id="last-run">{lastRunInput ?? '-'}</div>
          <div id="diag">{runDiagnostics?.runMode ?? '-'}</div>
          <div id="elapsed">{runElapsedMs ?? -1}</div>
          <div id="snapshot">{lastRunSettingsSnapshot?.selectedInstrument ?? '-'}</div>
          <div id="result">{result ? 'yes' : 'no'}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('#decision')?.textContent).toBe('pending');
    expect(container.querySelector('#canonical')?.textContent).toBe('A');

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('approve');
    await click('choose-b');
    await click('exclude');
    await click('override');

    expect(container.querySelector('#decision')?.textContent).toBe('approve');
    expect(container.querySelector('#canonical')?.textContent).toBe('B');
    expect(container.querySelector('#excluded')?.textContent).toBe('1');
    expect(container.querySelector('#overrides')?.textContent).toBe('1');

    await click('run-merge');
    expect(container.querySelector('#status')?.textContent).toBe('running');

    await act(async () => {
      vi.runAllTimers();
    });

    expect(directRunner).toHaveBeenCalledTimes(1);
    expect(directRunner.mock.calls[0]?.[0].approvedClusterMerges).toEqual([
      { aliasId: 'A', canonicalId: 'B' },
    ]);
    expect(container.querySelector('#merges')?.textContent).toBe('1');
    expect(container.querySelector('#report')?.textContent).toBe('1');
    expect(container.querySelector('#last-run')?.textContent).toBe('NETWORK');
    expect(container.querySelector('#diag')?.textContent).toBe('adjustment');
    expect(container.querySelector('#elapsed')?.textContent).toBe('12');
    expect(container.querySelector('#snapshot')?.textContent).toBe('S9');
    expect(recordRunSnapshot).toHaveBeenCalledTimes(1);

    await click('reset');
    expect(container.querySelector('#decision')?.textContent).toBe('-');
    expect(container.querySelector('#excluded')?.textContent).toBe('0');
    expect(container.querySelector('#overrides')?.textContent).toBe('0');
    expect(container.querySelector('#merges')?.textContent).toBe('0');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
    vi.useRealTimers();
  });
});
