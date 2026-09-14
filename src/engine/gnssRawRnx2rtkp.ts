/**
 * Phase 12J.4 Track RUNTIME — node+worker portable rnx2rtkp driver (NO DOM).
 *
 * Stages fixed-name inputs into WASM MEMFS, runs the pinned static baseline,
 * parses the `.pos` solution, maps covariance per the verified 12J.1 order,
 * reduces phase-center→marker along WGS84 ellipsoidal Up, and assembles a
 * ProcessedRawGnssBaseline. Never mutates solve state or the project.
 *
 * Per-job MEMFS bound: each staged file capped at 32 MiB; typical job holds
 * base+rover obs, ≤2 nav files, optional SP3, one .pos output (< ~10 MB).
 */

import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';
import type { GnssBaselineCovariance } from './gnssBaselineTypes';
import {
  GNSS_RAW_PROCESSOR_ID,
  type ProcessedRawGnssBaseline,
  type RawGnssProcessingError,
} from './gnssRawTypes';

/** Pinned build provenance (recorded from scripts/gnss/gnss12j1WasmStatic.ts). */
export const GNSS_RAW_EMCC_VERSION = '6.0.9-git (4e4223852a0835923411059a3929907d7df1232e)';
export const GNSS_RAW_COMPILE_FLAGS = [
  '-std=c99', '-O2', '-DTRACE', '-DENAGLO', '-DENAQZS', '-DENAGAL',
  '-DENACMP', '-DENAIRN', '-DNFREQ=4', '-DNEXOBS=3',
  '-sMODULARIZE=1', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=128MB',
  '-sSTACK_SIZE=8MB', '-sENVIRONMENT=node', '-sFORCE_FILESYSTEM=1',
] as const;

/** Per-file staging cap: oversized input fails closed, never truncates. */
export const GNSS_RAW_MAX_INPUT_BYTES = 32 * 1024 * 1024;

/** The 7 coarse worker-visible stages, in order. */
export const GNSS_RAW_PROGRESS_STAGES = [
  'Reading files',
  'Validating RINEX',
  'Preparing observations',
  'Processing static baseline',
  'Resolving ambiguities',
  'Building covariance',
  'Finalizing result',
] as const;

export type GnssRawProgressStage = (typeof GNSS_RAW_PROGRESS_STAGES)[number];

/** Minimal structural surface needed from the Emscripten module. */
export interface GnssRawWasmModule {
  FS: {
    mkdir(_path: string): void;
    writeFile(_path: string, _data: Uint8Array): void;
    readFile(_path: string, _opts: { encoding: 'utf8' }): string;
    unlink(_path: string): void;
  };
  callMain(_args: string[]): number;
}

export interface GnssRawEndpointMeta {
  readonly marker: string;
  readonly antennaModel: string;
  readonly height: number;
  readonly east: number;
  readonly north: number;
}

export interface GnssRawRnx2rtkpOptions {
  readonly elevationMaskDegrees?: number;
  readonly intervalSeconds?: number | 'AUTO';
  /** Preflight-resolved AUTO interval; used for -ti when intervalSeconds is not an explicit number. */
  readonly resolvedIntervalSeconds?: number;
  readonly windowStart?: string | null;
  readonly windowStop?: string | null;
  readonly precise?: boolean;
}

export interface GnssRawRnx2rtkpJob {
  readonly baseObs: Uint8Array;
  readonly roverObs: Uint8Array;
  readonly nav: readonly Uint8Array[];
  readonly sp3?: Uint8Array;
  readonly baseXyz: readonly [number, number, number];
  readonly options?: GnssRawRnx2rtkpOptions;
  readonly from: string;
  readonly to: string;
  readonly baseAntenna: GnssRawEndpointMeta;
  readonly roverAntenna: GnssRawEndpointMeta;
  readonly hashes: {
    readonly baseObsSha256: string;
    readonly roverObsSha256: string;
    readonly navSha256: readonly string[];
    readonly sp3Sha256: string | null;
  };
}

export type GnssRawProgressCallback = (_stage: GnssRawProgressStage) => void;

const WORK = '/work';
const NAMES = {
  roverObs: `${WORK}/rover.obs`,
  baseObs: `${WORK}/base.obs`,
  out: `${WORK}/out.pos`,
  conf: `${WORK}/prec.conf`,
} as const;
const navName = (index: number): string => `${WORK}/nav${index}.nav`;
const sp3Name = (index: number): string => `${WORK}/sp3_${index}.sp3`;

const fail = (code: RawGnssProcessingError['code'], message: string, detail?: string): never => {
  const error = new Error(message) as Error & { rawGnss: RawGnssProcessingError };
  error.rawGnss = detail == null ? { code, message } : { code, message, detail };
  throw error;
};

export const isRawGnssProcessingError = (
  error: unknown,
  code: RawGnssProcessingError['code'],
): boolean =>
  error instanceof Error && (error as { rawGnss?: { code?: string } }).rawGnss?.code === code;

const checkSize = (label: string, data: Uint8Array): void => {
  if (data.byteLength > GNSS_RAW_MAX_INPUT_BYTES) {
    fail('MEMORY_OR_SIZE_LIMIT',
      `${label} exceeds the 32 MiB per-file staging cap (${data.byteLength} bytes).`);
  }
};

/** WGS84 ellipsoidal Up unit vector at an ECEF point (12J.2 ladder convention). */
export const wgs84Up = (x: number, y: number, z: number): [number, number, number] => {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 5; i += 1) {
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * n * Math.sin(lat), p);
  }
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};

export interface GnssRawPosLine {
  readonly time: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly q: number;
  readonly sats: number;
  readonly sdx: number;
  readonly sdy: number;
  readonly sdz: number;
  readonly sdxy: number;
  readonly sdyz: number;
  readonly sdzx: number;
  readonly ratio: number;
}

/** All data lines of an rnx2rtkp `.pos` file, in file order. */
export const parsePosText = (text: string): GnssRawPosLine[] => {
  const out: GnssRawPosLine[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0 || line.startsWith('%')) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 15) continue;
    const nums = f.map(Number);
    if (!nums.slice(2).every(Number.isFinite)) continue;
    out.push({
      time: `${f[0]} ${f[1]}`, x: nums[2]!, y: nums[3]!, z: nums[4]!,
      q: nums[5]!, sats: nums[6]!, sdx: nums[7]!, sdy: nums[8]!, sdz: nums[9]!,
      sdxy: nums[10]!, sdyz: nums[11]!, sdzx: nums[12]!, ratio: nums[14]!,
    });
  }
  return out;
};

/**
 * Verified 12J.1 covariance order: .pos sd columns are std-devs (m);
 * diagonals square, cross terms sign-preserving square. Column order is
 * sdx,sdy,sdz,sdxy,sdyz,sdzx → xx,yy,zz,xy,yz,xz. Do NOT reorder.
 */
export const posLineToCovariance = (line: GnssRawPosLine): GnssBaselineCovariance => {
  const signedSquare = (sd: number): number => (sd < 0 ? -sd * sd : sd * sd);
  return {
    xx: line.sdx * line.sdx,
    xy: signedSquare(line.sdxy),
    xz: signedSquare(line.sdzx),
    yy: line.sdy * line.sdy,
    yz: signedSquare(line.sdyz),
    zz: line.sdz * line.sdz,
  };
};

/**
 * Marker reduction (12J.1 marker-ARP contract §5):
 * Δ_mark = Δ_raw − (H_rov·Up_rov − H_base·Up_base).
 */
export const reduceToMarker = (
  raw: readonly [number, number, number],
  roverXyz: readonly [number, number, number],
  baseXyz: readonly [number, number, number],
  hRover: number,
  hBase: number,
): [number, number, number] => {
  const upRov = wgs84Up(roverXyz[0], roverXyz[1], roverXyz[2]);
  const upBase = wgs84Up(baseXyz[0], baseXyz[1], baseXyz[2]);
  return raw.map((v, i) => v - (hRover * upRov[i]! - hBase * upBase[i]!)) as [number, number, number];
};

/** SP3 product label from the header, else null (honest unknown). */
export const extractSp3Label = (sp3Text: string): string | null => {
  const header = sp3Text.split('\n').slice(0, 12).join('\n');
  const known = header.match(/\b(IGS0?|IGb\d+|IGR\d*|IGU\d*|COD|ESA|GFZ|JPL|NGS|NRCan|SIO|USN|GRG|WUM)\b/);
  return known?.[1] ?? null;
};

/** Portable FNV-1a hex for the options hash (node+worker, no crypto dep). */
export const hashOptions = (options: GnssRawRnx2rtkpOptions): string => {
  const text = JSON.stringify({
    m: options.elevationMaskDegrees ?? 10,
    ti: options.intervalSeconds ?? 'AUTO',
    tir: options.resolvedIntervalSeconds ?? null,
    ts: options.windowStart ?? null,
    te: options.windowStop ?? null,
    p: options.precise ?? false,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
};

const epochMs = (time: string): number => Date.parse(time.replaceAll('/', '-').replace(' ', 'T') + 'Z');

/** Median output-epoch spacing; exported for tests. */
export const deriveIntervalSeconds = (lines: readonly GnssRawPosLine[]): number => {
  const times = lines.map((l) => epochMs(l.time)).filter(Number.isFinite);
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i += 1) diffs.push((times[i]! - times[i - 1]!) / 1000);
  diffs.sort((a, b) => a - b);
  return diffs.length > 0 ? diffs[Math.floor(diffs.length / 2)]! : 0;
};

/** Fixed MEMFS names; unlinks outputs first so a failed run never returns stale data. */
export const stageInputs = (mod: GnssRawWasmModule, job: GnssRawRnx2rtkpJob): string[] => {
  checkSize('baseObs', job.baseObs);
  checkSize('roverObs', job.roverObs);
  job.nav.forEach((buf, i) => checkSize(`nav[${i}]`, buf));
  if (job.options?.precise === true && job.sp3) checkSize('sp3', job.sp3);
  try {
    mod.FS.mkdir(WORK);
  } catch { /* exists */ }
  try {
    mod.FS.unlink(NAMES.out);
  } catch { /* absent */ }
  try {
    mod.FS.unlink(NAMES.conf);
  } catch { /* absent */ }
  mod.FS.writeFile(NAMES.roverObs, job.roverObs);
  mod.FS.writeFile(NAMES.baseObs, job.baseObs);
  const inputs: string[] = [NAMES.roverObs, NAMES.baseObs];
  job.nav.forEach((buf, i) => {
    const p = navName(i);
    mod.FS.writeFile(p, buf);
    inputs.push(p);
  });
  return inputs;
};

export const buildRnx2rtkpArgs = (
  mod: GnssRawWasmModule,
  job: GnssRawRnx2rtkpJob,
  inputs: readonly string[],
): string[] => {
  const mask = job.options?.elevationMaskDegrees ?? 10;
  const args = ['-p', '3', '-f', '2', '-m', String(mask), '-sys', 'G'];
  const explicit = job.options?.intervalSeconds;
  const ti = typeof explicit === 'number' ? explicit : job.options?.resolvedIntervalSeconds;
  if (typeof ti === 'number') args.push('-ti', String(ti));
  if (job.options?.windowStart) args.push('-ts', ...job.options.windowStart.trim().split(/\s+/));
  if (job.options?.windowStop) args.push('-te', ...job.options.windowStop.trim().split(/\s+/));
  // -e selects x/y/z-ecef output (default is lat/lon/h); -t selects
  // yyyy/mm/dd time (default is week/TOW). Both match the 12J.1 pin.
  const allInputs = [...inputs];
  args.push('-e', '-t');
  if (job.options?.precise === true && job.sp3) {
    // 12J.2 ladder pattern: SP3-as-input alone stays broadcast; the ONLY CLI
    // path to precise is a `-k` conf with `pos1-sateph=precise`.
    mod.FS.writeFile(NAMES.conf, new TextEncoder().encode('pos1-sateph=precise\n'));
    args.push('-k', NAMES.conf);
    const p = sp3Name(job.nav.length);
    mod.FS.writeFile(p, job.sp3);
    allInputs.push(p);
  }
  return [...args, '-o', NAMES.out, '-r', ...job.baseXyz.map(String), ...allInputs];
};

/**
 * Runs one static baseline job against a WASM module instance. Callers
 * should use a fresh module per job for isolation; sharing is allowed only
 * with proven-cleared MEMFS (outputs are always unlinked before each run).
 */
export const runRawBaseline = (
  mod: GnssRawWasmModule,
  job: GnssRawRnx2rtkpJob,
  onProgress?: GnssRawProgressCallback,
): ProcessedRawGnssBaseline => {
  const say = (stage: GnssRawProgressStage): void => onProgress?.(stage);
  say('Reading files');
  const inputs = stageInputs(mod, job);
  say('Validating RINEX');
  const args = buildRnx2rtkpArgs(mod, job, inputs);
  say('Preparing observations');
  say('Processing static baseline');
  try {
    mod.callMain(args);
  } catch (e: unknown) {
    // Emscripten exit(0) throws; a zero-status throw means success.
    const status = (e as { status?: number })?.status;
    if (status !== undefined && status !== 0) {
      fail('PROCESSOR_FAILURE', `rnx2rtkp exited with status ${status}.`);
    }
    if (status === undefined) throw e;
  }
  say('Resolving ambiguities');
  const pos = mod.FS.readFile(NAMES.out, { encoding: 'utf8' });
  const lines = parsePosText(pos);
  if (lines.length === 0) fail('PROCESSOR_FAILURE', 'rnx2rtkp produced no solution epochs.');
  const solution = lines[lines.length - 1]!;
  const fixEpochs = lines.filter((l) => l.q === 1).length;
  const status = solution.q === 1 ? 'FIXED' : solution.q === 2 ? 'FLOAT' : 'FAILED';
  say('Building covariance');
  const covariance = posLineToCovariance(solution);
  try {
    validateGnssBaselineCovariance(covariance, `${job.from}-${job.to}`);
  } catch (e: unknown) {
    fail('INVALID_COVARIANCE',
      `Processor covariance failed validation for ${job.from}-${job.to}.`,
      e instanceof Error ? e.message : String(e));
  }
  say('Finalizing result');
  const raw: [number, number, number] = [
    solution.x - job.baseXyz[0], solution.y - job.baseXyz[1], solution.z - job.baseXyz[2],
  ];
  const reduced = reduceToMarker(raw,
    [solution.x, solution.y, solution.z], [job.baseXyz[0], job.baseXyz[1], job.baseXyz[2]],
    job.roverAntenna.height, job.baseAntenna.height);
  const horizontalOffset = Math.hypot(job.roverAntenna.east, job.roverAntenna.north)
    + Math.hypot(job.baseAntenna.east, job.baseAntenna.north);
  const acceptanceNotes: string[] = [];
  let acceptance: ProcessedRawGnssBaseline['acceptance'] = 'PROCESSING_ACCEPTED';
  if (status === 'FAILED') {
    acceptance = 'PROCESSING_REJECTED';
    acceptanceNotes.push('Processor reported no fixed or float solution.');
  } else if (status === 'FLOAT') {
    acceptance = 'PROCESSING_WARNING';
    acceptanceNotes.push(fixEpochs > 0
      ? 'Ambiguities fixed during the session but the final epoch is float; reported as FLOAT.'
      : 'Float solution: ambiguities not fixed; exportability is caller policy.');
  }
  if (job.sp3 != null && !(job.options?.precise === true)) {
    if (acceptance === 'PROCESSING_ACCEPTED') acceptance = 'PROCESSING_WARNING';
    acceptanceNotes.push('SP3 file was staged but broadcast ephemeris was requested; SP3 ignored.');
  }
  if (horizontalOffset > 0) {
    if (acceptance === 'PROCESSING_ACCEPTED') acceptance = 'PROCESSING_WARNING';
    acceptanceNotes.push(
      'Nonzero antenna E/N offset is not reduced; E/N values are surfaced, horizontal offset remains in the vector.',
    );
  }
  // Ephemeris honesty: precise requires BOTH the request and the product.
  const precise = job.options?.precise === true && job.sp3 != null;
  const sp3Label = precise
    ? extractSp3Label(new TextDecoder().decode(job.sp3!)) : null;
  const referenceFrame = precise
    ? (sp3Label ?? 'PRODUCT_FRAME_UNKNOWN')
    : 'WGS84(G1150)-class/broadcast';
  const intervalRequested = job.options?.intervalSeconds ?? 'AUTO';
  const intervalHint = job.options?.resolvedIntervalSeconds;
  const intervalResolved = typeof intervalRequested === 'number'
    ? intervalRequested
    : (typeof intervalHint === 'number' ? intervalHint : deriveIntervalSeconds(lines));
  return {
    status,
    acceptance,
    acceptanceNotes,
    from: job.from,
    to: job.to,
    deltaX: reduced[0],
    deltaY: reduced[1],
    deltaZ: reduced[2],
    baselineLength: Math.hypot(reduced[0], reduced[1], reduced[2]),
    covariance,
    covarianceAssessment: {
      model: 'RTKLIB_FORMAL', calibration: 'UNCALIBRATED',
      status: 'FORMAL_UNCALIBRATED', finite: true, spd: true,
    },
    coordinateReference: 'MARKER_TO_MARKER_ECEF',
    referenceFrame,
    start: lines[0]!.time,
    stop: lines[lines.length - 1]!.time,
    solutionQuality: {
      ratio: Number.isFinite(solution.ratio) ? solution.ratio : null,
      fixedEpochs: fixEpochs,
      usedEpochs: lines.length,
      satellites: solution.sats,
    },
    antennaAssessment: {
      base: {
        marker: job.baseAntenna.marker, model: job.baseAntenna.antennaModel,
        calibration: 'CALIBRATION_UNAVAILABLE',
        height: job.baseAntenna.height, east: job.baseAntenna.east, north: job.baseAntenna.north,
      },
      rover: {
        marker: job.roverAntenna.marker, model: job.roverAntenna.antennaModel,
        calibration: 'CALIBRATION_UNAVAILABLE',
        height: job.roverAntenna.height, east: job.roverAntenna.east, north: job.roverAntenna.north,
      },
      overall: 'NONE',
      warning: 'No authoritative antenna calibration was resolved for this endpoint. ' +
        'The processed vector may contain unmodelled antenna phase-center effects.',
    },
    provenance: {
      processor: GNSS_RAW_PROCESSOR_ID,
      emccVersion: GNSS_RAW_EMCC_VERSION,
      compileFlags: [...GNSS_RAW_COMPILE_FLAGS],
      baseObsSha256: job.hashes.baseObsSha256,
      roverObsSha256: job.hashes.roverObsSha256,
      navSha256: [...job.hashes.navSha256],
      sp3Sha256: job.hashes.sp3Sha256,
      optionsHash: hashOptions(job.options ?? {}),
      intervalRequested,
      intervalResolved,
      elevationMaskResolved: Number(args[args.indexOf('-m') + 1]),
      ephemerisRequested: job.options?.precise === true ? 'PRECISE' : 'BROADCAST',
      ephemerisUsed: precise ? 'PRECISE' : 'BROADCAST',
      processedAt: new Date().toISOString(),
    },
    diagnostics: [
      `status=${status} q=${solution.q} ratio=${solution.ratio} sats=${solution.sats} epochs=${lines.length}`,
      `frame=${referenceFrame} mask=${job.options?.elevationMaskDegrees ?? 10}deg`,
      `marker reduction H_rov=${job.roverAntenna.height} H_base=${job.baseAntenna.height} (WGS84 ellipsoidal Up)`,
      ...(status === 'FLOAT' ? ['FLOAT solution delivered as full diagnostic payload; exportability is caller policy.'] : []),
    ],
  };
};
