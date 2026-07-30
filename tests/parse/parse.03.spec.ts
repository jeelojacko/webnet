import { describe, expect, it } from 'vitest';
import {
  parseInput,
} from './parseTestSupport';
import type {
  AngleObservation,
  DistanceObservation,
} from './parseTestSupport';

describe('parseInput', () => {
  it('parses planned observation placeholders when preanalysis mode is enabled', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'D A-P ? 0.01',
        'A P-A-B ? 1.0',
        'B A-P ? 2.0',
        'L LV A P ? 0.10 2.0',
      ].join('\n'),
      {},
      { preanalysisMode: true },
    );

    expect(parsed.parseState.preanalysisMode).toBe(true);
    expect(parsed.parseState.plannedObservationCount).toBe(4);
    expect(parsed.logs.some((l) => l.includes('Preanalysis parsing: mode=ON'))).toBe(true);
    expect(parsed.observations.every((obs) => obs.planned === true)).toBe(true);

    const dist = parsed.observations.find((obs) => obs.type === 'dist') as
      | DistanceObservation
      | undefined;
    const angle = parsed.observations.find((obs) => obs.type === 'angle') as
      | AngleObservation
      | undefined;
    expect(dist?.obs ?? Number.NaN).toBe(0);
    expect(angle?.obs ?? Number.NaN).toBe(0);
  });

  it('treats missing D and A observation values as planned rows in preanalysis mode', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C 1 51002 101009 ! !',
        'C 2 51005 101343',
        'C 3 51328 101291',
        'C 4 51416 101073',
        'D 1-2',
        'D 2-3',
        'D 3-4',
        'D 4-1',
        'D 1-3',
        'A 2-1-3',
        'A 3-2-4',
        'A 4-3-1',
        'A 1-4-2',
        'A 1-4-3',
        'B 1-2 ? !',
      ].join('\n'),
      {},
      { preanalysisMode: true, coordMode: '2D' },
    );

    expect(parsed.parseState.preanalysisMode).toBe(true);
    expect(parsed.parseState.plannedObservationCount).toBe(11);
    expect(parsed.observations.filter((obs) => obs.type === 'dist')).toHaveLength(5);
    expect(parsed.observations.filter((obs) => obs.type === 'angle')).toHaveLength(5);
    expect(parsed.observations.filter((obs) => obs.type === 'bearing')).toHaveLength(1);
    expect(parsed.observations.every((obs) => obs.planned === true)).toBe(true);
  });

  it('treats missing DB/DM direction-set values as planned rows in preanalysis mode', () => {
    const parsed = parseInput(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'DB A B',
        'DM P',
        'DE',
      ].join('\n'),
      {},
      { preanalysisMode: true, coordMode: '2D' },
    );

    expect(parsed.parseState.preanalysisMode).toBe(true);
    expect(parsed.parseState.plannedObservationCount).toBe(3);
    expect(parsed.observations.filter((obs) => obs.type === 'direction')).toHaveLength(1);
    expect(parsed.observations.filter((obs) => obs.type === 'dist')).toHaveLength(1);
    expect(parsed.observations.filter((obs) => obs.type === 'zenith')).toHaveLength(1);
    expect(parsed.observations.every((obs) => obs.planned === true)).toBe(true);
  });

  it('keeps CRS transforms disabled by default and parses .CRS state directives', () => {
    const base = parseInput(
      ['.UNITS METERS DD', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join('\n'),
    );
    expect(base.parseState.crsTransformEnabled).toBe(false);
    expect(base.parseState.crsProjectionModel).toBe('legacy-equirectangular');

    const enabled = parseInput(
      ['.UNITS METERS DD', '.CRS ON ENU Site-Grid', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join(
        '\n',
      ),
    );
    expect(enabled.parseState.crsTransformEnabled).toBe(true);
    expect(enabled.parseState.crsProjectionModel).toBe('local-enu');
    expect(enabled.parseState.crsLabel).toBe('Site-Grid');
    expect(enabled.logs.some((l) => l.includes('CRS transforms set to ON'))).toBe(true);

    const off = parseInput(
      ['.UNITS METERS DD', '.CRS ON ENU', '.CRS OFF', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join(
        '\n',
      ),
    );
    expect(off.parseState.crsTransformEnabled).toBe(false);
    expect(off.logs.some((l) => l.includes('CRS transforms set to OFF'))).toBe(true);
  });

  it('applies ENU projection only when CRS transforms are explicitly enabled', () => {
    const source = ['.UNITS METERS DD', 'P ORG 40 105 0 ! !', 'P TGT 41 106 0'].join('\n');
    const legacy = parseInput(source);
    const explicitLegacy = parseInput(['.CRS ON LEGACY', source].join('\n'));
    const enu = parseInput(['.CRS ON ENU', source].join('\n'));

    expect(explicitLegacy.stations.TGT.x).toBeCloseTo(legacy.stations.TGT.x, 8);
    expect(explicitLegacy.stations.TGT.y).toBeCloseTo(legacy.stations.TGT.y, 8);

    const deltaE = Math.abs((enu.stations.TGT.x ?? 0) - (legacy.stations.TGT.x ?? 0));
    const deltaN = Math.abs((enu.stations.TGT.y ?? 0) - (legacy.stations.TGT.y ?? 0));
    expect(deltaE).toBeGreaterThan(10);
    expect(deltaN).toBeGreaterThan(10);
  });

  it('parses .SCALE and grid/measured observation mode directives', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.SCALE 0.99995000',
        '.GRID BEARING DISTANCE=ELLIPSOIDAL ANGLE DIRECTION',
        '.MEASURED DIRECTION',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C C 100 100 0',
        'B A-B 090.000000 1.0',
        'D A-C 141.421356 0.01',
        'A B-A-C 090.000000 1.0',
      ].join('\n'),
    );
    expect(parsed.parseState.averageScaleFactor).toBeCloseTo(0.99995, 10);
    expect(parsed.parseState.scaleOverrideActive).toBe(true);
    expect(parsed.parseState.gridBearingMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('ellipsoidal');
    expect(parsed.parseState.gridAngleMode).toBe('grid');
    expect(parsed.parseState.gridDirectionMode).toBe('measured');
    expect(parsed.parseState.reductionContext).toEqual({
      inputSpaceDefault: 'grid',
      distanceKind: 'ellipsoidal',
      bearingKind: 'grid',
      explicitOverrideActive: true,
    });
    expect(parsed.parseState.observationMode).toEqual({
      bearing: 'grid',
      distance: 'ellipsoidal',
      angle: 'grid',
      direction: 'measured',
    });

    const bearing = parsed.observations.find((o) => o.type === 'bearing');
    const dist = parsed.observations.find((o) => o.type === 'dist');
    const angle = parsed.observations.find((o) => o.type === 'angle');
    expect(bearing?.gridObsMode).toBe('grid');
    expect(dist?.gridObsMode).toBe('grid');
    expect(dist?.gridDistanceMode).toBe('ellipsoidal');
    expect(dist?.inputSpace).toBe('grid');
    expect(dist?.distanceKind).toBe('ellipsoidal');
    expect(angle?.gridObsMode).toBe('grid');
  });

  it('supports .GRID OFF reset semantics for observation mode defaults', () => {
    const parsed = parseInput(
      [
        '.GRID BEARING DISTANCE=ELLIPSOIDAL ANGLE DIRECTION',
        '.GRID OFF',
        'C A 0 0 0 ! !',
        'C B 10 0 0',
        'D A-B 10 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.gridBearingMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('measured');
    expect(parsed.parseState.gridAngleMode).toBe('measured');
    expect(parsed.parseState.gridDirectionMode).toBe('measured');
    expect(parsed.parseState.observationMode).toEqual({
      bearing: 'grid',
      distance: 'measured',
      angle: 'measured',
      direction: 'measured',
    });
    expect(parsed.logs.some((line) => line.includes('mode reset to defaults'))).toBe(true);
  });

  it('tracks directive ranges and no-effect warnings for trailing directives', () => {
    const parsed = parseInput(
      ['.2D', '.GRID', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10 0.01', '.MEASURED'].join('\n'),
    );
    const dist = parsed.observations.find((obs) => obs.type === 'dist');
    expect(dist?.gridDistanceMode).toBe('grid');
    expect(parsed.parseState.gridDistanceMode).toBe('measured');
    expect(parsed.parseState.directiveTransitions?.length).toBe(2);
    expect(parsed.parseState.directiveTransitions?.[0].obsCountInRange).toBe(1);
    expect(parsed.parseState.directiveTransitions?.[1].obsCountInRange).toBe(0);
    expect(parsed.parseState.directiveNoEffectWarnings).toEqual([
      {
        line: 6,
        directive: '.MEASURED',
        reason: 'noSubsequentObservations',
      },
    ]);
    expect(parsed.parseState.parsedUsageSummary?.distance.grid).toBe(1);
    expect(parsed.parseState.parsedUsageSummary?.total).toBe(1);
  });

  it('warns when directives are followed by non-observation records only', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.GRID',
        'C A 0 0 0 ! !',
        'C B 10 0 0',
        'D A-B 10 0.01',
        '.MEASURED',
        'C C 20 0 0',
      ].join('\n'),
    );
    const warning = parsed.parseState.directiveNoEffectWarnings?.[0];
    expect(warning).toBeDefined();
    expect(warning?.reason).toBe('noSubsequentObsRecords');
  });

});
