/**
 * Phase 20Q STUDY ONLY — shared evidence helpers: station sampling, mesh +
 * gtop2 certificate, corpus row assembly. Worker agreement + recomputation
 * live in phase20qRecheck.ts; real-tiling proofs in phase20qTiling.ts.
 * Pure functions (no fs); all production calls are caught and recorded,
 * never thrown. Zero `src/` edits.
 */
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
  gradingTopologyCertificateExactError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  classifyPhase20qStep,
  type Phase20qCase,
} from './phase20qFixtures';
import {
  checkFlatReductionExact,
  evaluatePhase20qLaw,
  PHASE20Q_S3_TAU,
  phase20qHybridPoints,
  phase20qStations,
  type Phase20qLawId,
} from './phase20qLaws';
import {
  phase20qIndependentRecompute,
  phase20qPerCheckpointSourceZExtension,
  phase20qSourceZAwareCheck,
  phase20qValidatorMeshUntampered,
  phase20qWorkerFacts,
  persistPhase20qInputs,
  type Phase20qIndependentRecompute,
  type Phase20qPersistedInputs,
  type Phase20qWorkerFacts,
} from './phase20qRecheck';
import {
  checkFlatReductionFullSolve,
  phase20qExtendedStudyTile,
  phase20qRealTilingProbe,
  type Phase20qExtendedStudyTile,
} from './phase20qTiling';
import { phase20qTransformDeviations } from './phase20qTransforms';

export { phase20qWorkerFacts } from './phase20qRecheck';
export type { Phase20qWorkerFacts } from './phase20qRecheck';

export interface Phase20qMeshFacts {
  meshOk: boolean;
  meshCode: string | null;
  vertexCount: number;
  triangleCount: number;
  skippedZeroWidth: number;
  measuredRegions: number;
  /** Pre-mesh structural expectation (derived BEFORE measure/build, M4). */
  expectedRegions: number | null;
  /** measured === expected gate (never fed back into the expectation). */
  preMeshGate: string | null;
  certOk: boolean;
  certComponents: number | null;
  certCycles: number | null;
  revalidation: string | null;
  error: string | null;
}

export interface Phase20qTilingFacts {
  admitted: boolean;
  code: string | null;
  frameError: string | null;
}

export interface Phase20qRow {
  law: Phase20qLawId;
  caseId: string;
  matrix: string;
  family: string;
  side: string;
  LL: number;
  LR: number;
  endpoints: number[];
  slopes: number[];
  jointZ: number;
  step: number;
  stepClass: string;
  W: number;
  stations: { s: number; tag: string }[];
  sourceZ: number[];
  scalar: number[];
  daylight: number[];
  residual: (number | null)[];
  maxResidual: number | null;
  c0JointGap: number;
  c0CutL: number;
  c0CutR: number;
  c1Source: number;
  c1Daylight: number;
  mesh: Phase20qMeshFacts;
  worker: Phase20qWorkerFacts;
  /** Real production tiling-path outcome with source-exact endpoints (B1). */
  tiling: Phase20qTilingFacts;
  /** M1: real validator code on UNtampered checkpoints (null = pass). */
  validatorMesh: string | null;
  /** M1: per-checkpoint-source-Z validator extension proof (PASS or code). */
  validatorExtension: string;
  /** M4: extended study tile (outer sub-solves + checkpoints). */
  extendedTile: Phase20qExtendedStudyTile;
  /** Source-Z-aware per-family post-solve check (B2, every row). */
  sourceZCheck: string;
  /** Sufficient persisted inputs for disk-byte independent recompute (B3). */
  persisted: Phase20qPersistedInputs;
  /** Recompute SOLELY from persisted fields, no fixture reuse (B3). */
  independent: Phase20qIndependentRecompute;
  transforms: Record<string, number | string | boolean>;
  flatReductionExact: boolean | null;
  /** Zero-reduction vs the FULL production flat solve (B1). */
  flatReductionFullSolve: boolean | null;
  rejectReason: string | null;
}

const r12n = (v: number): number => v;

const flatOf = (pts: readonly { x: number; y: number; z: number }[]): number[] =>
  pts.flatMap((p) => [p.x, p.y, p.z]);

const meshFail = (c: Phase20qCase, expectedRegions: number | null, preMeshGate: string | null, error: string | null, extra?: Partial<Phase20qMeshFacts>): Phase20qMeshFacts => ({
  meshOk: false, meshCode: null, vertexCount: 0, triangleCount: 0,
  skippedZeroWidth: 0, measuredRegions: 0, expectedRegions, preMeshGate,
  certOk: false, certComponents: null, certCycles: null, revalidation: null, error,
  ...extra,
});

/**
 * M4: structural expectation is derived BEFORE measuring/building the
 * mesh (from W + member lengths only — measured counts never feed the
 * expectation), then the measured === expected gate runs before gtop2.
 */
export const phase20qMeshFacts = (
  c: Phase20qCase,
  law: Phase20qLawId,
): Phase20qMeshFacts => {
  const expectation = deriveTransitionExpectation(
    { scope: 'group', closed: false, positiveWidthRegions: 0 },
    {
      jointId: 'joint:0',
      width: c.W,
      memberLengths: [c.LL, c.LR] as readonly [number, number],
      transitionCount: 1,
      isOpen: true,
    },
  );
  if (!expectation.ok) {
    return meshFail(c, null, null, `expectation: ${expectation.code}`);
  }
  const expectedRegions = 1;
  try {
    const points = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU);
    const source = points.map((p) => ({ x: p.srcX, y: p.srcY, z: p.srcZ }));
    const daylight = points.map((p) => ({ x: p.dayX, y: p.dayY, z: p.dayZ }));
    const measuredRegions = countPositiveWidthRegions(source, daylight);
    const preMeshGate = measuredRegions === expectedRegions ? null : `measured-${measuredRegions}-vs-expected-${expectedRegions}`;
    if (preMeshGate) {
      return meshFail(c, expectedRegions, preMeshGate, null, { measuredRegions });
    }
    const built = buildGradingStripMesh(source, daylight);
    if (!built.ok) {
      return meshFail(c, expectedRegions, null, null, {
        meshCode: built.code, skippedZeroWidth: built.skippedZeroWidth, measuredRegions,
      });
    }
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: built.points,
      triangles: built.triangles,
      expectation: expectation.expectation,
      sourceBoundaryPoints: flatOf(source),
      gradingBoundaryPoints: flatOf(daylight),
    });
    if (!cert) {
      return {
        meshOk: true, meshCode: null, vertexCount: built.points.length / 3,
        triangleCount: built.triangles.length / 3, skippedZeroWidth: built.skippedZeroWidth,
        measuredRegions, expectedRegions, preMeshGate: null,
        certOk: false, certComponents: null, certCycles: null,
        revalidation: null, error: 'gtop2-refused',
      };
    }
    const revalidation = gradingTopologyCertificateExactError(
      cert,
      'group',
      { points: built.points, triangles: built.triangles },
      { sourceBoundaryPoints: flatOf(source), gradingBoundaryPoints: flatOf(daylight) },
    );
    return {
      meshOk: true, meshCode: null, vertexCount: built.points.length / 3,
      triangleCount: built.triangles.length / 3, skippedZeroWidth: built.skippedZeroWidth,
      measuredRegions, expectedRegions, preMeshGate: null,
      certOk: true, certComponents: cert.components,
      certCycles: cert.boundaryCycles, revalidation, error: null,
    };
  } catch (error) {
    return meshFail(c, expectedRegions, null, error instanceof Error ? error.message : String(error));
  }
};

/** One corpus row per (case, law): law oracle + mesh + worker + transforms. */
export const assemblePhase20qRow = (c: Phase20qCase, law: Phase20qLawId): Phase20qRow => {
  const stations = phase20qStations(c);
  let sourceZ: number[] = [];
  let scalar: number[] = [];
  let daylight: number[] = [];
  let residual: (number | null)[] = [];
  let maxResidual: number | null = null;
  let c0JointGap = NaN;
  let c0CutL = NaN;
  let c0CutR = NaN;
  let c1Source = NaN;
  let c1Daylight = NaN;
  let rejectReason: string | null = null;
  let flatReductionExact: boolean | null = null;
  try {
    const result = evaluatePhase20qLaw(law, c, stations, PHASE20Q_S3_TAU);
    const hybrid = phase20qHybridPoints(c, law, PHASE20Q_S3_TAU);
    sourceZ = hybrid.map((p) => r12n(p.srcZ));
    scalar = hybrid.map((p) => r12n(p.scalarV));
    daylight = hybrid.flatMap((p) => [r12n(p.dayX), r12n(p.dayY), r12n(p.dayZ)]);
    residual = hybrid.map((p) => p.residual);
    maxResidual = null;
    for (const r of residual) {
      if (r !== null) maxResidual = maxResidual === null ? r : Math.max(maxResidual, r);
    }
    c0JointGap = result.c0JointGap;
    c0CutL = result.c0CutL;
    c0CutR = result.c0CutR;
    c1Source = result.c1Source;
    c1Daylight = result.c1Daylight;
    rejectReason = result.rejectReason;
    flatReductionExact = checkFlatReductionExact(c, result);
  } catch (error) {
    rejectReason = error instanceof Error ? `oracle-error: ${error.message}` : 'oracle-error';
  }
  const worker = phase20qWorkerFacts(c, law);
  const persisted = persistPhase20qInputs(c, law);
  const probe = phase20qRealTilingProbe(c);
  return {
    law,
    caseId: c.caseId,
    matrix: c.matrix,
    family: c.family,
    side: c.side,
    LL: c.LL,
    LR: c.LR,
    endpoints: [c.startX, c.startY, c.startZ, c.jointX, c.jointY, c.jointZL, c.jointZR, c.endX, c.endY, c.endZ],
    slopes: [c.srcSlopeL, c.srcSlopeR],
    jointZ: c.jointZ,
    step: c.step,
    stepClass: classifyPhase20qStep(c),
    W: c.W,
    stations: stations.map((st) => ({ s: st.s, tag: st.tag })),
    sourceZ,
    scalar,
    daylight,
    residual,
    maxResidual,
    c0JointGap,
    c0CutL,
    c0CutR,
    c1Source,
    c1Daylight,
    mesh: phase20qMeshFacts(c, law),
    worker,
    tiling: { admitted: probe.admitted, code: probe.code, frameError: probe.frameError },
    validatorMesh: phase20qValidatorMeshUntampered(c, law),
    validatorExtension: phase20qPerCheckpointSourceZExtension(c, law),
    extendedTile: phase20qExtendedStudyTile(c),
    sourceZCheck: phase20qSourceZAwareCheck(c, law),
    persisted,
    independent: phase20qIndependentRecompute(persisted, worker.recomputeVL, worker.recomputeVR),
    transforms: phase20qTransformDeviations(c, law),
    flatReductionExact,
    flatReductionFullSolve: checkFlatReductionFullSolve(c, law),
    rejectReason,
  };
};

/** Canonical corpus bytes (shared by both entry points, byte-identical). */
export const serializePhase20qCorpus = (rows: Phase20qRow[]): string => `${JSON.stringify(rows, null, 2)}\n`;
