import { createStableRuntimeId } from '../id';
import { validateExplicitTinPayload } from './cadImportedTin';
import { backfillCadSurfaceStyles } from './cadSurfaceStyles';
import { resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type { CadCommand, CadCommandDefinition } from './cadTransactions.types';
import type { CadProject, CadSurface, WebnetGradingDesignPatchTinProvenance } from './cadTypes';
import {
  buildPadInterior,
  checkFlatRing,
  deriveSourceRing,
  makeDesignPatchProvenance,
  mergePadWithGrading,
  validateSourceRing,
  verifyRingAgainstMesh,
} from './grading/designPatchBuild';
import {
  designPatchBlock,
  type DesignPatchFailure,
  type DesignPatchRing,
} from './grading/designPatchRing';
import { resolveGroupInputs } from './grading/gradingGroupResolve';
import type { CadGradingGroupResult } from './grading/gradingGroupTypes';

/**
 * Phase 20D Wave-1C — DESIGNPATCH engine command (no UI).
 *
 * Snapshots a closed flat grading group's pad interior + CURRENT grading
 * shell into an ordinary `explicit-tin` surface (`purpose='design-patch'`).
 * Gates mirror GROUPBAKE (resolveGroupInputs + ggrev match + session
 * CURRENT assertion); every failure returns null (fail-closed) with a
 * distinct exported code observable through `resolveDesignPatch`.
 */

export const DESIGN_PATCH_GROUP_NOT_CURRENT = 'DESIGN_PATCH_GROUP_NOT_CURRENT';
export const DESIGN_PATCH_NOT_CLOSED = 'DESIGN_PATCH_NOT_CLOSED';
export const DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED = 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED';
export const DESIGN_PATCH_RING_MESH_MISMATCH = 'DESIGN_PATCH_RING_MESH_MISMATCH';
export const DESIGN_PATCH_NON_SIMPLE_RING = 'DESIGN_PATCH_NON_SIMPLE_RING';
export const DESIGN_PATCH_MERGE_FAILED = 'DESIGN_PATCH_MERGE_FAILED';

export type DesignPatchCommandBlockCode =
  | typeof DESIGN_PATCH_GROUP_NOT_CURRENT
  | typeof DESIGN_PATCH_NOT_CLOSED
  | typeof DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED
  | typeof DESIGN_PATCH_RING_MESH_MISMATCH
  | typeof DESIGN_PATCH_NON_SIMPLE_RING
  | typeof DESIGN_PATCH_MERGE_FAILED;

export interface DesignPatchResolved {
  ring: number[];
  padZ: number;
  points: number[];
  triangles: number[];
  provenance: WebnetGradingDesignPatchTinProvenance;
}

export type DesignPatchResolveOutcome =
  | { ok: true; value: DesignPatchResolved }
  | { ok: false; code: DesignPatchCommandBlockCode; detail?: string };

const fail = (code: DesignPatchCommandBlockCode, detail?: string): DesignPatchResolveOutcome =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };

/**
 * Session-only canonical source ring (never persisted): the group's source
 * boundary through the same discretization the group compute used. UI and
 * preflight read this instead of recomputing; no numeric output changes.
 */
export const designPatchSourceBoundaryPoints = (
  project: CadProject,
  groupId: string,
): DesignPatchRing | DesignPatchFailure => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'group inputs do not resolve');
  const entity = project.entities.find(
    (entry) => entry.type === 'feature-line' && entry.id === inputs.group.sourceFeatureLineId,
  );
  if (!entity || entity.type !== 'feature-line') {
    return designPatchBlock('DESIGN_PATCH_SOURCE_UNRESOLVED', 'source feature line not found');
  }
  return deriveSourceRing(inputs.group, entity, inputs.group.curveChordTolerance);
};

/** Pure gates + build: the command commits this, tests observe the codes. */
export const resolveDesignPatch = (
  project: CadProject,
  groupId: string,
  result: CadGradingGroupResult,
  expectedRevision: string,
  sessionCurrent: boolean,
): DesignPatchResolveOutcome => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) return fail(DESIGN_PATCH_GROUP_NOT_CURRENT, 'group inputs do not resolve');
  if (sessionCurrent !== true) return fail(DESIGN_PATCH_GROUP_NOT_CURRENT, 'session is not CURRENT');
  if (
    result.groupId !== inputs.group.id ||
    result.revision !== inputs.revision ||
    expectedRevision !== inputs.revision
  ) {
    return fail(DESIGN_PATCH_GROUP_NOT_CURRENT, 'result revision does not match the group');
  }
  if (inputs.group.closed !== true) return fail(DESIGN_PATCH_NOT_CLOSED, 'group is not closed');
  const derived = designPatchSourceBoundaryPoints(project, groupId);
  if (!derived.ok) return fail(DESIGN_PATCH_GROUP_NOT_CURRENT, derived.detail ?? derived.code);
  const ring = derived.ring;
  const valid = validateSourceRing(ring);
  if (!valid.ok) return fail(DESIGN_PATCH_NON_SIMPLE_RING, valid.detail);
  const flat = checkFlatRing(ring);
  if (!flat.ok) {
    return flat.code === DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED
      ? fail(DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED, flat.detail)
      : fail(DESIGN_PATCH_NON_SIMPLE_RING, flat.detail);
  }
  const verified = verifyRingAgainstMesh(ring, result.gradingMesh);
  if (!verified.ok) return fail(DESIGN_PATCH_RING_MESH_MISMATCH, verified.detail);
  const pad = buildPadInterior(ring, flat.padZ);
  if (!pad.ok) {
    return pad.code === DESIGN_PATCH_NON_SIMPLE_RING
      ? fail(DESIGN_PATCH_NON_SIMPLE_RING, pad.detail)
      : fail(DESIGN_PATCH_MERGE_FAILED, pad.detail);
  }
  const merged = mergePadWithGrading(pad.padPoints, pad.padTriangles, result.gradingMesh);
  if (!merged.ok) return fail(DESIGN_PATCH_MERGE_FAILED, merged.detail);
  return {
    ok: true,
    value: {
      ring,
      padZ: flat.padZ,
      points: merged.points,
      triangles: merged.triangles,
      provenance: makeDesignPatchProvenance({
        groupId: inputs.group.id,
        groupName: inputs.group.name,
        groupRevision: inputs.revision,
        sourceFeatureLineId: inputs.group.sourceFeatureLineId,
        sourceCourseRefs: inputs.group.sourceCourses.map(
          (course) => `${course.vertexAId}>${course.vertexBId}`,
        ),
        targetSurfaceId: inputs.target.id,
        targetSurfaceRevision: inputs.targetRevision,
        accuracy: result.accuracy,
      }),
    },
  };
};

const uniqueDesignPatchSurfaceName = (project: CadProject, groupName: string, wanted?: string): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  const base = wanted?.trim() || `${groupName} - Design Patch`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

type DesignPatchCommand = Extract<CadCommand, { key: 'DESIGNPATCH' }>;

const designPatchCommand: CadCommandDefinition<DesignPatchCommand> = {
  key: 'DESIGNPATCH',
  execute: (snapshot, command) => {
    const inputs = resolveGroupInputs(snapshot.project, command.groupId);
    if (!inputs) return null;
    if (command.styleId != null) {
      const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
      if (!styles.some((style) => style.id === command.styleId)) return null;
    }
    const resolved = resolveDesignPatch(
      snapshot.project,
      command.groupId,
      command.result,
      command.expectedRevision,
      command.sessionCurrent === true,
    );
    if (!resolved.ok) return null;
    const payload = {
      vertices: resolved.value.points,
      faces: resolved.value.triangles,
      provenance: resolved.value.provenance,
    };
    if (validateExplicitTinPayload(payload) != null) return null;
    const surface: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name: uniqueDesignPatchSurfaceName(snapshot.project, inputs.group.name, command.name),
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: payload,
      },
      purpose: 'design-patch',
      layerId: resolveSurfaceLayerId(snapshot.project, command.layerId ?? inputs.group.layerId),
      ...(command.styleId !== undefined
        ? (command.styleId !== null ? { styleId: command.styleId } : {})
        : (inputs.group.styleId != null ? { styleId: inputs.group.styleId } : {})),
      cachedRevision: null,
    };
    return commitLayerProject('DESIGNPATCH', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), surface],
    }, `DESIGNPATCH (${surface.name})`);
  },
};

export const designPatchCommandDefinitions = {
  DESIGNPATCH: designPatchCommand,
} as const;
