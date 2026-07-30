import { describe, expect, it } from 'vitest';
import {
  readFileSync,
  parseInput,
} from './parseTestSupport';
import type {
  AngleObservation,
} from './parseTestSupport';

describe('parseInput', () => {
  it('applies strict-vs-legacy numeric-token station handling with coded diagnostics', () => {
    const source = [
      'I TS1 "Demo" 0.001 1 1.0 1.0 0 0',
      'C A 0 0 0 ! ! !',
      'C B 10 0 0',
      'D TS1 100.500 B 12.300 0.01',
    ].join('\n');
    const legacy = parseInput(source, {}, { parseCompatibilityMode: 'legacy' });
    const strict = parseInput(source, {}, { parseCompatibilityMode: 'strict' });
    expect(legacy.observations.filter((obs) => obs.type === 'dist')).toHaveLength(1);
    expect(legacy.parseState.strictRejectCount).toBe(0);
    expect(
      legacy.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'NUMERIC_STATION_TOKEN_REJECTED',
      ),
    ).toBe(true);
    expect(strict.observations.filter((obs) => obs.type === 'dist')).toHaveLength(0);
    expect(strict.parseState.strictRejectCount).toBeGreaterThan(0);
    expect(
      strict.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'NUMERIC_STATION_TOKEN_REJECTED' && diag.severity === 'error',
      ),
    ).toBe(true);
    expect(strict.parseState.rewriteSuggestionCount).toBeGreaterThan(0);
  });

  it('applies strict-vs-legacy unknown-inline handling without legacy policy overrides', () => {
    const source = ['.ZZZZ', 'C A 0 0 0 ! !'].join('\n');
    const legacy = parseInput(source, {}, { parseCompatibilityMode: 'legacy' });
    const strict = parseInput(source, {}, { parseCompatibilityMode: 'strict' });

    expect(legacy.parseState.strictRejectCount).toBe(0);
    expect(
      legacy.parseState.parseCompatibilityDiagnostics?.some(
        (diag) => diag.code === 'STRICT_REJECTED' && diag.severity === 'warning',
      ),
    ).toBe(true);
    expect(legacy.logs.some((line) => line.includes('unknown inline option ".ZZZZ"'))).toBe(true);

    expect(strict.parseState.strictRejectCount).toBeGreaterThan(0);
    expect(
      strict.parseState.parseCompatibilityDiagnostics?.some(
        (diag) =>
          diag.code === 'STRICT_REJECTED' &&
          diag.severity === 'error' &&
          diag.message.includes('unknown inline option ".ZZZZ"'),
      ),
    ).toBe(true);
  });

  it('parses 2D M records with angle/dist sigmas and no vertical observation', () => {
    const parsed = parseInput(
      readFileSync('tests/fixtures/triangulation_trilateration_2d.dat', 'utf-8'),
    );
    const zenCount = parsed.observations.filter((o) => o.type === 'zenith').length;
    const levCount = parsed.observations.filter((o) => o.type === 'lev').length;
    expect(zenCount).toBe(0);
    expect(levCount).toBe(0);

    const mLine = parsed.observations.find(
      (o) =>
        o.type === 'angle' &&
        (o as AngleObservation).at === '3' &&
        (o as AngleObservation).from === '2' &&
        (o as AngleObservation).to === '6',
    );
    expect(mLine).toBeDefined();
    expect(mLine?.stdDev).toBeCloseTo((4.0 * (Math.PI / 180)) / 3600, 12);
  });

  it('reduces 2D slope M distances to horizontal when a zenith is provided', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.DELTA OFF',
        'C 1 0 0 !',
        'C 1000 0 10 !',
        'C 2 20 0',
        'M 1-1000-2 286-51-24.7 22.2574 089-57-23.8',
      ].join('\n'),
    );
    const distObs = parsed.observations.find(
      (o) => o.type === 'dist' && 'from' in o && o.from === '1' && o.to === '2',
    );
    expect(distObs).toBeDefined();
    expect(distObs?.obs).toBeCloseTo(
      22.2574 * Math.sin((89 + 57 / 60 + 23.8 / 3600) * (Math.PI / 180)),
      9,
    );
    expect(parsed.observations.some((o) => o.type === 'zenith')).toBe(false);
  });

  it('accepts hyphenated from-to vertical records in the same way as split tokens', () => {
    const parsed = parseInput(
      [
        '.3D',
        '.DELTA OFF',
        'C 2 0 0 0 ! ! !',
        'C 2000 10 0 0',
        'V 2-2000 279-34-03.2 1.6920/0.0000',
      ].join('\n'),
    );
    const vertical = parsed.observations.find(
      (obs) => obs.type === 'zenith' && 'from' in obs && obs.from === '2' && obs.to === '2000',
    );
    expect(vertical).toBeDefined();
    expect(vertical?.obs ?? Number.NaN).toBeCloseTo(
      ((279 + 34 / 60 + 3.2 / 3600) * Math.PI) / 180,
      12,
    );
  });

  it('supports .ORDER FROMATTO for A/M station triplets', () => {
    const parsed = parseInput(
      [
        '.2D',
        '.ORDER EN FROMATTO',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A B-A-P 090-00-00.0 1.0',
        'M B-A-P 090-00-00.0 100.0',
      ].join('\n'),
    );
    const ang = parsed.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    expect(ang).toBeDefined();
    expect(ang?.at).toBe('A');
    expect(ang?.from).toBe('B');
    expect(ang?.to).toBe('P');
    const dist = parsed.observations.find((o) => o.type === 'dist') as
      | { from: string; to: string }
      | undefined;
    expect(dist?.from).toBe('A');
    expect(dist?.to).toBe('P');
    expect(parsed.parseState.angleStationOrder).toBe('fromatto');
  });

  it('supports .UNITS DD and .UNITS DMS for angle parsing', () => {
    const dd = parseInput(
      [
        '.2D',
        '.UNITS METERS DD',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A A-B-P 90.5 1.0',
      ].join('\n'),
    );
    const dms = parseInput(
      [
        '.2D',
        '.UNITS METERS DMS',
        'C A 0 0 0 !',
        'C B 0 100 0 !',
        'C P 100 0 0',
        'A A-B-P 090-30-00.0 1.0',
      ].join('\n'),
    );
    const ddAng = dd.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    const dmsAng = dms.observations.find((o) => o.type === 'angle') as AngleObservation | undefined;
    expect(ddAng).toBeDefined();
    expect(dmsAng).toBeDefined();
    expect(ddAng?.obs ?? 0).toBeCloseTo((90.5 * Math.PI) / 180, 10);
    expect(dmsAng?.obs ?? 0).toBeCloseTo((90.5 * Math.PI) / 180, 10);
    expect(dd.parseState.angleUnits).toBe('dd');
    expect(dms.parseState.angleUnits).toBe('dms');
  });

  it('supports .AUTOADJUST and /AUTOADJUST command-style options', () => {
    const parsed = parseInput(
      [
        '.AUTOADJUST OFF',
        '/AUTOADJUST ON 3.5 6 2',
        '/AUTOADJUST ON THRESHOLD 4.25 CYCLES 5 MAXREMOVE 1',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A B 100 0.01',
      ].join('\n'),
    );
    expect(parsed.parseState.autoAdjustEnabled).toBe(true);
    expect(parsed.parseState.autoAdjustStdResThreshold).toBeCloseTo(4.25, 10);
    expect(parsed.parseState.autoAdjustMaxCycles).toBe(5);
    expect(parsed.parseState.autoAdjustMaxRemovalsPerCycle).toBe(1);
    expect(parsed.logs.some((l) => l.includes('Auto-adjust set to ON'))).toBe(true);
  });

  it('expands .INCLUDE content from include bundle files and tracks source file traceability', () => {
    const parsed = parseInput(
      ['.UNITS M', '.INCLUDE child/network1.dat', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10'].join(
        '\n',
      ),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/child/network1.dat': 'C X 0 10 0 ! !\nC Y 10 10 0\nD X-Y 10',
        },
      },
    );
    expect(parsed.parseState.includeTrace?.length).toBe(1);
    expect(parsed.parseState.includeTrace?.[0].parentSourceFile).toBe('main/project.dat');
    expect(parsed.parseState.includeTrace?.[0].sourceFile).toBe('main/child/network1.dat');
    const fromInclude = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'X' && obs.to === 'Y',
    );
    expect(fromInclude?.sourceFile).toBe('main/child/network1.dat');
  });

  it('restores parent parse-state after include scope exits', () => {
    const parsed = parseInput(
      ['.UNITS FT', '.INCLUDE child/set.dat', 'C A 0 0 0 ! !', 'C B 10 0 0', 'D A-B 10'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/child/set.dat': '.UNITS M\nC X 0 10 0 ! !\nC Y 10 10 0\nD X-Y 10',
        },
      },
    );
    const includeDist = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'X' && obs.to === 'Y',
    );
    const parentDist = parsed.observations.find(
      (obs) => 'from' in obs && 'to' in obs && obs.from === 'A' && obs.to === 'B',
    );
    expect(includeDist?.obs).toBeCloseTo(10, 8);
    expect(parentDist?.obs).toBeCloseTo(10 / 3.280839895, 8);
    expect(parsed.parseState.units).toBe('ft');
  });

  it('captures include errors for missing include files', () => {
    const parsed = parseInput(
      ['.INCLUDE field/does-not-exist.dat', 'C A 0 0 0 ! !'].join('\n'),
      {},
      { sourceFile: 'main/project.dat', includeFiles: {} },
    );
    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-not-found');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/project.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
  });

  it('resolves nested include relative paths in bundle mode and preserves include order', () => {
    const parsed = parseInput(
      ['.INCLUDE section/first.dat', '.INCLUDE section/second.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/section/first.dat':
            'C F1 0 10 0 ! !\n.INCLUDE ../shared/grand.dat\nC F2 10 10 0\nD F1-F2 10',
          'main/shared/grand.dat': 'C G1 0 20 0 ! !\nC G2 10 20 0\nD G1-G2 10',
          'main/section/second.dat': 'C S1 0 30 0 ! !\nC S2 10 30 0\nD S1-S2 10',
        },
      },
    );

    expect(parsed.parseState.includeErrors).toEqual([]);
    expect(parsed.parseState.includeTrace).toEqual([
      {
        parentSourceFile: 'main/project.dat',
        sourceFile: 'main/section/first.dat',
        line: 1,
      },
      {
        parentSourceFile: 'main/section/first.dat',
        sourceFile: 'main/shared/grand.dat',
        line: 2,
      },
      {
        parentSourceFile: 'main/project.dat',
        sourceFile: 'main/section/second.dat',
        line: 2,
      },
    ]);

    const findDistIndex = (from: string, to: string): number =>
      parsed.observations.findIndex(
        (obs) =>
          obs.type === 'dist' && 'from' in obs && 'to' in obs && obs.from === from && obs.to === to,
      );
    const nestedDistIndex = findDistIndex('G1', 'G2');
    const firstDistIndex = findDistIndex('F1', 'F2');
    const secondDistIndex = findDistIndex('S1', 'S2');
    expect(nestedDistIndex).toBeGreaterThan(-1);
    expect(firstDistIndex).toBeGreaterThan(-1);
    expect(secondDistIndex).toBeGreaterThan(-1);
    expect(nestedDistIndex).toBeLessThan(firstDistIndex);
    expect(firstDistIndex).toBeLessThan(secondDistIndex);
  });

  it('captures include cycle errors with exact source file and line diagnostics', () => {
    const parsed = parseInput(
      ['.INCLUDE a.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeFiles: {
          'main/a.dat': '.INCLUDE b.dat\nC A 0 10 0 ! !',
          'main/b.dat': '.INCLUDE a.dat\nC B 10 10 0',
        },
      },
    );

    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-cycle');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/b.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].includePath).toBe('a.dat');
    expect(parsed.parseState.includeErrors?.[0].stack).toEqual([
      'main/project.dat',
      'main/a.dat',
      'main/b.dat',
      'main/a.dat',
    ]);
  });

  it('captures include depth-exceeded errors with exact source file and line diagnostics', () => {
    const parsed = parseInput(
      ['.INCLUDE a.dat', 'C ROOT 0 0 0 ! !'].join('\n'),
      {},
      {
        sourceFile: 'main/project.dat',
        includeMaxDepth: 2,
        includeFiles: {
          'main/a.dat': '.INCLUDE b.dat\nC A 0 10 0 ! !',
          'main/b.dat': 'C B 10 10 0',
        },
      },
    );

    expect(parsed.parseState.includeErrors?.length).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].code).toBe('include-depth-exceeded');
    expect(parsed.parseState.includeErrors?.[0].sourceFile).toBe('main/a.dat');
    expect(parsed.parseState.includeErrors?.[0].line).toBe(1);
    expect(parsed.parseState.includeErrors?.[0].includePath).toBe('b.dat');
    expect(parsed.parseState.includeErrors?.[0].message).toContain('limit=2');
  });

});
