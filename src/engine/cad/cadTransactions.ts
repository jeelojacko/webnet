import {
  clearCadSelection,
  createCadSelectionState,
  selectAllCadEntities,
} from './cadSelection';
import { checkCadEntityEditable } from './cadAppearance';
import { resolveCurrentCadLayerId } from './cadLayers';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  compactManualPointEntities,
  createManualPointEntities,
  nextEntityName,
} from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import {
  alignmentCreateCommand,
  alignmentOffsetCreateCommand,
} from './cadTransactionsAlignmentCommands';
import {
  alignmentIntervalPointsCommand,
  alignmentOffsetPointCommand,
  alignmentStationEquationCommand,
  alignmentStationReportCommand,
} from './cadTransactionsAlignmentStationCommands';
import {
  parcelLayoutAutoCommand,
  parcelSplitSlideCommand,
  parcelSplitSwingCommand,
} from './cadTransactionsParcelLayoutCommands';
import {
  parcelCreateCommand,
  parcelSplitCommand,
} from './cadTransactionsParcelBasicCommands';
import {
  parcelSplitAreaCommand,
  parcelSplitBearingCommand,
} from './cadTransactionsParcelSplitCommands';
import {
  batchCogoCommand,
  polylineCommand,
  traverseCommand,
} from './cadTransactionsTraverseCommands';
import {
  arc3ptCommand,
  arcCreateCommand,
  tangentCurveCommand,
} from './cadTransactionsCurveCommands';
import { editEntityCommand } from './cadTransactionsEditCommands';
import {
  annotationAwareCopyCommand,
  annotationAwarePasteCommand,
} from './cadTransactionsAnnotationCopyCommands';
import { annotationCommandDefinitions } from './cadTransactionsAnnotationCommands';
import {
  moveCommand,
} from './cadTransactionsClipboardCommands';
import {
  align2DCommand,
  gridGroundCommand,
  helmert2DCommand,
  mirrorCommand,
  rotateCommand,
  scaleCommand,
} from './cadTransactionsTransformCommands';
import { projectTransformCommand } from './cadTransactionsProjectTransformCommands';
import {
  extendCommand,
  filletCommand,
  gripEditCommand,
  intersectPointCommand,
  trimCommand,
} from './cadTransactionsModifyCommands';
import { getExpandedSelectedEntities } from './cadTransactionsSelection';
import { f2fGenerateCommand } from '../fieldToFinish/cadGeneration';
import {
  surveyGroupTableCommand,
  surveyPointOverrideCommand,
  surveyStyleTableCommand,
} from './cadTransactionsSurveyDisplay';
import { surfaceCommandDefinitions } from './cadTransactionsSurfaceCommands';
import { surfaceBakeCommandDefinitions } from './cadTransactionsSurfaceBakeCommands';
import { surfaceComposeCommandDefinitions } from './cadTransactionsSurfaceComposeCommands';
import { blockCommandDefinitions } from './cadTransactionsBlockCommands';
import { landxmlImportCommand } from './cadTransactionsLandxmlImport';
import { volumeCommandDefinitions } from './cadTransactionsVolumeCommands';
import { analysisCommandDefinitions } from './cadTransactionsAnalysisCommands';
import { profileCommandDefinitions } from './cadTransactionsProfileCommands';
import { sectionCommandDefinitions } from './cadTransactionsSectionCommands';
export {
  applyCadGripEdit,
  buildCadGripHandles,
} from './cadTransactionsEntityTransforms';
export {
  buildCadExtendPreview,
  type CadExtendPreview,
} from './cadTransactionsExtend';
export {
  buildCadTrimPreview,
  type CadTrimPreview,
} from './cadTransactionsTrim';
export {
  buildCadFilletPreview,
  type CadFilletPreview,
} from './cadTransactionsFilletPreview';
import {
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadCommandState,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
export type {
  CadCommand,
  CadCommandExecutionResult,
  CadCommandKey,
  CadCommandPhase,
  CadCommandState,
  CadTransaction,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadEntity,
  CadLayer,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';
import {
  commitLayerProject,
  isLayerNameTaken,
  layerColorCommand,
  layerDescriptionCommand,
  layerFrozenCommand,
  layerLinetypeCommand,
  layerLineweightCommand,
  layerSetCurrentCommand,
  layerTransparencyCommand,
  withLayer,
} from './cadTransactionsLayerCommands';

const createIdleCommandState = (): CadCommandState => ({
  key: 'IDLE',
  phase: 'idle',
  prompt: 'Ready. Use Select All, Clear Selection, ERASE, POINT, COGO PT, LINE, PLINE, TRAVERSE, DEED, ARC 3PT, TAN CURVE, ALIGN, ALIGN OFF, STA, STA EQ, STA PT, STA INT, PARCEL, MOVE, COPY, TRIM, EXT, FILLET, INTX, or INVERSE to exercise command history.',
});

const selectAllCommand: CadCommandDefinition<{ key: 'SELECT_ALL' }> = {
  key: 'SELECT_ALL',
  execute: (snapshot) => {
    const nextSelection = selectAllCadEntities(snapshot.project);
    if (nextSelection.selectedEntityIds.length === snapshot.selection.selectedEntityIds.length) {
      const same =
        nextSelection.selectedEntityIds.every(
          (entityId, index) => snapshot.selection.selectedEntityIds[index] === entityId,
        );
      if (same) return null;
    }
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: nextSelection,
      },
      commandState: {
        key: 'SELECT_ALL',
        phase: 'committed',
        prompt: 'SELECT_ALL committed. All visible entities selected.',
      },
      transactionLabel: `SELECT_ALL (${nextSelection.selectedEntityIds.length})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const clearSelectionCommand: CadCommandDefinition<{ key: 'CLEAR_SELECTION' }> = {
  key: 'CLEAR_SELECTION',
  execute: (snapshot) => {
    if (snapshot.selection.selectedEntityIds.length === 0) return null;
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: clearCadSelection(),
      },
      commandState: {
        key: 'CLEAR_SELECTION',
        phase: 'committed',
        prompt: 'CLEAR_SELECTION committed. Selection set cleared.',
      },
      transactionLabel: 'CLEAR_SELECTION',
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const eraseCommand: CadCommandDefinition<{ key: 'ERASE' }> = {
  key: 'ERASE',
  execute: (snapshot) => {
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    // Atomic reject: any locked/hidden source blocks the whole erase (LAYER_LOCKED).
    if (
      selectedEntities.some(
        (entity) => !checkCadEntityEditable(snapshot.project, entity).editable,
      )
    ) {
      return null;
    }
    const removedEntityIds = selectedEntities.map((entity) => entity.id);
    const removedEntityIdSet = new Set(removedEntityIds);
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.filter((entity) => !removedEntityIdSet.has(entity.id)),
    );
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject),
      },
      commandState: {
        key: 'ERASE',
        phase: 'committed',
        prompt: `ERASE committed. Removed ${removedEntityIds.length} entr${removedEntityIds.length === 1 ? 'y' : 'ies'}.`,
      },
      transactionLabel: `ERASE (${removedEntityIds.length})`,
      addedEntityIds: [],
      removedEntityIds,
    };
  },
};

const pointCommand: CadCommandDefinition<{
  key: 'POINT';
  x: number;
  y: number;
  label?: string;
}> = {
  key: 'POINT',
  execute: (snapshot, command) => {
    const entities = createManualPointEntities(snapshot.project, command.x, command.y, command.label);
    const appendedEntities = compactManualPointEntities([entities.point, entities.label]);
    const nextProject = appendCadProjectEntities(
      snapshot.project,
      appendedEntities,
    );
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [entities.point.id]),
      },
      commandState: {
        key: 'POINT',
        phase: 'committed',
        prompt: `POINT committed at (${command.x.toFixed(3)}, ${command.y.toFixed(3)}).`,
      },
      transactionLabel: `POINT (${entities.point.stationId})`,
      addedEntityIds: [entities.point.id, entities.label?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const cogoPointCommand: CadCommandDefinition<{
  key: 'COGO_POINT';
  x: number;
  y: number;
  label?: string;
  basisLabel: string;
  directionLabel: string;
}> = {
  key: 'COGO_POINT',
  execute: (snapshot, command) => {
    const summary = `Created point from ${command.basisLabel} using ${command.directionLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'COGO_POINT',
      summary,
      sourcePointIds: [command.basisLabel],
      inputs: {
        basisLabel: command.basisLabel,
        directionLabel: command.directionLabel,
      },
      parameters: {
        x: command.x,
        y: command.y,
      },
    });
    const entities = createManualPointEntities(snapshot.project, command.x, command.y, command.label);
    const pointEntity: CadSurveyPointEntity = {
      ...entities.point,
      metadata: buildCadCogoEntityMetadata(entities.point.metadata, provenance),
    };
    const labelEntity = entities.label
      ? {
          ...entities.label,
          metadata: buildCadCogoEntityMetadata(entities.label.metadata, provenance),
        }
      : null;
    const appendedEntities = compactManualPointEntities([pointEntity, labelEntity]);
    const nextProjectWithEntities = appendCadProjectEntities(
      snapshot.project,
      appendedEntities,
    );
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'COGO Point',
      summary,
      rows: [
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Northing', value: command.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: command.x.toFixed(3), unit: 'm' },
      ],
      createdEntities: appendedEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [pointEntity.id]),
      },
      commandState: {
        key: 'COGO_POINT',
        phase: 'committed',
        prompt: `COGO_POINT committed from ${command.basisLabel} using ${command.directionLabel}.`,
      },
      transactionLabel: `COGO_POINT (${pointEntity.stationId})`,
      addedEntityIds: [pointEntity.id, labelEntity?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const lineCommand: CadCommandDefinition<{
  key: 'LINE';
  start: { x: number; y: number; label: string };
  end: { x: number; y: number; label: string };
}> = {
  key: 'LINE',
  execute: (snapshot, command) => {
    if (
      Math.abs(command.start.x - command.end.x) <= 1e-9 &&
      Math.abs(command.start.y - command.end.y) <= 1e-9
    ) {
      return null;
    }
    const lineName = nextEntityName(snapshot.project, 'LINE');
    const lineEntity: CadEntity = {
      id: createStableRuntimeId('cad-line'),
      type: 'line',
      layerId: resolveCurrentCadLayerId(snapshot.project),
      visible: true,
      locked: false,
      fromStationId: command.start.label,
      toStationId: command.end.label,
      fromX: command.start.x,
      fromY: command.start.y,
      toX: command.end.x,
      toY: command.end.y,
      sourceObservationIds: [],
      metadata: {
        createdBy: 'LINE',
        entityName: lineName,
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [lineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [lineEntity.id]),
      },
      commandState: {
        key: 'LINE',
        phase: 'committed',
        prompt: `LINE committed from ${command.start.label} to ${command.end.label}.`,
      },
      transactionLabel: `LINE (${lineName})`,
      addedEntityIds: [lineEntity.id],
      removedEntityIds: [],
    };
  },
};

// Track C sheet/viewport/title-block commands are draft-only intents: they commit
// a transaction for history without mutating model-space geometry or
// adjustment results. The caller applies the matching cadSheets pure op to its
// DraftDocument alongside runCadCommand.
const draftOnlyCommand = (
  key: CadCommandKey,
  label: string,
): CadCommandDefinition<CadCommand> => ({
  key: key as 'SELECT_ALL',
  execute: (snapshot) => ({
    nextSnapshot: { project: snapshot.project, selection: snapshot.selection },
    commandState: { key, phase: 'committed', prompt: `${label} committed (draft only).` },
    transactionLabel: label,
    addedEntityIds: [],
    removedEntityIds: [],
  }),
});

const layerCreateCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_CREATE' }>> = {
  key: 'LAYER_CREATE',
  execute: (snapshot, command) => {
    const name = command.name.trim();
    if (!name || isLayerNameTaken(snapshot.project, name)) return null;
    const layer: CadLayer = {
      id: createStableRuntimeId('cad-layer'),
      name,
      color: command.color ?? '#ffffff',
      visible: true,
      locked: false,
      printable: true,
      role: command.role ?? 'planning',
    };
    const nextProject: CadProject = { ...snapshot.project, layers: [...snapshot.project.layers, layer] };
    return commitLayerProject('LAYER_CREATE', snapshot, nextProject, `LAYER_CREATE (${name})`);
  },
};

const layerRenameCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_RENAME' }>> = {
  key: 'LAYER_RENAME',
  execute: (snapshot, command) => {
    const name = command.name.trim();
    if (!name || isLayerNameTaken(snapshot.project, name, command.layerId)) return null;
    const nextProject = withLayer(snapshot.project, command.layerId, { name });
    if (!nextProject) return null;
    return commitLayerProject('LAYER_RENAME', snapshot, nextProject, `LAYER_RENAME (${name})`);
  },
};

const layerVisibilityCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_VISIBILITY' }>> = {
  key: 'LAYER_VISIBILITY',
  execute: (snapshot, command) => {
    const nextProject = withLayer(snapshot.project, command.layerId, { visible: command.visible });
    if (!nextProject) return null;
    return commitLayerProject('LAYER_VISIBILITY', snapshot, nextProject, `LAYER_VISIBILITY (${command.layerId})`);
  },
};

const layerLockedCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_LOCKED' }>> = {
  key: 'LAYER_LOCKED',
  execute: (snapshot, command) => {
    const nextProject = withLayer(snapshot.project, command.layerId, { locked: command.locked });
    if (!nextProject) return null;
    return commitLayerProject('LAYER_LOCKED', snapshot, nextProject, `LAYER_LOCKED (${command.layerId})`);
  },
};

const layerPrintableCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_PRINTABLE' }>> = {
  key: 'LAYER_PRINTABLE',
  execute: (snapshot, command) => {
    const nextProject = withLayer(snapshot.project, command.layerId, { printable: command.printable });
    if (!nextProject) return null;
    return commitLayerProject('LAYER_PRINTABLE', snapshot, nextProject, `LAYER_PRINTABLE (${command.layerId})`);
  },
};

const layerMoveObjectsCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_MOVE_OBJECTS' }>> = {
  key: 'LAYER_MOVE_OBJECTS',
  execute: (snapshot, command) => {
    const ids = new Set(snapshot.project.layers.map((entry) => entry.id));
    if (!ids.has(command.fromLayerId) || !ids.has(command.toLayerId)) return null;
    if (command.fromLayerId === command.toLayerId) return null;
    const moved = snapshot.project.entities.filter((entity) => entity.layerId === command.fromLayerId);
    if (moved.length === 0) return null;
    // Locked target layer rejects (creation-on-locked); any locked/hidden
    // moved source rejects the whole move (LAYER_LOCKED).
    if (
      snapshot.project.layers.find((entry) => entry.id === command.toLayerId)?.locked === true
    ) {
      return null;
    }
    if (
      moved.some((entity) => !checkCadEntityEditable(snapshot.project, entity).editable)
    ) {
      return null;
    }
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) =>
        entity.layerId === command.fromLayerId ? { ...entity, layerId: command.toLayerId } : entity,
      ),
    );
    return commitLayerProject('LAYER_MOVE_OBJECTS', snapshot, nextProject, `LAYER_MOVE_OBJECTS (${moved.length})`);
  },
};

const layerDeleteCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_DELETE' }>> = {
  key: 'LAYER_DELETE',
  execute: (snapshot, command) => {
    if (!snapshot.project.layers.some((entry) => entry.id === command.layerId)) return null;
    // Populated-layer guard: move objects off first (UI confirms before doing so).
    if (snapshot.project.entities.some((entity) => entity.layerId === command.layerId)) return null;
    const nextProject: CadProject = {
      ...snapshot.project,
      layers: snapshot.project.layers.filter((entry) => entry.id !== command.layerId),
    };
    return commitLayerProject('LAYER_DELETE', snapshot, nextProject, `LAYER_DELETE (${command.layerId})`);
  },
};

export const CAD_COMMAND_REGISTRY: Record<CadCommandKey, CadCommandDefinition<CadCommand>> = {
  SELECT_ALL: selectAllCommand as CadCommandDefinition<CadCommand>,
  CLEAR_SELECTION: clearSelectionCommand as CadCommandDefinition<CadCommand>,
  ERASE: eraseCommand as CadCommandDefinition<CadCommand>,
  POINT: pointCommand as CadCommandDefinition<CadCommand>,
  COGO_POINT: cogoPointCommand as CadCommandDefinition<CadCommand>,
  LINE: lineCommand as CadCommandDefinition<CadCommand>,
  PLINE: polylineCommand as CadCommandDefinition<CadCommand>,
  TRAVERSE: traverseCommand as CadCommandDefinition<CadCommand>,
  BATCH_COGO: batchCogoCommand as CadCommandDefinition<CadCommand>,
  ARC_3PT: arc3ptCommand as CadCommandDefinition<CadCommand>,
  ARC_CREATE: arcCreateCommand as CadCommandDefinition<CadCommand>,
  TANGENT_CURVE: tangentCurveCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_CREATE: alignmentCreateCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_OFFSET_CREATE: alignmentOffsetCreateCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_STATION_REPORT: alignmentStationReportCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_STATION_EQUATION: alignmentStationEquationCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_OFFSET_POINT: alignmentOffsetPointCommand as CadCommandDefinition<CadCommand>,
  ALIGNMENT_INTERVAL_POINTS: alignmentIntervalPointsCommand as CadCommandDefinition<CadCommand>,
  PARCEL_CREATE: parcelCreateCommand as CadCommandDefinition<CadCommand>,
  PARCEL_SPLIT: parcelSplitCommand as CadCommandDefinition<CadCommand>,
  PARCEL_SPLIT_BEARING: parcelSplitBearingCommand as CadCommandDefinition<CadCommand>,
  PARCEL_SPLIT_AREA: parcelSplitAreaCommand as CadCommandDefinition<CadCommand>,
  PARCEL_SPLIT_SLIDE: parcelSplitSlideCommand as CadCommandDefinition<CadCommand>,
  PARCEL_SPLIT_SWING: parcelSplitSwingCommand as CadCommandDefinition<CadCommand>,
  PARCEL_LAYOUT_AUTO: parcelLayoutAutoCommand as CadCommandDefinition<CadCommand>,
  EDIT_ENTITY: editEntityCommand as CadCommandDefinition<CadCommand>,
  MOVE: moveCommand as CadCommandDefinition<CadCommand>,
  COPY: annotationAwareCopyCommand as CadCommandDefinition<CadCommand>,
  ROTATE: rotateCommand as CadCommandDefinition<CadCommand>,
  SCALE: scaleCommand as CadCommandDefinition<CadCommand>,
  MIRROR: mirrorCommand as CadCommandDefinition<CadCommand>,
  ALIGN2D: align2DCommand as CadCommandDefinition<CadCommand>,
  HELMERT2D: helmert2DCommand as CadCommandDefinition<CadCommand>,
  GRIDGROUND: gridGroundCommand as CadCommandDefinition<CadCommand>,
  PROJECTTRANSFORM: projectTransformCommand as CadCommandDefinition<CadCommand>,
  EXTEND: extendCommand as CadCommandDefinition<CadCommand>,
  FILLET: filletCommand as CadCommandDefinition<CadCommand>,
  PASTE: annotationAwarePasteCommand as CadCommandDefinition<CadCommand>,
  TRIM: trimCommand as CadCommandDefinition<CadCommand>,
  INTERSECT_POINT: intersectPointCommand as CadCommandDefinition<CadCommand>,
  GRIP_EDIT: gripEditCommand as CadCommandDefinition<CadCommand>,
  SHEET_ADD: draftOnlyCommand('SHEET_ADD', 'SHEET_ADD') as CadCommandDefinition<CadCommand>,
  SHEET_DELETE: draftOnlyCommand('SHEET_DELETE', 'SHEET_DELETE') as CadCommandDefinition<CadCommand>,
  VIEWPORT_MOVE: draftOnlyCommand('VIEWPORT_MOVE', 'VIEWPORT_MOVE') as CadCommandDefinition<CadCommand>,
  VIEWPORT_SCALE: draftOnlyCommand('VIEWPORT_SCALE', 'VIEWPORT_SCALE') as CadCommandDefinition<CadCommand>,
  VIEWPORT_ROTATE: draftOnlyCommand('VIEWPORT_ROTATE', 'VIEWPORT_ROTATE') as CadCommandDefinition<CadCommand>,
  TITLE_BLOCK_EDIT: draftOnlyCommand(
    'TITLE_BLOCK_EDIT',
    'TITLE_BLOCK_EDIT',
  ) as CadCommandDefinition<CadCommand>,
  LAYER_CREATE: layerCreateCommand as CadCommandDefinition<CadCommand>,
  LAYER_RENAME: layerRenameCommand as CadCommandDefinition<CadCommand>,
  LAYER_VISIBILITY: layerVisibilityCommand as CadCommandDefinition<CadCommand>,
  LAYER_LOCKED: layerLockedCommand as CadCommandDefinition<CadCommand>,
  LAYER_PRINTABLE: layerPrintableCommand as CadCommandDefinition<CadCommand>,
  LAYER_COLOR: layerColorCommand as CadCommandDefinition<CadCommand>,
  LAYER_LINETYPE: layerLinetypeCommand as CadCommandDefinition<CadCommand>,
  LAYER_LINEWEIGHT: layerLineweightCommand as CadCommandDefinition<CadCommand>,
  LAYER_TRANSPARENCY: layerTransparencyCommand as CadCommandDefinition<CadCommand>,
  LAYER_FROZEN: layerFrozenCommand as CadCommandDefinition<CadCommand>,
  LAYER_DESCRIPTION: layerDescriptionCommand as CadCommandDefinition<CadCommand>,
  LAYER_SET_CURRENT: layerSetCurrentCommand as CadCommandDefinition<CadCommand>,
  LAYER_MOVE_OBJECTS: layerMoveObjectsCommand as CadCommandDefinition<CadCommand>,
  LAYER_DELETE: layerDeleteCommand as CadCommandDefinition<CadCommand>,
  F2F_GENERATE: f2fGenerateCommand as CadCommandDefinition<CadCommand>,
  SURVEY_POINT_OVERRIDE: surveyPointOverrideCommand as CadCommandDefinition<CadCommand>,
  SURVEY_STYLE_TABLE: surveyStyleTableCommand as CadCommandDefinition<CadCommand>,
  SURVEY_GROUP_TABLE: surveyGroupTableCommand as CadCommandDefinition<CadCommand>,
  SURFACE_CREATE: surfaceCommandDefinitions.SURFACE_CREATE as CadCommandDefinition<CadCommand>,
  SURFACE_DELETE: surfaceCommandDefinitions.SURFACE_DELETE as CadCommandDefinition<CadCommand>,
  SURFACE_RENAME: surfaceCommandDefinitions.SURFACE_RENAME as CadCommandDefinition<CadCommand>,
  SURFACE_SET_LAYER_STYLE: surfaceCommandDefinitions.SURFACE_SET_LAYER_STYLE as CadCommandDefinition<CadCommand>,
  SURFACE_ADD_POINT_GROUP: surfaceCommandDefinitions.SURFACE_ADD_POINT_GROUP as CadCommandDefinition<CadCommand>,
  SURFACE_REMOVE_POINT_GROUP: surfaceCommandDefinitions.SURFACE_REMOVE_POINT_GROUP as CadCommandDefinition<CadCommand>,
  SURFACE_ADD_POINTS: surfaceCommandDefinitions.SURFACE_ADD_POINTS as CadCommandDefinition<CadCommand>,
  SURFACE_REMOVE_SOURCE: surfaceCommandDefinitions.SURFACE_REMOVE_SOURCE as CadCommandDefinition<CadCommand>,
  SURFACE_ADD_BREAKLINE: surfaceCommandDefinitions.SURFACE_ADD_BREAKLINE as CadCommandDefinition<CadCommand>,
  SURFACE_REMOVE_BREAKLINE: surfaceCommandDefinitions.SURFACE_REMOVE_BREAKLINE as CadCommandDefinition<CadCommand>,
  SURFACE_RENAME_BREAKLINE: surfaceCommandDefinitions.SURFACE_RENAME_BREAKLINE as CadCommandDefinition<CadCommand>,
  SURFACE_BREAKLINE_INSERT_POINT: surfaceCommandDefinitions.SURFACE_BREAKLINE_INSERT_POINT as CadCommandDefinition<CadCommand>,
  SURFACE_BREAKLINE_REMOVE_POINT: surfaceCommandDefinitions.SURFACE_BREAKLINE_REMOVE_POINT as CadCommandDefinition<CadCommand>,
  SURFACE_BREAKLINE_REVERSE: surfaceCommandDefinitions.SURFACE_BREAKLINE_REVERSE as CadCommandDefinition<CadCommand>,
  SURFACE_BREAKLINE_REPLACE_CHAIN: surfaceCommandDefinitions.SURFACE_BREAKLINE_REPLACE_CHAIN as CadCommandDefinition<CadCommand>,
  SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN: surfaceCommandDefinitions.SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN as CadCommandDefinition<CadCommand>,
  SURFACE_ADD_BOUNDARY: surfaceCommandDefinitions.SURFACE_ADD_BOUNDARY as CadCommandDefinition<CadCommand>,
  SURFACE_REMOVE_BOUNDARY: surfaceCommandDefinitions.SURFACE_REMOVE_BOUNDARY as CadCommandDefinition<CadCommand>,
  SURFACE_CREATE_BOUNDARY_SOURCE: surfaceCommandDefinitions.SURFACE_CREATE_BOUNDARY_SOURCE as CadCommandDefinition<CadCommand>,
  SURFACE_REPLACE_BOUNDARY_SOURCE: surfaceCommandDefinitions.SURFACE_REPLACE_BOUNDARY_SOURCE as CadCommandDefinition<CadCommand>,
  SURFACE_MAKE_BOUNDARY_INDEPENDENT: surfaceCommandDefinitions.SURFACE_MAKE_BOUNDARY_INDEPENDENT as CadCommandDefinition<CadCommand>,
  SURFACE_ADD_EDIT: surfaceCommandDefinitions.SURFACE_ADD_EDIT as CadCommandDefinition<CadCommand>,
  SURFACE_DELETE_EDIT: surfaceCommandDefinitions.SURFACE_DELETE_EDIT as CadCommandDefinition<CadCommand>,
  SURFACE_MOVE_EDIT: surfaceCommandDefinitions.SURFACE_MOVE_EDIT as CadCommandDefinition<CadCommand>,
  SURFACE_SET_EDIT_ENABLED: surfaceCommandDefinitions.SURFACE_SET_EDIT_ENABLED as CadCommandDefinition<CadCommand>,
  SURFACE_STYLE_CREATE: surfaceCommandDefinitions.SURFACE_STYLE_CREATE as CadCommandDefinition<CadCommand>,
  SURFACE_STYLE_DUPLICATE: surfaceCommandDefinitions.SURFACE_STYLE_DUPLICATE as CadCommandDefinition<CadCommand>,
  SURFACE_STYLE_RENAME: surfaceCommandDefinitions.SURFACE_STYLE_RENAME as CadCommandDefinition<CadCommand>,
  SURFACE_STYLE_UPDATE: surfaceCommandDefinitions.SURFACE_STYLE_UPDATE as CadCommandDefinition<CadCommand>,
  SURFACE_STYLE_DELETE: surfaceCommandDefinitions.SURFACE_STYLE_DELETE as CadCommandDefinition<CadCommand>,
  // Phase 18X explicit bake — separate from the 18S TIN EDIT group.
  SURFBAKE: surfaceBakeCommandDefinitions.SURFBAKE as CadCommandDefinition<CadCommand>,
  SURFBAKECOPY: surfaceBakeCommandDefinitions.SURFBAKECOPY as CadCommandDefinition<CadCommand>,
  // Phase 18Y exact two-surface composition — sibling of the 18X bake group.
  SURFCOMPOSE: surfaceComposeCommandDefinitions.SURFCOMPOSE as CadCommandDefinition<CadCommand>,
  SURFCOMPOSEPASTE: surfaceComposeCommandDefinitions.SURFCOMPOSEPASTE as CadCommandDefinition<CadCommand>,
  LANDXML_IMPORT: landxmlImportCommand as CadCommandDefinition<CadCommand>,
  VOLUME_SURFACE_CREATE: volumeCommandDefinitions.VOLUME_SURFACE_CREATE as CadCommandDefinition<CadCommand>,
  VOLUME_SURFACE_DELETE: volumeCommandDefinitions.VOLUME_SURFACE_DELETE as CadCommandDefinition<CadCommand>,
  VOLUME_SURFACE_UPDATE_SOURCES: volumeCommandDefinitions.VOLUME_SURFACE_UPDATE_SOURCES as CadCommandDefinition<CadCommand>,
  VOLUME_SURFACE_SET_LAYER_STYLE: volumeCommandDefinitions.VOLUME_SURFACE_SET_LAYER_STYLE as CadCommandDefinition<CadCommand>,
  VOLUME_STYLE_CREATE: volumeCommandDefinitions.VOLUME_STYLE_CREATE as CadCommandDefinition<CadCommand>,
  VOLUME_STYLE_DUPLICATE: volumeCommandDefinitions.VOLUME_STYLE_DUPLICATE as CadCommandDefinition<CadCommand>,
  VOLUME_STYLE_RENAME: volumeCommandDefinitions.VOLUME_STYLE_RENAME as CadCommandDefinition<CadCommand>,
  VOLUME_STYLE_UPDATE: volumeCommandDefinitions.VOLUME_STYLE_UPDATE as CadCommandDefinition<CadCommand>,
  VOLUME_STYLE_DELETE: volumeCommandDefinitions.VOLUME_STYLE_DELETE as CadCommandDefinition<CadCommand>,
  ANALYSIS_MAP_CREATE: analysisCommandDefinitions.ANALYSIS_MAP_CREATE as CadCommandDefinition<CadCommand>,
  ANALYSIS_MAP_UPDATE_BANDS: analysisCommandDefinitions.ANALYSIS_MAP_UPDATE_BANDS as CadCommandDefinition<CadCommand>,
  ANALYSIS_MAP_UPDATE_APPEARANCE: analysisCommandDefinitions.ANALYSIS_MAP_UPDATE_APPEARANCE as CadCommandDefinition<CadCommand>,
  ANALYSIS_MAP_DELETE: analysisCommandDefinitions.ANALYSIS_MAP_DELETE as CadCommandDefinition<CadCommand>,
  ANALYSIS_LEGEND_CREATE: analysisCommandDefinitions.ANALYSIS_LEGEND_CREATE as CadCommandDefinition<CadCommand>,
  ANALYSIS_LEGEND_UPDATE: analysisCommandDefinitions.ANALYSIS_LEGEND_UPDATE as CadCommandDefinition<CadCommand>,
  ANALYSIS_LEGEND_MOVE: analysisCommandDefinitions.ANALYSIS_LEGEND_MOVE as CadCommandDefinition<CadCommand>,
  ANALYSIS_LEGEND_DELETE: analysisCommandDefinitions.ANALYSIS_LEGEND_DELETE as CadCommandDefinition<CadCommand>,
  PROFILE_CREATE: profileCommandDefinitions.PROFILE_CREATE as CadCommandDefinition<CadCommand>,
  PROFILE_REBUILD: profileCommandDefinitions.PROFILE_REBUILD as CadCommandDefinition<CadCommand>,
  PROFILE_DELETE: profileCommandDefinitions.PROFILE_DELETE as CadCommandDefinition<CadCommand>,
  PROFILE_VIEW_CREATE: profileCommandDefinitions.PROFILE_VIEW_CREATE as CadCommandDefinition<CadCommand>,
  PROFILE_VIEW_UPDATE: profileCommandDefinitions.PROFILE_VIEW_UPDATE as CadCommandDefinition<CadCommand>,
  PROFILE_VIEW_DELETE: profileCommandDefinitions.PROFILE_VIEW_DELETE as CadCommandDefinition<CadCommand>,
  PROFILE_STYLE_CREATE: profileCommandDefinitions.PROFILE_STYLE_CREATE as CadCommandDefinition<CadCommand>,
  PROFILE_STYLE_DUPLICATE: profileCommandDefinitions.PROFILE_STYLE_DUPLICATE as CadCommandDefinition<CadCommand>,
  PROFILE_STYLE_RENAME: profileCommandDefinitions.PROFILE_STYLE_RENAME as CadCommandDefinition<CadCommand>,
  PROFILE_STYLE_UPDATE: profileCommandDefinitions.PROFILE_STYLE_UPDATE as CadCommandDefinition<CadCommand>,
  PROFILE_STYLE_DELETE: profileCommandDefinitions.PROFILE_STYLE_DELETE as CadCommandDefinition<CadCommand>,
  SAMPLE_GROUP_CREATE: sectionCommandDefinitions.SAMPLE_GROUP_CREATE as CadCommandDefinition<CadCommand>,
  SAMPLE_GROUP_RENAME: sectionCommandDefinitions.SAMPLE_GROUP_RENAME as CadCommandDefinition<CadCommand>,
  SAMPLE_GROUP_DELETE: sectionCommandDefinitions.SAMPLE_GROUP_DELETE as CadCommandDefinition<CadCommand>,
  SAMPLE_LINE_ADD: sectionCommandDefinitions.SAMPLE_LINE_ADD as CadCommandDefinition<CadCommand>,
  SAMPLE_LINE_ADD_INTERVAL: sectionCommandDefinitions.SAMPLE_LINE_ADD_INTERVAL as CadCommandDefinition<CadCommand>,
  SAMPLE_LINE_UPDATE: sectionCommandDefinitions.SAMPLE_LINE_UPDATE as CadCommandDefinition<CadCommand>,
  SAMPLE_LINE_DELETE: sectionCommandDefinitions.SAMPLE_LINE_DELETE as CadCommandDefinition<CadCommand>,
  SECTION_SOURCE_ADD: sectionCommandDefinitions.SECTION_SOURCE_ADD as CadCommandDefinition<CadCommand>,
  SECTION_SOURCE_REMOVE: sectionCommandDefinitions.SECTION_SOURCE_REMOVE as CadCommandDefinition<CadCommand>,
  SECTION_SOURCE_SET_STYLE: sectionCommandDefinitions.SECTION_SOURCE_SET_STYLE as CadCommandDefinition<CadCommand>,
  SECTION_AREA_COMPARISON: sectionCommandDefinitions.SECTION_AREA_COMPARISON as CadCommandDefinition<CadCommand>,
  SECTION_STYLE_CREATE: sectionCommandDefinitions.SECTION_STYLE_CREATE as CadCommandDefinition<CadCommand>,
  SECTION_STYLE_RENAME: sectionCommandDefinitions.SECTION_STYLE_RENAME as CadCommandDefinition<CadCommand>,
  SECTION_STYLE_UPDATE: sectionCommandDefinitions.SECTION_STYLE_UPDATE as CadCommandDefinition<CadCommand>,
  SECTION_STYLE_DELETE: sectionCommandDefinitions.SECTION_STYLE_DELETE as CadCommandDefinition<CadCommand>,
  SECTION_VIEW_CREATE: sectionCommandDefinitions.SECTION_VIEW_CREATE as CadCommandDefinition<CadCommand>,
  SECTION_VIEW_UPDATE: sectionCommandDefinitions.SECTION_VIEW_UPDATE as CadCommandDefinition<CadCommand>,
  SECTION_VIEW_DELETE: sectionCommandDefinitions.SECTION_VIEW_DELETE as CadCommandDefinition<CadCommand>,
  BLOCK_SEED: blockCommandDefinitions.BLOCK_SEED as CadCommandDefinition<CadCommand>,
  BLOCK_EDIT: blockCommandDefinitions.BLOCK_EDIT as CadCommandDefinition<CadCommand>,
  BLOCK_CREATE: blockCommandDefinitions.BLOCK_CREATE as CadCommandDefinition<CadCommand>,
  BLOCK_INSERT: blockCommandDefinitions.BLOCK_INSERT as CadCommandDefinition<CadCommand>,
  BLOCK_EXPLODE: blockCommandDefinitions.BLOCK_EXPLODE as CadCommandDefinition<CadCommand>,
  BLOCK_REDEFINE: blockCommandDefinitions.BLOCK_REDEFINE as CadCommandDefinition<CadCommand>,
  BLOCK_RENAME: blockCommandDefinitions.BLOCK_RENAME as CadCommandDefinition<CadCommand>,
  BLOCK_DUPLICATE: blockCommandDefinitions.BLOCK_DUPLICATE as CadCommandDefinition<CadCommand>,
  BLOCK_DELETE: blockCommandDefinitions.BLOCK_DELETE as CadCommandDefinition<CadCommand>,
  ANNOTATION_COMMIT: annotationCommandDefinitions.ANNOTATION_COMMIT as CadCommandDefinition<CadCommand>,
  CREATE_MTEXT: annotationCommandDefinitions.CREATE_MTEXT as CadCommandDefinition<CadCommand>,
  CREATE_LEADER: annotationCommandDefinitions.CREATE_LEADER as CadCommandDefinition<CadCommand>,
  CREATE_DIMENSION: annotationCommandDefinitions.CREATE_DIMENSION as CadCommandDefinition<CadCommand>,
  CREATE_BEARING_LABEL: annotationCommandDefinitions.CREATE_BEARING_LABEL as CadCommandDefinition<CadCommand>,
  CREATE_CURVE_LABEL: annotationCommandDefinitions.CREATE_CURVE_LABEL as CadCommandDefinition<CadCommand>,
  UPDATE_DIMENSION_PLACEMENT: annotationCommandDefinitions.UPDATE_DIMENSION_PLACEMENT as CadCommandDefinition<CadCommand>,
  REATTACH_ANNOTATION: annotationCommandDefinitions.REATTACH_ANNOTATION as CadCommandDefinition<CadCommand>,
  SET_TEXT_OVERRIDE: annotationCommandDefinitions.SET_TEXT_OVERRIDE as CadCommandDefinition<CadCommand>,
  CLEAR_TEXT_OVERRIDE: annotationCommandDefinitions.CLEAR_TEXT_OVERRIDE as CadCommandDefinition<CadCommand>,
  SET_ANNOTATION_SCALE: annotationCommandDefinitions.SET_ANNOTATION_SCALE as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => {
  const result = CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
  if (!result) return null;
  // Phase 18R.1: keep a snapshot-carried draft sticky across commands that
  // do not rewrite it (reference passthrough, so workspace propagation can
  // tell "changed" from "carried"). Only PROJECTTRANSFORM sets a new one.
  if (result.nextSnapshot.draft === undefined && snapshot.draft !== undefined) {
    return { ...result, nextSnapshot: { ...result.nextSnapshot, draft: snapshot.draft } };
  }
  return result;
};
