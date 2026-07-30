import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  parseInput,
} from './parseTestSupport';
import type {
  AngleObservation,
} from './parseTestSupport';

describe('parseInput', () => {
  it('parses .GPS CHECK toggle state with OFF-by-default behavior', () => {
    const base = parseInput(['C A 0 0 0 !', 'C B 100 0 0', 'G GPS1 A B 100 0 0.01'].join('\n'));
    expect(base.parseState.gpsLoopCheckEnabled ?? false).toBe(false);

    const parsed = parseInput(
      [
        '.GPS CHECK',
        '/GPS CHECK OFF',
        '.GPS CHECK ON',
        '.GPS CHECK nope',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.gpsLoopCheckEnabled ?? false).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS loop check set to ON'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('GPS loop check set to OFF'))).toBe(true);
    expect(parsed.logs.some((l) => l.includes('invalid .GPS CHECK option'))).toBe(true);
  });

  it('does not auto-create GPS SIDESHOT target stations while NETWORK mode still does', () => {
    const network = parseInput(
      ['.GPS NETWORK', 'C OCC 0 0 0 !', 'G GPS1 OCC TARGET 10 20 0.01 0.02'].join('\n'),
    );
    const sideshot = parseInput(
      ['.GPS SIDESHOT', 'C OCC 0 0 0 !', 'G GPS1 OCC TARGET 10 20 0.01 0.02'].join('\n'),
    );
    expect(network.stations.TARGET).toBeDefined();
    expect(sideshot.stations.TARGET).toBeUndefined();
    expect(network.logs.some((l) => l.includes('Auto-created station TARGET'))).toBe(true);
    expect(sideshot.logs.some((l) => l.includes('Auto-created station TARGET'))).toBe(false);
  });

  it('parses phase-3 reduction directives', () => {
    const parsed = parseInput(
      [
        '.MAPMODE ANGLECALC',
        '.MAPSCALE 0.9996',
        '.CURVREF ON',
        '.REFRACTION 0.14',
        '.VRED CURVREF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.mapMode).toBe('anglecalc');
    expect(parsed.parseState.mapScaleFactor).toBeCloseTo(0.9996, 8);
    expect(parsed.parseState.applyCurvatureRefraction).toBe(true);
    expect(parsed.parseState.refractionCoefficient).toBeCloseTo(0.14, 8);
    expect(parsed.parseState.verticalReduction).toBe('curvref');
  });

  it('parses TS correlation directives', () => {
    const parsed = parseInput(
      ['.TSCORR SETUP 0.35', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(parsed.parseState.tsCorrelationEnabled).toBe(true);
    expect(parsed.parseState.tsCorrelationScope).toBe('setup');
    expect(parsed.parseState.tsCorrelationRho).toBeCloseTo(0.35, 8);

    const off = parseInput(
      ['.TSCORR OFF', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(off.parseState.tsCorrelationEnabled).toBe(false);
  });

  it('parses robust directives', () => {
    const parsed = parseInput(
      ['.ROBUST HUBER 1.8', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(parsed.parseState.robustMode).toBe('huber');
    expect(parsed.parseState.robustK).toBeCloseTo(1.8, 8);

    const off = parseInput(
      ['.ROBUST OFF', 'C A 0 0 0 !', 'C B 100 0 0', 'D A-B 100 0.01'].join('\n'),
    );
    expect(off.parseState.robustMode).toBe('none');
  });

  it('parses sideshot with explicit azimuth token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH AZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist).toBeDefined();
    expect(typeof ssDist?.calc).toBe('object');
    expect((ssDist?.calc as { azimuthObs?: number })?.azimuthObs).toBeDefined();
  });

  it('parses sideshot with setup horizontal angle token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH HZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist).toBeDefined();
    expect(typeof ssDist?.calc).toBe('object');
    expect((ssDist?.calc as { hzObs?: number })?.hzObs).toBeDefined();
    expect((ssDist?.calc as { backsightId?: string })?.backsightId).toBe('BS');
  });

  it('parses sideshot station-token shorthand SS at-from-to with setup-angle default and HI/HT', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC-BS-SH 090-00-00.0 10.0 90.0 1.7000/1.5720',
      ].join('\n'),
    );
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    const ssZen = parsed.observations.find(
      (o) => o.type === 'zenith' && o.from === 'OCC' && o.to === 'SH',
    );
    expect(ssDist?.type).toBe('dist');
    if (ssDist?.type === 'dist') {
      expect(ssDist.from).toBe('OCC');
      expect(ssDist.to).toBe('SH');
      expect((ssDist.calc as { hzObs?: number })?.hzObs).toBeDefined();
      expect((ssDist.calc as { backsightId?: string })?.backsightId).toBe('BS');
      expect(ssDist.hi).toBeCloseTo(1.7, 8);
      expect(ssDist.ht).toBeCloseTo(1.572, 8);
    }
    expect(ssZen?.type).toBe('zenith');
    if (ssZen?.type === 'zenith') {
      expect(ssZen.hi).toBeCloseTo(1.7, 8);
      expect(ssZen.ht).toBeCloseTo(1.572, 8);
    }
  });

  it('parses sideshot station-token shorthand SS at-to with azimuth default', () => {
    const parsed = parseInput(['C OCC 0 0 0 !', 'SS OCC-SH 090-00-00.0 10.0 90.0'].join('\n'));
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS');
    expect(ssDist?.type).toBe('dist');
    if (ssDist?.type === 'dist') {
      const calc = ssDist.calc as { azimuthObs?: number; hzObs?: number };
      expect(calc.azimuthObs).toBeDefined();
      expect(calc.hzObs).toBeUndefined();
    }
  });

  it('parses GS coordinate shots honoring .ORDER coordinate and sigma mapping', () => {
    const parsed = parseInput(
      ['.ORDER NE', 'C OCC 0 0 0 ! !', 'GS RTK1 200.0 100.0 0.020 0.030 FROM=OCC'].join('\n'),
    );
    const shots = parsed.parseState.gpsTopoShots ?? [];
    expect(shots).toHaveLength(1);
    expect(shots[0].pointId).toBe('RTK1');
    expect(shots[0].east).toBeCloseTo(100, 8);
    expect(shots[0].north).toBeCloseTo(200, 8);
    expect(shots[0].sigmaE).toBeCloseTo(0.03, 8);
    expect(shots[0].sigmaN).toBeCloseTo(0.02, 8);
    expect(shots[0].fromId).toBe('OCC');
  });

  it('applies explicit .ALIAS mappings to station and observation IDs', () => {
    const parsed = parseInput(
      ['.2D', '.ALIAS P1=A1 Q1=B1', 'C A1 0 0 0 !', 'C B1 100 0 0 !', 'D P1-Q1 100 0.01'].join(
        '\n',
      ),
    );
    const dist = parsed.observations.find((o) => o.type === 'dist');
    expect(dist).toBeDefined();
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('A1');
      expect(dist.to).toBe('B1');
    }
    expect(parsed.stations.P1).toBeUndefined();
    expect(parsed.stations.Q1).toBeUndefined();
    expect(parsed.stations.A1).toBeDefined();
    expect(parsed.stations.B1).toBeDefined();
    expect(parsed.parseState.aliasExplicitCount).toBe(2);
    expect(parsed.parseState.aliasRuleCount).toBe(0);
    expect(
      parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`),
    ).toEqual(['P1->A1', 'Q1->B1']);
    expect(
      parsed.parseState.aliasTrace?.some((t) => t.context === 'observation' && t.sourceLine === 5),
    ).toBe(true);
    expect(parsed.logs.some((l) => l.includes('Alias canonicalization applied'))).toBe(true);
  });

  it('applies .ALIAS prefix/suffix/additive rules to canonical IDs', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.ALIAS PREFIX RAW_ SURV_',
        '.ALIAS SUFFIX _OLD _NEW',
        '.ALIAS ADDITIVE 100',
        'C SURV_1_NEW 0 0 0 !',
        'C 105 100 0 0 !',
        'D RAW_1_OLD-5 100 0.01',
      ].join('\n'),
    );
    const dist = parsed.observations.find((o) => o.type === 'dist');
    expect(dist).toBeDefined();
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('SURV_1_NEW');
      expect(dist.to).toBe('105');
    }
    expect(parsed.stations.RAW_1_OLD).toBeUndefined();
    expect(parsed.stations['5']).toBeUndefined();
    expect(parsed.stations.SURV_1_NEW).toBeDefined();
    expect(parsed.stations['105']).toBeDefined();
    expect(parsed.parseState.aliasExplicitCount).toBe(0);
    expect(parsed.parseState.aliasRuleCount).toBe(3);
    expect(parsed.parseState.aliasRuleSummaries?.map((r) => r.rule)).toEqual([
      'PREFIX RAW_ SURV_',
      'SUFFIX _OLD _NEW',
      'ADDITIVE 100',
    ]);
    expect(
      parsed.parseState.aliasTrace?.some(
        (t) => t.sourceLine === 7 && t.sourceId === 'RAW_1_OLD' && t.canonicalId === 'SURV_1_NEW',
      ),
    ).toBe(true);
    expect(
      parsed.parseState.aliasTrace?.some(
        (t) => t.sourceLine === 7 && t.sourceId === '5' && t.canonicalId === '105',
      ),
    ).toBe(true);
  });

  it('tracks mixed conventional/GNSS/leveling alias traceability across input sections', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/alias_phase4_mixed.dat', 'utf-8'));
    expect(parsed.parseState.aliasExplicitCount).toBe(2);
    expect(parsed.parseState.aliasRuleCount).toBe(1);
    expect(
      parsed.parseState.aliasExplicitMappings?.map((m) => `${m.sourceId}->${m.canonicalId}`),
    ).toEqual(['ROVER1->PT_100', 'STA01->STA_1']);
    expect(parsed.parseState.aliasRuleSummaries?.map((r) => r.rule)).toEqual(['PREFIX TMP_ PT_']);

    expect(parsed.stations.PT_100).toBeDefined();
    expect(parsed.stations.TMP_100).toBeUndefined();
    expect(parsed.stations.ROVER1).toBeUndefined();
    expect(parsed.stations.STA01).toBeUndefined();

    const dist = parsed.observations.find((o) => o.type === 'dist');
    const angle = parsed.observations.find((o) => o.type === 'angle') as
      | AngleObservation
      | undefined;
    const gps = parsed.observations.find((o) => o.type === 'gps');
    const lev = parsed.observations.find((o) => o.type === 'lev');
    expect(dist?.type).toBe('dist');
    if (dist?.type === 'dist') {
      expect(dist.from).toBe('CTRL_B');
      expect(dist.to).toBe('PT_100');
    }
    expect(angle?.to).toBe('PT_100');
    expect(gps?.type).toBe('gps');
    if (gps?.type === 'gps') {
      expect(gps.from).toBe('CTRL_A');
      expect(gps.to).toBe('PT_100');
    }
    expect(lev?.type).toBe('lev');
    if (lev?.type === 'lev') {
      expect(lev.from).toBe('STA_1');
      expect(lev.to).toBe('PT_100');
    }

    const trace = parsed.parseState.aliasTrace ?? [];
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 10)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 11)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 12)).toBe(true);
    expect(trace.some((t) => t.context === 'observation' && t.sourceLine === 13)).toBe(true);
    expect(trace.some((t) => t.context === 'station' && t.sourceId === 'TMP_100')).toBe(true);
  });

  it('scans repeated station descriptions and reports consistent repeats', () => {
    const parsed = parseInput(
      [
        "C A 0 0 0 ! ! ! 'CONTROL POINT A",
        "E A 100.0 0.01 ! 'CONTROL POINT A",
        'D A-B 100.0 0.01',
      ].join('\n'),
    );
    const summary = parsed.parseState.descriptionScanSummary ?? [];
    expect(parsed.parseState.descriptionTrace).toHaveLength(2);
    expect(parsed.parseState.descriptionRepeatedStationCount).toBe(1);
    expect(parsed.parseState.descriptionConflictCount).toBe(0);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      stationId: 'A',
      recordCount: 2,
      uniqueCount: 1,
      conflict: false,
      descriptions: ['CONTROL POINT A'],
    });
    expect(parsed.parseState.descriptionReconcileMode).toBe('first');
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('CONTROL POINT A');
    expect(parsed.logs.some((line) => line.includes('Description scan:'))).toBe(true);
  });

  it('groups description scan rows by canonical station id and flags conflicts', () => {
    const parsed = parseInput(
      [
        '.ALIAS LEGACY_A=A',
        "C A 0 0 0 ! ! ! 'Alpha",
        "E A 100.0 0.01 ! 'ALPHA",
        "C LEGACY_A 0 0 0 ! ! ! 'Legacy Alpha",
        "E A 100.0 0.01 ! 'Beta",
      ].join('\n'),
    );
    const trace = parsed.parseState.descriptionTrace ?? [];
    const summary = parsed.parseState.descriptionScanSummary ?? [];
    expect(trace).toHaveLength(4);
    expect(trace.every((row) => row.stationId === 'A')).toBe(true);
    expect(parsed.parseState.descriptionRepeatedStationCount).toBe(1);
    expect(parsed.parseState.descriptionConflictCount).toBe(1);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      stationId: 'A',
      recordCount: 4,
      uniqueCount: 3,
      conflict: true,
      descriptions: ['Alpha', 'Legacy Alpha', 'Beta'],
    });
    expect(parsed.parseState.reconciledDescriptions?.A).toBe('Alpha');
    expect(parsed.logs.some((line) => line.includes('Description conflict A'))).toBe(true);
  });

});
