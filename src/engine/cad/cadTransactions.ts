import {
  clearCadSelection,
  createCadSelectionState,
  selectAllCadEntities,
} from './cadSelection';
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
  copyCommand,
  moveCommand,
  pasteCommand,
} from './cadTransactionsClipboardCommands';
import {
  extendCommand,
  filletCommand,
  gripEditCommand,
  intersectPointCommand,
  trimCommand,
} from './cadTransactionsModifyCommands';
import { getExpandedSelectedEntities } from './cadTransactionsSelection';
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
  CadEntityId,
  CadLayer,
  CadLineEntity,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

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
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
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

const commitLayerProject = (
  key: CadCommandKey,
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult => ({
  nextSnapshot: {
    project: nextProject,
    selection: createCadSelectionState(nextProject, snapshot.selection.selectedEntityIds),
  },
  commandState: { key, phase: 'committed', prompt: `${label} committed.` },
  transactionLabel: label,
  addedEntityIds: [],
  removedEntityIds: [],
});

const layerCreateCommand: CadCommandDefinition<Extract<CadCommand, { key: 'LAYER_CREATE' }>> = {
  key: 'LAYER_CREATE',
  execute: (snapshot, command) => {
    const name = command.name.trim();
    if (!name) return null;
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
    if (!name) return null;
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

const withLayer = (
  project: CadProject,
  layerId: string,
  patch: Partial<CadLayer>,
): CadProject | null => {
  const layer = project.layers.find((entry) => entry.id === layerId);
  if (!layer) return null;
  return {
    ...project,
    layers: project.layers.map((entry) => (entry.id === layerId ? { ...entry, ...patch } : entry)),
  };
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
  COPY: copyCommand as CadCommandDefinition<CadCommand>,
  EXTEND: extendCommand as CadCommandDefinition<CadCommand>,
  FILLET: filletCommand as CadCommandDefinition<CadCommand>,
  PASTE: pasteCommand as CadCommandDefinition<CadCommand>,
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
  LAYER_MOVE_OBJECTS: layerMoveObjectsCommand as CadCommandDefinition<CadCommand>,
  LAYER_DELETE: layerDeleteCommand as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
