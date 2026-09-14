/**
 * Phase 12J.4 Track RUNTIME (wasm tier): rnx2rtkp driver + worker protocol.
 *
 * Synthetic-only: no vendor corpus is committed or read here (the S32 local
 * corpus stays LOCAL-ONLY). Real-WASM CLI<->WASM exactness and repeat
 * determinism are proven by the 12J.1 evidence scripts; here the driver is
 * exercised against a fake MEMFS/callMain module for determinism,
 * isolation, and failure semantics, plus pure-function checks (.pos parse,
 * Q mapping, verified covariance order, S32 marker-reduction numbers).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildRnx2rtkpArgs,
  deriveIntervalSeconds,
  extractSp3Label,
  GNSS_RAW_MAX_INPUT_BYTES,
  GNSS_RAW_PROGRESS_STAGES,
  hashOptions,
  isRawGnssProcessingError,
  parsePosText,
  posLineToCovariance,
  reduceToMarker,
  runRawBaseline,
  stageInputs,
  wgs84Up,
  type GnssRawRnx2rtkpJob,
  type GnssRawWasmModule,
} from '../../src/engine/gnssRawRnx2rtkp';
import { buildAntexSubset } from '../../src/engine/gnssAntexSubset';
import { parseRinexObs } from '../../src/engine/gnssRinexHeader';
import {
  GNSS_RAW_WORKER_CHANNEL,
  isCurrentJob,
} from '../../src/engine/gnssRawWorkerProtocol';
import { handleGnssRawRun } from '../../src/workers/gnssRawWorker';

// S32 evidence constants (marker-ARP contract §5): TBC mark-to-mark plus
// the raw-vs-TBC offset; reduction must land within 5 mm of the reduced
// values using H_rov=2.0 / H_base=0.0083.
const S32_BASE: [number, number, number] = [-1283634.1259, -4726427.8882, 4074798.0251];
const S32_TBC = [5822.646, -5654.885, -4846.085];
const S32_RAW_DIFF = [-0.4055, -1.4539, 1.276];
const S32_REDUCED_DIFF = [-0.007, 0.021, -0.001];

const line = (
  time: string, x: number, y: number, z: number, q: number,
  sds: [number, number, number, number, number, number],
  ratio: number, sats = 7,
): string =>
  `${time} ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${q} ${sats} ` +
  sds.map((v) => v.toFixed(4)).join(' ') + ` 0.00 ${ratio.toFixed(1)}`;

const SDS: [number, number, number, number, number, number] =
  [0.0006, 0.0011, 0.001, 0.0005, -0.0007, -0.0005];

const posText = (body: string): string =>
  `% program : rnx2rtkp ver.EX 2.5.1\n% ref pos : x y z\n${body}\n`;

const mkJob = (over: Partial<GnssRawRnx2rtkpJob> = {}): GnssRawRnx2rtkpJob => ({
  baseObs: new Uint8Array([1, 2, 3]),
  roverObs: new Uint8Array([4, 5, 6]),
  nav: [new Uint8Array([7]), new Uint8Array([8])],
  baseXyz: [...S32_BASE] as [number, number, number],
  options: { elevationMaskDegrees: 10, intervalSeconds: 30 },
  from: 'P041',
  to: 'SIXTWO',
  baseAntenna: { marker: 'P041', antennaModel: 'TRM29659.00 SCIT', height: 0.0083, east: 0, north: 0 },
  roverAntenna: { marker: 'SIXTWO', antennaModel: 'TRM60158.00 NONE', height: 2.0, east: 0, north: 0 },
  hashes: { baseObsSha256: 'a', roverObsSha256: 'b', navSha256: ['c', 'd'], sp3Sha256: null },
  ...over,
});

/** Fake Emscripten surface: in-memory MEMFS + canned .pos written by callMain. */
const fakeModule = (nextPos: () => string | null, seen: string[][] = []): GnssRawWasmModule => {
  const files = new Map<string, Uint8Array | string>();
  return {
    FS: {
      mkdir(_p: string): void { /* exists */ },
      writeFile(p: string, d: Uint8Array): void { files.set(p, d); },
      readFile(p: string): string {
        const v = files.get(p);
        if (typeof v !== 'string') throw new Error(`missing ${p}`);
        return v;
      },
      unlink(p: string): void {
        if (!files.delete(p)) throw new Error(`absent ${p}`);
      },
    },
    callMain(args: string[]): number {
      seen.push(args);
      const pos = nextPos();
      if (pos != null) files.set('/work/out.pos', pos);
      return 0;
    },
  };
};

const fixPos = (dx = 0): string => {
  const x = S32_BASE[0] + S32_TBC[0] + S32_RAW_DIFF[0] + dx;
  const y = S32_BASE[1] + S32_TBC[1] + S32_RAW_DIFF[1];
  const z = S32_BASE[2] + S32_TBC[2] + S32_RAW_DIFF[2];
  return posText(
    `${line('2006/06/14 17:24:30', x, y, z, 1, SDS, 28.6)}\n` +
    `${line('2006/06/14 17:25:00', x, y, z, 1, SDS, 28.6)}`,
  );
};

const timeless = <T>(result: T): T => {
  const r = result as { provenance: { processedAt: string } };
  return { ...r, provenance: { ...r.provenance, processedAt: '<t>' } } as T;
};

// ---------------------------------------------------------------- real WASM --
// Committed synthetic fixtures (Track CORE generator); no vendor bytes.
const FIXDIR = join(process.cwd(), 'tests/fixtures/gnssRaw');
const fixBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXDIR, name)));
const sha256 = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

type RealFactory = () => Promise<GnssRawWasmModule>;
let realFactory: RealFactory | null = null;
const loadRealModule = async (): Promise<GnssRawWasmModule> => {
  realFactory ??= (await import(
    pathToFileURL(join(process.cwd(), 'cpp/build-wasm/rtklib-rnx2rtkp.js')).href
  ) as { default: RealFactory }).default;
  if (typeof realFactory !== 'function') throw new Error('Real gnss-raw WASM factory did not load.');
  const t0 = performance.now();
  const mod = await realFactory();
  console.log(`gnss-raw WASM init in ${(performance.now() - t0).toFixed(1)} ms`);
  return mod;
};

const SYN_BASE_XYZ: [number, number, number] = [-1284945.5806, -4795482.1918, 3993386.8674];
const realJob = (over: Partial<GnssRawRnx2rtkpJob> = {}): GnssRawRnx2rtkpJob => {
  const baseObs = fixBytes('base.06o');
  const roverObs = fixBytes('rover.06o');
  const nav = [fixBytes('nav.06n')];
  return {
    baseObs, roverObs, nav,
    baseXyz: [...SYN_BASE_XYZ] as [number, number, number],
    options: { elevationMaskDegrees: 10 },
    from: 'SYNB',
    to: 'SYNR',
    baseAntenna: { marker: 'SYNB', antennaModel: '', height: 0, east: 0, north: 0 },
    roverAntenna: { marker: 'SYNR', antennaModel: '', height: 0, east: 0, north: 0 },
    hashes: {
      baseObsSha256: sha256(baseObs), roverObsSha256: sha256(roverObs),
      navSha256: nav.map(sha256), sp3Sha256: null,
    },
    ...over,
  };
};

const JUNK_SP3 = [
  '#cP2024  1  1  0  0  0.00000000      24 ORBIT IGb14 HLM  IGS',
  '## 24001  0.00000000   0.00000000  900.00000000  59022',
  '%f M  0.000000000000000  1.250000000000000  0.000000000000000  0.000000000000000',
  '/* synthetic no-position product',
  '*  2024  1  1  0  0  0.00000000',
  'PG01 -12345.678  23456.789   1234.567   12.345',
  '',
].join('\n');

describe('gnss-raw driver + worker protocol (wasm tier, synthetic)', () => {
  it('parses .pos lines and maps Q to FIXED/FLOAT/FAILED', () => {
    const x = S32_BASE[0] + 1;
    const fixed = parsePosText(posText(line('2006/06/14 17:24:30', x, 0, 0, 1, SDS, 5)));
    expect(fixed).toHaveLength(1);
    expect(fixed[0]!.q).toBe(1);
    const r1 = runRawBaseline(fakeModule(() => posText(
      line('2006/06/14 17:24:30', x, 0, 0, 2, SDS, 1.5),
    )), mkJob());
    expect(r1.status).toBe('FLOAT');
    expect(r1.acceptance).toBe('PROCESSING_WARNING');
    const r2 = runRawBaseline(fakeModule(() => posText(
      line('2006/06/14 17:24:30', x, 0, 0, 5, SDS, 0),
    )), mkJob());
    expect(r2.status).toBe('FAILED');
    expect(r2.acceptance).toBe('PROCESSING_REJECTED');
  });

  it('maps covariance in the verified 12J.1 order (sdx,sdy,sdz,sdxy,sdyz,sdzx)', () => {
    const [l] = parsePosText(posText(line('2006/06/14 17:24:30', 0, 0, 0, 1, SDS, 5)));
    const cov = posLineToCovariance(l!);
    // xx=sdx^2, yy=sdy^2, zz=sdz^2; cross terms sign-preserving squares.
    expect(cov.xx).toBeCloseTo(3.6e-7, 15);
    expect(cov.yy).toBeCloseTo(1.21e-6, 15);
    expect(cov.zz).toBeCloseTo(1e-6, 15);
    expect(cov.xy).toBeCloseTo(2.5e-7, 15);
    expect(cov.yz).toBeCloseTo(-4.9e-7, 15);
    expect(cov.xz).toBeCloseTo(-2.5e-7, 15);
  });

  it('marker reduction reproduces the S32 contracted direction within 5 mm', () => {
    const raw: [number, number, number] = [
      S32_TBC[0] + S32_RAW_DIFF[0], S32_TBC[1] + S32_RAW_DIFF[1], S32_TBC[2] + S32_RAW_DIFF[2],
    ];
    const rover: [number, number, number] = [S32_BASE[0] + raw[0], S32_BASE[1] + raw[1], S32_BASE[2] + raw[2]];
    const reduced = reduceToMarker(raw, rover, S32_BASE, 2.0, 0.0083);
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(reduced[i]! - (S32_TBC[i]! + S32_REDUCED_DIFF[i]!))).toBeLessThan(0.005);
    }
    // wgs84Up is a unit vector at both ends.
    for (const p of [S32_BASE, rover] as const) {
      const u = wgs84Up(p[0], p[1], p[2]);
      expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 12);
    }
  });

  it('real WASM determinism: same module x3, fresh module, interleave A->B->A', async () => {
    const jobA = realJob();
    const jobB = realJob({ options: { elevationMaskDegrees: 15 } });
    const mod = await loadRealModule();
    const run = (m: GnssRawWasmModule, j: GnssRawRnx2rtkpJob) => {
      const t0 = performance.now();
      const res = timeless(runRawBaseline(m, j));
      console.log(`gnss-raw real run: ${(performance.now() - t0).toFixed(1)} ms status=${res.status}`);
      return res;
    };
    const t0 = performance.now();
    const a1 = run(mod, jobA);
    const a2 = run(mod, jobA);
    const a3 = run(mod, jobA);
    const b = run(mod, jobB);
    const a4 = run(mod, jobA);
    const fresh = run(await loadRealModule(), jobA);
    console.log(`gnss-raw real determinism: 6 runs in ${(performance.now() - t0).toFixed(1)} ms`);
    // Synthetic pair converges to FLOAT over all 13 epochs.
    expect(a1.status).toBe('FLOAT');
    expect(a1.solutionQuality.usedEpochs).toBe(13);
    expect(a1.solutionQuality.satellites).toBe(7);
    expect(a1.referenceFrame).toBe('WGS84(G1150)-class/broadcast');
    expect(a2).toEqual(a1);
    expect(a3).toEqual(a1);
    expect(a4).toEqual(a1);
    expect(fresh).toEqual(a1);
    // Mask differs -> options hash differs (no stale-option reuse).
    expect(b.provenance.optionsHash).not.toBe(a1.provenance.optionsHash);
  });

  it('ANTEX subset stages into the job (application unproven on synthetics)', async () => {
    // Honest contract: this proves exact-match staging + rinexhead conf wiring
    // on real WASM. Whether RTKLIB visibly moves the solution (dv > 0) depends
    // on the calibration data; on the current synthetic pair (including a
    // garbage-ANTEX probe) the solution is bit-identical, so application of
    // PCV to survey data remains unproven and the ANTEX verdict stays
    // REVIEW_ONLY. A dv > 0 branch is kept: if calibration ever moves the
    // solution, the test proves application instead of staging.
    // Required serials come from the fixture headers themselves (both
    // declare SYN-GENX00 NONE), so the subset build cannot drift from the
    // pair under test. RTKLIB does not gate on ANTEX validity dates (see
    // buildRnx2rtkpArgs): the expired satellite blocks in synth.atx ride
    // along silently and this run succeeding proves no complaint.
    const sourceText = readFileSync(join(FIXDIR, 'synth.atx'), 'utf8');
    const serials = [...new Set(['base.06o', 'rover.06o'].map((name) =>
      parseRinexObs(readFileSync(join(FIXDIR, name), 'utf8'))
        .metadata.antennaModel.trim().split(/\s+/).join(' '),
    ))].sort();
    expect(serials).toEqual(['SYN-GENX00 NONE']);
    const subset = await buildAntexSubset({
      sourceText,
      requiredReceiverSerials: serials,
      validAt: '2024-01-01T00:00:00.000Z',
    });
    expect(subset.receiverSerials).toEqual(['SYN-GENX00 NONE']);
    const mod = await loadRealModule();
    const plain = timeless(runRawBaseline(mod, realJob()));
    const calibrated = timeless(runRawBaseline(mod, realJob({
      options: {
        elevationMaskDegrees: 10,
        antexSubset: {
          bytes: subset.subsetBytes,
          sourceSha256: subset.sourceSha256,
          subsetSha256: subset.subsetSha256,
        },
      },
    })));
    expect(plain.status).not.toBe('FAILED');
    expect(calibrated.status).not.toBe('FAILED');
    const dv = Math.hypot(
      calibrated.deltaX - plain.deltaX,
      calibrated.deltaY - plain.deltaY,
      calibrated.deltaZ - plain.deltaZ,
    );
    if (dv > 0) {
      // Receiver PCV moved the solution: the correction path is applied,
      // not just staged.
      console.log(`ANTEX proof: receiver-PCV vectors differ by ${(dv * 1000).toFixed(3)} mm`);
      expect(dv).toBeGreaterThan(0);
      expect(calibrated.diagnostics.some((d) => d.includes(subset.subsetSha256))).toBe(true);
    } else {
      // Bit-identical geometry (zero PCV effect): prove staging instead —
      // the subset SHA reaches diagnostics and the conf selects rinexhead.
      console.log('ANTEX proof: vectors bit-identical; proving subset staging instead');
      expect(calibrated.diagnostics.some((d) => d.includes(subset.subsetSha256))).toBe(true);
      const written = new Map<string, Uint8Array>();
      const cap: GnssRawWasmModule = {
        FS: {
          mkdir(): void { /* exists */ },
          writeFile(p: string, d: Uint8Array): void { written.set(p, d); },
          readFile(): string { throw new Error('unread in conf capture'); },
          unlink(): void { /* absent */ },
        },
        callMain(): number { return 0; },
      };
      buildRnx2rtkpArgs(cap, realJob({
        options: {
          elevationMaskDegrees: 10,
          antexSubset: {
            bytes: subset.subsetBytes,
            sourceSha256: subset.sourceSha256,
            subsetSha256: subset.subsetSha256,
          },
        },
      }), ['/work/rover.obs', '/work/base.obs']);
      const conf = new TextDecoder().decode(written.get('/work/prec.conf')!);
      expect(conf).toContain('ant2-postype');
    }
  });

  it('deriveIntervalSeconds parses -t calendar time (30 s synthetic spacing)', () => {
    const x = S32_BASE[0] + 1;
    const text = posText([
      line('2006/06/14 17:24:30', x, 0, 0, 1, SDS, 5),
      line('2006/06/14 17:25:00', x, 0, 0, 1, SDS, 5),
      line('2006/06/14 17:25:30', x, 0, 0, 1, SDS, 5),
    ].join('\n'));
    expect(deriveIntervalSeconds(parsePosText(text))).toBe(30);
  });

  it('-ti follows the AUTO hint, explicit number wins, legacy omits', () => {
    const withHint = buildRnx2rtkpArgs(fakeModule(() => null), mkJob({
      options: { elevationMaskDegrees: 10, intervalSeconds: 'AUTO', resolvedIntervalSeconds: 30 },
    }), ['/work/rover.obs', '/work/base.obs']);
    expect(withHint).toContain('-ti');
    expect(withHint[withHint.indexOf('-ti') + 1]).toBe('30');
    const explicit = buildRnx2rtkpArgs(fakeModule(() => null), mkJob({
      options: { intervalSeconds: 15, resolvedIntervalSeconds: 30 },
    }), ['/work/rover.obs', '/work/base.obs']);
    expect(explicit[explicit.indexOf('-ti') + 1]).toBe('15');
    const legacy = buildRnx2rtkpArgs(fakeModule(() => null), mkJob({
      options: { intervalSeconds: 'AUTO' },
    }), ['/work/rover.obs', '/work/base.obs']);
    expect(legacy).not.toContain('-ti');
  });

  it('provenance splits intervalRequested AUTO from hint-resolved intervalResolved', () => {
    const r = runRawBaseline(fakeModule(() => fixPos()), mkJob({
      options: { intervalSeconds: 'AUTO', resolvedIntervalSeconds: 30 },
    }));
    expect(r.provenance.intervalRequested).toBe('AUTO');
    expect(r.provenance.intervalResolved).toBe(30);
  });

  it('unlinks stale outputs: a run that writes nothing fails, never returns stale', () => {
    let payload: string | null = fixPos();
    const mod = fakeModule(() => payload);
    const ok = runRawBaseline(mod, mkJob());
    expect(ok.status).toBe('FIXED');
    payload = null; // failing run writes no .pos
    expect(() => runRawBaseline(mod, mkJob())).toThrow();
  });

  it('real WASM no-leak: precise-options job then broadcast equals broadcast-only reference', async () => {
    const broadcast = realJob();
    const sp3 = new TextEncoder().encode(JUNK_SP3);
    const precise = realJob({
      sp3,
      options: { elevationMaskDegrees: 10, precise: true },
      hashes: { ...broadcast.hashes, sp3Sha256: sha256(sp3) },
    });
    const reference = timeless(runRawBaseline(await loadRealModule(), broadcast));
    const mod = await loadRealModule();
    // Junk SP3 yields no solution epochs: must fail closed, never stale.
    await expect((async () => runRawBaseline(mod, precise))()).rejects.toThrow();
    try {
      runRawBaseline(mod, precise);
      expect.unreachable('junk-SP3 precise job must fail closed');
    } catch (e: unknown) {
      expect(isRawGnssProcessingError(e, 'PROCESSOR_FAILURE')).toBe(true);
    }
    // Stale SP3/conf cannot leak: broadcast after precise equals reference.
    const after = timeless(runRawBaseline(mod, broadcast));
    expect(after).toEqual(reference);
    expect(after.provenance.ephemerisUsed).toBe('BROADCAST');
    expect(after.provenance.sp3Sha256).toBeNull();
  });

  it('SP3 label honesty: unknown stays PRODUCT_FRAME_UNKNOWN, known labels surface', () => {
    expect(extractSp3Label('#aP2006 some product\n')).toBeNull();
    expect(extractSp3Label('#aP2006 IGS0 test\n')).toBe('IGS0');
    expect(hashOptions({})).toBe(hashOptions({}));
  });

  it('final epoch decides status: fix-then-float reports FLOAT with a note', () => {
    const x = S32_BASE[0] + 1;
    const r = runRawBaseline(fakeModule(() => posText([
      line('2006/06/14 17:24:30', x, 0, 0, 1, SDS, 5),
      line('2006/06/14 17:25:00', x, 0, 0, 2, SDS, 1.5),
    ].join('\n'))), mkJob());
    expect(r.status).toBe('FLOAT');
    expect(r.acceptance).toBe('PROCESSING_WARNING');
    expect(r.solutionQuality.fixedEpochs).toBe(1);
    expect(r.acceptanceNotes.some((n) => n.includes('final epoch is float'))).toBe(true);
  });

  it('SP3 ignored without a precise request: no -k, WARNING, broadcast used', () => {
    const seen: string[][] = [];
    const mod = fakeModule(() => fixPos(), seen);
    const r = runRawBaseline(mod, mkJob({ sp3: new Uint8Array([1]) }));
    expect(seen[0]).not.toContain('-k');
    expect(r.acceptance).toBe('PROCESSING_WARNING');
    expect(r.acceptanceNotes.some((n) => n.includes('SP3 ignored'))).toBe(true);
    expect(r.provenance.ephemerisRequested).toBe('BROADCAST');
    expect(r.provenance.ephemerisUsed).toBe('BROADCAST');
    expect(r.referenceFrame).toBe('WGS84(G1150)-class/broadcast');
  });

  it('SP3 precise path stages a conf selecting EPHOPT_PREC (ladder pattern)', () => {
    const seen: string[][] = [];
    const mod = fakeModule(() => fixPos(), seen);
    runRawBaseline(mod, mkJob({
      sp3: new Uint8Array([1]),
      options: { elevationMaskDegrees: 10, precise: true },
      hashes: { baseObsSha256: 'a', roverObsSha256: 'b', navSha256: ['c'], sp3Sha256: 'e' },
    }));
    const args = seen[0]!;
    expect(args).toContain('-k');
    expect(args).toContain('/work/prec.conf');
    expect(args.filter((a) => a.endsWith('.sp3'))).toHaveLength(1);
  });

  it('builds the pinned static args (-p 3 -f 2 -m mask -sys G -e -t -o -r)', () => {
    const seen: string[][] = [];
    const mod = fakeModule(() => fixPos(), seen);
    stageInputs(mod, mkJob());
    const args = buildRnx2rtkpArgs(mod, mkJob({
      options: {
        elevationMaskDegrees: 10, intervalSeconds: 30,
        windowStart: '2006/06/14 17:24:30', windowStop: '2006/06/14 18:10:30',
      },
    }), ['/work/rover.obs', '/work/base.obs']);
    expect(args.slice(0, 8)).toEqual(['-p', '3', '-f', '2', '-m', '10', '-sys', 'G']);
    // Window date/time split into separate argv tokens (rtklib convention).
    expect(args).toContain('2006/06/14');
    expect(args).toContain('17:24:30');
    expect(args).toContain('-e');
    expect(args).toContain('-t');
    expect(args).toContain('-o');
    expect(args).toContain('-r');
    expect(seen).toHaveLength(0);
  });

  it('rejects oversized inputs with MEMORY_OR_SIZE_LIMIT', () => {
    const big = new Uint8Array(GNSS_RAW_MAX_INPUT_BYTES + 1);
    expect(() => runRawBaseline(fakeModule(() => fixPos()), mkJob({ baseObs: big })))
      .toThrow();
    try {
      runRawBaseline(fakeModule(() => fixPos()), mkJob({ baseObs: big }));
      expect.unreachable();
    } catch (e: unknown) {
      expect(isRawGnssProcessingError(e, 'MEMORY_OR_SIZE_LIMIT')).toBe(true);
    }
  });

  it('nonzero antenna E/N warns; horizontal offset is not reduced', () => {
    const r = runRawBaseline(fakeModule(() => fixPos()), mkJob({
      roverAntenna: { marker: 'SIXTWO', antennaModel: 'X', height: 2.0, east: 0.1, north: 0 },
    }));
    expect(r.acceptance).toBe('PROCESSING_WARNING');
    expect(r.acceptanceNotes.some((n) => n.includes('E/N'))).toBe(true);
  });

  it('worker handler posts the 7 stages in order then success (fresh module per job)', async () => {
    const posted: { kind: string; stage?: string }[] = [];
    let loads = 0;
    const t0 = performance.now();
    await handleGnssRawRun(
      { kind: 'gnss-raw-run', channel: GNSS_RAW_WORKER_CHANNEL, jobId: 'j1', job: mkJob() },
      (m) => { posted.push({ kind: m.kind, stage: 'stage' in m ? m.stage : undefined }); },
      () => { loads += 1; return Promise.resolve(fakeModule(() => fixPos())); },
    );
    console.log(`gnss-raw worker handle: ${(performance.now() - t0).toFixed(1)} ms, loads=${loads}`);
    expect(loads).toBe(1);
    expect(posted.map((p) => p.kind)).toEqual([
      ...GNSS_RAW_PROGRESS_STAGES.map(() => 'gnss-raw-progress'),
      'gnss-raw-success',
    ]);
    expect(posted.slice(0, 7).map((p) => p.stage)).toEqual([...GNSS_RAW_PROGRESS_STAGES]);
  });

  it('job tokens: only the live jobId is accepted (cancel/supersede drops stale)', () => {
    expect(isCurrentJob('j1', 'j1')).toBe(true);
    expect(isCurrentJob('j2', 'j1')).toBe(false);
    expect(isCurrentJob(null, 'j1')).toBe(false);
  });

  // Manual-only: local S32 vendor corpus is never committed; skipped in CI.
  const CORPUS = join(process.env['HOME'] ?? '~', 'Downloads/webnet-gnss-12e/raw-baselines');
  const S32_FILES = ['01241653.06o', 'p0411650_2.06o', '01241653.06n', 'p0411650_2.06n'];
  const hasCorpus = S32_FILES.every((f) => existsSync(join(CORPUS, f)));
  it.runIf(hasCorpus)('local-corpus parity: S32 reduced vector lands within 50 mm of TBC', async () => {
    const corpusBytes = (f: string): Uint8Array =>
      new Uint8Array(readFileSync(join(CORPUS, f)));
    const t0 = performance.now();
    const res = runRawBaseline(await loadRealModule(), {
      baseObs: corpusBytes('p0411650_2.06o'),
      roverObs: corpusBytes('01241653.06o'),
      nav: [corpusBytes('01241653.06n'), corpusBytes('p0411650_2.06n')],
      baseXyz: [-1283634.1259, -4726427.8882, 4074798.0251],
      options: {
        elevationMaskDegrees: 15, intervalSeconds: 30,
        windowStart: '2006/06/14 17:24:30', windowStop: '2006/06/14 18:10:30',
      },
      from: 'P041',
      to: 'SIXTWO',
      baseAntenna: { marker: 'P041', antennaModel: 'TRM29659.00 SCIT', height: 0.0083, east: 0, north: 0 },
      roverAntenna: { marker: 'SIXTWO', antennaModel: 'TRM60158.00 NONE', height: 2.0, east: 0, north: 0 },
      hashes: { baseObsSha256: 'local', roverObsSha256: 'local', navSha256: ['local', 'local'], sp3Sha256: null },
    });
    console.log(`gnss-raw S32 parity run in ${(performance.now() - t0).toFixed(1)} ms`);
    expect(res.status).toBe('FIXED');
    const tbc = [5822.646, -5654.885, -4846.085];
    const d3 = Math.hypot(res.deltaX - tbc[0]!, res.deltaY - tbc[1]!, res.deltaZ - tbc[2]!);
    expect(d3).toBeLessThan(0.05);
  });
});
