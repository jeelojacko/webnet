import { describe, expect, it } from 'vitest';

import { dispatchParseDirective } from '../src/engine/parseDirectiveRegistry';
import type { ParseOptions, StationMap } from '../src/types';

const FT_PER_M = 3.280839895;

const splitCommaTokens = (tokens: string[], trimSegments: boolean): string[] => {
  const expanded: string[] = [];
  tokens.forEach((token) => {
    let start = 0;
    for (let i = 0; i <= token.length; i += 1) {
      if (i === token.length || token.charCodeAt(i) === 44) {
        const segment = token.slice(start, i);
        const normalized = trimSegments ? segment.trim() : segment;
        if (normalized.length > 0) expanded.push(normalized);
        start = i + 1;
      }
    }
  });
  return expanded;
};

const parseAngleTokenRad = (
  token: string | undefined,
  state: ParseOptions,
  fallbackMode: 'dms' | 'dd' = 'dms',
): number => {
  if (!token) return Number.NaN;
  const trimmed = token.trim();
  if (!trimmed) return Number.NaN;
  if (trimmed.includes('-')) {
    const parts = trimmed.split('-').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
    const [deg = 0, min = 0, sec = 0] = parts;
    return (deg + min / 60 + sec / 3600) * (Math.PI / 180);
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return Number.NaN;
  const mode = state.angleUnits ?? fallbackMode;
  return mode === 'dd' ? parsed * (Math.PI / 180) : (parsed * Math.PI) / 180;
};

const parseLinearMetersToken = (
  token: string | undefined,
  units: ParseOptions['units'],
): number | null => {
  if (!token) return null;
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return null;
  return units === 'ft' ? parsed / FT_PER_M : parsed;
};

const wrapTo2Pi = (value: number): number => {
  let wrapped = value % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped;
};

const createState = (overrides: Partial<ParseOptions> = {}): ParseOptions =>
  ({
    units: 'm',
    angleUnits: 'dd',
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    reductionContext: {
      inputSpaceDefault: 'measured',
      distanceKind: 'ground',
      bearingKind: 'grid',
      explicitOverrideActive: false,
    },
    averageScaleFactor: 1,
    scaleOverrideActive: false,
    coordSystemMode: 'local',
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    qFixLinearSigmaM: 0.000001,
    qFixAngularSigmaSec: 0.5,
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    stationSeparator: '-',
    dataInputEnabled: true,
    ...overrides,
  }) as ParseOptions;

const createHarness = (stateOverrides: Partial<ParseOptions> = {}) => {
  const logs: string[] = [];
  const transitions: string[] = [];
  const aliasDirectiveCalls: string[][] = [];
  const flushedReasons: string[] = [];
  const compatibilityAcceptedNoOps = new Set<string>();
  const lostStationIds = new Set<string>();
  const stations: StationMap = {};
  const state = createState(stateOverrides);

  const dispatch = (op: string, parts: string[], lineNum = 10) =>
    dispatchParseDirective({
      op,
      parts,
      lineNum,
      state,
      logs,
      orderExplicit: false,
      recordDirectiveTransition: (directive) => {
        transitions.push(directive);
      },
      linearToMetersFactor: () => (state.units === 'ft' ? 1 / FT_PER_M : 1),
      parseAngleTokenRad,
      parseLinearMetersToken,
      wrapTo2Pi,
      splitCommaTokens,
      aliasPipeline: {
        handleAliasDirective: (args) => {
          aliasDirectiveCalls.push(args);
        },
      },
      compatibilityAcceptedNoOps,
      lostStationIds,
      stations,
      defaultDescriptionReconcileMode: 'first',
      defaultDescriptionAppendDelimiter: ' | ',
      flushDirectionSet: (reason) => {
        flushedReasons.push(reason);
      },
    });

  return {
    aliasDirectiveCalls,
    compatibilityAcceptedNoOps,
    dispatch,
    flushedReasons,
    logs,
    lostStationIds,
    state,
    stations,
    transitions,
  };
};

describe('parseDirectiveRegistry', () => {
  it('routes core directives through the shared dispatcher entrypoint', () => {
    const { dispatch, state, transitions } = createHarness();

    const result = dispatch('.SCALE', ['.SCALE', '0.99995000'], 14);

    expect(result.handled).toBe(true);
    expect(result.orderExplicit).toBe(false);
    expect(state.averageScaleFactor).toBeCloseTo(0.99995);
    expect(state.scaleOverrideActive).toBe(true);
    expect(state.reductionContext?.explicitOverrideActive).toBe(true);
    expect(transitions).toEqual(['.SCALE']);
  });

  it('deduplicates compatibility no-op directives while still treating them as handled', () => {
    const { compatibilityAcceptedNoOps, dispatch, logs } = createHarness();

    expect(dispatch('.ELLIPSE', ['.ELLIPSE'], 20).handled).toBe(true);
    expect(dispatch('.ELLIPSE', ['.ELLIPSE'], 21).handled).toBe(true);

    expect(compatibilityAcceptedNoOps.has('.ELLIPSE')).toBe(true);
    expect(logs.filter((entry) => entry.includes('Compatibility: .ELLIPSE accepted'))).toHaveLength(1);
  });

  it('returns stopParse for .END and flushes any active direction set through the callback', () => {
    const { dispatch, flushedReasons, logs } = createHarness();

    const result = dispatch('.END', ['.END'], 42);

    expect(result).toMatchObject({
      handled: true,
      orderExplicit: false,
      stopParse: true,
    });
    expect(flushedReasons).toEqual(['.END']);
    expect(logs).toContain('END encountered; stopping parse');
  });

  it('treats .INST as an instrument-selection directive and flushes the active set scope', () => {
    const { dispatch, flushedReasons, logs, state } = createHarness();

    const result = dispatch('.INST', ['.INST', 'SX12'], 27);

    expect(result.handled).toBe(true);
    expect(flushedReasons).toEqual(['.INST']);
    expect(state.currentInstrument).toBe('SX12');
    expect(logs).toContain('Current instrument set to SX12');
  });

  it('delegates alias directives through the alias pipeline handler', () => {
    const { aliasDirectiveCalls, dispatch } = createHarness();

    const result = dispatch('.ALIAS', ['.ALIAS', 'P1=A1', 'P2=A2'], 33);

    expect(result.handled).toBe(true);
    expect(aliasDirectiveCalls).toEqual([['P1=A1', 'P2=A2']]);
  });
});
