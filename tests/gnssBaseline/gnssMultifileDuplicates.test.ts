/**
 * Phase 12H.1 — indexed duplicate detector tests (synthetic fixtures only).
 */
import { describe, expect, it } from 'vitest';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  parseGnssBaselineText,
  type GnssBaselineNetworkInput,
} from '../../src/engine/gnssBaselineNetworkImport';
import {
  composeGnssBaselineNetworks,
  type GnssMultifileSource,
} from '../../src/engine/gnssMultifileComposition';
import {
  classifyGnssDuplicates,
  strongDuplicateBlocks,
} from '../../src/engine/gnssMultifileDuplicates';
import type { GnssMultifileProvenance } from '../../src/engine/gnssMultifileComposition';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';

const text = (
  stations: Array<{ id: string; fixed?: boolean }>,
  baselines: Array<{ from: string; to: string; session?: string; solution?: string; id?: string; dx?: number }>,
): string => {
  const coords: Record<string, [number, number, number]> = {
    A: [4000000, 1000000, 4800000],
    B: [4000100, 1000050, 4800020],
    C: [4000200, 999950, 4800100],
  };
  const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
  stations.forEach((s) => {
    const c = coords[s.id] ?? [4000500, 1000500, 4800500];
    lines.push(`GX ${s.id} ${c[0]} ${c[1]} ${c[2]} ${s.fixed ? 'FIXED' : 'FREE'}`);
  });
  baselines.forEach((b, i) => {
    const from = coords[b.from] ?? [4000500, 1000500, 4800500];
    const to = coords[b.to] ?? [4000500, 1000500, 4800500];
    const dx = b.dx ?? 0;
    lines.push(
      `BL ${b.from} ${b.to} ${to[0] - from[0] + dx} ${to[1] - from[1]} ${to[2] - from[2]} ID ${b.id ?? `B${i + 1}`} SESSION ${b.session ?? 'S1'} SOLUTION ${b.solution ?? 'Q1'}`,
    );
    lines.push(COV);
  });
  return `${lines.join('\n')}\n`;
};

const parse = (body: string, file: string): GnssBaselineNetworkInput => {
  const result = parseGnssBaselineText(body, file);
  if (!result.network) throw new Error('parse failed');
  return result.network;
};

const compose2 = (aBody: string, bBody: string): { baselines: GnssBaselineObservation[]; provenance: GnssMultifileProvenance[] } => {
  const a = parse(aBody, 'a.dat');
  const b = parse(bBody, 'b.dat');
  const sources: GnssMultifileSource[] = [
    { network: a, sourceId: 'a', fileName: 'a.dat', format: 'native' },
    { network: b, sourceId: 'b', fileName: 'b.dat', format: 'native' },
  ];
  const composed = composeGnssBaselineNetworks(sources);
  if (!composed.composed) throw new Error('compose blocked unexpectedly');
  return { baselines: composed.composed.baselines, provenance: composed.provenance };
};

describe('gnss multifile duplicate detector', () => {
  it('LEGITIMATE repeats emit no candidate and both observations are retained', () => {
    const { baselines, provenance } = compose2(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S1', solution: 'Q1' }]),
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S2', solution: 'Q2', dx: 0.001 }]),
    );
    expect(baselines).toHaveLength(2);
    const candidates = classifyGnssDuplicates(baselines, provenance);
    expect(candidates).toEqual([]);
  });

  it('STRONG across different sources blocks, naming both source records', () => {
    const { baselines, provenance } = compose2(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S1', solution: 'Q1', id: 'V1' }]),
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S1', solution: 'Q1', id: 'V1' }]),
    );
    const candidates = classifyGnssDuplicates(baselines, provenance);
    const strong = candidates.filter((c) => c.class === 'STRONG_DUPLICATE');
    expect(strong).toHaveLength(1);
    expect(strong[0]!.blocksRun).toBe(true);
    expect(strong[0]!.reason).toMatch(/a.*b|b.*a/);
    const blocks = strongDuplicateBlocks(candidates);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(/compose blocked/);
    // Never silently deleted at the math layer: both retained.
    expect(baselines).toHaveLength(2);
  });

  it('identical vectors without session certainty downgrade to POSSIBLE (warn, retain)', () => {
    const mkNoSession = (file: string): GnssBaselineNetworkInput => {
      const lines = [
        `FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`,
        'UNITS M',
        'GX A 4000000 1000000 4800000 FIXED',
        'GX B 4000100 1000050 4800020 FREE',
        'BL A B 100 50 20 ID V1',
        COV,
      ];
      const result = parseGnssBaselineText(`${lines.join('\n')}\n`, file);
      if (!result.network) throw new Error('parse failed');
      return result.network;
    };
    const composed = composeGnssBaselineNetworks([
      { network: mkNoSession('a.dat'), sourceId: 'a', fileName: 'a.dat', format: 'native' },
      { network: mkNoSession('b.dat'), sourceId: 'b', fileName: 'b.dat', format: 'native' },
    ]);
    if (!composed.composed) throw new Error('compose blocked unexpectedly');
    const candidates = classifyGnssDuplicates(composed.composed.baselines, composed.provenance);
    expect(candidates.some((c) => c.class === 'STRONG_DUPLICATE')).toBe(false);
    expect(candidates.some((c) => c.class === 'POSSIBLE_DUPLICATE' && !c.blocksRun)).toBe(true);
    expect(composed.composed.baselines).toHaveLength(2);
  });

  it('REVERSED candidates warn only and are never auto-flipped or deleted', () => {
    const { baselines, provenance } = compose2(
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S1', solution: 'Q1' }]),
      text([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'B', to: 'A', session: 'S9', solution: 'Q9', dx: 0 }]),
    );
    // B->A with negated vector: the helper text above uses the same delta,
    // so construct the true negation explicitly for the predicate.
    const fwd = baselines[0]!;
    const rev: GnssBaselineObservation = {
      ...baselines[1]!,
      from: 'B',
      to: 'A',
      vector: { x: -fwd.vector.x, y: -fwd.vector.y, z: -fwd.vector.z },
    };
    const pair = [fwd, rev];
    const prov = [...provenance];
    const candidates = classifyGnssDuplicates(pair, prov);
    const reversed = candidates.filter((c) => c.class === 'REVERSED_CANDIDATE');
    expect(reversed).toHaveLength(1);
    expect(reversed[0]!.blocksRun).toBe(false);
    expect(pair).toHaveLength(2);
  });

  it('indexed detector is ~O(n): 2000 baselines classify quickly with few candidates', () => {
    const stations: Array<{ id: string; fixed?: boolean }> = [{ id: 'A', fixed: true }];
    for (let i = 0; i < 200; i += 1) stations.push({ id: `P${i}` });
    const baselines = [];
    for (let i = 0; i < 2000; i += 1) {
      baselines.push({ from: 'A', to: `P${i % 200}`, session: `S${i}`, solution: `Q${i}`, id: `V${i}`, dx: i * 1e-6 });
    }
    const network = parse(text(stations, baselines), 'big.dat');
    const composed = composeGnssBaselineNetworks([
      { network, sourceId: 'big', fileName: 'big.dat', format: 'native' },
    ]);
    if (!composed.composed) throw new Error('compose blocked unexpectedly');
    const start = Date.now();
    const candidates = classifyGnssDuplicates(composed.composed.baselines, composed.provenance);
    const elapsed = Date.now() - start;
    // Same-endpoint groups stay small (10 per station pair); only
    // near-identical vectors flag. Quadratic pairwise would dominate here.
    expect(elapsed).toBeLessThan(2000);
    expect(candidates.length).toBeLessThan(200);
  });
});
