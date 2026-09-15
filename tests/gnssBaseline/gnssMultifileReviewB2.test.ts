/**
 * Phase 13F B2 — multifile review/provenance/report/smoke tests (agent tier).
 *
 * Covers the B2 UI-support surface without rendering: export-block content
 * + determinism, baseline->source mapping, station trace, enable/disable +
 * reorder determinism, free-network multifile smoke (neutral wording, no
 * datum claim), and the portability save gate. Single-file parity is
 * re-verified by rerunning gnssMultifileProductionWiring (not duplicated).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  assertGnssProjectPortable,
  parseGnssProjectSources,
  runGnssMultifileProjectSolve,
} from '../../src/engine/gnssMultifileProject';
import {
  buildGnssMultifileExportJson,
  buildGnssMultifileExportLines,
  buildStationSourceTrace,
  sourceOfBaseline,
  type GnssMultifileReviewInfo,
} from '../../src/components/gnss/GnssMultifileReview.utils';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
const COORDS: Record<string, [number, number, number]> = {
  A: [4000000, 1000000, 4800000],
  B: [4000100, 1000050, 4800020],
  C: [4000200, 999950, 4800100],
  D: [4000150, 1000100, 4799950],
};

const nativeText = (
  stations: Array<{ id: string; fixed?: boolean }>,
  baselines: Array<{ from: string; to: string; noise?: number; id?: string; session?: string }>,
): string => {
  const coordOf = (id: string): [number, number, number] =>
    COORDS[id] ?? [4000500, 1000500, 4800500];
  const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
  stations.forEach((s) => {
    const c = coordOf(s.id);
    lines.push(`GX ${s.id} ${c[0]} ${c[1]} ${c[2]} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const from = coordOf(b.from);
    const to = coordOf(b.to);
    const j = (b.noise ?? 0) * 0.001;
    lines.push(
      `BL ${b.from} ${b.to} ${to[0] - from[0] + j} ${to[1] - from[1] - j} ${to[2] - from[2] + j} ` +
        `ID ${b.id ?? `B${i + 1}`} SESSION ${b.session ?? 'S1'}`,
    );
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const ALL = [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
const PART1 = nativeText(ALL, [
  { from: 'A', to: 'B', noise: 1 },
  { from: 'B', to: 'C', noise: 2 },
]);
const PART2 = nativeText(ALL, [
  { from: 'C', to: 'D', noise: 3 },
  { from: 'A', to: 'C', noise: 5 },
]);

const entry = (id: string, name: string, order: number, enabled = true): ProjectManifestFileEntry => ({
  id,
  name,
  kind: 'gnss',
  path: `data/${id}-${name}`,
  enabled,
  order,
});

const reviewOf = (
  files: ProjectManifestFileEntry[],
  texts: Record<string, string>,
  datumMode = 'constrained',
): GnssMultifileReviewInfo => {
  const output = runGnssMultifileProjectSolve(files, texts, { datumMode: datumMode as 'constrained' });
  const parsed = parseGnssProjectSources(files, texts);
  return {
    projectName: 'gnss-multifile-project',
    datumMode,
    enabledSources: files
      .filter((file) => file.enabled)
      .map((file) => ({ id: file.id, name: file.name, hash: `hash-${file.id}`, order: file.order })),
    warnings: [...output.summary.warnings],
    mergeNotes: [...output.mergeNotes],
    controlBySource: [...output.summary.controlBySource],
    provenance: output.provenance,
    stationTrace: buildStationSourceTrace(parsed),
    composedControl: Object.fromEntries(
      Object.keys(output.input.stations)
        .sort()
        .map((id) => {
          const station = output.input.stations[id];
          return [id, station?.fixedX && station?.fixedY && station?.fixedH ? 'FIXED' : 'FREE'];
        }),
    ) as Record<string, 'FIXED' | 'FREE'>,
  };
};

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('multifile export block (concise, no file dump)', () => {
  it('names the project, enabled sources, hashes, manifest order, warnings, and datum mode', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const review = reviewOf(files, { f1: PART1, f2: PART2 });
    const lines = buildGnssMultifileExportLines(review);
    const text = lines.join('\n');
    expect(text).toContain('project: gnss-multifile-project');
    expect(text).toContain('datum mode: constrained');
    expect(text).toContain(`[0] 'p1.dat' [f1] sha=hash-f1`);
    expect(text).toContain(`[1] 'p2.dat' [f2] sha=hash-f2`);
    expect(text).toContain('control:');
    // No file contents: no GX/BL records, no coordinates.
    expect(text).not.toMatch(/^GX /m);
    expect(text).not.toMatch(/^BL /m);
    expect(text).not.toContain('4000000');
  });

  it('is deterministic for the same input and reflects manifest order', () => {
    const ab = reviewOf([entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)], { f1: PART1, f2: PART2 });
    const ab2 = reviewOf([entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)], { f1: PART1, f2: PART2 });
    expect(buildGnssMultifileExportLines(ab)).toEqual(buildGnssMultifileExportLines(ab2));
    const ba = reviewOf([entry('f1', 'p1.dat', 1), entry('f2', 'p2.dat', 0)], { f1: PART1, f2: PART2 });
    const orderLines = buildGnssMultifileExportLines(ba).filter((line) => line.startsWith('  ['));
    expect(orderLines[0]).toContain(`[0] 'p2.dat'`);
    expect(orderLines[1]).toContain(`[1] 'p1.dat'`);
  });

  it('mirrors the same fields in the JSON block', () => {
    const review = reviewOf([entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)], { f1: PART1, f2: PART2 });
    const json = buildGnssMultifileExportJson(review);
    expect(json.projectName).toBe('gnss-multifile-project');
    expect(json.datumMode).toBe('constrained');
    expect(json.enabledSources).toEqual([
      { id: 'f1', name: 'p1.dat', hash: 'hash-f1', order: 0 },
      { id: 'f2', name: 'p2.dat', hash: 'hash-f2', order: 1 },
    ]);
    expect(JSON.stringify(json)).not.toContain('4000000');
  });
});

describe('baseline source mapping + station trace (review only)', () => {
  it('maps composed baseline ids to source ids in composed order', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const output = runGnssMultifileProjectSolve(files, { f1: PART1, f2: PART2 });
    expect(output.provenance.map((p) => p.sourceId)).toEqual(['f1', 'f1', 'f2', 'f2']);
    expect(sourceOfBaseline(output.provenance, 1)).toBe('f1');
    expect(sourceOfBaseline(output.provenance, 2)).toBe('f1');
    expect(sourceOfBaseline(output.provenance, 3)).toBe('f2');
    expect(sourceOfBaseline(output.provenance, 4)).toBe('f2');
    expect(sourceOfBaseline(output.provenance, 99)).toBeUndefined();
  });

  it('traces every station to contributing files with declared control', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const trace = buildStationSourceTrace(parseGnssProjectSources(files, { f1: PART1, f2: PART2 }));
    expect(Object.keys(trace).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(trace.A).toEqual([
      { sourceId: 'f1', fileName: 'p1.dat', control: 'FIXED' },
      { sourceId: 'f2', fileName: 'p2.dat', control: 'FIXED' },
    ]);
    expect(trace.B).toEqual([
      { sourceId: 'f1', fileName: 'p1.dat', control: 'FREE' },
      { sourceId: 'f2', fileName: 'p2.dat', control: 'FREE' },
    ]);
  });
});

describe('enable/disable + reorder determinism', () => {
  it('disabling a source drops its baselines; re-enabling restores bitwise', () => {
    const full = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)],
      { f1: PART1, f2: PART2 },
    );
    const reduced = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, false)],
      { f1: PART1, f2: PART2 },
    );
    expect(reduced.summary.baselineCount).toBe(2);
    expect(reduced.provenance.map((p) => p.sourceId)).toEqual(['f1', 'f1']);
    const restored = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)],
      { f1: PART1, f2: PART2 },
    );
    expect(restored.result.stations).toEqual(full.result.stations);
    expect(restored.result.varianceFactor).toBe(full.result.varianceFactor);
  });

  it('reorder keeps numerics; provenance follows manifest order', () => {
    const texts = { f1: PART1, f2: PART2 };
    const ab = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)], texts);
    const ba = runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 1), entry('f2', 'p2.dat', 0)], texts);
    expect(ba.result.stations).toEqual(ab.result.stations);
    expect(ba.result.varianceFactor).toBe(ab.result.varianceFactor);
    expect(ba.provenance.map((p) => p.sourceId)).toEqual(['f2', 'f2', 'f1', 'f1']);
  });
});

describe('free-network multifile smoke (allow-free)', () => {
  it('solves an uncontrolled two-source ring with inner-constraint semantics', () => {
    // No FIXED anywhere: two free triangles sharing station C.
    const free1 = nativeText([{ id: 'A' }, { id: 'B' }, { id: 'C' }], [
      { from: 'A', to: 'B', noise: 1 },
      { from: 'B', to: 'C', noise: 2 },
      { from: 'C', to: 'A', noise: 3 },
    ]);
    const free2 = nativeText([{ id: 'C' }, { id: 'D' }, { id: 'E' }], [
      { from: 'C', to: 'D', noise: 1 },
      { from: 'D', to: 'E', noise: 2 },
      { from: 'E', to: 'C', noise: 3 },
    ]);
    const files = [entry('f1', 'free1.dat', 0), entry('f2', 'free2.dat', 1)];
    const output = runGnssMultifileProjectSolve(files, { f1: free1, f2: free2 }, { datumMode: 'allow-free' });
    expect(output.summary.status).toBe('READY');
    expect(output.result.converged).toBe(true);
    expect(output.result.datumSummary).toBeDefined();
    const review = reviewOf(files, { f1: free1, f2: free2 }, 'allow-free');
    expect(buildGnssMultifileExportLines(review).join('\n')).toContain('datum mode: allow-free');
  });
});

describe('portability save gate', () => {
  it('blocks machine-local absolute paths, allows portable data paths', () => {
    expect(() =>
      assertGnssProjectPortable([
        { id: 'f1', name: 'p1.dat', kind: 'gnss', path: '/home/user/Downloads/p1.dat', enabled: true, order: 0 },
      ]),
    ).toThrow(/portable save blocked/);
    expect(() =>
      assertGnssProjectPortable([entry('f1', 'p1.dat', 0)]),
    ).not.toThrow();
  });
});
