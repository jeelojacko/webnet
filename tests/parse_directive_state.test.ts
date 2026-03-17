import { describe, expect, it } from 'vitest';

import {
  applyCoreDirectiveState,
  directiveTransitionStateFromParseState,
  finalizeDirectiveTransitions,
  normalizeObservationModeState,
} from '../src/engine/parseDirectiveState';
import type { DirectiveTransition, Observation, ParseOptions } from '../src/types';

const createState = (): ParseOptions =>
  ({
    units: 'm',
    angleUnits: 'dms',
    coordMode: '3D',
    averageScaleFactor: 1,
    scaleOverrideActive: false,
    reductionContext: {
      inputSpaceDefault: 'measured',
      distanceKind: 'ground',
      bearingKind: 'grid',
      explicitOverrideActive: false,
    },
    observationMode: undefined,
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    order: 'EN',
    angleStationOrder: 'atfromto',
    threeReduceMode: false,
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    stationSeparator: '-',
    dataInputEnabled: true,
  }) as ParseOptions;

describe('parseDirectiveState helpers', () => {
  it('applies core directive-state mutations without changing parser-owned control flow', () => {
    const state = createState();
    const logs: string[] = [];
    const transitions: string[] = [];

    const gridResult = applyCoreDirectiveState({
      op: '.GRID',
      parts: ['.GRID', 'DIST=ELLIP', 'ANG'],
      lineNum: 10,
      state,
      logs,
      orderExplicit: false,
      recordDirectiveTransition: (directive) => transitions.push(directive),
    });

    expect(gridResult).toEqual({ handled: true, orderExplicit: false });
    expect(state.gridDistanceMode).toBe('ellipsoidal');
    expect(state.gridAngleMode).toBe('grid');
    expect(state.reductionContext?.explicitOverrideActive).toBe(true);
    expect(transitions).toEqual(['.GRID']);
    expect(logs[0]).toContain('GRID mode updated');

    const orderResult = applyCoreDirectiveState({
      op: '.ORDER',
      parts: ['.ORDER', 'NE', 'FROM-AT-TO'],
      lineNum: 11,
      state,
      logs,
      orderExplicit: gridResult.orderExplicit,
      recordDirectiveTransition: (directive) => transitions.push(directive),
    });

    expect(orderResult).toEqual({ handled: true, orderExplicit: true });
    expect(state.order).toBe('NE');
    expect(state.angleStationOrder).toBe('fromatto');

    const scaleResult = applyCoreDirectiveState({
      op: '.SCALE',
      parts: ['.SCALE', '0.99991'],
      lineNum: 12,
      state,
      logs,
      orderExplicit: orderResult.orderExplicit,
      recordDirectiveTransition: (directive) => transitions.push(directive),
    });

    expect(scaleResult).toEqual({ handled: true, orderExplicit: true });
    expect(state.averageScaleFactor).toBeCloseTo(0.99991);
    expect(state.scaleOverrideActive).toBe(true);
    expect(transitions).toEqual(['.GRID', '.SCALE']);
  });

  it('normalizes legacy observation fields from observationMode when needed', () => {
    const state = createState();
    state.reductionContext = undefined;
    state.observationMode = {
      bearing: 'measured',
      distance: 'grid',
      angle: 'grid',
      direction: 'measured',
    };

    normalizeObservationModeState(state);

    expect(state.gridBearingMode).toBe('measured');
    expect(state.gridDistanceMode).toBe('grid');
    expect(state.gridAngleMode).toBe('grid');
    expect(state.gridDirectionMode).toBe('measured');
    expect(state.reductionContext!.distanceKind).toBe('grid');
    expect(state.reductionContext!.inputSpaceDefault).toBe('grid');
  });

  it('flags directive transitions that never affect any observation range', () => {
    const state = createState();
    const transitions: DirectiveTransition[] = [
      {
        line: 1,
        directive: '.GRID',
        stateAfter: directiveTransitionStateFromParseState(state),
        effectiveFromLine: 1,
        obsCountInRange: 0,
      },
      {
        line: 3,
        directive: '.SCALE',
        stateAfter: directiveTransitionStateFromParseState(state),
        effectiveFromLine: 3,
        obsCountInRange: 0,
      },
      {
        line: 5,
        directive: '.MEASURED',
        stateAfter: directiveTransitionStateFromParseState(state),
        effectiveFromLine: 5,
        obsCountInRange: 0,
      },
    ];

    const warnings = finalizeDirectiveTransitions({
      directiveTransitions: transitions,
      observations: [{ sourceLine: 2 } as Observation],
      lines: [
        { kind: 'line', raw: '.GRID', sourceLine: 1, sourceFile: '<input>' },
        { kind: 'line', raw: 'D A-B 10.0', sourceLine: 2, sourceFile: '<input>' },
        { kind: 'line', raw: '.SCALE 0.99991', sourceLine: 3, sourceFile: '<input>' },
        { kind: 'line', raw: '.UNITS M', sourceLine: 4, sourceFile: '<input>' },
        { kind: 'line', raw: '.MEASURED', sourceLine: 5, sourceFile: '<input>' },
      ],
      splitInlineCommentAndDescription: (line) => ({ line: line.trim() }),
    });

    expect(transitions[0]?.obsCountInRange).toBe(1);
    expect(transitions[1]?.obsCountInRange).toBe(0);
    expect(transitions[2]?.obsCountInRange).toBe(0);
    expect(warnings).toEqual([
      {
        line: 3,
        directive: '.SCALE',
        reason: 'noSubsequentObsRecords',
      },
      {
        line: 5,
        directive: '.MEASURED',
        reason: 'noSubsequentObservations',
      },
    ]);
  });
});
