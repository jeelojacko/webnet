/**
 * Phase 12I.1 — free-network multifile composition + persistence + report
 * tests (agent tier, synthetic fixtures only).
 *
 * Datum classification happens at adjust time, hence AFTER source
 * composition + project control overrides (never per-source).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import {
  buildGnssBaselineReport,
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
} from '../../src/engine/gnssBaselineReport';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  buildGnssMultifileJsonExport,
  deserializeGnssMultifilePersisted,
  emptyGnssMultifilePersisted,
  runGnssMultifileProjectSolve,
  serializeGnssMultifilePersisted,
} from '../../src/engine/gnssMultifileProject';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
const COORDS: Record<string, [number, number, number]> = {
  A: [4000000, 1000000, 4800000],
  B: [4000100, 1000050, 4800020],
  C: [4000200, 999950, 4800100],
  D: [4000300, 1000150, 4800050],
  E: [4000400, 999900, 4800200],
  F: [4000500, 1000250, 4800150],
};

const nativeText = (
  stations: Array<{ id: string; fixed?: boolean }>,
  baselines: Array<{ from: string; to: string; noise?: number; id?: string }>,
): string => {
  const coordOf = (id: string): [number, number, number] =>
    COORDS[id] ?? [4000600, 1000600, 4800600];
  const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
  stations.forEach((s) => {
    const c = coordOf(s.id);
    lines.push(`GX ${s.id} ${c[0]} ${c[1]} ${c[2]} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const from = coordOf(b.from);
    const to = coordOf(b.to);
    const j = (b.noise ?? 0) * 0.001;
    lines.push(`BL ${b.from} ${b.to} ${to[0] - from[0] + j} ${to[1] - from[1] - j} ${to[2] - from[2] + j} ID ${b.id ?? `B${i + 1}`} SESSION S1`);
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const entry = (id: string, name: string, order: number): ProjectManifestFileEntry => ({
  id,
  name,
  kind: 'dat',
  path: `data/${id}-${name}`,
  enabled: true,
  order,
});

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('classification after composition + overrides', () => {
  // Two sources compose one free triangle (A-B-C); second file spans the
  // D-E-F triangle sharing no control: two free components.
  const part1 = nativeText(
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
  );
  const part2 = nativeText(
    [{ id: 'D' }, { id: 'E' }, { id: 'F' }],
    [{ from: 'D', to: 'E', noise: 4 }, { from: 'E', to: 'F', noise: 5 }, { from: 'F', to: 'D', noise: 6 }],
  );
  const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
  const texts = { f1: part1, f2: part2 };

  it('composed free network solves allow-free (datum decided post-compose)', () => {
    const output = runGnssMultifileProjectSolve(files, texts, { datumMode: 'allow-free' });
    expect(output.result.datumSummary?.kind).toBe('free');
    expect(output.result.datumSummary?.components).toHaveLength(2);
    expect(output.result.dof).toBe(18 - 12);
    expect(output.input.datumMode).toBe('allow-free');
  });

  it('default (constrained) multifile run still fails closed on the free compose', () => {
    expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/free-network adjustment is deferred/);
  });

  it('override fixing one station after composition: still mixed, not constrained', () => {
    const output = runGnssMultifileProjectSolve(files, texts, {
      datumMode: 'allow-free',
      controlOverrides: { A: true },
    });
    expect(output.result.datumSummary?.kind).toBe('mixed');
    const kinds = new Map(
      (output.result.datumSummary?.components ?? []).map((c) => [c.stations[0], c.kind]),
    );
    expect(kinds.get('A')).toBe('constrained');
    expect(kinds.get('D')).toBe('free');
  });

  it('overrides both directions: fixing one anchor per component returns to the constrained path', () => {
    const output = runGnssMultifileProjectSolve(files, texts, {
      datumMode: 'allow-free',
      controlOverrides: { A: true, D: true },
    });
    expect(output.result.datumSummary).toBeUndefined();
    expect(output.result.routeProvenance).toBe('typescript-dense');
    // And freeing a composed control station flips constrained -> free.
    const whole = nativeText(
      [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
    );
    const single = [entry('f1', 'p1.dat', 0)];
    const held = runGnssMultifileProjectSolve(single, { f1: whole }, { datumMode: 'allow-free' });
    expect(held.result.datumSummary).toBeUndefined();
    const freed = runGnssMultifileProjectSolve(single, { f1: whole }, {
      datumMode: 'allow-free',
      controlOverrides: { A: false },
    });
    expect(freed.result.datumSummary?.kind).toBe('free');
    expect(freed.result.dof).toBe(3);
  });
});

describe('datumMode persistence (settings bag, no UI)', () => {
  it('round-trips allow-free; absent/unknown defaults to constrained', () => {
    const persisted = { ...emptyGnssMultifilePersisted(), datumMode: 'allow-free' as const };
    const reloaded = deserializeGnssMultifilePersisted(serializeGnssMultifilePersisted(persisted));
    expect(reloaded.datumMode).toBe('allow-free');
    expect(deserializeGnssMultifilePersisted(undefined).datumMode).toBe('constrained');
    expect(deserializeGnssMultifilePersisted({ gnssMultifile: {} }).datumMode).toBe('constrained');
    expect(
      deserializeGnssMultifilePersisted({ gnssMultifile: { datumMode: 'bogus' } }).datumMode,
    ).toBe('constrained');
    expect(emptyGnssMultifilePersisted().datumMode).toBe('constrained');
  });

  it('persisted datumMode drives the project solve', () => {
    const text = nativeText(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
    );
    const files = [entry('f1', 'p1.dat', 0)];
    const persisted = deserializeGnssMultifilePersisted(
      serializeGnssMultifilePersisted({ ...emptyGnssMultifilePersisted(), datumMode: 'allow-free' }),
    );
    const output = runGnssMultifileProjectSolve(files, { f1: text }, { datumMode: persisted.datumMode });
    expect(output.result.datumSummary?.kind).toBe('free');
  });
});

describe('free-network report + JSON export', () => {
  const freeInputOf = () => {
    const text = nativeText(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
    );
    const output = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text }, {
      datumMode: 'allow-free',
    });
    return output.input;
  };

  it('report states datum/inner-constraints/defect/rank/DOF; never anchor-as-control', () => {
    const { result, report } = buildGnssReportFromInput(freeInputOf());
    expect(report.datumSummary?.kind).toBe('free');
    expect(report.fixedStationCount).toBe(0);
    expect(report.degreesOfFreedom).toBe(3);
    const text = renderGnssBaselineTextReport(report);
    expect(text).toMatch(/datum: free \(requested allow-free\) defect=3 params=9 rank=6 dof=3/);
    expect(text).toMatch(/inner constraints/);
    expect(text).toMatch(/computational-gauge=A/);
    expect(text).not.toMatch(/FIXED|CONTROL/);
    expect(result.datumSummary?.components[0]?.anchor).toBe('A');
  });

  it('constrained report/JSON shape is unchanged (no datum keys)', () => {
    const text = nativeText(
      [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
    );
    const output = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text });
    const { report } = buildGnssReportFromInput(output.input);
    expect(report.datumSummary).toBeUndefined();
    expect('datumSummary' in report).toBe(false);
    expect(renderGnssBaselineTextReport(report)).not.toMatch(/datum:|inner constraints/);
    const exported = buildGnssMultifileJsonExport(output) as Record<string, unknown>;
    expect('datumMode' in exported).toBe(false);
    expect('datumSummary' in exported).toBe(false);
  });

  it('free JSON export carries datumMode + datumSummary', () => {
    const text = nativeText(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 }, { from: 'C', to: 'A', noise: 3 }],
    );
    const output = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text }, {
      datumMode: 'allow-free',
    });
    const exported = buildGnssMultifileJsonExport(output) as Record<string, unknown>;
    expect(exported['datumMode']).toBe('allow-free');
    expect(exported['datumSummary']).toEqual(output.result.datumSummary);
  });

  it('buildGnssBaselineReport passes result datumSummary through (unit)', () => {
    const input = freeInputOf();
    const result = runGnssBaselineAdjustment(input);
    if (!('qxx' in result)) throw new Error('expected dense');
    const report = buildGnssBaselineReport(
      result,
      result.statistics,
      [],
      input,
      input.baselines,
      result.setupModel,
    );
    expect(report.datumSummary?.kind).toBe('free');
  });
});
