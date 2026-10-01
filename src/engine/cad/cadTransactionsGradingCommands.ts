import { createStableRuntimeId } from '../id';
import { buildFeatureLineEntity } from './cadFeatureLineCreate';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { canonicalizeBakedTin } from './cadExplicitBake';
import { validateExplicitTinPayload } from './cadImportedTin';
import {
  createBothSidesGrading,
  createGradingDefinition,
  editGradingCriteriaWithTarget,
  reassignGradingTarget,
} from './grading/gradingAuthoring';
import { gradingBoundaryLabel, gradingCriterionRequiresSurface, gradingTerminationKind } from './grading/gradingTypes';
import { resolveGradingSourceCourse } from './grading/gradingCourseFrame';
import { resolveGradingInputs } from './grading/gradingResolve';
import { gradingTopologyCertificateProductionError, gradingTopologyCertificateProductionProductError } from './grading/gradingTopologyCertificate';
import { appendCadProjectEntities } from './cadProjectState';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
} from './cadTransactions.types';
import type {
  CadProject,
  CadSurface,
} from './cadTypes';
import type {
  CadGrading,
  CadGradingResult,
  GradingCriterion,
  GradingSide,
} from './grading/gradingTypes';

/**
 * Phase 20B grading definition + snapshot transactions.
 *
 * History: GRADING_CREATE (Both-Sides atomic pair = one entry),
 * GRADING_DELETE (no cascade — extracts/baked surfaces are snapshots),
 * GRADING_EDIT_CRITERIA, GRADING_REASSIGN_TARGET (both → NEEDS_RECALC by
 * revision move), GRADINGEXTRACTDAYLIGHT and GRADINGBAKE (one entry each).
 * Calculate and worker results NEVER touch history (service-owned).
 */

const findGrading = (project: CadProject, gradingId: string): CadGrading | undefined =>
  (project.gradings ?? []).find((entry) => entry.id === gradingId);

const nextGradingName = (project: CadProject): string => {
  const taken = new Set((project.gradings ?? []).map((entry) => entry.name));
  let index = (project.gradings ?? []).length + 1;
  while (taken.has(`Grading ${index}`)) index += 1;
  return `Grading ${index}`;
};

const isNameTaken = (project: CadProject, name: string, exceptId?: string): boolean =>
  (project.gradings ?? []).some(
    (entry) => entry.id !== exceptId && entry.name === name,
  );

/** Fail-closed: source FL exists with the A/B course still adjacent. */
const courseResolvable = (
  project: CadProject,
  sourceFeatureLineId: string,
  vertexAId: string,
  vertexBId: string,
): boolean => {
  const entity = project.entities.find(
    (entry) => entry.type === 'feature-line' && entry.id === sourceFeatureLineId,
  );
  if (!entity || entity.type !== 'feature-line') return false;
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return false;
  return (
    resolveGradingSourceCourse(
      resolved.courses.map((course) => ({
        fromVertexId: course.fromVertexId,
        toVertexId: course.toVertexId,
        startX: course.from.x,
        startY: course.from.y,
        endX: course.to.x,
        endY: course.to.y,
        startZ: course.from.z,
        endZ: course.to.z,
        planLength: course.planLength,
        isArc: course.kind === 'arc',
      })),
      vertexAId,
      vertexBId,
    ) !== null
  );
};

type GradingCreateCommand = Extract<CadCommand, { key: 'GRADING_CREATE' }>;

const gradingCreateCommand: CadCommandDefinition<GradingCreateCommand> = {
  key: 'GRADING_CREATE',
  execute: (snapshot, command) => {
    // Surface-terminated criteria need a live target; distance/elevation are
    // analytic and never carry a target id on new writes.
    const requiresSurface = gradingCriterionRequiresSurface(command.criterion);
    const target = requiresSurface
      ? (snapshot.project.surfaces ?? []).find((entry) => entry.id === command.targetSurfaceId)
      : undefined;
    if (requiresSurface && !target) return null;
    if (!courseResolvable(snapshot.project, command.sourceFeatureLineId, command.vertexAId, command.vertexBId)) {
      return null;
    }
    const baseName = command.name?.trim() || nextGradingName(snapshot.project);
    const shared = {
      name: baseName,
      sourceFeatureLineId: command.sourceFeatureLineId,
      vertexAId: command.vertexAId,
      vertexBId: command.vertexBId,
      ...(target ? { targetSurfaceId: target.id } : {}),
      criterion: command.criterion,
      maxSearchDistance: command.maxSearchDistance,
      curveChordTolerance: command.curveChordTolerance,
      ...(command.layerId !== undefined ? { layerId: command.layerId } : {}),
    };
    if (command.side === 'both') {
      const leftName = `${baseName} - Left`;
      const rightName = `${baseName} - Right`;
      if (isNameTaken(snapshot.project, leftName) || isNameTaken(snapshot.project, rightName)) {
        return null;
      }
      // Atomic pair: shared validation runs once — both or neither.
      const pair = createBothSidesGrading({
        ...shared,
        name: baseName,
        leftId: createStableRuntimeId('cad-grading'),
        rightId: createStableRuntimeId('cad-grading'),
      });
      if (!pair.ok) return null;
      const left: CadGrading = { ...pair.value.left, name: leftName };
      const right: CadGrading = { ...pair.value.right, name: rightName };
      return commitLayerProject('GRADING_CREATE', snapshot, {
        ...snapshot.project,
        gradings: [...(snapshot.project.gradings ?? []), left, right],
      }, `GRADING_CREATE (${leftName} + ${rightName})`);
    }
    if (isNameTaken(snapshot.project, baseName)) return null;
    const created = createGradingDefinition({
      ...shared,
      id: createStableRuntimeId('cad-grading'),
      side: command.side,
    });
    if (!created.ok) return null;
    const grading: CadGrading = { ...created.value, name: baseName };
    return commitLayerProject('GRADING_CREATE', snapshot, {
      ...snapshot.project,
      gradings: [...(snapshot.project.gradings ?? []), grading],
    }, `GRADING_CREATE (${baseName})`);
  },
};

type GradingDeleteCommand = Extract<CadCommand, { key: 'GRADING_DELETE' }>;

const gradingDeleteCommand: CadCommandDefinition<GradingDeleteCommand> = {
  key: 'GRADING_DELETE',
  execute: (snapshot, command) => {
    const grading = findGrading(snapshot.project, command.gradingId);
    if (!grading) return null;
    // No cascade: daylight extracts and baked surfaces are snapshots and stay.
    return commitLayerProject('GRADING_DELETE', snapshot, {
      ...snapshot.project,
      gradings: (snapshot.project.gradings ?? []).filter((entry) => entry.id !== grading.id),
    }, `GRADING_DELETE (${grading.name})`);
  },
};

type GradingEditCriteriaCommand = Extract<CadCommand, { key: 'GRADING_EDIT_CRITERIA' }>;

const gradingEditCriteriaCommand: CadCommandDefinition<GradingEditCriteriaCommand> = {
  key: 'GRADING_EDIT_CRITERIA',
  execute: (snapshot, command) => {
    const grading = findGrading(snapshot.project, command.gradingId);
    if (!grading) return null;
    // Kind switch + target land in ONE history entry: a surface criterion must
    // resolve to a live target, while an analytic criterion clears the id.
    if (gradingCriterionRequiresSurface(command.criterion)) {
      const nextTarget = command.targetSurfaceId ?? grading.targetSurfaceId;
      if (!nextTarget) return null;
      if (!(snapshot.project.surfaces ?? []).some((entry) => entry.id === nextTarget)) return null;
    }
    const edited = editGradingCriteriaWithTarget(grading, command.criterion, command.targetSurfaceId);
    if (!edited.ok) return null;
    // Revision moves → NEEDS_RECALC derives; cached results keyed by grev go stale.
    return commitLayerProject('GRADING_EDIT_CRITERIA', snapshot, {
      ...snapshot.project,
      gradings: (snapshot.project.gradings ?? []).map((entry) =>
        entry.id === grading.id ? edited.value : entry,
      ),
    }, `GRADING_EDIT_CRITERIA (${grading.name})`);
  },
};

type GradingReassignTargetCommand = Extract<CadCommand, { key: 'GRADING_REASSIGN_TARGET' }>;

const gradingReassignTargetCommand: CadCommandDefinition<GradingReassignTargetCommand> = {
  key: 'GRADING_REASSIGN_TARGET',
  execute: (snapshot, command) => {
    const grading = findGrading(snapshot.project, command.gradingId);
    if (!grading) return null;
    // Analytic criteria have no live target; reassignment is surface-only.
    if (!gradingCriterionRequiresSurface(grading.criterion)) return null;
    const target = (snapshot.project.surfaces ?? []).find(
      (entry) => entry.id === command.targetSurfaceId,
    );
    if (!target || target.id === grading.targetSurfaceId) return null;
    const reassigned = reassignGradingTarget(grading, target.id);
    if (!reassigned.ok) return null;
    return commitLayerProject('GRADING_REASSIGN_TARGET', snapshot, {
      ...snapshot.project,
      gradings: (snapshot.project.gradings ?? []).map((entry) =>
        entry.id === grading.id ? reassigned.value : entry,
      ),
    }, `GRADING_REASSIGN_TARGET (${grading.name})`);
  },
};

/**
 * Calculate dispatch gate (NO history entry — pure check the UI runs before
 * service dispatch). Requires a resolvable definition; target CURRENT-ness
 * is session-owned (tinCache), so the caller passes it in: false →
 * SOURCE_NOT_CURRENT fail-closed. Cut/fill source coverage is enforced in
 * the worker (TARGET_GAP fail-closed).
 */
export const gradingCalculateGate = (
  project: CadProject,
  gradingId: string,
  targetCurrent: boolean,
): { ok: true; revision: string } | { ok: false; message: string } => {
  const inputs = resolveGradingInputs(project, gradingId);
  if (!inputs) {
    return { ok: false, message: `Grading calculation blocked: grading “${gradingId}” has a broken source or target reference.` };
  }
  if (!targetCurrent && inputs.target) {
    return {
      ok: false,
      message: `Grading calculation blocked: target TIN for “${inputs.target.name}” is not CURRENT (SOURCE_NOT_CURRENT) — rebuild it first.`,
    };
  }
  return { ok: true, revision: inputs.revision };
};

type GradingExtractCommand = Extract<CadCommand, { key: 'GRADINGEXTRACTDAYLIGHT' }>;

/**
 * GRADINGEXTRACTDAYLIGHT: snapshot the cached daylight polyline into a NEW
 * CadFeatureLineEntity (`<name> - Daylight`, fresh ids, exact cached XYZ,
 * no live dependency, straight courses always). Requires CURRENT (grev
 * match + session CURRENT assertion) + a passed-in cached result.
 */
const gradingExtractCommand: CadCommandDefinition<GradingExtractCommand> = {
  key: 'GRADINGEXTRACTDAYLIGHT',
  execute: (snapshot, command) => {
    const inputs = resolveGradingInputs(snapshot.project, command.gradingId);
    if (!inputs) return null;
    if (command.sessionCurrent !== true) return null;
    const result = command.result;
    if (result.gradingId !== inputs.grading.id) return null;
    if (result.revision !== inputs.revision || command.expectedRevision !== inputs.revision) {
      return null;
    }
    if (result.daylightPoints.length < 6 || result.daylightPoints.length % 3 !== 0) return null;
    // 20K.2: refuse an uncertified / forged / mismatched CURRENT mesh.
    if (gradingTopologyCertificateProductionProductError(result.topologyCertificate, 'standalone', result.gradingMesh, {
      sourceBoundaryPoints: result.sourceBoundaryPoints,
      gradingBoundaryPoints: result.daylightPoints,
    }) != null) return null;
    const vertices: Array<{ x: number; y: number }> = [];
    const elevations: number[] = [];
    for (let i = 0; i + 2 < result.daylightPoints.length; i += 3) {
      vertices.push({ x: result.daylightPoints[i]!, y: result.daylightPoints[i + 1]! });
      elevations.push(result.daylightPoints[i + 2]!);
    }
    const entity = buildFeatureLineEntity(
      snapshot.project,
      { vertices, elevations, closed: false },
      {
        name: `${inputs.grading.name} - ${gradingBoundaryLabel(inputs.grading.criterion)}`,
        createdBy: 'GRADINGEXTRACTDAYLIGHT',
      },
    );
    if (!entity) return null;
    return commitLayerProject('GRADINGEXTRACTDAYLIGHT', snapshot,
      appendCadProjectEntities(snapshot.project, [entity]),
      `GRADINGEXTRACTDAYLIGHT (${entity.name})`);
  },
};

type GradingBakeCommand = Extract<CadCommand, { key: 'GRADINGBAKE' }>;

const uniqueBakedGradingSurfaceName = (project: CadProject, gradingName: string): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  const base = `${gradingName} - Baked`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

/**
 * GRADINGBAKE: snapshot the calculated strip mesh into a new explicit-TIN
 * surface (`kind: 'webnet-grading-bake'` provenance). Requires CURRENT +
 * nonzero mesh + expected revision. ALREADY_TIED (empty mesh) blocks.
 */
const gradingBakeCommand: CadCommandDefinition<GradingBakeCommand> = {
  key: 'GRADINGBAKE',
  execute: (snapshot, command) => {
    const inputs = resolveGradingInputs(snapshot.project, command.gradingId);
    if (!inputs) return null;
    if (command.sessionCurrent !== true) return null;
    const result = command.result;
    if (result.gradingId !== inputs.grading.id) return null;
    if (result.revision !== inputs.revision || command.expectedRevision !== inputs.revision) {
      return null;
    }
    // Bake blocked on ALREADY_TIED empty mesh (zero-area ties bake nothing).
    if (result.gradingMesh.triangles.length === 0) return null;
    // 20K.2 / 20K.3: refuse an uncertified / forged / mismatched CURRENT mesh.
    // Wave E1: Bake is an explicit-TIN product and the engine materializes
    // arbitrary validated face sets, so a multi-region (tied split) mesh IS
    // bakeable as one surface; only a certificate/topology failure blocks.
    if (gradingTopologyCertificateProductionError(result.topologyCertificate, 'standalone', result.gradingMesh, {
      sourceBoundaryPoints: result.sourceBoundaryPoints,
      gradingBoundaryPoints: result.daylightPoints,
    }) != null) return null;
    const criterion = inputs.grading.criterion;
    const targetKind = gradingTerminationKind(criterion);
    if (targetKind === 'surface' && !inputs.target) return null;
    const canonical = canonicalizeBakedTin(result.gradingMesh.points, result.gradingMesh.triangles);
    const payload = {
      vertices: canonical.vertices,
      faces: canonical.faces,
      provenance: {
        kind: 'webnet-grading-bake' as const,
        gradingId: inputs.grading.id,
        gradingName: inputs.grading.name,
        gradingRevision: inputs.revision,
        sourceFeatureLineId: inputs.grading.sourceFeatureLineId,
        sourceVertexAId: inputs.grading.sourceCourse.vertexAId,
        sourceVertexBId: inputs.grading.sourceCourse.vertexBId,
        targetKind,
        ...(targetKind === 'surface' ? { targetSurfaceId: inputs.target!.id } : {}),
        ...(criterion.kind === 'distance' ? { criterionDistance: criterion.distance } : {}),
        ...(criterion.kind === 'elevation' ? { targetElevation: criterion.targetElevation } : {}),
        ...(criterion.kind === 'relative-elevation' ? { relativeElevation: criterion.relativeElevation } : {}),
        accuracy: result.accuracy,
      },
    };
    if (validateExplicitTinPayload(payload) != null) return null;
    const surface: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name: uniqueBakedGradingSurfaceName(snapshot.project, inputs.grading.name),
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: payload,
      },
      ...(inputs.grading.layerId != null ? { layerId: inputs.grading.layerId } : {}),
      cachedRevision: null,
    };
    return commitLayerProject('GRADINGBAKE', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), surface],
    }, `GRADINGBAKE (${surface.name})`);
  },
};

export const gradingCommandDefinitions = {
  GRADING_CREATE: gradingCreateCommand,
  GRADING_DELETE: gradingDeleteCommand,
  GRADING_EDIT_CRITERIA: gradingEditCriteriaCommand,
  GRADING_REASSIGN_TARGET: gradingReassignTargetCommand,
  GRADINGEXTRACTDAYLIGHT: gradingExtractCommand,
  GRADINGBAKE: gradingBakeCommand,
} as const;

/** Command payload extras (criterion/side/result shapes shared with the UI worker). */
export type GradingCreateSide = GradingSide | 'both';

export interface GradingCommandPayloads {
  createCriterion: GradingCriterion;
  createSide: GradingCreateSide;
  cachedResult: CadGradingResult;
}
