/**
 * Phase 20K.3 Waves C/E1 — all-Surface Design Patch + independent products.
 *
 * Reproduces the Phase 20K.2 all-Surface rounded square through the REAL
 * product path (closed feature-line group -> GROUP_CREATE -> group compute)
 * and freezes the canonical Surface seam assembly output:
 *
 *  - `assembleSurfaceChain` (`gradingChordSeam.ts`) now replaces each
 *    internal chord-seam source tip with the single exact linearized joint
 *    `v` shared by the incoming/outgoing runs and the corner fan, so the
 *    `atSource(u) = start + t·length` ULP twins are gone. The captured
 *    source ring collapses to the canonical 32 stations with ZERO micro
 *    edges (was 89 raw / 60 collapsed / 28 micro edges).
 *  - the mesh is CURRENT 128/128, plan 9452.124826335, two boundary cycles;
 *    plan and 3D areas are unchanged from the pre-canonicalization mesh.
 *  - coincident vertex sets are 0 for both the product (bulge round-trip)
 *    fixture and the canonical direct-engine rounded square (was 4 and 11).
 *  - Design Patch now resolves end to end: the flat 32-station ring ear-clips
 *    and merges into one 128-vertex / 158-triangle `design-patch` surface
 *    (`CURRENT -> enabled -> patch -> provenance -> Undo/Redo`).
 *  - Wave E1 derives three INDEPENDENT products from the certificate: Extract
 *    needs one continuous boundary Feature Line (multi-region unavailable),
 *    Bake is an explicit-TIN surface (multi-component available), and Design
 *    Patch is a closed annular shell. Availability and the command agree, so
 *    an enabled control never returns a silent null.
 *
 * Update only with a deliberate engine fix and a matching audit-doc revision.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { validateGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import {
  buildGradingTopologyCertificateExact,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { GRADING_TOPOLOGY_POLICY_VERSION } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  deriveGradingProductCapabilities,
  GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS,
  GRADING_PRODUCT_EXTRACT_MULTI_REGION,
  GRADING_PRODUCT_NOT_CURRENT,
} from '../src/engine/cad/grading/gradingProductCapabilities';
import { directFanOnTarget } from '../src/engine/cad/grading/gradingChordSeam';
import { DESIGN_PATCH_NON_ANNULUS } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import {
  deriveSourceRing,
  resolveDesignPatchInterior,
  resolveDesignPatchRing,
  validateSourceRing,
} from '../src/engine/cad/grading/designPatchBuild';
import {
  designPatchSourceBoundaryPoints,
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { geometricDiagnostic } from '../scripts/phase20kHybridArcPairAudit';
import { flatTin, roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadGradingResult, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { TargetQuery } from '../src/engine/cad/grading/gradingComputeTypes';

const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const Z = 10;
const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

/** Same outward rounded-square arcs as the 20K.2 study fixture, as bulge geometry. */
const arcGeometry = (): Array<{ kind: 'arc'; bulge: number }> => {
  const members = roundedSquareMembers(Z);
  return members.map((member, k) => {
    const arc = member.source.arc!;
    let sweep = ((((arc.endAngle - arc.startAngle) * 180) / Math.PI) % 360 + 360) % 360;
    if (!arc.sweepCCW) sweep -= 360;
    const bulge = parcelBulgeFromArcDefinition({
      from: { x: SQUARE[k]![0], y: SQUARE[k]![1] },
      to: { x: SQUARE[(k + 1) % 4]![0], y: SQUARE[(k + 1) % 4]![1] },
      center: { x: arc.centerX, y: arc.centerY },
      radius: arc.radius,
      signedSweepDeg: sweep,
    });
    if (bulge == null) throw new Error(`bulge ${k} unresolved`);
    return { kind: 'arc', bulge };
  });
};

const TIN = {
  vertices: [-600, -600, 0, 1000, -600, 0, 1000, 1000, 0, -600, 1000, 0],
  faces: [0, 1, 2, 0, 2, 3],
  provenance: { kind: 'webnet-bake' as const, sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
};

const flatSurface = (id: string): CadSurface => ({
  id, name: 'EG', layerId: 'general',
  definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: TIN },
  cachedRevision: null,
});

interface ProductSquare {
  project: CadProject;
  entity: CadFeatureLineEntity;
  groupId: string;
  revision: string;
  result: CadGradingGroupResult;
}

/** Real product world: closed all-Surface rounded-square group on a flat z=0 target. */
const buildSquare = (): ProductSquare => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 A4', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'fl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'Rounded square', closed: true,
    vertices: SQUARE.map(([x, y], k) => ({ id: `v${k}`, x, y, z: Z })),
    segmentGeometry: arcGeometry(),
  };
  const project: CadProject = { ...drawing.project, entities: [entity], surfaces: [flatSurface('tgt')] };
  const ids = entity.vertices.map((v) => v.id);
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE', name: 'RG', sourceFeatureLineId: 'fl',
    sourceCourses: ids.map((id, i) => ({ vertexAId: id, vertexBId: ids[(i + 1) % 4]! })),
    targetSurfaceId: 'tgt', side: 'right', criterion: FIXED, maxSearchDistance: 100,
    curveChordTolerance: 0.1, closed: true,
  });
  const withGroup = history.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId)!;
  const outcome = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision, members: inputs.memberSources,
    side: inputs.group.side, criterion: inputs.group.criterion,
    memberCriteria: [FIXED, FIXED, FIXED, FIXED],
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance, closed: true,
    target: { points: TIN.vertices, triangles: TIN.faces },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return { project: withGroup, entity, groupId, revision: inputs.revision, result: outcome.result };
};

const capturedRing = (square: ProductSquare): number[] => {
  const inputs = resolveGroupInputs(square.project, square.groupId)!;
  const ring = resolveDesignPatchRing(inputs.group, square.entity, 0.1, square.result.sourceBoundaryPoints);
  if (!ring.ok) throw new Error(`ring capture failed: ${ring.code} ${ring.detail ?? ''}`);
  return ring.ring;
};

// ---------------------------------------------------------------------------
// Micro-edge inventory (source samples before/after the Surface seam assembly)
// ---------------------------------------------------------------------------

interface MicroEdge { i: number; j: number; plan: number; dz: number }

const microEdges = (ring: readonly number[]): MicroEdge[] => {
  const n = ring.length / 3;
  const out: MicroEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const plan = Math.hypot(ring[i * 3]! - ring[j * 3]!, ring[i * 3 + 1]! - ring[j * 3 + 1]!);
    const dz = Math.abs(ring[i * 3 + 2]! - ring[j * 3 + 2]!);
    if (plan > 0 && plan < 1e-6) out.push({ i, j, plan, dz });
  }
  return out;
};

describe('20K.3 A4 all-Surface rounded square — canonical seam inventory', () => {
  it('records the canonical source boundary, exact joint V, mesh, plan', () => {
    const square = buildSquare();
    const { result } = square;
    expect(result.gradingMesh.points.length / 3).toBe(128);
    expect(result.gradingMesh.triangles.length / 3).toBe(128);
    expect(result.gradingPlanArea).toBeCloseTo(9452.124826335, 9);
    expect(validateGroupMesh(result.gradingMesh)).toBeNull();
    expect(result.corners.map((c) => c.classification)).toEqual(['GAP', 'GAP', 'GAP', 'GAP']);

    // Before: the ideal discretization re-derived from the persisted Feature
    // Line (32 stations, 8 per arc chord).
    const inputs = resolveGroupInputs(square.project, square.groupId)!;
    const derived = deriveSourceRing(inputs.group, square.entity, 0.1);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.ring.length / 3).toBe(32);

    // After Wave C: the raw captured `sourceBoundaryPoints` (89) still holds
    // the repeated-V fan samples (exact duplicates, not ULP twins); the
    // bit-identical collapse reduces it to the canonical 32-station ring
    // with ZERO ulp-twin micro-edges.
    expect(result.sourceBoundaryPoints!.length / 3).toBe(89);
    const ring = capturedRing(square);
    expect(ring.length / 3).toBe(32);
    const micro = microEdges(ring);
    expect(micro).toHaveLength(0);
    expect([...new Set(Array.from({ length: 32 }, (_, i) => ring[i * 3 + 2]!))]).toEqual([Z]);

    // Exact joint V: four shared stations at ring indices 0/8/16/24, each
    // bit-identical to the canonical square corner.
    const cornerIndex = (x: number, y: number): number => {
      const at: number[] = [];
      for (let i = 0; i < 32; i += 1) if (ring[i * 3] === x && ring[i * 3 + 1] === y) at.push(i);
      return at.length === 1 ? at[0]! : -1;
    };
    expect([[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => cornerIndex(x!, y!))).toEqual([0, 8, 16, 24]);
  });

  it('reconciles the product-path and canonical-engine coincidence sets to zero', () => {
    const square = buildSquare();
    const product = geometricDiagnostic(square.result.gradingMesh);
    // Product path (bulge -> centre/radius round-trip): exact-index strip.
    expect(product.coincidentSets.length).toBe(0);
    expect(product.coincidentNonSharedEdges).toBe(0);
    expect(product.weldedDegenerateTriangles).toBe(0);
    expect(product.indexEdgeComponents).toBe(1);

    // Canonical direct-engine fixture (20K.1 row H): the same reconciled 0
    // after Wave C source-station canonicalization.
    const direct = computeGradingGroupFromSnapshots({
      groupId: 'canonical', revision: 'r',
      members: roundedSquareMembers(Z).map((m) => m.source),
      side: 'right', criterion: FIXED, memberCriteria: [FIXED, FIXED, FIXED, FIXED],
      maxSearchDistance: 100, curveChordTolerance: 0.1, closed: true, target: flatTin(0),
    });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(direct.result.gradingMesh.points.length / 3).toBe(128);
    expect(geometricDiagnostic(direct.result.gradingMesh).coincidentSets.length).toBe(0);

    // Two boundary cycles (source + daylight) certify the annulus at both.
    expect(square.result.topologyCertificate).toMatchObject({
      version: 'gtop2', scope: 'group', components: 1, boundaryCycles: 2, boundaryEdges: 128,
      positiveWidthRegionCount: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Design Patch — Wave C success path
// (CURRENT -> enabled -> patch -> provenance -> Undo/Redo)
// ---------------------------------------------------------------------------

describe('20K.3 A4 Design Patch Wave C success path', () => {
  it('ear-clips the canonical 32-station ring and builds the flat pad interior', () => {
    const square = buildSquare();
    const ring = capturedRing(square);
    // Structural ring simplicity plus a successful flat-pad ear-clip.
    expect(validateSourceRing(ring)).toEqual({ ok: true });
    const interior = resolveDesignPatchInterior(ring);
    expect(interior.ok).toBe(true);
    if (!interior.ok) return;
    expect(interior.kind).toBe('flat');
    expect(interior.interiorPolicy).toBe('flat-source');
    expect(interior.padZ).toBe(Z);
  });

  it('resolves CURRENT -> enabled -> patch with exact provenance, Undo/Redo', () => {
    const square = buildSquare();
    const boundary = designPatchSourceBoundaryPoints(square.project, square.groupId, square.result);
    expect(boundary.ok).toBe(true);
    if (!boundary.ok) return;
    expect(boundary.ring.length / 3).toBe(32);

    const dp = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
    expect(dp.ok).toBe(true);
    if (!dp.ok) return;
    expect(dp.value.padZ).toBe(Z);
    expect(dp.value.points.length / 3).toBe(128);
    expect(dp.value.triangles.length / 3).toBe(158);
    expect(dp.value.provenance).toMatchObject({
      kind: 'webnet-grading-design-patch',
      groupId: square.groupId,
      groupRevision: square.revision,
      accuracy: 'CURVE_APPROXIMATED',
      cornerMode: 'miter',
      includesInterior: true,
      interiorPolicy: 'flat-source',
    });

    const patched = runCadCommand(createCadHistoryState(square.project), {
      key: 'DESIGNPATCH', groupId: square.groupId, result: square.result,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(patched.undoStack.length).toBe(1);
    expect(patched.present.project.surfaces).toHaveLength(2);
    expect(patched.present.project.surfaces!.some((s) => s.purpose === 'design-patch')).toBe(true);

    const undone = undoCadHistory(patched);
    expect(undone.present.project.surfaces).toHaveLength(1);
    const redone = redoCadHistory(undone);
    expect(JSON.stringify(redone.present.project)).toBe(JSON.stringify(patched.present.project));
  });
});

// ---------------------------------------------------------------------------
// Wave E1 — independent product capabilities (Extract / Bake / Design Patch).
//
// Each product derives its own availability from the certificate, and the
// commands execute exactly when the matching capability is available (no
// enabled control returns a silent null). A certified multi-region mesh is
// EXTRACT-unavailable (one Feature Line cannot represent a disjoint
// boundary) but BAKE-available (the engine materializes an explicit-TIN
// face set 1:1, including multiple valid components).
// ---------------------------------------------------------------------------

const TIED_MESH = {
  points: [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0],
  triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
};

interface StandaloneWorld {
  project: CadProject;
  gradingId: string;
  revision: string;
  result: CadGradingResult;
}

const standaloneWorld = (): StandaloneWorld => {
  const drawing = createBlankCadDrawingDocument({ name: '20K.3 A4 standalone', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'sfl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'SFL', vertices: [{ id: 'sa', x: 0, y: 0, z: Z }, { id: 'sb', x: 100, y: 0, z: Z }],
  };
  const project: CadProject = { ...drawing.project, entities: [entity], surfaces: [flatSurface('tgt')] };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE', name: 'SG', sourceFeatureLineId: 'sfl',
    vertexAId: 'sa', vertexBId: 'sb', targetSurfaceId: 'tgt', side: 'right',
    criterion: FIXED, maxSearchDistance: 100, curveChordTolerance: 0.1,
  });
  const withGrading = created.present.project;
  const gradingId = withGrading.gradings![0]!.id;
  const inputs = resolveGradingInputs(withGrading, gradingId)!;
  const outcome = computeGradingFromSnapshots({
    gradingId, revision: inputs.revision, source: inputs.resolvedSource, side: 'right',
    criterion: FIXED, maxSearchDistance: 100, curveChordTolerance: 0.1,
    target: { points: TIN.vertices, triangles: TIN.faces },
  });
  if (!outcome.ok) throw new Error(`standalone compute failed: ${outcome.code}`);
  return { project: withGrading, gradingId, revision: inputs.revision, result: outcome.result };
};

/** Certified two-component mesh with the fixture's own exported boundaries.
 *
 * gtop2-only (no migration): declares the measured 2 components / 2 cycles
 * as two open-split regions, so the production gate accepts it while
 * Extract stays multi-region-unavailable.
 */
const tiedCertificate = (
  scope: 'standalone' | 'group',
  sourceBoundaryPoints: readonly number[],
  daylightPoints: readonly number[],
) =>
  buildGradingTopologyCertificateExact({
    scope,
    points: TIED_MESH.points,
    triangles: TIED_MESH.triangles,
    expectation: {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION,
      scope,
      shape: 'split-open-strips',
      expectedFaceComponents: 2,
      expectedBoundaryCycles: 2,
      positiveWidthRegionCount: 2,
      tiedSplitCoords: [20, 20, 0],
      closed: false,
      sourceBoundaryKind: 'open-path',
      gradingBoundaryKind: 'open-path',
    },
    sourceBoundaryPoints,
    gradingBoundaryPoints: daylightPoints,
  });

describe('20K.3 E1 independent Extract / Bake capabilities', () => {
  it('single-region group: extractable and bakeable, one Undo each', () => {
    const square = buildSquare();
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: square.result, closed: true,
    });
    expect(caps.extract).toEqual({ available: true, code: null, notice: null });
    expect(caps.bake).toEqual({ available: true, code: null, notice: null });
    expect(caps.designPatch).toEqual({ available: true, code: null, notice: null });

    let history = createCadHistoryState(square.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT', groupId: square.groupId, result: square.result,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    history = runCadCommand(history, {
      key: 'GROUPBAKE', groupId: square.groupId, result: square.result,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(2);
    expect(history.present.project.surfaces).toHaveLength(2);
  });

  it('multi-region group: extractable != bakeable and commands agree with the flags', () => {
    const square = buildSquare();
    const cert = tiedCertificate('group', square.result.sourceBoundaryPoints!, square.result.daylightPoints);
    const tiedResult: CadGradingGroupResult = {
      ...square.result, gradingMesh: { ...TIED_MESH }, topologyCertificate: cert!,
    };
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: tiedResult, closed: true,
    });
    expect(caps.extract.available).toBe(false);
    expect(caps.extract.code).toBe(GRADING_PRODUCT_EXTRACT_MULTI_REGION);
    expect(caps.extract.notice).toMatch(/multiple regions/);
    expect(caps.bake.available).toBe(true);
    // Design Patch is bounded to the closed annulus: multi-region unavailable.
    expect(caps.designPatch?.available).toBe(false);
    expect(caps.designPatch?.code).toBe(GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS);

    const before = JSON.stringify(square.project);
    let history = createCadHistoryState(square.project);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT', groupId: square.groupId, result: tiedResult,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
    history = runCadCommand(history, {
      key: 'GROUPBAKE', groupId: square.groupId, result: tiedResult,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    expect(history.present.project.surfaces).toHaveLength(2);
    const baked = history.present.project.surfaces!.find((surface) => surface.id !== 'tgt')!;
    expect(baked.definition.importedTin?.provenance).toMatchObject({
      kind: 'webnet-grading-group-bake', groupId: square.groupId,
    });
  });

  it('standalone multi-region: same independence, no design patch scope', () => {
    const world = standaloneWorld();
    const cert = tiedCertificate('standalone', world.result.sourceBoundaryPoints!, world.result.daylightPoints);
    const tiedResult: CadGradingResult = {
      ...world.result, gradingMesh: { ...TIED_MESH }, topologyCertificate: cert!,
    };
    const caps = deriveGradingProductCapabilities({
      scope: 'standalone', current: true, result: tiedResult,
    });
    expect(caps.extract.available).toBe(false);
    expect(caps.extract.code).toBe(GRADING_PRODUCT_EXTRACT_MULTI_REGION);
    expect(caps.bake.available).toBe(true);
    expect(caps.designPatch).toBeNull();

    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT', gradingId: world.gradingId, result: tiedResult,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    history = runCadCommand(history, {
      key: 'GRADINGBAKE', gradingId: world.gradingId, result: tiedResult,
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
  });

  it('stale results and a missing certificate are unavailable with bounded codes', () => {
    const square = buildSquare();
    const stale = deriveGradingProductCapabilities({
      scope: 'group', current: false, result: square.result, closed: true,
    });
    expect(stale.extract.available).toBe(false);
    expect(stale.bake.available).toBe(false);
    expect(stale.designPatch?.available).toBe(false);
    expect(stale.bake.code).toBe(GRADING_PRODUCT_NOT_CURRENT);

    const { topologyCertificate: _dropped, ...uncertified } = square.result;
    const noCert = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: uncertified as CadGradingGroupResult, closed: true,
    });
    expect(noCert.extract.available).toBe(false);
    expect(noCert.bake.available).toBe(false);
    // The flag and the command agree: an unavailable Bake never nulls silently.
    let history = createCadHistoryState(square.project);
    history = runCadCommand(history, {
      key: 'GROUPBAKE', groupId: square.groupId, result: uncertified as CadGradingGroupResult,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
  });

  it('Design Patch is the closed 2-cycle annulus only', () => {
    const square = buildSquare();
    expect(square.result.topologyCertificate).toMatchObject({ components: 1, boundaryCycles: 2 });
    const open = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: square.result, closed: false,
    });
    expect(open.designPatch?.available).toBe(false);
    expect(open.designPatch?.code).toBe('GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED');

    const cert = tiedCertificate('group', square.result.sourceBoundaryPoints!, square.result.daylightPoints);
    const tiedResult: CadGradingGroupResult = {
      ...square.result, gradingMesh: { ...TIED_MESH }, topologyCertificate: cert!,
    };
    const dp = resolveDesignPatch(square.project, square.groupId, tiedResult, square.revision, true);
    expect(dp.ok).toBe(false);
    if (!dp.ok) expect(dp.code).toBe(DESIGN_PATCH_NON_ANNULUS);
  });

  it('a certificate mismatch is a stable code and blocks the command (no enabled null)', () => {
    const square = buildSquare();
    const tampered = { ...square.result.topologyCertificate!, meshDigest: 'deadbeef' };
    const bad: CadGradingGroupResult = { ...square.result, topologyCertificate: tampered };
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: bad, closed: true,
    });
    expect(caps.extract.available).toBe(false);
    expect(caps.bake.available).toBe(false);
    expect(caps.bake.code).not.toBeNull();
    let history = createCadHistoryState(square.project);
    history = runCadCommand(history, {
      key: 'GROUPBAKE', groupId: square.groupId, result: bad,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wave E1 — target-fan coverage hardening: overlapping coplanar target
// facets, duplicate sheets, and void compensation must all fail closed.
// ---------------------------------------------------------------------------

describe('20K.3 E1 target-fan coverage hardening', () => {
  const V = { x: 0, y: 0, z: 0 };
  const QIN = { x: 1, y: 0, z: 0 };
  const QOUT = { x: 0, y: 1, z: 0 };
  const CUT_FILL: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: 0.2, fillGradeRatio: -0.2 };
  const query = (points: number[], triangles: number[]): TargetQuery => ({
    elevationAt: () => 0,
    targetPoints: points,
    targetTriangles: triangles,
    queryCount: 0,
  });

  it('accepts one exact coplanar facet covering the fan', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2]), V, QIN, QOUT)).toBe(true);
  });

  it('accepts two disjoint coplanar facets tiling the fan exactly once', () => {
    const points = [0, 0, 0, 1, 0, 0, 0.5, 0.5, 0, 0, 1, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2, 0, 2, 3]), V, QIN, QOUT)).toBe(true);
  });

  it('rejects duplicate coplanar sheets that compensate for a void', () => {
    // Fan area 0.5. Region A (0.25) is covered twice while region B is void,
    // so the area SUM equals the fan (the 20K.2 walk accepted this).
    const points = [0, 0, 0, 1, 0, 0, 0.5, 0.5, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2, 0, 1, 2]), V, QIN, QOUT)).toBe(false);
  });

  it('rejects overcoverage (two full-fan duplicate sheets)', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2, 0, 1, 2]), V, QIN, QOUT)).toBe(false);
  });

  it('rejects a genuine void (one facet covering only half the fan)', () => {
    const points = [0, 0, 0, 1, 0, 0, 0.5, 0.5, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2]), V, QIN, QOUT)).toBe(false);
  });

  it('rejects an off-plane facet (ridge/valley)', () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 2];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2]), V, QIN, QOUT)).toBe(false);
  });

  it('accepts two disjoint coplanar facets tiling the fan exactly once at 1e8 offset', () => {
    const O = 1e8;
    const v8 = { x: O, y: O, z: 0 };
    const qin8 = { x: O + 1, y: O, z: 0 };
    const qout8 = { x: O, y: O + 1, z: 0 };
    const points = [O, O, 0, O + 1, O, 0, O + 0.5, O + 0.5, 0, O, O + 1, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2, 0, 2, 3]), v8, qin8, qout8)).toBe(true);
  });

  it('rejects duplicate coplanar sheets that compensate for a void at 1e8 offset', () => {
    const O = 1e8;
    const v8 = { x: O, y: O, z: 0 };
    const qin8 = { x: O + 1, y: O, z: 0 };
    const qout8 = { x: O, y: O + 1, z: 0 };
    const points = [O, O, 0, O + 1, O, 0, O + 0.5, O + 0.5, 0];
    expect(directFanOnTarget(CUT_FILL, query(points, [0, 1, 2, 0, 1, 2]), v8, qin8, qout8)).toBe(false);
  });
});
