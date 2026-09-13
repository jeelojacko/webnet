/**
 * Phase 12H.1 — production composer unit tests (synthetic fixtures only).
 */
import { describe, expect, it } from 'vitest';
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  parseGnssBaselineText,
  type GnssBaselineNetworkInput,
} from '../../src/engine/gnssBaselineNetworkImport';
import {
  composeGnssBaselineNetworks,
  GNSS_MULTIFILE_ROUND_TOL_M,
  type GnssMultifileSource,
} from '../../src/engine/gnssMultifileComposition';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';

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
};

const text = (
  stations: Array<{ id: string; fixed?: boolean; coord?: Coord }>,
  baselines: Array<{ from: string; to: string; noise?: number; session?: string; id?: string }>,
  frame = FRAME,
  epoch: string | null | undefined = EPOCH,
  ellipsoid: string | null | undefined = ELLIPSOID,
): string => {
  const coordOf = (id: string): Coord =>
    stations.find((s) => s.id === id)?.coord ?? COORDS[id] ?? { x: 4000500, y: 1000500, z: 4800500 };
  const lines = [
    `FRAME ECEF ${frame}${epoch ? ` EPOCH ${epoch}` : ''}${ellipsoid ? ` ELLIPSOID ${ellipsoid}` : ''}`,
    'UNITS M',
  ];
  stations.forEach((s) => {
    const c = coordOf(s.id);
    lines.push(`GX ${s.id} ${c.x} ${c.y} ${c.z} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const from = coordOf(b.from);
    const to = coordOf(b.to);
    const j = (b.noise ?? 0) * 0.001;
    lines.push(
      `BL ${b.from} ${b.to} ${to.x - from.x + j} ${to.y - from.y - j} ${to.z - from.z + j} ID ${b.id ?? `B${i + 1}`} SESSION ${b.session ?? 'S1'}`,
    );
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const parse = (body: string, file: string): GnssBaselineNetworkInput => {
  const result = parseGnssBaselineText(body, file);
  if (!result.network) throw new Error(`parse failed: ${JSON.stringify(result.diagnostics)}`);
  return result.network;
};

const source = (
  network: GnssBaselineNetworkInput,
  sourceId: string,
  format: GnssMultifileSource['format'] = 'native',
): GnssMultifileSource => ({ network, sourceId, fileName: `${sourceId}.dat`, format });

const solve = (net: { stations: StationMap; baselines: GnssBaselineObservation[] }) =>
  runGnssBaselineAdjustment({
    stations: net.stations,
    baselines: net.baselines,
    referenceFrame: FRAME,
    epoch: EPOCH,
    ellipsoid: ELLIPSOID,
  });

describe('gnss multifile production composer', () => {
  it('frame/epoch/ellipsoid mismatches block, naming both sources and both values', () => {
    const base = parse(text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }]), 'a.dat');
    const otherFrame = parse(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }], 'NAD83(2011)'), 'b.dat',
    );
    const blocked = composeGnssBaselineNetworks([source(base, 'a'), source(otherFrame, 'b')]);
    expect(blocked.composed).toBeNull();
    expect(blocked.blockingErrors.join(' ')).toMatch(/referenceFrame mismatch/);
    expect(blocked.blockingErrors.join(' ')).toMatch(/a/);
    expect(blocked.blockingErrors.join(' ')).toMatch(/b/);
    expect(blocked.blockingErrors.join(' ')).toMatch(/NAD83/);
    const otherEpoch = parse(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }], FRAME, '2010.0'), 'c.dat',
    );
    expect(
      composeGnssBaselineNetworks([source(base, 'a'), source(otherEpoch, 'c')]).blockingErrors.join(' '),
    ).toMatch(/epoch mismatch.*c.*2010\.0/);
    const unknownEpoch = parse(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }], FRAME, null), 'u.dat',
    );
    const unknownBlocked = composeGnssBaselineNetworks([source(base, 'a'), source(unknownEpoch, 'u')]);
    expect(unknownBlocked.composed).toBeNull();
    expect(unknownBlocked.blockingErrors.join(' ')).toMatch(/epoch mismatch/);
    const noEllipsoid = parse(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }], FRAME, EPOCH, null), 'e.dat',
    );
    expect(
      composeGnssBaselineNetworks([source(base, 'a'), source(noEllipsoid, 'e')]).blockingErrors.join(' '),
    ).toMatch(/ellipsoid mismatch/);
  });

  it('station merge A-F with the 1e-9 boundary (first-seen wins, never averaged)', () => {
    expect(GNSS_MULTIFILE_ROUND_TOL_M).toBe(1e-9);
    // Small-magnitude coords keep 1e-9 diffs exactly representable
    // (at ECEF ~4e6, 1e-9 is ~1 ulp and rounds away; the rule is on the
    // coordinate VALUES, not their float spelling).
    const BASE: Coord = { x: 100, y: 200, z: 300 };
    const T: Coord = { x: 110, y: 205, z: 320 };
    const mk = (coord: Coord, fixed: boolean): GnssBaselineNetworkInput =>
      parse(text([{ id: 'S', fixed, coord }, { id: 'T', coord: T }], [{ from: 'S', to: 'T' }]), 't.dat');
    expect(composeGnssBaselineNetworks([source(mk(BASE, false), 'a'), source(mk(BASE, false), 'b')]).mergeNotes).toEqual([]);
    // Just under tolerance: accepted, first-seen kept, note recorded.
    // (Exact-equality edge is `worst > TOL blocks`; decimal 1e-9 itself is
    // not bit-exact in binary, so the test stays safely on either side.)
    const underBoundary = { ...BASE, x: BASE.x + 0.9e-9 };
    const noted = composeGnssBaselineNetworks([source(mk(BASE, false), 'a'), source(mk(underBoundary, false), 'b')]);
    expect(noted.composed).not.toBeNull();
    expect(noted.composed!.stations.S!.x).toBe(BASE.x);
    expect(noted.mergeNotes.some((n) => n.includes('rounding diff'))).toBe(true);
    const overBoundary = { ...BASE, x: BASE.x + 2e-9 };
    const blocked = composeGnssBaselineNetworks([source(mk(BASE, false), 'a'), source(mk(overBoundary, false), 'b')]);
    expect(blocked.composed).toBeNull();
    expect(blocked.blockingErrors.join(' ')).toMatch(/material station conflict 'S'/);
    const ff = composeGnssBaselineNetworks([source(mk(COORDS.A!, true), 'a'), source(mk(COORDS.A!, false), 'b')]);
    expect(ff.composed!.stations.S!.fixedX).toBe(true);
    expect(ff.mergeNotes.some((n) => n.includes('fixed+free'))).toBe(true);
    // Order never decides control: reversed order gives the same result.
    const ffReversed = composeGnssBaselineNetworks([source(mk(COORDS.A!, false), 'b'), source(mk(COORDS.A!, true), 'a')]);
    expect(ffReversed.composed!.stations.S!.fixedX).toBe(true);
    const alias = composeGnssBaselineNetworks([
      source(parse(text([{ id: 'A' }, { id: 'B' }], [{ from: 'A', to: 'B' }]), 'a.dat'), 'a'),
      source(parse(text([{ id: 'a' }, { id: 'B' }], [{ from: 'a', to: 'B' }]), 'b.dat'), 'b'),
    ]);
    expect(Object.keys(alias.composed!.stations).sort()).toEqual(['A', 'B', 'a']);
  });

  it('order-invariance: numerics identical under reorder, provenance follows order', () => {
    const f1 = source(parse(text([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]), 'f1.dat'), 'f1');
    const f2 = source(parse(text([{ id: 'A', fixed: true }, { id: 'C' }, { id: 'D' }], [{ from: 'C', to: 'D' }, { from: 'A', to: 'C', noise: 2 }]), 'f2.dat'), 'f2');
    const ab = composeGnssBaselineNetworks([f1, f2]);
    const ba = composeGnssBaselineNetworks([f2, f1]);
    expect(ab.composed).not.toBeNull();
    expect(ba.composed).not.toBeNull();
    const solvedAB = solve(ab.composed!);
    const solvedBA = solve(ba.composed!);
    // Canonical key-sorted comparison: insertion order follows merge
    // order (provenance), values must be identical.
    const canon = (stations: StationMap): string =>
      JSON.stringify(Object.keys(stations).sort().map((id) => [id, stations[id]]));
    expect(canon(solvedAB.stations)).toBe(canon(solvedBA.stations));
    expect(solvedAB.varianceFactor).toBeCloseTo(solvedBA.varianceFactor, 12);
    expect(ab.provenance.map((p) => p.sourceId)).toEqual(['f1', 'f1', 'f2', 'f2']);
    expect(ba.provenance.map((p) => p.sourceId)).toEqual(['f2', 'f2', 'f1', 'f1']);
  });

  it('datum stays downstream: free-only composition still fails preflight; fixed merge solves', () => {
    const free1 = source(parse(text([{ id: 'A' }, { id: 'B' }], [{ from: 'A', to: 'B' }]), 'a.dat'), 'a');
    const free2 = source(parse(text([{ id: 'B' }, { id: 'C' }], [{ from: 'B', to: 'C' }]), 'b.dat'), 'b');
    const freeOnly = composeGnssBaselineNetworks([free1, free2]);
    expect(freeOnly.composed).not.toBeNull();
    expect(() =>
      runGnssBaselinePreflight({
        stations: freeOnly.composed!.stations,
        baselines: freeOnly.composed!.baselines,
        referenceFrame: FRAME,
        epoch: EPOCH,
        ellipsoid: ELLIPSOID,
      }),
    ).toThrow(/no fully fixed/i);
    // No free-network support: no datum invented by composition.
    const withControl = composeGnssBaselineNetworks([
      source(parse(text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B' }]), 'a.dat'), 'a'),
      free2,
    ]);
    expect(withControl.composed).not.toBeNull();
    expect(solve(withControl.composed!).dof).toBeGreaterThanOrEqual(0);
  });
});
