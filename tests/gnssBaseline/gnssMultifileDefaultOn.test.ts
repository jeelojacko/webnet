/**
 * Phase 12H.2 — default-ON hardening (synthetic fixtures only, agent tier).
 * Pristine default permits compose; kill switch still fail-closed.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import {
  parseGnssBaselineText,
} from '../../src/engine/gnssBaselineNetworkImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { isGnssMultifileEnabled, setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  assertGnssProjectPortable,
  deserializeGnssMultifilePersisted,
  emptyGnssMultifilePersisted,
  runGnssMultifileProjectSolve,
  serializeGnssMultifilePersisted,
  summarizeGnssProjectComposition,
  parseGnssProjectSources,
} from '../../src/engine/gnssMultifileProject';
import { composeGnssBaselineNetworks } from '../../src/engine/gnssMultifileComposition';

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

describe('gnss multifile default ON (pristine import, no set call)', () => {
  it('pristine default is ON and permits compose of 2 compatible sources', () => {
    expect(isGnssMultifileEnabled()).toBe(true);
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const output = runGnssMultifileProjectSolve(files, { f1: PART1, f2: PART2 });
    expect(output.summary.status).toBe('READY');
    expect(output.result.logicalObservations).toBe(4);
  });
});

describe('gnss multifile kill switch (OFF fail-closed, ON restores)', () => {
  it('OFF blocks compose + run; ON again permits with the same result', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const texts = { f1: PART1, f2: PART2 };
    const before = runGnssMultifileProjectSolve(files, texts);
    setGnssMultifileEnabled(false);
    try {
      const parsed = parseGnssProjectSources(files, texts);
      const ordered = parsed
        .filter((p) => p.network != null)
        .map((p) => ({
          network: p.network!,
          sourceId: p.fileId,
          fileName: p.fileName,
          format: p.format,
        }));
      expect(() => composeGnssBaselineNetworks(ordered)).toThrow(/flag OFF/);
      expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/flag OFF/);
      expect(() => summarizeGnssProjectComposition(parsed, 2)).toThrow(/flag OFF/);
    } finally {
      setGnssMultifileEnabled(true);
    }
    const after = runGnssMultifileProjectSolve(files, texts);
    expect(JSON.stringify(after.result.stations)).toBe(JSON.stringify(before.result.stations));
    expect(after.result.varianceFactor).toBe(before.result.varianceFactor);
    expect(after.provenance).toEqual(before.provenance);
  });

  it('rollback: ON ok -> OFF fail-closed without mutating project -> ON same result', () => {
    const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
    const texts = { f1: PART1, f2: PART2 };
    const first = runGnssMultifileProjectSolve(files, texts);
    const filesSnapshot = JSON.stringify(files);
    const textsSnapshot = JSON.stringify(texts);
    setGnssMultifileEnabled(false);
    try {
      expect(() => runGnssMultifileProjectSolve(files, texts)).toThrow(/flag OFF/);
      expect(JSON.stringify(files)).toBe(filesSnapshot);
      expect(JSON.stringify(texts)).toBe(textsSnapshot);
    } finally {
      setGnssMultifileEnabled(true);
    }
    const second = runGnssMultifileProjectSolve(files, texts);
    expect(JSON.stringify(second.result.stations)).toBe(JSON.stringify(first.result.stations));
    expect(second.result.varianceFactor).toBe(first.result.varianceFactor);
    expect(second.result.residuals).toEqual(first.result.residuals);
  });
});

describe('gnss multifile one-source parity vs single-source compose', () => {
  it('single-file project equals direct single-source adjustment', () => {
    const files = [entry('solo', 'whole.dat', 0)];
    const output = runGnssMultifileProjectSolve(files, { solo: WHOLE });
    expect(output.summary.status).toBe('READY');
    const parsed = parseGnssBaselineText(WHOLE, 'whole.dat');
    if (!parsed.network) throw new Error('parse failed');
    const oracle = runGnssBaselineAdjustment({
      stations: parsed.network.stations,
      baselines: parsed.network.baselines,
      referenceFrame: FRAME,
      epoch: EPOCH,
      ellipsoid: ELLIPSOID,
    });
    expect(JSON.stringify(output.result.stations)).toBe(JSON.stringify(oracle.stations));
    expect(output.input.baselines.map((b) => [b.from, b.to, b.vector]))
      .toEqual(parsed.network.baselines.map((b) => [b.from, b.to, b.vector]));
    expect(output.result.residuals).toEqual(oracle.residuals);
    expect(output.result.varianceFactor).toBe(oracle.varianceFactor);
    expect(Math.sqrt(output.result.varianceFactor)).toBe(Math.sqrt(oracle.varianceFactor));
    expect(output.result.statistics).toEqual(oracle.statistics);
    const projectLoops = computeGnssLoopClosures(output.input.baselines).loops;
    const oracleLoops = computeGnssLoopClosures(
      parsed.network.baselines.map((b, i) => ({ ...b, id: i + 1 })),
    ).loops;
    expect(projectLoops).toEqual(oracleLoops);
  });
});

describe('gnss multifile portable gate (cross-platform)', () => {
  it('rejects machine-local paths on POSIX, Windows, UNC, and file://; accepts relative', () => {
    const badPaths = [
      '~/Downloads/a.gvx',
      '/home/operator/a.gvx',
      '/root/data/a.gvx',
      '/mnt/usb/a.gvx',
      '/media/usb/a.gvx',
      '/tmp/a.gvx',
      '$HOME/data/a.gvx',
      'C:\\Users\\op\\a.gvx',
      'C:\\Temp\\a.gvx',
      'D:\\data\\a.gvx',
      'E:/data/a.gvx',
      '\\\\server\\share\\a.gvx',
      'file:///tmp/a.gvx',
      'file:///C:/data/a.gvx',
    ];
    badPaths.forEach((path, index) => {
      const file: ProjectManifestFileEntry = {
        id: `bad${index}`, name: 'a.gvx', kind: 'dat', path, enabled: true, order: index,
      };
      expect(() => assertGnssProjectPortable([file])).toThrow(/portable save blocked/);
    });
    const good: ProjectManifestFileEntry[] = [
      entry('f1', 'p1.dat', 0),
      { id: 'f2', name: 'p2.dat', kind: 'dat', path: 'data/p2.dat', enabled: true, order: 1 },
    ];
    expect(() => assertGnssProjectPortable(good)).not.toThrow();
  });
});

describe('gnss multifile save/reopen golden (default ON, no enable call)', () => {
  it('manifest/order/setup/overrides/composed/provenance/diagnostics/numerics survive round trip', () => {
    expect(isGnssMultifileEnabled()).toBe(true);
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
    const settings = serializeGnssMultifilePersisted(persisted);
    const reloaded = deserializeGnssMultifilePersisted(settings as Record<string, unknown>);
    expect(reloaded).toEqual(persisted);
    const second = runGnssMultifileProjectSolve(files, { ...texts }, {
      controlOverrides: reloaded.controlOverrides,
      setup: reloaded.setup,
    });
    expect(JSON.stringify(second.result.stations)).toBe(JSON.stringify(first.result.stations));
    expect(second.result.varianceFactor).toBe(first.result.varianceFactor);
    expect(second.result.residuals).toEqual(first.result.residuals);
    expect(second.result.statistics).toEqual(first.result.statistics);
    expect(second.provenance).toEqual(first.provenance);
    expect(second.mergeNotes).toEqual(first.mergeNotes);
    expect(second.summary).toEqual(first.summary);
    expect(second.parsed.map((p) => p.diagnostics)).toEqual(first.parsed.map((p) => p.diagnostics));
  });
});

describe('gnss multifile enable/disable/reorder/save/reload/enable stress', () => {
  it('no ghost stations, no stale control/warnings/provenance', () => {
    const lean1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2));
    const lean2 = nativeText([{ id: 'C' }, { id: 'D' }, { id: 'Z' }], [
      { from: 'C', to: 'D' },
      { from: 'D', to: 'Z', noise: 7 },
    ]);
    const texts = { f1: lean1, f2: lean2 };
    // Disable f2: Z must vanish everywhere.
    const reduced = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, false)],
      texts,
    );
    expect('Z' in reduced.result.stations).toBe(false);
    expect(reduced.provenance.some((p) => p.sourceId === 'f2')).toBe(false);
    // Re-enable + reorder + control override + save/reload + re-enable.
    const reordered = [entry('f2', 'p2.dat', 0), entry('f1', 'p1.dat', 1)];
    const persisted = {
      ...emptyGnssMultifilePersisted(),
      controlOverrides: { Z: true },
    };
    const full = runGnssMultifileProjectSolve(reordered, texts, {
      controlOverrides: persisted.controlOverrides,
    });
    expect('Z' in full.result.stations).toBe(true);
    const reloaded = deserializeGnssMultifilePersisted(
      serializeGnssMultifilePersisted(persisted) as Record<string, unknown>,
    );
    const replay = runGnssMultifileProjectSolve(reordered, { ...texts }, {
      controlOverrides: reloaded.controlOverrides,
    });
    expect(JSON.stringify(replay.result.stations)).toBe(JSON.stringify(full.result.stations));
    expect(replay.provenance).toEqual(full.provenance);
    expect(replay.summary.warnings).toEqual(full.summary.warnings);
    expect(replay.summary.controlBySource).toEqual(full.summary.controlBySource);
    // Disable again after the round trip: Z must vanish again (no ghosts).
    const reducedAgain = runGnssMultifileProjectSolve(
      [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, false)],
      texts,
      { controlOverrides: reloaded.controlOverrides },
    );
    expect('Z' in reducedAgain.result.stations).toBe(false);
    expect(reducedAgain.provenance.some((p) => p.sourceId === 'f2')).toBe(false);
    expect(reducedAgain.summary.controlBySource.some((line) => line.startsWith('Z '))).toBe(false);
  });
});
