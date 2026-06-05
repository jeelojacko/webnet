import {
  clearCadSelection,
  createCadSelectionState,
  selectAllCadEntities,
} from './cadSelection';
import { cadBuildParcelClosureSummary } from './cadCogo';
import {
  cadAngleDegFromCenter,
  cadArcMidpoint,
  cadBuildArcFromThreePoints,
  cadBuildTangentCurve,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoCircle,
} from './cadGeometry';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import type { CadSelectionState } from './cadSelection';
import type {
  CadEntity,
  CadEntityId,
  CadGripHandle,
  CadGripHandleKind,
  CadParcelEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';

export type CadCommandKey =
  | 'SELECT_ALL'
  | 'CLEAR_SELECTION'
  | 'ERASE'
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'PLINE'
  | 'TRAVERSE'
  | 'ARC_3PT'
  | 'ARC_CREATE'
  | 'TANGENT_CURVE'
  | 'PARCEL_CREATE'
  | 'MOVE'
  | 'COPY'
  | 'PASTE'
  | 'INTERSECT_POINT'
  | 'GRIP_EDIT';
export type CadCommandPhase = 'idle' | 'committed';

export interface CadCommandState {
  key: CadCommandKey | 'IDLE';
  phase: CadCommandPhase;
  prompt: string;
}

export type CadCommand =
  | {
      key: 'SELECT_ALL';
    }
  | {
      key: 'CLEAR_SELECTION';
    }
  | {
      key: 'ERASE';
    }
  | {
      key: 'POINT';
      x: number;
      y: number;
      label?: string;
    }
  | {
      key: 'COGO_POINT';
      x: number;
      y: number;
      label?: string;
      basisLabel: string;
      directionLabel: string;
    }
  | {
      key: 'LINE';
      start: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'PLINE';
      vertices: { x: number; y: number; label: string }[];
    }
  | {
      key: 'TRAVERSE';
      vertices: { x: number; y: number; label: string }[];
    }
  | {
      key: 'ARC_3PT';
      start: { x: number; y: number; label: string };
      through: { x: number; y: number; label: string };
      end: { x: number; y: number; label: string };
    }
  | {
      key: 'ARC_CREATE';
      modeLabel: string;
      definition: {
        center: { x: number; y: number };
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      };
      metadata?: Record<string, unknown>;
    }
  | {
      key: 'TANGENT_CURVE';
      pi: { x: number; y: number; label: string };
      backTangentPoint: { x: number; y: number; label: string };
      aheadTangentPoint: { x: number; y: number; label: string };
      radius: number;
    }
  | {
      key: 'PARCEL_CREATE';
      sourceEntityId: CadEntityId;
    }
  | {
      key: 'MOVE';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'COPY';
      deltaX: number;
      deltaY: number;
    }
  | {
      key: 'PASTE';
      deltaX: number;
      deltaY: number;
      entityIds: CadEntityId[];
    }
  | {
      key: 'INTERSECT_POINT';
      x: number;
      y: number;
      label?: string;
      firstLabel: string;
      secondLabel: string;
    }
  | {
      key: 'GRIP_EDIT';
      entityId: CadEntityId;
      gripKind: CadGripHandleKind;
      x: number;
      y: number;
      vertexIndex?: number;
    };

export interface CadTransaction {
  id: string;
  sequence: number;
  commandKey: CadCommandKey;
  label: string;
  beforeSelectionIds: CadEntityId[];
  afterSelectionIds: CadEntityId[];
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

export interface CadWorkspaceSnapshot {
  project: CadProject;
  selection: CadSelectionState;
}

export interface CadCommandExecutionResult {
  nextSnapshot: CadWorkspaceSnapshot;
  commandState: CadCommandState;
  transactionLabel: string;
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

interface CadCommandDefinition<TCommand extends CadCommand> {
  key: TCommand['key'];
  execute: (_snapshot: CadWorkspaceSnapshot, _command: TCommand) => CadCommandExecutionResult | null;
}

const createIdleCommandState = (): CadCommandState => ({
  key: 'IDLE',
  phase: 'idle',
  prompt: 'Ready. Use Select All, Clear Selection, ERASE, POINT, COGO PT, LINE, PLINE, TRAVERSE, ARC 3PT, TAN CURVE, MOVE, COPY, INTX, or INVERSE to exercise command history.',
});

const nextManualStationId = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'survey-point') return;
    const match = /^CAD(\d+)$/i.exec(entity.stationId);
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `CAD${maxSequence + 1}`;
};

const nextParcelName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'parcel') return;
    const match = /^Parcel\s+(\d+)$/i.exec(entity.parcelName.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `Parcel ${maxSequence + 1}`;
};

const stationIdExists = (project: CadProject, stationId: string): boolean =>
  project.entities.some(
    (entity) =>
      (entity.type === 'survey-point' && entity.stationId === stationId) ||
      entity.id === `pt:${stationId}` ||
      entity.id === `label:${stationId}`,
  );

const createManualPointEntities = (
  project: CadProject,
  x: number,
  y: number,
  requestedLabel?: string,
  options?: { includeTextLabel?: boolean; createdBy?: string },
): { point: CadSurveyPointEntity; label: CadTextEntity | null } => {
  const requestedStationId = requestedLabel?.trim();
  const stationId =
    requestedStationId && !stationIdExists(project, requestedStationId)
      ? requestedStationId
      : nextManualStationId(project);
  const createdBy = options?.createdBy ?? 'POINT';
  const point: CadSurveyPointEntity = {
    id: `pt:${stationId}`,
    type: 'survey-point',
    layerId: 'points',
    styleId: 'style-point',
    visible: true,
    locked: false,
    stationId,
    x,
    y,
    pointClass: 'free',
    source: project.metadata.source,
    metadata: {
      createdBy,
      manual: true,
    },
  };
  if (options?.includeTextLabel === false) {
    return {
      point,
      label: null,
    };
  }
  return {
    point,
    label: {
      id: `label:${stationId}`,
      type: 'text',
      layerId: 'labels',
      styleId: 'style-label',
      visible: true,
      locked: false,
      x,
      y,
      text: stationId,
      anchorEntityId: `pt:${stationId}`,
      metadata: {
        createdBy,
        manual: true,
        stationId,
      },
    },
  };
};

const compactManualPointEntities = (
  entities: Array<CadSurveyPointEntity | CadTextEntity | null>,
): Array<CadSurveyPointEntity | CadTextEntity> =>
  entities.filter((entity): entity is CadSurveyPointEntity | CadTextEntity => entity != null);

const expandSelectedEntityIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntityId[] => {
  const expanded = new Set(selectedEntityIds);
  project.entities.forEach((entity) => {
    if (entity.type === 'text' && entity.anchorEntityId && expanded.has(entity.anchorEntityId)) {
      expanded.add(entity.id);
      return;
    }
    if (entity.type === 'error-ellipse' && expanded.has(`pt:${entity.stationId}`)) {
      expanded.add(entity.id);
    }
  });
  return project.entities.filter((entity) => expanded.has(entity.id)).map((entity) => entity.id);
};

const getExpandedSelectedEntities = (snapshot: CadWorkspaceSnapshot): CadEntity[] => {
  const expandedIds = new Set(
    expandSelectedEntityIds(snapshot.project, snapshot.selection.selectedEntityIds),
  );
  return snapshot.project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};

const getExpandedEntitiesByIds = (
  project: CadProject,
  selectedEntityIds: readonly CadEntityId[],
): CadEntity[] => {
  const expandedIds = new Set(expandSelectedEntityIds(project, selectedEntityIds));
  return project.entities.filter((entity) => expandedIds.has(entity.id) && !entity.locked);
};

const translateEntity = (entity: CadEntity, deltaX: number, deltaY: number): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'line':
      return {
        ...entity,
        fromX: entity.fromX + deltaX,
        fromY: entity.fromY + deltaY,
        toX: entity.toX + deltaX,
        toY: entity.toY + deltaY,
      };
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        vertices: entity.vertices.map((vertex) => ({
          x: vertex.x + deltaX,
          y: vertex.y + deltaY,
        })),
      };
    case 'arc':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
    case 'text':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'error-ellipse':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
  }
};

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

const rebuildParcelMetrics = (entity: CadParcelEntity): CadParcelEntity => {
  const metrics = cadBuildParcelClosureSummary(entity.vertices);
  if (!metrics) {
    return {
      ...entity,
      areaSquareMeters: undefined,
      perimeterMeters: undefined,
      closureDeltaX: undefined,
      closureDeltaY: undefined,
      closureDistanceMeters: undefined,
    };
  }
  return {
    ...entity,
    areaSquareMeters: metrics.areaSquareMeters,
    perimeterMeters: metrics.perimeterMeters,
    closureDeltaX: metrics.closureDeltaX,
    closureDeltaY: metrics.closureDeltaY,
    closureDistanceMeters: metrics.closureDistanceMeters,
  };
};

const updateArcEndpointFromGrip = (
  entity: Extract<CadEntity, { type: 'arc' }>,
  gripKind: 'arc-start' | 'arc-end',
  point: { x: number; y: number },
): Extract<CadEntity, { type: 'arc' }> | null => {
  const projectedPoint = cadProjectPointOntoCircle(
    point,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
  );
  const movedAngleNorm = cadAngleDegFromCenter(
    { x: entity.centerX, y: entity.centerY },
    projectedPoint,
  );
  const currentSweep = entity.endAngleDeg - entity.startAngleDeg;
  if (gripKind === 'arc-start') {
    if (currentSweep >= 0) {
      const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.endAngleDeg));
      if (magnitude <= 1e-6) {
        return {
          ...entity,
          startAngleDeg: entity.endAngleDeg - 360,
        };
      }
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg - magnitude,
      };
    }
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.endAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg + 360,
      };
    }
    return {
      ...entity,
      startAngleDeg: entity.endAngleDeg + magnitude,
    };
  }
  if (currentSweep >= 0) {
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.startAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        endAngleDeg: entity.startAngleDeg + 360,
      };
    }
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg + magnitude,
    };
  }
  const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.startAngleDeg));
  if (magnitude <= 1e-6) {
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg - 360,
    };
  }
  return {
    ...entity,
    endAngleDeg: entity.startAngleDeg - magnitude,
  };
};

const updateEntityFromGrip = (
  entity: CadEntity,
  gripKind: CadGripHandleKind,
  point: { x: number; y: number },
  vertexIndex?: number,
): CadEntity | null => {
  switch (entity.type) {
    case 'line':
      if (gripKind === 'line-start') {
        return {
          ...entity,
          fromX: point.x,
          fromY: point.y,
        };
      }
      if (gripKind === 'line-end') {
        return {
          ...entity,
          toX: point.x,
          toY: point.y,
        };
      }
      return null;
    case 'polyline':
    case 'polygon':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return {
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      };
    case 'parcel':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return rebuildParcelMetrics({
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      });
    case 'arc':
      if (gripKind === 'arc-radius') {
        const radius = Math.hypot(point.x - entity.centerX, point.y - entity.centerY);
        if (!Number.isFinite(radius) || radius <= 1e-6) return null;
        return {
          ...entity,
          radius,
        };
      }
      if (gripKind === 'arc-start' || gripKind === 'arc-end') {
        return updateArcEndpointFromGrip(entity, gripKind, point);
      }
      return null;
    default:
      return null;
  }
};

export const buildCadGripHandles = (entity: CadEntity): CadGripHandle[] => {
  switch (entity.type) {
    case 'line':
      return [
        {
          id: `${entity.id}:line-start`,
          entityId: entity.id,
          kind: 'line-start',
          x: entity.fromX,
          y: entity.fromY,
        },
        {
          id: `${entity.id}:line-end`,
          entityId: entity.id,
          kind: 'line-end',
          x: entity.toX,
          y: entity.toY,
        },
      ];
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return entity.vertices.map((vertex, index) => ({
        id: `${entity.id}:vertex:${index}`,
        entityId: entity.id,
        kind: 'vertex',
        x: vertex.x,
        y: vertex.y,
        vertexIndex: index,
      }));
    case 'arc': {
      const startPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
      );
      const endPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.endAngleDeg,
      );
      const radiusPoint = cadArcMidpoint(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
        entity.endAngleDeg,
      );
      return [
        {
          id: `${entity.id}:arc-start`,
          entityId: entity.id,
          kind: 'arc-start',
          x: startPoint.x,
          y: startPoint.y,
        },
        {
          id: `${entity.id}:arc-end`,
          entityId: entity.id,
          kind: 'arc-end',
          x: endPoint.x,
          y: endPoint.y,
        },
        {
          id: `${entity.id}:arc-radius`,
          entityId: entity.id,
          kind: 'arc-radius',
          x: radiusPoint.x,
          y: radiusPoint.y,
        },
      ];
    }
    default:
      return [];
  }
};

export const applyCadGripEdit = (
  project: CadProject,
  command: Extract<CadCommand, { key: 'GRIP_EDIT' }>,
): CadProject | null => {
  const entity = project.entities.find((candidate) => candidate.id === command.entityId && !candidate.locked);
  if (!entity) return null;
  const updatedEntity = updateEntityFromGrip(
    entity,
    command.gripKind,
    { x: command.x, y: command.y },
    command.vertexIndex,
  );
  if (!updatedEntity) return null;
  return replaceCadProjectEntities(
    project,
    project.entities.map((candidate) => (candidate.id === entity.id ? updatedEntity : candidate)),
  );
};

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
  const copiedEntities: CadEntity[] = [];
  const copiedPointByStationId = new Map<
    string,
    { stationId: string; x: number; y: number }
  >();
  let workingProject = project;

  selectedEntities.forEach((entity) => {
    if (entity.type !== 'survey-point') return;
    const pointBundle = createManualPointEntities(
      workingProject,
      entity.x + deltaX,
      entity.y + deltaY,
    );
    const appendedEntities = compactManualPointEntities([pointBundle.point, pointBundle.label]);
    workingProject = appendCadProjectEntities(
      workingProject,
      appendedEntities,
    );
    copiedPointByStationId.set(entity.stationId, {
      stationId: pointBundle.point.stationId,
      x: pointBundle.point.x,
      y: pointBundle.point.y,
    });
    copiedEntities.push(...appendedEntities);
  });

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
        copiedEntities.push({
          ...entity,
          id: createStableRuntimeId('cad-arc'),
          centerX: entity.centerX + deltaX,
          centerY: entity.centerY + deltaY,
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
        key: 'COGO_POINT',
        phase: 'committed',
        prompt: `COGO_POINT committed from ${command.basisLabel} using ${command.directionLabel}.`,
      },
      transactionLabel: `COGO_POINT (${entities.point.stationId})`,
      addedEntityIds: [entities.point.id, entities.label?.id].filter(
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
      transactionLabel: `LINE (${command.start.label}-${command.end.label})`,
      addedEntityIds: [lineEntity.id],
      removedEntityIds: [],
    };
  },
};

const findExistingTraversePoint = (
  project: CadProject,
  vertex: { x: number; y: number; label: string },
): CadSurveyPointEntity | null =>
  project.entities.find(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.stationId === vertex.label &&
      Math.abs(entity.x - vertex.x) <= 1e-9 &&
      Math.abs(entity.y - vertex.y) <= 1e-9,
  ) ?? null;

const polylineCommand: CadCommandDefinition<{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
}> = {
  key: 'PLINE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-polyline'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: vertices.map((vertex) => vertex.label),
      closed: false,
      metadata: {
        createdBy: 'PLINE',
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [polylineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'PLINE',
        phase: 'committed',
        prompt: `PLINE committed with ${vertices.length} vertices.`,
      },
      transactionLabel: `PLINE (${vertices.length})`,
      addedEntityIds: [polylineEntity.id],
      removedEntityIds: [],
    };
  },
};

const traverseCommand: CadCommandDefinition<{
  key: 'TRAVERSE';
  vertices: { x: number; y: number; label: string }[];
}> = {
  key: 'TRAVERSE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;

    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const vertexLabels: string[] = [];

    vertices.forEach((vertex) => {
      const existingPoint = findExistingTraversePoint(workingProject, vertex);
      if (existingPoint) {
        vertexLabels.push(existingPoint.stationId);
        return;
      }
      const pointBundle = createManualPointEntities(workingProject, vertex.x, vertex.y, vertex.label, {
        includeTextLabel: false,
        createdBy: 'TRAVERSE',
      });
      workingProject = appendCadProjectEntities(workingProject, [pointBundle.point]);
      createdEntities.push(pointBundle.point);
      vertexLabels.push(pointBundle.point.stationId);
    });

    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-traverse'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels,
      closed: false,
      metadata: {
        createdBy: 'TRAVERSE',
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(workingProject, [polylineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'TRAVERSE',
        phase: 'committed',
        prompt: `TRAVERSE committed with ${vertices.length} stations.`,
      },
      transactionLabel: `TRAVERSE (${vertices.length})`,
      addedEntityIds: [...createdEntities.map((entity) => entity.id), polylineEntity.id],
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
      metadata: {
        createdBy: 'ARC_3PT',
        manual: true,
        startLabel: command.start.label,
        throughLabel: command.through.label,
        endLabel: command.end.label,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [arcEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_3PT',
        phase: 'committed',
      prompt: `ARC_3PT committed through ${command.start.label}, ${command.through.label}, ${command.end.label}.`,
      },
      transactionLabel: `ARC_3PT (${command.start.label}-${command.through.label}-${command.end.label})`,
      addedEntityIds: [arcEntity.id],
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
      metadata: {
        createdBy: command.modeLabel,
        manual: true,
        ...(command.metadata ?? {}),
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [arcEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'ARC_CREATE',
        phase: 'committed',
        prompt: `${command.modeLabel} committed.`,
      },
      transactionLabel: `${command.modeLabel}`,
      addedEntityIds: [arcEntity.id],
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
      metadata: {
        createdBy: 'TANGENT_CURVE',
        manual: true,
        piLabel: command.pi.label,
        backLabel: command.backTangentPoint.label,
        aheadLabel: command.aheadTangentPoint.label,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [arcEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [arcEntity.id]),
      },
      commandState: {
        key: 'TANGENT_CURVE',
        phase: 'committed',
        prompt: `TANGENT_CURVE committed at ${command.pi.label} with radius ${command.radius.toFixed(3)}.`,
      },
      transactionLabel: `TANGENT_CURVE (${command.pi.label})`,
      addedEntityIds: [arcEntity.id],
      removedEntityIds: [],
    };
  },
};

const parcelCreateCommand: CadCommandDefinition<{
  key: 'PARCEL_CREATE';
  sourceEntityId: CadEntityId;
}> = {
  key: 'PARCEL_CREATE',
  execute: (snapshot, command) => {
    const sourcePolyline = snapshot.project.entities.find(
      (entity): entity is CadPolylineEntity =>
        entity.type === 'polyline' && entity.id === command.sourceEntityId,
    );
    if (!sourcePolyline) return null;
    const metrics = cadBuildParcelClosureSummary(sourcePolyline.vertices);
    if (!metrics) return null;
    const ringVertices =
      sourcePolyline.vertices.length > 1 &&
      Math.abs(sourcePolyline.vertices[0]!.x - sourcePolyline.vertices[sourcePolyline.vertices.length - 1]!.x) <= 1e-9 &&
      Math.abs(sourcePolyline.vertices[0]!.y - sourcePolyline.vertices[sourcePolyline.vertices.length - 1]!.y) <= 1e-9
        ? sourcePolyline.vertices.slice(0, -1)
        : sourcePolyline.vertices;
    const ringLabels =
      sourcePolyline.vertexLabels.length > 1 &&
      sourcePolyline.vertexLabels[0] === sourcePolyline.vertexLabels[sourcePolyline.vertexLabels.length - 1]
        ? sourcePolyline.vertexLabels.slice(0, -1)
        : sourcePolyline.vertexLabels;
    const parcelName = nextParcelName(snapshot.project);
    const parcelEntity: CadParcelEntity = {
      id: createStableRuntimeId('cad-parcel'),
      type: 'parcel',
      layerId: 'parcels',
      styleId: 'style-parcel',
      visible: true,
      locked: false,
      vertices: ringVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: [...ringLabels],
      parcelName,
      areaSquareMeters: metrics.areaSquareMeters,
      perimeterMeters: metrics.perimeterMeters,
      closureDeltaX: metrics.closureDeltaX,
      closureDeltaY: metrics.closureDeltaY,
      closureDistanceMeters: metrics.closureDistanceMeters,
      metadata: {
        createdBy: 'PARCEL_CREATE',
        manual: true,
        sourceEntityId: sourcePolyline.id,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [parcelEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [parcelEntity.id]),
      },
      commandState: {
        key: 'PARCEL_CREATE',
        phase: 'committed',
        prompt: `PARCEL_CREATE committed for ${parcelName}. Closure ${metrics.closureDistanceMeters.toFixed(3)} m.`,
      },
      transactionLabel: `PARCEL_CREATE (${parcelName})`,
      addedEntityIds: [parcelEntity.id],
      removedEntityIds: [],
    };
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
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) =>
        selectedIdSet.has(entity.id) ? translateEntity(entity, command.deltaX, command.deltaY) : entity,
      ),
    );
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
        key: 'INTERSECT_POINT',
        phase: 'committed',
        prompt: `INTERSECT_POINT committed at ${command.firstLabel} x ${command.secondLabel}.`,
      },
      transactionLabel: `INTERSECT_POINT (${entities.point.stationId})`,
      addedEntityIds: [entities.point.id, entities.label?.id].filter(
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
  ARC_3PT: arc3ptCommand as CadCommandDefinition<CadCommand>,
  ARC_CREATE: arcCreateCommand as CadCommandDefinition<CadCommand>,
  TANGENT_CURVE: tangentCurveCommand as CadCommandDefinition<CadCommand>,
  PARCEL_CREATE: parcelCreateCommand as CadCommandDefinition<CadCommand>,
  MOVE: moveCommand as CadCommandDefinition<CadCommand>,
  COPY: copyCommand as CadCommandDefinition<CadCommand>,
  PASTE: pasteCommand as CadCommandDefinition<CadCommand>,
  INTERSECT_POINT: intersectPointCommand as CadCommandDefinition<CadCommand>,
  GRIP_EDIT: gripEditCommand as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
