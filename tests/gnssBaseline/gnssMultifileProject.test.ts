/**
 * Phase 12H.1 — multifile project wiring tests (synthetic fixtures only).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import {
  parseGnssBaselineText,
} from '../../src/engine/gnssBaselineNetworkImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { rankGnssBaselineSuspects } from '../../src/engine/gnssBaselineStatistics';
import { isGnssMultifileEnabled, setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  assertGnssProjectPortable,
  buildGnssMultifileJsonExport,
  buildGnssMultifileProvenanceSection,
  buildGnssProjectStationSourceTrace,
  deserializeGnssMultifilePersisted,
  detectGnssProjectSourceKind,
  emptyGnssMultifilePersisted,
  parseGnssProjectSources,
  runGnssMultifileProjectSolve,
  serializeGnssMultifilePersisted,
  summarizeGnssProjectComposition,
} from '../../src/engine/gnssMultifileProject';
import {
  deriveGnssNativeR2BEligibility,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import { countingBlockSolver, countingCorrectionSolver } from '../helpers/sparseTestStubs';

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
  baselines: Array<{ from: string; to: string; noise?: number; session?: string; id?: string }>,
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
    lines.push(`BL ${b.from} ${b.to} ${to[0] - from[0] + j} ${to[1] - from[1] - j} ${to[2] - from[2] + j} ID ${b.id ?? `B${i + 1}`} SESSION ${b.session ?? 'S1'}`);
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const entry = (
  id: string,
  name: string,
  order: number,
  enabled = true,
): ProjectManifestFileEntry => ({
  id,
  name,
  kind: 'dat',
  path: `data/${id}-${name}`,
  enabled,
  order,
});

const ALL_STATIONS = [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
const ALL_BASELINES = [
  { from: 'A', to: 'B', noise: 1 },
  { from: 'B', to: 'C', noise: 2 },
  { from: 'C', to: 'D', noise: 3 },
  { from: 'A', to: 'C', noise: 5 },
];
const WHOLE = nativeText(ALL_STATIONS, ALL_BASELINES);
const PART1 = nativeText(ALL_STATIONS, ALL_BASELINES.slice(0, 2));
const PART2 = nativeText(ALL_STATIONS, ALL_BASELINES.slice(2));

beforeEach(() => {
  setGnssMultifileEnabled(true);
  setGnssNativeR2BRouteEnabled(false);
});

describe('gnss multifile flag + source kinds', () => {
  it('flag defaults ON and round-trips (kill switch retained)', async () => {
    vi.resetModules();
    const fresh = await import('../../src/engine/gnssMultifileFlag');
    expect(fresh.isGnssMultifileEnabled()).toBe(true);
    fresh.setGnssMultifileEnabled(false);
    expect(fresh.isGnssMultifileEnabled()).toBe(false);
    fresh.setGnssMultifileEnabled(true);
    expect(fresh.isGnssMultifileEnabled()).toBe(true);
  });

  it('detects terrestrial / native / gvx / csv / ignored', () => {
    expect(detectGnssProjectSourceKind('p1.dat', WHOLE)).toBe('gnss-native-bl');
    expect(detectGnssProjectSourceKind('v.gvx', '<GVX version="1.0">')).toBe('gnss-gvx');
    expect(detectGnssProjectSourceKind('b.csv', 'from,to,dx,dy,dz,cxx\nA,B,1,2,3,0.1\n')).toBe('gnss-csv');
    expect(detectGnssProjectSourceKind('main.dat', 'STN A 100 200\nDIST A B 50\n')).toBe('terrestrial');
    expect(detectGnssProjectSourceKind('notes.md', '')).toBe('ignored');
  });
});

describe('gnss multifile project solve', () => {
  it('kill-switch gate: OFF blocks the run, ON permits it', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const texts = { f1: PART1, f2: PART2 };
    // Default ON (beforeEach): permitted with no explicit enable call.
    expect(isGnssMultifileEnabled()).toBe(true);
    expect(runGnssMultifileProjectSolve(files, texts).summary.status).toBe('READY');
    // Explicit OFF blocks fail-closed; re-enable restores the same result.
    setGnssMultifileEnabled(false);
    expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/flag OFF/);
    setGnssMultifileEnabled(true);
    const output = runGnssMultifileProjectSolve(files, texts);
    expect(output.summary.status).toBe('READY');
  });

  it('two-source solve equals whole single-source; provenance + READY summary', () => {
    setGnssMultifileEnabled(true);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const texts = { f1: PART1, f2: PART2 };
    const output = runGnssMultifileProjectSolve(files, texts);
    expect(output.summary.status).toBe('READY');
    expect(output.summary.sources).toHaveLength(2);
    expect(output.provenance.map((p) => p.sourceId)).toEqual(['f1', 'f1', 'f2', 'f2']);
    expect(output.provenance.every((p) => p.format === 'native')).toBe(true);
    const legacy = runGnssBaselineAdjustment({
      ...(() => {
        const parsed = parseGnssBaselineText(WHOLE, 'whole.dat');
        if (!parsed.network) throw new Error('parse failed');
        return {
          stations: parsed.network.stations,
          baselines: parsed.network.baselines,
          referenceFrame: FRAME,
          epoch: EPOCH,
          ellipsoid: ELLIPSOID,
        };
      })(),
    });
    expect(JSON.stringify(output.result.stations)).toBe(JSON.stringify(legacy.stations));
    expect(output.result.varianceFactor).toBeCloseTo(legacy.varianceFactor, 12);
    expect(output.result.residuals).toEqual(legacy.residuals);
    expect(output.result.statistics).toEqual(legacy.statistics);
    // JSON export carries sources/frame/provenance/diagnostics/setup/results.
    const exported = buildGnssMultifileJsonExport(output);
    expect((exported.sources as unknown[])).toHaveLength(2);
    expect(exported.baselineProvenance).toEqual(output.provenance);
    expect((exported.result as { varianceFactor: number }).varianceFactor).toBe(output.result.varianceFactor);
    // Provenance report section: per-baseline origin, loop origins, no math recompute.
    const section = buildGnssMultifileProvenanceSection(output.provenance, output.input.baselines, output.mergeNotes, []);
    expect(section[0]).toMatch(/Multifile composition provenance/);
    expect(section.filter((line) => line.includes("'p1.dat'"))).toHaveLength(2);
  });

  it('mixed terrestrial + GNSS blocks clearly before solve', () => {
    setGnssMultifileEnabled(true);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'main.dat', 1)];
    const texts = { f1: PART1, f2: 'STN A 100 200\nDIST A B 50\n' };
    expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/mixed terrestrial \+ GNSS/);
  });

  it('control overrides apply AFTER composition without mutating sources', () => {
    setGnssMultifileEnabled(true);
    const free1 = nativeText([{ id: 'A' }, { id: 'B' }], [{ from: 'A', to: 'B' }]);
    const free2 = nativeText([{ id: 'B' }, { id: 'C' }], [{ from: 'B', to: 'C' }]);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const texts = { f1: free1, f2: free2 };
    expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/no fully fixed/i);
    const output = runGnssMultifileProjectSolve(files, texts, { controlOverrides: { A: true } });
    expect(output.summary.status).toBe('READY');
    expect(output.input.stations.A!.fixedX).toBe(true);
    expect(texts.f1).not.toMatch(/FIXED/);
  });

  it('control-only CSV keeps its provenance and fixed-control attribution', () => {
    setGnssMultifileEnabled(true);
    // Control-stations CSV auto-detects as terrestrial: it enters the
    // project via an explicit gnss-csv format override.
    const controlCsv = 'id,X,Y,Z,fixed\nA,4000000,1000000,4800000,FIXED\n';
    const freeNative = nativeText([{ id: 'A' }, { id: 'B' }], [{ from: 'A', to: 'B' }]);
    const files = [entry('f0', 'control.csv', 0), entry('f1', 'p1.dat', 1)];
    const texts = { f0: controlCsv, f1: freeNative };
    const parsed = parseGnssProjectSources(files, texts, { formatOverrides: { f0: 'gnss-csv' } });
    const control = parsed.find((entry) => entry.fileId === 'f0');
    expect(control?.network).toBeNull();
    expect(Object.keys(control?.controlStations ?? {}).sort()).toEqual(['A']);
    const summary = summarizeGnssProjectComposition(parsed, files.length);
    // FIXED control attributed to the control file, never the later network.
    expect(summary.controlBySource).toEqual(['A FIXED (control.csv)']);
    const trace = buildGnssProjectStationSourceTrace(parsed);
    expect(trace.A?.[0]).toEqual({ sourceId: 'f0', fileName: 'control.csv', control: 'FIXED' });
  });

  it('enable/disable recomposes cleanly with no stale state', () => {
    setGnssMultifileEnabled(true);
    // Minimal declarations: dropping file 2 removes exactly its stations.
    const lean1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2));
    const lean2 = nativeText([{ id: 'C' }, { id: 'D' }, { id: 'Z' }], [
      { from: 'C', to: 'D' },
      { from: 'D', to: 'Z', noise: 7 },
    ]);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, false)];
    const texts = { f1: lean1, f2: lean2 };
    // Disabled file 2 is unparsed: its-only station Z must be absent.
    const parsed = parseGnssProjectSources(files, texts);
    expect(parsed.filter((p) => p.network != null)).toHaveLength(1);
    const reduced = runGnssMultifileProjectSolve(files, texts);
    expect(reduced.result.logicalObservations).toBe(2);
    expect('Z' in reduced.result.stations).toBe(false);
    expect(reduced.provenance.some((p) => p.sourceId === 'f2')).toBe(false);
    const full = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, true)],
      texts,
    );
    expect(full.result.logicalObservations).toBe(4);
    expect('Z' in full.result.stations).toBe(true);
  });

  it('save -> serialize -> reload -> recompose -> adjust equality (order/setup/overrides/provenance)', () => {
    setGnssMultifileEnabled(true);
    const files = [entry('f1', 'p1.dat', 1), entry('f2', 'p2.dat', 0)];
    const texts = { f1: PART1, f2: PART2 };
    const persisted = {
      ...emptyGnssMultifilePersisted(),
      controlOverrides: { D: true },
      setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 },
      displayNames: { f1: 'part one', f2: 'part two' },
    };
    const first = runGnssMultifileProjectSolve(files, texts, {
      controlOverrides: persisted.controlOverrides,
      setup: persisted.setup,
    });
    // Serialize through the existing settings bag; reload; recompose.
    const settings = serializeGnssMultifilePersisted(persisted);
    const reloaded = deserializeGnssMultifilePersisted(settings as Record<string, unknown>);
    expect(reloaded).toEqual(persisted);
    const second = runGnssMultifileProjectSolve(files, { ...texts }, {
      controlOverrides: reloaded.controlOverrides,
      setup: reloaded.setup,
    });
    expect(JSON.stringify(second.result.stations)).toBe(JSON.stringify(first.result.stations));
    expect(second.result.varianceFactor).toBe(first.result.varianceFactor);
    expect(second.provenance).toEqual(first.provenance);
    expect(second.summary.agreedFrame).toBe(FRAME);
  });

  it('portable save gate forbids machine-local paths', () => {
    setGnssMultifileEnabled(true);
    const bad: ProjectManifestFileEntry = {
      id: 'f1', name: 'a.gvx', kind: 'dat', path: '~/Downloads/webnet-gnss-12e/a.gvx', enabled: true, order: 0,
    };
    expect(() => assertGnssProjectPortable([bad])).toThrow(/portable save blocked.*machine-local/);
    // Broadened heuristic: any leading ~/ and any absolute POSIX path.
    const localPaths = [
      '~/Documents/job/site.gvx',
      '~/data/a.gvx',
      '/root/data/a.gvx',
      '/mnt/usb/a.gvx',
      '/media/usb/a.gvx',
      '/tmp/a.gvx',
      '/home/operator/a.gvx',
      'C:\\data\\a.gvx',
    ];
    localPaths.forEach((path, index) => {
      const file: ProjectManifestFileEntry = {
        id: `bad${index}`, name: 'a.gvx', kind: 'dat', path, enabled: true, order: index,
      };
      expect(() => assertGnssProjectPortable([file])).toThrow(/portable save blocked/);
    });
    expect(() =>
      assertGnssProjectPortable([entry('f1', 'p1.dat', 0)]),
    ).not.toThrow();
  });

  it('cross-source Phase12D: loops/redundancy/Qvv/Cvv/standardized/blockT/what-if/covariance are network properties', () => {
    setGnssMultifileEnabled(true);
    const tree = nativeText(ALL_STATIONS, [
      { from: 'A', to: 'B', noise: 1 },
      { from: 'B', to: 'C', noise: 2 },
    ]);
    const close = nativeText(ALL_STATIONS, [{ from: 'A', to: 'C', noise: 9 }]);
    const output = runGnssMultifileProjectSolve(
      [entry('t', 'tree.dat', 0), entry('c', 'close.dat', 1)],
      { t: tree, c: close },
    );
    expect(computeGnssLoopClosures(output.input.baselines).loops).toHaveLength(1);
    expect(output.result.dof).toBeGreaterThan(0);
    const redundancy = output.result.statistics.reduce((sum, stat) => sum + stat.redundancy.trace, 0);
    expect(redundancy).toBeGreaterThan(0);
    expect(output.result.statistics.every((stat) => stat.blockT !== undefined)).toBe(true);
    expect(rankGnssBaselineSuspects(output.result.statistics)).toHaveLength(3);
    expect((output.result as { qxx?: unknown }).qxx).toBeDefined();
    const origins = new Set(
      computeGnssLoopClosures(output.input.baselines).loops[0]!.members.map(
        (m) => output.provenance[m.baselineId - 1]!.sourceId,
      ),
    );
    expect(origins.has('t')).toBe(true);
    expect(origins.has('c')).toBe(true);
  });

  it('composed synthetic survives the unchanged R2B gate with stub parity to TS', async () => {
    setGnssMultifileEnabled(true);
    setGnssNativeR2BRouteEnabled(true);
    // Bridgeless triangle split across two files (chain+spur would trip F-BRIDGE).
    const ring1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], [{ from: 'A', to: 'B' }]);
    const ring2 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], [
      { from: 'B', to: 'C', session: 'S2' },
      { from: 'C', to: 'A', session: 'S3' },
    ]);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const output = runGnssMultifileProjectSolve(files, { f1: ring1, f2: ring2 });
    const eligibility = deriveGnssNativeR2BEligibility(output.input, { isWorker: true, minParams: 1 });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);
    const oracle = runGnssBaselineAdjustment(output.input);
    const attempt = await runGnssBaselineWithNativeR2B(output.input, {
      isWorker: true,
      minParams: 1,
      correctionSolverOverride: countingCorrectionSolver(),
      blockSolverOverride: countingBlockSolver(),
    });
    expect(attempt.route).toBe('native-sparse-selected-qxx');
    expect(attempt.result.routeProvenance).toBe('native-sparse-selected-qxx');
    expect(attempt.result.stations).toEqual(oracle.stations);
    expect(attempt.result.weightedResidualSum).toBe(oracle.weightedResidualSum);
  });

  it('precomposition summary renders READY/BLOCKED with agreed frame and conflicts', () => {
    setGnssMultifileEnabled(true);
    const parsed = parseGnssProjectSources(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)],
      { f1: PART1, f2: PART2 },
    );
    const summary = summarizeGnssProjectComposition(parsed, 2);
    expect(summary.status).toBe('READY');
    expect(summary.agreedFrame).toBe(FRAME);
    expect(summary.agreedEpoch).toBe(EPOCH);
    expect(summary.agreedEllipsoid).toBe(ELLIPSOID);
    expect(summary.baselineCount).toBe(4);
    expect(summary.controlBySource.some((line) => line.startsWith('A FIXED'))).toBe(true);
    // Material station conflict: same ID, shifted coords.
    const shiftedLines = PART2.split('\n').map((line) =>
      line.startsWith('GX D ') ? 'GX D 4000150.005 1000100 4799950 FREE' : line,
    );
    const blocked = summarizeGnssProjectComposition(
      parseGnssProjectSources(
        [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)],
        { f1: PART1, f2: shiftedLines.join('\n') },
      ),
      2,
    );
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.blockingErrors.join(' ')).toMatch(/material station conflict 'D'/);
  });

  it('failed-parse sources block the run and name the bad source', () => {
    setGnssMultifileEnabled(true);
    const files = [entry('good', 'p1.dat', 0), entry('bad', 'broken.dat', 1)];
    const texts = { good: PART1, bad: 'this is not a GNSS file\nno parseable rows here\n' };
    const parsed = parseGnssProjectSources(files, texts, { formatOverrides: { bad: 'gnss-native-bl' } });
    const summary = summarizeGnssProjectComposition(parsed, 2);
    expect(summary.status).toBe('BLOCKED');
    expect(summary.blockingErrors.join(' ')).toMatch(/broken\.dat.*failed to parse|failed to parse.*broken\.dat/);
    expect(() => runGnssMultifileProjectSolve(files, texts, { formatOverrides: { bad: 'gnss-native-bl' } })).toThrow(
      /broken\.dat/,
    );
  });

  it('composition-only perf: 10/~1k, 50/~10k, 100/~50k baselines measure parse/compose/summary', () => {
    setGnssMultifileEnabled(true);
    const buildFiles = (fileCount: number, perFile: number): { files: ProjectManifestFileEntry[]; texts: Record<string, string> } => {
      const files: ProjectManifestFileEntry[] = [];
      const texts: Record<string, string> = {};
      for (let f = 0; f < fileCount; f += 1) {
        const id = `perf${f}`;
        files.push(entry(id, `perf${f}.dat`, f));
        const stations: Array<{ id: string; fixed?: boolean }> = [{ id: 'A', fixed: true }];
        for (let i = 0; i < 20; i += 1) stations.push({ id: `F${f}P${i}` });
        const coordOf = (i: number): [number, number, number] => [4000000 + i * 137, 1000000 + i * 89, 4800000 + i * 53];
        const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M', `GX A 4000000 1000000 4800000 FIXED`];
        for (let i = 0; i < 20; i += 1) {
          const c = coordOf(i);
          lines.push(`GX F${f}P${i} ${c[0]} ${c[1]} ${c[2]} FREE`);
        }
        for (let i = 0; i < perFile; i += 1) {
          const a = `F${f}P${i % 20}`;
          const b = `F${f}P${(i + 1) % 20}`;
          const ca = coordOf(i % 20);
          const cb = coordOf((i + 1) % 20);
          lines.push(`BL ${a} ${b} ${cb[0] - ca[0]} ${cb[1] - ca[1]} ${cb[2] - ca[2]} ID F${f}B${i} SESSION S${i % 5}`);
          lines.push(COV);
        }
        texts[id] = `${lines.join('\n')}\n`;
      }
      return { files, texts };
    };
    const legs = [
      { files: 10, perFile: 100 },
      { files: 50, perFile: 200 },
      { files: 100, perFile: 500 },
    ];
    const perBaselineMs: number[] = [];
    legs.forEach(({ files: fileCount, perFile }) => {
      const { files, texts } = buildFiles(fileCount, perFile);
      const t0 = Date.now();
      const parsed = parseGnssProjectSources(files, texts);
      const t1 = Date.now();
      const summary = summarizeGnssProjectComposition(parsed, fileCount);
      const t2 = Date.now();
      expect(summary.status).toBe('READY');
      expect(summary.baselineCount).toBe(fileCount * perFile);
      const total = t2 - t0;
      perBaselineMs.push(total / (fileCount * perFile));
      console.log(`gnss multifile perf: files=${fileCount} baselines=${fileCount * perFile} parse=${t1 - t0}ms compose+summary=${t2 - t1}ms total=${total}ms`);
      expect(total).toBeLessThan(30000);
    });
    // Linear-ish: per-baseline cost must not blow up with scale (10x headroom).
    expect(Math.max(...perBaselineMs) / Math.min(...perBaselineMs)).toBeLessThan(10);
  });
});
