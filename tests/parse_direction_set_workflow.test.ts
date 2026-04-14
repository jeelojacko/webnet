import { describe, expect, it } from 'vitest';

import {
  createDirectionSetWorkflow,
  type DirectionTraverseContext,
} from '../src/engine/parseDirectionSetWorkflow';
import type {
  DirectionRejectDiagnostic,
  DirectionSetTreatmentDiagnostic,
  Observation,
  ParseOptions,
} from '../src/types';

const createState = (overrides: Partial<ParseOptions> = {}): ParseOptions => ({
  units: 'm',
  coordMode: '3D',
  order: 'EN',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  directionSetMode: 'reduced',
  directionFaceReliabilityFromCluster: false,
  ...overrides,
});

const createHarness = (
  state: ParseOptions,
  compatibilityMode: 'legacy' | 'strict' = 'legacy',
) => {
  const logs: string[] = [];
  const observations: Observation[] = [];
  let currentLine = 100;
  let currentSourceFile = 'input.dat';
  const obsIdRef = { current: 0 };
  const directionRejectDiagnostics: DirectionRejectDiagnostic[] = [];
  const directionSetTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[] = [];
  const workflow = createDirectionSetWorkflow({
    state,
    logs,
    compatibilityMode,
    getCurrentLine: () => currentLine,
    getCurrentSourceFile: () => currentSourceFile,
    obsIdRef,
    pushObservation: (observation) => {
      observations.push(observation);
    },
    directionRejectDiagnostics,
    directionSetTreatmentDiagnostics,
  });
  return {
    logs,
    observations,
    directionRejectDiagnostics,
    directionSetTreatmentDiagnostics,
    workflow,
    setLine: (line: number) => {
      currentLine = line;
    },
    setSourceFile: (sourceFile: string) => {
      currentSourceFile = sourceFile;
    },
  };
};

describe('parseDirectionSetWorkflow', () => {
  it('reduces mixed-face shots into normalized direction rows in reduced mode', () => {
    const { logs, observations, directionSetTreatmentDiagnostics, workflow } = createHarness(
      createState({
      faceNormalizationMode: 'on',
      directionSetMode: 'reduced',
      directionFaceReliabilityFromCluster: false,
      }),
    );

    workflow.reduceDirectionShots('SET1', 'STA1', 'S9', [
      {
        to: 'P1',
        obs: 1.0,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 10,
        face: 'face1',
        faceSource: 'metadata',
        reliableFace: true,
      },
      {
        to: 'P1',
        obs: 1.0 + Math.PI,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 11,
        face: 'face2',
        faceSource: 'metadata',
        reliableFace: true,
      },
      {
        to: 'P2',
        obs: 2.0,
        stdDev: 0.002,
        sigmaSource: 'default',
        sourceLine: 12,
        face: 'face1',
        faceSource: 'metadata',
        reliableFace: true,
      },
    ]);

    expect(observations).toHaveLength(2);
    expect(observations.every((observation) => observation.type === 'direction')).toBe(true);
    expect(observations.map((observation) => observation.setId)).toEqual(['SET1', 'SET1']);
    expect(directionSetTreatmentDiagnostics).toHaveLength(1);
    expect(directionSetTreatmentDiagnostics[0]).toMatchObject({
      setId: 'SET1',
      occupy: 'STA1',
      treatmentDecision: 'normalized',
      policyOutcome: 'accepted',
      readingCount: 3,
      targetCount: 2,
    });
    expect(logs.some((entry) => entry.includes('Direction set SET1 @ STA1: reduced 2 from 3 shots'))).toBe(
      true,
    );
  });

  it('splits mixed-face shots into raw face buckets when normalization is off', () => {
    const { observations, directionSetTreatmentDiagnostics, workflow } = createHarness(createState({
      faceNormalizationMode: 'off',
      directionSetMode: 'raw',
      directionFaceReliabilityFromCluster: false,
    }));

    workflow.reduceDirectionShots('SET2', 'STA2', '', [
      {
        to: 'P1',
        obs: 0.5,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 20,
        face: 'face1',
        faceSource: 'metadata',
        reliableFace: true,
      },
      {
        to: 'P1',
        obs: 0.5 + Math.PI,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 21,
        face: 'face2',
        faceSource: 'metadata',
        reliableFace: true,
      },
    ]);

    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.setId)).toEqual(['SET2:F1', 'SET2:F2']);
    expect(directionSetTreatmentDiagnostics[0]).toMatchObject({
      setId: 'SET2',
      occupy: 'STA2',
      treatmentDecision: 'split',
      policyOutcome: 'accepted',
    });
  });

  it('rejects unresolved mixed-face sets in strict mode', () => {
    const { logs, observations, directionRejectDiagnostics, directionSetTreatmentDiagnostics, workflow } =
      createHarness(
        createState({
          faceNormalizationMode: 'auto',
          directionSetMode: 'reduced',
          directionFaceReliabilityFromCluster: false,
        }),
        'strict',
      );

    workflow.reduceDirectionShots('SET3', 'STA3', '', [
      {
        to: 'P1',
        obs: 0.5,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 30,
        face: 'face1',
        faceSource: 'metadata',
        reliableFace: true,
      },
      {
        to: 'P2',
        obs: 2.5,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 31,
        face: 'face2',
        faceSource: 'fallback',
        reliableFace: false,
      },
    ]);

    expect(observations).toHaveLength(0);
    expect(directionRejectDiagnostics).toHaveLength(1);
    expect(directionRejectDiagnostics[0]).toMatchObject({
      setId: 'SET3',
      occupy: 'STA3',
      reason: 'unresolved-mixed-face',
      policyOutcome: 'strict-reject',
      treatmentDecision: 'unresolved',
    });
    expect(directionSetTreatmentDiagnostics).toHaveLength(1);
    expect(logs.some((entry) => entry.includes('Error: Direction set SET3 @ STA3: unresolved mixed-face observations in strict mode'))).toBe(true);
  });

  it('falls back to raw face buckets for unresolved mixed-face sets in strict raw mode', () => {
    const { observations, directionRejectDiagnostics, directionSetTreatmentDiagnostics, workflow } =
      createHarness(
        createState({
          faceNormalizationMode: 'auto',
          directionSetMode: 'raw',
          directionFaceReliabilityFromCluster: false,
        }),
        'strict',
      );

    workflow.reduceDirectionShots('SET3R', 'STA3', '', [
      {
        to: 'P1',
        obs: 0.5,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 30,
        face: 'face1',
        faceSource: 'metadata',
        reliableFace: true,
      },
      {
        to: 'P2',
        obs: 2.5,
        stdDev: 0.001,
        sigmaSource: 'explicit',
        sourceLine: 31,
        face: 'face2',
        faceSource: 'fallback',
        reliableFace: false,
      },
    ]);

    expect(directionRejectDiagnostics).toHaveLength(0);
    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.setId)).toEqual(['SET3R:F1', 'SET3R:F2']);
    expect(directionSetTreatmentDiagnostics[0]).toMatchObject({
      setId: 'SET3R',
      treatmentDecision: 'split',
      policyOutcome: 'legacy-fallback',
    });
  });

  it('flushes empty sets into no-shot diagnostics and clears traverse context', () => {
    const { directionRejectDiagnostics, workflow, setLine, setSourceFile } = createHarness(createState({
      faceNormalizationMode: 'on',
      directionSetMode: 'reduced',
      directionFaceReliabilityFromCluster: false,
    }));
    const traverseCtx: DirectionTraverseContext = {
      occupy: 'STA4',
      backsight: 'BS1',
      dirSetId: 'SET4',
      dirInstCode: 'S9',
      dirRawShots: [],
    };

    setLine(44);
    setSourceFile('child.dat');
    workflow.flushDirectionSet(traverseCtx, 'DE');

    expect(directionRejectDiagnostics).toHaveLength(1);
    expect(directionRejectDiagnostics[0]).toMatchObject({
      setId: 'SET4',
      occupy: 'STA4',
      sourceLine: 44,
      sourceFile: 'child.dat',
      recordType: 'DE',
      reason: 'no-shots',
    });
    expect(traverseCtx).toEqual({
      occupy: undefined,
      backsight: undefined,
      dirSetId: undefined,
      dirInstCode: undefined,
      dirRawShots: undefined,
    });
  });
});
