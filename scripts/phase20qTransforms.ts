/**
 * Phase 20Q STUDY ONLY — transform evidence: XY translations (1e6 / 1e8),
 * Z shift (elevation retargeted, recorded), plan mirror (side flipped),
 * traversal reversal (physical slope mapping, normalized 3D set compare,
 * never ggrev1 equality). Pure functions, never throw. Zero `src/` edits.
 */
import type { Phase20qCase, Phase20qCriterion } from './phase20qFixtures';
import {
  phase20qHybridPoints,
  PHASE20Q_S3_TAU,
  type Phase20qLawId,
  type Phase20qLawPoint,
} from './phase20qLaws';

type Deviations = Record<string, number | string | boolean>;

const maxDev = (a: readonly number[], b: readonly number[]): number => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > m) m = d;
  }
  return m;
};

const flatDay = (pts: readonly Phase20qLawPoint[]): number[] =>
  pts.flatMap((p) => [p.dayX, p.dayY, p.dayZ]);

const evalBase = (c: Phase20qCase, law: Phase20qLawId): Phase20qLawPoint[] | null => {
  try {
    return phase20qHybridPoints(c, law, PHASE20Q_S3_TAU);
  } catch {
    return null;
  }
};

const retarget = (c: Phase20qCase, dz: number): Phase20qCase => {
  if (c.family !== 'elevation') return c;
  const bump = (k: Phase20qCriterion): Phase20qCriterion =>
    k.kind === 'elevation' ? { ...k, targetElevation: k.targetElevation + dz } : k;
  return { ...c, criterionL: bump(c.criterionL), criterionR: bump(c.criterionR) };
};

/** Reversed traversal: members swap, slopes negate, step negates. */
const reversedCase = (c: Phase20qCase): Phase20qCase => ({
  ...c,
  caseId: `${c.caseId}:reversed`,
  LL: c.LR,
  LR: c.LL,
  startZ: c.endZ,
  jointZL: c.jointZR,
  jointZR: c.jointZL,
  endZ: c.startZ,
  srcSlopeL: -c.srcSlopeR,
  srcSlopeR: -c.srcSlopeL,
  jointZ: c.jointZR,
  step: c.jointZL - c.jointZR,
  criterionL: c.criterionR,
  criterionR: c.criterionL,
});

const keyOf = (p: readonly number[]): string =>
  `${p[0]!.toPrecision(17)}|${p[1]!.toPrecision(17)}|${p[2]!.toPrecision(17)}`;

export const phase20qTransformDeviations = (c: Phase20qCase, law: Phase20qLawId): Deviations => {
  const out: Deviations = {};
  const base = evalBase(c, law);
  if (!base) {
    out.oracle = 'base-unresolvable';
    return out;
  }
  const baseFlat = flatDay(base);
  try {
    const t6 = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU, { dx: 1e6, dy: 1e6 });
    out.xy1e6 = maxDev(baseFlat, flatDay(t6).map((v, i) => (i % 3 === 2 ? v : v - 1e6)));
  } catch {
    out.xy1e6 = 'unresolvable';
  }
  try {
    const t8 = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU, { dx: 1e8, dy: 1e8 });
    out.xy1e8 = maxDev(baseFlat, flatDay(t8).map((v, i) => (i % 3 === 2 ? v : v - 1e8)));
  } catch {
    out.xy1e8 = 'unresolvable';
  }
  try {
    const dz = 100;
    const shifted = retarget(c, dz);
    const tz = phase20qHybridPoints(shifted, law, PHASE20Q_S3_TAU, { dz });
    out.zShift = maxDev(baseFlat, flatDay(tz).map((v, i) => (i % 3 === 2 ? v - dz : v)));
    out.zShiftElevationRetargeted = c.family === 'elevation';
  } catch {
    out.zShift = 'unresolvable';
  }
  try {
    const mirrored: Phase20qCase = { ...c, side: c.side === 'left' ? 'right' : 'left' };
    const tm = phase20qHybridPoints(mirrored, law, PHASE20Q_S3_TAU);
    // Mirror across the source axis negates the side-normal offset.
    out.mirror = maxDev(baseFlat, flatDay(tm).map((v, i) => (i % 3 === 1 ? -v : v)));
  } catch {
    out.mirror = 'unresolvable';
  }
  try {
    const rc = reversedCase(c);
    const tr = phase20qHybridPoints(rc, law, PHASE20Q_S3_TAU);
    // Normalized 3D set compare: mirror reversed daylight back (x -> total - x).
    const normRev: number[][] = tr.map((p) => [c.total - p.dayX, p.dayY, p.dayZ]);
    const normBase: number[][] = base.map((p) => [p.dayX, p.dayY, p.dayZ]);
    normRev.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    normBase.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    let dev = 0;
    if (normRev.length === normBase.length) {
      for (let i = 0; i < normRev.length; i += 1) {
        dev = Math.max(dev, maxDev(normBase[i]!, normRev[i]!));
      }
    } else {
      dev = NaN;
    }
    out.reversal = dev;
    out.reversalNote = 'normalized-3d-set-compare; no-revision-equality';
  } catch {
    out.reversal = 'unresolvable';
  }
  return out;
};
