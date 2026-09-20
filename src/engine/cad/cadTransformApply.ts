// Phase 18Q core: transform application seam (pure project-level, engine only).
//
// ONE seam for ROTATE / SCALE / MIRROR / ALIGN2D / HELMERT / GRID-GROUND
// application: preflight (atomic, zero mutation) then either in-place replace
// (the MOVE replace + dependency-sync discipline) or MIRROR_COPY clone +
// transform + annotation rebind (the COPY clone discipline). No rounding of
// coordinates anywhere.
//
// Engine only: this file registers no command key and touches no UI. The
// result carries everything a future registered command needs
// (next project + selection + transactionLabel + added/removed ids); use
// `commitCadSelectionTransform` to push exactly ONE undo entry shaped like
// the `runCadCommand` transaction until that UI slice promotes this seam to
// a dedicated command key.

import { checkCadEntityEditable } from './cadAppearance';
import {
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import {
  classifyTransform,
  type CadTransform2D,
  type CadTransformClassification,
} from './cadTransform2D';
import { transformCadEntityGeometry } from './cadTransformGeometry';
import {
  buildCopiedAnnotationEntities,
  isCadAnnotationEntity,
} from './cadTransactionsAnnotationCopyCommands';
import { buildCopiedEntities } from './cadTransactionsClipboardCommands';
import {
  buildCopiedDependentPointEntities,
  syncEditedEntityDependencies,
} from './cadTransactionsLinkedEntities';
import { expandSelectedEntityIds } from './cadTransactionsSelection';
import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchors';
import type { CadHistoryState } from './cadUndoRedo';
import type { CadCommandKey, CadTransaction, CadWorkspaceSnapshot } from './cadTransactions.types';
import type { CadEntity, CadEntityId, CadProject } from './cadTypes';

export interface CadTransformPreflightOptions {
  transform: CadTransform2D;
}

export type CadTransformPreflightResult =
  | { ok: true; entities: CadEntity[] }
  | { ok: false; reason: string };

export interface ApplyCadSelectionTransformOptions {
  label: string;
  copyMode?: false | 'MIRROR_COPY';
}

export type ApplyCadSelectionTransformResult =
  | {
      ok: true;
      project: CadProject;
      selectionIds: CadEntityId[];
      transactionLabel: string;
      addedEntityIds: CadEntityId[];
      removedEntityIds: CadEntityId[];
    }
  | { ok: false; reason: string };

const resolveCohort = (project: CadProject, selectedIds: readonly CadEntityId[]): CadEntity[] => {
  // Same expansion the MOVE/COPY path uses (anchored text + error-ellipses),
  // but WITHOUT the locked filter so the editability gate below can reject
  // atomically instead of silently skipping.
  const expandedIds = new Set(expandSelectedEntityIds(project, selectedIds));
  return project.entities.filter((entity) => expandedIds.has(entity.id));
};

const describeEntity = (entity: CadEntity): string => `${entity.id} (${entity.type})`;

/**
 * Atomic preflight: resolve the cohort, gate EVERY entity through the central
 * editability check (any failure fails the whole preflight), then dry-run the
 * geometry per entity (any incompatibility fails the whole preflight with a
 * readable reason). Pure: zero mutation on every path. On success returns the
 * TRANSFORMED entities so the in-place commit reuses them (source transforms
 * exactly once by construction).
 */
export const preflightCadSelectionTransform = (
  project: CadProject,
  selectedIds: readonly CadEntityId[],
  classification: CadTransformClassification,
  opts: CadTransformPreflightOptions,
): CadTransformPreflightResult => {
  const cohort = resolveCohort(project, selectedIds);
  if (cohort.length === 0) {
    return { ok: false, reason: 'CAD_TRANSFORM_EMPTY_SELECTION: no editable cohort selected.' };
  }
  for (const entity of cohort) {
    const check = checkCadEntityEditable(project, entity);
    if (!check.editable) {
      return {
        ok: false,
        reason:
          `CAD entity ${describeEntity(entity)} is not editable (${check.reason}); ` +
          'transform aborted with no changes.',
      };
    }
  }
  const transformed: CadEntity[] = [];
  for (const entity of cohort) {
    const result = transformCadEntityGeometry(entity, opts.transform, classification);
    if (!result.ok) {
      return {
        ok: false,
        reason:
          `CAD entity ${describeEntity(entity)}: ${result.reason}; ` +
          'transform aborted with no changes.',
      };
    }
    transformed.push(result.entity);
  }
  return { ok: true, entities: transformed };
};

const remapAnnotationAnchor = (
  anchor: CadAnnotationAnchor,
  sourceToCopyId: ReadonlyMap<CadEntityId, CadEntityId>,
): CadAnnotationAnchor => {
  if (anchor.kind === 'fixed') return anchor;
  const copyId = sourceToCopyId.get(anchor.entityId);
  return copyId ? { ...anchor, entityId: copyId } : anchor;
};

// Mirror-copy association remap (the professional-COPY rule plus the 18Q
// rebind): an annotation clone whose source was ALSO copied rebinds to the
// NEW copy id; a clone copied WITHOUT its source keeps the original ref
// (never dangles, never guesses). Legacy text clones keep the COPY seam
// output (anchor cleared at clone time), unchanged here.
const remapCloneSources = (
  clone: CadEntity,
  sourceToCopyId: ReadonlyMap<CadEntityId, CadEntityId>,
): CadEntity => {
  switch (clone.type) {
    case 'leader':
      return { ...clone, arrowAnchor: remapAnnotationAnchor(clone.arrowAnchor, sourceToCopyId) };
    case 'dimension':
      return {
        ...clone,
        anchors: clone.anchors.map((anchor) => remapAnnotationAnchor(anchor, sourceToCopyId)),
        ...(clone.defPoint1 != null
          ? { defPoint1: remapAnnotationAnchor(clone.defPoint1, sourceToCopyId) }
          : {}),
        ...(clone.defPoint2 != null
          ? { defPoint2: remapAnnotationAnchor(clone.defPoint2, sourceToCopyId) }
          : {}),
      };
    case 'bearing-label':
    case 'curve-label': {
      const copyId = sourceToCopyId.get(clone.sourceEntityId);
      return copyId ? { ...clone, sourceEntityId: copyId } : clone;
    }
    default:
      return clone;
  }
};

interface CloneSourceMap {
  sourceToCopyId: Map<CadEntityId, CadEntityId>;
}

// Derive old-id -> new-clone-id WITHOUT re-implementing the COPY seam: the
// COPY clone passes are deterministic and order-preserving, so zip the
// expected source order (same skip rules the seam applies) with the clone
// output and keep only type-verified pairs. Unverifiable pairs simply keep
// their original ref (COPY-consistent fallback, never a mis-rebind).
const buildCloneSourceMap = (
  project: CadProject,
  cohort: readonly CadEntity[],
  legacyClones: readonly CadEntity[],
  annotationClones: readonly CadEntity[],
): CloneSourceMap => {
  const sourceToCopyId = new Map<CadEntityId, CadEntityId>();
  // Dependent prefix (fresh points for selected/vertex-linked/arc-support
  // stations) is rebuilt identically by the exported dependents seam, so its
  // length tells us where the 1:1 main pass starts.
  const dependents = buildCopiedDependentPointEntities(project, cohort, 0, 0);
  const selectedPointStations = new Set(
    cohort
      .filter((entity): entity is Extract<CadEntity, { type: 'survey-point' }> =>
        entity.type === 'survey-point')
      .map((entity) => entity.stationId),
  );
  const expectedMainSources = cohort.filter((entity) => {
    if (entity.type === 'survey-point') return false;
    if (isCadAnnotationEntity(entity)) return false;
    if (entity.type === 'text' && entity.anchorEntityId) {
      const station = entity.anchorEntityId.startsWith('pt:')
        ? entity.anchorEntityId.slice(3)
        : null;
      if (station && dependents.copiedPointByStationId.has(station)) return false;
    }
    if (entity.type === 'error-ellipse' && selectedPointStations.has(entity.stationId)) {
      return false;
    }
    return true;
  });
  const mainClones = legacyClones.slice(dependents.copiedEntities.length);
  if (mainClones.length === expectedMainSources.length) {
    expectedMainSources.forEach((source, index) => {
      const clone = mainClones[index];
      if (clone && clone.type === source.type) sourceToCopyId.set(source.id, clone.id);
    });
  }
  const annotationSources = cohort.filter(isCadAnnotationEntity);
  if (annotationSources.length === annotationClones.length) {
    annotationSources.forEach((source, index) => {
      const clone = annotationClones[index];
      if (clone && clone.type === source.type) sourceToCopyId.set(source.id, clone.id);
    });
  }
  // Direct-selected survey points map to their dependent clones only when no
  // poly/arc vertex/support bundles interleave (otherwise keep COPY behavior:
  // original refs, never a mis-rebind).
  const hasDependentBundles = cohort.some(
    (entity) =>
      entity.type === 'polyline' ||
      entity.type === 'polygon' ||
      entity.type === 'parcel' ||
      entity.type === 'arc',
  );
  if (!hasDependentBundles) {
    let cursor = 0;
    let exact = true;
    const pointPairs: Array<[CadEntityId, CadEntityId]> = [];
    for (const source of cohort) {
      if (source.type !== 'survey-point') continue;
      const pointClone = dependents.copiedEntities[cursor];
      if (!pointClone || pointClone.type !== 'survey-point') {
        exact = false;
        break;
      }
      pointPairs.push([source.id, pointClone.id]);
      cursor += 1;
      // A point bundle carries its text label unless the source hides it.
      if (source.metadata?.hiddenLabel !== true) {
        const labelClone = dependents.copiedEntities[cursor];
        if (!labelClone || labelClone.type !== 'text') {
          exact = false;
          break;
        }
        cursor += 1;
      }
    }
    if (exact && cursor === dependents.copiedEntities.length) {
      pointPairs.forEach(([sourceId, copyId]) => sourceToCopyId.set(sourceId, copyId));
    }
  }
  return { sourceToCopyId };
};

/**
 * Apply a transform to a selection. Classifies ONCE (singular => fail with
 * zero mutation), preflights (fail => diagnostic, zero mutation), then either
 * replaces in place or mirror-copies. Pure: returns the next project without
 * touching history; pair with `commitCadSelectionTransform` for the undo
 * entry. No rounding of coordinates.
 */
export const applyCadSelectionTransform = (
  project: CadProject,
  selectedIds: readonly CadEntityId[],
  transform: CadTransform2D,
  opts: ApplyCadSelectionTransformOptions,
): ApplyCadSelectionTransformResult => {
  const classification = classifyTransform(transform);
  if (!classification) {
    return { ok: false, reason: 'CAD_TRANSFORM_SINGULAR: transform is degenerate.' };
  }
  const preflight = preflightCadSelectionTransform(project, selectedIds, classification, {
    transform,
  });
  if (!preflight.ok) return preflight;
  const cohort = resolveCohort(project, selectedIds);
  const transactionLabel = opts.label;

  if (opts.copyMode === 'MIRROR_COPY') {
    // COPY discipline: clone the cohort verbatim (delta 0), then transform
    // the CLONES. Sources are never touched, so no double-transform is
    // possible; associative anchors on the clones are references (rebound
    // below), not coordinates.
    const legacyClones = buildCopiedEntities(project, cohort, 0, 0);
    const annotationClones = buildCopiedAnnotationEntities(project, cohort, 0, 0);
    const { sourceToCopyId } = buildCloneSourceMap(project, cohort, legacyClones, annotationClones);
    const clones = [...legacyClones, ...annotationClones];
    const transformedClones: CadEntity[] = [];
    for (const clone of clones) {
      const rebound = remapCloneSources(clone, sourceToCopyId);
      const result = transformCadEntityGeometry(rebound, transform, classification);
      if (!result.ok) {
        return {
          ok: false,
          reason:
            `CAD entity ${describeEntity(clone)}: ${result.reason}; ` +
            'transform aborted with no changes.',
        };
      }
      transformedClones.push(result.entity);
    }
    // A mirrored block ref keeps its definition (same geometry library entry)
    // under a new id with the toggled `mirrored` flag — handled in geometry.
    const nextProject = appendCadProjectEntities(project, transformedClones);
    const newIds = transformedClones.map((entity) => entity.id);
    return {
      ok: true,
      project: nextProject,
      selectionIds: newIds,
      transactionLabel,
      addedEntityIds: newIds,
      removedEntityIds: [],
    };
  }

  // MOVE discipline: single bulk replace, then per-entity dependency sync with
  // syncLinePoints:false (a transformed line never drags its linked survey
  // points; vertex-bound points DO follow). Selection keeps the same ids.
  // Double-transform protection: each source transforms once here;
  // associative anchors on selected leaders/dimensions resolve to the
  // transformed source (references, not coordinates), and a selected
  // leader/dimension's own placement transforms once in geometry above.
  const transformedById = new Map(preflight.entities.map((entity) => [entity.id, entity]));
  const nextProjectBase = replaceCadProjectEntities(
    project,
    project.entities.map((entity) => transformedById.get(entity.id) ?? entity),
  );
  const updatedById = new Map(nextProjectBase.entities.map((entity) => [entity.id, entity]));
  const nextProject = cohort.reduce((current, previous) => {
    const updated = updatedById.get(previous.id);
    if (!updated) return current;
    return syncEditedEntityDependencies(current, previous, updated, { syncLinePoints: false });
  }, nextProjectBase);
  // Alignment rigid transforms flow through this normal dependency path:
  // profile/section/surface statuses derive from content hashes
  // (cadProfileRevision / cadSectionRevision / cadSurfaceRevision recomputed
  // at status time), so edited geometry automatically surfaces as
  // NEEDS_REBUILD downstream. Never auto-rebuild here.
  // Surfaces/profiles/sections/volumes are not selectable entities (no code
  // above targets them); source-point moves flow through the same existing
  // NEEDS_REBUILD logic.
  return {
    ok: true,
    project: nextProject,
    selectionIds: cohort.map((entity) => entity.id),
    transactionLabel,
    addedEntityIds: [],
    removedEntityIds: [],
  };
};

/**
 * Push an applied transform as exactly ONE undo entry. Shaped like the
 * `runCadCommand` transaction (same id/sequence/selection bookkeeping)
 * under the caller's dedicated registered command key (ROTATE / SCALE /
 * MIRROR / ALIGN2D); the EDIT_ENTITY default preserves the pre-promotion
 * seam for older callers.
 */
export const commitCadSelectionTransform = (
  state: CadHistoryState,
  applied: Extract<ApplyCadSelectionTransformResult, { ok: true }>,
  commandKey: CadCommandKey = 'EDIT_ENTITY',
): CadHistoryState => {
  const before = state.present;
  const after: CadWorkspaceSnapshot = {
    project: applied.project,
    selection: createCadSelectionState(applied.project, applied.selectionIds),
  };
  const transaction: CadTransaction = {
    id: `cad-tx-${state.nextSequence}`,
    sequence: state.nextSequence,
    commandKey,
    label: applied.transactionLabel,
    beforeSelectionIds: before.selection.selectedEntityIds,
    afterSelectionIds: after.selection.selectedEntityIds,
    addedEntityIds: applied.addedEntityIds,
    removedEntityIds: applied.removedEntityIds,
  };
  return {
    present: after,
    undoStack: [...state.undoStack, { transaction, before, after }],
    redoStack: [],
    nextSequence: state.nextSequence + 1,
    commandState: {
      key: commandKey,
      phase: 'committed',
      prompt: `${applied.transactionLabel} committed.`,
    },
  };
};
