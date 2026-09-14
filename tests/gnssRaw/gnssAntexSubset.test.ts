/**
 * Phase 12J.9 Track B — agent-tier tests for the ANTEX subset production path.
 *
 * Synthetic fixtures only (tiny hand-made ANTEX text); no vendor data.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAntexSubset,
  createAntexSubsetCache,
  extractAntexSubsetText,
  getCachedAntexSubset,
  storeAntexSubset,
} from '../../src/engine/gnssAntexSubset';
import type { GnssRawWasmModule } from '../../src/engine/gnssRawRnx2rtkp';
import {
  buildRnx2rtkpArgs,
  hashOptions,
} from '../../src/engine/gnssRawRnx2rtkp';

const tagged = (body: string, tag: string): string => `${body.padEnd(60, ' ')}${tag}`;

const rcvBlock = (serial: string, marker: string): string[] => [
  tagged('', 'START OF ANTENNA'),
  tagged(serial, 'TYPE / SERIAL NO'),
  tagged(marker, 'MARKER NAME'),
  tagged('G01', 'START OF FREQUENCY'),
  tagged('G01', 'END OF FREQUENCY'),
  tagged('', 'END OF ANTENNA'),
];

const satBlock = (): string[] => [
  tagged('', 'START OF ANTENNA'),
  tagged('BLOCK IIF G01 G063 2011-036A', 'TYPE / SERIAL NO'),
  tagged('G01', 'START OF FREQUENCY'),
  tagged('G01', 'END OF FREQUENCY'),
  tagged('', 'END OF ANTENNA'),
];

const SOURCE = [
  tagged('1.4', 'ANTEX VERSION / SYST'),
  tagged('', 'END OF HEADER'),
  ...rcvBlock('TRM59800.00 NONE', 'KEEP_A'),
  ...rcvBlock('LEIAR25.R4 LEIT', 'KEEP_B'),
  ...rcvBlock('ASH700936D_M NONE', 'DROP_ME'),
  ...satBlock(),
  tagged('', 'END OF FILE'),
].join('\n');

const REQUIRED = ['TRM59800.00 NONE', 'LEIAR25.R4 LEIT'] as const;

const fakeModule = (): GnssRawWasmModule & { files: Map<string, Uint8Array | string> } => {
  const files = new Map<string, Uint8Array | string>();
  return {
    files,
    FS: {
      mkdir(_path: string): void {},
      writeFile(path: string, data: Uint8Array): void {
        files.set(path, data);
      },
      readFile(_path: string, _opts: { encoding: 'utf8' }): string {
        throw new Error('not needed');
      },
      unlink(path: string): void {
        files.delete(path);
      },
    },
    callMain(_args: string[]): number {
        return 0;
      },
  };
};

describe('extractAntexSubsetText', () => {
  it('keeps exact receiver entries plus sats and drops everything else', () => {
    const out = extractAntexSubsetText({
      sourceText: SOURCE,
      requiredReceiverSerials: [...REQUIRED],
    });
    expect(out.receiverSerials).toEqual(['LEIAR25.R4 LEIT', 'TRM59800.00 NONE']);
    expect(out.satelliteBlockCount).toBe(1);
    expect(out.subsetText).toContain('KEEP_A');
    expect(out.subsetText).toContain('KEEP_B');
    expect(out.subsetText).toContain('BLOCK IIF');
    expect(out.subsetText).not.toContain('DROP_ME');
    expect(out.subsetText).not.toContain('ASH700936D_M');
  });

  it('is byte-deterministic across builds', async () => {
    const a = await buildAntexSubset({ sourceText: SOURCE, requiredReceiverSerials: [...REQUIRED] });
    const b = await buildAntexSubset({ sourceText: SOURCE, requiredReceiverSerials: [...REQUIRED] });
    expect(a.subsetText).toBe(b.subsetText);
    expect(a.subsetSha256).toBe(b.subsetSha256);
    expect(a.sourceSha256).toBe(b.sourceSha256);
    expect(a.subsetBytes).toEqual(b.subsetBytes);
  });

  it('rejects fuzzy substitution instead of guessing a radome variant', () => {
    expect(() =>
      extractAntexSubsetText({
        sourceText: SOURCE,
        requiredReceiverSerials: ['LEIAR25.R4 NONE'],
      }),
    ).toThrow(/Refusing fuzzy substitution/);
  });

  it('enforces the byte bound', () => {
    expect(() =>
      extractAntexSubsetText({
        sourceText: SOURCE,
        requiredReceiverSerials: [...REQUIRED],
        maxBytes: 10,
      }),
    ).toThrow(/exceeds/);
  });
  it('is order-invariant: serial permutation gives identical bytes/hash (12J.10 §14)', async () => {
    const fwd = await buildAntexSubset({ sourceText: SOURCE, requiredReceiverSerials: [...REQUIRED] });
    const rev = await buildAntexSubset({
      sourceText: SOURCE, requiredReceiverSerials: [...REQUIRED].reverse(),
    });
    expect(rev.subsetBytes).toEqual(fwd.subsetBytes);
    expect(rev.subsetSha256).toBe(fwd.subsetSha256);
    expect(rev.subsetText).toBe(fwd.subsetText);
    // validAt is provenance-only: different dates, same subset bytes.
    const dated = await buildAntexSubset({
      sourceText: SOURCE, requiredReceiverSerials: [...REQUIRED], validAt: '2024-06-01T00:00:00.000Z',
    });
    expect(dated.subsetBytes).toEqual(fwd.subsetBytes);
  });
});

describe('antex cache isolation (12J.10 §15)', () => {
  it('A, then B, then A again: A1 === A2, B distinct, no stale state', async () => {
    const cache = createAntexSubsetCache();
    const a1 = storeAntexSubset(cache, await buildAntexSubset({
      sourceText: SOURCE, requiredReceiverSerials: ['TRM59800.00 NONE'],
    }));
    const b = storeAntexSubset(cache, await buildAntexSubset({
      sourceText: SOURCE, requiredReceiverSerials: ['LEIAR25.R4 LEIT'],
    }));
    const a2 = storeAntexSubset(cache, await buildAntexSubset({
      sourceText: SOURCE, requiredReceiverSerials: ['TRM59800.00 NONE'],
    }));
    expect(a2).toBe(a1);
    expect(a2.subsetBytes).toEqual(a1.subsetBytes);
    expect(b.subsetSha256).not.toBe(a1.subsetSha256);
    expect(b.receiverSerials).toEqual(['LEIAR25.R4 LEIT']);
    expect(a2.receiverSerials).toEqual(['TRM59800.00 NONE']);
    expect(getCachedAntexSubset(cache, a1.subsetSha256)).toBe(a1);
    expect(getCachedAntexSubset(cache, b.subsetSha256)).toBe(b);
  });
});

describe('antex subset cache', () => {
  it('returns the same object on a cache hit without reparse', async () => {
    const cache = createAntexSubsetCache();
    const built = await buildAntexSubset({
      sourceText: SOURCE,
      requiredReceiverSerials: [...REQUIRED],
    });
    const first = storeAntexSubset(cache, built);
    const second = storeAntexSubset(cache, built);
    expect(second).toBe(first);
    expect(getCachedAntexSubset(cache, built.subsetSha256)).toBe(first);
    expect(getCachedAntexSubset(cache, 'missing')).toBeUndefined();
  });
});

describe('rnx2rtkp ANTEX staging', () => {
  it('stages the subset via -k conf without changing legacy args when absent', () => {
    const mod = fakeModule();
    const baseJob = {
      baseObs: new Uint8Array([1]),
      roverObs: new Uint8Array([2]),
      nav: [],
      baseXyz: [1, 2, 3] as unknown as readonly [number, number, number],
      from: 'A',
      to: 'B',
      baseAntenna: { marker: 'A', antennaModel: '', height: 0, east: 0, north: 0 },
      roverAntenna: { marker: 'B', antennaModel: '', height: 0, east: 0, north: 0 },
      hashes: { baseObsSha256: 'b', roverObsSha256: 'r', navSha256: [], sp3Sha256: null },
    };
    const legacy = buildRnx2rtkpArgs(mod, { ...baseJob, options: { precise: false } }, []);
    expect(legacy).not.toContain('-k');

    const preciseOnly = buildRnx2rtkpArgs(
      mod,
      { ...baseJob, options: { precise: true }, sp3: new Uint8Array([9]) },
      [],
    );
    expect(preciseOnly).toContain('-k');
    expect(new TextDecoder().decode(mod.files.get('/work/prec.conf') as Uint8Array))
      .toBe('pos1-sateph=precise\n');

    const withAntex = buildRnx2rtkpArgs(
      mod,
      {
        ...baseJob,
        options: {
          antexSubset: { bytes: new Uint8Array([7]), sourceSha256: 's', subsetSha256: 'u' },
        },
      },
      [],
    );
    expect(withAntex).toContain('-k');
    const conf = new TextDecoder().decode(mod.files.get('/work/prec.conf') as Uint8Array);
    expect(conf).toContain('file-rcvantfile=/work/antex.atx');
    expect(conf).toContain('file-satantfile=/work/antex.atx');
    // 12J.10 §7: both endpoints resolve antenna position/type from their
    // own RINEX headers — never one-sided. Explicit anttype selects the
    // exact receiver PCV (RTKLIB default "" never matches); explicit
    // antdel steers the PCV point without moving the fixed base.
    expect(conf).toContain('ant1-postype=rinexhead');
    expect(conf).toContain('ant2-postype=rinexhead');
    expect(conf).toContain('ant1-anttype=');
    expect(conf).toContain('ant2-anttype=');
    expect(conf).toContain('ant1-antdelu=0');
    expect(conf).toContain('ant2-antdelu=0');
    // 12J.10: -r resets refpos=rovpos=XYZ in rnx2rtkp's second argv pass,
    // silently voiding the conf postypes — so ANTEX jobs must omit it.
    expect(withAntex).not.toContain('-r');
    // Non-ANTEX jobs keep the legacy -r anchor byte-identical.
    expect(legacy).toContain('-r');
    expect(legacy.slice(legacy.indexOf('-r') + 1, legacy.indexOf('-r') + 4)).toEqual(['1', '2', '3']);
    expect(mod.files.get('/work/antex.atx')).toEqual(new Uint8Array([7]));
  });

  it('keeps the options hash stable when no subset is staged', () => {
    expect(hashOptions({})).toBe(hashOptions({}));
    expect(
      hashOptions({ antexSubset: { bytes: new Uint8Array(), sourceSha256: 's', subsetSha256: 'u' } }),
    ).not.toBe(hashOptions({}));
  });
});
