/**
 * Phase 20K.3 — gtop2-only production gate.
 *
 * The legacy generic reader (`gradingTopologyCertificateError`) stays
 * legacy-compatible for historical reproduction, but ALL production paths
 * (capabilities, Extract/Bake commands, Design Patch resolve) route through
 * the `*Production*` wrappers (exact reader, no migration). A well-formed
 * gtop1 certificate therefore cannot enable capabilities or execute product
 * commands, while a gtop2 certificate for the same mesh succeeds.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import {
  buildGradingTopologyCertificate,
  buildGradingTopologyCertificateExact,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import {
  deriveGradingProductCapabilities,
  GRADING_PRODUCT_BAKE_CERTIFICATE,
  GRADING_PRODUCT_EXTRACT_CERTIFICATE,
} from '../src/engine/cad/grading/gradingProductCapabilities';
import { deriveGradingTopologyExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import type { CadGradingResult, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';

const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };
const Z = 10;
const TIN = {
  vertices: [-600, -600, 0, 1000, -600, 0, 1000, 1000, 0, -600, 1000, 0],
  faces: [0, 1, 2, 0, 2, 3],
  provenance: { kind: 'webnet-bake' as const, sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
};

const standaloneWorld = (): { project: CadProject; gradingId: string; revision: string; result: CadGradingResult } => {
  const drawing = createBlankCadDrawingDocument({ name: 'gtop2 gate', units: 'm' });
  const entity: CadFeatureLineEntity = {
    id: 'sfl', type: 'feature-line', layerId: 'general', visible: true, locked: false,
    name: 'SFL', vertices: [{ id: 'sa', x: 0, y: 0, z: Z }, { id: 'sb', x: 100, y: 0, z: Z }],
  };
  const project: CadProject = {
    ...drawing.project,
    entities: [entity],
    surfaces: [{
      id: 'tgt', name: 'EG', layerId: 'general',
      definition: { sourceKind: 'explicit-tin', pointSource: { kind: 'points', pointEntityIds: [] }, importedTin: TIN },
      cachedRevision: null,
    }],
  };
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

/** Same mesh, both certificate generations, over the world's own boundaries. */
const bothCerts = (result: CadGradingResult) => {
  const gtop1 = buildGradingTopologyCertificate({
    scope: 'standalone',
    points: [...result.gradingMesh.points],
    triangles: [...result.gradingMesh.triangles],
    sourceBoundaryPoints: result.sourceBoundaryPoints,
    gradingBoundaryPoints: result.daylightPoints,
  });
  expect(gtop1).not.toBeNull();
  const gtop2 = buildGradingTopologyCertificateExact({
    scope: 'standalone',
    points: [...result.gradingMesh.points],
    triangles: [...result.gradingMesh.triangles],
    expectation: deriveGradingTopologyExpectation({
      scope: 'standalone', closed: false, positiveWidthRegions: 1, tiedSplitCoords: [],
    }),
    sourceBoundaryPoints: result.sourceBoundaryPoints,
    gradingBoundaryPoints: result.daylightPoints,
  });
  expect(gtop2).not.toBeNull();
  return { gtop1: gtop1!, gtop2: gtop2! };
};

describe('gtop2-only production gate', () => {
  it('gtop1 cannot enable capabilities; gtop2 on the same mesh can', () => {
    const world = standaloneWorld();
    const { gtop1, gtop2 } = bothCerts(world.result);
    const legacy = deriveGradingProductCapabilities({
      scope: 'standalone', current: true,
      result: { ...world.result, topologyCertificate: gtop1 },
    });
    expect(legacy.extract.available).toBe(false);
    expect(legacy.extract.code).toBe(GRADING_PRODUCT_EXTRACT_CERTIFICATE);
    expect(legacy.bake.available).toBe(false);
    expect(legacy.bake.code).toBe(GRADING_PRODUCT_BAKE_CERTIFICATE);
    const exact = deriveGradingProductCapabilities({
      scope: 'standalone', current: true,
      result: { ...world.result, topologyCertificate: gtop2 },
    });
    expect(exact.extract).toEqual({ available: true, code: null, notice: null });
    expect(exact.bake).toEqual({ available: true, code: null, notice: null });
  });

  it('gtop1 executes no product command; gtop2 executes both', () => {
    const world = standaloneWorld();
    const { gtop1, gtop2 } = bothCerts(world.result);
    let history = createCadHistoryState(world.project);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT', gradingId: world.gradingId,
      result: { ...world.result, topologyCertificate: gtop1 },
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    history = runCadCommand(history, {
      key: 'GRADINGBAKE', gradingId: world.gradingId,
      result: { ...world.result, topologyCertificate: gtop1 },
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT', gradingId: world.gradingId,
      result: { ...world.result, topologyCertificate: gtop2 },
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    history = runCadCommand(history, {
      key: 'GRADINGBAKE', gradingId: world.gradingId,
      result: { ...world.result, topologyCertificate: gtop2 },
      expectedRevision: world.revision, sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(2);
  });
});
