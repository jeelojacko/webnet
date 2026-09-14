/**
 * Phase 12J.1 Batch F §§36-37 — EVIDENCE ONLY canonical adapter + frame rule.
 *
 * §36: RawGnssBaselineSolution -> GnssBaselineObservation adapter. The input
 * MUST already carry the explicit reference MARKER_TO_MARKER_ECEF (i.e. the
 * L1 marker-ARP reduction happened upstream and is declared, not guessed).
 * Any other reference string -> throw, never guess. Full 3x3 covariance is
 * carried; SPD gating reuses the production validator read-only.
 *
 * §37: frame-aligned adapter rule. Source/target frame mismatch fails unless
 * an explicitly supplied evidence transform {jacobian} is passed; the
 * production transform stays deferred (documented below). Demonstrated with
 * broadcast-WGS84-class vs project frame.
 *
 * No src//tests//TODO.md touches. No vendor bytes.
 * Run: npx tsx scripts/gnss/gnss12j1CanonicalAdapter.ts
 */
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from '../../src/engine/gnssBaselineTypes';
import { validateGnssBaselineCovariance } from '../../src/engine/gnssBaselineCovariance';

/** The ONLY accepted reference semantic. Everything else throws. */
export const MARKER_TO_MARKER_ECEF = 'MARKER_TO_MARKER_ECEF' as const;

export interface RawGnssBaselineSolution {
  readonly from: string;
  readonly to: string;
  /** Explicit endpoint reference semantics — must be MARKER_TO_MARKER_ECEF. */
  readonly reference: string;
  /** Mark-to-mark ECEF vector (m), rover-minus-base. */
  readonly delta: [number, number, number];
  /** Full symmetric 3x3 covariance (m^2), ECEF order xx..zz. */
  readonly covariance: GnssBaselineCovariance;
  /** Processing-leg frame label, e.g. 'WGS84(G1150)-class/broadcast'. */
  readonly sourceFrame: string;
  readonly sessionId: string;
  readonly solutionId: string;
  readonly sourceFile: string;
}

export interface EvidenceTransform {
  /** 3x3 Jacobian J with d_t = J d_s, C_t = J C_s J^T. Explicit only. */
  readonly jacobian: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  readonly description: string;
}

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

const matVec = (m: M3, v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const matMatT = (a: M3, b: M3): M3 => {
  const mul = (x: M3, y: M3): M3 =>
    [0, 1, 2].map((_, i) =>
      [0, 1, 2].map((__, j) => x[i][0] * y[0][j] + x[i][1] * y[1][j] + x[i][2] * y[2][j]),
    ) as M3;
  return mul(mul(a, b), [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ]);
};

const denseOf = (c: GnssBaselineCovariance): M3 => [
  [c.xx, c.xy, c.xz],
  [c.xy, c.yy, c.yz],
  [c.xz, c.yz, c.zz],
];

/**
 * §36 adapter. Throws unless reference === MARKER_TO_MARKER_ECEF; throws on
 * non-finite or non-SPD covariance (production gate, read-only).
 */
export function adaptRawBaselineToObservation(
  raw: RawGnssBaselineSolution,
  id: number,
): GnssBaselineObservation {
  if (raw.reference !== MARKER_TO_MARKER_ECEF) {
    throw new Error(
      `refusing to adapt ${raw.from}->${raw.to}: reference is '${raw.reference}', ` +
        `expected '${MARKER_TO_MARKER_ECEF}' (never guess endpoint semantics).`,
    );
  }
  validateGnssBaselineCovariance(raw.covariance, `${raw.sessionId}-adapter`);
  return {
    type: 'gnssBaseline',
    id,
    from: raw.from,
    to: raw.to,
    vector: { x: raw.delta[0], y: raw.delta[1], z: raw.delta[2] },
    covariance: { ...raw.covariance },
    frame: 'ecef',
    referenceFrame: raw.sourceFrame,
    sessionId: raw.sessionId,
    solutionId: raw.solutionId,
    sourceFile: raw.sourceFile,
  };
}

/**
 * §37 frame-aligned rule. When targetFrame !== sourceFrame, an explicit
 * evidence transform is REQUIRED; without it, throw. With it, apply
 * d_t = J d_s, C_t = J C_s J^T endpoint-wise (§12 oracle) and label the
 * observation with the target frame.
 *
 * Production transform: DEFERRED. No Helmert parameters between
 * WGS84(G1150)-class/IGb00 and the project frame are estimated or staged
 * here; any future production path must supply a calibrated, versioned
 * transform through this same explicit slot — never by relabeling.
 */
export function adaptWithFrameCheck(
  raw: RawGnssBaselineSolution,
  id: number,
  targetFrame: string,
  evidenceTransform?: EvidenceTransform,
): GnssBaselineObservation {
  const base = adaptRawBaselineToObservation(raw, id);
  if (raw.sourceFrame === targetFrame) return base;
  if (!evidenceTransform) {
    throw new Error(
      `frame mismatch '${raw.sourceFrame}' -> '${targetFrame}' with no explicit ` +
        `evidence transform (production transform deferred; refusing to relabel).`,
    );
  }
  const j = evidenceTransform.jacobian as M3;
  const d = matVec(j, raw.delta);
  const c = matMatT(j, denseOf(raw.covariance));
  const covariance: GnssBaselineCovariance = {
    xx: c[0][0],
    xy: c[0][1],
    xz: c[0][2],
    yy: c[1][1],
    yz: c[1][2],
    zz: c[2][2],
  };
  validateGnssBaselineCovariance(covariance, `${raw.sessionId}-frame-mapped`);
  return { ...base, vector: { x: d[0], y: d[1], z: d[2] }, covariance, referenceFrame: targetFrame };
}

// S32 self-check numbers: L1-corrected mark-to-mark vector (m) = raw WASM
// delta [5822.2405,-5656.3389,-4844.809] minus the §6 correction
// H_rov·Up_rov − H_base·Up_base, and the §19 RTKLIB covariance (m^2).
const S32_MARKED: V3 = [5822.639, -5654.864, -4846.086];
const S32_COV: GnssBaselineCovariance = {
  xx: 3.6e-7,
  xy: 2.5e-7,
  xz: -2.5e-7,
  yy: 1.21e-6,
  yz: -4.9e-7,
  zz: 1.0e-6,
};

const check = (name: string, cond: boolean): void => {
  if (!cond) throw new Error(`self-check failed: ${name}`);
  console.log(`ok - ${name}`);
};

const s32Raw = (): RawGnssBaselineSolution => ({
  from: 'P041',
  to: 'SIXTWO',
  reference: MARKER_TO_MARKER_ECEF,
  delta: [...S32_MARKED],
  covariance: { ...S32_COV },
  sourceFrame: 'WGS84(G1150)-class/broadcast',
  sessionId: 'S32',
  solutionId: 'B32-RAW',
  sourceFile: 'wasm-processStaticBaseline',
});

function main(): void {
  // §36: happy path carries vector + full 3x3 + provenance into the observation.
  const obs = adaptRawBaselineToObservation(s32Raw(), 32);
  check('adapter carries S32 vector', Math.abs(obs.vector.x - 5822.639) < 1e-9);
  check('adapter carries full 3x3', obs.covariance.xy === 2.5e-7 && obs.covariance.yz === -4.9e-7);
  check(
    'adapter carries provenance',
    obs.sessionId === 'S32' && obs.solutionId === 'B32-RAW' && obs.frame === 'ecef',
  );

  // §36: wrong reference -> throw, never guess.
  for (const bad of ['PHASE_CENTER_TO_CMD_POINT', 'ARP_TO_ARP', '', 'marker-to-marker']) {
    let threw = false;
    try {
      adaptRawBaselineToObservation({ ...s32Raw(), reference: bad }, 32);
    } catch {
      threw = true;
    }
    check(`adapter throws on reference '${bad || '<empty>'}'`, threw);
  }

  // §37: same frame passes through untouched.
  const same = adaptWithFrameCheck(s32Raw(), 32, 'WGS84(G1150)-class/broadcast');
  check('same-frame passthrough', same.referenceFrame === 'WGS84(G1150)-class/broadcast');

  // §37: mismatch without transform -> throw.
  let threw = false;
  try {
    adaptWithFrameCheck(s32Raw(), 32, 'NAD83(2011)');
  } catch {
    threw = true;
  }
  check('frame mismatch without transform throws', threw);

  // §37: mismatch WITH explicit evidence transform applies J correctly
  // (identity-double check: J=2I maps d->2d, C->4C).
  const doubled = adaptWithFrameCheck(s32Raw(), 32, 'NAD83(2011)', {
    jacobian: [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ],
    description: 'synthetic 2x self-test only, NOT a production transform',
  });
  check('explicit transform maps vector', Math.abs(doubled.vector.x - 2 * 5822.639) < 1e-6);
  check('explicit transform maps covariance', Math.abs(doubled.covariance.xx - 4 * 3.6e-7) < 1e-15);
  check('explicit transform relabels frame', doubled.referenceFrame === 'NAD83(2011)');

  console.log(JSON.stringify({ verdict: 'PASS §§36-37', observation: obs }, null, 2));
}

const asMain = process.argv[1]?.endsWith('gnss12j1CanonicalAdapter.ts') ?? false;
if (asMain) main();
