/**
 * Phase 18O — professional annotation transactions (semantic, undoable).
 *
 * Each command validates the current/edited layer through the central
 * `checkCadEntityEditable` gate, generates a stable id, and commits one
 * history entry. Derived graphics are never persisted: MOVE translates only
 * placement (dimension dim-line/text, leader vertices), the associative
 * anchors stay bound to their source entities, and editing a source produces
 * no annotation history entry.
 */
import { checkCadEntityEditable } from './cadAppearance';
import { resolveCurrentCadLayerId } from './cadLayers';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import {
  fixAnchor,
  resolveCadAnnotationAnchor,
  type CadAnnotationAnchor,
} from './annotation/cadAnnotationAnchors';
import {
  resolveAnnotationScaleDenominator,
  sanitizeCadAnnotationSettings,
} from './annotation/cadAnnotationSettings';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadBearingDistanceLabelEntity,
  CadCurveLabelEntity,
  CadDimensionEntity,
  CadEntity,
  CadEntityId,
  CadLeaderEntity,
  CadMTextEntity,
  CadProject,
  CadTextStyleId,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

const DEFAULT_TEXT_STYLE_ID: CadTextStyleId = 'label-default';
const DEFAULT_DIMENSION_STYLE_ID = 'std-500';
const DEFAULT_LEADER_STYLE_ID = 'std-leader';
const DEFAULT_BEARING_LABEL_STYLE_ID = 'bearing-default';
const DEFAULT_CURVE_LABEL_STYLE_ID = 'curve-default';

const resolveTextStyleId = (project: CadProject, requested?: CadTextStyleId): CadTextStyleId => {
  if (requested != null) return requested;
  const textStyles = project.styleLibrary?.textStyles ?? [];
  const professional = textStyles.find(
    (style) => style.heightMode != null && style.heightMode !== 'legacy-screen',
  );
  return (professional ?? textStyles[0])?.id ?? DEFAULT_TEXT_STYLE_ID;
};

const resolveDimensionStyleId = (project: CadProject, requested?: string): string =>
  requested ?? project.dimensionStyles?.[0]?.id ?? DEFAULT_DIMENSION_STYLE_ID;

const resolveLeaderStyleId = (project: CadProject, requested?: string): string =>
  requested ?? project.leaderStyles?.[0]?.id ?? DEFAULT_LEADER_STYLE_ID;

const resolveBearingLabelStyleId = (project: CadProject, requested?: string): string =>
  requested ?? project.bearingLabelStyles?.[0]?.id ?? DEFAULT_BEARING_LABEL_STYLE_ID;

const resolveCurveLabelStyleId = (project: CadProject, requested?: string): string =>
  requested ?? project.curveLabelStyles?.[0]?.id ?? DEFAULT_CURVE_LABEL_STYLE_ID;

const commitEntities = (
  snapshot: CadWorkspaceSnapshot,
  entities: CadEntity[],
  key: CadCommandKey,
  label: string,
): CadCommandExecutionResult => {
  const nextProject = appendCadProjectEntities(snapshot.project, entities);
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, entities.map((entity) => entity.id)),
    },
    commandState: { key, phase: 'committed', prompt: `${label} committed.` },
    transactionLabel: label,
    addedEntityIds: entities.map((entity) => entity.id),
    removedEntityIds: [],
  };
};

const commitReplacement = (
  snapshot: CadWorkspaceSnapshot,
  entities: CadEntity[],
  key: CadCommandKey,
  label: string,
): CadCommandExecutionResult => {
  const byId = new Map(entities.map((entity) => [entity.id, entity] as const));
  const nextProject = replaceCadProjectEntities(
    snapshot.project,
    snapshot.project.entities.map((entity) => byId.get(entity.id) ?? entity),
  );
  return {
    nextSnapshot: {
      project: nextProject,
      selection: createCadSelectionState(nextProject, entities.map((entity) => entity.id)),
    },
    commandState: { key, phase: 'committed', prompt: `${label} committed.` },
    transactionLabel: label,
    addedEntityIds: [],
    removedEntityIds: [],
  };
};

const findEditable = <TEntity extends CadEntity>(
  snapshot: CadWorkspaceSnapshot,
  entityId: CadEntityId,
  guard: (entity: CadEntity) => entity is TEntity,
): TEntity | null => {
  const entity = snapshot.project.entities.find(
    (candidate): candidate is TEntity => candidate.id === entityId && guard(candidate),
  );
  if (!entity) return null;
  return checkCadEntityEditable(snapshot.project, entity).editable ? entity : null;
};

/** Freeze any anchor at its currently resolved point (fallback when broken). */
export const freezeAnnotationAnchor = (
  anchor: CadAnnotationAnchor,
  project: CadProject,
): CadAnnotationAnchor => {
  const resolved = resolveCadAnnotationAnchor(anchor, project);
  return resolved.ok ? { kind: 'fixed', x: resolved.x, y: resolved.y } : fixAnchor(anchor);
};

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export const createMTextCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CREATE_MTEXT' }>> = {
  key: 'CREATE_MTEXT',
  execute: (snapshot, command) => {
    if (command.text.trim().length === 0) return null;
    const entity: CadMTextEntity = {
      id: createStableRuntimeId('cad-mtext'),
      type: 'mtext',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      x: command.x,
      y: command.y,
      text: command.text,
      textStyleId: resolveTextStyleId(snapshot.project, command.textStyleId),
      rotationDeg: command.rotationDeg ?? 0,
      attachment: command.attachment ?? 'middle-left',
      metadata: { createdBy: 'CREATE_MTEXT', manual: true },
    };
    if (!checkCadEntityEditable(snapshot.project, entity).editable) return null;
    return commitEntities(snapshot, [entity], 'CREATE_MTEXT', `CREATE_MTEXT (${entity.id})`);
  },
};

export const createLeaderCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CREATE_LEADER' }>> = {
  key: 'CREATE_LEADER',
  execute: (snapshot, command) => {
    if (command.vertices.length === 0) return null;
    const entity: CadLeaderEntity = {
      id: createStableRuntimeId('cad-leader'),
      type: 'leader',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      arrowAnchor: command.arrowAnchor,
      vertices: command.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      text: command.text,
      leaderStyleId: resolveLeaderStyleId(snapshot.project, command.leaderStyleId),
      ...(command.textStyleId != null ? { textStyleId: command.textStyleId } : {}),
      ...(command.textAttachment != null ? { textAttachment: command.textAttachment } : {}),
      metadata: { createdBy: 'CREATE_LEADER', manual: true },
    };
    if (!checkCadEntityEditable(snapshot.project, entity).editable) return null;
    return commitEntities(snapshot, [entity], 'CREATE_LEADER', `CREATE_LEADER (${entity.id})`);
  },
};

const minimumDimensionAnchors = (kind: CadDimensionEntity['dimensionKind']): number => {
  switch (kind) {
    case 'linear':
    case 'aligned':
      return 2;
    case 'angular':
      return 2;
    case 'radius':
    case 'diameter':
      return 1;
  }
};

export const createDimensionCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CREATE_DIMENSION' }>> = {
  key: 'CREATE_DIMENSION',
  execute: (snapshot, command) => {
    const required = minimumDimensionAnchors(command.dimensionKind);
    if (command.anchors.length < required) return null;
    const linearPair = command.dimensionKind === 'linear' || command.dimensionKind === 'aligned';
    const entity: CadDimensionEntity = {
      id: createStableRuntimeId('cad-dimension'),
      type: 'dimension',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      dimensionKind: command.dimensionKind,
      anchors: command.anchors.map((anchor) => anchor),
      ...(linearPair
        ? { defPoint1: command.anchors[0], defPoint2: command.anchors[1] }
        : {}),
      ...(command.orientation != null ? { orientation: command.orientation } : {}),
      dimLinePoint: { x: command.dimLinePoint.x, y: command.dimLinePoint.y },
      ...(command.textPoint != null ? { textPoint: { x: command.textPoint.x, y: command.textPoint.y } } : {}),
      dimensionStyleId: resolveDimensionStyleId(snapshot.project, command.dimensionStyleId),
      ...(command.textOverride != null ? { textOverride: command.textOverride } : {}),
      metadata: { createdBy: 'CREATE_DIMENSION', manual: true },
    };
    if (!checkCadEntityEditable(snapshot.project, entity).editable) return null;
    return commitEntities(snapshot, [entity], 'CREATE_DIMENSION', `CREATE_DIMENSION (${entity.id})`);
  },
};

export const createBearingLabelCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CREATE_BEARING_LABEL' }>> = {
  key: 'CREATE_BEARING_LABEL',
  execute: (snapshot, command) => {
    const source = snapshot.project.entities.find((entity) => entity.id === command.sourceEntityId);
    if (!source || source.type !== 'line') return null;
    const entity: CadBearingDistanceLabelEntity = {
      id: createStableRuntimeId('cad-bearing-label'),
      type: 'bearing-label',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      sourceEntityId: command.sourceEntityId,
      labelStyleId: resolveBearingLabelStyleId(snapshot.project, command.labelStyleId),
      offset: { x: command.offset?.x ?? 0, y: command.offset?.y ?? 0 },
      ...(command.side != null ? { side: command.side } : {}),
      ...(command.manualTextOverride != null ? { manualTextOverride: command.manualTextOverride } : {}),
      metadata: { createdBy: 'CREATE_BEARING_LABEL', manual: true },
    };
    if (!checkCadEntityEditable(snapshot.project, entity).editable) return null;
    return commitEntities(snapshot, [entity], 'CREATE_BEARING_LABEL', `CREATE_BEARING_LABEL (${entity.id})`);
  },
};

export const createCurveLabelCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CREATE_CURVE_LABEL' }>> = {
  key: 'CREATE_CURVE_LABEL',
  execute: (snapshot, command) => {
    const source = snapshot.project.entities.find((entity) => entity.id === command.sourceEntityId);
    if (!source || source.type !== 'arc') return null;
    const entity: CadCurveLabelEntity = {
      id: createStableRuntimeId('cad-curve-label'),
      type: 'curve-label',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      sourceEntityId: command.sourceEntityId,
      labelStyleId: resolveCurveLabelStyleId(snapshot.project, command.labelStyleId),
      offset: { x: command.offset?.x ?? 0, y: command.offset?.y ?? 0 },
      ...(command.manualTextOverride != null ? { manualTextOverride: command.manualTextOverride } : {}),
      metadata: { createdBy: 'CREATE_CURVE_LABEL', manual: true },
    };
    if (!checkCadEntityEditable(snapshot.project, entity).editable) return null;
    return commitEntities(snapshot, [entity], 'CREATE_CURVE_LABEL', `CREATE_CURVE_LABEL (${entity.id})`);
  },
};

// ---------------------------------------------------------------------------
// UPDATE / REATTACH / OVERRIDE / SCALE
// ---------------------------------------------------------------------------

export const updateDimensionPlacementCommand: CadCommandDefinition<
  Extract<CadCommand, { key: 'UPDATE_DIMENSION_PLACEMENT' }>
> = {
  key: 'UPDATE_DIMENSION_PLACEMENT',
  execute: (snapshot, command) => {
    const entity = findEditable(
      snapshot,
      command.entityId,
      (candidate): candidate is CadDimensionEntity => candidate.type === 'dimension',
    );
    if (!entity) return null;
    if (command.dimLinePoint == null && command.textPoint === undefined) return null;
    const updated: CadDimensionEntity = {
      ...entity,
      dimLinePoint:
        command.dimLinePoint != null
          ? { x: command.dimLinePoint.x, y: command.dimLinePoint.y }
          : entity.dimLinePoint,
      ...(command.textPoint === undefined
        ? {}
        : command.textPoint === null
          ? { textPoint: undefined }
          : { textPoint: { x: command.textPoint.x, y: command.textPoint.y } }),
    };
    return commitReplacement(
      snapshot,
      [updated],
      'UPDATE_DIMENSION_PLACEMENT',
      `UPDATE_DIMENSION_PLACEMENT (${entity.id})`,
    );
  },
};

const reattachDimensionAnchor = (
  entity: CadDimensionEntity,
  command: Extract<CadCommand, { key: 'REATTACH_ANNOTATION' }>,
  project: CadProject,
): CadDimensionEntity | null => {
  const anchor = command.anchor;
  switch (command.slot) {
    case 'dimension-anchor': {
      const index = command.index ?? -1;
      if (index < 0 || index >= entity.anchors.length) return null;
      const anchors = entity.anchors.map((existing, position) =>
        position === index ? (anchor ?? freezeAnnotationAnchor(existing, project)) : existing,
      );
      return { ...entity, anchors };
    }
    case 'dimension-def-point-1':
      return entity.defPoint1 == null
        ? null
        : { ...entity, defPoint1: anchor ?? freezeAnnotationAnchor(entity.defPoint1, project) };
    case 'dimension-def-point-2':
      return entity.defPoint2 == null
        ? null
        : { ...entity, defPoint2: anchor ?? freezeAnnotationAnchor(entity.defPoint2, project) };
    default:
      return null;
  }
};

export const reattachAnnotationCommand: CadCommandDefinition<
  Extract<CadCommand, { key: 'REATTACH_ANNOTATION' }>
> = {
  key: 'REATTACH_ANNOTATION',
  execute: (snapshot, command) => {
    const entity = snapshot.project.entities.find(
      (candidate): candidate is CadLeaderEntity | CadDimensionEntity =>
        candidate.id === command.entityId &&
        (candidate.type === 'leader' || candidate.type === 'dimension'),
    );
    if (!entity || !checkCadEntityEditable(snapshot.project, entity).editable) return null;
    if (entity.type === 'leader') {
      if (command.slot !== 'leader-arrow') return null;
      const updated: CadLeaderEntity = {
        ...entity,
        arrowAnchor: command.anchor ?? freezeAnnotationAnchor(entity.arrowAnchor, snapshot.project),
      };
      return commitReplacement(snapshot, [updated], 'REATTACH_ANNOTATION', `REATTACH_ANNOTATION (${entity.id})`);
    }
    const updated = reattachDimensionAnchor(entity, command, snapshot.project);
    if (!updated) return null;
    return commitReplacement(snapshot, [updated], 'REATTACH_ANNOTATION', `REATTACH_ANNOTATION (${entity.id})`);
  },
};

const setLabelOverride = (
  entity: CadDimensionEntity | CadBearingDistanceLabelEntity | CadCurveLabelEntity,
  text: string | undefined,
): CadDimensionEntity | CadBearingDistanceLabelEntity | CadCurveLabelEntity | null => {
  if (entity.type === 'dimension') {
    if (entity.textOverride === text) return null;
    if (text === undefined) {
      const { textOverride: _dropped, ...rest } = entity;
      return rest;
    }
    return { ...entity, textOverride: text };
  }
  if (entity.manualTextOverride === text) return null;
  if (text === undefined) {
    const { manualTextOverride: _dropped, ...rest } = entity;
    return rest;
  }
  return { ...entity, manualTextOverride: text };
};

const overrideTarget = (
  entity: CadEntity,
): entity is CadDimensionEntity | CadBearingDistanceLabelEntity | CadCurveLabelEntity =>
  entity.type === 'dimension' || entity.type === 'bearing-label' || entity.type === 'curve-label';

const commitOverride = (
  snapshot: CadWorkspaceSnapshot,
  entity: CadDimensionEntity | CadBearingDistanceLabelEntity | CadCurveLabelEntity,
  text: string | undefined,
  key: 'SET_TEXT_OVERRIDE' | 'CLEAR_TEXT_OVERRIDE',
): CadCommandExecutionResult | null => {
  const updated = setLabelOverride(entity, text);
  if (!updated) return null;
  return commitReplacement(snapshot, [updated], key, `${key} (${entity.id})`);
};

export const setTextOverrideCommand: CadCommandDefinition<Extract<CadCommand, { key: 'SET_TEXT_OVERRIDE' }>> = {
  key: 'SET_TEXT_OVERRIDE',
  execute: (snapshot, command) => {
    const entity = findEditable(snapshot, command.entityId, overrideTarget);
    if (!entity) return null;
    return commitOverride(snapshot, entity, command.text, 'SET_TEXT_OVERRIDE');
  },
};

export const clearTextOverrideCommand: CadCommandDefinition<Extract<CadCommand, { key: 'CLEAR_TEXT_OVERRIDE' }>> = {
  key: 'CLEAR_TEXT_OVERRIDE',
  execute: (snapshot, command) => {
    const entity = findEditable(snapshot, command.entityId, overrideTarget);
    if (!entity) return null;
    return commitOverride(snapshot, entity, undefined, 'CLEAR_TEXT_OVERRIDE');
  },
};

export const setAnnotationScaleCommand: CadCommandDefinition<Extract<CadCommand, { key: 'SET_ANNOTATION_SCALE' }>> = {
  key: 'SET_ANNOTATION_SCALE',
  execute: (snapshot, command) => {
    const settings = sanitizeCadAnnotationSettings({ scaleDenominator: command.scaleDenominator });
    if (settings.scaleDenominator === resolveAnnotationScaleDenominator(snapshot.project)) return null;
    const nextProject: CadProject = { ...snapshot.project, annotationSettings: settings };
    return {
      nextSnapshot: { project: nextProject, selection: snapshot.selection },
      commandState: {
        key: 'SET_ANNOTATION_SCALE',
        phase: 'committed',
        prompt: `SET_ANNOTATION_SCALE committed at 1:${settings.scaleDenominator}.`,
      },
      transactionLabel: `SET_ANNOTATION_SCALE (1:${settings.scaleDenominator})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

/**
 * Generic validated-project commit for annotation UI ops (style tables +
 * entity field edits). Validation + rejection reasons live in the hook-side
 * applier; this only records one undoable entry with an honest label.
 */
export const annotationCommitCommand: CadCommandDefinition<
  Extract<CadCommand, { key: 'ANNOTATION_COMMIT' }>
> = {
  key: 'ANNOTATION_COMMIT',
  execute: (snapshot, command) => ({
    nextSnapshot: { project: command.project, selection: snapshot.selection },
    commandState: { key: 'ANNOTATION_COMMIT', phase: 'committed', prompt: command.label },
    transactionLabel: command.label,
    addedEntityIds: [],
    removedEntityIds: [],
  }),
};

export const annotationCommandDefinitions = {
  ANNOTATION_COMMIT: annotationCommitCommand,
  CREATE_MTEXT: createMTextCommand,
  CREATE_LEADER: createLeaderCommand,
  CREATE_DIMENSION: createDimensionCommand,
  CREATE_BEARING_LABEL: createBearingLabelCommand,
  CREATE_CURVE_LABEL: createCurveLabelCommand,
  UPDATE_DIMENSION_PLACEMENT: updateDimensionPlacementCommand,
  REATTACH_ANNOTATION: reattachAnnotationCommand,
  SET_TEXT_OVERRIDE: setTextOverrideCommand,
  CLEAR_TEXT_OVERRIDE: clearTextOverrideCommand,
  SET_ANNOTATION_SCALE: setAnnotationScaleCommand,
} as const;
