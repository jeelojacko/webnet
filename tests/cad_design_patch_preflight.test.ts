/**
 * Phase 20K.3 Wave E1 — Design Patch capability/command agreement.
 *
 * The UI capability and `resolveDesignPatch` share the pure preflight
 * (`designPatchPreflightFor*`), so an enabled Build Design Patch always
 * executes: a certified closed annulus with a non-planar source is
 * DISABLED with a stable code, never enabled-and-null. A missing/corrupt
 * certificate blocks both sides as well.
 *
 * World builder mirrors the canonical all-Surface rounded square in
 * `cad_grading_surface_products_20k3.test.ts` (kept local: that file is
 * owned by a parallel worker).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { parcelBulgeFromArcDefinition } from '../src/engine/cad/cadParcelArcGeometry';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveDesignPatch } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { DESIGN_PATCH_CERTIFICATE } from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { resolveDesignPatchRing } from '../src/engine/cad/grading/designPatchBuild';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { buildGradingTopologyCertificateExact } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { GRADING_TOPOLOGY_POLICY_VERSION } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  deriveGradingProductCapabilities,
  GRADING_PRODUCT_DESIGN_PATCH_CERTIFICATE,
  GRADING_PRODUCT_DESIGN_PATCH_INTERIOR,
} from '../src/engine/cad/grading/gradingProductCapabilities';
import { roundedSquareMembers } from '../scripts/phase20kHybridArcPairGroups';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const Z = 10;
const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, 0], [100, 0], [100, 100], [0, 100]];

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

const buildSquare = (): ProductSquare => {
  const drawing = createBlankCadDrawingDocument({ name: 'preflight', units: 'm' });
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

/** Raise one canonical ring vertex by `dz`, keeping the mesh + cert consistent. */
const raiseSourceVertex = (square: ProductSquare, station: number, dz: number): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(square.project, square.groupId)!;
  const ring = resolveDesignPatchRing(inputs.group, square.entity, 0.1, square.result.sourceBoundaryPoints);
  if (!ring.ok) throw new Error(`ring capture failed: ${ring.code}`);
  const ox = ring.ring[station * 3]!;
  const oy = ring.ring[station * 3 + 1]!;
  const oz = ring.ring[station * 3 + 2]!;
  const swap = (points: readonly number[]): number[] => {
    const out = [...points];
    let hits = 0;
    for (let i = 0; i + 2 < out.length; i += 3) {
      if (out[i] === ox && out[i + 1] === oy && out[i + 2] === oz) {
        out[i + 2] = oz + dz;
        hits += 1;
      }
    }
    if (hits === 0) throw new Error('source vertex missing from buffer');
    return out;
  };
  const sourceBoundaryPoints = swap(square.result.sourceBoundaryPoints!);
  const points = swap(square.result.gradingMesh.points);
  const cert = buildGradingTopologyCertificateExact({
    scope: 'group', points, triangles: square.result.gradingMesh.triangles,
    expectation: {
      policyVersion: GRADING_TOPOLOGY_POLICY_VERSION, scope: 'group', shape: 'closed-annulus',
      expectedFaceComponents: 1, expectedBoundaryCycles: 2, positiveWidthRegionCount: 1,
      tiedSplitCoords: [], closed: true, sourceBoundaryKind: 'closed-ring', gradingBoundaryKind: 'closed-ring',
    },
    sourceBoundaryPoints, gradingBoundaryPoints: square.result.daylightPoints,
  });
  if (!cert) throw new Error('recertification failed');
  return {
    ...square.result,
    gradingMesh: { points, triangles: square.result.gradingMesh.triangles },
    sourceBoundaryPoints,
    topologyCertificate: cert,
  };
};

describe('Design Patch preflight agreement', () => {
  it('valid flat patch stays enabled and resolves', () => {
    const square = buildSquare();
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: square.result, closed: true,
    });
    expect(caps.designPatch).toEqual({ available: true, code: null, notice: null });
    const dp = resolveDesignPatch(square.project, square.groupId, square.result, square.revision, true);
    expect(dp.ok).toBe(true);
  });

  it('certified annulus with a non-planar source is disabled, never enabled-and-null', () => {
    const square = buildSquare();
    const tilted: CadGradingGroupResult = raiseSourceVertex(square, 4, 5);
    expect(tilted.topologyCertificate).toMatchObject({ components: 1, boundaryCycles: 2 });
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: tilted, closed: true,
    });
    expect(caps.designPatch?.available).toBe(false);
    expect(caps.designPatch?.code).toBe(GRADING_PRODUCT_DESIGN_PATCH_INTERIOR);
    expect(caps.designPatch?.notice).toMatch(/flat or planar/);

    const dp = resolveDesignPatch(square.project, square.groupId, tilted, square.revision, true);
    expect(dp.ok).toBe(false);
    if (!dp.ok) expect(dp.code).toBe(DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED);

    const history = runCadCommand(createCadHistoryState(square.project), {
      key: 'DESIGNPATCH', groupId: square.groupId, result: tilted,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
  });

  it('a missing certificate blocks both availability and direct execution', () => {
    const square = buildSquare();
    const { topologyCertificate: _unused, ...uncertified } = square.result;
    const result = uncertified as CadGradingGroupResult;
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result, closed: true,
    });
    expect(caps.designPatch?.available).toBe(false);
    const dp = resolveDesignPatch(square.project, square.groupId, result, square.revision, true);
    expect(dp.ok).toBe(false);
    if (!dp.ok) expect(dp.code).toBe(DESIGN_PATCH_CERTIFICATE);
    const history = runCadCommand(createCadHistoryState(square.project), {
      key: 'DESIGNPATCH', groupId: square.groupId, result,
      expectedRevision: square.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
  });

  it('a forged certificate blocks the capability and the command', () => {
    const square = buildSquare();
    const forged: CadGradingGroupResult = {
      ...square.result,
      topologyCertificate: { ...square.result.topologyCertificate!, meshDigest: 'deadbeef' },
    };
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: forged, closed: true,
    });
    expect(caps.designPatch?.available).toBe(false);
    expect(caps.designPatch?.code).toBe(GRADING_PRODUCT_DESIGN_PATCH_CERTIFICATE);
    const dp = resolveDesignPatch(square.project, square.groupId, forged, square.revision, true);
    expect(dp.ok).toBe(false);
    if (!dp.ok) expect(dp.code).toBe(DESIGN_PATCH_CERTIFICATE);
  });
});
