/**
 * Phase 20M.2 WAVE G — transition product + provenance.
 *
 * Provenance records policy/law version, width + measure, interval,
 * joint/member identities, family/native refs, transition stations, and
 * admission/agreement metadata. Extract/Bake stay available only when the
 * existing capability/topology rules permit and then truthfully carry the
 * transition geometry/provenance; Design Patch stays unavailable for the
 * open route (never widened); FAILED/stale blocks every product.
 * Execution runs through the REAL GROUPBAKE/GROUPEXTRACTDAYLIGHT commands
 * with Undo/Redo, following the existing product test patterns.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import {
  deriveGradingProductCapabilities,
  GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED,
  GRADING_PRODUCT_NOT_CURRENT,
} from '../src/engine/cad/grading/gradingProductCapabilities';
import {
  applyTransitionProductGate,
  buildTransitionProvenance,
} from '../src/engine/cad/grading/gradingTransitionProvenance';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';

let seq = 0;
const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const projectWithChain = (): { project: CadProject; chainId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Transition Products', units: 'm' });
  seq += 1;
  const chainId = `fl-20m2-g-${seq}`;
  const chain: CadFeatureLineEntity = {
    id: chainId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${chainId}`,
    vertices: [
      vertex(`feature-vertex:${chainId}:a`, 0, 0, 10),
      vertex(`feature-vertex:${chainId}:b`, 100, 0, 10),
      vertex(`feature-vertex:${chainId}:c`, 100, 100, 10),
    ],
  };
  return { project: { ...drawing.project, entities: [chain] }, chainId };
};

const createOpenAnalyticGroup = (project: CadProject, chainId: string): CadProject => {
  const fl = project.entities.find((entry) => entry.id === chainId) as CadFeatureLineEntity;
  const [a, b, c] = fl.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'TG',
    sourceFeatureLineId: chainId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
    ],
    side: 'left',
    criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
  });
  return state.present.project;
};

const calculateGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    memberCriteria: inputs.memberCriteria,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: false,
  });
  if (!outcome.ok) throw new Error(`group solve failed: ${outcome.code} ${outcome.detail ?? ''}`);
  return outcome.result;
};

const withTransitionIntent = (project: CadProject, groupId: string): CadProject => ({
  ...project,
  gradingGroups: (project.gradingGroups ?? []).map((entry) =>
    entry.id !== groupId
      ? entry
      : {
          ...entry,
          transitions: [
            {
              policyVersion: 'trp1',
              jointId: 'joint:1',
              memberIds: ['A>B', 'B>C'],
              width: 8,
              lawKind: 'TRANSITION_LINEAR_V1',
              lawVersion: 'v1',
              criterionFamily: 'distance',
              side: 'left',
            },
          ],
        } as CadGradingGroup,
  ),
});

describe('20M.2 WAVE G transition product + provenance', () => {
  it('records the full provenance envelope for an admitted transition', () => {
    const provenance = buildTransitionProvenance({
      intent: {
        policyVersion: 'trp1',
        jointId: 'joint:1',
        memberIds: ['A>B', 'B>C'],
        width: 8,
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: 'distance',
        side: 'left',
      },
      memberIds: ['A>B', 'B>C'],
      family: 'distance',
      endpointScalars: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      interval: { sL: -4, sR: 4 },
      jointStation: 100,
      recordedRevision: 'ggrev1:pin',
      agreementCode: null,
    });
    expect(provenance).toMatchObject({
      policyVersion: 'trp1',
      lawKind: 'TRANSITION_LINEAR_V1',
      lawVersion: 'v1',
      widthMeters: 8,
      widthMeasure: 'source-line',
      interval: { sL: -4, sR: 4 },
      jointId: 'joint:1',
      memberIds: ['A>B', 'B>C'],
      criterionFamily: 'distance',
      endpointScalars: { vL: 5, vR: 7, gL: 0.5, gR: 0.5 },
      jointStation: 100,
      recordedRevision: 'ggrev1:pin',
      agreementCode: null,
    });
  });

  it('keeps Extract/Bake available on a transitioned CURRENT group; Design Patch stays off for the open route', () => {
    const { project, chainId } = projectWithChain();
    const withGroup = createOpenAnalyticGroup(project, chainId);
    const groupId = withGroup.gradingGroups![0]!.id;
    const transitioned = withTransitionIntent(withGroup, groupId);
    const result = calculateGroup(transitioned, groupId);
    const base = deriveGradingProductCapabilities({
      scope: 'group',
      current: true,
      result,
      closed: false,
    });
    expect(base.extract.available).toBe(true);
    expect(base.bake.available).toBe(true);
    const gated = applyTransitionProductGate(base, { failed: false, stale: false, closed: false });
    expect(gated.extract.available).toBe(true);
    expect(gated.bake.available).toBe(true);
    // The transition interval is transition-owned mesh carried verbatim.
    expect(gated.extract.available && result.daylightPoints.length).toBeGreaterThan(0);
    expect(gated.designPatch?.available).toBe(false);
    expect(gated.designPatch?.code).toBe(GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED);
  });

  it('blocks every product on FAILED/stale and executes Bake with citation + Undo/Redo', () => {
    const { project, chainId } = projectWithChain();
    const withGroup = createOpenAnalyticGroup(project, chainId);
    const groupId = withGroup.gradingGroups![0]!.id;
    const transitioned = withTransitionIntent(withGroup, groupId);
    const result = calculateGroup(transitioned, groupId);
    const base = deriveGradingProductCapabilities({
      scope: 'group',
      current: true,
      result,
      closed: false,
    });
    for (const status of [{ failed: true, stale: false }, { failed: false, stale: true }] as const) {
      const gated = applyTransitionProductGate(base, { ...status, closed: false });
      expect(gated.extract).toMatchObject({ available: false, code: GRADING_PRODUCT_NOT_CURRENT });
      expect(gated.bake).toMatchObject({ available: false, code: GRADING_PRODUCT_NOT_CURRENT });
      expect(gated.designPatch).toMatchObject({ available: false, code: GRADING_PRODUCT_NOT_CURRENT });
    }
    // Stale execution refuses at the command gate (existing revision rule).
    const stale = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: 'ggrev1:stale',
      sessionCurrent: true,
    });
    expect(stale.undoStack).toHaveLength(0);

    const revision = resolveGroupInputs(transitioned, groupId)!.revision;
    const baked = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(baked.undoStack).toHaveLength(1);
    const surface = baked.present.project.surfaces!.find((entry) => entry.name === 'TG - Baked')!;
    const payload = surface.definition.sourceKind === 'explicit-tin' ? surface.definition.importedTin : null;
    const provenance = payload?.provenance as unknown as { transitions?: unknown[] };
    expect(provenance?.transitions).toMatchObject([
      {
        policyVersion: 'trp1',
        jointId: 'joint:1',
        widthMeters: 8,
        widthMeasure: 'source-line',
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: 'distance',
      },
    ]);
    const undone = undoCadHistory(baked);
    expect(undone.present.project.surfaces!.some((entry) => entry.id === surface.id)).toBe(false);
    expect(redoCadHistory(undone).present.project.surfaces!.some((entry) => entry.id === surface.id)).toBe(true);

    // Extract executes on the transitioned CURRENT group and round-trips Undo/Redo.
    const extracted = runCadCommand(createCadHistoryState(transitioned), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(extracted.undoStack).toHaveLength(1);
    const boundary = extracted.present.project.entities.find(
      (entry) => entry.type === 'feature-line' && entry.name === 'TG - Daylight',
    ) as CadFeatureLineEntity;
    expect(boundary.vertices.length).toBe(result.daylightPoints.length / 3);
    const undoneExtract = undoCadHistory(extracted);
    expect(undoneExtract.present.project.entities.some((entry) => entry.id === boundary.id)).toBe(false);
    expect(redoCadHistory(undoneExtract).present.project.entities.some((entry) => entry.id === boundary.id)).toBe(true);
  });
});
