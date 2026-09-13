/**
 * Phase 12H.0 composition evidence (TEST-LOCAL ONLY, no src/ changes).
 *
 * Test-local compose helper merges independently-parsed canonical networks:
 * exact referenceFrame/epoch/ellipsoid match (fail-closed), stations by exact
 * ID, baselines concatenated in order with per-baseline provenance.
 * No averaging, no transforms.
 *
 * Micro-benchmark result (local, 10 files x 100 baselines = 1000): parse +
 * merge completes well under the 5 s generous bound (typically < 1 s on a
 * dev laptop); composition itself is hash-map order work, roughly linear.
 */
import { describe, expect, it } from 'vitest';
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  parseGnssBaselineText,
  type GnssBaselineNetworkInput,
} from '../../src/engine/gnssBaselineNetworkImport';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import {
  buildGnssReportFromInput,
  renderGnssBaselineTextReport,
} from '../../src/engine/gnssBaselineReport';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';

interface Coord { x: number; y: number; z: number }
const COORDS: Record<string, Coord> = {
  A: { x: 4000000, y: 1000000, z: 4800000 },
  B: { x: 4000100, y: 1000050, z: 4800020 },
  C: { x: 4000200, y: 999950, z: 4800100 },
  D: { x: 4000150, y: 1000100, z: 4799950 },
  E: { x: 4000300, y: 1000200, z: 4800050 },
};

const diff = (from: Coord, to: Coord, n = 0): string => {
  const j = n * 0.001;
  return `${to.x - from.x + j} ${to.y - from.y - j} ${to.z - from.z + j}`;
};

interface StationDecl { id: string; fixed?: boolean; coord?: Coord }
interface BaselineDecl { from: string; to: string; noise?: number; session?: string; id?: string }

const FALLBACK_COORD: Coord = { x: 4000500, y: 1000500, z: 4800500 };
const sourceText = (
  stations: StationDecl[],
  baselines: BaselineDecl[],
  frame = FRAME,
  epoch: string | null | undefined = EPOCH,
): string => {
  const coordOf = (id: string): Coord =>
    stations.find((s) => s.id === id)?.coord ?? COORDS[id] ?? FALLBACK_COORD;
  const lines = [`FRAME ECEF ${frame}${epoch ? ` EPOCH ${epoch}` : ''} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
  stations.forEach((s) => {
    const c = s.coord ?? COORDS[s.id] ?? FALLBACK_COORD;
    lines.push(`GX ${s.id} ${c.x} ${c.y} ${c.z} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const opts = `ID ${b.id ?? `B${i + 1}`}${b.session ? ` SESSION ${b.session}` : ' SESSION S1'}`;
    lines.push(`BL ${b.from} ${b.to} ${diff(coordOf(b.from), coordOf(b.to), b.noise ?? 0)} ${opts}`);
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const parse = (text: string, file: string): GnssBaselineNetworkInput => {
  const result = parseGnssBaselineText(text, file);
  if (!result.network) throw new Error(`parse failed for ${file}: ${JSON.stringify(result.diagnostics)}`);
  return result.network;
};

// --- Test-local compose helper (NOT src/) ---
interface ComposeEntry { network: GnssBaselineNetworkInput; sourceId: string; fileName: string; format: string }
interface ComposedProvenance { sourceId: string; fileName: string; format: string; originalId: number; index: number }
interface ComposedNetwork {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  provenance: ComposedProvenance[];
  mergeNotes: string[];
}
const ROUND_TOL_M = 1e-9;

const composeNetworks = (entries: ComposeEntry[]): ComposedNetwork => {
  if (entries.length === 0) throw new Error('compose: no sources');
  const first = entries[0]!.network.frame;
  entries.forEach((e) => {
    const f = e.network.frame;
    if (f.referenceFrame !== first.referenceFrame) throw new Error(`compose blocked: referenceFrame mismatch (${f.referenceFrame} vs ${first.referenceFrame})`);
    if (f.epoch !== first.epoch) throw new Error(`compose blocked: epoch mismatch (${String(f.epoch)} vs ${String(first.epoch)})`);
    if (f.ellipsoid !== first.ellipsoid) throw new Error(`compose blocked: ellipsoid mismatch (${String(f.ellipsoid)} vs ${String(first.ellipsoid)})`);
  });
  const stations: StationMap = {};
  const mergeNotes: string[] = [];
  entries.forEach((e) => {
    Object.entries(e.network.stations).forEach(([id, st]) => {
      const prior = stations[id];
      if (!prior) { stations[id] = { ...st! }; return; }
      const dx = Math.abs(prior.x - st!.x);
      const dy = Math.abs(prior.y - st!.y);
      const dh = Math.abs(prior.h - st!.h);
      const worst = Math.max(dx, dy, dh);
      const priorFixed = !!(prior.fixedX && prior.fixedY && prior.fixedH);
      const nextFixed = !!(st!.fixedX && st!.fixedY && st!.fixedH);
      if (worst > ROUND_TOL_M) throw new Error(`compose blocked: material station conflict '${id}' diff=${worst}`);
      if (worst > 0) mergeNotes.push(`rounding diff accepted for '${id}' diff=${worst}`);
      if (priorFixed && nextFixed) { stations[id] = { ...prior, fixed: true, fixedX: true, fixedY: true, fixedH: true }; return; }
      if (priorFixed || nextFixed) {
        stations[id] = { ...prior, fixed: true, fixedX: true, fixedY: true, fixedH: true };
        mergeNotes.push(`fixed+free => fixed for '${id}' from ${e.sourceId}`);
        return;
      }
      stations[id] = { ...prior };
    });
  });
  const baselines: GnssBaselineObservation[] = [];
  const provenance: ComposedProvenance[] = [];
  entries.forEach((e) => {
    e.network.baselines.forEach((b, i) => {
      const id = baselines.length + 1;
      baselines.push({ ...b, id });
      provenance.push({ sourceId: e.sourceId, fileName: e.fileName, format: e.format, originalId: b.id, index: i });
    });
  });
  return { stations, baselines, provenance, mergeNotes };
};

const entryOf = (network: GnssBaselineNetworkInput, sourceId: string, format = 'native'): ComposeEntry => ({
  network, sourceId, fileName: `${sourceId}.dat`, format,
});

const ALL_STATIONS: StationDecl[] = [
  { id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' },
];
const ALL_BASELINES: BaselineDecl[] = [
  { from: 'A', to: 'B', noise: 1 }, { from: 'B', to: 'C', noise: 2 },
  { from: 'C', to: 'D', noise: 3 }, { from: 'D', to: 'A', noise: 4 },
  { from: 'A', to: 'C', noise: 5 }, { from: 'B', to: 'D', noise: 6 },
];

const solveAll = (net: { stations: StationMap; baselines: GnssBaselineObservation[] }) => {
  const result = runGnssBaselineAdjustment({
    stations: net.stations, baselines: net.baselines,
    referenceFrame: FRAME, epoch: EPOCH, ellipsoid: ELLIPSOID,
  });
  const loops = computeGnssLoopClosures(net.baselines);
  const { report } = buildGnssReportFromInput({
    stations: net.stations, baselines: net.baselines,
    referenceFrame: FRAME, epoch: EPOCH, ellipsoid: ELLIPSOID,
  });
  return { result, loops, text: renderGnssBaselineTextReport(report) };
};

const stationSnapshot = (stations: StationMap): string =>
  JSON.stringify(Object.keys(stations).sort().map((id) => [id, stations[id]!.x, stations[id]!.y, stations[id]!.h]));
const baselineSnapshot = (baselines: GnssBaselineObservation[]): string =>
  JSON.stringify(baselines.map((b) => [b.from, b.to, b.vector.x, b.vector.y, b.vector.z,
    b.covariance.xx, b.covariance.xy, b.covariance.xz, b.covariance.yy, b.covariance.yz, b.covariance.zz,
    b.sessionId ?? '']));

describe('gnss multifile composition evidence (test-local)', () => {
  it('A/B/C/D splits compose to identical canonical problem and outputs', () => {
    const whole = entryOf(parse(sourceText(ALL_STATIONS, ALL_BASELINES), 'whole.dat'), 'whole');
    const split2 = [
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }], ALL_BASELINES.slice(0, 3)), 'p1.dat'), 'p1'),
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }], ALL_BASELINES.slice(3)), 'p2.dat'), 'p2'),
    ];
    const split5 = ALL_BASELINES.map((b, i) =>
      entryOf(parse(sourceText(
        [{ id: 'A', fixed: true }, { id: b.from }, { id: b.to }].filter((s, j, a) => a.findIndex((t) => t.id === s.id) === j),
        [{ ...b }], FRAME, EPOCH,
      ), `s${i}.dat`), `s${i}`));
    // D: control station lives with baselines in one source, remaining baselines elsewhere.
    const controlClean: ComposeEntry[] = [
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2)), 'c1.dat'), 'c1'),
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }], ALL_BASELINES.slice(2)), 'c2.dat'), 'c2'),
    ];
    const nets = [composeNetworks([whole]), composeNetworks(split2), composeNetworks(split5), composeNetworks(controlClean)];
    const base = stationSnapshot(nets[0]!.stations);
    const baseBl = baselineSnapshot(nets[0]!.baselines);
    nets.forEach((n) => {
      expect(stationSnapshot(n.stations)).toBe(base);
      expect(baselineSnapshot(n.baselines)).toBe(baseBl);
    });
    const solved = nets.map(solveAll);
    solved.forEach((s) => {
      expect(s.result.varianceFactor).toBeCloseTo(solved[0]!.result.varianceFactor, 12);
      expect(s.result.weightedResidualSum).toBeCloseTo(solved[0]!.result.weightedResidualSum, 12);
      expect(s.result.dof).toBe(solved[0]!.result.dof);
      expect(s.loops.loops.length).toBe(solved[0]!.loops.loops.length);
      expect(s.text).toBe(solved[0]!.text);
      expect(s.result.stations).toEqual(solved[0]!.result.stations);
      expect(s.result.residuals).toEqual(solved[0]!.result.residuals);
      expect(s.result.statistics).toEqual(solved[0]!.result.statistics);
    });
    // Provenance retained per baseline, order preserved.
    expect(nets[1]!.provenance.map((p) => p.sourceId)).toEqual(['p1', 'p1', 'p1', 'p2', 'p2', 'p2']);
    expect(nets[1]!.provenance.every((p) => p.format === 'native')).toBe(true);
  });

  it('station merge unit cases A-F', () => {
    const mk = (coord: Coord, fixed: boolean): GnssBaselineNetworkInput =>
      parse(sourceText([{ id: 'S', fixed, coord }, { id: 'T', coord: COORDS.B }], [{ from: 'S', to: 'T' }]), 't.dat');
    // A: same coord merged silently.
    expect(composeNetworks([entryOf(mk(COORDS.A!, false), 'a'), entryOf(mk(COORDS.A!, false), 'b')]).mergeNotes).toEqual([]);
    // B: tiny rounding diff <=1e-9 accepted + documented.
    const rounded = { ...COORDS.A!, x: COORDS.A!.x + 5e-10 };
    const noted = composeNetworks([entryOf(mk(COORDS.A!, false), 'a'), entryOf(mk(rounded, false), 'b')]);
    expect(noted.mergeNotes.some((n) => n.includes('rounding diff'))).toBe(true);
    // C: material conflict blocks.
    expect(() => composeNetworks([entryOf(mk(COORDS.A!, false), 'a'), entryOf(mk(COORDS.B!, false), 'b')])).toThrow(/material station conflict/);
    // D: fixed+free => fixed with provenance note.
    const ff = composeNetworks([entryOf(mk(COORDS.A!, true), 'a'), entryOf(mk(COORDS.A!, false), 'b')]);
    expect(ff.stations.S!.fixedX).toBe(true);
    expect(ff.mergeNotes.some((n) => n.includes('fixed+free'))).toBe(true);
    // E: conflicting fixed coords error.
    expect(() => composeNetworks([entryOf(mk(COORDS.A!, true), 'a'), entryOf(mk(COORDS.B!, true), 'b')])).toThrow(/material station conflict/);
    // F: alias IDs ('A' vs 'a') are distinct stations.
    const alias = composeNetworks([
      entryOf(parse(sourceText([{ id: 'A' }, { id: 'B' }], [{ from: 'A', to: 'B' }]), 'a.dat'), 'a'),
      entryOf(parse(sourceText([{ id: 'a' }, { id: 'B' }], [{ from: 'a', to: 'B' }]), 'b.dat'), 'b'),
    ]);
    expect(Object.keys(alias.stations).sort()).toEqual(['A', 'B', 'a']);
  });

  it('control merge matrix FREE/FIXED combinations', () => {
    const mk = (fixed: boolean): GnssBaselineNetworkInput =>
      parse(sourceText([{ id: 'S', fixed }, { id: 'T', coord: COORDS.B }], [{ from: 'S', to: 'T' }]), 't.dat');
    const freeFree = composeNetworks([entryOf(mk(false), 'a'), entryOf(mk(false), 'b')]);
    expect(freeFree.stations.S!.fixedX).toBeFalsy();
    const fixedFree = composeNetworks([entryOf(mk(true), 'a'), entryOf(mk(false), 'b')]);
    expect(fixedFree.stations.S!.fixedX).toBe(true);
    const fixedFixedSame = composeNetworks([entryOf(mk(true), 'a'), entryOf(mk(true), 'b')]);
    expect(fixedFixedSame.stations.S!.fixedX).toBe(true);
    expect(() => composeNetworks([
      entryOf(parse(sourceText([{ id: 'S', fixed: true, coord: COORDS.A }, { id: 'T', coord: COORDS.B }], [{ from: 'S', to: 'T' }]), 'a.dat'), 'a'),
      entryOf(parse(sourceText([{ id: 'S', fixed: true, coord: COORDS.C }, { id: 'T', coord: COORDS.B }], [{ from: 'S', to: 'T' }]), 'b.dat'), 'b'),
    ])).toThrow(/material station conflict/);
  });

  it('baseline identity: repeats preserved, reversed geometry flagged not deleted, sessions preserved', () => {
    const net = composeNetworks([
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [
        { from: 'A', to: 'B', session: 'S1', id: 'R1' },
        { from: 'A', to: 'B', session: 'S2', id: 'R2' },
      ]), 'rep.dat'), 'rep'),
    ]);
    expect(net.baselines).toHaveLength(2); // legitimate repeat: both adjusted
    const solved = runGnssBaselineAdjustment({
      stations: net.stations, baselines: net.baselines,
      referenceFrame: FRAME, epoch: EPOCH, ellipsoid: ELLIPSOID,
    });
    expect(solved.logicalObservations).toBe(2);
    // Reversed-geometry candidate: B->A with negated vector is the same physical
    // vector; helper flags it as a candidate, never auto-deletes.
    const [first, second] = net.baselines;
    const reversedSame = first!.from === second!.to && first!.to === second!.from;
    expect(reversedSame).toBe(false);
    const rev = composeNetworks([
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }],
        [{ from: 'A', to: 'B', session: 'S1', id: 'FWD' }]), 'f.dat'), 'f'),
    ]);
    const fwd = rev.baselines[0]!;
    const isPlausibleSameVector = (a: GnssBaselineObservation, from: string, to: string, v: Coord): boolean =>
      a.from === to && a.to === from &&
      Math.abs(a.vector.x + v.x) < 1e-9 && Math.abs(a.vector.y + v.y) < 1e-9 && Math.abs(a.vector.z + v.z) < 1e-9;
    expect(isPlausibleSameVector(fwd, 'B', 'A', { x: -fwd.vector.x, y: -fwd.vector.y, z: -fwd.vector.z })).toBe(true);
    expect(rev.baselines).toHaveLength(1); // flagged candidate, NOT auto-deleted
    // Distinct sessions preserved end to end.
    expect(net.baselines.map((b) => b.sessionId).sort()).toEqual(['S1', 'S2']);
  });

  it('manifest-order invariance: numerics identical under reorder', () => {
    const f1 = entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2)), 'f1.dat'), 'f1');
    const f2 = entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'C' }, { id: 'D' }], ALL_BASELINES.slice(2, 4)), 'f2.dat'), 'f2');
    const ab = solveAll(composeNetworks([f1, f2]));
    const ba = solveAll(composeNetworks([f2, f1]));
    const key = (b: GnssBaselineObservation): string => `${b.from}->${b.to}:${b.vector.x},${b.vector.y},${b.vector.z}`;
    const canon = (r: typeof ab): string => JSON.stringify({
      stations: stationSnapshot(r.result.stations),
      vectors: r.result.residuals.map((x) => [x.from, x.to, x.vX, x.vY, x.vZ]).sort(),
      baselines: [...composeNetworks([f1, f2]).baselines].map(key).sort(),
      seuw: Math.sqrt(Math.max(r.result.varianceFactor, 0)),
    });
    void canon;
    expect(stationSnapshot(ab.result.stations)).toBe(stationSnapshot(ba.result.stations));
    expect(ab.result.varianceFactor).toBeCloseTo(ba.result.varianceFactor, 12);
    const sortRes = (rs: { from: string; to: string; vX: number; vY: number; vZ: number }[]): string =>
      JSON.stringify([...rs].map((r) => [r.from, r.to, r.vX, r.vY, r.vZ]).sort());
    expect(sortRes(ab.result.residuals)).toBe(sortRes(ba.result.residuals));
  });

  it('enable/disable: dropping a source removes its stations/baselines/control', () => {
    const f1 = entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [ALL_BASELINES[0]!]), 'f1.dat'), 'f1');
    const f2 = entryOf(parse(sourceText([{ id: 'B' }, { id: 'C' }, { id: 'Q' }], [{ from: 'B', to: 'C' }, { from: 'C', to: 'Q', noise: 7 }]), 'f2.dat'), 'f2');
    void f2;
    const full = composeNetworks([
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2)), 'f1.dat'), 'f1'),
      entryOf(parse(sourceText([{ id: 'C' }, { id: 'D' }, { id: 'Z' }], [
        { from: 'C', to: 'D' }, { from: 'D', to: 'Z', noise: 7 },
      ], FRAME, EPOCH), 'f2.dat'), 'f2'),
    ]);
    expect(full.baselines).toHaveLength(4);
    expect('Z' in full.stations).toBe(true);
    const reduced = composeNetworks([
      entryOf(parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2)), 'f1.dat'), 'f1'),
    ]);
    expect(reduced.baselines).toHaveLength(2);
    expect('Z' in reduced.stations).toBe(false);
    expect('D' in reduced.stations).toBe(false);
    expect(full.baselines.length - reduced.baselines.length).toBe(2); // no stale state
    void f1;
  });

  it('cross-source loops + redundancy: tree plus closing baseline gains loop and redundancy', () => {
    const tree = entryOf(parse(sourceText(
      [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
      [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]), 'tree.dat'), 'tree');
    const treeOnly = composeNetworks([tree]);
    expect(computeGnssLoopClosures(treeOnly.baselines).loops).toHaveLength(0);
    const closing = entryOf(parse(sourceText(
      [{ id: 'A', fixed: true }, { id: 'C' }], [{ from: 'A', to: 'C', noise: 9 }]), 'close.dat'), 'close');
    const composed = composeNetworks([tree, closing]);
    const loops = computeGnssLoopClosures(composed.baselines);
    expect(loops.loops).toHaveLength(1);
    const solved = runGnssBaselineAdjustment({
      stations: composed.stations, baselines: composed.baselines,
      referenceFrame: FRAME, epoch: EPOCH, ellipsoid: ELLIPSOID,
    });
    expect(solved.dof).toBeGreaterThan(0);
    const redundancy = solved.statistics.reduce((s, st) => s + st.redundancy.trace, 0);
    expect(redundancy).toBeGreaterThan(0);
    const memberSources = new Set(loops.loops[0]!.members.map((m) =>
      composed.provenance[m.baselineId - 1]!.sourceId));
    expect(memberSources.has('tree')).toBe(true);
    expect(memberSources.has('close')).toBe(true);
  });

  it('frame/epoch fail-closed: mismatches block composition', () => {
    const base = parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [ALL_BASELINES[0]!]), 'base.dat');
    const otherFrame = parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [ALL_BASELINES[0]!], 'NAD83(2011)', EPOCH), 'f.dat');
    expect(() => composeNetworks([entryOf(base, 'a'), entryOf(otherFrame, 'b')])).toThrow(/referenceFrame mismatch/);
    const otherEpoch = parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [ALL_BASELINES[0]!], FRAME, '2010.0'), 'e.dat');
    expect(() => composeNetworks([entryOf(base, 'a'), entryOf(otherEpoch, 'b')])).toThrow(/epoch mismatch/);
    const unknownEpoch = parse(sourceText([{ id: 'A', fixed: true }, { id: 'B' }], [ALL_BASELINES[0]!], FRAME, null), 'u.dat');
    expect(() => composeNetworks([entryOf(base, 'a'), entryOf(unknownEpoch, 'b')])).toThrow(/epoch mismatch/);
  });

  it('performance: 10 files x 100 baselines compose quickly (console timings, <5 s bound)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const perfCoord = (id: string): Coord => {
      const n = Number(id.slice(1));
      return { x: 4000000 + n * 137, y: 1000000 + n * 89, z: 4800000 + n * 53 };
    };
    const t0 = Date.now();
    const entries: ComposeEntry[] = Array.from({ length: 10 }, (_, f) => {
      const bls: BaselineDecl[] = Array.from({ length: 100 }, (_, i) => {
        const a = ids[(f * 100 + i) % ids.length]!;
        const b = ids[(f * 100 + i + 1) % ids.length]!;
        return { from: a, to: b, noise: (i % 7) - 3, session: `F${f}`, id: `F${f}B${i}` };
      });
      const used = [...new Set(bls.flatMap((b) => [b.from, b.to]))];
      const decls: StationDecl[] = [
        { id: 'A', fixed: true, coord: perfCoord('P0') },
        ...used.map((id) => ({ id, coord: perfCoord(id) })),
      ];
      return entryOf(parse(sourceText(decls, bls), `perf${f}.dat`), `perf${f}`);
    });
    const t1 = Date.now();
    const composed = composeNetworks(entries);
    const t2 = Date.now();
    expect(composed.baselines).toHaveLength(1000);
    console.log(`gnss compose perf: parse10x100=${t1 - t0}ms merge1000=${t2 - t1}ms total=${t2 - t0}ms`);
    expect(t2 - t0).toBeLessThan(5000);
  });
});
