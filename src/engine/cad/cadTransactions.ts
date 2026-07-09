import {
  clearCadSelection,
  createCadSelectionState,
  selectAllCadEntities,
} from './cadSelection';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  getCadEntityEditableName,
  getCadEntityDisplayLabel,
} from './cadEntityNames';
import {
  buildCurveLabels,
  compactManualPointEntities,
  createManualPointEntities,
  nextCurveSequence,
  nextEntityName,
  stationIdExists,
} from './cadTransactionsEntityFactories';
import {
  buildCopiedDependentPointEntities,
  createArcSupportEntities,
  movePointReferences,
  renamePointReferences,
  syncEditedEntityDependencies,
} from './cadTransactionsLinkedEntities';
import {
  cloneEntityMetadata,
  withEntityMetadataName,
} from './cadTransactionsMetadata';
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
  getExpandedEntitiesByIds,
  getExpandedSelectedEntities,
} from './cadTransactionsSelection';
import {
  applyCadGripEdit,
  translateEntity,
} from './cadTransactionsEntityTransforms';
export {
  applyCadGripEdit,
  buildCadGripHandles,
} from './cadTransactionsEntityTransforms';
import { buildExtendedTrimEntity } from './cadTransactionsExtend';
export {
  buildCadExtendPreview,
  type CadExtendPreview,
} from './cadTransactionsExtend';
import { buildTrimmedEntityPieces } from './cadTransactionsTrim';
export {
  buildCadTrimPreview,
  type CadTrimPreview,
} from './cadTransactionsTrim';
import {
  buildTrimBoundaryEntities,
  isTrimmableEntity,
  type CadTrimEntity,
} from './cadTransactionsTrimCommon';
import {
  buildCadGeneralFillet,
  type CadFilletEntity,
} from './cadTransactionsFillet';
export {
  buildCadFilletPreview,
  type CadFilletPreview,
} from './cadTransactionsFilletPreview';
import {
  cadBuildArcFromThreePoints,
  cadBuildTangentCurve,
} from './cadGeometry';
import {
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type { CadSelectionState } from './cadSelection';
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
  CadArcEntity,
  CadEntityId,
  CadGripHandleKind,
  CadLineEntity,
  CadParcelLayoutSettings,
  CadParcelEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

const createIdleCommandState = (): CadCommandState => ({
  key: 'IDLE',
  phase: 'idle',
  prompt: 'Ready. Use Select All, Clear Selection, ERASE, POINT, COGO PT, LINE, PLINE, TRAVERSE, DEED, ARC 3PT, TAN CURVE, ALIGN, ALIGN OFF, STA, STA EQ, STA PT, STA INT, PARCEL, MOVE, COPY, TRIM, EXT, FILLET, INTX, or INVERSE to exercise command history.',
});

const buildCopiedEntities = (
  project: CadProject,
  selectedEntities: CadEntity[],
  deltaX: number,
  deltaY: number,
): CadEntity[] => {
  const selectedPointStationIds = new Set(
    selectedEntities
      .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
      .map((entity) => entity.stationId),
  );
  const { copiedEntities, copiedPointByStationId, copiedArcSupportBySourceId } = buildCopiedDependentPointEntities(
    project,
    selectedEntities,
    deltaX,
    deltaY,
  );

  selectedEntities.forEach((entity) => {
    if (entity.type === 'survey-point') return;
    if (entity.type === 'text' && entity.anchorEntityId) {
      const anchoredStationId = entity.anchorEntityId.startsWith('pt:')
        ? entity.anchorEntityId.slice(3)
        : null;
      if (anchoredStationId && copiedPointByStationId.has(anchoredStationId)) return;
    }
    if (entity.type === 'error-ellipse' && selectedPointStationIds.has(entity.stationId)) return;

    switch (entity.type) {
      case 'line': {
        const copiedFrom = copiedPointByStationId.get(entity.fromStationId);
        const copiedTo = copiedPointByStationId.get(entity.toStationId);
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-line'),
          fromStationId: copiedFrom?.stationId ?? entity.fromStationId,
          toStationId: copiedTo?.stationId ?? entity.toStationId,
          fromX: copiedFrom?.x ?? entity.fromX + deltaX,
          fromY: copiedFrom?.y ?? entity.fromY + deltaY,
          toX: copiedTo?.x ?? entity.toX + deltaX,
          toY: copiedTo?.y ?? entity.toY + deltaY,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      }
      case 'polyline':
      case 'polygon':
      case 'parcel':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId(
            entity.type === 'polyline'
              ? 'cad-polyline'
              : entity.type === 'polygon'
                ? 'cad-polygon'
                : 'cad-parcel',
          ),
          vertices: entity.vertices.map((vertex) => ({
            x: vertex.x + deltaX,
            y: vertex.y + deltaY,
          })),
          vertexLabels: entity.vertexLabels.map(
            (label) => copiedPointByStationId.get(label)?.stationId ?? label,
          ),
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'arc':
        {
          const copiedArcSupport = copiedArcSupportBySourceId.get(entity.id);
          const copiedArc = {
          ...entity,
          id: createStableRuntimeId('cad-arc'),
          centerX: entity.centerX + deltaX,
          centerY: entity.centerY + deltaY,
          metadata: {
            ...entity.metadata,
            entityName:
              copiedArcSupport != null
                ? buildCurveLabels(copiedArcSupport.sequence).curveName
                : getCadEntityEditableName(entity),
            createdBy: 'COPY',
            manual: true,
          },
          } satisfies CadArcEntity;
          copiedEntities.push(copiedArc);
          if (copiedArcSupport) {
            copiedArcSupport.arcSupportEntities.forEach((supportEntity) => {
              const replacement =
                supportEntity.type === 'survey-point'
                  ? {
                      ...supportEntity,
                      metadata: {
                        ...cloneEntityMetadata(supportEntity),
                        anchorCurveEntityId: copiedArc.id,
                      },
                    }
                  : {
                      ...supportEntity,
                      anchorEntityId:
                        supportEntity.anchorEntityId && supportEntity.anchorEntityId.startsWith('pt:')
                          ? `pt:${supportEntity.text}`
                          : supportEntity.anchorEntityId,
                      metadata: {
                        ...cloneEntityMetadata(supportEntity),
                        anchorCurveEntityId: copiedArc.id,
                      },
                    };
              const index = copiedEntities.findIndex((candidate) => candidate.id === supportEntity.id);
              if (index >= 0) copiedEntities[index] = replacement;
            });
          }
        }
        break;
      case 'alignment':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-alignment'),
          elements: entity.elements.map((element) =>
            element.kind === 'line'
              ? {
                  ...element,
                  start: { x: element.start.x + deltaX, y: element.start.y + deltaY },
                  end: { x: element.end.x + deltaX, y: element.end.y + deltaY },
                }
              : {
                  ...element,
                  center: { x: element.center.x + deltaX, y: element.center.y + deltaY },
                },
          ),
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'text':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-text'),
          x: entity.x + deltaX,
          y: entity.y + deltaY,
          anchorEntityId: undefined,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      case 'error-ellipse':
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-ellipse'),
          centerX: entity.centerX + deltaX,
          centerY: entity.centerY + deltaY,
          metadata: {
            ...entity.metadata,
            createdBy: 'COPY',
            manual: true,
          },
        });
        break;
      default:
        break;
    }
  });

  return copiedEntities;
};

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

const arc3ptCommand: CadCommandDefinition<{
  key: 'ARC_3PT';
  start: { x: number; y: number; label: string };
  through: { x: number; y: number; label: string };
  end: { x: number; y: number; label: string };
}> = {
  key: 'ARC_3PT',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildArcFromThreePoints(command.start, command.through, command.end);
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      sourcePointIds: [curveLabels.beginLabel, curveLabels.midLabel, curveLabels.endLabel, curveLabels.radiusLabel],
      inputs: {
        start: command.start,
        through: command.through,
        end: command.end,
      },
      parameters: {
        mode: 'ARC_3PT',
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ARC_3PT',
        entityName: curveLabels.curveName,
        manual: true,
        startLabel: command.start.label,
        throughLabel: command.through.label,
        endLabel: command.end.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'ARC_3PT',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Arc 3 Point',
      summary,
      rows: [
        { label: 'Radius', value: arcDefinition.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_3PT',
        phase: 'committed',
        prompt: `ARC_3PT committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `ARC_3PT (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const arcCreateCommand: CadCommandDefinition<{
  key: 'ARC_CREATE';
  modeLabel: string;
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  metadata?: Record<string, unknown>;
}> = {
  key: 'ARC_CREATE',
  execute: (snapshot, command) => {
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `${command.modeLabel} created ${curveLabels.curveName} radius ${command.definition.radius.toFixed(3)} m`;
    const provenance = createCogoProvenance({
      toolKey: 'ARC_CREATE',
      summary,
      inputs: {
        modeLabel: command.modeLabel,
        definition: command.definition,
      },
      parameters: command.metadata,
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: command.definition.center.x,
      centerY: command.definition.center.y,
      radius: command.definition.radius,
      startAngleDeg: command.definition.startAngleDeg,
      endAngleDeg: command.definition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: command.modeLabel,
        entityName: curveLabels.curveName,
        manual: true,
        ...(command.metadata ?? {}),
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: command.definition.center.x, y: command.definition.center.y },
        radius: command.definition.radius,
        startAngleDeg: command.definition.startAngleDeg,
        endAngleDeg: command.definition.endAngleDeg,
      },
      command.modeLabel,
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: command.modeLabel,
      summary,
      rows: [
        { label: 'Radius', value: command.definition.radius.toFixed(3), unit: 'm' },
        { label: 'Start angle', value: command.definition.startAngleDeg.toFixed(6), unit: 'deg' },
        { label: 'End angle', value: command.definition.endAngleDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_CREATE',
        phase: 'committed',
        prompt: `${command.modeLabel} committed as ${curveLabels.curveName}.`,
      },
      transactionLabel: `${command.modeLabel} (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const tangentCurveCommand: CadCommandDefinition<{
  key: 'TANGENT_CURVE';
  pi: { x: number; y: number; label: string };
  backTangentPoint: { x: number; y: number; label: string };
  aheadTangentPoint: { x: number; y: number; label: string };
  radius: number;
}> = {
  key: 'TANGENT_CURVE',
  execute: (snapshot, command) => {
    const arcDefinition = cadBuildTangentCurve(
      command.pi,
      command.backTangentPoint,
      command.aheadTangentPoint,
      command.radius,
    );
    if (!arcDefinition) return null;
    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const summary = `Created ${curveLabels.curveName} tangent curve with ${curveLabels.beginLabel}, ${curveLabels.midLabel}, ${curveLabels.endLabel}, ${curveLabels.radiusLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'TANGENT_CURVE',
      summary,
      sourcePointIds: ['PI', 'Back tangent', 'Ahead tangent', curveLabels.radiusLabel],
      inputs: {
        pi: command.pi,
        backTangentPoint: command.backTangentPoint,
        aheadTangentPoint: command.aheadTangentPoint,
      },
      parameters: {
        radius: command.radius,
      },
    });
    const arcEntity: CadEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: arcDefinition.center.x,
      centerY: arcDefinition.center.y,
      radius: arcDefinition.radius,
      startAngleDeg: arcDefinition.startAngleDeg,
      endAngleDeg: arcDefinition.endAngleDeg,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'TANGENT_CURVE',
        entityName: curveLabels.curveName,
        manual: true,
        piLabel: command.pi.label,
        backLabel: command.backTangentPoint.label,
        aheadLabel: command.aheadTangentPoint.label,
      }, provenance),
    };
    const supportEntities = createArcSupportEntities(
      snapshot.project,
      arcEntity.id,
      curveSequence,
      {
        center: { x: arcDefinition.center.x, y: arcDefinition.center.y },
        radius: arcDefinition.radius,
        startAngleDeg: arcDefinition.startAngleDeg,
        endAngleDeg: arcDefinition.endAngleDeg,
      },
      'TANGENT_CURVE',
    );
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [arcEntity, ...supportEntities]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Tangent Curve',
      summary,
      rows: [
        { label: 'PI', value: command.pi.label },
        { label: 'Radius', value: command.radius.toFixed(3), unit: 'm' },
        { label: 'Delta', value: arcDefinition.deltaDeg.toFixed(6), unit: 'deg' },
      ],
      createdEntities: [arcEntity, ...supportEntities],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'TANGENT_CURVE',
        phase: 'committed',
        prompt: `TANGENT_CURVE committed as ${curveLabels.curveName} with radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `TANGENT_CURVE (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const replaceEntityInProject = (
  project: CadProject,
  entityId: CadEntityId,
  updater: (_entity: CadEntity) => CadEntity,
): CadProject =>
  replaceCadProjectEntities(
    project,
    project.entities.map((entity) => (entity.id === entityId ? updater(entity) : entity)),
  );

const editEntityCommand: CadCommandDefinition<{
  key: 'EDIT_ENTITY';
  entityId: CadEntityId;
  edit:
    | { kind: 'entity-name'; value: string }
    | { kind: 'point-x'; value: number }
    | { kind: 'point-y'; value: number }
    | { kind: 'point-z'; value: number | null }
    | { kind: 'line-end'; toX: number; toY: number }
    | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number };
}> = {
  key: 'EDIT_ENTITY',
  execute: (snapshot, command) => {
    const targetEntity = snapshot.project.entities.find((entity) => entity.id === command.entityId);
    if (!targetEntity) return null;

    if (command.edit.kind === 'entity-name') {
      const nextName = command.edit.value.trim();
      if (!nextName) return null;
      let nextProject: CadProject | null = null;
      if (targetEntity.type === 'survey-point') {
        if (
          stationIdExists(snapshot.project, nextName) &&
          nextName.toUpperCase() !== targetEntity.stationId.trim().toUpperCase()
        ) {
          return null;
        }
        nextProject = replaceCadProjectEntities(
          snapshot.project,
          snapshot.project.entities.map((entity) =>
            renamePointReferences(entity, targetEntity.id, targetEntity.stationId, nextName),
          ),
        );
      } else if (targetEntity.type === 'alignment') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'alignment' ? { ...entity, name: nextName } : entity,
        );
      } else if (targetEntity.type === 'parcel') {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          entity.type === 'parcel' ? { ...entity, parcelName: nextName } : entity,
        );
      } else {
        nextProject = replaceEntityInProject(snapshot.project, targetEntity.id, (entity) =>
          withEntityMetadataName(entity, nextName),
        );
      }
      if (!nextProject) return null;
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${nextName}.`,
        },
        transactionLabel: `EDIT_ENTITY (${nextName})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'survey-point') {
      const nextX = command.edit.kind === 'point-x' ? command.edit.value : targetEntity.x;
      const nextY = command.edit.kind === 'point-y' ? command.edit.value : targetEntity.y;
      const nextZ =
        command.edit.kind === 'point-z'
          ? command.edit.value ?? undefined
          : targetEntity.z;
      if (
        !Number.isFinite(nextX) ||
        !Number.isFinite(nextY) ||
        (nextZ != null && !Number.isFinite(nextZ))
      ) {
        return null;
      }
      const nextProject = replaceCadProjectEntities(
        snapshot.project,
        snapshot.project.entities.map((entity) =>
          movePointReferences(entity, targetEntity.id, targetEntity.stationId, nextX, nextY, nextZ),
        ),
      );
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${targetEntity.stationId}.`,
        },
        transactionLabel: `EDIT_ENTITY (${targetEntity.stationId})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'line' && command.edit.kind === 'line-end') {
      const edit = command.edit;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        toX: edit.toX,
        toY: edit.toY,
      };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) =>
        updatedEntity,
      );
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    if (targetEntity.type === 'polyline' && command.edit.kind === 'polyline-vertex') {
      const edit = command.edit;
      const vertex = targetEntity.vertices[edit.vertexIndex];
      if (!vertex) return null;
      const updatedEntity: CadEntity = {
        ...targetEntity,
        vertices: targetEntity.vertices.map((entry, index) =>
          index === edit.vertexIndex ? { x: edit.x, y: edit.y } : entry,
        ),
      };
      const nextProjectBase = replaceEntityInProject(snapshot.project, targetEntity.id, (_entity) => updatedEntity);
      const nextProject = syncEditedEntityDependencies(nextProjectBase, targetEntity, updatedEntity);
      return {
        nextSnapshot: {
          project: nextProject,
          selection: createCadSelectionState(nextProject, [targetEntity.id]),
        },
        commandState: {
          key: 'EDIT_ENTITY',
          phase: 'committed',
          prompt: `EDIT_ENTITY committed for ${getCadEntityDisplayLabel(targetEntity)}.`,
        },
        transactionLabel: `EDIT_ENTITY (${getCadEntityDisplayLabel(targetEntity)})`,
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    return null;
  },
};

const moveCommand: CadCommandDefinition<{
  key: 'MOVE';
  deltaX: number;
  deltaY: number;
}> = {
  key: 'MOVE',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    const selectedIdSet = new Set(selectedEntities.map((entity) => entity.id));
    const nextProjectBase = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) =>
        selectedIdSet.has(entity.id) ? translateEntity(entity, command.deltaX, command.deltaY) : entity,
      ),
    );
    const translatedEntityById = new Map(
      nextProjectBase.entities.map((entity) => [entity.id, entity] as const),
    );
    const nextProject = selectedEntities.reduce((currentProject, previousEntity) => {
      const updatedEntity = translatedEntityById.get(previousEntity.id);
      if (!updatedEntity) return currentProject;
      return syncEditedEntityDependencies(currentProject, previousEntity, updatedEntity, {
        syncLinePoints: false,
      });
    }, nextProjectBase);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedEntities.map((entity) => entity.id)),
      },
      commandState: {
        key: 'MOVE',
        phase: 'committed',
        prompt: `MOVE committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `MOVE (${selectedEntities.length})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const copyCommand: CadCommandDefinition<{
  key: 'COPY';
  deltaX: number;
  deltaY: number;
}> = {
  key: 'COPY',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const selectedEntities = getExpandedSelectedEntities(snapshot);
    if (selectedEntities.length === 0) return null;
    const copiedEntities = buildCopiedEntities(snapshot.project, selectedEntities, command.deltaX, command.deltaY);
    if (copiedEntities.length === 0) return null;
    const nextProject = appendCadProjectEntities(snapshot.project, copiedEntities);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(
          nextProject,
          copiedEntities.map((entity) => entity.id),
        ),
      },
      commandState: {
        key: 'COPY',
        phase: 'committed',
        prompt: `COPY committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `COPY (${copiedEntities.length})`,
      addedEntityIds: copiedEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const extendCommand: CadCommandDefinition<{
  key: 'EXTEND';
  boundaryEntityIds: CadEntityId[];
  targetEntityId: CadEntityId;
  targetPickPoint: { x: number; y: number };
  targetSegmentId?: string;
}> = {
  key: 'EXTEND',
  execute: (snapshot, command) => {
    const boundaryEntities = buildTrimBoundaryEntities(snapshot.project, command.boundaryEntityIds);
    if (boundaryEntities.length === 0) return null;
    if (boundaryEntities.some((entity) => entity.id === command.targetEntityId)) return null;
    const targetEntity = snapshot.project.entities.find(
      (entity): entity is CadTrimEntity =>
        entity.id === command.targetEntityId && isTrimmableEntity(entity) && !entity.locked,
    );
    if (!targetEntity) return null;
    const extendedPieces = buildExtendedTrimEntity(
      targetEntity,
      boundaryEntities,
      command.targetPickPoint,
      command.targetSegmentId,
    );
    if (extendedPieces.length === 0) return null;
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.flatMap((entity) => {
        if (entity.id !== targetEntity.id) return [entity];
        return extendedPieces;
      }),
    );
    const boundarySelectionIds = boundaryEntities
      .filter((entity) => nextProject.entities.some((candidate) => candidate.id === entity.id))
      .map((entity) => entity.id);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, boundarySelectionIds),
      },
      commandState: {
        key: 'EXTEND',
        phase: 'committed',
        prompt: `EXTEND committed on ${targetEntity.id}.`,
      },
      transactionLabel: `EXTEND (${targetEntity.id})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

const filletCommand: CadCommandDefinition<{
  key: 'FILLET';
  radius: number;
  firstEntityId: CadEntityId;
  firstPickPoint: { x: number; y: number };
  firstSegmentId?: string;
  secondEntityId: CadEntityId;
  secondPickPoint: { x: number; y: number };
  secondSegmentId?: string;
}> = {
  key: 'FILLET',
  execute: (snapshot, command) => {
    if (command.firstEntityId === command.secondEntityId && command.firstSegmentId === command.secondSegmentId) {
      return null;
    }
    const firstEntity = snapshot.project.entities.find(
      (entity): entity is CadFilletEntity =>
        entity.id === command.firstEntityId && isTrimmableEntity(entity) && !entity.locked,
    );
    const secondEntity = snapshot.project.entities.find(
      (entity): entity is CadFilletEntity =>
        entity.id === command.secondEntityId && isTrimmableEntity(entity) && !entity.locked,
    );
    if (!firstEntity || !secondEntity) return null;

    const fillet = buildCadGeneralFillet(
      firstEntity,
      command.firstPickPoint,
      secondEntity,
      command.secondPickPoint,
      command.radius,
      command.firstSegmentId,
      command.secondSegmentId,
    );
    if (!fillet) return null;

    const updatedProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => {
        if (entity.id === firstEntity.id) return fillet.firstEntity;
        if (entity.id === secondEntity.id) return fillet.secondEntity;
        return entity;
      }),
    );
    if (!fillet.arcDefinition) {
      return {
        nextSnapshot: {
          project: updatedProject,
          selection: createCadSelectionState(updatedProject, [firstEntity.id, secondEntity.id]),
        },
        commandState: {
          key: 'FILLET',
          phase: 'committed',
          prompt: `FILLET committed as hard corner radius ${command.radius.toFixed(3)}.`,
        },
        transactionLabel: 'FILLET (0)',
        addedEntityIds: [],
        removedEntityIds: [],
      };
    }

    const curveSequence = nextCurveSequence(snapshot.project);
    const curveLabels = buildCurveLabels(curveSequence);
    const arcEntity: CadArcEntity = {
      id: createStableRuntimeId('cad-arc'),
      type: 'arc',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      centerX: fillet.arcDefinition.center.x,
      centerY: fillet.arcDefinition.center.y,
      radius: fillet.arcDefinition.radius,
      startAngleDeg: fillet.arcDefinition.startAngleDeg,
      endAngleDeg: fillet.arcDefinition.endAngleDeg,
      metadata: {
        createdBy: 'FILLET',
        entityName: curveLabels.curveName,
        manual: true,
        filletRadius: command.radius,
        sourceLineIds: [firstEntity.id, secondEntity.id],
      },
    };
    const supportEntities = createArcSupportEntities(
      updatedProject,
      arcEntity.id,
      curveSequence,
      fillet.arcDefinition,
      'FILLET',
    );
    const nextProject = appendCadProjectEntities(updatedProject, [arcEntity, ...supportEntities]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'FILLET',
        phase: 'committed',
        prompt: `FILLET committed as ${curveLabels.curveName} radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `FILLET (${curveLabels.curveName})`,
      addedEntityIds: [arcEntity.id, ...supportEntities.map((entity) => entity.id)],
      removedEntityIds: [],
    };
  },
};

const pasteCommand: CadCommandDefinition<{
  key: 'PASTE';
  deltaX: number;
  deltaY: number;
  entityIds: CadEntityId[];
}> = {
  key: 'PASTE',
  execute: (snapshot, command) => {
    if (Math.abs(command.deltaX) <= 1e-9 && Math.abs(command.deltaY) <= 1e-9) return null;
    const sourceEntities = getExpandedEntitiesByIds(snapshot.project, command.entityIds);
    if (sourceEntities.length === 0) return null;
    const copiedEntities = buildCopiedEntities(snapshot.project, sourceEntities, command.deltaX, command.deltaY);
    if (copiedEntities.length === 0) return null;
    const nextProject = appendCadProjectEntities(snapshot.project, copiedEntities);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(
          nextProject,
          copiedEntities.map((entity) => entity.id),
        ),
      },
      commandState: {
        key: 'PASTE',
        phase: 'committed',
        prompt: `PASTE committed by (${command.deltaX.toFixed(3)}, ${command.deltaY.toFixed(3)}).`,
      },
      transactionLabel: `PASTE (${copiedEntities.length})`,
      addedEntityIds: copiedEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

const trimCommand: CadCommandDefinition<{
  key: 'TRIM';
  cuttingEntityIds: CadEntityId[];
  targetEntityId: CadEntityId;
  pickPoint: { x: number; y: number };
  targetSegmentId?: string;
}> = {
  key: 'TRIM',
  execute: (snapshot, command) => {
    const cuttingEntities = buildTrimBoundaryEntities(snapshot.project, command.cuttingEntityIds);
    if (cuttingEntities.length === 0) return null;
    if (cuttingEntities.some((entity) => entity.id === command.targetEntityId)) return null;
    const targetEntity = snapshot.project.entities.find(
      (entity): entity is CadTrimEntity =>
        entity.id === command.targetEntityId && isTrimmableEntity(entity) && !entity.locked,
    );
    if (!targetEntity) return null;

    const trimmedPieces = buildTrimmedEntityPieces(
      targetEntity,
      cuttingEntities,
      command.pickPoint,
      command.targetSegmentId,
    );
    if (trimmedPieces.length === 0) return null;

    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.flatMap((entity) => {
        if (entity.id !== targetEntity.id) return [entity];
        return trimmedPieces;
      }),
    );
    const preservedTargetId = trimmedPieces.some((entity) => entity.id === targetEntity.id);
    const cuttingSelectionIds = cuttingEntities
      .filter((entity) => nextProject.entities.some((candidate) => candidate.id === entity.id))
      .map((entity) => entity.id);

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, cuttingSelectionIds),
      },
      commandState: {
        key: 'TRIM',
        phase: 'committed',
        prompt: `TRIM committed on ${targetEntity.id}. ${trimmedPieces.length} piece${trimmedPieces.length === 1 ? '' : 's'} remain.`,
      },
      transactionLabel: `TRIM (${targetEntity.id})`,
      addedEntityIds: trimmedPieces
        .map((entity) => entity.id)
        .filter((entityId) => entityId !== targetEntity.id),
      removedEntityIds: preservedTargetId ? [] : [targetEntity.id],
    };
  },
};

const intersectPointCommand: CadCommandDefinition<{
  key: 'INTERSECT_POINT';
  x: number;
  y: number;
  label?: string;
  firstLabel: string;
  secondLabel: string;
}> = {
  key: 'INTERSECT_POINT',
  execute: (snapshot, command) => {
    const summary = `Created point at ${command.firstLabel} x ${command.secondLabel}`;
    const provenance = createCogoProvenance({
      toolKey: 'INTERSECT_POINT',
      summary,
      inputs: {
        firstLabel: command.firstLabel,
        secondLabel: command.secondLabel,
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
      title: 'Intersection Point',
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
        key: 'INTERSECT_POINT',
        phase: 'committed',
        prompt: `INTERSECT_POINT committed at ${command.firstLabel} x ${command.secondLabel}.`,
      },
      transactionLabel: `INTERSECT_POINT (${pointEntity.stationId})`,
      addedEntityIds: [pointEntity.id, labelEntity?.id].filter(
        (entityId): entityId is string => entityId != null,
      ),
      removedEntityIds: [],
    };
  },
};

const gripEditCommand: CadCommandDefinition<{
  key: 'GRIP_EDIT';
  entityId: CadEntityId;
  gripKind: CadGripHandleKind;
  x: number;
  y: number;
  vertexIndex?: number;
}> = {
  key: 'GRIP_EDIT',
  execute: (snapshot, command) => {
    const nextProject = applyCadGripEdit(snapshot.project, command);
    if (!nextProject) return null;
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [command.entityId]),
      },
      commandState: {
        key: 'GRIP_EDIT',
        phase: 'committed',
        prompt: `GRIP_EDIT committed on ${command.entityId}.`,
      },
      transactionLabel: `GRIP_EDIT (${command.entityId})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
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
  COPY: copyCommand as CadCommandDefinition<CadCommand>,
  EXTEND: extendCommand as CadCommandDefinition<CadCommand>,
  FILLET: filletCommand as CadCommandDefinition<CadCommand>,
  PASTE: pasteCommand as CadCommandDefinition<CadCommand>,
  TRIM: trimCommand as CadCommandDefinition<CadCommand>,
  INTERSECT_POINT: intersectPointCommand as CadCommandDefinition<CadCommand>,
  GRIP_EDIT: gripEditCommand as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
